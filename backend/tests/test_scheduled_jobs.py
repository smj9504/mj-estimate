"""Production boots through app.asgi, so the real app's lifespan has to reach it or
no scheduled job ever runs. Also when the sheet sync runs, and the two jobs whose
work is heavy enough to hurt the server: the trash purge and the email poll."""

import asyncio
from datetime import datetime, timedelta
import importlib.util
from pathlib import Path
import sys
import threading
import types
from unittest.mock import MagicMock

import pytest
import pytz

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.config import settings  # noqa: E402
from app.domains.email_ingestion import repository as email_repository  # noqa: E402
from app.domains.email_ingestion import service as email_service  # noqa: E402
from app.domains.email_ingestion.email_client import EmailAttachment, FetchedEmail, IMAPClient  # noqa: E402
from app.domains.integrations.google_sheets import scheduler as sheet_scheduler  # noqa: E402
from app.domains.water_mitigation import adjuster_inbox, trash_scheduler  # noqa: E402

EASTERN = pytz.timezone('America/New_York')


class SlowMain(types.ModuleType):
    """Stands in for app.main: the import blocks until the test lets it finish."""

    def __init__(self, release, real_app):
        super().__init__('app.main')
        self.release = release
        self.real_app = real_app

    def __getattr__(self, name):
        if name == 'app':
            self.release.wait(timeout=5)
            return self.real_app
        raise AttributeError(name)


def recording_app(calls, fail_startup=False):
    """An app speaking the ASGI lifespan protocol, noting what reaches it."""

    async def real_app(scope, receive, send):
        assert scope['type'] == 'lifespan'
        calls.append((await receive())['type'])
        if fail_startup:
            await send({'type': 'lifespan.startup.failed', 'message': 'boom'})
            raise RuntimeError('boom')
        await send({'type': 'lifespan.startup.complete'})
        calls.append((await receive())['type'])
        await send({'type': 'lifespan.shutdown.complete'})

    return real_app


@pytest.fixture
def launcher_module(monkeypatch):
    path = Path(__file__).resolve().parents[1] / 'app/asgi.py'
    spec = importlib.util.spec_from_file_location('_test_launcher', path)
    module = importlib.util.module_from_spec(spec)
    # The module builds its own instance on import; keep that one from loading anything.
    with monkeypatch.context() as scoped:
        scoped.setattr(threading.Thread, 'start', lambda self: None)
        spec.loader.exec_module(module)
    return module


def run_lifespan(launcher, between):
    """Drive the launcher the way uvicorn does and return what it sent."""

    async def drive():
        incoming = asyncio.Queue()
        sent = []

        async def send(message):
            sent.append(message['type'])

        task = asyncio.create_task(
            launcher({'type': 'lifespan', 'state': {}}, incoming.get, send)
        )
        await incoming.put({'type': 'lifespan.startup'})
        for _ in range(100):
            await asyncio.sleep(0)
        await between(sent)
        await incoming.put({'type': 'lifespan.shutdown'})
        await asyncio.wait_for(task, timeout=5)
        return sent

    return asyncio.run(drive())


async def wait_for(condition):
    for _ in range(50):
        if condition():
            return
        await asyncio.sleep(0.1)
    raise AssertionError('timed out')


BOTH_DONE = ['lifespan.startup.complete', 'lifespan.shutdown.complete']


def test_launcher_answers_at_once_then_hands_the_lifespan_to_the_real_app(monkeypatch, launcher_module):
    calls = []
    release = threading.Event()
    monkeypatch.setitem(sys.modules, 'app.main', SlowMain(release, recording_app(calls)))
    launcher = launcher_module.LauncherASGI()

    async def between(sent):
        # uvicorn can't bind the port until this is sent, and the app is still loading
        assert sent == ['lifespan.startup.complete']
        assert calls == []
        release.set()
        await wait_for(lambda: calls)
        assert calls == ['lifespan.startup']

    assert run_lifespan(launcher, between) == BOTH_DONE
    assert calls == ['lifespan.startup', 'lifespan.shutdown']


def test_launcher_shuts_down_cleanly_when_the_app_failed_to_load(monkeypatch, launcher_module):
    monkeypatch.setitem(sys.modules, 'app.main', types.ModuleType('app.main'))  # no `app` attribute
    launcher = launcher_module.LauncherASGI()
    launcher._thread.join(timeout=5)

    async def between(sent):
        await asyncio.sleep(0.7)

    assert run_lifespan(launcher, between) == BOTH_DONE


def test_launcher_keeps_going_when_the_real_startup_fails(monkeypatch, launcher_module):
    calls = []
    release = threading.Event()
    release.set()
    monkeypatch.setitem(sys.modules, 'app.main', SlowMain(release, recording_app(calls, fail_startup=True)))
    launcher = launcher_module.LauncherASGI()

    async def between(sent):
        await wait_for(lambda: calls)
        # Requests still reach the real app, which is already loaded
        assert launcher._real_app is not None

    assert run_lifespan(launcher, between) == BOTH_DONE
    assert calls == ['lifespan.startup']


def test_launcher_shuts_down_while_the_app_is_still_loading(monkeypatch, launcher_module):
    calls = []
    release = threading.Event()
    monkeypatch.setitem(sys.modules, 'app.main', SlowMain(release, recording_app(calls)))
    launcher = launcher_module.LauncherASGI()

    async def between(sent):
        pass

    try:
        assert run_lifespan(launcher, between) == BOTH_DONE
        assert calls == []
    finally:
        release.set()
        launcher._thread.join(timeout=5)


