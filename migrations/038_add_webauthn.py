"""Peewee migrations -- add webauthn_credentials table."""


def migrate_db(database):
    database.execute_sql(
        """
        CREATE TABLE IF NOT EXISTS webauthn_credentials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            credential_id TEXT NOT NULL UNIQUE,
            public_key TEXT NOT NULL,
            sign_count INTEGER NOT NULL DEFAULT 0,
            name TEXT NOT NULL DEFAULT '',
            created_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
        )
        """
    )


def rollback(database):
    database.execute_sql("DROP TABLE IF EXISTS webauthn_credentials")
