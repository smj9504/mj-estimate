"""Nobody on the internet reaches the API without signing in, except the
routes listed in login_gate.PUBLIC_ROUTES (customer/crew links, webhooks,
raw file links, health check)."""

import asyncio
import os
from pathlib import Path
import sys
import uuid

# Run off a throwaway sqlite file, never the deploy DB, when this file runs on
# its own. Nothing below talks to a database anyway: a request without a token
# is turned away before any query.
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DATABASE_URL", "sqlite:///./test_login_gate.db")

from fastapi import HTTPException
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
import pytest
from starlette.requests import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.main import app
from app.domains.auth import login_gate
from app.domains.auth.service import AuthService


client = TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def placeholder_db(monkeypatch):
    """The gate opens a DB session before it checks a token. No query runs
    here (the staff check is stood in for, or the token fails to decode), but
    the real get_db connects with whatever settings the first test module to
    import the app saw: in a full run with no .env that is no DATABASE_URL and
    the gate answers 503; with a .env it is that database. A bare object keeps
    these tests off both, and any query that does creep in loud."""
    def get_db():
        yield object()

    monkeypatch.setattr(login_gate, "get_db", get_db)


def api_routes():
    return [r for r in app.routes if isinstance(r, APIRoute)]


def concrete_url(route):
    url = route.path
    for name in route.param_convertors:
        url = url.replace("{" + name + "}", str(uuid.uuid4()))
    return url


def gated(route, method):
    return not login_gate.is_public(method, route.path) and not login_gate.route_checks_login_itself(route)


def test_every_route_runs_the_gate_first():
    skipped = [
        r.path for r in api_routes()
        if not r.dependant.dependencies
        or r.dependant.dependencies[0].call is not login_gate.require_login_unless_public
    ]
    assert skipped == []


def test_public_list_names_only_real_routes():
    real = {(m, r.path) for r in api_routes() for m in r.methods}
    assert sorted(login_gate.PUBLIC_ROUTES - real) == []


def test_routes_without_their_own_check_turn_away_requests_without_a_token():
    let_through = []
    checked = 0
    for route in api_routes():
        for method in sorted(route.methods):
            if not gated(route, method):
                continue
            checked += 1
            status = client.request(method, concrete_url(route)).status_code
            if status != 401:
                let_through.append((method, route.path, status))
    assert checked > 0
    assert let_through == []


@pytest.mark.parametrize("method, url", [
    ("GET", "/api/xactimate/unified/search?company_id=x')--"),
    ("POST", "/api/invoices/preview-pdf"),
    ("POST", "/api/estimates/preview-pdf"),
    ("POST", "/api/plumber-reports/preview-pdf"),
    ("POST", "/api/electrician-reports/preview-pdf"),
    ("PUT", f"/api/staff/{uuid.uuid4()}"),
    ("POST", "/api/staff/"),
    ("GET", "/api/companies/"),
    ("GET", f"/api/companies/{uuid.uuid4()}/w9"),
    ("GET", f"/api/files/company/{uuid.uuid4()}"),
    ("GET", "/api/water-mitigation/sheet-pa-mappings"),
    ("POST", "/api/water-mitigation/sheet-pa-mappings/apply"),
    ("POST", "/api/integrations/google-sheets/webhook"),
    ("POST", "/api/integrations/google-sheets/sync"),
    ("GET", "/api/integrations/webhook-events"),
    ("GET", "/api/integrations/magicplan/projects"),
    ("GET", "/api/cheatsheet/sections"),
    ("PUT", f"/api/document-types/{uuid.uuid4()}"),
    ("GET", "/system/info"),
    ("GET", "/health/detailed"),
])
def test_holes_found_in_the_audit_need_a_login(method, url):
    assert client.request(method, url).status_code == 401


def test_a_bad_token_is_turned_away():
    resp = client.get("/api/cheatsheet/sections", headers={"Authorization": "Bearer not-a-real-token"})
    assert resp.status_code == 401


def test_signed_in_staff_gets_through(monkeypatch):
    seen = {}

    async def fake_staff(credentials, db, cache):
        seen["token"] = credentials.credentials
        return object()

    monkeypatch.setattr(login_gate, "get_current_staff", fake_staff)
    resp = client.get("/api/staff/roles/list", headers={"Authorization": "Bearer good"})
    assert resp.status_code == 200
    assert seen["token"] == "good"


def test_a_refused_staff_member_stays_out(monkeypatch):
    async def inactive(credentials, db, cache):
        raise HTTPException(status_code=403, detail="Staff member is inactive or not allowed to login")

    monkeypatch.setattr(login_gate, "get_current_staff", inactive)
    resp = client.get("/api/staff/roles/list", headers={"Authorization": "Bearer old"})
    assert resp.status_code == 403


def test_health_check_stays_open():
    assert client.get("/health").status_code == 200


def test_public_links_are_not_asked_for_a_login():
    by_key = {(m, r.path): r for r in api_routes() for m in r.methods}

    async def run_gate(method, route):
        request = Request({
            "type": "http", "method": method, "path": route.path, "headers": [],
            "query_string": b"", "route": route,
        })
        return await login_gate.require_login_unless_public(request)

    for method, path in sorted(login_gate.PUBLIC_ROUTES):
        assert asyncio.run(run_gate(method, by_key[(method, path)])) is None


def test_routes_with_their_own_check_are_left_to_it():
    # These still answer the way they always did without a token (HTTPBearer's 403).
    own = next(r for r in api_routes() if r.path == "/api/auth/me" and "GET" in r.methods)
    assert login_gate.route_checks_login_itself(own)
    assert client.get("/api/auth/me").status_code in (401, 403)


class _Rows:
    def __init__(self, row):
        self.row = row

    def first(self):
        return self.row


class _Session:
    def __init__(self, row):
        self.row = row

    def query(self, *args):
        return _Rows(self.row)


@pytest.mark.parametrize("existing, creates", [(None, True), (("some-id",), False)])
def test_init_admin_only_seeds_an_empty_staff_table(monkeypatch, existing, creates):
    made = []
    monkeypatch.setattr(AuthService, "create_staff", lambda self, db, data: made.append(data) or "new")
    result = AuthService().create_initial_admin(_Session(existing))
    assert bool(made) is creates
    assert (result == "new") is creates
