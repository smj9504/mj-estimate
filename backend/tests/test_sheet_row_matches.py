"""What comes off the Google Sheet and what staff enter by hand stay apart unless someone
says they are the same. Runs the real sync and API on a throwaway SQLite database, with
no sheet behind it: rows are handed straight to the sync."""

import asyncio
from datetime import datetime
from pathlib import Path
import sqlite3
import sys
from types import SimpleNamespace
import uuid

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.dialects.postgresql import ARRAY, INET, JSONB, UUID as PG_UUID
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.database_factory import Base, get_db  # noqa: E402
from app.domains.auth import company_scope, screen_access  # noqa: E402
from app.domains.auth.dependencies import auth_service, get_current_staff  # noqa: E402
from app.domains.client.client_sync_service import (  # noqa: E402
    SHEET_SOURCE, mark_sheet_clients, sync_client_from_wm_job,
)
from app.domains.client.models import Claim, Client  # noqa: E402
from app.domains.company.models import Company  # noqa: E402
from app.domains.integrations.google_sheets.sync_service import GoogleSheetsSyncService  # noqa: E402
from app.domains.staff.models import Staff, StaffRole  # noqa: E402
from app.domains.water_mitigation.models import WaterMitigationJob, WMSheetRowMatch  # noqa: E402
from app.main import app  # noqa: E402

sqlite3.register_adapter(uuid.UUID, str)


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


SHEET = 'Angel'
ADDRESS = '100 Example St, Springfield, VA 22152'
ROW_MATCHES = '/api/integrations/google-sheets/row-matches'


def angel_row(address=ADDRESS, name='Sheet Homeowner', phone='', email='', claim='', insurance=''):
    """Laid out the way the Angel tab is, with the people made up"""
    return [address, '', '', claim, name, phone, email, insurance]


@pytest.fixture
def db():
    engine = sa.create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
    sa.event.listen(
        engine, 'connect',
        lambda conn, _: conn.create_function('gen_random_uuid', 0, lambda: str(uuid.uuid4())),
    )
    with engine.connect() as connection:
        # A few tables use types SQLite can't make; nothing here touches those
        for table in Base.metadata.sorted_tables:
            try:
                table.create(connection, checkfirst=True)
            except Exception:
                pass
        connection.commit()
    with Session(engine) as session:
        yield session
    engine.dispose()


@pytest.fixture
def sync(db):
    return GoogleSheetsSyncService(db, 'test-sheet')


@pytest.fixture
def admin(db):
    """A real row: Postgres holds decided_by_id to it, though SQLite here wouldn't"""
    staff = Staff(
        staff_number='T-1', first_name='Test', last_name='Admin', email='admin@example.com',
        role=StaffRole.admin, hire_date=datetime(2026, 1, 1), username='test-admin',
    )
    db.add(staff)
    db.commit()
    return staff


@pytest.fixture
def api(db, admin):
    def use_db():
        yield db

    app.dependency_overrides[get_db] = use_db
    app.dependency_overrides[get_current_staff] = lambda: SimpleNamespace(id=admin.id, role=StaffRole.admin)
    yield TestClient(app)
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_staff, None)


def manual_job(db, address=ADDRESS, name='Hand Entered', **values):
    """A job the way POST /jobs makes one: entered by someone, then synced to a client"""
    job = WaterMitigationJob(property_address=address, homeowner_name=name, **values)
    db.add(job)
    db.commit()
    sync_client_from_wm_job(db, job)
    return job


def manual_client(db, address='100 Example St', name='Hand Entered', **values):
    client = Client(display_name=name, owners=[], address=address, city='Springfield', state='VA', **values)
    db.add(client)
    db.commit()
    return client


def jobs_on_row(db, row_number=5):
    return db.query(WaterMitigationJob).filter(
        WaterMitigationJob.google_sheet_row_number == row_number,
        WaterMitigationJob.google_sheet_name == SHEET,
    ).all()


def only_pending(db):
    return db.query(WMSheetRowMatch).filter(WMSheetRowMatch.status == 'pending').one()


def resolve(api, match, **body):
    response = api.post(f'{ROW_MATCHES}/{match.id}/resolve', json=body)
    assert response.status_code == 200, response.text
    return response.json()


# Without anything entered by hand, nothing changes

def test_a_new_row_with_nothing_at_its_address_makes_a_job_and_a_sheet_client(db, sync):
    result = sync._process_row(angel_row(claim='CL-1'), 5, SHEET)

    assert result['created']
    client = db.query(Client).one()
    assert client.source == SHEET_SOURCE
    assert db.query(Claim).one().client_id == client.id
    assert result['job'].claim_id == db.query(Claim).one().id
    assert db.query(WMSheetRowMatch).count() == 0


def test_a_later_sync_of_that_row_keeps_its_job_and_client(db, sync):
    first = sync._process_row(angel_row(), 5, SHEET)['job']
    again = sync._process_row(angel_row(phone='555-010-0100'), 5, SHEET)

    assert again['updated'] and again['job'].id == first.id
    assert again['job'].homeowner_phone == '555-010-0100'
    assert db.query(Client).count() == 1


# A row at the address of something entered by hand waits

def test_a_row_at_a_manual_jobs_address_waits_and_changes_nothing(db, sync):
    job = manual_job(db, homeowner_phone='555-010-0199')

    result = sync._process_row(angel_row(), 5, SHEET)

    assert result == {'job': None, 'created': False, 'updated': False, 'needs_review': True}
    db.refresh(job)
    assert job.google_sheet_row_number is None
    assert job.homeowner_name == 'Hand Entered'
    assert job.homeowner_phone == '555-010-0199'
    assert db.query(WaterMitigationJob).count() == 1
    assert db.query(Client).count() == 1
    assert only_pending(db).address == ADDRESS


def test_a_row_at_a_manual_clients_address_waits(db, sync):
    manual_client(db)
    assert sync._process_row(angel_row(), 5, SHEET)['needs_review']
    assert db.query(WaterMitigationJob).count() == 0


def test_the_next_sync_refreshes_the_waiting_row_instead_of_asking_twice(db, sync):
    manual_job(db)
    sync._process_row(angel_row(), 5, SHEET)
    sync._process_row(angel_row(claim='CL-9'), 5, SHEET)

    assert only_pending(db).row_data['claim_number'] == 'CL-9'


def test_a_row_stops_waiting_when_what_it_matched_is_gone(db, sync):
    job = manual_job(db)
    client = db.query(Client).one()
    sync._process_row(angel_row(), 5, SHEET)

    job.active = False
    client.is_active = False
    db.commit()
    result = sync._process_row(angel_row(), 5, SHEET)

    assert result['created']
    assert db.query(WMSheetRowMatch).one().status == 'closed'


def test_an_emptied_row_stops_waiting(db, sync):
    manual_job(db)
    sync._process_row(angel_row(), 5, SHEET)
    assert sync._process_row(angel_row(address=''), 5, SHEET) is None
    assert db.query(WMSheetRowMatch).one().status == 'closed'


