"""A claim's profitability as the contractor and the public adjuster see it,
on a throwaway SQLite database with real tokens.

The contractor's revenue is what was paid and the PA fee is one of its costs;
the public adjuster's revenue is that fee. Each keeps its own expenses, and
sees only its own side. Admins see both."""

from datetime import datetime, timedelta
from pathlib import Path
import sys
import time

import jwt
import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory
from app.core.cache import CacheService, InMemoryCache, get_cache
from app.core.database_factory import Base, SQLiteDatabase, get_db_session
from app.domains.auth.service import AuthService
from app.domains.client import api as client_api
from app.domains.client.models import Claim, ClaimExpense, ClaimPayment, Client
from app.domains.client.service import expense_parties_for
from app.domains.company.models import Company, CompanyContact
from app.domains.contract.models import ClaimCompany
from app.domains.staff.models import Staff, StaffCompany, StaffRole
from app.domains.water_mitigation.models import WaterMitigationJob, WMSheetPAMapping
import app.main  # noqa: E402,F401  registers every model, as the app does


@compiles(JSONB, 'sqlite')
def jsonb_as_json(type_, compiler, **kw):
    return 'JSON'


TABLES = [
    Staff, StaffCompany, Company, CompanyContact, Client, Claim, ClaimPayment,
    ClaimExpense, ClaimCompany, WaterMitigationJob, WMSheetPAMapping,
]


def token_for(staff):
    payload = {
        'sub': str(staff.id),
        'username': staff.username,
        'role': staff.role.value,
        'exp': datetime.utcnow() + timedelta(days=1),
        'iat': int(time.time()) - 60,
    }
    return jwt.encode(payload, AuthService.SECRET_KEY, algorithm=AuthService.ALGORITHM)


@pytest.fixture
def env(tmp_path, monkeypatch):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(
        database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF')
    )
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in TABLES])
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)

    setup = database.get_session()
    people = {}
    for username, role in [('boss', StaffRole.admin), ('carl', StaffRole.contractor),
                           ('pat', StaffRole.public_adjuster), ('tina', StaffRole.technician)]:
        staff = Staff(
            staff_number=username.upper(), first_name=username.title(), last_name='Tester',
            email=f'{username}@example.com', role=role, hire_date=datetime(2026, 1, 1),
            username=username, is_active=True, can_login=True, all_companies=True,
        )
        setup.add(staff)
        people[username] = staff
    company = Company(name='Build Co', company_type='contractor')
    setup.add(company)
    client = Client(display_name='Pat Homeowner', owners=[])
    setup.add(client)
    setup.flush()
    claim = Claim(
        client_id=client.id, claim_number='CL-1', status='open',
        has_public_adjuster=True, pa_fee_percentage=10, insurance_deductible=1000,
        deductible_discount=200,
    )
    setup.add(claim)
    setup.flush()
    for row in [
        # Everyone but the admin sees the claim through the company on it
        ClaimCompany(claim_id=claim.id, company_id=company.id, role='reconstruction'),
        # Entered by the office: gross as entered
        ClaimPayment(claim_id=claim.id, payment_type='insurance', amount=20000),
        # Logged in the contractor portal with the PA's 10% already taken off
        ClaimPayment(claim_id=claim.id, payment_type='supplement', amount=9000,
                     gross_amount=10000, pa_fee_amount=1000),
        # The homeowner's deductible: the contractor's money, no PA fee on it
        ClaimPayment(claim_id=claim.id, payment_type='deductible', amount=800),
        ClaimExpense(claim_id=claim.id, party='contractor', category='estimator',
                     description='Estimate write-up', amount=1500),
        ClaimExpense(claim_id=claim.id, party='contractor', category='material',
                     description='Drywall', amount=4000),
        ClaimExpense(claim_id=claim.id, party='public_adjuster', category='estimator',
                     description='PA estimator', amount=500),
    ]:
        setup.add(row)
    setup.commit()
    ids = {
        'client': str(client.id),
        'claim': str(claim.id),
        **{
            e.description: str(e.id)
            for e in setup.query(ClaimExpense).all()
        },
    }
    setup.close()

    cache = CacheService.__new__(CacheService)
    cache.redis_client = InMemoryCache()
    InMemoryCache._shared_cache.clear()
    InMemoryCache._shared_ttls.clear()

    def request_session():
        session = database.get_session()
        try:
            yield session
            session.commit()
        finally:
            session.close()

    app = FastAPI()
    app.include_router(client_api.router, prefix='/api/clients')
    app.dependency_overrides[get_db_session] = request_session
    app.dependency_overrides[get_cache] = lambda: cache
    http = TestClient(app)

    def as_(name):
        http.headers['Authorization'] = f'Bearer {token_for(people[name])}'
        return http

    base = f"/api/clients/{ids['client']}/claims/{ids['claim']}"
    return as_, base, ids


