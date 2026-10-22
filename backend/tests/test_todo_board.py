"""The todo board: each person's todos with or without a client, three columns,
drag order, and the client page that shows everyone's, on a throwaway SQLite
database."""

from datetime import datetime
from pathlib import Path
import sys

import pytest
import sqlalchemy as sa

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory
from app.core.database_factory import Base, SQLiteDatabase
from app.domains.client.models import Claim, ClaimTodo, Client
from app.domains.client.service import ClaimTodoService
from app.domains.staff.models import Staff, StaffRole
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401

TABLES = [Staff, Client, Claim, ClaimTodo]


def make_staff(first, last):
    return Staff(
        staff_number=f'S-{first}', first_name=first, last_name=last,
        email=f'{first.lower()}@example.com', username=first.lower(),
        role=list(StaffRole)[0], hire_date=datetime(2026, 1, 1),
    )


@pytest.fixture
def env(tmp_path, monkeypatch):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    # Only the tables this service touches; the rest use Postgres-only types,
    # so foreign keys pointing at them can't be checked
    sa.event.listen(
        database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF')
    )
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in TABLES])
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)

    session = database.get_session()
    me = make_staff('Minjee', 'Song')
    teammate = make_staff('Alex', 'Kim')
    pat = Client(display_name='Pat Client', owners=[])
    sam = Client(display_name='Sam Client', owners=[])
    for row in (me, teammate, pat, sam):
        session.add(row)
    session.flush()
    claim = Claim(client_id=pat.id, claim_number='057791811', status='open')
    other_claim = Claim(client_id=pat.id, claim_number='99887766', status='open')
    session.add(claim)
    session.add(other_claim)
    session.commit()
    ids = {
        'me': str(me.id), 'teammate': str(teammate.id),
        'pat': str(pat.id), 'sam': str(sam.id),
        'claim': str(claim.id), 'other_claim': str(other_claim.id),
    }
    session.close()
    return ClaimTodoService(database), ids


def titles(todos, status=None):
    return [t['title'] for t in todos if status is None or t['status'] == status]


def test_new_todos_go_to_the_top_of_to_do(env):
    service, ids = env
    service.create_todo({'title': 'Call adjuster', 'owner_id': ids['me']})
    service.create_todo({'title': 'Order dumpster', 'client_id': ids['sam'], 'owner_id': ids['me']})

    todos = service.list_todos(owner_id=ids['me'])
    assert titles(todos) == ['Order dumpster', 'Call adjuster']
    assert todos[0]['client_name'] == 'Sam Client'
    assert todos[1]['client_id'] is None
    assert all(t['status'] == 'todo' and not t['is_completed'] for t in todos)


def test_each_person_has_their_own_board(env):
    service, ids = env
    service.create_todo({'title': 'Mine', 'owner_id': ids['me']})
    service.create_todo({'title': 'Theirs', 'owner_id': ids['teammate']})
    # From before the board: no owner, so on nobody's board
    service.create_todo({'title': 'Old claim todo', 'claim_id': ids['claim']})

    assert titles(service.list_todos(owner_id=ids['me'])) == ['Mine']
    assert titles(service.list_todos(owner_id=ids['teammate'])) == ['Theirs']

    # A teammate's new todo lands on top of their own column, not under mine
    first = service.create_todo({'title': 'Their second', 'owner_id': ids['teammate']})
    assert first['sort_order'] == -1


def test_a_claim_todo_takes_the_claim_client(env):
    service, ids = env
    todo = service.create_todo({'title': 'Send contract', 'claim_id': ids['claim'], 'owner_id': ids['me']})

    assert todo['client_id'] == ids['pat']
    assert todo['claim_number'] == '057791811'
    assert todo['owner_name'] == 'Minjee Song'


def test_status_moves_the_todo_and_keeps_completion_in_step(env):
    service, ids = env
    first = service.create_todo({'title': 'First', 'owner_id': ids['me']})
    second = service.create_todo({'title': 'Second', 'owner_id': ids['me']})

    service.update_todo(first['id'], {'status': 'in_progress'})
    done = service.update_todo(second['id'], {'status': 'done'})
    assert done['is_completed'] is True and done['completed_at']

    todos = service.list_todos(owner_id=ids['me'])
    assert [(t['title'], t['status']) for t in todos] == [('First', 'in_progress'), ('Second', 'done')]

    reopened = service.update_todo(second['id'], {'status': 'todo'})
    assert reopened['is_completed'] is False and reopened['completed_at'] is None