def test_an_inactive_manual_job_is_not_asked_about(db, sync):
    job = manual_job(db)
    job.active = False
    db.query(Client).delete()
    db.commit()
    assert sync._process_row(angel_row(), 5, SHEET)['created']


# Someone says they are the same

def test_same_as_a_job_links_the_row_and_keeps_what_the_sheet_leaves_empty(db, sync, api):
    job = manual_job(db, homeowner_phone='555-010-0199', insurance_company='Hand Insurance', status='Follow up')
    sync._process_row(angel_row(claim='CL-1'), 5, SHEET)
    match = only_pending(db)
    client_before = db.query(Client).one()

    result = resolve(api, match, decision='same', candidate_type='job', candidate_id=str(job.id))

    db.refresh(job)
    assert result == {'status': 'same', 'job_id': str(job.id)}
    assert (job.google_sheet_row_number, job.google_sheet_name) == (5, SHEET)
    assert job.claim_number == 'CL-1'
    assert job.homeowner_name == 'Sheet Homeowner'
    assert job.homeowner_phone == '555-010-0199'
    assert job.insurance_company == 'Hand Insurance'
    assert job.status == 'Follow up'
    # Still the one client, still the one entered by hand, now with the job's claim
    assert db.query(WaterMitigationJob).count() == 1
    client = db.query(Client).one()
    assert client.id == client_before.id and client.source is None
    assert client.display_name == 'Hand Entered'
    assert db.query(Claim).one().client_id == client.id
    assert job.claim_id == db.query(Claim).one().id


def test_a_mapped_job_stays_with_its_row_and_client_on_later_syncs(db, sync, api):
    job = manual_job(db, homeowner_phone='555-010-0199')
    sync._process_row(angel_row(), 5, SHEET)
    resolve(api, only_pending(db), decision='same', candidate_type='job', candidate_id=str(job.id))

    again = sync._process_row(angel_row(name='Renamed In Sheet', claim='CL-2'), 5, SHEET)

    db.refresh(job)
    assert again['updated'] and again['job'].id == job.id
    assert job.homeowner_name == 'Renamed In Sheet'
    assert job.homeowner_phone == '555-010-0199'
    assert db.query(Client).count() == 1
    assert db.query(Claim).one().client_id == db.query(Client).one().id
    assert db.query(WMSheetRowMatch).filter(WMSheetRowMatch.status == 'pending').count() == 0


def test_emptying_a_mapped_row_unlinks_the_job_with_its_data_intact(db, sync, api):
    job = manual_job(db, homeowner_phone='555-010-0199')
    sync._process_row(angel_row(), 5, SHEET)
    resolve(api, only_pending(db), decision='same', candidate_type='job', candidate_id=str(job.id))

    result = sync._process_row(angel_row(address=''), 5, SHEET)

    db.refresh(job)
    assert result['off_sheet']
    assert job.google_sheet_row_number is None and job.google_sheet_name is None
    assert job.property_address == ADDRESS and job.homeowner_phone == '555-010-0199'
    assert db.query(WMSheetRowMatch).one().status == 'unlinked'


def test_a_mapped_job_does_not_take_another_propertys_row_when_rows_move(db, sync, api):
    job = manual_job(db, homeowner_phone='555-010-0199')
    sync._process_row(angel_row(), 5, SHEET)
    resolve(api, only_pending(db), decision='same', candidate_type='job', candidate_id=str(job.id))

    result = sync._process_row(angel_row(address='900 Other Ave, Reston, VA 20190', name='Someone Else'), 5, SHEET)

    db.refresh(job)
    assert result['created'] and result['job'].id != job.id
    assert job.property_address == ADDRESS and job.homeowner_name == 'Sheet Homeowner'
    assert job.google_sheet_row_number is None


def test_same_as_a_client_makes_the_row_that_clients_job(db, sync, api):
    company = Company(name='WM Co')
    db.add(company)
    db.commit()
    client = manual_client(db, phone='555-010-0199', company_id=company.id)
    sync._process_row(angel_row(claim='CL-1', phone='555-010-0100', insurance='Sheet Insurance'), 5, SHEET)

    result = resolve(api, only_pending(db), decision='same', candidate_type='client', candidate_id=str(client.id))

    db.refresh(client)
    job = jobs_on_row(db)[0]
    assert result['job_id'] == str(job.id)
    assert job.company_id == company.id
    assert db.query(Client).count() == 1
    assert db.query(Claim).one().client_id == client.id
    # The client's own values stay; only what was blank is filled
    assert client.display_name == 'Hand Entered' and client.phone == '555-010-0199' and client.source is None
    assert client.insurance_company == 'Sheet Insurance'


def test_same_as_a_client_holds_for_a_job_with_no_claim_or_matching_name(db, sync, api):
    client = manual_client(db)
    sync._process_row(angel_row(name='Totally Different Name'), 5, SHEET)
    resolve(api, only_pending(db), decision='same', candidate_type='client', candidate_id=str(client.id))

    sync._process_row(angel_row(name='Totally Different Name', claim='CL-1'), 5, SHEET)

    assert db.query(Client).count() == 1
    assert db.query(Claim).one().client_id == client.id


# Someone says they are different

def test_different_makes_its_own_job_and_client_and_leaves_the_manual_ones_alone(db, sync, api):
    job = manual_job(db, homeowner_phone='555-010-0199')
    hand_client = db.query(Client).one()
    sync._process_row(angel_row(phone='555-010-0199', claim='CL-1'), 5, SHEET)

    result = resolve(api, only_pending(db), decision='different')

    db.refresh(job)
    sheet_job = jobs_on_row(db)[0]
    assert result == {'status': 'different', 'job_id': str(sheet_job.id)}
    assert sheet_job.id != job.id
    assert job.google_sheet_row_number is None and job.homeowner_name == 'Hand Entered' and job.claim_id is None

    sheet_client = db.query(Client).filter(Client.id != hand_client.id).one()
    assert sheet_client.source == SHEET_SOURCE and sheet_client.display_name == 'Sheet Homeowner'
    assert db.query(Claim).one().client_id == sheet_client.id
    db.refresh(hand_client)
    assert hand_client.source is None and hand_client.display_name == 'Hand Entered'


def test_a_decision_records_who_made_it(db, sync, api, admin):
    manual_job(db)
    sync._process_row(angel_row(), 5, SHEET)
    match = only_pending(db)
    resolve(api, match, decision='different')

    db.refresh(match)
    assert match.decided_by_id == admin.id and match.decided_at is not None


def test_a_row_decided_different_is_not_asked_about_again(db, sync, api):
    manual_job(db)
    sync._process_row(angel_row(), 5, SHEET)
    resolve(api, only_pending(db), decision='different')

    assert sync._process_row(angel_row(), 5, SHEET)['updated']
    assert db.query(WMSheetRowMatch).filter(WMSheetRowMatch.status == 'pending').count() == 0


# Sheet clients and clients entered by hand don't find each other on their own

