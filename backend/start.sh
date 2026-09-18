#!/bin/sh
# Container entrypoint: run pending migrations, then start the app.
# Kept as a real script (not inlined into render.yaml's dockerCommand)
# because that field's quoting/escaping behavior on Render is unclear -
# a previous attempt to inline this as one `sh -c "..."` string produced
# `sh: 1: <the whole string>: not found`, which looks like the quotes
# weren't interpreted as shell syntax at all.
set -e

# No `|| alembic stamp head` fallback here, deliberately. Stamping on failure
# writes the head revision into alembic_version without running the DDL, so the
# database claims to be migrated while the schema is not - and every later
# `upgrade head` then sees nothing to do. A Neon branch was left holding an
# alembic_version row and no other table at all that way.
# If a migration fails the deploy must fail with it.
alembic upgrade head

exec uvicorn app.asgi:app --host 0.0.0.0 --port "$PORT" \
  --log-level info --timeout-keep-alive 30 --workers 1