def test_the_claim_checkbox_still_completes_and_reopens(env):
    service, ids = env
    todo = service.create_todo({'title': 'Upload photos', 'claim_id': ids['claim']})

    assert service.update_todo(todo['id'], {'is_completed': True})['status'] == 'done'
    assert service.update_todo(todo['id'], {'is_completed': False})['status'] == 'todo'


def test_reorder_sets_the_column_order_and_moves_dragged_in_todos(env):
    service, ids = env
    me = ids['me']
    a = service.create_todo({'title': 'A', 'owner_id': me})
    b = service.create_todo({'title': 'B', 'owner_id': me})
    c = service.create_todo({'title': 'C', 'owner_id': me})
    started = service.create_todo({'title': 'Started', 'status': 'in_progress', 'owner_id': me})

    # C is dragged from To do into In progress, under Started
    service.reorder_todos(me, 'in_progress', [started['id'], c['id']])
    service.reorder_todos(me, 'todo', [a['id'], b['id']])

    todos = service.list_todos(owner_id=me)
    assert titles(todos, 'todo') == ['A', 'B']
    assert titles(todos, 'in_progress') == ['Started', 'C']

    # Dropped into Done, it counts as completed
    service.reorder_todos(me, 'done', [a['id']])
    moved = next(t for t in service.list_todos(owner_id=me) if t['id'] == a['id'])
    assert moved['status'] == 'done' and moved['is_completed'] is True


def test_reorder_leaves_other_people_todos_alone(env):
    service, ids = env
    theirs = service.create_todo({'title': 'Theirs', 'owner_id': ids['teammate']})

    assert service.reorder_todos(ids['me'], 'done', [theirs['id']]) == 0
    assert service.list_todos(owner_id=ids['teammate'])[0]['status'] == 'todo'


def test_a_claim_lists_its_todos_and_the_client_general_ones_from_everyone(env):
    service, ids = env
    service.create_todo({'title': 'On this claim', 'claim_id': ids['claim'], 'owner_id': ids['me']})
    service.create_todo({'title': 'Old claim todo', 'claim_id': ids['claim']})
    service.create_todo({'title': 'On the other claim', 'claim_id': ids['other_claim'], 'owner_id': ids['me']})
    service.create_todo({'title': 'For the client', 'client_id': ids['pat'], 'owner_id': ids['teammate']})
    service.create_todo({'title': 'Another client', 'client_id': ids['sam'], 'owner_id': ids['me']})
    service.create_todo({'title': 'No client', 'owner_id': ids['me']})

    on_claim = service.list_todos(client_id=ids['pat'], claim_id=ids['claim'])
    assert sorted(titles(on_claim)) == ['For the client', 'Old claim todo', 'On this claim']
    owners = {t['title']: t['owner_name'] for t in on_claim}
    assert owners == {'For the client': 'Alex Kim', 'Old claim todo': None, 'On this claim': 'Minjee Song'}

    for_client = service.list_todos(client_id=ids['pat'])
    assert sorted(titles(for_client)) == [
        'For the client', 'Old claim todo', 'On the other claim', 'On this claim',
    ]


def test_another_client_takes_the_todo_off_the_old_claim(env):
    service, ids = env
    todo = service.create_todo({'title': 'Send contract', 'claim_id': ids['claim'], 'owner_id': ids['me']})

    moved = service.update_todo(todo['id'], {'client_id': ids['sam']})
    assert moved['client_id'] == ids['sam'] and moved['claim_id'] is None
    assert moved['client_name'] == 'Sam Client' and moved['claim_number'] is None

    cleared = service.update_todo(todo['id'], {'client_id': None})
    assert cleared['client_id'] is None

    # Saving the same client keeps the claim
    kept = service.create_todo({'title': 'Keep claim', 'claim_id': ids['claim'], 'owner_id': ids['me']})
    assert service.update_todo(kept['id'], {'client_id': ids['pat'], 'title': 'Kept'})['claim_id'] == ids['claim']
