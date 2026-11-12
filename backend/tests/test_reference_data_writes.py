"""Shared prices and reference data can't be changed by just any signed-in account
(2026-11 audit, items 14 and 15).

- Roofing material prices and calculation rates, packing prices: a company's own
  people with the screen change that company's rows; the defaults every
  company falls back to (no company) are admin-only.
- Cheat sheet, plumber report templates and the Xactimate Helper: the screen
  that edits them (plumber templates: and only your own company's).
- Document types / trades / measurement report types, receipt templates and the
  Xactimate price list: admin-only. Reading stays open to everyone signed in.

Nothing here reaches a database: a refused request stops at the check, and a
let-through request stops at body validation (422) or at a stubbed service.
"""

import os
from pathlib import Path
import sys
import uuid

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DATABASE_URL", "sqlite:///./test_reference_data_writes.db")

from fastapi.testclient import TestClient
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.main import app
from app.domains.auth import company_scope, dependencies, screen_access
from app.domains.auth.dependencies import get_current_staff
from app.domains.pack_calculation import packing_api
from app.domains.roofing_estimate.service import RoofingEstimateService

COMPANY_A = str(uuid.uuid4())
COMPANY_B = str(uuid.uuid4())


class FakeStaff:
    def __init__(self, role, screens=(), companies=(COMPANY_A,)):
        self.id = uuid.uuid4()
        self.role = role
        self.screens = set(screens)
        self.companies = list(companies)


@pytest.fixture
def sign_in(monkeypatch):
    """Sign in as a stand-in: its screens and companies answer the checks."""
    current = {}

    def _sign_in(staff):
        current["staff"] = staff
        app.dependency_overrides[get_current_staff] = lambda: staff
        return staff

    monkeypatch.setattr(dependencies.auth_service, "get_staff_by_id", lambda db, sid: current["staff"])
    monkeypatch.setattr(screen_access, "may_open", lambda db, staff, key: key in staff.screens)
    monkeypatch.setattr(
        company_scope, "company_ids",
        lambda db, staff: None if company_scope.sees_everything(staff) else staff.companies,
    )
    yield _sign_in
    app.dependency_overrides.pop(get_current_staff, None)


client = TestClient(app, raise_server_exceptions=False)
ID = str(uuid.uuid4())
PLUMBER_Q = f"?company_id={COMPANY_A}&user_id={ID}"

WRITE_ROUTES = [
    # Vuln 14: prices
    ("POST", "/api/roofing-estimates/material-prices"),
    ("PUT", "/api/roofing-estimates/material-prices"),
    ("PUT", "/api/roofing-estimates/pricing-settings"),
    ("PATCH", f"/api/packing-estimate/prices/{ID}"),
    ("POST", "/api/packing-estimate/prices/seed"),
    # Vuln 15: cheat sheet
    ("POST", "/api/cheatsheet/sections"),
    ("PUT", f"/api/cheatsheet/sections/{ID}"),
    ("DELETE", f"/api/cheatsheet/sections/{ID}"),
    ("POST", "/api/cheatsheet/rules"),
    ("PUT", f"/api/cheatsheet/rules/{ID}"),
    ("DELETE", f"/api/cheatsheet/rules/{ID}"),
    ("POST", "/api/cheatsheet/tables"),
    ("PUT", f"/api/cheatsheet/tables/{ID}"),
    ("DELETE", f"/api/cheatsheet/tables/{ID}"),
    ("POST", "/api/cheatsheet/rows"),
    ("PUT", f"/api/cheatsheet/rows/{ID}"),
    ("PATCH", f"/api/cheatsheet/rows/{ID}/note"),
    ("DELETE", f"/api/cheatsheet/rows/{ID}"),
    # document types, trades, measurement report types
    ("POST", "/api/document-types/"),
    ("PUT", f"/api/document-types/{ID}"),
    ("DELETE", f"/api/document-types/{ID}"),
    ("POST", "/api/trades/"),
    ("PUT", f"/api/trades/{ID}"),
    ("DELETE", f"/api/trades/{ID}"),
    ("POST", "/api/measurement-report-types/"),
    ("PUT", f"/api/measurement-report-types/{ID}"),
    ("DELETE", f"/api/measurement-report-types/{ID}"),
    # plumber report templates
    ("POST", f"/api/plumber-report-templates/{PLUMBER_Q}"),
    ("PUT", f"/api/plumber-report-templates/{ID}{PLUMBER_Q}"),
    ("DELETE", f"/api/plumber-report-templates/{ID}{PLUMBER_Q}"),
    ("POST", f"/api/plumber-report-templates/{ID}/use{PLUMBER_Q}"),
    # receipt templates
    ("POST", "/api/receipts/templates/"),
    ("PUT", f"/api/receipts/templates/{ID}"),
    ("POST", f"/api/receipts/templates/{ID}/set-default"),
    ("DELETE", f"/api/receipts/templates/{ID}"),
    # Xactimate Helper
    ("POST", "/api/xactimate/rooms"),
    ("PATCH", f"/api/xactimate/rooms/{ID}"),
    ("POST", f"/api/xactimate/rooms/{ID}/analyze"),
    ("POST", f"/api/xactimate/rooms/{ID}/corrections"),
    ("POST", "/api/xactimate/descriptions"),
    ("PATCH", f"/api/xactimate/descriptions/{ID}"),
    ("PATCH", f"/api/xactimate/descriptions/{ID}/approve"),
    ("POST", f"/api/xactimate/descriptions/{ID}/copy"),
    ("POST", "/api/xactimate/helper/assemblies"),
    ("POST", "/api/xactimate/embed/sync"),
    ("POST", "/api/xactimate/helper/line-items/DRY1-2/generate-descriptions"),
    # Xactimate price list
    ("POST", "/api/xactimate/categories"),
    ("PUT", "/api/xactimate/categories/DRY"),
    ("DELETE", "/api/xactimate/categories/DRY"),
    ("POST", "/api/xactimate/items"),
    ("PUT", "/api/xactimate/items/1"),
    ("DELETE", "/api/xactimate/items/1"),
    ("POST", "/api/xactimate/items/1/components"),
    ("PUT", "/api/xactimate/components/1"),
    ("DELETE", "/api/xactimate/components/1"),
    # Packing: item -> material table, packout codes and rules, retraining stub
    ("POST", "/api/pack-calculation/mappings"),
    ("PUT", f"/api/pack-calculation/mappings/{ID}"),
    ("DELETE", f"/api/pack-calculation/mappings/{ID}"),
    ("POST", "/api/pack-calculation/ml/trigger-retraining"),
    ("POST", "/api/packout/xactimate/import"),
    ("POST", "/api/packout/xactimate/import-all"),
    ("POST", "/api/packout/packing-rules"),
    ("POST", "/api/packout/item-mappings"),
]

