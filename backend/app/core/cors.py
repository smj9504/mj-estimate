"""Lightweight CORS policy shared by the startup launcher and FastAPI app."""

import json
import os


def get_cors_origins() -> list[str]:
    raw = os.getenv('CORS_ORIGINS', '').strip()
    if not raw:
        return [
            'http://localhost:3000', 'http://localhost:3001',
            'http://127.0.0.1:3000', 'http://127.0.0.1:3001',
        ]
    try:
        origins = json.loads(raw)
    except json.JSONDecodeError:
        origins = raw.split(',')
    if isinstance(origins, str):
        origins = origins.split(',')
    if not isinstance(origins, list):
        return []
    return list(dict.fromkeys(
        origin.strip().rstrip('/') for origin in origins
        if isinstance(origin, str) and origin.strip()
    ))


def with_cors(app):
    """Wrap outside ServerErrorMiddleware and the launcher's startup responses."""
    from starlette.middleware.cors import CORSMiddleware
    middleware = None
    cached_origins = None

    async def cors_app(scope, receive, send):
        nonlocal middleware, cached_origins
        # app.main can load .env while the lightweight launcher is serving.
        # Refresh the policy if that changes the configured origins.
        origins = tuple(get_cors_origins())
        if middleware is None or origins != cached_origins:
            middleware = CORSMiddleware(
                app,
                allow_origins=origins,
                allow_credentials=True,
                allow_methods=['*'],
                allow_headers=['*'],
                expose_headers=['Retry-After', 'X-Request-ID'],
            )
            cached_origins = origins
        await middleware(scope, receive, send)

    return cors_app
