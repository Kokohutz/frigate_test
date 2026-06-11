"""Peewee migrations -- add 2FA columns to User."""

import peewee as pw

SQL = pw.SQL


def migrate(migrator, database, fake=False, **kwargs):
    migrator.sql('ALTER TABLE "user" ADD COLUMN "totp_secret" VARCHAR(64) NULL')
    migrator.sql(
        'ALTER TABLE "user" ADD COLUMN "totp_enabled" INTEGER NOT NULL DEFAULT 0'
    )
    migrator.sql('ALTER TABLE "user" ADD COLUMN "recovery_codes" TEXT NULL')


def rollback(migrator, database, fake=False, **kwargs):
    # SQLite does not support DROP COLUMN before 3.35 — no-op is safe for tests
    pass
