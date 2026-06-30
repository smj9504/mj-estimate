"""
ASGI entrypoint that binds the port instantly and serves /health
while the real FastAPI app (app.main) loads in a background thread.

Render's deploy health-check times out after 5 s.  Because app.main
imports 50+ domain modules (~10-17 s on cold start), uvicorn can't
bind the port in time.  This wrapper solves that:

  1. uvicorn loads THIS tiny module (< 0.1 s)  ->  port binds immediately
  2. /health responds "starting" while the real app loads in a thread
  3. Once loaded, every request is forwarded to the real FastAPI app
"""

import asyncio
import json
import threading
import time
from datetime import datetime, timezone


class LauncherASGI:
    """
    Lightweight ASGI app that proxies to the real app once it's ready.
    Before that, only /health returns 200; everything else returns 503.
    """

    def __init__(self):
        self._real_app = None
        self._loading = True
        self._error: str | None = None
        self._start_time = time.monotonic()
        self._thread = threading.Thread(target=self._load_real_app, daemon=True)
        self._thread.start()

    # ── background loader ──────────────────────────────────────────
    def _load_real_app(self):
        try:
            from app.main import app as real_app  # heavy import
            self._real_app = real_app
            elapsed = time.monotonic() - self._start_time
            print(f"[LAUNCHER] Real app loaded in {elapsed:.1f}s")
        except Exception as exc:
            self._error = str(exc)
            print(f"[LAUNCHER] Failed to load real app: {exc}")
        finally:
            self._loading = False

    # ── ASGI interface ─────────────────────────────────────────────
    async def __call__(self, scope, receive, send):
        # If the real app is ready, delegate everything to it
        if self._real_app is not None:
            await self._real_app(scope, receive, send)
            return

        # Only handle HTTP while loading
        if scope["type"] != "http":
            return

        path = scope.get("path", "")

        # /health  ->  200  (keeps Render happy during startup)
        if path == "/health":
            body = json.dumps({
                "status": "starting",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "service": "mj-estimate-api",
                "version": "2.0.0",
                "loading": self._loading,
                "error": self._error,
            }).encode()
            await send({
                "type": "http.response.start",
                "status": 200,
                "headers": [
                    [b"content-type", b"application/json"],
                    [b"content-length", str(len(body)).encode()],
                ],
            })
            await send({"type": "http.response.body", "body": body})
            return

        # Everything else  ->  503
        body = json.dumps({
            "detail": "Service is starting, please retry shortly."
        }).encode()
        await send({
            "type": "http.response.start",
            "status": 503,
            "headers": [
                [b"content-type", b"application/json"],
                [b"content-length", str(len(body)).encode()],
                [b"retry-after", b"5"],
            ],
        })
        await send({"type": "http.response.body", "body": body})


app = LauncherASGI()