@pytest.mark.parametrize('values', [
    {'name': 'Same Name'},
    {'name': 'One Person', 'phone': '555-010-0123'},
    {'name': 'One Person', 'email': 'same@example.com'},
])
def test_a_sheet_row_elsewhere_does_not_merge_into_a_manual_client(db, sync, values):
    hand = manual_client(
        db, address='12 Elsewhere Rd', name='Same Name', phone='555-010-0123', email='same@example.com',
    )
    result = sync._process_row(angel_row(**values), 5, SHEET)

    assert result['created']
    assert db.query(Client).count() == 2
    db.refresh(hand)
    assert hand.source is None and hand.display_name == 'Same Name'


def test_a_sheet_row_with_a_manual_claims_number_gets_its_own_claim(db, sync):
    hand = manual_client(db, address='12 Elsewhere Rd')
    db.add(Claim(client_id=hand.id, claim_number='CL-7'))
    db.commit()

    job = sync._process_row(angel_row(claim='CL-7'), 5, SHEET)['job']

    assert db.query(Claim).count() == 2
    assert db.query(Claim).filter(Claim.id == job.claim_id).one().client_id != hand.id


def test_a_manual_job_does_not_merge_into_a_sheet_client(db, sync):
    sync._process_row(angel_row(name='Same Name', phone='555-010-0123', claim='CL-3'), 5, SHEET)

    job = manual_job(
        db, address='12 Elsewhere Rd', name='Same Name', homeowner_phone='555-010-0123', claim_number='CL-3',
    )

    assert db.query(Client).count() == 2
    hand = db.query(Client).filter(Client.source.is_(None)).one()
    assert db.query(Claim).filter(Claim.id == job.claim_id).one().client_id == hand.id


def test_sheet_rows_still_share_a_sheet_client(db, sync):
    sync._process_row(angel_row(name='Same Name', claim='CL-1'), 5, SHEET)
    sync._process_row(angel_row(name='Same Name', claim='CL-2'), 6, SHEET)
    assert db.query(Client).count() == 1
    assert db.query(Claim).count() == 2


# Clients the sync made before it recorded that

def old_client(db, name, created, address='1 Old St'):
    client = Client(display_name=name, owners=[], address=address, created_at=created)
    db.add(client)
    db.commit()
    return client


def old_sheet_job(db, row, created, name=None, address='1 Old St', client=None, number=None):
    claim = None
    if client:
        claim = Claim(client_id=client.id, claim_number=number or f'OLD-{row}')
        db.add(claim)
        db.flush()
    job = WaterMitigationJob(
        property_address=address, homeowner_name=name, google_sheet_row_number=row, google_sheet_name=SHEET,
        claim_id=claim.id if claim else None, created_at=created,
    )
    db.add(job)
    db.commit()
    return job


EARLIER, THEN, LATER = datetime(2026, 1, 1), datetime(2026, 2, 1), datetime(2026, 3, 1)


def test_clients_the_sync_made_earlier_are_told_from_ones_entered_by_hand(db):
    made_by_sheet = old_client(db, 'Made By Sheet', LATER)
    old_sheet_job(db, 2, THEN, client=made_by_sheet)
    entered_first = old_client(db, 'Entered First', EARLIER)
    old_sheet_job(db, 3, THEN, client=entered_first)
    two_rows = old_client(db, 'Two Rows', LATER)
    old_sheet_job(db, 4, THEN, client=two_rows)
    old_sheet_job(db, 5, datetime(2026, 4, 1), client=two_rows)
    no_claim = old_client(db, 'No Claim', LATER)
    old_sheet_job(db, 6, THEN, name=' no claim ')
    same_name_elsewhere = old_client(db, 'Hand Only', EARLIER, address='9 Other St')
    manual_only = old_client(db, 'Manual Only', LATER)
    job_no_row = WaterMitigationJob(property_address='1 Old St', homeowner_name='Manual Only', created_at=THEN)
    db.add(job_no_row)
    archive = old_client(db, 'Archive', LATER)
    archive.source = 'acculynx'
    old_sheet_job(db, 7, THEN, client=archive)

    mark_sheet_clients(db)

    for client in (made_by_sheet, two_rows, no_claim):
        db.refresh(client)
        assert client.source == SHEET_SOURCE, client.display_name
    for client in (entered_first, same_name_elsewhere, manual_only):
        db.refresh(client)
        assert client.source is None, client.display_name
    db.refresh(archive)
    assert archive.source == 'acculynx'


def test_marking_leaves_a_client_someone_linked_a_row_to(db, sync, api):
    job = manual_job(db)
    client = db.query(Client).one()
    sync._process_row(angel_row(claim='CL-1'), 5, SHEET)
    resolve(api, only_pending(db), decision='same', candidate_type='job', candidate_id=str(job.id))

    mark_sheet_clients(db)

    db.refresh(client)
    assert client.source is None


def test_marking_only_runs_until_a_client_is_marked(db):
    old_sheet_job(db, 2, THEN, client=old_client(db, 'Made By Sheet', LATER))
    mark_sheet_clients(db)
    later_one = old_client(db, 'Would Match', LATER)
    old_sheet_job(db, 3, THEN, client=later_one)

    mark_sheet_clients(db)

    db.refresh(later_one)
    assert later_one.source is None


def test_the_first_sync_marks_old_clients_before_it_reads_any_row(db, sync):
    # With no claim, the job finds its client by its details on every sync. Unmarked,
    # the client would look entered by hand and the job would get a second one.
    client = old_client(db, 'Sheet Homeowner', LATER, address=ADDRESS)
    old_sheet_job(db, 2, THEN, name='Sheet Homeowner', address=ADDRESS)

    async def rows(range_name):
        return [['header'], angel_row()]

    sync.client.get_sheet_values = rows
    stats = asyncio.run(sync.sync_all_rows(SHEET))

    assert stats['updated'] == 1 and stats['needs_review'] == 0
    assert db.query(Client).count() == 1
    db.refresh(client)
    assert client.source == SHEET_SOURCE


def test_a_full_sync_counts_rows_waiting_on_a_decision(db, sync):
    manual_job(db)

    async def rows(range_name):
        return [['header'], angel_row(), angel_row(address='900 Other Ave, Reston, VA 20190')]

    sync.client.get_sheet_values = rows
    stats = asyncio.run(sync.sync_all_rows(SHEET))

    assert (stats['status'], stats['needs_review'], stats['created'], stats['failed']) == ('success', 1, 1, 0)


# Leads CompanyCam made aren't anything someone entered

def test_a_row_fills_in_a_companycam_lead_without_asking(db, sync):
    lead = WaterMitigationJob(property_address=ADDRESS, homeowner_name='Project name', companycam_project_id='cc-1')
    db.add(lead)
    db.commit()

    result = sync._process_row(angel_row(), 5, SHEET)

    assert result['updated'] and result['job'].id == lead.id
    assert db.query(WMSheetRowMatch).count() == 0


def test_a_job_with_a_companycam_project_that_someone_filled_in_is_asked_about(db, sync):
    manual_job(db, companycam_project_id='cc-1', homeowner_phone='555-010-0199')
    assert sync._process_row(angel_row(), 5, SHEET)['needs_review']


