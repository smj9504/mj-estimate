"""Client, claim and todo endpoints turn away anyone who is not signed in.

Walks every route on those routers, so an endpoint added later is covered too.
The database is blocked, so an endpoint that lets a request through fails
here instead of reaching whatever database the environment points at.
"""

from pathlib import Path
import re
import sys

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory  # noqa: E402
from app.main import app  # noqa: E402
from app.domains.client.api import router, todo_dashboard_router, todo_router  # noqa: E402

PREFIXES = [
    (router, '/api/clients'),
    (todo_dashboard_router, '/api/claim-todos'),
    (todo_router, '/api/todos'),
]
SOME_ID = '00000000-0000-0000-0000-000000000000'

ROUTES = [
    (method, prefix + re.sub(r'\{[^}]+\}', SOME_ID, route.path))
    for api_router, prefix in PREFIXES
    for route in api_router.routes
    if isinstance(route, APIRoute)
    for method in sorted(route.methods)
]


def _no_database(*args, **kwargs):
    raise RuntimeError('This test must not reach a database')


@pytest.fixture(autouse=True)
def block_database(monkeypatch):
    monkeypatch.setattr(database_factory, 'get_database', _no_database)
    app.dependency_overrides[database_factory.get_db_session] = _no_database
    yield
    app.dependency_overrides.pop(database_factory.get_db_session, None)


def test_every_router_has_routes():
    assert len(ROUTES) >= 40


@pytest.mark.parametrize('method,path', ROUTES)
def test_signed_out_requests_are_refused(method, path):
    client = TestClient(app, raise_server_exceptions=False)
    response = client.request(method, path)
    assert response.status_code in (401, 403), f'{method} {path} answered {response.status_code}'