def test_the_sheet_sync_runs_once_a_day_and_not_at_boot(monkeypatch):
    monkeypatch.setattr(settings, 'GOOGLE_SHEETS_WATER_MITIGATION_ID', 'test-sheet')
    scheduler = sheet_scheduler.scheduler
    sheet_scheduler.start_scheduler()
    try:
        trigger = scheduler.get_job('google_sheets_sync').trigger
        morning = EASTERN.localize(datetime(2026, 11, 2, 7, 0))
        first = trigger.get_next_fire_time(None, morning)
        second = trigger.get_next_fire_time(first, first + timedelta(seconds=1))
        assert first == EASTERN.localize(datetime(2026, 11, 2, 8, 0))
        assert second == EASTERN.localize(datetime(2026, 11, 3, 8, 0))

        # Booting at 9:00 waits for tomorrow rather than syncing on every deploy
        after_hours = EASTERN.localize(datetime(2026, 11, 2, 9, 0))
        assert trigger.get_next_fire_time(None, after_hours) == second
    finally:
        sheet_scheduler.stop_scheduler()


def test_the_trash_purge_stays_off_the_event_loop(monkeypatch):
    seen = {}

    def purge():
        seen['thread'] = threading.current_thread()
        return {'deleted_count': 1, 'failed_count': 0, 'total_expired': 1}

    monkeypatch.setattr(trash_scheduler, '_sync_cleanup_expired_trash', purge)
    asyncio.run(trash_scheduler.cleanup_expired_trash_job())
    assert seen['thread'] is not threading.main_thread()


def imap_client(monkeypatch, message_ids, log):
    client = IMAPClient('imap.test', 993, 'user', 'password')
    client._connection = MagicMock()
    client._connection.search.return_value = ('OK', [b' '.join(message_ids)])
    monkeypatch.setattr(client, 'connect', lambda: log.append('connect'))
    monkeypatch.setattr(client, 'disconnect', lambda: log.append('disconnect'))

    def fetch_single(msg_id):
        log.append(f'fetch {msg_id.decode()}')
        return FetchedEmail(msg_id.decode(), 'subject', 'sender', None, '', '')

    monkeypatch.setattr(client, '_fetch_single', fetch_single)
    return client


def test_messages_are_fetched_only_as_they_are_asked_for(monkeypatch):
    log = []
    client = imap_client(monkeypatch, [b'1', b'2'], log)

    messages = client.fetch_emails(limit=50)
    assert log == []

    assert next(messages).message_id == '1'
    assert log == ['connect', 'fetch 1']

    assert next(messages).message_id == '2'
    assert next(messages, None) is None
    assert log == ['connect', 'fetch 1', 'fetch 2', 'disconnect']


def test_only_the_newest_messages_past_the_limit_are_read(monkeypatch):
    client = imap_client(monkeypatch, [b'1', b'2', b'3'], [])
    assert [m.message_id for m in client.fetch_emails(limit=2)] == ['2', '3']


def test_a_poll_finishes_each_message_before_downloading_the_next(monkeypatch):
    log = []
    with_file = FetchedEmail(
        'with-file', 'Estimate', 'adjuster@carrier.com', None, '', '',
        attachments=[EmailAttachment('estimate.pdf', 'application/pdf', b'pdf')],
    )
    plain = FetchedEmail('plain', 'Hello', 'adjuster@carrier.com', None, '', '')

    def fetch_emails(**kwargs):
        for message in (with_file, plain):
            log.append(f'download {message.message_id}')
            yield message

    session = MagicMock()
    session.commit.side_effect = lambda: log.append('commit')
    log_repo = MagicMock()
    log_repo.exists_by_message_id_and_hash.return_value = False
    account_repo = MagicMock()
    account_repo.get_by_id.return_value = {'email_address': 'us@example.com'}

    service = email_service.EmailIngestionService(database=MagicMock())
    monkeypatch.setattr(service, '_get_session', lambda: session)
    monkeypatch.setattr(service, '_build_imap_client', lambda account, s: MagicMock(fetch_emails=fetch_emails))

    def save(session, account_id, message, **kwargs):
        log.append(f'save {message.message_id}')
        return True

    def process(**kwargs):
        log.append(f"attachment {kwargs['attachment'].filename}")
        return {'status': 'pending'}

    monkeypatch.setattr(service, '_save_received_email', save)
    monkeypatch.setattr(service, '_process_attachment', process)
    monkeypatch.setattr(email_repository, 'get_email_account_repository', lambda s: account_repo)
    monkeypatch.setattr(email_repository, 'get_email_ingestion_log_repository', lambda s: log_repo)
    monkeypatch.setattr(email_service, '_load_sent_attachment_index', lambda s: (set(), set()))
    monkeypatch.setattr(email_service, '_any_attachment_qualifies', lambda message, index: True)
    monkeypatch.setattr(adjuster_inbox.JobMailIndex, 'load', staticmethod(lambda s: None))

    stats = service.poll_account('account-1')

    assert log[:7] == [
        'download with-file', 'save with-file', 'attachment estimate.pdf', 'commit',
        'download plain', 'save plain', 'commit',
    ]
    assert stats['emails_scanned'] == 2
    assert stats['emails_found'] == 1
    assert stats['emails_saved'] == 2
    assert stats['processed'] == 1
    assert stats['pending'] == 1
