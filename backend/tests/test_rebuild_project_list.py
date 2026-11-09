"""Rebuild project list: client name, search and paging, on in-memory SQLite."""
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: F401  registers every model
from app.domains.client.models import Claim, Client
from app.domains.rebuild.models import RebuildContractor, RebuildProject
from app.domains.rebuild.repository import RebuildProjectRepository
from app.domains.rebuild.service import RebuildService


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


@pytest.fixture
def session():
    engine = create_engine('sqlite://')
    for model in (Client, Claim, RebuildContractor, RebuildProject):
        model.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


def add_project(s, client_name, claim_number, address, contractor=None):
    client = Client(id=uuid.uuid4(), display_name=client_name, owners=[])
    claim = Claim(id=uuid.uuid4(), client_id=client.id, claim_number=claim_number)
    project = RebuildProject(
        id=uuid.uuid4(), claim_id=claim.id, title=f'Rebuild - {address}',
        property_address=address, status='pending',
        contractor_id=contractor.id if contractor else None,
    )
    s.add_all([client, claim, project])
    s.commit()
    return project


def search(s, text=None, page=1, page_size=20):
    return RebuildProjectRepository(s).get_with_filters(search=text, page=page, page_size=page_size)


def test_each_row_carries_its_client_name(session):
    project = add_project(session, 'Pat Homeowner', '070748-GR', '12 Oak St')
    item = {'claim_id': project.claim_id}
    RebuildService(database=SimpleNamespace())._enrich_project(session, item)
    assert item['client_name'] == 'Pat Homeowner'
    assert item['claim_number'] == '070748-GR'


def test_search_finds_by_client_claim_address_and_contractor(session):
    crew = RebuildContractor(id=uuid.uuid4(), company_name='Ace Builders')
    session.add(crew)
    session.commit()
    add_project(session, 'Pat Homeowner', '070748-GR', '12 Oak St', contractor=crew)
    add_project(session, 'Lee Kim', 'H-5521', '99 Pine Ave')

    def found(text):
        items, total = search(session, text)
        assert total == len(items)
        return sorted(i['property_address'] for i in items)

    assert found('homeowner') == ['12 Oak St']      # client name, any case
    assert found('5521') == ['99 Pine Ave']         # claim number
    assert found('pine') == ['99 Pine Ave']         # address
    assert found('ace build') == ['12 Oak St']      # contractor
    assert found('nobody') == []
    assert found('  ') == ['12 Oak St', '99 Pine Ave']  # blank search = everything


def test_paging_returns_one_page_and_the_full_count(session):
    for n in range(25):
        add_project(session, f'Client {n}', f'C-{n}', f'{n} Main St')
    first, total = search(session, page=1, page_size=20)
    second, total2 = search(session, page=2, page_size=20)
    assert (len(first), total) == (20, 25)
    assert (len(second), total2) == (5, 25)
    assert not {i['id'] for i in first} & {i['id'] for i in second}

    matching, total = search(session, 'client 1', page=1, page_size=5)
    # Client 1 and Client 10..19
    assert (len(matching), total) == (5, 11)