def test_a_decision_on_a_client_still_uses_the_lead_at_that_address(db, sync, api):
    lead = WaterMitigationJob(property_address=ADDRESS, homeowner_name='Project name', companycam_project_id='cc-1')
    db.add(lead)
    db.commit()
    client = manual_client(db)
    sync._process_row(angel_row(), 5, SHEET)

    result = resolve(api, only_pending(db), decision='same', candidate_type='client', candidate_id=str(client.id))

    assert result['job_id'] == str(lead.id)
    assert db.query(WaterMitigationJob).count() == 1


# Rows that move: inserting, deleting or sorting moves everything below

ANN = {'address': '1 Alpha St, Reston, VA 20190', 'name': 'Ann Able', 'claim': 'C-ANN', 'phone': '555-010-0001'}
BOB = {'address': '2 Beta St, Reston, VA 20190', 'name': 'Bob Best', 'claim': 'C-BOB', 'phone': '555-010-0002'}
CAM = {'address': '3 Gamma St, Reston, VA 20190', 'name': 'Cam Cole', 'claim': 'C-CAM', 'phone': '555-010-0003'}
NIA = {'address': '9 New St, Reston, VA 20190', 'name': 'Nia Noor', 'claim': 'C-NIA', 'phone': '555-010-0009'}


def sync_tab(sync, *people):
    """A full sync of a tab holding these rows, top to bottom, starting at row 2"""
    async def read(range_name):
        return [['header']] + [angel_row(**person) if person else [] for person in people]

    sync.client.get_sheet_values = read
    return asyncio.run(sync.sync_all_rows(SHEET))


def job_named(db, name):
    return db.query(WaterMitigationJob).filter(WaterMitigationJob.homeowner_name == name).one()


def assert_intact(job, person, row):
    assert job.property_address == person['address']
    assert job.homeowner_name == person['name']
    assert job.claim_number == person['claim']
    assert job.homeowner_phone == person['phone']
    assert job.google_sheet_row_number == row


def test_a_row_inserted_above_leaves_every_job_with_its_own_values(db, sync):
    sync_tab(sync, ANN, BOB, CAM)
    ids = {name: job_named(db, name).id for name in ('Ann Able', 'Bob Best', 'Cam Cole')}

    stats = sync_tab(sync, NIA, ANN, BOB, CAM)

    assert (stats['moved'], stats['created'], stats['off_sheet'], stats['failed']) == (3, 1, 0, 0)
    assert_intact(job_named(db, 'Ann Able'), ANN, 3)
    assert_intact(job_named(db, 'Bob Best'), BOB, 4)
    assert_intact(job_named(db, 'Cam Cole'), CAM, 5)
    assert_intact(job_named(db, 'Nia Noor'), NIA, 2)
    assert {name: job_named(db, name).id for name in ids} == ids
    assert db.query(Client).count() == 4


def test_a_deleted_row_moves_the_rest_up_and_its_job_keeps_everything(db, sync):
    sync_tab(sync, ANN, BOB, CAM)
    job = job_named(db, 'Bob Best')
    job.invoice_amount = 1234
    job.payment_note = 'Waiting on the check'
    job.status = 'Follow up'
    db.commit()

    stats = sync_tab(sync, ANN, CAM)

    db.refresh(job)
    assert (stats['moved'], stats['off_sheet'], stats['created'], stats['failed']) == (1, 1, 0, 0)
    assert_intact(job_named(db, 'Ann Able'), ANN, 2)
    assert_intact(job_named(db, 'Cam Cole'), CAM, 3)
    assert_intact(job, BOB, None)
    assert job.google_sheet_name == SHEET and job.active
    assert job.invoice_amount == 1234 and job.payment_note == 'Waiting on the check' and job.status == 'Follow up'


def test_deleting_the_last_row_keeps_its_job_and_a_new_last_row_is_its_own_job(db, sync):
    sync_tab(sync, ANN, BOB)
    bob = job_named(db, 'Bob Best')

    assert sync_tab(sync, ANN)['off_sheet'] == 1
    sync_tab(sync, ANN, NIA)

    db.refresh(bob)
    assert_intact(bob, BOB, None)
    assert_intact(job_named(db, 'Nia Noor'), NIA, 3)


def test_sorting_a_tab_changes_nothing_but_the_row_numbers(db, sync):
    sync_tab(sync, ANN, BOB, CAM)
    stats = sync_tab(sync, CAM, BOB, ANN)

    assert (stats['moved'], stats['created'], stats['off_sheet']) == (2, 0, 0)
    assert_intact(job_named(db, 'Cam Cole'), CAM, 2)
    assert_intact(job_named(db, 'Bob Best'), BOB, 3)
    assert_intact(job_named(db, 'Ann Able'), ANN, 4)


def test_a_row_typed_over_with_someone_else_is_a_new_job(db, sync):
    sync_tab(sync, ANN, BOB, CAM)
    stats = sync_tab(sync, ANN, NIA, CAM)

    assert (stats['moved'], stats['off_sheet'], stats['created']) == (0, 1, 1)
    assert_intact(job_named(db, 'Bob Best'), BOB, None)
    assert_intact(job_named(db, 'Nia Noor'), NIA, 3)


def test_rows_deleted_and_inserted_in_the_same_sync(db, sync):
    sync_tab(sync, ANN, BOB, CAM)
    stats = sync_tab(sync, NIA, CAM, ANN)

    assert (stats['moved'], stats['off_sheet'], stats['created']) == (2, 1, 1)
    assert_intact(job_named(db, 'Nia Noor'), NIA, 2)
    assert_intact(job_named(db, 'Cam Cole'), CAM, 3)
    assert_intact(job_named(db, 'Ann Able'), ANN, 4)
    assert_intact(job_named(db, 'Bob Best'), BOB, None)


def test_a_sync_with_no_changes_moves_nothing(db, sync):
    sync_tab(sync, ANN, BOB, CAM)
    stats = sync_tab(sync, ANN, BOB, CAM)
    assert (stats['moved'], stats['off_sheet'], stats['created'], stats['updated']) == (0, 0, 0, 3)


@pytest.mark.parametrize('edit', [
    {'address': '1 Alpha Street, Reston VA 20190'},                 # written differently
    {'address': '11 Alpha St, Reston, VA 20190'},                   # corrected, same homeowner
    {'claim': 'C-ANN-FIXED'},
    {'name': 'Ann B. Able'},
])
def test_a_row_edited_where_it_stands_stays_the_same_job(db, sync, edit):
    sync_tab(sync, ANN, BOB)
    job = job_named(db, 'Ann Able')

    stats = sync_tab(sync, {**ANN, **edit}, BOB)

    db.refresh(job)
    assert (stats['moved'], stats['off_sheet'], stats['created']) == (0, 0, 0)
    assert job.google_sheet_row_number == 2
    assert job.property_address == edit.get('address', ANN['address'])
    assert job.claim_number == edit.get('claim', ANN['claim'])
    assert job.homeowner_name == edit.get('name', ANN['name'])