def test_who_keeps_which_books():
    class Person:
        def __init__(self, role):
            self.role = role

    assert expense_parties_for(Person(StaffRole.admin)) == ('contractor', 'public_adjuster')
    assert expense_parties_for(Person(StaffRole.super_admin)) == ('contractor', 'public_adjuster')
    assert expense_parties_for(Person(StaffRole.public_adjuster)) == ('public_adjuster',)
    assert expense_parties_for(Person(StaffRole.contractor)) == ('contractor',)
    assert expense_parties_for(Person(StaffRole.manager)) == ('contractor',)


def test_the_contractor_counts_the_pa_fee_as_a_cost(env):
    as_, base, _ = env
    body = as_('carl').get(f'{base}/profitability').json()

    assert body['sides'] == ['contractor']
    assert 'public_adjuster' not in body
    # 10% of the office's 20,000 plus the 1,000 the portal check recorded;
    # nothing on the deductible
    assert body['insurance_received'] == 30000
    assert body['pa_fee_amount'] == 3000

    side = body['contractor']
    assert side['revenue'] == 30800  # gross of every payment, deductible included
    assert side['pa_fee'] == 3000
    assert side['category_totals'] == {'estimator': 1500, 'material': 4000}
    assert side['expense_total'] == 5500
    assert side['total_costs'] == 8500
    assert side['net_profit'] == 22300
    assert side['net_margin_pct'] == 72.4
    assert side['homeowner_deductible_due'] == 800
    assert {e['description'] for e in side['expenses']} == {'Estimate write-up', 'Drywall'}


def test_the_public_adjuster_counts_the_fee_as_revenue(env):
    as_, base, _ = env
    body = as_('pat').get(f'{base}/profitability').json()

    assert body['sides'] == ['public_adjuster']
    assert 'contractor' not in body
    side = body['public_adjuster']
    assert side['revenue'] == 3000
    assert side['expense_total'] == 500
    assert side['total_costs'] == 500
    assert side['net_profit'] == 2500
    assert side['net_margin_pct'] == 83.3
    assert side.get('deductible') is None
    assert [e['description'] for e in side['expenses']] == ['PA estimator']

    listed = as_('pat').get(f'{base}/expenses').json()
    assert [e['description'] for e in listed] == ['PA estimator']


def test_an_admin_sees_both_sides(env):
    as_, base, _ = env
    body = as_('boss').get(f'{base}/profitability').json()
    assert body['sides'] == ['contractor', 'public_adjuster']
    assert body['contractor']['net_profit'] == 22300
    assert body['public_adjuster']['net_profit'] == 2500
    assert len(as_('boss').get(f'{base}/expenses').json()) == 3


def test_other_staff_keep_the_contractor_books(env):
    as_, base, _ = env
    body = as_('tina').get(f'{base}/profitability').json()
    assert body['sides'] == ['contractor']
    assert 'public_adjuster' not in body


def test_each_side_adds_only_to_its_own_books(env):
    as_, base, ids = env
    pat = as_('pat')
    added = pat.post(f'{base}/expenses', json={
        'claim_id': ids['claim'], 'category': 'other', 'description': 'Mileage', 'amount': 120,
    })
    assert added.status_code == 200, added.text
    assert added.json()['party'] == 'public_adjuster'

    refused = pat.post(f'{base}/expenses', json={
        'claim_id': ids['claim'], 'party': 'contractor', 'category': 'labor',
        'description': 'Not theirs', 'amount': 1,
    })
    assert refused.status_code == 403

    carl = as_('carl')
    added = carl.post(f'{base}/expenses', json={
        'claim_id': ids['claim'], 'category': 'labor', 'description': 'Crew', 'amount': 2000,
    })
    assert added.json()['party'] == 'contractor'

    boss = as_('boss')
    added = boss.post(f'{base}/expenses', json={
        'claim_id': ids['claim'], 'party': 'public_adjuster', 'category': 'estimator',
        'description': 'Second look', 'amount': 300,
    })
    assert added.json()['party'] == 'public_adjuster'
    assert boss.get(f'{base}/profitability').json()['public_adjuster']['expense_total'] == 920


def test_nobody_changes_the_other_sides_expenses(env):
    as_, base, ids = env
    contractor_row = ids['Drywall']
    pa_row = ids['PA estimator']

    pat = as_('pat')
    assert pat.put(f'{base}/expenses/{contractor_row}', json={'amount': 1}).status_code == 404
    assert pat.delete(f'{base}/expenses/{contractor_row}').status_code == 404

    carl = as_('carl')
    assert carl.delete(f'{base}/expenses/{pa_row}').status_code == 404
    assert carl.put(f'{base}/expenses/{contractor_row}', json={'amount': 4200}).status_code == 200
    assert carl.delete(f'{base}/expenses/{contractor_row}').status_code == 200

    assert as_('boss').delete(f'{base}/expenses/{pa_row}').status_code == 200