# Like the two public adjuster logins in production (2026-11-12): Invoices and
# Estimates screens, one company. And a contractor with no screens at all.
OUTSIDERS = [
    FakeStaff("public_adjuster", screens={"invoices", "estimates"}),
    FakeStaff("contractor"),
]


@pytest.mark.parametrize("who", OUTSIDERS, ids=lambda s: s.role)
@pytest.mark.parametrize("method,url", WRITE_ROUTES, ids=lambda v: str(v))
def test_outside_logins_cannot_change_shared_data(sign_in, who, method, url):
    sign_in(who)
    assert client.request(method, url).status_code == 403


# A body-less request that gets past the check stops at validation (422)
@pytest.mark.parametrize("method,url,screen", [
    ("POST", "/api/cheatsheet/sections", "cheat_sheet"),
    ("PUT", f"/api/cheatsheet/rows/{ID}", "cheat_sheet"),
    ("POST", f"/api/plumber-report-templates/{PLUMBER_Q}", "plumber_reports"),
    ("PUT", f"/api/plumber-report-templates/{ID}{PLUMBER_Q}", "plumber_reports"),
    ("POST", "/api/xactimate/descriptions", "line_items"),
    ("PATCH", f"/api/xactimate/descriptions/{ID}", "line_items"),
])
def test_the_screen_that_edits_it_lets_staff_through(sign_in, method, url, screen):
    sign_in(FakeStaff("staff", screens={screen}))
    assert client.request(method, url).status_code == 422


@pytest.mark.parametrize("method,url", [
    ("POST", "/api/cheatsheet/sections"),
    ("PUT", f"/api/document-types/{ID}"),
    ("POST", "/api/trades/"),
    ("POST", "/api/measurement-report-types/"),
    ("POST", "/api/receipts/templates/"),
    ("PUT", f"/api/receipts/templates/{ID}"),
    ("POST", "/api/xactimate/descriptions"),
    ("POST", "/api/xactimate/categories"),
    ("PUT", "/api/xactimate/items/1"),
    ("POST", f"/api/plumber-report-templates/{ID}/use?company_id={COMPANY_B}"),  # any company
])
def test_an_admin_gets_through(sign_in, method, url):
    sign_in(FakeStaff("admin"))
    assert client.request(method, url).status_code == 422


@pytest.mark.parametrize("method,url", [
    ("PUT", f"/api/document-types/{ID}"),
    ("POST", "/api/trades/"),
    ("POST", "/api/receipts/templates/"),
    ("POST", "/api/xactimate/items"),
])
def test_admin_only_data_stays_admin_only_even_with_every_screen(sign_in, method, url):
    sign_in(FakeStaff("manager", screens=set(screen_access.SCREEN_KEYS)))
    assert client.request(method, url).status_code == 403


def test_another_companys_plumber_templates_stay_closed(sign_in):
    sign_in(FakeStaff("staff", screens={"plumber_reports"}, companies=[COMPANY_A]))
    resp = client.put(f"/api/plumber-report-templates/{ID}?company_id={COMPANY_B}", json={})
    assert resp.status_code == 403


def test_reading_stays_open_to_everyone_signed_in(sign_in):
    sign_in(FakeStaff("public_adjuster", screens={"invoices"}))
    # Reads have no check of their own: on the empty test DB they may fail, but not as a refusal
    for url in ("/api/cheatsheet/sections", "/api/document-types/", "/api/trades/"):
        assert client.get(url).status_code not in (401, 403), url