def test_two_claims_at_one_address_keep_their_own_jobs_when_rows_move(db, sync):
    first = {**ANN, 'claim': 'C-1'}
    second = {**ANN, 'claim': 'C-2'}
    sync_tab(sync, first, second)
    jobs = {job.claim_number: job.id for job in db.query(WaterMitigationJob).all()}

    sync_tab(sync, NIA, first, second)
    assert {
        job.claim_number: job.id for job in db.query(WaterMitigationJob).filter(
            WaterMitigationJob.claim_number.in_(['C-1', 'C-2'])
        ).all()
    } == jobs

    # The first of them deleted: the second must not be taken for it, though it now
    # sits on the row the first was on
    stats = sync_tab(sync, NIA, second)
    assert stats['off_sheet'] == 1
    first_job = db.query(WaterMitigationJob).filter(WaterMitigationJob.id == jobs['C-1']).one()
    second_job = db.query(WaterMitigationJob).filter(WaterMitigationJob.id == jobs['C-2']).one()
    assert (first_job.claim_number, first_job.google_sheet_row_number) == ('C-1', None)
    assert (second_job.claim_number, second_job.google_sheet_row_number) == ('C-2', 3)


def test_two_homeowners_at_one_address_with_no_claims_keep_their_own_jobs(db, sync):
    first = {'address': ANN['address'], 'name': 'First Person'}
    second = {'address': ANN['address'], 'name': 'Second Person'}
    sync_tab(sync, first, second)
    # A second Lead at the address waits until someone says it's another homeowner
    sync.keep_row_separate(only_pending(db), None)
    second_id = job_named(db, 'Second Person').id

    stats = sync_tab(sync, second)

    assert stats['off_sheet'] == 1
    assert job_named(db, 'Second Person').id == second_id
    assert job_named(db, 'Second Person').google_sheet_row_number == 2
    assert job_named(db, 'First Person').google_sheet_row_number is None


def test_apartments_in_one_building_are_not_taken_for_each_other(db, sync):
    one = {'address': '100 Main St Apt 1, Fairfax, VA 22030', 'name': 'Apt One'}
    two = {'address': '100 Main St Apt 2, Fairfax, VA 22030', 'name': 'Apt Two'}
    sync_tab(sync, one, two)
    ids = (job_named(db, 'Apt One').id, job_named(db, 'Apt Two').id)

    stats = sync_tab(sync, two, one)

    assert stats['moved'] == 2
    assert (job_named(db, 'Apt One').id, job_named(db, 'Apt Two').id) == ids
    assert job_named(db, 'Apt Two').google_sheet_row_number == 2
    assert job_named(db, 'Apt One').property_address == one['address']


def test_a_job_off_the_sheet_returns_when_its_row_does(db, sync):
    sync_tab(sync, ANN, BOB, CAM)
    bob = job_named(db, 'Bob Best')
    clients = db.query(Client).count()
    sync_tab(sync, ANN, CAM)

    stats = sync_tab(sync, ANN, CAM, BOB)

    db.refresh(bob)
    assert (stats['moved'], stats['created'], stats['needs_review']) == (1, 0, 0)
    assert_intact(bob, BOB, 4)
    assert db.query(Client).count() == clients


def test_a_new_claim_at_a_gone_jobs_address_asks_instead_of_taking_it_over(db, sync):
    sync_tab(sync, ANN, BOB)
    bob = job_named(db, 'Bob Best')
    sync_tab(sync, ANN)

    stats = sync_tab(sync, ANN, {**BOB, 'claim': 'C-BOB-2'})

    db.refresh(bob)
    assert stats['needs_review'] == 1 and stats['created'] == 0
    assert_intact(bob, BOB, None)


def test_a_job_off_the_sheet_keeps_its_sheet_client(db, sync):
    no_claim = {'address': BOB['address'], 'name': BOB['name']}
    sync_tab(sync, ANN, no_claim)
    job = job_named(db, 'Bob Best')
    sync_tab(sync, ANN)
    clients = db.query(Client).count()

    sync_client_from_wm_job(db, job)

    assert db.query(Client).count() == clients


def test_an_inactive_job_follows_its_row_and_the_row_after_it_still_becomes_a_job(db, sync):
    sync_tab(sync, ANN, BOB)
    ann = job_named(db, 'Ann Able')
    ann.active = False
    db.commit()

    stats = sync_tab(sync, NIA, ANN, BOB)

    db.refresh(ann)
    assert stats['created'] == 1 and stats['skipped'] == 1
    assert not ann.active and ann.google_sheet_row_number == 3
    assert_intact(job_named(db, 'Nia Noor'), NIA, 2)


def test_a_mapped_job_follows_its_row_and_goes_back_to_manual_when_it_is_gone(db, sync, api):
    job = manual_job(db, address=BOB['address'], name=BOB['name'], homeowner_phone='555-010-0199')
    sync_tab(sync, ANN, {**BOB, 'phone': ''})
    resolve(api, only_pending(db), decision='same', candidate_type='job', candidate_id=str(job.id))
    assert (job.google_sheet_row_number, job.homeowner_phone) == (3, '555-010-0199')

    stats = sync_tab(sync, NIA, ANN, {**BOB, 'phone': ''})
    db.refresh(job)
    assert stats['moved'] == 2
    assert (job.google_sheet_row_number, job.homeowner_phone) == (4, '555-010-0199')

    sync_tab(sync, NIA, ANN)
    db.refresh(job)
    assert (job.google_sheet_row_number, job.google_sheet_name) == (None, None)
    assert job.homeowner_phone == '555-010-0199'
    assert db.query(WMSheetRowMatch).filter(WMSheetRowMatch.job_id == job.id).one().status == 'unlinked'


def test_a_waiting_row_that_moves_is_asked_about_once_at_its_new_row(db, sync):
    manual_job(db, address=BOB['address'], name=BOB['name'])
    sync_tab(sync, ANN, BOB)
    assert only_pending(db).row_number == 3

    stats = sync_tab(sync, NIA, ANN, BOB)

    assert stats['needs_review'] == 1
    assert only_pending(db).row_number == 4


def test_a_job_moved_onto_a_waiting_rows_old_number_ends_that_wait(db, sync):
    manual_job(db, address=BOB['address'], name=BOB['name'])
    sync_tab(sync, ANN, BOB)

    sync_tab(sync, BOB, ANN)

    assert only_pending(db).row_number == 2
    assert job_named(db, 'Ann Able').google_sheet_row_number == 3


@pytest.mark.parametrize('new_first_cell', ['', 'Lead'])
def test_a_tab_whose_columns_moved_changes_nothing(db, sync, new_first_cell):
    people = [
        {'address': f'{n} Street Rd, Reston, VA 20190', 'name': f'Person {n}', 'claim': f'C-{n}'} for n in range(1, 11)
    ]
    sync_tab(sync, *people)
    before = {job.id: (job.google_sheet_row_number, job.property_address) for job in db.query(WaterMitigationJob).all()}

    async def shifted(range_name):
        return [['header']] + [[new_first_cell] + angel_row(**person) for person in people]
    sync.client.get_sheet_values = shifted
    with pytest.raises(ValueError, match='match no row'):
        asyncio.run(sync.sync_all_rows(SHEET))

    db.expire_all()
    after = {job.id: (job.google_sheet_row_number, job.property_address) for job in db.query(WaterMitigationJob).all()}
    assert after == before


