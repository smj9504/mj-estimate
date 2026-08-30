#!/bin/sh
# Container entrypoint: run pending migrations, then start the app.
# Kept as a real script (not inlined into render.yaml's dockerCommand)
# because that field's quoting/escaping behavior on Render is unclear -
# a previous attempt to inline this as one `sh -c "..."` string produced
# `sh: 1: <the whole string>: not found`, which looks like the quotes
# weren't interpreted as shell syntax at all.
set -e

alembic upgrade head || {
  echo "Migration failed, stamping as head..."
  alembic stamp head
}

exec uvicorn app.asgi:app --host 0.0.0.0 --port "$PORT" \
  --log-level info --timeout-keep-alive 30 --workers 1
