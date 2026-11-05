"""Fixes found while mapping how a claim's pages hang together (2026-11-05):

- a contractor portal link only reaches the claims its companies work;
- the WM manager link (every company's jobs) is only for those who see every company;
- the rebuild payment follow-up leaves the WM job's payment alone unless the
  carrier folded the WM cost into the rebuild;
- a PA put on a claim from the sheet mapping counts as the claim's PA;
- an outside login (contractor role, PA firm) can only message its own people
  and the office.

Run through the API on a throwaway SQLite database."""

from datetime import datetime
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.dialects.postgresql import ARRAY, INET, JSONB, UUID as PG_UUID
from sqlalchemy.ext.compiler import compiles

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory  # noqa: E402
from app.core.database_factory import Base, SQLiteDatabase  # noqa: E402
from app.domains.auth.dependencies import get_current_staff  # noqa: E402
from app.domains.claim_followup.models import FollowUpTask  # noqa: E402
from app.domains.client.models import Claim, ClaimPayment, Client  # noqa: E402
from app.domains.company.models import Company, CompanyContact  # noqa: E402
from app.domains.contract.models import ClaimCompany  # noqa: E402
from app.domains.contractor_portal.models import ContractorPortalToken  # noqa: E402
from app.domains.staff.models import Staff, StaffCompany, StaffRole  # noqa: E402
from app.domains.water_mitigation.models import WaterMitigationJob, WMSheetPAMapping  # noqa: E402
from app.main import app  # noqa: E402


@compiles(JSONB, 'sqlite')
def _jsonb(type_, compiler, **kw):
    return 'JSON'


@compiles(ARRAY, 'sqlite')
def _array(type_, compiler, **kw):
    return 'JSON'


@compiles(INET, 'sqlite')
def _inet(type_, compiler, **kw):
    return 'VARCHAR(45)'


@compiles(PG_UUID, 'sqlite')
def _uuid(type_, compiler, **kw):
    return 'VARCHAR(36)'


def make_staff(name, role=StaffRole.staff, all_companies=False):
    return Staff(
        staff_number=f'S-{name}', first_name=name, last_name='Test',
        email=f'{name.lower()}@example.com', username=name.lower(),
        role=role, hire_date=datetime(2026, 1, 1), all_companies=all_companies,
        is_active=True, can_login=True,
    )


@pytest.fixture
def env(tmp_path, monkeypatch):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(
        database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF')
    )
    # A few tables use types SQLite can't make; nothing here touches those.
    for table in Base.metadata.sorted_tables:
        try:
            table.create(database.engine, checkfirst=True)
        except Exception:
            pass
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)
    # The portal service binds get_database when first imported, which may
    # have been under an earlier test's database
    from app.domains.contractor_portal import service as portal_service
    monkeypatch.setattr(portal_service, 'get_database', lambda: database)

    session = database.get_session()
    ours = Company(name='MJ Restoration', company_type='contractor')
    plumber = Company(name='Pipe Pros', company_type='contractor')
    pa_firm = Company(name='Fair Claims PA', company_type='public_adjuster')
    for row in (ours, plumber, pa_firm):
        session.add(row)
    session.flush()

    plumber_contact = CompanyContact(company_id=plumber.id, name='Pete', email='pete@pipepros.com',
                                     is_active=True)
    pa_contact = CompanyContact(company_id=pa_firm.id, name='Angel', email='angel@fairclaims.com',
                                phone='555-0101', is_active=True)
    session.add(plumber_contact)
    session.add(pa_contact)
    session.flush()
    session.add(ContractorPortalToken(company_contact_id=plumber_contact.id, token='pete-link', is_active=True))

    staff = {
        'admin': make_staff('Admin', StaffRole.admin),
        'office': make_staff('Office', all_companies=True),
        'manager': make_staff('Manager', StaffRole.manager),
        'coworker': make_staff('Coworker'),
        'pete': make_staff('Pete', StaffRole.contractor),
        'pipe2': make_staff('Pipe2'),
        'angel': make_staff('Angel'),
        'angel2': make_staff('Angel2'),
    }
    for row in staff.values():
        session.add(row)
    session.flush()
    for name, company in (
        ('manager', ours), ('coworker', ours), ('pete', plumber), ('pipe2', plumber),
        ('angel', pa_firm), ('angel2', pa_firm),
    ):
        session.add(StaffCompany(staff_id=staff[name].id, company_id=company.id))

    def claim(number, db=None, **fields):
        db = db or session
        client = Client(display_name=f'Owner {number}', owners=[])
        db.add(client)
        db.flush()
        row = Claim(client_id=client.id, claim_number=number, status='open', **fields)
        db.add(row)
        db.flush()
        return row

    def new_claim(number, **fields):
        """A claim made and saved from a session of its own"""
        db = database.get_session()
        row = claim(number, db=db, **fields)
        claim_id = str(row.id)
        db.commit()
        db.close()
        return SimpleNamespace(id=claim_id)

    piped = claim('C-PIPED')
    session.add(ClaimCompany(claim_id=piped.id, company_id=plumber.id, role='plumber'))
    not_piped = claim('C-OTHER')
    session.add(ClaimCompany(claim_id=not_piped.id, company_id=ours.id, role='reconstruction'))
    session.commit()

    ids = SimpleNamespace(
        staff={k: str(v.id) for k, v in staff.items()},
        piped=str(piped.id), not_piped=str(not_piped.id),
        plumber=str(plumber.id), ours=str(ours.id), pa_contact=str(pa_contact.id),
    )
    people = {k: (str(v.id), v.role) for k, v in staff.items()}
    session.close()

    current = {}
    app.dependency_overrides[get_current_staff] = lambda: current['staff']

    def get_db():
        db = database.get_session()
        try:
            yield db
            db.commit()
        finally:
            db.close()
    app.dependency_overrides[database_factory.get_db_session] = get_db

    def as_(name=None):
        if name:
            staff_id, role = people[name]
            current['staff'] = SimpleNamespace(id=staff_id, role=role, username=name)
        return TestClient(app, raise_server_exceptions=True)

    yield SimpleNamespace(as_=as_, ids=ids, database=database, claim=new_claim)
    app.dependency_overrides.pop(get_current_staff, None)
    app.dependency_overrides.pop(database_factory.get_db_session, None)