def test_emptied_rows_are_rows_gone_and_their_jobs_come_back_with_them(db, sync):
    people = [
        {'address': f'{n} Street Rd, Reston, VA 20190', 'name': f'Person {n}'} for n in range(1, 11)
    ]
    sync_tab(sync, *people)

    stats = sync_tab(sync, people[0], {}, {}, {}, {}, {}, {}, {}, {}, people[9])
    assert (stats['off_sheet'], stats['failed']) == (8, 0)

    stats = sync_tab(sync, *people)
    assert (stats['moved'], stats['created'], stats['needs_review']) == (8, 0, 0)
    assert db.query(WaterMitigationJob).count() == 10


def test_several_tabs_report_a_tab_that_changed_nothing(db, sync):
    people = [
        {'address': f'{n} Street Rd, Reston, VA 20190', 'name': f'Person {n}'} for n in range(1, 11)
    ]
    sync_tab(sync, *people)

    async def shifted(range_name):
        return [['header']] + [['', '', '', '', 'Other', 'x'] for _ in people]
    sync.client.get_sheet_values = shifted
    stats = asyncio.run(sync.sync_multiple_sheets([SHEET]))

    assert stats['status'] == 'failed'
    assert 'nothing was changed' in stats['errors'][0]['error']


def test_many_rows_leaving_a_tab_is_not_taken_for_a_moved_column(db, sync):
    people = [
        {'address': f'{n} Street Rd, Reston, VA 20190', 'name': f'Person {n}'} for n in range(1, 11)
    ]
    sync_tab(sync, *people)

    stats = sync_tab(sync, *people[:2])

    assert (stats['off_sheet'], stats['failed']) == (8, 0)


def test_a_single_row_sync_never_writes_another_homeowner_over_a_job(db, sync):
    sync_tab(sync, ANN, BOB)
    ann = job_named(db, 'Ann Able')

    result = sync._process_row(angel_row(**BOB), 2, SHEET)

    db.refresh(ann)
    assert_intact(ann, ANN, None)
    # Bob's row moved up. Rather than a second Bob, the row waits on his Lead...
    assert result['needs_review'] and db.query(WaterMitigationJob).count() == 2

    # ...until a full sync sees where his row went, and there's nothing to ask
    sync_tab(sync, BOB)
    assert_intact(job_named(db, 'Bob Best'), BOB, 2)
    assert db.query(WMSheetRowMatch).filter(WMSheetRowMatch.status == 'pending').count() == 0
    assert db.query(WaterMitigationJob).count() == 2


# The list and the rules on deciding

def test_the_list_shows_the_row_and_both_kinds_of_candidate_once(db, sync, api):
    job = manual_job(db, claim_number='CL-1')
    other = manual_client(db, name='Other Person')
    sync._process_row(angel_row(claim='CL-2', phone='555-010-0100'), 5, SHEET)

    [pending] = api.get(ROW_MATCHES).json()

    assert (pending['sheet_name'], pending['row_number'], pending['address']) == (SHEET, 5, ADDRESS)
    assert pending['row']['claim_number'] == 'CL-2'
    assert [(c['type'], c['id']) for c in pending['candidates']] == [('job', str(job.id)), ('client', str(other.id))]


def test_a_decision_needs_a_record_still_at_that_address(db, sync, api):
    manual_job(db)
    sync._process_row(angel_row(), 5, SHEET)
    match = only_pending(db)
    elsewhere = manual_client(db, address='12 Elsewhere Rd')

    response = api.post(
        f'{ROW_MATCHES}/{match.id}/resolve',
        json={'decision': 'same', 'candidate_type': 'client', 'candidate_id': str(elsewhere.id)},
    )

    assert response.status_code == 409
    assert only_pending(db).id == match.id


def test_a_row_can_only_be_decided_once(db, sync, api):
    manual_job(db)
    sync._process_row(angel_row(), 5, SHEET)
    match = only_pending(db)
    resolve(api, match, decision='different')

    response = api.post(f'{ROW_MATCHES}/{match.id}/resolve', json={'decision': 'different'})

    assert response.status_code == 409
    assert len(jobs_on_row(db)) == 1


def test_staff_only_see_rows_about_what_they_may_see(db, sync, api, monkeypatch):
    ours, theirs = Company(name='Ours'), Company(name='Theirs')
    db.add_all([ours, theirs])
    db.commit()
    member_id = str(uuid.uuid4())
    app.dependency_overrides[get_current_staff] = lambda: SimpleNamespace(id=member_id, role=StaffRole.staff)
    monkeypatch.setattr(auth_service, 'get_staff_by_id', lambda *args: SimpleNamespace(id=member_id))
    monkeypatch.setattr(screen_access, 'may_open', lambda *args: True)
    monkeypatch.setattr(company_scope, '_in_all_companies', lambda *args: False)
    monkeypatch.setattr(company_scope, 'staff_company_ids', lambda *args: [str(ours.id)])

    manual_job(db, company_id=theirs.id)
    sync._process_row(angel_row(), 5, SHEET)
    match = only_pending(db)
    assert api.get(ROW_MATCHES).json() == []
    assert api.post(f'{ROW_MATCHES}/{match.id}/resolve', json={'decision': 'different'}).status_code == 404

    visible = manual_job(db, company_id=ours.id)
    [pending] = api.get(ROW_MATCHES).json()
    assert [c['id'] for c in pending['candidates'] if c['type'] == 'job'] == [str(visible.id)]


# A job entered by hand has a client at its address, with or without a claim

JOBS = '/api/water-mitigation/jobs'
STREET = '100 Example St'
PLACE = {'property_city': 'Springfield', 'property_state': 'VA', 'property_zipcode': '22152'}


def enter_job(api, street=STREET, **values):
    """What the job form sends"""
    response = api.post(JOBS, json={'property_address': street, 'property_street': street, **PLACE, **values})
    assert response.status_code == 200, response.text
    return response.json()


def edit_job(api, job, **values):
    response = api.put(f"{JOBS}/{job['id']}", json=values)
    assert response.status_code == 200, response.text
    return response.json()


def test_a_job_with_only_an_address_makes_a_client_named_after_it(db, api):
    enter_job(api)

    client = db.query(Client).one()
    assert client.display_name == client.address == STREET
    assert client.owners == [] and client.source is None
    assert (client.city, client.state, client.zipcode) == ('Springfield', 'VA', '22152')
    # What the field visit and on-site signing look a client up by
    assert client.normalized_address == '100 example st'
    assert db.query(Claim).count() == 0


