"""Rebuild project page: the company that did the claim's water mitigation is
shown, read-only, from the claim's WM jobs and its WM-role companies. In-memory
SQLite; names are made up."""
import sqlite3
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: F401  registers every model
from app.domains.client.models import Claim, Client
from app.domains.company.models import Company
from app.domains.contract.models import ClaimCompany
from app.domains.rebuild.models import RebuildCompletionDoc, RebuildContractor, RebuildProject
from app.domains.rebuild.schemas import RebuildProjectResponse, RebuildProjectUpdate
from app.domains.rebuild.service import RebuildService
from app.domains.water_mitigation.models import WaterMitigationJob


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


sqlite3.register_adapter(uuid.UUID, str)


@pytest.fixture
def db():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    for model in (Client, Claim, Company, ClaimCompany, RebuildContractor, RebuildProject,
                  RebuildCompletionDoc, WaterMitigationJob):
        model.__table__.create(engine)
    make = sessionmaker(bind=engine)
    s = make()
    s.service = RebuildService(database=SimpleNamespace(get_session=make, get_readonly_session=make))
    yield s
    s.close()


def make_project(s):
    client = Client(id=uuid.uuid4(), display_name='Pat Homeowner', owners=[])
    claim = Claim(id=uuid.uuid4(), client_id=client.id, claim_number='CLM-1')
    project = RebuildProject(id=uuid.uuid4(), claim_id=claim.id, title='Rebuild - 12 Oak St', status='pending')
    s.add_all([client, claim, project])
    s.commit()
    return project, claim


def company(s, name):
    c = Company(id=uuid.uuid4(), name=name)
    s.add(c)
    s.commit()
    return c


def detail(s, project):
    return s.service.get_project(str(project.id))


def test_the_wm_jobs_company_is_on_the_project(db):
    project, claim = make_project(db)
    dry = company(db, 'Blue Dry Co')
    db.add(WaterMitigationJob(id=uuid.uuid4(), claim_id=claim.id, company_id=dry.id,
                              property_address='12 Oak St', status='lead'))
    db.commit()
    got = detail(db, project)
    assert got['wm_companies'] == [{'id': str(dry.id), 'name': 'Blue Dry Co'}]
    assert RebuildProjectResponse(**got).wm_companies[0].name == 'Blue Dry Co'


def test_a_company_in_the_wm_role_counts_without_a_wm_job(db):
    project, claim = make_project(db)
    dry = company(db, 'Blue Dry Co')
    recon = company(db, 'Oak Builders')
    db.add_all([
        ClaimCompany(id=uuid.uuid4(), claim_id=claim.id, company_id=dry.id, role='water_mitigation'),
        ClaimCompany(id=uuid.uuid4(), claim_id=claim.id, company_id=recon.id, role='reconstruction'),
    ])
    db.commit()
    assert [c['name'] for c in detail(db, project)['wm_companies']] == ['Blue Dry Co']


def test_one_company_in_both_places_is_listed_once_and_two_are_both_listed(db):
    project, claim = make_project(db)
    dry = company(db, 'Zephyr Drying')
    other = company(db, 'Alder Restoration')
    db.add_all([
        WaterMitigationJob(id=uuid.uuid4(), claim_id=claim.id, company_id=dry.id,
                           property_address='12 Oak St', status='lead'),
        ClaimCompany(id=uuid.uuid4(), claim_id=claim.id, company_id=dry.id, role='water_mitigation'),
        WaterMitigationJob(id=uuid.uuid4(), claim_id=claim.id, company_id=other.id,
                           property_address='12 Oak St', status='lead'),
    ])
    db.commit()
    assert [c['name'] for c in detail(db, project)['wm_companies']] == ['Alder Restoration', 'Zephyr Drying']


def test_no_wm_company_is_an_empty_list(db):
    project, claim = make_project(db)
    db.add(WaterMitigationJob(id=uuid.uuid4(), claim_id=claim.id, property_address='12 Oak St', status='lead'))
    db.commit()
    assert detail(db, project)['wm_companies'] == []


def test_the_project_update_cannot_set_it():
    assert 'wm_companies' not in RebuildProjectUpdate.model_fields
    sent = RebuildProjectUpdate(**{'notes': 'x', 'wm_companies': [{'id': 'a', 'name': 'b'}]})
    assert 'wm_companies' not in sent.model_dump(exclude_unset=True)