# ── Contractor portal link ──────────────────────────────────

def test_a_portal_link_lists_and_pays_on_its_own_claims(env):
    api = env.as_()
    listed = api.get('/api/contractor-portal/pete-link/claims')
    assert [c['claim_id'] for c in listed.json()] == [env.ids.piped]

    paid = api.post(f'/api/contractor-portal/pete-link/claims/{env.ids.piped}/payments',
                    json={'amount': 1200, 'payment_category': 'other'})
    assert paid.status_code == 200, paid.text
    payments = api.get(f'/api/contractor-portal/pete-link/claims/{env.ids.piped}/payments')
    assert payments.status_code == 200
    assert payments.json()['grand_total'] == 1200

    session = env.database.get_session()
    [payment] = session.query(ClaimPayment).all()
    # Recorded as the link's company, which works the claim
    assert str(payment.contractor_company_id) == env.ids.plumber
    session.close()


def test_a_portal_link_cannot_reach_another_companys_claim(env):
    api = env.as_()
    other = env.ids.not_piped
    assert api.get(f'/api/contractor-portal/pete-link/claims/{other}/payments').status_code == 404
    posted = api.post(f'/api/contractor-portal/pete-link/claims/{other}/payments',
                      json={'amount': 99999, 'payment_category': 'other', 'company_id': env.ids.ours})
    assert posted.status_code == 404
    session = env.database.get_session()
    assert session.query(ClaimPayment).count() == 0
    session.close()


def test_a_portal_payment_names_the_links_company_not_the_requests(env):
    api = env.as_()
    posted = api.post(f'/api/contractor-portal/pete-link/claims/{env.ids.piped}/payments',
                      json={'amount': 10, 'payment_category': 'other', 'company_id': env.ids.ours})
    assert posted.status_code == 200
    session = env.database.get_session()
    assert str(session.query(ClaimPayment).one().contractor_company_id) == env.ids.plumber
    session.close()


def test_a_logged_in_contractor_cannot_record_a_payment_as_another_company(env):
    api = env.as_('pete')
    posted = api.post(f'/api/contractor-portal/auth/claims/{env.ids.piped}/payments',
                      json={'amount': 10, 'payment_category': 'other', 'company_id': env.ids.ours})
    assert posted.status_code == 200, posted.text
    session = env.database.get_session()
    assert session.query(ClaimPayment).one().contractor_company_id is None
    session.close()
    # And their own company is kept
    api.post(f'/api/contractor-portal/auth/claims/{env.ids.piped}/payments',
             json={'amount': 20, 'payment_category': 'other', 'company_id': env.ids.plumber})
    session = env.database.get_session()
    kept = session.query(ClaimPayment).filter(ClaimPayment.amount == 20).one()
    assert str(kept.contractor_company_id) == env.ids.plumber
    session.close()


