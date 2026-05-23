"""Peewee migrations -- add 2FA columns to User."""

import peewee as pw
from playhouse.migrate import SqliteMigrator, migrate


def migrate_db(database):
    migrator = SqliteMigrator(database)
    migrate(
        migrator.add_column(
            "user",
            "totp_secret",
            pw.CharField(null=True, max_length=64),
        ),
        migrator.add_column(
            "user",
            "totp_enabled",
            pw.BooleanField(default=False),
        ),
        migrator.add_column(
            "user",
            "recovery_codes",
            pw.TextField(null=True),
        ),
    )


def rollback(database):
    migrator = SqliteMigrator(database)
    migrate(
        migrator.drop_column("user", "totp_secret"),
        migrator.drop_column("user", "totp_enabled"),
        migrator.drop_column("user", "recovery_codes"),
    )
