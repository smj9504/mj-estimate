"""A WM job with no claim number gets a provisional claim (no number) under its client,
so it shows on the client's page, and that claim takes the number when one comes.
Runs the real sheet sync and API on a throwaway SQLite database, with the setup from
test_sheet_row_matches.py."""

from app.domains.client.models import Claim, Client
from app.domains.client.repository import ClaimSQLAlchemyRepository
from app.domains.water_mitigation.models import WaterMitigationJob

from test_sheet_row_matches import (  # noqa: F401  (fixtures)
    SHEET, JOBS, admin, angel_row, api, db, edit_job, enter_job, manual_job, sync,
)


def sheet_job(db):
    return db.query(WaterMitigationJob).one()


def test_a_sheet_row_with_no_claim_number_shows_under_its_client(db, sync):
    # 12588 Birkdale Way: a homeowner and a carrier on the sheet, no claim number yet
    sync._process_row(angel_row(name='Julie Example', insurance='Nationwide'), 5, SHEET)

    client = db.query(Client).one()
    claim = db.query(Claim).one()
    assert claim.client_id == client.id and sheet_job(db).claim_id == claim.id
    assert claim.claim_number == '' and claim.claim_type == 'insurance'
    assert claim.insurance_company == 'Nationwide'

    # What the client page lists under the client
    [listed] = ClaimSQLAlchemyRepository(db).get_claims_by_client(str(client.id))
    assert [job['id'] for job in listed['wm_jobs']] == [str(sheet_job(db).id)]


def test_the_next_sync_keeps_the_one_provisional_claim(db, sync):
    sync._process_row(angel_row(), 5, SHEET)
    sync._process_row(angel_row(), 5, SHEET)

    assert db.query(Claim).count() == 1


def test_the_provisional_claim_takes_the_number_when_the_sheet_gets_one(db, sync):
    sync._process_row(angel_row(), 5, SHEET)
    provisional = db.query(Claim).one()

    sync._process_row(angel_row(claim='CL-9'), 5, SHEET)

    claim = db.query(Claim).one()
    assert claim.id == provisional.id and claim.claim_number == 'CL-9'
    assert sheet_job(db).claim_id == claim.id


def test_a_number_someone_typed_on_the_claim_stays_while_the_sheet_has_none(db, sync):
    sync._process_row(angel_row(), 5, SHEET)
    claim = db.query(Claim).one()
    claim.claim_number = 'TYPED-1'
    db.commit()

    sync._process_row(angel_row(), 5, SHEET)

    assert db.query(Claim).one().claim_number == 'TYPED-1'
    assert sheet_job(db).claim_id == claim.id


def test_a_number_that_already_has_a_claim_moves_the_job_there(db, sync):
    sync._process_row(angel_row(), 5, SHEET)
    provisional = db.query(Claim).one()
    existing = Claim(client_id=provisional.client_id, claim_number='CL-9', status='open')
    db.add(existing)
    db.commit()

    sync._process_row(angel_row(claim='CL-9'), 5, SHEET)

    assert sheet_job(db).claim_id == existing.id
    db.refresh(provisional)
    assert provisional.claim_number == ''


def test_a_job_entered_by_hand_with_only_an_address_gets_one_too(db, api):
    job = enter_job(api)

    claim = db.query(Claim).one()
    assert claim.client_id == db.query(Client).one().id and claim.claim_number == ''
    assert str(sheet_job(db).claim_id) == str(claim.id)

    edit_job(api, job, claim_number='CL-1')
    assert db.query(Claim).one().claim_number == 'CL-1'


def test_a_job_taken_off_the_list_gets_no_claim(db):
    manual_job(db, active=False)

    assert db.query(Client).count() == 1
    assert db.query(Claim).count() == 0
