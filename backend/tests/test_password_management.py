"""Admin password resets, emailed-code password changes and signing out old
sessions, on an in-memory database with real tokens."""

from datetime import datetime, timedelta
from pathlib import Path
import re
import sys
import time

import bcrypt
import jwt
import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import email_service as email_module
from app.core.cache import CacheService, InMemoryCache, get_cache
from app.core.config import settings
from app.core.database_factory import get_db_session
from app.core.email_service import EmailService, email_service
from app.core.rate_limiter import limiter
from app.domains.auth import api as auth_api
from app.domains.auth import password_change
from app.domains.auth.password_reset_models import PasswordResetToken
from app.domains.auth.service import TEMP_PASSWORD_ALPHABET, AuthService
from app.domains.staff.models import RoleScreenAccess, Staff, StaffRole
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401

OLD_PASSWORD = 'old-password-1'
# The fewest bcrypt rounds, so hashing and checking don't dominate the run
FAST_ROUNDS = 4
OLD_PASSWORD_HASH = bcrypt.hashpw(OLD_PASSWORD.encode(), bcrypt.gensalt(rounds=FAST_ROUNDS)).decode()


def make_staff(session, username, role):
    staff = Staff(
        staff_number=username.upper(),
        first_name=username.title(),
        last_name='Tester',
        email=f'{username}@example.com',
        role=role,
        hire_date=datetime(2026, 1, 1),
        username=username,
        password_hash=OLD_PASSWORD_HASH,
        is_active=True,
        can_login=True,
    )
    session.add(staff)
    session.commit()
    return staff


def token_for(staff, issued_secs_ago=60, with_iat=True):
    """A session token, by default from a minute ago so a change made now is after it"""
    payload = {
        'sub': str(staff.id),
        'username': staff.username,
        'role': staff.role.value,
        'exp': datetime.utcnow() + timedelta(days=1),
    }
    if with_iat:
        payload['iat'] = int(time.time()) - issued_secs_ago
    return jwt.encode(payload, AuthService.SECRET_KEY, algorithm=AuthService.ALGORITHM)


def bearer(token):
    return {'Authorization': f'Bearer {token}'}


@pytest.fixture
def env(monkeypatch):
    real_gensalt = bcrypt.gensalt
    monkeypatch.setattr(bcrypt, 'gensalt', lambda: real_gensalt(rounds=FAST_ROUNDS))

    engine = sa.create_engine(
        'sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool
    )
    Staff.__table__.create(engine)
    PasswordResetToken.__table__.create(engine)
    RoleScreenAccess.__table__.create(engine)  # login and /me read it
    session = sessionmaker(bind=engine)()
    admin = make_staff(session, 'boss', StaffRole.admin)
    jane = make_staff(session, 'jane', StaffRole.technician)
    sam = make_staff(session, 'sam', StaffRole.technician)

    # Without Redis: CacheService() would try to connect
    cache = CacheService.__new__(CacheService)
    cache.redis_client = InMemoryCache()
    InMemoryCache._shared_cache.clear()
    InMemoryCache._shared_ttls.clear()

    app = FastAPI()
    app.include_router(auth_api.router, prefix='/api/auth')
    app.state.limiter = limiter
    monkeypatch.setattr(limiter, 'enabled', False)
    app.dependency_overrides[get_db_session] = lambda: session
    app.dependency_overrides[get_cache] = lambda: cache

    sent = []
    monkeypatch.setattr(settings, 'EMAIL_ENABLED', True)
    monkeypatch.setattr(settings, 'DEBUG', False)
    monkeypatch.setattr(
        email_service, 'send_password_change_code',
        lambda to, code, minutes: sent.append({'to': to, 'code': code}) or True,
    )

    client = TestClient(app)

    def sign_in_as(staff, **token_options):
        token = token_for(staff, **token_options)
        client.headers.update(bearer(token))
        return token

    sign_in_as(jane)
    yield {
        'client': client, 'session': session, 'sent': sent, 'cache': cache,
        'admin': admin, 'jane': jane, 'sam': sam, 'sign_in_as': sign_in_as,
    }
    session.close()


def password_works(env, staff, password):
    env['session'].refresh(staff)
    return AuthService.verify_password(password, staff.password_hash)


def me(env, token):
    return env['client'].get('/api/auth/me', headers=bearer(token))


def login(env, username, password):
    response = env['client'].post('/api/auth/login', json={'username': username, 'password': password})
    assert response.status_code == 200, response.text
    return response.json()


# Temporary passwords

