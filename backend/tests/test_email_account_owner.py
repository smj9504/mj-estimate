"""My Profile lists each person's own email accounts whatever their role:
accounts added from there are theirs, the owner can always manage them, and
the migration hands existing accounts to the staff member with the same login
email. Run through the email ingestion API on a throwaway SQLite database."""

from datetime import datetime
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi.testclient import TestClient
from sqlalchemy.dialects.postgresql import ARRAY, INET, JSONB, UUID as PG_UUID
from sqlalchemy.ext.compiler import compiles

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from app.core import database_factory  # noqa: E402
from app.core.database_factory import Base, SQLiteDatabase  # noqa: E402
from app.domains.auth.dependencies import get_current_staff  # noqa: E402
from app.domains.company.models import Company  # noqa: E402
from app.domains.email_ingestion.models import EmailAccount  # noqa: E402
from app.domains.staff.models import Staff, StaffCompany, StaffRole  # noqa: E402
from app.main import app  # noqa: E402


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


ROLES = {
    'admin': StaffRole.admin,
    'alice': StaffRole.staff,
    'bob': StaffRole.staff,
    'pam': StaffRole.public_adjuster,
    'nobody': StaffRole.staff,
}
BASE = '/api/email-ingestion/accounts'


@pytest.fixture
def env(tmp_path, monkeypatch):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(
        database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF')
    )
    for table in Base.metadata.sorted_tables:
        try:
            table.create(database.engine, checkfirst=True)
        except Exception:
            pass
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)

    session = database.get_session()
    ours = Company(name='Rebuild Inc', company_type='contractor')
    pa_co = Company(name='PA Co', company_type='public_adjuster')
    session.add(ours)
    session.add(pa_co)
    staff = {
        name: Staff(
            staff_number=f'S-{name}', first_name=name, last_name='Test',
            email=f'{name}@example.com', username=name,
            role=role, hire_date=datetime(2026, 1, 1),
        )
        for name, role in ROLES.items()
    }
    for row in staff.values():
        session.add(row)
    session.flush()
    for name in ('alice', 'bob'):
        session.add(StaffCompany(staff_id=staff[name].id, company_id=ours.id))
    session.add(StaffCompany(staff_id=staff['pam'].id, company_id=pa_co.id))
    session.commit()
    ids = {name: str(row.id) for name, row in staff.items()}
    ids['ours'] = str(ours.id)
    ids['pa_co'] = str(pa_co.id)
    session.close()

    current = {}
    app.dependency_overrides[get_current_staff] = lambda: current['staff']

    def get_db():
        session = database.get_session()
        try:
            yield session
            session.commit()
        finally:
            session.close()
    app.dependency_overrides[database_factory.get_db_session] = get_db

    def as_(name):
        current['staff'] = SimpleNamespace(id=ids[name], role=ROLES[name], username=name)
        return TestClient(app, raise_server_exceptions=True)

    yield as_, ids, database
    app.dependency_overrides.pop(get_current_staff, None)
    app.dependency_overrides.pop(database_factory.get_db_session, None)


def account(address, company_id=None):
    return {
        'display_name': address, 'email_address': address, 'provider_type': 'gmail',
        'username': address, 'password': 'app-pass', 'company_id': company_id,
    }


def addresses(response):
    assert response.status_code == 200, response.text
    return sorted(a['email_address'] for a in response.json())


def test_profile_lists_only_your_own_accounts_whatever_your_role(env):
    as_, ids, _ = env
    r = as_('alice').post(BASE, params={'mine': True}, json=account('alice@work.com', ids['ours']))
    assert r.status_code == 200, r.text
    assert r.json()['owner_staff_id'] == ids['alice']
    # Added from the Email Ingestion page: the company's, nobody's own
    assert as_('bob').post(BASE, json=account('claims@work.com', ids['ours'])).status_code == 200
    assert as_('pam').post(BASE, params={'mine': True}, json=account('pam@pa.com', ids['pa_co'])).status_code == 200
    assert as_('admin').post(BASE, params={'mine': True}, json=account('boss@work.com')).status_code == 200

    assert addresses(as_('alice').get(BASE, params={'mine': True})) == ['alice@work.com']
    assert addresses(as_('bob').get(BASE, params={'mine': True})) == []
    assert addresses(as_('pam').get(BASE, params={'mine': True})) == ['pam@pa.com']
    assert addresses(as_('admin').get(BASE, params={'mine': True})) == ['boss@work.com']

    # The company list is as before
    assert addresses(as_('bob').get(BASE)) == ['alice@work.com', 'claims@work.com']
    assert addresses(as_('admin').get(BASE)) == [
        'alice@work.com', 'boss@work.com', 'claims@work.com', 'pam@pa.com',
    ]


def test_someone_with_no_company_cant_add_one_but_an_admin_can(env):
    as_, ids, _ = env
    assert as_('nobody').post(BASE, params={'mine': True}, json=account('n@x.com')).status_code == 400
    assert as_('admin').post(BASE, params={'mine': True}, json=account('a@x.com')).status_code == 200


def test_the_owner_manages_their_account_even_under_another_company(env):
    as_, ids, database = env
    session = database.get_session()
    row = EmailAccount(
        display_name='Alice old', email_address='alice@old.com', username='alice@old.com',
        encrypted_password='x', company_id=ids['pa_co'], owner_staff_id=ids['alice'],
    )
    session.add(row)
    session.commit()
    account_id = str(row.id)
    session.close()

    assert as_('alice').put(f'{BASE}/{account_id}', json={'sender_name': 'Alice'}).status_code == 200
    # Someone else in Alice's company can't reach it: it isn't under their company
    assert as_('bob').put(f'{BASE}/{account_id}', json={'sender_name': 'Bob'}).status_code == 404
    assert as_('alice').delete(f'{BASE}/{account_id}').status_code == 200


def test_the_migration_gives_existing_accounts_to_the_staff_with_that_email(env):
    as_, ids, database = env
    session = database.get_session()
    for address in ('alice@example.com', ' Bob@Example.COM ', 'claims@example.com'):
        session.add(EmailAccount(
            display_name=address, email_address=address, username=address,
            encrypted_password='x', company_id=ids['ours'],
        ))
    session.commit()
    session.close()

    path = BACKEND / 'alembic' / 'versions' / 'em20261106ow01_email_account_owner.py'
    spec = importlib.util.spec_from_file_location('em20261106ow01', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with database.engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            migration.upgrade()

    session = database.get_session()
    owners = {
        a.email_address.strip().lower(): (str(a.owner_staff_id) if a.owner_staff_id else None)
        for a in session.query(EmailAccount).all()
    }
    session.close()
    assert owners == {
        'alice@example.com': ids['alice'],
        'bob@example.com': ids['bob'],
        'claims@example.com': None,
    }
