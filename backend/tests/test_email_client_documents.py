"""The client page's email composer attaches files stored on the client - the
Document Hub's files - picked by (source, id). The send finds them the way the
hub does, so a person attaches only what they could open there, and an email
never goes out without a file that was picked. On a throwaway SQLite database
with SMTP stubbed out."""

from pathlib import Path
import sqlite3
import sys
from types import SimpleNamespace
import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.ext.compiler import compiles

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory  # noqa: E402
from app.core.database_factory import Base, SQLiteDatabase, get_db  # noqa: E402
from app.domains.auth.dependencies import get_current_staff  # noqa: E402
from app.domains.claim_followup import api as followup_api  # noqa: E402
from app.domains.claim_followup.models import SentEmail  # noqa: E402
from app.domains.claim_followup.service import _client_file_attachments  # noqa: E402
from app.domains.claim_followup.smtp_service import SmtpService  # noqa: E402
from app.domains.client import document_files  # noqa: E402
from app.domains.client.models import Claim, ClaimNegotiation, Client  # noqa: E402
from app.domains.contract.models import ContractInstance, ContractTemplate  # noqa: E402
from app.domains.email_ingestion.models import EmailAccount  # noqa: E402
from app.domains.file.models import File  # noqa: E402
from app.domains.staff.models import StaffRole  # noqa: E402
import app.main  # noqa: E402,F401  registers every model, as the app does

sqlite3.register_adapter(uuid.UUID, str)


@compiles(JSONB, 'sqlite')
def jsonb_as_json(type_, compiler, **kw):
    return 'JSON'


@compiles(ARRAY, 'sqlite')
def array_as_json(type_, compiler, **kw):
    return 'JSON'


def model(table_name):
    return next(m.class_ for m in Base.registry.mappers if getattr(m.class_, '__tablename__', None) == table_name)


TABLES = [
    'followup_tasks', 'supplement_requests', 'bid_item_estimates', 'water_mitigation_jobs', 'wm_documents',
    'rebuild_projects', 'rebuild_completion_docs',
]


@pytest.fixture
def env(tmp_path, monkeypatch):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF'))
    tables = [
        Client, Claim, ClaimNegotiation, ContractTemplate, ContractInstance, File, EmailAccount, SentEmail,
        *map(model, TABLES),
    ]
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in tables])
    # Nothing here may reach the real database, whatever the env file points at
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)

    smtp_calls = []
    monkeypatch.setattr(
        SmtpService, 'send',
        lambda self, **kwargs: smtp_calls.append(kwargs) or {'message_id': '<sent@test>'},
    )

    session = database.get_session()

    def client_with_claim(name):
        client = Client(display_name=name, owners=[], address=name, is_active=True)
        session.add(client)
        session.flush()
        claim = Claim(client_id=client.id, claim_number=f'CLM-{name}')
        session.add(claim)
        session.commit()
        return str(client.id), str(claim.id)

    client_id, claim_id = client_with_claim('12 Elm St')
    account = EmailAccount(
        display_name='Office', email_address='office@abc.com', username='office@abc.com',
        encrypted_password='x',
    )
    session.add(account)
    session.commit()

    def stored_file(claim, name, data=b'%PDF-1.4 letter', on_disk=True, mime='application/pdf'):
        path = tmp_path / f'{uuid.uuid4().hex}-{name}'
        if on_disk:
            path.write_bytes(data)
        row = File(
            filename=path.name, original_name=name, content_type=mime, size=len(data),
            url=str(path), storage_provider='local', context='claim-document',
            context_id=claim, category='letter', is_active=True,
        )
        session.add(row)
        session.commit()
        return str(row.id)

    application = FastAPI()
    application.include_router(followup_api.router, prefix='/api/claim-followup')

    def use_db():
        db = database.get_session()
        try:
            yield db
        finally:
            db.close()

    application.dependency_overrides[get_db] = use_db
    admin = SimpleNamespace(id=uuid.uuid4(), role=StaffRole.admin, is_active=True)
    application.dependency_overrides[get_current_staff] = lambda: admin

    def send(*documents, **extra):
        return TestClient(application).post('/api/claim-followup/emails/send', json={
            'claim_id': claim_id,
            'email_account_id': str(account.id),
            'to_addresses': ['adjuster@carrier.com'],
            'subject': 'Documents',
            'body_html': '<p>Attached.</p>',
            'client_documents': [{'source': s, 'id': i} for s, i in documents],
            **extra,
        })

    yield SimpleNamespace(
        session=session, client=client_id, claim=claim_id, client_with_claim=client_with_claim,
        stored_file=stored_file, send=send, smtp_calls=smtp_calls,
    )
    session.close()
    database.engine.dispose()


