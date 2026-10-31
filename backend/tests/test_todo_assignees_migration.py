"""Migration os20261031ta01 on a throwaway SQLite database: every owned todo gets
its owner as an assignee, and the copies made per admin for one contract task
become one todo assigned to all of them."""

from datetime import datetime, timedelta
from pathlib import Path
import importlib.util
import sys
import uuid

from alembic.migration import MigrationContext
from alembic.operations import Operations
import sqlalchemy as sa

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

VERSIONS = Path(__file__).resolve().parents[1] / 'alembic' / 'versions'


def load_migration():
    spec = importlib.util.spec_from_file_location(
        'todo_assignees', VERSIONS / 'os20261031ta01_todo_assignees.py',
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_copies_become_one_todo_with_their_owners_assigned(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'm.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE staff (id CHAR(36) PRIMARY KEY)"))
        conn.execute(sa.text(
            "CREATE TABLE claim_todos (id CHAR(36) PRIMARY KEY, owner_id CHAR(36), contract_id CHAR(36), "
            "contract_task VARCHAR(30), status VARCHAR(20), sort_order INTEGER, created_at TIMESTAMP)"
        ))
        a, b, c = (str(uuid.uuid4()) for _ in range(3))
        for person in (a, b, c):
            conn.execute(sa.text("INSERT INTO staff (id) VALUES (:id)"), {'id': person})
        contract, other_contract = str(uuid.uuid4()), str(uuid.uuid4())
        start = datetime(2026, 10, 30)
        todos = {
            # Three admins' copies of one contract task; the first was finished by hand
            'a-done': (a, contract, 'assign_claim', 'done', 0, start),
            'b-open': (b, contract, 'assign_claim', 'todo', -2, start + timedelta(seconds=1)),
            'c-open': (c, contract, 'assign_claim', 'todo', 5, start + timedelta(seconds=2)),
            # Another task on the same contract stays its own todo
            'a-sign': (a, contract, 'company_signature', 'todo', 1, start),
            # A todo of one's own, and one from before the board with no owner
            'own': (b, None, None, 'in_progress', 3, start),
            'legacy': (None, other_contract, 'assign_claim', 'todo', 0, start),
        }
        ids = {}
        for name, (owner, contract_id, task, status, order, created) in todos.items():
            ids[name] = str(uuid.uuid4())
            conn.execute(sa.text(
                "INSERT INTO claim_todos VALUES (:id, :owner, :contract, :task, :status, :order, :created)"
            ), {'id': ids[name], 'owner': owner, 'contract': contract_id, 'task': task,
                'status': status, 'order': order, 'created': created})

        context = MigrationContext.configure(conn)
        with Operations.context(context):
            load_migration().upgrade()

        left = {row.id for row in conn.execute(sa.text("SELECT id FROM claim_todos"))}
        assignees = {}
        for row in conn.execute(sa.text("SELECT todo_id, staff_id, sort_order FROM claim_todo_assignees")):
            assignees.setdefault(row.todo_id, {})[row.staff_id] = row.sort_order

    # The open copy that came first is kept, assigned to all three at their own places
    assert left == {ids['b-open'], ids['a-sign'], ids['own'], ids['legacy']}
    assert assignees[ids['b-open']] == {b: -2, a: 0, c: 5}
    assert assignees[ids['a-sign']] == {a: 1}
    assert assignees[ids['own']] == {b: 3}
    assert ids['legacy'] not in assignees