def test_a_job_with_a_homeowner_and_no_claim_makes_their_client(db, api):
    enter_job(api, homeowner_name='Pat Doe', homeowner_phone='555-010-0100')

    client = db.query(Client).one()
    assert client.display_name == 'Pat Doe' and client.address == STREET
    assert client.owners[0]['name'] == 'Pat Doe' and client.owners[0]['phone'] == '555-010-0100'
    assert client.normalized_address == '100 example st'
    assert db.query(Claim).count() == 0


def test_a_job_with_a_claim_files_it_under_the_client_at_its_address(db, api):
    enter_job(api, homeowner_name='Pat Doe', claim_number='CL-1')

    claim = db.query(Claim).one()
    assert claim.client_id == db.query(Client).one().id
    assert db.query(WaterMitigationJob).one().claim_id == claim.id


@pytest.mark.parametrize('street', ['100 Example Street', '100 example st.', ' 100 Example St '])
def test_a_job_finds_the_client_at_its_address_however_it_is_written(db, api, street):
    client = manual_client(db, name='Already Here', phone='555-010-0199')

    enter_job(api, street=street)

    assert db.query(Client).one().id == client.id


def test_a_client_holding_the_whole_address_in_its_street_is_still_found(db, api):
    client = Client(display_name='Older Row', owners=[], address='100 Example St, Springfield, VA 22152')
    db.add(client)
    db.commit()

    enter_job(api)

    assert db.query(Client).one().id == client.id


def test_a_different_name_at_the_same_address_stays_with_that_client(db, api):
    client = manual_client(db, name='Already Here')

    enter_job(api, homeowner_name='Someone Else', claim_number='CL-1')

    assert db.query(Client).one().display_name == 'Already Here'
    assert db.query(Claim).one().client_id == client.id


def test_another_unit_is_another_client(db, api):
    enter_job(api, street='100 Example St Apt 1')
    enter_job(api, street='100 Example St Apt 2')

    assert {client.address for client in db.query(Client).all()} == {'100 Example St Apt 1', '100 Example St Apt 2'}


def test_the_same_street_in_another_zip_is_another_client(db, api):
    db.add(Client(display_name='Elsewhere', owners=[], address=STREET, zipcode='20124'))
    db.commit()

    enter_job(api)

    assert db.query(Client).count() == 2


def test_the_same_street_in_another_city_is_another_client_when_a_zip_is_missing(db, api):
    db.add(Client(display_name='Elsewhere', owners=[], address=STREET, city='Clifton'))
    db.commit()

    enter_job(api)

    assert db.query(Client).count() == 2


@pytest.mark.parametrize('values', [
    {'homeowner_name': 'Same Name'},
    {'homeowner_name': 'One Person', 'homeowner_phone': '555-010-0123'},
    {'homeowner_name': 'One Person', 'homeowner_email': 'same@example.com'},
])
def test_someone_known_at_another_address_still_gets_a_client_at_this_one(db, api, values):
    manual_client(db, address='12 Elsewhere Rd', name='Same Name', phone='555-010-0123', email='same@example.com')

    enter_job(api, **values)

    assert db.query(Client).filter(Client.address == STREET).count() == 1
    assert db.query(Client).count() == 2


def test_a_client_with_no_address_yet_takes_the_jobs_instead_of_doubling(db, api):
    client = Client(display_name='Pat Doe', owners=[], phone='555-010-0100')
    db.add(client)
    db.commit()

    enter_job(api, homeowner_name='Pat Doe')

    db.refresh(client)
    assert db.query(Client).count() == 1
    assert client.address == STREET and client.normalized_address == '100 example st'


def test_the_client_named_after_its_address_takes_the_homeowner_added_later(db, api):
    job = enter_job(api)

    edit_job(api, job, homeowner_name='Pat Doe', homeowner_phone='555-010-0100')

    client = db.query(Client).one()
    assert client.display_name == 'Pat Doe' and client.phone == '555-010-0100'
    assert client.owners == [{'name': 'Pat Doe', 'phone': '555-010-0100', 'email': None, 'is_primary': True}]


def test_a_claim_added_later_goes_under_the_client_the_job_already_made(db, api):
    job = enter_job(api)

    edit_job(api, job, claim_number='CL-1')

    assert db.query(Claim).one().client_id == db.query(Client).one().id
    assert db.query(WaterMitigationJob).one().claim_id == db.query(Claim).one().id


def test_editing_a_job_with_no_claim_keeps_finding_the_same_client(db, api):
    job = enter_job(api, homeowner_name='Pat Doe')

    edit_job(api, job, homeowner_phone='555-010-0100')
    edit_job(api, job, homeowner_name='Patricia Doe')

    client = db.query(Client).one()
    assert client.display_name == 'Pat Doe' and client.phone == '555-010-0100'


def test_a_job_at_a_sheet_clients_address_stays_apart_from_it(db, sync, api):
    sync._process_row(angel_row(), 5, SHEET)

    enter_job(api)

    assert db.query(Client).count() == 2
    assert db.query(Client).filter(Client.source.is_(None)).one().address == STREET


def test_a_sheet_row_with_no_homeowner_still_makes_no_client(db, sync):
    assert sync._process_row(angel_row(name=''), 5, SHEET)['created']
    assert db.query(Client).count() == 0


def test_the_new_client_shows_to_the_company_on_the_job(db, api):
    company = Company(name='WM Co')
    db.add(company)
    db.commit()

    enter_job(api, company_id=str(company.id))

    assert str(db.query(Client).one().company_id) == str(company.id)


# A Lead already here for the customer: asked about before a second one is made

OTHER_TAB = 'Vanessa'
LEAD_PHONE = '555-010-0466'
LEAD_EMAIL = 'lead.person@example.com'


def vanessa_row(address='101 Example St, Springfield, VA 22152', name='Lead Person', phone=LEAD_PHONE,
                email=LEAD_EMAIL, claim=''):
    """Laid out the way the Vanessa tab is"""
    return [address, name, '', phone, email, '', '', claim]


def angel_lead(sync, row=5, **values):
    """A Lead the Angel tab made: the house number one off from the Vanessa row's"""
    values = {'name': 'Lead Person & Partner', 'phone': LEAD_PHONE, 'email': LEAD_EMAIL, **values}
    return sync._process_row(angel_row(**values), row, SHEET)['job']


def test_a_row_for_a_lead_on_another_tab_waits_though_the_house_number_differs(db, sync, api):
    lead = angel_lead(sync)

    result = sync._process_row(vanessa_row(), 25, OTHER_TAB)

    assert result['needs_review']
    assert db.query(WaterMitigationJob).count() == 1
    [pending] = api.get(ROW_MATCHES).json()
    [candidate] = pending['candidates']
    assert (candidate['type'], candidate['id']) == ('job', str(lead.id))
    assert (candidate['sheet_name'], candidate['row_number']) == (SHEET, 5)
    assert candidate['reasons'] == ['phone', 'email']


