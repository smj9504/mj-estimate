"""Admin password resets and emailed-code password changes, on an in-memory database."""

from datetime import datetime
from pathlib import Path
import re
import sys

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.cache import CacheService, InMemoryCache, get_cache
from app.core.config import settings
from app.core.database_factory import get_db_session
from app.core.email_service import email_service
from app.core.rate_limiter import limiter
from app.domains.auth import api as auth_api
from app.domains.auth import password_change
from app.domains.auth.dependencies import get_current_staff
from app.domains.auth.service import TEMP_PASSWORD_ALPHABET, AuthService
from app.domains.staff.models import Staff, StaffRole
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401

OLD_PASSWORD = 'old-password-1'
OLD_PASSWORD_HASH = AuthService.hash_password(OLD_PASSWORD)


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
        must_change_password=False,
        is_active=True,
        can_login=True,
    )
    session.add(staff)
    session.commit()
    return staff


@pytest.fixture
def env(monkeypatch):
    engine = sa.create_engine(
        'sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool
    )
    Staff.__table__.create(engine)
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

    signed_in = {'staff': jane}
    app.dependency_overrides[get_db_session] = lambda: session
    app.dependency_overrides[get_cache] = lambda: cache
    app.dependency_overrides[get_current_staff] = lambda: signed_in['staff']

    sent = []
    monkeypatch.setattr(settings, 'EMAIL_ENABLED', True)
    monkeypatch.setattr(settings, 'DEBUG', False)
    monkeypatch.setattr(
        email_service, 'send_password_change_code',
        lambda to, code, minutes: sent.append({'to': to, 'code': code}) or True,
    )

    def sign_in_as(staff):
        signed_in['staff'] = staff

    yield {
        'client': TestClient(app), 'session': session, 'sent': sent,
        'admin': admin, 'jane': jane, 'sam': sam, 'sign_in_as': sign_in_as,
    }
    session.close()


def password_works(env, staff, password):
    env['session'].refresh(staff)
    return AuthService.verify_password(password, staff.password_hash)


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
    assert AuthService().authenticate_staff(env['session'], 'jane', temporary)


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


def test_admin_reset_of_unknown_staff_is_404(env):
    env['sign_in_as'](env['admin'])
    response = env['client'].post(
        '/api/auth/staff/00000000-0000-0000-0000-000000000000/reset-password', json={}
    )
    assert response.status_code == 404


# Changing your own password with an emailed code

def request_code(env):
    response = env['client'].post('/api/auth/me/change-password/code')
    assert response.status_code == 200, response.text
    return response.json()


def test_code_goes_to_the_address_on_file_and_changes_the_password(env):
    body = request_code(env)

    assert body == {'sent_to': 'j***@example.com', 'expires_in_minutes': 10, 'code': None}
    assert [mail['to'] for mail in env['sent']] == ['jane@example.com']
    code = env['sent'][0]['code']
    assert re.fullmatch(r'\d{6}', code)

    response = env['client'].post(
        '/api/auth/me/change-password', json={'code': code, 'new_password': 'brand-new-pass'}
    )

    assert response.status_code == 200
    assert password_works(env, env['jane'], 'brand-new-pass')
    assert env['jane'].must_change_password is False

    # A code works once
    again = env['client'].post(
        '/api/auth/me/change-password', json={'code': code, 'new_password': 'another-pass-1'}
    )
    assert again.status_code == 400
    assert password_works(env, env['jane'], 'brand-new-pass')


def test_wrong_code_leaves_the_password_alone(env):
    request_code(env)
    code = env['sent'][0]['code']
    wrong = '000000' if code != '000000' else '111111'

    response = env['client'].post(
        '/api/auth/me/change-password', json={'code': wrong, 'new_password': 'brand-new-pass'}
    )

    assert response.status_code == 400
    assert 'wrong or has expired' in response.json()['detail']
    assert password_works(env, env['jane'], OLD_PASSWORD)


def test_code_stops_working_after_too_many_wrong_guesses(env):
    request_code(env)
    code = env['sent'][0]['code']
    wrong = '000000' if code != '000000' else '111111'

    for _ in range(password_change.MAX_ATTEMPTS):
        env['client'].post(
            '/api/auth/me/change-password', json={'code': wrong, 'new_password': 'brand-new-pass'}
        )
    response = env['client'].post(
        '/api/auth/me/change-password', json={'code': code, 'new_password': 'brand-new-pass'}
    )

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
    response = env['client'].post(
        '/api/auth/me/change-password', json={'code': code, 'new_password': 'brand-new-pass'}
    )

    assert response.status_code == 400
    assert password_works(env, env['jane'], OLD_PASSWORD)


def test_a_new_code_replaces_the_old_one(env):
    request_code(env)
    request_code(env)
    first, second = env['sent'][0]['code'], env['sent'][1]['code']

    if first != second:
        stale = env['client'].post(
            '/api/auth/me/change-password', json={'code': first, 'new_password': 'brand-new-pass'}
        )
        assert stale.status_code == 400
    fresh = env['client'].post(
        '/api/auth/me/change-password', json={'code': second, 'new_password': 'brand-new-pass'}
    )
    assert fresh.status_code == 200


def test_one_persons_code_does_not_work_for_someone_else(env):
    request_code(env)
    code = env['sent'][0]['code']

    env['sign_in_as'](env['sam'])
    response = env['client'].post(
        '/api/auth/me/change-password', json={'code': code, 'new_password': 'brand-new-pass'}
    )

    assert response.status_code == 400
    assert password_works(env, env['sam'], OLD_PASSWORD)


def test_new_password_must_be_long_enough(env):
    request_code(env)
    response = env['client'].post(
        '/api/auth/me/change-password',
        json={'code': env['sent'][0]['code'], 'new_password': 'short'},
    )

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
    response = env['client'].post(
        '/api/auth/me/change-password', json={'code': body['code'], 'new_password': 'brand-new-pass'}
    )
    assert response.status_code == 200


# Profile email

def test_people_cannot_change_their_own_email(env):
    response = env['client'].put(
        '/api/auth/me', json={'email': 'attacker@example.com', 'first_name': 'Janet'}
    )

    assert response.status_code == 200
    env['session'].refresh(env['jane'])
    assert env['jane'].email == 'jane@example.com'
    assert env['jane'].first_name == 'Janet'


def test_code_email_contains_the_code(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        type(email_service), 'send_email',
        staticmethod(lambda **kwargs: captured.update(kwargs) or True),
    )

    assert type(email_service).send_password_change_code('jane@example.com', '482913', 10)
    assert captured['to_email'] == 'jane@example.com'
    assert '482913' in captured['html_content']
    assert '482913' in captured['text_content']
    assert '10 minutes' in captured['text_content']
