"""Peewee migrations -- add audit_log table."""

import peewee as pw


def migrate_db(database):
    database.execute_sql(
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


def rollback(database):
    database.execute_sql("DROP TABLE IF EXISTS audit_log")
