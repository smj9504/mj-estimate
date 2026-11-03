"""A claim or WM job can have up to three adjusters when the carrier hands
the claim to a third-party firm: the first in adjuster_*, two more in
additional_adjusters."""

from pathlib import Path
import sys

import pytest
import sqlalchemy as sa
from pydantic import ValidationError
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401
from app.domains.claim_followup.contact_resolver import resolve_additional_adjusters  # noqa: E402
from app.domains.client.adjusters import clean_additional_adjusters  # noqa: E402
from app.domains.client.client_sync_service import ClientSyncService  # noqa: E402
from app.domains.client.models import Claim, Client  # noqa: E402
from app.domains.client.schemas import ClaimCreate, ClaimUpdate  # noqa: E402
from app.domains.water_mitigation.models import WaterMitigationJob  # noqa: E402
from app.domains.water_mitigation.schemas import JobUpdate  # noqa: E402


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


FIRM = {'company': 'Field Desk LLC', 'name': 'Sam Ortiz', 'phone': '512-555-0101', 'email': 'sam@fielddesk.com'}
DESK = {'company': 'Review Co', 'name': '', 'phone': '', 'email': 'desk@review.com'}


@pytest.fixture
def session(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'adjusters.db'}")
    for model in (Client, Claim, WaterMitigationJob):
        model.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()
    engine.dispose()


def add_claim(session, **fields):
    client = Client(display_name='Ann Brown')
    session.add(client)
    session.flush()
    claim = Claim(client_id=client.id, claim_number='CLM-12345', **fields)
    session.add(claim)
    session.commit()
    return claim


def add_job(session, **fields):
    job = WaterMitigationJob(property_address='12 Elm St, Austin TX', **fields)
    session.add(job)
    session.commit()
    return job


# ---- what can be saved ----

def test_entries_are_trimmed_and_blank_ones_dropped():
    assert clean_additional_adjusters([
        {'company': ' Field Desk LLC ', 'name': 'Sam Ortiz ', 'email': ' sam@fielddesk.com'},
        {'company': '', 'name': '  ', 'phone': None, 'email': ''},
        {},
    ]) == [{'company': 'Field Desk LLC', 'name': 'Sam Ortiz', 'phone': '', 'email': 'sam@fielddesk.com'}]


def test_not_sending_the_list_leaves_it_alone():
    assert clean_additional_adjusters(None) is None
    assert 'additional_adjusters' not in ClaimUpdate(notes='x').dict(exclude_unset=True)


def test_an_empty_list_clears_it():
    assert ClaimUpdate(additional_adjusters=[]).additional_adjusters == []


@pytest.mark.parametrize('schema', [
    lambda v: ClaimCreate(client_id='00000000-0000-0000-0000-000000000001', additional_adjusters=v),
    lambda v: ClaimUpdate(additional_adjusters=v),
    lambda v: JobUpdate(additional_adjusters=v),
])
def test_three_adjusters_in_all_is_the_most(schema):
    assert len(schema([FIRM, DESK]).additional_adjusters) == 2
    with pytest.raises(ValidationError):
        schema([FIRM, DESK, {'name': 'One too many'}])


# ---- the WM job hands them to its claim ----

def test_a_claim_made_from_a_job_takes_its_other_adjusters(session):
    job = add_job(session, claim_number='CLM-12345', additional_adjusters=[FIRM])
    client = Client(display_name='Ann Brown')
    session.add(client)
    session.flush()

    claim = ClientSyncService(session)._create_claim_from_job(job, client)

    assert claim.additional_adjusters == [FIRM]


def test_a_claim_with_none_takes_the_jobs(session):
    claim = add_claim(session)
    job = add_job(session, additional_adjusters=[FIRM, DESK])

    ClientSyncService(session)._update_claim_from_job(claim, job)

    assert claim.additional_adjusters == [FIRM, DESK]


def test_a_claim_keeps_its_own(session):
    claim = add_claim(session, additional_adjusters=[DESK])
    job = add_job(session, additional_adjusters=[FIRM])

    ClientSyncService(session)._update_claim_from_job(claim, job)

    assert claim.additional_adjusters == [DESK]


# ---- the follow-up screen ----

def test_follow_up_reads_the_claims_own_then_the_jobs(session):
    own = add_claim(session, additional_adjusters=[DESK])
    add_job(session, claim_id=own.id, additional_adjusters=[FIRM])
    bare = add_claim(session)
    add_job(session, claim_id=bare.id, additional_adjusters=[FIRM])
    nothing = add_claim(session)

    assert resolve_additional_adjusters(session, own) == [DESK]
    assert resolve_additional_adjusters(session, bare) == [FIRM]
    assert resolve_additional_adjusters(session, nothing) == []
