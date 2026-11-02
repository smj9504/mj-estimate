"""Cheat sheet rows and rules are common or occasional. Runs the API on a
throwaway SQLite database."""

from pathlib import Path
import sys
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.ext.compiler import compiles

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory  # noqa: E402
from app.core.database_factory import SQLiteDatabase  # noqa: E402
from app.domains.cheatsheet import service as cheatsheet_service  # noqa: E402
from app.domains.cheatsheet.api import router  # noqa: E402
from app.domains.cheatsheet.models import (  # noqa: E402
    CheatsheetRow,
    CheatsheetRule,
    CheatsheetSection,
    CheatsheetTable,
)
from app.domains.cheatsheet.repository import (  # noqa: E402
    CheatsheetRowRepo,
    CheatsheetRuleRepo,
    CheatsheetTableRepo,
)


@compiles(JSONB, 'sqlite')
def _jsonb(type_, compiler, **kw):
    return 'JSON'


@compiles(PG_UUID, 'sqlite')
def _uuid(type_, compiler, **kw):
    return 'CHAR(32)'


@pytest.fixture
def client(tmp_path, monkeypatch):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    for model in (CheatsheetSection, CheatsheetRule, CheatsheetTable, CheatsheetRow):
        model.__table__.create(database.engine)
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)
    monkeypatch.setattr(cheatsheet_service, 'get_database', lambda: database)

    # The API hands parent ids over as strings, which Postgres takes and
    # SQLite's UUID type refuses; turn them into UUIDs as Postgres would
    for repo, parent in (
        (CheatsheetTableRepo, 'section_id'),
        (CheatsheetRuleRepo, 'section_id'),
        (CheatsheetRowRepo, 'table_id'),
    ):
        def create(self, _create=repo.create, _parent=parent, **fields):
            fields[_parent] = uuid.UUID(fields[_parent])
            return _create(self, **fields)
        monkeypatch.setattr(repo, 'create', create)

    app = FastAPI()
    app.include_router(router, prefix='/api/cheatsheet')
    return TestClient(app)


@pytest.fixture
def table(client):
    section = client.post('/api/cheatsheet/sections', json={
        'section_key': 'carpet', 'title': 'Carpet', 'tag': 'FCC', 'nav_group': 'Flooring',
    }).json()
    created = client.post('/api/cheatsheet/tables', json={
        'section_id': section['id'],
        'columns': [{'title': 'Line Item', 'dataIndex': 'item', 'key': 'item', 'render': 'code'}],
    }).json()
    return {'section_id': section['id'], 'table_id': created['id']}


def add_row(client, table, **fields):
    return client.post('/api/cheatsheet/rows', json={
        'table_id': table['table_id'], 'row_key': 'c1', 'data': {'item': '`FCC AV` Carpet'}, **fields,
    }).json()


def test_a_new_row_or_rule_is_common_unless_told_otherwise(client, table):
    assert add_row(client, table)['is_common'] is True
    assert add_row(client, table, is_common=False)['is_common'] is False

    rule = {'section_id': table['section_id'], 'title': 'Waste', 'items': ['a']}
    assert client.post('/api/cheatsheet/rules', json=rule).json()['is_common'] is True
    assert client.post('/api/cheatsheet/rules', json={**rule, 'is_common': False}).json()['is_common'] is False


def test_a_row_moves_to_occasional_and_back(client, table):
    row = add_row(client, table)

    moved = client.put(f"/api/cheatsheet/rows/{row['id']}", json={'is_common': False}).json()
    assert moved['is_common'] is False

    back = client.put(f"/api/cheatsheet/rows/{row['id']}", json={'is_common': True}).json()
    assert back['is_common'] is True


def test_editing_a_row_leaves_it_where_it_is(client, table):
    row = add_row(client, table, is_common=False)

    edited = client.put(f"/api/cheatsheet/rows/{row['id']}", json={'data': {'item': 'changed'}}).json()
    assert edited['is_common'] is False
    assert edited['data'] == {'item': 'changed'}

    noted = client.patch(f"/api/cheatsheet/rows/{row['id']}/note", json={'note': 'memo'}).json()
    assert noted['is_common'] is False


def test_a_rule_moves_to_occasional(client, table):
    rule = client.post('/api/cheatsheet/rules', json={
        'section_id': table['section_id'], 'title': 'Waste', 'items': ['a'],
    }).json()

    moved = client.put(f"/api/cheatsheet/rules/{rule['id']}", json={'is_common': False}).json()
    assert moved['is_common'] is False
    assert moved['items'] == ['a']


def test_the_sheet_says_which_is_which(client, table):
    add_row(client, table, is_common=False)

    section = client.get('/api/cheatsheet/sections').json()[0]
    assert section['tables'][0]['rows'][0]['is_common'] is False
