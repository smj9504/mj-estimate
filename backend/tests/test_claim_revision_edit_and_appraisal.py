"""Editing a saved insurance estimate revision by hand, and a claim moving to
appraisal, on a throwaway SQLite database."""

from datetime import datetime, timedelta
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.sqlite import base as sqlite_base

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory
from app.core.database_factory import Base, SQLiteDatabase
from app.domains.claim_followup.service import ClaimFollowUpService
from app.domains.client.models import Claim, ClaimNegotiation, Client
from app.domains.client.service import ClaimNegotiationService, ClaimService
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401

TABLES = [Client, Claim, ClaimNegotiation]


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

    session = database.get_session()
    client = Client(display_name='Pat Client', owners=[])
    session.add(client)
    session.flush()
    claim = Claim(client_id=client.id, claim_number='057791811', status='negotiating',
                  insurance_deductible=1000)
    session.add(claim)
    session.flush()
    start = datetime(2026, 9, 1)
    initial = ClaimNegotiation(
        claim_id=claim.id, revision_number=1, revision_type='initial',
        rcv_amount=33844.22, acv_amount=18885.10, depreciation_amount=0, deductible=1000,
        date_received=start, created_at=start,
        sections_data=[{'section_name': 'Dwelling', 'rcv': 33844.22, 'depreciation': 0,
                        'deductible': 1000, 'net_acv': 18885.10}],
    )
    supplement = ClaimNegotiation(
        claim_id=claim.id, revision_number=2, revision_type='supplement',
        rcv_amount=40000, acv_amount=30000, depreciation_amount=9000, deductible=1000,
        date_received=start + timedelta(days=20), created_at=start + timedelta(days=20),
    )
    session.add(initial)
    session.add(supplement)
    claim.current_rcv, claim.current_acv, claim.current_depreciation = 40000, 30000, 9000
    session.commit()
    ids = {'claim': str(claim.id), 'initial': str(initial.id), 'supplement': str(supplement.id)}
    session.close()

    def load_claim():
        s = database.get_session()
        try:
            c = s.query(Claim).filter(Claim.id == ids['claim']).one()
            return SimpleNamespace(**{col.name: getattr(c, col.name) for col in Claim.__table__.columns})
        finally:
            s.close()

    return database, ids, load_claim


def test_editing_the_latest_revision_moves_the_claim_amounts(env):
    database, ids, load_claim = env
    ClaimNegotiationService(database).update(ids['supplement'], {
        'acv_amount': 31000, 'rcv_amount': 41000, 'depreciation_amount': 9000, 'deductible': 1500,
    })
    claim = load_claim()
    assert float(claim.current_rcv) == 41000
    assert float(claim.current_acv) == 31000
    assert float(claim.insurance_deductible) == 1500


def test_edited_sections_set_the_revision_totals(env):
    database, ids, load_claim = env
    # The PDF missed the depreciation; it is entered on the section by hand
    result = ClaimNegotiationService(database).update(ids['initial'], {
        'sections_data': [{'section_name': 'Dwelling', 'rcv': 33844.22, 'depreciation': 13959.12,
                           'deductible': 1000, 'net_acv': 18885.10}],
    })
    assert result['depreciation_amount'] == pytest.approx(13959.12)
    assert result['rcv_amount'] == pytest.approx(33844.22)
    # An older revision: the claim still shows the supplement's figures
    claim = load_claim()
    assert float(claim.current_rcv) == 40000
    assert float(claim.current_depreciation) == 9000


def test_deleting_the_latest_revision_falls_back_to_the_one_before(env):
    database, ids, load_claim = env
    assert ClaimNegotiationService(database).delete(ids['supplement']) is True
    claim = load_claim()
    assert float(claim.current_rcv) == pytest.approx(33844.22)
    assert float(claim.current_acv) == pytest.approx(18885.10)
    # Deleting doesn't touch a deductible entered on the claim
    assert float(claim.insurance_deductible) == 1000


def test_moving_to_appraisal_records_when(env):
    database, ids, load_claim = env
    service = ClaimService(database)

    service.update(ids['claim'], {'status': 'appraisal'})
    stamped = load_claim().appraisal_date
    assert load_claim().status == 'appraisal'
    assert stamped is not None

    service.update(ids['claim'], {'status': 'appraisal', 'appraisal_date': datetime(2026, 10, 1)})
    assert load_claim().appraisal_date.date() == datetime(2026, 10, 1).date()

    # Undo: back to negotiation, date cleared
    service.update(ids['claim'], {'status': 'negotiating', 'appraisal_date': None})
    claim = load_claim()
    assert claim.status == 'negotiating'
    assert claim.appraisal_date is None


def test_an_appraisal_claim_gets_no_supplement_review(env):
    database, ids, _ = env
    session = database.get_session()
    try:
        claim = session.query(Claim).filter(Claim.id == ids['claim']).one()
        claim.status = 'appraisal'
        ClaimFollowUpService()._auto_create_supplement(session, claim, {'rcv_amount': 52000})
        assert not claim.needs_supplement
        assert claim.supplement_status is None
    finally:
        session.close()