def test_temporary_password_is_readable_and_random():
    first = AuthService.generate_temporary_password()
    assert re.fullmatch(r'[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}', first)
    assert set(first.replace('-', '')) <= set(TEMP_PASSWORD_ALPHABET)
    assert not set('0O1lI') & set(TEMP_PASSWORD_ALPHABET)
    assert first != AuthService.generate_temporary_password()


# Admin reset

def test_admin_reset_makes_up_a_password_the_person_can_sign_in_with(env):
    env['sign_in_as'](env['admin'])
    response = env['client'].post(f"/api/auth/staff/{env['jane'].id}/reset-password", json={})

    assert response.status_code == 200
    temporary = response.json()['password']
    assert password_works(env, env['jane'], temporary)
    assert not password_works(env, env['jane'], OLD_PASSWORD)
    assert env['jane'].must_change_password is True
    assert login(env, 'jane', temporary)['user']['must_change_password'] is True


def test_admin_reset_can_use_a_password_the_admin_chose(env):
    env['sign_in_as'](env['admin'])
    response = env['client'].post(
        f"/api/auth/staff/{env['jane'].id}/reset-password",
        json={'new_password': 'chosen-by-admin'},
    )

    assert response.status_code == 200
    assert response.json()['password'] == 'chosen-by-admin'
    assert password_works(env, env['jane'], 'chosen-by-admin')


def test_admin_reset_refuses_a_short_password(env):
    env['sign_in_as'](env['admin'])
    response = env['client'].post(
        f"/api/auth/staff/{env['jane'].id}/reset-password", json={'new_password': 'short'}
    )

    assert response.status_code == 422
    assert password_works(env, env['jane'], OLD_PASSWORD)


def test_only_admins_can_reset_someone_elses_password(env):
    env['sign_in_as'](env['sam'])
    response = env['client'].post(f"/api/auth/staff/{env['jane'].id}/reset-password", json={})

    assert response.status_code == 403
    assert password_works(env, env['jane'], OLD_PASSWORD)


def test_admins_change_their_own_password_from_their_profile(env):
    env['sign_in_as'](env['admin'])
    response = env['client'].post(f"/api/auth/staff/{env['admin'].id}/reset-password", json={})

    assert response.status_code == 400
    assert 'profile' in response.json()['detail']
    assert password_works(env, env['admin'], OLD_PASSWORD)


def test_admin_reset_of_unknown_staff_is_404(env):
    env['sign_in_as'](env['admin'])
    response = env['client'].post(
        '/api/auth/staff/00000000-0000-0000-0000-000000000000/reset-password', json={}
    )
    assert response.status_code == 404


def test_new_staff_choose_nothing_extra_at_first_sign_in(env):
    env['sign_in_as'](env['admin'])
    response = env['client'].post('/api/auth/register', json={
        'username': 'newbie', 'email': 'newbie@example.com', 'password': 'welcome-123',
        'first_name': 'New', 'last_name': 'Person', 'staff_number': 'N1',
    })

    assert response.status_code == 200
    assert login(env, 'newbie', 'welcome-123')['user']['must_change_password'] is False


# Changing your own password with an emailed code

def request_code(env):
    response = env['client'].post('/api/auth/me/change-password/code')
    assert response.status_code == 200, response.text
    return response.json()


def change_with_code(env, code, new_password='brand-new-pass'):
    return env['client'].post(
        '/api/auth/me/change-password', json={'code': code, 'new_password': new_password}
    )


def test_code_goes_to_the_address_on_file_and_changes_the_password(env):
    body = request_code(env)

    assert body == {'sent_to': 'j***@example.com', 'expires_in_minutes': 10, 'code': None}
    assert [mail['to'] for mail in env['sent']] == ['jane@example.com']
    code = env['sent'][0]['code']
    assert re.fullmatch(r'\d{6}', code)

    response = change_with_code(env, code)

    assert response.status_code == 200
    assert password_works(env, env['jane'], 'brand-new-pass')
    assert env['jane'].must_change_password is False

    # A code works once
    again = env['client'].post(
        '/api/auth/me/change-password',
        json={'code': code, 'new_password': 'another-pass-1'},
        headers=bearer(response.json()['access_token']),
    )
    assert again.status_code == 400
    assert password_works(env, env['jane'], 'brand-new-pass')


def test_wrong_code_leaves_the_password_alone(env):
    request_code(env)
    code = env['sent'][0]['code']
    wrong = '000000' if code != '000000' else '111111'

    response = change_with_code(env, wrong)

    assert response.status_code == 400
    assert 'wrong or has expired' in response.json()['detail']
    assert password_works(env, env['jane'], OLD_PASSWORD)


