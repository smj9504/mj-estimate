"""Security audit 2026-11, findings 9 and 13.

9. A saved mailbox password or Google token must never be sent to a server it
   wasn't saved for, and someone's own mailbox is managed (edited, tested,
   deleted) only by its owner or an admin.
13. Mail goes out only from an account the sender may use: their own, one of
   their companies' (any account in the company - user's rule 2026-11-05), or
   any for an admin. Lists that feed the From pickers follow the same rule.

Runs through the API on a throwaway SQLite database. Names and addresses are
made up.
"""

from datetime import datetime
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.dialects.postgresql import ARRAY, INET, JSONB, UUID as PG_UUID
from sqlalchemy.ext.compiler import compiles

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from app.core import database_factory  # noqa: E402
from app.core.database_factory import Base, SQLiteDatabase  # noqa: E402
from app.domains.auth.dependencies import get_current_staff  # noqa: E402
from app.domains.claim_followup.service import (  # noqa: E402
    ClaimFollowUpService, require_sending_account,
)
from app.domains.claim_followup.smtp_service import SmtpService  # noqa: E402
from app.domains.company.models import Company  # noqa: E402
from app.domains.email_ingestion import access  # noqa: E402
from app.domains.email_ingestion.models import EmailAccount  # noqa: E402
from app.domains.email_ingestion.service import (  # noqa: E402
    EmailIngestionService, decrypt_password, encrypt_password,
)
from app.domains.staff.models import Staff, StaffCompany, StaffRole  # noqa: E402
from app.domains.water_mitigation.adjuster_email_service import AdjusterEmailService  # noqa: E402
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

    def add_account(address, company=None, owner=None, **fields):
        row = EmailAccount(
            display_name=address, email_address=address, username=address,
            encrypted_password=encrypt_password('saved-app-pass'),
            company_id=ids[company] if company else None,
            owner_staff_id=ids[owner] if owner else None,
            **fields,
        )
        session.add(row)
        session.commit()
        return str(row.id)

    accounts = {
        'shared_ours': add_account('claims@rebuild.example', 'ours'),
        'alice_own': add_account('alice@rebuild.example', 'ours', 'alice'),
        'shared_pa': add_account('desk@pa-co.example', 'pa_co'),
        'pam_own': add_account('pam@pa-co.example', 'pa_co', 'pam'),
        'admin_own': add_account('boss@rebuild.example', None, 'admin'),
        'google': add_account(
            'bob@rebuild.example', 'ours', 'bob', auth_method='oauth',
            oauth_refresh_token='encrypted-refresh',
        ),
    }

    current = {}
    app.dependency_overrides[get_current_staff] = lambda: current['staff']

    def get_db():
        db = database.get_session()
        try:
            yield db
            db.commit()
        finally:
            db.close()
    app.dependency_overrides[database_factory.get_db_session] = get_db

    def who(name):
        if name == 'system':
            return access.SYSTEM_SENDER
        return SimpleNamespace(id=ids[name], role=ROLES[name], username=name, email=f'{name}@example.com')

    def as_(name):
        current['staff'] = who(name)
        return TestClient(app, raise_server_exceptions=True)

    yield SimpleNamespace(
        as_=as_, who=who, ids=ids, accounts=accounts, database=database, session=session,
    )
    session.close()
    app.dependency_overrides.pop(get_current_staff, None)
    app.dependency_overrides.pop(database_factory.get_db_session, None)


def stored(env, account_id):
    env.session.expire_all()
    return env.session.query(EmailAccount).filter(EmailAccount.id == account_id).one()


def full_form(env, account_id, **changes):
    """What the Email Accounts edit form sends: every field, changed or not."""
    row = stored(env, account_id)
    payload = {
        'display_name': row.display_name, 'email_address': row.email_address,
        'provider_type': row.provider_type, 'imap_server': row.imap_server,
        'imap_port': row.imap_port, 'use_ssl': row.use_ssl, 'username': row.username,
        'company_id': str(row.company_id) if row.company_id else None,
        'can_send': row.can_send, 'is_active': row.is_active,
    }
    payload.update(changes)
    return payload


# ------------------------------------------------- 9: who manages an account

