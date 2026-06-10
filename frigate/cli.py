"""
Argus CLI — headless management for the Argus NVR server.

Usage (when running inside the container or with the virtual env active):
    python -m frigate.cli [command]
    # or if installed as a script: argus [command]
"""

import datetime
import json
import sys

import click


@click.group()
def cli():
    """Argus NVR command-line management tool."""
    pass


@cli.group()
def users():
    """Manage user accounts."""
    pass


@users.command("list")
def users_list():
    """List all user accounts."""
    # Import here to avoid loading the full app unless needed
    from frigate.models import User

    for user in User.select():
        click.echo(
            f"{user.username}  role={user.role}  2fa={'on' if getattr(user, 'totp_enabled', False) else 'off'}"
        )


@users.command("add")
@click.argument("username")
@click.option(
    "--role", default="viewer", help="Role: admin, viewer, or custom role name"
)
@click.password_option()
def users_add(username, role, password):
    """Create a new user."""
    from frigate.api.auth import hash_password
    from frigate.models import User

    User.create(username=username, password_hash=hash_password(password), role=role)
    click.echo(f"Created user {username} with role {role}")


@users.command("delete")
@click.argument("username")
@click.confirmation_option(prompt="Are you sure you want to delete this user?")
def users_delete(username):
    """Delete a user account."""
    from frigate.models import User

    deleted = User.delete().where(User.username == username).execute()
    if deleted:
        click.echo(f"Deleted user {username}")
    else:
        click.echo(f"User {username} not found", err=True)
        sys.exit(1)


@cli.group()
def audit():
    """View audit log."""
    pass


@audit.command("tail")
@click.option("--lines", "-n", default=50, help="Number of recent entries to show")
@click.option("--user", default=None, help="Filter by username")
@click.option("--action", default=None, help="Filter by action type")
def audit_tail(lines, user, action):
    """Show recent audit log entries."""
    from frigate.models import AuditLog

    q = AuditLog.select().order_by(AuditLog.timestamp.desc()).limit(lines)
    if user:
        q = q.where(AuditLog.user == user)
    if action:
        q = q.where(AuditLog.action == action)
    for entry in reversed(list(q)):
        ts = datetime.datetime.fromtimestamp(entry.timestamp).strftime(
            "%Y-%m-%d %H:%M:%S"
        )
        details = f"  {entry.details}" if entry.details else ""
        ip = f" from {entry.ip}" if entry.ip else ""
        click.echo(f"{ts}  {entry.user:<20} {entry.action}{ip}{details}")


@cli.command()
@click.option("--config", default="/config/config.yml", help="Path to config.yml")
def validate(config):
    """Validate the Argus configuration file."""
    import yaml

    from frigate.config.config import FrigateConfig

    try:
        with open(config) as f:
            raw = yaml.safe_load(f)
        cfg = FrigateConfig(**raw)
        click.echo(f"Config valid. {len(cfg.cameras)} camera(s) configured.")
    except Exception as e:
        click.echo(f"Config error: {e}", err=True)
        sys.exit(1)


@cli.group()
def export():
    """Export data."""
    pass


@export.command("events")
@click.option("--camera", default=None)
@click.option("--limit", default=100)
@click.option("--output", default="-", help="Output file or - for stdout")
def export_events(camera, limit, output):
    """Export events as JSON."""
    from frigate.models import Event

    q = Event.select().order_by(Event.start_time.desc()).limit(limit)
    if camera:
        q = q.where(Event.camera == camera)
    data = [
        {
            "id": e.id,
            "camera": e.camera,
            "label": e.label,
            "confidence": e.data.get("score", 0) if e.data else 0,
            "start_time": e.start_time,
            "end_time": e.end_time,
        }
        for e in q
    ]
    out = json.dumps(data, indent=2)
    if output == "-":
        click.echo(out)
    else:
        with open(output, "w") as f:
            f.write(out)
        click.echo(f"Wrote {len(data)} events to {output}")


if __name__ == "__main__":
    cli()