def test_code_stops_working_after_too_many_wrong_guesses(env):
    request_code(env)
    code = env['sent'][0]['code']
    wrong = '000000' if code != '000000' else '111111'

    for _ in range(password_change.MAX_ATTEMPTS):
        change_with_code(env, wrong)
    response = change_with_code(env, code)

    assert response.status_code == 400
    assert password_works(env, env['jane'], OLD_PASSWORD)


def test_code_expires(env, monkeypatch):
    request_code(env)
    code = env['sent'][0]['code']

    real_time = password_change.time.time
    monkeypatch.setattr(
        password_change.time, 'time',
        lambda: real_time() + password_change.CODE_TTL_SECONDS + 1,
    )
    response = change_with_code(env, code)

    assert response.status_code == 400
    assert password_works(env, env['jane'], OLD_PASSWORD)


def test_a_new_code_replaces_the_old_one(env):
    request_code(env)
    request_code(env)
    first, second = env['sent'][0]['code'], env['sent'][1]['code']

    if first != second:
        assert change_with_code(env, first).status_code == 400
    assert change_with_code(env, second).status_code == 200


def test_one_persons_code_does_not_work_for_someone_else(env):
    request_code(env)
    code = env['sent'][0]['code']

    env['sign_in_as'](env['sam'])
    response = change_with_code(env, code)

    assert response.status_code == 400
    assert password_works(env, env['sam'], OLD_PASSWORD)


def test_new_password_must_be_long_enough(env):
    request_code(env)
    response = change_with_code(env, env['sent'][0]['code'], new_password='short')

    assert response.status_code == 422
    assert password_works(env, env['jane'], OLD_PASSWORD)


def test_code_requests_are_rate_limited(env, monkeypatch):
    from slowapi.errors import RateLimitExceeded
    from app.core.rate_limiter import rate_limit_exceeded_handler

    env['client'].app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
    monkeypatch.setattr(limiter, 'enabled', True)
    limiter.reset()

    statuses = [
        env['client'].post('/api/auth/me/change-password/code').status_code for _ in range(4)
    ]
    limiter.reset()

    assert statuses == [200, 200, 200, 429]
    assert len(env['sent']) == 3


def test_code_request_fails_loudly_when_the_email_does_not_go_out(env, monkeypatch):
    monkeypatch.setattr(email_service, 'send_password_change_code', lambda *args: False)
    response = env['client'].post('/api/auth/me/change-password/code')

    assert response.status_code == 503
    assert "Couldn't send" in response.json()['detail']


def test_code_request_explains_when_email_is_off(env, monkeypatch):
    monkeypatch.setattr(settings, 'EMAIL_ENABLED', False)
    response = env['client'].post('/api/auth/me/change-password/code')

    assert response.status_code == 503
    assert env['sent'] == []


def test_development_without_email_returns_the_code(env, monkeypatch):
    monkeypatch.setattr(settings, 'EMAIL_ENABLED', False)
    monkeypatch.setattr(settings, 'DEBUG', True)
    body = request_code(env)

    assert env['sent'] == []
    assert change_with_code(env, body['code']).status_code == 200


# Signing out old sessions

def test_changing_your_password_signs_out_your_other_sessions(env):
    other_device = token_for(env['jane'], issued_secs_ago=3600)
    assert me(env, other_device).status_code == 200  # also puts jane in the auth cache

    request_code(env)
    response = change_with_code(env, env['sent'][0]['code'])
    assert response.status_code == 200

    signed_out = me(env, other_device)
    assert signed_out.status_code == 401
    assert signed_out.json()['detail'] == 'Your password was changed. Sign in again.'
    # This tab carries on with the token handed back
    assert me(env, response.json()['access_token']).status_code == 200


def test_admin_reset_signs_the_person_out(env):
    janes_session = token_for(env['jane'])
    assert me(env, janes_session).status_code == 200  # cached

    env['sign_in_as'](env['admin'])
    env['client'].post(f"/api/auth/staff/{env['jane'].id}/reset-password", json={})

    assert me(env, janes_session).status_code == 401


def test_a_stale_cache_entry_does_not_keep_an_old_session_alive(env):
    janes_session = token_for(env['jane'])
    assert me(env, janes_session).status_code == 200  # cached without a change time

    # Change the password behind the cache's back, as another server would
    AuthService().set_password(env['session'], env['jane'].id, 'brand-new-pass')
    cached = env['cache'].redis_client.get(f"staff:{env['jane'].id}")
    assert cached is not None
    # The cached copy predates the change, so it lets the token through until
    # it expires (STAFF_CACHE_TTL); every password write clears it, see above
    assert me(env, janes_session).status_code == 200
    env['cache'].redis_client.delete(f"staff:{env['jane'].id}")
    assert me(env, janes_session).status_code == 401