def test_same_moves_the_lead_to_the_new_row_and_its_old_row_is_left_alone(db, sync, api):
    lead = angel_lead(sync)
    clients_before = db.query(Client).count()
    sync._process_row(vanessa_row(), 25, OTHER_TAB)

    result = resolve(api, only_pending(db), decision='same', candidate_type='job', candidate_id=str(lead.id))

    db.refresh(lead)
    assert result['job_id'] == str(lead.id)
    assert (lead.google_sheet_name, lead.google_sheet_row_number) == (OTHER_TAB, 25)
    assert lead.property_address == '101 Example St, Springfield, VA 22152'
    remembered = db.query(WMSheetRowMatch).filter(WMSheetRowMatch.status == 'duplicate').one()
    assert (remembered.sheet_name, remembered.row_number, str(remembered.job_id)) == (SHEET, 5, str(lead.id))

    # The old row is still on the Angel tab: it stays the same job, and makes nothing
    again = sync._process_row(angel_row(name='Lead Person & Partner', phone=LEAD_PHONE, email=LEAD_EMAIL), 5, SHEET)
    assert again['skipped']
    assert db.query(WaterMitigationJob).count() == 1
    assert db.query(Client).count() == clients_before
    assert db.query(WMSheetRowMatch).filter(WMSheetRowMatch.status == 'pending').count() == 0


def test_the_old_row_is_left_alone_wherever_it_moves_on_its_tab(db, sync, api):
    person = {'address': ADDRESS, 'name': 'Lead Person', 'claim': '', 'phone': LEAD_PHONE}
    sync_tab(sync, person)
    lead = job_named(db, 'Lead Person')
    sync._process_row(vanessa_row(), 25, OTHER_TAB)
    resolve(api, only_pending(db), decision='same', candidate_type='job', candidate_id=str(lead.id))

    stats = sync_tab(sync, NIA, person)

    assert (stats['created'], stats['needs_review'], stats['skipped']) == (1, 0, 1)
    assert db.query(WaterMitigationJob).filter(WaterMitigationJob.homeowner_name == 'Lead Person').count() == 1


def test_an_old_row_whose_job_is_gone_is_asked_about_again(db, sync, api):
    lead = angel_lead(sync)
    sync._process_row(vanessa_row(), 25, OTHER_TAB)
    resolve(api, only_pending(db), decision='same', candidate_type='job', candidate_id=str(lead.id))

    db.delete(lead)
    db.commit()
    result = sync._process_row(angel_row(name='Lead Person & Partner', phone=LEAD_PHONE, email=LEAD_EMAIL), 5, SHEET)

    assert result['created']
    assert db.query(WMSheetRowMatch).filter(WMSheetRowMatch.status == 'duplicate').count() == 0


def test_a_row_for_a_job_past_lead_becomes_its_own_job(db, sync):
    lead = angel_lead(sync)
    lead.status = 'Doc prepping'
    db.commit()

    assert sync._process_row(vanessa_row(), 25, OTHER_TAB)['created']


def test_another_claim_number_is_another_incident_not_the_same_lead(db, sync):
    angel_lead(sync, claim='CL-1')

    assert sync._process_row(vanessa_row(claim='CL-2'), 25, OTHER_TAB)['created']


def test_a_row_at_a_leads_address_waits_with_no_phone_or_email(db, sync):
    angel_lead(sync, phone='', email='')

    assert sync._process_row(angel_row(name='Someone Else'), 6, SHEET)['needs_review']


# The job form asks first too

LEADS = f'{JOBS}/same-customer-leads'


def test_the_job_form_finds_the_lead_by_phone_at_another_house_number(db, sync, api):
    lead = angel_lead(sync)

    found = api.post(LEADS, json={'property_street': '101 Example St', **PLACE, 'homeowner_phone': '(555) 010-0466'}).json()

    assert [(f['id'], f['reasons'], f['sheet_name'], f['row_number']) for f in found] == [
        (str(lead.id), ['phone'], SHEET, 5)
    ]


def test_the_job_form_finds_the_lead_at_its_address(db, sync, api):
    lead = angel_lead(sync, phone='', email='')

    found = api.post(LEADS, json={'property_street': '100 Example Street', **PLACE}).json()

    assert [(f['id'], f['reasons']) for f in found] == [(str(lead.id), ['address'])]


def test_the_job_form_leaves_out_worked_inactive_and_other_units(db, sync, api):
    worked = angel_lead(sync)
    worked.status = 'Doc prepping'
    db.commit()
    hidden = angel_lead(sync, row=6, address='200 Example St, Springfield, VA 22152')
    hidden.active = False
    db.commit()
    angel_lead(sync, row=7, address='300 Example St Apt 1, Springfield, VA 22152', phone='', email='')

    assert api.post(LEADS, json={'homeowner_email': LEAD_EMAIL, 'homeowner_phone': LEAD_PHONE}).json() == []
    assert api.post(LEADS, json={'property_street': '300 Example St Apt 2', **PLACE}).json() == []


def test_using_the_lead_fills_in_only_what_it_lacks(db, sync, api):
    lead = angel_lead(sync, email='')
    clients_before = db.query(Client).count()

    response = api.post(f"{JOBS}/{lead.id}/fill-in", json={
        'property_address': '101 Example St', 'property_street': '101 Example St', **PLACE,
        'homeowner_name': 'Typed Name', 'homeowner_phone': '555-010-9999', 'homeowner_email': LEAD_EMAIL,
        'insurance_company': 'Typed Insurance', 'status': 'Lead', 'active': True, 'mitigation_flag': False,
    })

    assert response.status_code == 200, response.text
    db.refresh(lead)
    assert lead.property_address == ADDRESS
    assert lead.homeowner_name == 'Lead Person & Partner'
    assert lead.homeowner_phone == LEAD_PHONE
    assert lead.homeowner_email == LEAD_EMAIL
    assert lead.insurance_company == 'Typed Insurance'
    assert db.query(WaterMitigationJob).count() == 1
    assert db.query(Client).count() == clients_before


def test_the_job_form_only_offers_leads_the_staff_member_may_see(db, sync, api, monkeypatch):
    ours, theirs = Company(name='Ours'), Company(name='Theirs')
    db.add_all([ours, theirs])
    db.commit()
    member_id = str(uuid.uuid4())
    app.dependency_overrides[get_current_staff] = lambda: SimpleNamespace(id=member_id, role=StaffRole.staff)
    monkeypatch.setattr(auth_service, 'get_staff_by_id', lambda *args: SimpleNamespace(id=member_id))
    monkeypatch.setattr(screen_access, 'may_open', lambda *args: True)
    monkeypatch.setattr(company_scope, '_in_all_companies', lambda *args: False)
    monkeypatch.setattr(company_scope, 'staff_company_ids', lambda *args: [str(ours.id)])

    hidden = angel_lead(sync)
    hidden.company_id = theirs.id
    # The same customer twice, as it was before anything asked
    visible = WaterMitigationJob(
        property_address='200 Example St, Springfield, VA 22152', homeowner_phone=LEAD_PHONE,
        status='Lead', active=True, company_id=ours.id,
    )
    db.add(visible)
    db.commit()

    found = api.post(LEADS, json={'homeowner_phone': LEAD_PHONE}).json()

    assert [f['id'] for f in found] == [str(visible.id)]
