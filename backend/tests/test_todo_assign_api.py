"""Adding a todo on the board for other people: it's for the person adding it
unless they pick who it's for, and everyone picked must be able to sign in and
see the client it's tied to. On a throwaway SQLite database."""

from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
import sqlite3
import sys
import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
import sqlalchemy as sa

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory
from app.core.database_factory import Base, SQLiteDatabase, get_db_session
from app.domains.auth.dependencies import get_current_staff
from app.domains.client import api as client_api
from app.domains.client.models import Claim, ClaimTodo, ClaimTodoAssignee, Client
from app.domains.company.models import Company
from app.domains.contract.models import ClaimCompany
from app.domains.staff.models import Staff, StaffCompany, StaffRole
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401

sqlite3.register_adapter(uuid.UUID, str)

TABLES = [Staff, StaffCompany, Company, Client, Claim, ClaimCompany, ClaimTodo, ClaimTodoAssignee]


def make_staff(first, role, **over):
    return Staff(
        staff_number=f'S-{first}', first_name=first, last_name='Test',
        email=f'{first.lower()}@example.com', username=first.lower(),
        role=role, hire_date=datetime(2026, 1, 1), **over,
    )


@pytest.fixture
def env(tmp_path, monkeypatch):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF'))
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in TABLES])
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)

    session = database.get_session()
    me = make_staff('Minjee', StaffRole.admin)
    alex = make_staff('Alex', StaffRole.admin)
    field = make_staff('Field', StaffRole.contractor)
    gone = make_staff('Gone', StaffRole.admin, is_active=False)
    bethany = Company(name='Bethany', company_type='contractor', is_active=True)
    other = Company(name='Other', company_type='contractor', is_active=True)
    for row in (me, alex, field, gone, bethany, other):
        session.add(row)
    session.flush()
    ours = Client(display_name='Pat Client', owners=[], company_id=bethany.id, is_active=True)
    theirs = Client(display_name='Sam Client', owners=[], company_id=other.id, is_active=True)
    session.add(ours)
    session.add(theirs)
    session.add(StaffCompany(staff_id=field.id, company_id=bethany.id))
    session.commit()
    ids = {
        'me': str(me.id), 'alex': str(alex.id), 'field': str(field.id), 'gone': str(gone.id),
        'ours': str(ours.id), 'theirs': str(theirs.id),
    }
    roles = {'me': StaffRole.admin, 'alex': StaffRole.admin, 'field': StaffRole.contractor}
    session.close()

    api = FastAPI()
    api.include_router(client_api.todo_router, prefix='/todos')

    def get_db():
        db = database.get_session()
        try:
            yield db
            db.commit()
        finally:
            db.close()

    current = {'as': 'me'}
    api.dependency_overrides[get_db_session] = get_db
    api.dependency_overrides[get_current_staff] = lambda: SimpleNamespace(
        id=ids[current['as']], role=roles[current['as']],
    )
    return SimpleNamespace(http=TestClient(api), ids=ids, current=current, database=database)


def board(env, who):
    env.current['as'] = who
    titles = [t['title'] for t in env.http.get('/todos/').json()]
    env.current['as'] = 'me'
    return titles


def test_a_new_todo_is_for_the_person_adding_it_by_default(env):
    todo = env.http.post('/todos/', json={'title': 'Call adjuster'}).json()
    assert todo['owner_id'] == env.ids['me']
    assert [a['id'] for a in todo['assignees']] == [env.ids['me']]
    assert board(env, 'me') == ['Call adjuster'] and board(env, 'alex') == []


def test_a_todo_for_someone_else_is_on_their_board_not_mine(env):
    todo = env.http.post('/todos/', json={'title': 'Order dumpster', 'assignee_ids': [env.ids['alex']]}).json()
    assert todo['owner_id'] == env.ids['alex']
    assert board(env, 'alex') == ['Order dumpster'] and board(env, 'me') == []


def test_picking_myself_and_others_puts_me_first(env):
    todo = env.http.post('/todos/', json={
        'title': 'Walk the site', 'client_id': env.ids['ours'],
        'assignee_ids': [env.ids['alex'], env.ids['field'], env.ids['me'], env.ids['alex']],
    }).json()
    assert todo['owner_id'] == env.ids['me']
    assert [a['id'] for a in todo['assignees']][0] == env.ids['me']
    assert {a['id'] for a in todo['assignees']} == {env.ids['me'], env.ids['alex'], env.ids['field']}
    for who in ('me', 'alex', 'field'):
        assert board(env, who) == ['Walk the site']


def test_someone_must_be_picked_and_able_to_sign_in(env):
    empty = env.http.post('/todos/', json={'title': 'Nobody', 'assignee_ids': []})
    assert empty.status_code == 400
    gone = env.http.post('/todos/', json={'title': 'Gone', 'assignee_ids': [env.ids['gone']]})
    assert gone.status_code == 400
    unknown = env.http.post('/todos/', json={'title': 'Unknown', 'assignee_ids': [str(uuid.uuid4())]})
    assert unknown.status_code == 400
    session = env.database.get_session()
    try:
        assert session.query(ClaimTodo).count() == 0
    finally:
        session.close()


def test_everyone_picked_must_see_the_client(env):
    response = env.http.post('/todos/', json={
        'title': 'Theirs', 'client_id': env.ids['theirs'], 'assignee_ids': [env.ids['me'], env.ids['field']],
    })
    assert response.status_code == 400 and "can't see this client" in response.json()['detail']
    assert board(env, 'me') == []


def test_an_assignee_can_finish_a_todo_someone_else_made(env):
    todo = env.http.post('/todos/', json={
        'title': 'Shared', 'assignee_ids': [env.ids['me'], env.ids['field']],
    }).json()
    env.current['as'] = 'field'
    assert env.http.patch(f"/todos/{todo['id']}", json={'status': 'done'}).status_code == 200
    env.current['as'] = 'me'
    [mine] = env.http.get('/todos/').json()
    assert mine['status'] == 'done'