def test_tokens_from_before_iat_was_added_keep_working_until_a_change(env):
    legacy = token_for(env['jane'], with_iat=False)
    assert me(env, legacy).status_code == 200

    env['sign_in_as'](env['admin'])
    env['client'].post(f"/api/auth/staff/{env['jane'].id}/reset-password", json={})

    assert me(env, legacy).status_code == 401


def test_email_link_reset_signs_out_old_sessions(env):
    janes_session = token_for(env['jane'])
    assert me(env, janes_session).status_code == 200

    reset_token = AuthService().create_password_reset_token(env['session'], 'jane@example.com')
    response = env['client'].post(
        '/api/auth/password-reset/confirm',
        json={'token': reset_token, 'new_password': 'brand-new-pass'},
    )

    assert response.status_code == 200
    assert me(env, janes_session).status_code == 401
    assert login(env, 'jane', 'brand-new-pass')


# Choosing your own password after an admin reset

def reset_by_admin(env, staff):
    env['sign_in_as'](env['admin'])
    response = env['client'].post(f"/api/auth/staff/{staff.id}/reset-password", json={})
    return response.json()['password']


def change_temporary(env, token, current, new):
    return env['client'].post(
        '/api/auth/me/change-temporary-password',
        json={'current_password': current, 'new_password': new},
        headers=bearer(token),
    )


def test_after_a_reset_the_person_picks_their_own_password(env):
    temporary = reset_by_admin(env, env['jane'])
    session = login(env, 'jane', temporary)
    assert session['user']['must_change_password'] is True

    response = change_temporary(env, session['access_token'], temporary, 'my-own-pass-1')

    assert response.status_code == 200
    assert password_works(env, env['jane'], 'my-own-pass-1')
    assert env['jane'].must_change_password is False
    after = me(env, response.json()['access_token'])
    assert after.status_code == 200
    assert after.json()['must_change_password'] is False


def test_temporary_password_must_be_given_correctly(env):
    temporary = reset_by_admin(env, env['jane'])
    token = login(env, 'jane', temporary)['access_token']

    wrong = change_temporary(env, token, 'not-the-temp-pass', 'my-own-pass-1')
    same = change_temporary(env, token, temporary, temporary)

    assert wrong.status_code == 400
    assert wrong.json()['detail'] == 'The temporary password is incorrect'
    assert same.status_code == 400
    assert password_works(env, env['jane'], temporary)


def test_without_a_reset_the_emailed_code_is_the_only_way(env):
    response = change_temporary(env, token_for(env['jane']), OLD_PASSWORD, 'my-own-pass-1')

    assert response.status_code == 400
    assert 'profile' in response.json()['detail']
    assert password_works(env, env['jane'], OLD_PASSWORD)


# Profile email

def test_people_cannot_change_their_own_email(env):
    response = env['client'].put(
        '/api/auth/me', json={'email': 'attacker@example.com', 'first_name': 'Janet'}
    )

    assert response.status_code == 200
    env['session'].refresh(env['jane'])
    assert env['jane'].email == 'jane@example.com'
    assert env['jane'].first_name == 'Janet'


# Email sending

def test_code_email_contains_the_code(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        EmailService, 'send_email',
        staticmethod(lambda **kwargs: captured.update(kwargs) or True),
    )

    assert EmailService.send_password_change_code('jane@example.com', '482913', 10)
    assert captured['to_email'] == 'jane@example.com'
    assert '482913' in captured['html_content']
    assert '482913' in captured['text_content']
    assert '10 minutes' in captured['text_content']


def test_smtp_conversation_is_not_echoed_with_credentials(monkeypatch):
    class FakeSMTP:
        instances = []

        def __init__(self, host, port, timeout=None):
            self.debuglevel = 0
            self.calls = []
            FakeSMTP.instances.append(self)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def set_debuglevel(self, level):
            self.debuglevel = level

        def starttls(self):
            self.calls.append('starttls')

        def login(self, user, password):
            self.calls.append('login')

        def send_message(self, message):
            self.calls.append(('send', message['To']))

    monkeypatch.setattr(email_module.smtplib, 'SMTP', FakeSMTP)
    monkeypatch.setattr(settings, 'EMAIL_ENABLED', True)
    monkeypatch.setattr(settings, 'SMTP_USER', 'mailer@example.com')
    monkeypatch.setattr(settings, 'SMTP_PASSWORD', 'secret')

    assert EmailService.send_email('jane@example.com', 'Hi', '<p>Hi</p>')
    smtp = FakeSMTP.instances[-1]
    assert smtp.calls == ['starttls', 'login', ('send', 'jane@example.com')]
    # smtplib prints the AUTH line, with the encoded password, at level 1+
    assert smtp.debuglevel == 0
