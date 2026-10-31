"""A single supplement lists its claim's water mitigation jobs, so the supplement
page can show their photos, on a throwaway SQLite database."""

from pathlib import Path
import sys

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory
from app.core.database_factory import Base, SQLiteDatabase
from app.domains.client.models import Claim, Client
from app.domains.company.models import Company
from app.domains.supplement.models import BidItemEstimate, SupplementFollowUp, SupplementRequest
from app.domains.supplement.schemas import SupplementRequestResponse
from app.domains.supplement.service import SupplementService
from app.domains.water_mitigation.models import WaterMitigationJob
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401

TABLES = [
    Client, Claim, Company, WaterMitigationJob,
    SupplementRequest, BidItemEstimate, SupplementFollowUp,
]


@compiles(JSONB, 'sqlite')
def jsonb_as_json(type_, compiler, **kw):
    """supplement_requests keeps a JSONB column; SQLite stores it as JSON"""
    return 'JSON'


@pytest.fixture
def env(tmp_path, monkeypatch):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    # Only the tables this touches; the rest use Postgres-only types, so foreign
    # keys pointing at them can't be checked
    sa.event.listen(
        database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF')
    )
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in TABLES])
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)

    session = database.get_session()
    client = Client(display_name='Pat Client', owners=[])
    session.add(client)
    session.flush()
    claim = Claim(client_id=client.id, claim_number='46-0S0M464', status='negotiating')
    other_claim = Claim(client_id=client.id, claim_number='OTHER', status='negotiating')
    session.add(claim)
    session.add(other_claim)
    session.flush()
    supplement = SupplementRequest(claim_id=claim.id, title='Xactimate', status='in_progress')
    company = Company(name='MJ Restoration')
    session.add(supplement)
    session.add(company)
    session.flush()
    ids = {
        'claim': str(claim.id),
        'other_claim': str(other_claim.id),
        'supplement': str(supplement.id),
        'company': str(company.id),
    }
    session.commit()
    session.close()
    return database, ids


def add_job(database, claim_id, address, company_id=None):
    session = database.get_session()
    try:
        job = WaterMitigationJob(claim_id=claim_id, company_id=company_id, property_address=address)
        session.add(job)
        session.commit()
        return str(job.id)
    finally:
        session.close()


def test_a_supplement_lists_its_claims_jobs_with_their_company(env):
    database, ids = env
    with_company = add_job(database, ids['claim'], '1 Main St', ids['company'])
    without_company = add_job(database, ids['claim'], '2 Oak Ave')
    add_job(database, ids['other_claim'], '9 Elsewhere Rd', ids['company'])

    result = SupplementService().get_request(ids['supplement'])

    assert sorted(result['wm_jobs'], key=lambda job: job['property_address']) == [
        {'id': with_company, 'property_address': '1 Main St', 'company_name': 'MJ Restoration'},
        {'id': without_company, 'property_address': '2 Oak Ave', 'company_name': None},
    ]


def test_a_claim_with_no_jobs_still_loads_its_supplement(env):
    _, ids = env
    result = SupplementService().get_request(ids['supplement'])
    assert result['wm_jobs'] == []


def test_the_response_keeps_the_jobs(env):
    database, ids = env
    job = add_job(database, ids['claim'], '1 Main St', ids['company'])
    result = SupplementService().get_request(ids['supplement'])

    response = SupplementRequestResponse(**result)

    assert response.wm_jobs == [
        {'id': job, 'property_address': '1 Main St', 'company_name': 'MJ Restoration'},
    ]