# ── WM manager link ─────────────────────────────────────────

@pytest.mark.parametrize('name', ['admin', 'office'])
def test_those_who_see_every_company_get_the_manager_link(env, name):
    api = env.as_(name)
    got = api.get('/api/wm-payment-board/admin/token')
    assert got.status_code == 200, got.text
    assert api.post('/api/wm-payment-board/admin/token/regenerate').status_code == 200


@pytest.mark.parametrize('name', ['manager', 'pete', 'angel'])
def test_nobody_else_gets_the_manager_link(env, name):
    api = env.as_(name)
    assert api.get('/api/wm-payment-board/admin/token').status_code == 403
    assert api.post('/api/wm-payment-board/admin/token/regenerate').status_code == 403


# ── Payment follow-up → WM job ──────────────────────────────

def _payment_case(env, wm_cost_status, task_type, title):
    session = env.database.get_session()
    row = env.claim(f'C-{task_type}-{wm_cost_status}', wm_cost_status=wm_cost_status)
    session.add(WaterMitigationJob(property_address='1 Wet St', claim_id=row.id,
                                   payment_status='pending', active=True))
    session.commit()
    task = {'task_type': task_type, 'title': title, 'claim_id': str(row.id)}
    return session, row, task


def _wm_status(session, claim_id):
    # The caller of the sync commits, as the follow-up service does
    session.commit()
    session.expire_all()
    return session.query(WaterMitigationJob.payment_status).filter(
        WaterMitigationJob.claim_id == claim_id
    ).scalar()


@pytest.mark.parametrize('wm_cost_status', ['separate_estimate', 'paid_per_invoice', 'not_received', None])
def test_the_rebuild_payment_leaves_a_separately_paid_wm_job_alone(env, wm_cost_status):
    from app.domains.claim_followup.service import ClaimFollowUpService

    session, row, task = _payment_case(env, wm_cost_status, 'payment_check', 'Rebuild Payment')
    ClaimFollowUpService()._sync_payment_to_wm(session, task, {'payment_status': 'received'})
    assert _wm_status(session, row.id) == 'pending'
    session.close()


def test_the_rebuild_payment_pays_a_wm_job_folded_into_the_rebuild(env):
    from app.domains.claim_followup.service import ClaimFollowUpService

    session, row, task = _payment_case(env, 'included_in_rebuild', 'payment_check', 'Rebuild Payment')
    ClaimFollowUpService()._sync_payment_to_wm(session, task, {'payment_status': 'received'})
    assert _wm_status(session, row.id) == 'received'
    session.close()


@pytest.mark.parametrize('task_type,title', [
    ('wm_payment_check', 'WM Payment'),
    # Made before wm_payment_check existed
    ('payment_check', 'Follow up: WM costs not included in estimate'),
])
def test_a_wm_payment_follow_up_still_updates_the_wm_job(env, task_type, title):
    from app.domains.claim_followup.service import ClaimFollowUpService

    session, row, task = _payment_case(env, 'separate_estimate', task_type, title)
    ClaimFollowUpService()._sync_payment_to_wm(session, task, {'payment_status': 'issued'})
    assert _wm_status(session, row.id) == 'issued'
    session.close()


# ── PA from the sheet mapping ───────────────────────────────

def _sheet_job(env, session, claim_row, sheet='Angel'):
    job = WaterMitigationJob(property_address='9 Tab St', claim_id=claim_row.id,
                             google_sheet_name=sheet, active=True)
    session.add(job)
    session.add(WMSheetPAMapping(sheet_name=sheet, pa_contact_id=env.ids.pa_contact))
    session.commit()
    return job


def _sync_service(session):
    from app.domains.integrations.google_sheets.sync_service import GoogleSheetsSyncService

    service = object.__new__(GoogleSheetsSyncService)
    service.db = session
    return service


def test_a_pa_from_the_sheet_counts_as_the_claims_pa(env):
    session = env.database.get_session()
    row = env.claim('C-SHEET', pa_fee_percentage=10, current_rcv=10000)
    job = _sheet_job(env, session, row)
    _sync_service(session)._apply_pa_mapping(job)

    session.expire_all()
    claim = session.query(Claim).filter(Claim.id == row.id).one()
    assert claim.pa_contact_id == env.ids.pa_contact
    assert claim.has_public_adjuster is True
    assert (claim.pa_name, claim.pa_email, claim.pa_phone, claim.pa_company) == (
        'Angel', 'angel@fairclaims.com', '555-0101', 'Fair Claims PA')
    session.close()


