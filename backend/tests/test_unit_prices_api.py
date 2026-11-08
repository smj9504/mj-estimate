"""The company price screen's API: who may price which company, and what a
save accepts. The router alone, on a throwaway SQLite database."""

from pathlib import Path
import sys
import uuid
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: E402,F401
from app.core.database_factory import SQLAlchemySession, get_db  # noqa: E402
from app.domains.auth import company_scope  # noqa: E402
from app.domains.auth.dependencies import get_current_staff  # noqa: E402
from app.domains.company.models import Company  # noqa: E402
from app.domains.staff.models import Staff, StaffRole  # noqa: E402
from app.domains.unit_prices.api import router  # noqa: E402
from app.domains.unit_prices.models import PriceBook, UnitPriceChange, UnitPriceOverride  # noqa: E402

OURS = str(uuid.uuid4())
THEIRS = str(uuid.uuid4())


@pytest.fixture
def session(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'api.db'}")
    for model in (Company, Staff, PriceBook, UnitPriceOverride, UnitPriceChange):
        model.__table__.create(engine)
    s = SQLAlchemySession(sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)())
    s.add(Company(id=OURS, name="Ours"))
    s.add(Company(id=THEIRS, name="Theirs"))
    s.commit()
    yield s
    s.close()


def client_as(session, monkeypatch, role=StaffRole.admin, companies=None):
    staff = SimpleNamespace(id=str(uuid.uuid4()), role=role)
    api = FastAPI()
    api.include_router(router, prefix="/api")

    def _db():
        yield session

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_current_staff] = lambda: staff
    if role != StaffRole.admin:
        # Someone granted the screen who belongs to `companies`
        from app.domains.auth import screen_access, dependencies
        monkeypatch.setattr(screen_access, "may_open", lambda db, s, key: True)
        monkeypatch.setattr(dependencies.auth_service, "get_staff_by_id", lambda db, sid: staff)
        monkeypatch.setattr(company_scope, "company_ids", lambda db, s: list(companies or []))
    return TestClient(api)


def test_an_admin_prices_any_company(session, monkeypatch):
    client = client_as(session, monkeypatch)
    names = [c["name"] for c in client.get("/api/unit-prices/companies").json()]
    assert names == ["Ours", "Theirs"]

    listed = client.get("/api/unit-prices/bathroom", params={"company_id": THEIRS})
    assert listed.status_code == 200
    item = next(i for i in listed.json()["items"] if i["key"] == "VANITY_INSTALL")
    assert (item["kind"], item["default_labor"], item["labor"]) == ("labor", 589, None)

    saved = client.put("/api/unit-prices/bathroom", params={"company_id": THEIRS},
                       json={"prices": {"VANITY_INSTALL": {"labor": 700}}})
    assert saved.status_code == 200
    item = next(i for i in saved.json()["items"] if i["key"] == "VANITY_INSTALL")
    assert item["labor"] == 700

    history = client.get("/api/unit-prices/bathroom/history", params={"company_id": THEIRS}).json()
    assert [(h["key"], h["new_labor"]) for h in history] == [("VANITY_INSTALL", 700)]


def test_a_save_that_prices_the_wrong_side_is_refused(session, monkeypatch):
    client = client_as(session, monkeypatch)
    bad = client.put("/api/unit-prices/cabinet", params={"company_id": OURS},
                     json={"prices": {"BASE_RATES.Stock.base_lf": {"labor": 50}}})
    assert bad.status_code == 400
    unknown_field = client.put("/api/unit-prices/cabinet", params={"company_id": OURS},
                               json={"prices": {"BASE_RATES.Stock.base_lf": {"price": 50}}})
    assert unknown_field.status_code == 422
    assert client.get("/api/unit-prices/plumbing", params={"company_id": OURS}).status_code == 404
    assert client.get("/api/unit-prices/cabinet").status_code == 400


def test_staff_price_only_their_own_companies(session, monkeypatch):
    client = client_as(session, monkeypatch, role=StaffRole.manager, companies=[OURS])
    assert [c["name"] for c in client.get("/api/unit-prices/companies").json()] == ["Ours"]
    assert client.get("/api/unit-prices/cabinet", params={"company_id": OURS}).status_code == 200
    assert client.get("/api/unit-prices/cabinet", params={"company_id": THEIRS}).status_code == 403
    refused = client.put("/api/unit-prices/cabinet", params={"company_id": THEIRS},
                         json={"prices": {"BASE_RATES.Stock.base_lf": {"material": 1}}})
    assert refused.status_code == 403
    assert session.query(UnitPriceOverride).count() == 0