def test_a_colleague_cannot_change_test_or_delete_someone_elses_own_mailbox(env, monkeypatch):
    tested = []
    monkeypatch.setattr(EmailIngestionService, 'test_account', lambda self, aid: tested.append(aid) or {
        'success': True, 'message': 'ok', 'inbox_count': 0,
    })
    alice_own = env.accounts['alice_own']
    bob = env.as_('bob')
    # Same company: Bob still sees it (and may send from it, user's rule) ...
    assert bob.get(f'{BASE}/{alice_own}').status_code == 200
    # ... but can't touch it
    assert bob.put(f'{BASE}/{alice_own}', json={'sender_name': 'Bob'}).status_code == 403
    assert bob.post(f'{BASE}/{alice_own}/test').status_code == 403
    assert bob.delete(f'{BASE}/{alice_own}').status_code == 403
    assert tested == []
    assert stored(env, alice_own).sender_name is None

    assert env.as_('alice').put(f'{BASE}/{alice_own}', json={'sender_name': 'Alice'}).status_code == 200
    assert env.as_('alice').post(f'{BASE}/{alice_own}/test').status_code == 200
    assert env.as_('admin').put(f'{BASE}/{alice_own}', json={'sender_name': 'Admin'}).status_code == 200
    assert tested == [alice_own]


def test_a_shared_inbox_stays_open_to_its_company_only(env):
    shared = env.accounts['shared_ours']
    assert env.as_('bob').put(f'{BASE}/{shared}', json={'sender_name': 'Claims'}).status_code == 200
    assert env.as_('pam').put(f'{BASE}/{shared}', json={'sender_name': 'PA'}).status_code == 404
    assert env.as_('pam').delete(f'{BASE}/{shared}').status_code == 404


# ------------------------------------- 9: the saved password stays with its server

@pytest.mark.parametrize('change', [
    {'imap_server': 'imap.attacker.example'},
    {'imap_port': 143},
    {'use_ssl': False},
    {'provider_type': 'custom', 'smtp_server': 'smtp.attacker.example'},
    {'smtp_server': 'smtp.attacker.example'},
    {'smtp_port': 25},
    {'username': 'someone-else@rebuild.example'},
])
def test_moving_a_password_account_needs_the_password_again(env, change):
    shared = env.accounts['shared_ours']
    before = stored(env, shared)
    r = env.as_('bob').put(f'{BASE}/{shared}', json=full_form(env, shared, **change))
    assert r.status_code == 400
    assert 'password again' in r.json()['detail']
    after = stored(env, shared)
    assert (after.imap_server, after.smtp_server, after.username) == (
        before.imap_server, before.smtp_server, before.username,
    )


def test_with_the_password_typed_again_the_server_can_move(env):
    shared = env.accounts['shared_ours']
    r = env.as_('bob').put(f'{BASE}/{shared}', json=full_form(
        env, shared, imap_server='imap.newhost.example', password='new-app-pass',
    ))
    assert r.status_code == 200, r.text
    row = stored(env, shared)
    assert row.imap_server == 'imap.newhost.example'
    assert decrypt_password(row.encrypted_password) == 'new-app-pass'


def test_the_edit_form_saving_unchanged_server_fields_needs_no_password(env):
    shared = env.accounts['shared_ours']
    # Same values, different case/spacing on the host: not a move
    r = env.as_('bob').put(f'{BASE}/{shared}', json=full_form(
        env, shared, imap_server=' IMAP.Gmail.com ', sender_name='Claims desk',
    ))
    assert r.status_code == 200, r.text
    assert stored(env, shared).sender_name == 'Claims desk'


@pytest.mark.parametrize('change', [
    {'imap_server': 'imap.attacker.example'},
    {'provider_type': 'custom', 'smtp_server': 'smtp.attacker.example'},
    {'imap_port': 143},
])
def test_a_google_connected_account_keeps_googles_servers(env, change):
    google = env.accounts['google']
    # Even its owner, even with a password typed
    r = env.as_('bob').put(f'{BASE}/{google}', json=full_form(env, google, password='x', **change))
    assert r.status_code == 400
    assert 'connected with Google' in r.json()['detail']
    assert stored(env, google).imap_server == 'imap.gmail.com'
    # Unchanged form is fine
    assert env.as_('bob').put(f'{BASE}/{google}', json=full_form(env, google, sender_name='Bob')).status_code == 200


def test_a_google_token_only_ever_goes_to_google_whatever_the_row_says(env, monkeypatch):
    monkeypatch.setattr(SmtpService, '_get_fresh_oauth_token', lambda self, account, session: 'google-token')
    google = env.accounts['google']
    row = stored(env, google)
    row.imap_server, row.imap_port = 'imap.attacker.example', 143
    row.provider_type, row.smtp_server, row.smtp_port = 'custom', 'smtp.attacker.example', 25
    env.session.commit()

    service = EmailIngestionService(env.database)
    account = service.get_account(google)
    client = service._build_imap_client(account)
    assert (client.server, client.port, client.use_ssl) == ('imap.gmail.com', 993, True)
    assert client.oauth_access_token == 'google-token'

    config = SmtpService()._get_account_smtp_config(google)
    assert (config['server'], config['port'], config['send_only']) == ('smtp.gmail.com', 587, False)
    assert config['oauth_access_token'] == 'google-token'