# ---------------------------------------------------------------- roofing prices

@pytest.fixture
def roofing_service_stub(monkeypatch):
    """A let-through request reaches the service, which answers 400 here."""
    def refuse(self, *args, **kwargs):
        raise ValueError("stub: the check let it through")
    monkeypatch.setattr(RoofingEstimateService, "update_pricing_settings", refuse)


SETTINGS = {"settings": []}


def test_only_an_admin_changes_every_companys_roofing_rates(sign_in, roofing_service_stub):
    sign_in(FakeStaff("staff", screens={"pricing_settings"}))
    assert client.put("/api/roofing-estimates/pricing-settings", json=SETTINGS).status_code == 403
    sign_in(FakeStaff("admin"))
    assert client.put("/api/roofing-estimates/pricing-settings", json=SETTINGS).status_code == 400


def test_roofing_rates_of_your_own_company_only(sign_in, roofing_service_stub):
    sign_in(FakeStaff("staff", screens={"pricing_settings"}, companies=[COMPANY_A]))
    url = "/api/roofing-estimates/pricing-settings?company_id="
    assert client.put(url + COMPANY_B, json=SETTINGS).status_code == 403
    assert client.put(url + COMPANY_A, json=SETTINGS).status_code == 400


def test_roofing_material_defaults_are_admin_only(sign_in):
    sign_in(FakeStaff("staff", screens={"material_prices"}))
    body = {"label": "Ridge vent", "category": "vent", "unit": "LF"}
    assert client.post("/api/roofing-estimates/material-prices", json=body).status_code == 403
    assert client.put("/api/roofing-estimates/material-prices", json={"prices": {}}).status_code == 403
    other = f"/api/roofing-estimates/material-prices?company_id={COMPANY_B}"
    assert client.put(other, json={"prices": {}}).status_code == 403


# ---------------------------------------------------------------- packing prices

class _FakeQuery:
    def __init__(self, row):
        self.row = row

    def filter(self, *args):
        return self

    def first(self):
        return self.row


class _FakeSession:
    def __init__(self, row):
        self.row = row
        self.committed = False

    def query(self, *args):
        return _FakeQuery(self.row)

    def commit(self):
        self.committed = True


class _Price:
    def __init__(self, company_id):
        self.id = ID
        self.company_id = company_id
        self.unit_price = 1.0
        self.name = "Box"


@pytest.fixture
def packing_db():
    holder = {}

    def use(price):
        holder["db"] = _FakeSession(price)
        app.dependency_overrides[packing_api.get_db] = lambda: holder["db"]
        return holder["db"]

    yield use
    app.dependency_overrides.pop(packing_api.get_db, None)


@pytest.mark.parametrize("price_company,role,companies,allowed", [
    (None, "staff", [COMPANY_A], False),       # default price: admins only
    (None, "admin", [], True),
    (COMPANY_B, "staff", [COMPANY_A], False),  # another company's price
    (COMPANY_A, "staff", [COMPANY_A], True),   # their own company's price
])
def test_packing_price_edits(sign_in, packing_db, price_company, role, companies, allowed):
    db = packing_db(_Price(price_company))
    sign_in(FakeStaff(role, screens={"pack_calculator"}, companies=companies))
    resp = client.patch(f"/api/packing-estimate/prices/{ID}", json={"unit_price": 0.01})
    assert resp.status_code == (200 if allowed else 403)
    assert db.committed is allowed


def test_packing_price_seeding(sign_in, packing_db, monkeypatch):
    packing_db(None)
    seeded = []
    monkeypatch.setattr(packing_api, "seed_packing_prices",
                        lambda db, company_id=None, created_by_id=None: seeded.append(company_id) or 0)
    sign_in(FakeStaff("staff", screens={"pack_calculator"}, companies=[COMPANY_A]))
    assert client.post("/api/packing-estimate/prices/seed").status_code == 403
    assert client.post(f"/api/packing-estimate/prices/seed?company_id={COMPANY_B}").status_code == 403
    assert client.post(f"/api/packing-estimate/prices/seed?company_id={COMPANY_A}").status_code == 200
    assert seeded == [COMPANY_A]


@pytest.mark.parametrize("method,url,who", [
    ("POST", "/api/pack-calculation/mappings", FakeStaff("staff", screens={"pack_calculator"})),
    ("PUT", f"/api/pack-calculation/mappings/{ID}", FakeStaff("staff", screens={"pack_calculator"})),
    ("POST", "/api/packout/xactimate/import", FakeStaff("admin")),
    ("POST", "/api/packout/packing-rules", FakeStaff("admin")),
    ("POST", "/api/packout/item-mappings", FakeStaff("super_admin")),
])
def test_packing_tables_open_to_who_edits_them(sign_in, method, url, who):
    # Before 2026-11-12 the packout checks called .get("role") on the staff
    # object and failed for everyone, admins included.
    sign_in(who)
    assert client.request(method, url).status_code == 422