def test_a_claim_linked_by_an_earlier_sync_gets_its_pa_filled_in(env):
    session = env.database.get_session()
    row = env.claim('C-OLD', pa_contact_id=env.ids.pa_contact, has_public_adjuster=False,
                    pa_email='typed@by.hand')
    job = _sheet_job(env, session, row)
    _sync_service(session)._apply_pa_mapping(job)

    session.expire_all()
    claim = session.query(Claim).filter(Claim.id == row.id).one()
    assert claim.has_public_adjuster is True
    assert claim.pa_name == 'Angel'
    # A field already filled stays as it was
    assert claim.pa_email == 'typed@by.hand'
    session.close()


def test_a_pa_picked_by_hand_still_wins_over_the_sheet(env):
    session = env.database.get_session()
    other = CompanyContact(company_id=env.ids.plumber, name='Someone Else')
    session.add(other)
    session.flush()
    row = env.claim('C-HAND', pa_contact_id=str(other.id), has_public_adjuster=True, pa_name='Someone Else')
    job = _sheet_job(env, session, row)
    _sync_service(session)._apply_pa_mapping(job)

    session.expire_all()
    claim = session.query(Claim).filter(Claim.id == row.id).one()
    assert claim.pa_contact_id == str(other.id)
    assert claim.pa_name == 'Someone Else'
    session.close()


def test_applying_the_mappings_fills_the_pa_and_replacing_one_rewrites_it(env):
    from app.domains.water_mitigation.api import apply_sheet_pa_mappings

    session = env.database.get_session()
    other = CompanyContact(company_id=env.ids.plumber, name='Old PA', email='old@pa.com')
    session.add(other)
    session.flush()
    fresh = env.claim('C-FRESH')
    stale = env.claim('C-STALE', pa_contact_id=env.ids.pa_contact, has_public_adjuster=False)
    replaced = env.claim('C-REPLACED', pa_contact_id=str(other.id), has_public_adjuster=True,
                         pa_name='Old PA', pa_email='old@pa.com')
    for i, row in enumerate((fresh, stale, replaced)):
        session.add(WaterMitigationJob(property_address=f'{i} Tab St', claim_id=row.id,
                                       google_sheet_name='Angel', active=True))
    session.add(WMSheetPAMapping(sheet_name='Angel', pa_contact_id=env.ids.pa_contact))
    session.commit()

    kept = apply_sheet_pa_mappings(overwrite_existing=False, db=session)
    assert (kept['applied'], kept['kept_existing']) == (2, 1)
    session.expire_all()
    for row in (fresh, stale):
        claim = session.query(Claim).filter(Claim.id == row.id).one()
        assert (claim.has_public_adjuster, claim.pa_name) == (True, 'Angel')
    assert session.query(Claim).filter(Claim.id == replaced.id).one().pa_name == 'Old PA'

    apply_sheet_pa_mappings(overwrite_existing=True, db=session)
    session.expire_all()
    claim = session.query(Claim).filter(Claim.id == replaced.id).one()
    # The old PA's details went with the old PA
    assert (claim.pa_contact_id, claim.pa_name, claim.pa_email) == (
        env.ids.pa_contact, 'Angel', 'angel@fairclaims.com')
    session.close()


# ── Messaging ───────────────────────────────────────────────

def _names(response):
    assert response.status_code == 200, response.text
    return {p['name'].split(' ')[0] for p in response.json()}


def test_our_own_staff_can_message_everyone(env):
    everyone = {'Admin', 'Office', 'Manager', 'Coworker', 'Pete', 'Pipe2', 'Angel', 'Angel2'}
    assert _names(env.as_('manager').get('/api/messages/people')) == everyone
    assert _names(env.as_('admin').get('/api/messages/people')) == everyone


@pytest.mark.parametrize('name,own', [('pete', {'Pete', 'Pipe2'}), ('angel', {'Angel', 'Angel2'})])
def test_an_outside_login_sees_its_own_people_and_the_office(env, name, own):
    assert _names(env.as_(name).get('/api/messages/people')) == own | {'Admin', 'Office'}


def test_an_outside_login_cannot_message_someone_it_cant_see(env):
    api = env.as_('angel')
    refused = api.post('/api/messages/conversations', json={'participant_ids': [env.ids.staff['manager']]})
    assert refused.status_code == 400
    allowed = api.post('/api/messages/conversations', json={'participant_ids': [env.ids.staff['admin']]})
    assert allowed.status_code == 200, allowed.text
