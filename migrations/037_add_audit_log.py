"""Peewee migrations -- add audit_log table."""

import peewee as pw

SQL = pw.SQL


def migrate(migrator, database, fake=False, **kwargs):
    migrator.sql(
        """
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL DEFAULT (strftime('%s', 'now')),
            user TEXT NOT NULL,
            action TEXT NOT NULL,
            ip TEXT,
            details TEXT
        )
        """
    )


def rollback(migrator, database, fake=False, **kwargs):
    migrator.sql("DROP TABLE IF EXISTS audit_log")