def test_a_password_account_still_connects_to_its_own_server(env):
    service = EmailIngestionService(env.database)
    client = service._build_imap_client(service.get_account(env.accounts['shared_ours']))
    assert client.server == 'imap.gmail.com'
    assert client.password == 'saved-app-pass'


# ------------------------------------------------- 13: who may send from what

ALLOWED = {
    # name: accounts they may send from
    'alice': {'shared_ours', 'alice_own', 'google'},
    'bob': {'shared_ours', 'alice_own', 'google'},   # any account in the company
    'pam': {'shared_pa', 'pam_own'},
    'nobody': set(),
    'admin': {'shared_ours', 'alice_own', 'shared_pa', 'pam_own', 'admin_own', 'google'},
    'system': {'shared_ours', 'alice_own', 'shared_pa', 'pam_own', 'admin_own', 'google'},
}


@pytest.mark.parametrize('name', sorted(ALLOWED))
def test_require_sending_account_matrix(env, name):
    staff = env.who(name)
    for key, account_id in env.accounts.items():
        if key in ALLOWED[name]:
            require_sending_account(env.session, account_id, staff=staff)
        else:
            with pytest.raises(ValueError, match="You can't send from"):
                require_sending_account(env.session, account_id, staff=staff)


def test_nobody_signed_in_is_not_a_free_pass(env):
    with pytest.raises(ValueError, match='who is sending'):
        require_sending_account(env.session, env.accounts['shared_ours'], staff=None)


def test_an_admins_own_mailbox_is_still_theirs_to_send_from(env):
    """Owner with no company: allowed by ownership, not by company."""
    staff = SimpleNamespace(id=env.ids['nobody'], role=StaffRole.staff)
    row = stored(env, env.accounts['admin_own'])
    row.owner_staff_id = env.ids['nobody']
    env.session.commit()
    require_sending_account(env.session, env.accounts['admin_own'], staff=staff)


def test_sending_from_another_companys_mailbox_sends_nothing(env, monkeypatch):
    sent = []
    monkeypatch.setattr(SmtpService, 'send', lambda self, **kw: sent.append(kw) or {'message_id': '<x@test>'})
    service = ClaimFollowUpService(env.database)
    payload = {
        'claim_id': None, 'to_addresses': ['someone@carrier.example'],
        'subject': 'Hello', 'body_html': '<p>Hi</p>',
        'email_account_id': env.accounts['shared_ours'],
    }
    with pytest.raises(ValueError, match="You can't send from claims@rebuild.example"):
        service.send_email(dict(payload), sender=env.who('pam'))
    assert sent == []
    service.send_email(dict(payload), sender=env.who('bob'))
    assert len(sent) == 1


def test_the_smtp_test_button_checks_the_account_too(env, monkeypatch):
    import app.domains.claim_followup.smtp_service as smtp_module
    tried = []
    monkeypatch.setattr(smtp_module, 'test_smtp_connection', lambda aid=None: tried.append(aid) or {
        'success': True, 'message': 'ok',
    })
    r = env.as_('pam').post('/api/claim-followup/emails/test-smtp', params={'account_id': env.accounts['shared_ours']})
    assert r.status_code == 400
    assert tried == []
    r = env.as_('bob').post('/api/claim-followup/emails/test-smtp', params={'account_id': env.accounts['shared_ours']})
    assert r.status_code == 200
    assert tried == [env.accounts['shared_ours']]


def _addresses(rows):
    return sorted(r['email_address'] for r in rows)


def test_the_account_list_shows_what_they_may_send_from(env):
    # Alice's own mailbox filed under the PA company still shows for her
    row = stored(env, env.accounts['pam_own'])
    row.owner_staff_id = env.ids['alice']
    env.session.commit()
    r = env.as_('alice').get(BASE)
    assert r.status_code == 200
    assert _addresses(r.json()) == [
        'alice@rebuild.example', 'bob@rebuild.example', 'claims@rebuild.example', 'pam@pa-co.example',
    ]
    assert _addresses(env.as_('nobody').get(BASE).json()) == []


def test_the_wm_from_picker_lists_only_usable_accounts(env):
    service = AdjusterEmailService(env.database)
    for name in ('pam', 'bob', 'admin'):
        listed = service._get_email_accounts(env.session, staff=env.who(name))
        expected = sorted(
            stored(env, env.accounts[key]).email_address for key in ALLOWED[name]
        )
        assert sorted(a['email_address'] for a in listed) == expected, name
