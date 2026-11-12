"""Rewrite the secrets stored in the database with the current encryption key.

Mail account passwords, Gmail/Drive OAuth tokens and Drive service-account keys
are stored encrypted (app/core/encryption.py). After DATA_ENCRYPTION_KEY or
SECRET_KEY changes, put the old values in PREVIOUS_SECRET_KEYS /
PREVIOUS_DATA_ENCRYPTION_KEYS so they can still be read, then run:

    python scripts/reencrypt_secrets.py            # counts only, changes nothing
    python scripts/reencrypt_secrets.py --apply    # rewrites rows on an old key

from the backend folder, with the same environment as the server (Render Shell,
or locally with the production values). It prints counts per column, never a
value. When the dry run shows 0 on an old key, remove the PREVIOUS_* settings.
"""

import argparse
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cryptography.fernet import InvalidToken  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.encryption import on_current_key, reencrypt  # noqa: E402

# (table, key column, encrypted columns)
ENCRYPTED_COLUMNS = [
    ("email_accounts", "id", ("encrypted_password", "oauth_access_token", "oauth_refresh_token")),
    ("staff", "id", ("gdrive_oauth_access_token", "gdrive_oauth_refresh_token", "gdrive_service_account_json")),
]


def classify(value):
    """'empty', 'current', 'old' (readable, needs rewriting) or 'unreadable'."""
    if not value:
        return "empty"
    if on_current_key(value):
        return "current"
    try:
        reencrypt(value)
        return "old"
    except InvalidToken:
        return "unreadable"


def run(connection, apply: bool):
    report = {}
    for table, key_column, columns in ENCRYPTED_COLUMNS:
        rows = connection.execute(
            text(f"SELECT {key_column}, {', '.join(columns)} FROM {table}")
        ).mappings().all()
        for column in columns:
            counts = Counter()
            for row in rows:
                state = classify(row[column])
                counts[state] += 1
                if apply and state == "old":
                    connection.execute(
                        text(f"UPDATE {table} SET {column} = :value WHERE {key_column} = :key"),
                        {"value": reencrypt(row[column]), "key": row[key_column]},
                    )
            report[f"{table}.{column}"] = counts
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="rewrite rows that are on an old key")
    args = parser.parse_args(argv)

    engine = create_engine(settings.DATABASE_URL)
    with engine.begin() as connection:
        report = run(connection, args.apply)

    print("column: current / on an old key / unreadable / empty")
    for name, counts in report.items():
        print(f"  {name}: {counts['current']} / {counts['old']} / {counts['unreadable']} / {counts['empty']}")
    if args.apply:
        print("Rows on an old key were rewritten with the current key.")
    elif any(c["old"] for c in report.values()):
        print("Dry run: nothing changed. Run again with --apply to rewrite.")
    if any(c["unreadable"] for c in report.values()):
        print("Unreadable values: their key isn't in SECRET_KEY / DATA_ENCRYPTION_KEY / "
              "PREVIOUS_* here. Those accounts need their password or Google connection entered again.")


if __name__ == "__main__":
    main()
