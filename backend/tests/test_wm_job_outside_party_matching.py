"""A WM job joins the client at its address and the claim with its number, and its
company is put on that claim. For group staff that is how affiliates share a claim.
Someone outside the group (a public adjuster's office, a contractor) only joins what
they can already see, so typing another company's claim number or address never
opens that claim to them. Runs the real sync on a throwaway SQLite database."""

from datetime import datetime
from pathlib import Path
import sqlite3
import sys
from types import SimpleNamespace
import uuid

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, INET, JSONB, UUID as PG_UUID
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.database_factory import Base  # noqa: E402
from app.domains.client.client_sync_service import sync_client_from_wm_job  # noqa: E402
from app.domains.client.models import Claim, Client  # noqa: E402
from app.domains.company.models import Company  # noqa: E402
from app.domains.contract.models import ClaimCompany  # noqa: E402
from app.domains.staff.models import Staff, StaffCompany, StaffRole  # noqa: E402
from app.domains.water_mitigation.models import WaterMitigationJob  # noqa: E402

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


ADDRESS = '200 Sample Ave, Springfield, VA 22152'


@pytest.fixture
def db():
    engine = sa.create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
    sa.event.listen(
        engine, 'connect',
        lambda conn, _: conn.create_function('gen_random_uuid', 0, lambda: str(uuid.uuid4())),
    )
    with engine.connect() as connection:
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
def world(db):
    """Company B has a client at ADDRESS with claim CLM-B1. Company A is someone else."""
    a = Company(name='Alpha Restoration', company_type='water_mitigation')
    b = Company(name='Bravo Builders', company_type='contractor')
    db.add_all([a, b])
    db.flush()
    client = Client(display_name='Pat Example', owners=[], address='200 Sample Ave',
                    city='Springfield', state='VA', zipcode='22152')
    db.add(client)
    db.flush()
    claim = Claim(client_id=client.id, claim_number='CLM-B1')
    db.add(claim)
    db.flush()
    db.add(ClaimCompany(claim_id=str(claim.id), company_id=str(b.id), role='reconstruction'))
    db.commit()
    return SimpleNamespace(a=a, b=b, client=client, claim=claim)


def person(db, role, company):
    staff = Staff(
        staff_number=f'T-{uuid.uuid4().hex[:6]}', first_name='Test', last_name=role,
        email=f'{uuid.uuid4().hex[:8]}@example.com', role=role, hire_date=datetime(2026, 1, 1),
        username=f'u-{uuid.uuid4().hex[:8]}',
    )
    db.add(staff)
    db.flush()
    db.add(StaffCompany(staff_id=staff.id, company_id=company.id))
    db.commit()
    return SimpleNamespace(id=staff.id, role=role)


def save_job(db, staff, company, **values):
    job = WaterMitigationJob(property_address=ADDRESS, homeowner_name='Pat Example',
                             company_id=company.id, **values)
    db.add(job)
    db.commit()
    sync_client_from_wm_job(db, job, homeowner_new=True, staff=staff)
    db.refresh(job)
    return job


def companies_on(db, claim_id):
    return {str(r.company_id) for r in db.query(ClaimCompany).filter(ClaimCompany.claim_id == str(claim_id))}


@pytest.mark.parametrize('role', [StaffRole.public_adjuster, StaffRole.contractor])
def test_an_outside_login_cannot_join_another_companys_claim_by_its_number(db, world, role):
    outsider = person(db, role, world.a)
    job = save_job(db, outsider, world.a, claim_number='CLM-B1')

    assert str(job.claim_id) != str(world.claim.id)
    assert companies_on(db, world.claim.id) == {str(world.b.id)}
    own = db.query(Claim).filter(Claim.id == job.claim_id).one()
    assert str(own.client_id) != str(world.client.id)


def test_an_outside_login_cannot_join_another_companys_client_by_address(db, world):
    outsider = person(db, StaffRole.public_adjuster, world.a)
    job = save_job(db, outsider, world.a)

    claim = db.query(Claim).filter(Claim.id == job.claim_id).one()
    assert str(claim.client_id) != str(world.client.id)
    assert companies_on(db, world.claim.id) == {str(world.b.id)}


def test_an_outside_login_joins_a_claim_it_already_sees(db, world):
    db.add(ClaimCompany(claim_id=str(world.claim.id), company_id=str(world.a.id), role='other'))
    db.commit()
    outsider = person(db, StaffRole.public_adjuster, world.a)
    job = save_job(db, outsider, world.a, claim_number='CLM-B1')

    assert str(job.claim_id) == str(world.claim.id)


def test_group_staff_still_join_an_affiliates_claim(db, world):
    staff = person(db, StaffRole.staff, world.a)
    job = save_job(db, staff, world.a, claim_number='CLM-B1')

    assert str(job.claim_id) == str(world.claim.id)
    assert companies_on(db, world.claim.id) == {str(world.b.id), str(world.a.id)}


def test_the_sheet_sync_matches_as_before(db, world):
    job = save_job(db, None, world.a, claim_number='CLM-B1')
    assert str(job.claim_id) == str(world.claim.id)
