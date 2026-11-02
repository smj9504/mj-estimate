"""When CompanyCam can't list a project's photos that has to read as a failure, not as a
project with no photos: the webhook trashes whatever is missing from the list."""

import asyncio
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
import json
import sys

import httpx
import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory
from app.core.database_factory import Base, SQLiteDatabase
from app.domains.client import claim_companycam
from app.domains.client.models import Claim, Client
from app.domains.file.models import File
from app.domains.integrations.companycam import project_search, webhook_handler_wm
from app.domains.integrations.companycam.client import CompanyCamClient
from app.domains.integrations.companycam.webhook_handler_wm import CompanyCamWaterMitigationHandler
from app.domains.integrations.models import CompanyCamPhoto
from app.domains.water_mitigation.models import WaterMitigationJob, WMPhoto
from app.main import app as _app  # noqa: F401 - registers every model the mappers refer to


@compiles(JSONB, 'sqlite')
def jsonb_as_json(type_, compiler, **kw):
    return 'JSON'


def not_found(*args, **kwargs):
    request = httpx.Request('GET', 'https://api.companycam.com/v2/projects/1/photos')
    raise httpx.HTTPStatusError('404', request=request, response=httpx.Response(404, request=request))


@pytest.fixture
def failing_list(monkeypatch):
    monkeypatch.setattr(CompanyCamClient, 'list_project_photos', not_found)


@pytest.fixture
def db(tmp_path):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF'))
    tables = [Client, Claim, WaterMitigationJob, WMPhoto, File, CompanyCamPhoto]
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in tables])
    return database


class FakeCache:
    def __init__(self):
        self.values = {}

    async def get(self, key):
        return self.values.get(key)

    async def set(self, key, value, ttl=3600):
        self.values[key] = value
        return True


def test_a_failed_list_raises_rather_than_coming_back_empty(failing_list):
    with pytest.raises(httpx.HTTPError):
        asyncio.run(CompanyCamClient(api_key='test').get_project_photos(1))


def test_a_webhook_during_an_outage_trashes_nothing(db, failing_list, monkeypatch):
    # As it stands the handler stops at its first line: this result requires a photo_id
    # it doesn't have, so project.updated never gets this far. The stand-in lets the test
    # reach the list, for when that's fixed
    monkeypatch.setattr(webhook_handler_wm, 'PhotoProcessingResult', lambda **fields: SimpleNamespace(**fields))
    session = db.get_session()
    job = WaterMitigationJob(property_address='4215 Middlebrook St', companycam_project_id='1')
    session.add(job)
    session.flush()
    session.add(WMPhoto(
        job_id=job.id, source='companycam', external_id='555', file_name='a.jpg', file_path='/x', is_trashed=False,
    ))
    session.commit()

    handler = object.__new__(CompanyCamWaterMitigationHandler)
    handler.db = session
    handler.companycam_client = CompanyCamClient(api_key='test')
    handler.wm_service = SimpleNamespace(get_by_companycam_project=lambda project_id: job)
    handler.slack_client = SimpleNamespace()

    result = asyncio.run(handler.handle_project_updated({'payload': {'project': {'id': 1}}}))

    assert result.success is False
    session.expire_all()
    photo = session.query(WMPhoto).one()
    assert photo.is_trashed is False
    assert photo.trash_reason is None
    session.close()


@pytest.fixture
def claim_id(db, monkeypatch):
    monkeypatch.setattr(database_factory, 'get_database', lambda: db)
    monkeypatch.setattr(claim_companycam, 'get_database', lambda: db)
    monkeypatch.setattr(claim_companycam, 'get_cache', lambda: cache)
    cache = FakeCache()
    session = db.get_session()
    client = Client(display_name='Pat Client', owners=[], address='4215 Middlebrook St')
    session.add(client)
    session.flush()
    claim = Claim(client_id=client.id, claim_number='46-0S0M464', status='open')
    session.add(claim)
    session.commit()
    claim_id = str(claim.id)
    session.close()
    return claim_id


def test_a_claim_import_during_an_outage_says_it_failed(claim_id, failing_list):
    asyncio.run(claim_companycam.run_import(claim_id, 1))

    status = asyncio.run(claim_companycam.import_status(claim_id))
    assert status['status'] == 'failed'
    assert 'CompanyCam import failed' in status['message']


def test_the_dates_of_a_project_that_cannot_be_read_are_an_error(claim_id, failing_list):
    with pytest.raises(httpx.HTTPError):
        asyncio.run(claim_companycam.photo_dates(claim_id, '1'))


def test_a_deleted_project_is_not_offered(monkeypatch):
    project = {
        'name': '4215 Middlebrook St',
        'address': {'street_address_1': '4215 Middlebrook St', 'city': 'Fairfax', 'state': 'VA', 'postal_code': '22032'},
    }

    async def search(self, query, per_page=50):
        return [
            {'id': 1, 'status': 'deleted', **project},
            {'id': 2, 'status': 'active', **project},
        ]

    monkeypatch.setattr(CompanyCamClient, 'search_projects', search)
    monkeypatch.setattr(project_search, 'CompanyCamClient', lambda *a, **k: CompanyCamClient(api_key='test'))

    found = asyncio.run(project_search.search_projects_by_address('4215 Middlebrook St', 'Fairfax', 'VA', '22032'))

    assert [str(p['id']) for p in found['projects']] == ['2']