def test_a_picked_document_goes_out_with_its_bytes(env):
    file_id = env.stored_file(env.claim, 'Denial letter.pdf', b'%PDF-1.4 denial')

    response = env.send(('file', file_id))
    assert response.status_code == 200, response.text

    [call] = env.smtp_calls
    [attachment] = call['attachments']
    assert attachment['filename'] == 'Denial letter.pdf'
    assert attachment['data'] == b'%PDF-1.4 denial'
    # The record keeps which hub file it was, never the bytes
    [kept] = env.session.query(SentEmail).one().attachments
    assert 'data' not in kept
    assert (kept['source'], kept['document_id']) == ('file', file_id)
    assert kept['sha256_hash']


def test_a_name_without_an_extension_gets_one_from_its_type(env):
    file_id = env.stored_file(env.claim, 'Mold report')
    assert env.send(('file', file_id)).status_code == 200
    assert env.smtp_calls[0]['attachments'][0]['filename'] == 'Mold report.pdf'


def test_picked_documents_go_with_an_uploaded_file(env):
    """Uploads carry a file_id, not bytes; they must not break the size step"""
    file_id = env.stored_file(env.claim, 'Letter.pdf')
    response = env.send(('file', file_id), attachments=[
        {'filename': 'note.txt', 'file_id': 'upload-1', 'mime_type': 'text/plain', 'size': 4},
    ])
    assert response.status_code == 200, response.text
    names = [a['filename'] for a in env.smtp_calls[0]['attachments']]
    assert names == ['note.txt', 'Letter.pdf']


def test_another_clients_document_is_refused_and_nothing_goes_out(env):
    _, other_claim = env.client_with_claim('9 Oak Ave')
    file_id = env.stored_file(other_claim, 'Their estimate.pdf')

    response = env.send(('file', file_id))
    assert response.status_code == 404
    assert 'no longer on this client' in response.json()['detail']
    assert env.smtp_calls == []
    assert env.session.query(SentEmail).count() == 0


def test_an_unknown_kind_of_document_is_refused(env):
    response = env.send(('photos', str(uuid.uuid4())))
    assert response.status_code == 404
    assert env.smtp_calls == []


def test_a_document_missing_from_storage_stops_the_send(env):
    file_id = env.stored_file(env.claim, 'Gone.pdf', on_disk=False)

    response = env.send(('file', file_id))
    assert response.status_code == 400
    assert "Couldn't read Gone.pdf" in response.json()['detail']
    assert 'NOT sent' in response.json()['detail']
    assert env.smtp_calls == []
    assert env.session.query(SentEmail).count() == 0


def test_documents_too_large_for_one_email_stop_before_the_next_download(env):
    first = env.stored_file(env.claim, 'A.pdf', b'x' * 600)
    second = env.stored_file(env.claim, 'B.pdf', b'y' * 600)
    claim_ids, own = [env.claim], None
    entries = document_files.find_hub_files(
        env.session, env.client, claim_ids, own, [('file', first), ('file', second)],
    )
    with pytest.raises(ValueError, match='more than .* with B.pdf, too much for one email'):
        _client_file_attachments(entries, held=[], budget=1000)
    # What is already in memory counts against the budget
    with pytest.raises(ValueError, match='with A.pdf'):
        _client_file_attachments(entries[:1], held=[{'data': b'z' * 500}], budget=1000)


def test_a_claim_the_person_may_not_see_hides_its_documents(env):
    """The same client, a second claim outside the person's scope"""
    second_claim = Claim(client_id=env.client, claim_number='CLM-2')
    env.session.add(second_claim)
    env.session.commit()
    visible = env.stored_file(env.claim, 'Mine.pdf')
    hidden = env.stored_file(str(second_claim.id), 'Not mine.pdf')

    found = document_files.find_hub_files(
        env.session, env.client, [env.claim], ['some-company'], [('file', visible), ('file', hidden)],
    )
    assert found[0]['filename'] == 'Mine.pdf'
    assert found[1] is None


def test_the_hub_still_opens_one_file(env):
    file_id = env.stored_file(env.claim, 'Letter.pdf')
    entry = document_files.find_hub_file(env.session, env.client, [env.claim], None, 'file', file_id)
    assert document_files.read_hub_file(entry) == b'%PDF-1.4 letter'
    assert document_files.find_hub_file(env.session, env.client, [env.claim], None, 'file', 'nope') is None
