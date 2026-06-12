import os

from pydantic import Field

from frigate.const import DEFAULT_DB_PATH

from .base import FrigateBaseModel

__all__ = ["DatabaseConfig"]


def _default_db_path() -> str:
    # FRIGATE_DB_PATH env-var lets operators redirect the DB to a local volume
    # (e.g. when /config is a CIFS/NFS mount where SQLite locking is broken).
    return os.environ.get("FRIGATE_DB_PATH") or DEFAULT_DB_PATH


class DatabaseConfig(FrigateBaseModel):
    path: str = Field(
        default_factory=_default_db_path,
        title="Database path",
        description="Filesystem path where the Frigate SQLite database file will be stored.",
    )
