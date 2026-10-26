"""A supplement's Original is the carrier's latest estimate RCV, and follows it
as estimates are uploaded, edited or deleted, on a throwaway SQLite database."""

from datetime import datetime, timedelta
from pathlib import Path
import sys

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.sqlite import base as sqlite_base
from sqlalchemy.ext.compiler import compiles

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory
from app.core.database_factory import Base, SQLiteDatabase
from app.domains.claim_followup.service import ClaimFollowUpService
from app.domains.client.models import Claim, ClaimActivity, ClaimNegotiation, Client
from app.domains.client.service import ClaimNegotiationService
from app.domains.supplement import api as supplement_api
from app.domains.supplement.models import SupplementRequest
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401

TABLES = [Client, Claim, ClaimNegotiation, ClaimActivity, SupplementRequest]
START = datetime(2026, 10, 21)


@compiles(JSONB, 'sqlite')
def jsonb_as_json(type_, compiler, **kw):
    """supplement_requests keeps a JSONB column; SQLite stores it as JSON"""
    return 'JSON'


def accept_iso_strings(monkeypatch):
    """The repository writes dates as ISO strings, which Postgres takes and
    SQLite's DateTime refuses; parse them as Postgres would"""
    real = sqlite_base.DATETIME.bind_processor

    def bind_processor(self, dialect):
        process = real(self, dialect)

        def parse_then_process(value):
            if isinstance(value, str):
                value = datetime.fromisoformat(value.replace('Z', '+00:00'))
            return process(value)
        return parse_then_process
    monkeypatch.setattr(sqlite_base.DATETIME, 'bind_processor', bind_processor)


@pytest.fixture
def env(tmp_path, monkeypatch):
    accept_iso_strings(monkeypatch)
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    # Only the tables these services touch; the rest use Postgres-only types,
    # so foreign keys pointing at them can't be checked
    sa.event.listen(
        database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF')
    )
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in TABLES])
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)
    monkeypatch.setattr(supplement_api, 'get_database', lambda: database)

    session = database.get_session()
    client = Client(display_name='Pat Client', owners=[])
    session.add(client)
    session.flush()
    claim = Claim(client_id=client.id, claim_number='46-0S0M464', status='negotiating')
    session.add(claim)
    session.flush()
    # Filed by hand before the carrier's estimate came in, so Original is 0
    supplement = SupplementRequest(
        claim_id=claim.id, title='Xactimate & pack out', status='in_progress',
        original_amount=0, supplement_amount=45000, difference=45000,
    )
    session.add(supplement)
    session.commit()
    ids = {'claim': str(claim.id), 'supplement': str(supplement.id)}
    session.close()

    def add_estimate(rcv, days, category=None):
        """Record a carrier estimate the way an upload does"""
        s = database.get_session()
        try:
            neg = ClaimNegotiation(
                claim_id=ids['claim'], revision_number=1, revision_type='supplement',
                estimate_category=category, rcv_amount=rcv, acv_amount=rcv,
                created_at=START + timedelta(days=days),
            )
            s.add(neg)
            s.flush()
            claim = s.query(Claim).filter(Claim.id == ids['claim']).one()
            ClaimFollowUpService()._auto_create_supplement(s, claim, {'rcv_amount': rcv})
            s.commit()
            return str(neg.id)
        finally:
            s.close()

    def load(supplement_id=None):
        s = database.get_session()
        try:
            sup = s.query(SupplementRequest).filter(
                SupplementRequest.id == (supplement_id or ids['supplement'])
            ).one()
            return float(sup.original_amount), float(sup.difference)
        finally:
            s.close()

    return database, ids, add_estimate, load


def test_an_estimate_uploaded_after_the_supplement_sets_its_original(env):
    _, _, add_estimate, load = env
    add_estimate(30367.49, 0)
    original, difference = load()
    assert original == pytest.approx(30367.49)
    assert difference == pytest.approx(45000 - 30367.49)


def test_a_newer_estimate_moves_the_original(env):
    _, _, add_estimate, load = env
    add_estimate(30000, 0)
    add_estimate(38000, 10)
    assert load()[0] == pytest.approx(38000)


def test_editing_the_estimate_on_the_supplement_page_moves_the_original(env):
    _, ids, add_estimate, load = env
    neg_id = add_estimate(30000, 0)
    supplement_api.update_insurance_estimate(ids['claim'], neg_id, {'rcv_amount': 31500})
    original, difference = load()
    assert original == pytest.approx(31500)
    assert difference == pytest.approx(45000 - 31500)


def test_editing_the_estimate_on_the_claim_moves_the_original(env):
    database, _, add_estimate, load = env
    neg_id = add_estimate(30000, 0)
    ClaimNegotiationService(database).update(neg_id, {'rcv_amount': 32000})
    assert load()[0] == pytest.approx(32000)


def test_deleting_the_latest_estimate_falls_back_to_the_one_before(env):
    database, ids, add_estimate, load = env
    add_estimate(30000, 0)
    newer = add_estimate(38000, 10)
    supplement_api.delete_insurance_estimate(ids['claim'], newer)
    assert load()[0] == pytest.approx(30000)

    # Same through the claim's own revision list
    newer = add_estimate(39000, 20)
    ClaimNegotiationService(database).delete(newer)
    assert load()[0] == pytest.approx(30000)


def test_a_wm_estimate_leaves_the_original_alone(env):
    _, _, add_estimate, load = env
    add_estimate(30000, 0)
    add_estimate(4200, 5, category='water_mitigation')
    assert load()[0] == pytest.approx(30000)


def test_a_settled_supplement_keeps_the_figure_it_closed_on(env):
    database, ids, add_estimate, load = env
    add_estimate(30000, 0)
    s = database.get_session()
    try:
        sup = s.query(SupplementRequest).filter(SupplementRequest.id == ids['supplement']).one()
        sup.status = 'approved'
        s.commit()
    finally:
        s.close()
    add_estimate(45000, 10)
    assert load()[0] == pytest.approx(30000)
