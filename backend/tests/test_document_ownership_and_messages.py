"""Each person's own estimates and invoices, offering them to someone else, and
messages between staff, on a throwaway SQLite database with real tokens."""

from datetime import datetime, timedelta
from pathlib import Path
import sys
import time

import jwt
import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.sqlite import base as sqlite_base
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory
from app.core.cache import CacheService, InMemoryCache, get_cache
from app.core.database_factory import Base, SQLiteDatabase, get_db_session
from app.domains.auth.service import AuthService
from app.domains.company.models import Company
from app.domains.document_transfer import api as transfer_api
from app.domains.document_transfer.models import DocumentTransfer
from app.domains.estimate import api as estimate_api
from app.domains.estimate.models import Estimate, EstimateItem
from app.domains.invoice import api as invoice_api
from app.domains.invoice.models import Invoice, InvoiceItem
from app.domains.messaging import api as messaging_api
from app.domains.messaging.models import Conversation, ConversationParticipant, Message
from app.domains.contract.models import ClaimCompany
from app.domains.staff.models import Staff, StaffCompany, StaffRole
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401

TABLES = [
    Staff, Company, Estimate, EstimateItem, Invoice, InvoiceItem,
    DocumentTransfer, Conversation, ConversationParticipant, Message,
    StaffCompany, ClaimCompany,
]


def token_for(staff):
    payload = {
        'sub': str(staff.id),
        'username': staff.username,
        'role': staff.role.value,
        'exp': datetime.utcnow() + timedelta(days=1),
        'iat': int(time.time()) - 60,
    }
    return jwt.encode(payload, AuthService.SECRET_KEY, algorithm=AuthService.ALGORITHM)


def accept_iso_strings(monkeypatch):
    """Copying a document writes its dates back as ISO strings, which Postgres
    takes and SQLite's DateTime refuses; parse them as Postgres would"""
    real = sqlite_base.DATETIME.bind_processor

    def bind_processor(self, dialect):
        process = real(self, dialect)

        def parse_then_process(value):
            if isinstance(value, str):
                value = datetime.fromisoformat(value.replace('Z', '+00:00'))
            return process(value)
        return parse_then_process
    monkeypatch.setattr(sqlite_base.DATETIME, 'bind_processor', bind_processor)


@pytest.fixture
def env(tmp_path, monkeypatch):
    accept_iso_strings(monkeypatch)
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    # Only the tables these screens touch; the rest use Postgres-only types,
    # so foreign keys pointing at them can't be checked
    sa.event.listen(
        database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF')
    )
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in TABLES])
    # The estimate and invoice services open their own sessions
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)

    setup = database.get_session()
    people = {}
    for username, role in [('boss', StaffRole.super_admin), ('jane', StaffRole.technician),
                           ('sam', StaffRole.technician), ('kim', StaffRole.sales)]:
        staff = Staff(
            staff_number=username.upper(), first_name=username.title(), last_name='Tester',
            email=f'{username}@example.com', role=role, hire_date=datetime(2026, 1, 1),
            username=username, is_active=True, can_login=True,
        )
        setup.add(staff)
        people[username] = staff
    company = Company(name='Jane Roofing', company_type='contractor')
    setup.add(company)
    setup.flush()
    # Everyone works for the company the documents come from, so only ownership decides
    for name in ('jane', 'sam', 'kim'):
        setup.add(StaffCompany(staff_id=people[name].id, company_id=company.id))
    setup.commit()
    ids = {name: str(s.id) for name, s in people.items()}
    company_id = str(company.id)
    setup.close()

    cache = CacheService.__new__(CacheService)
    cache.redis_client = InMemoryCache()
    InMemoryCache._shared_cache.clear()
    InMemoryCache._shared_ttls.clear()

    def request_session():
        session = database.get_session()
        try:
            yield session
            session.commit()
        finally:
            session.close()

    app = FastAPI()
    app.include_router(estimate_api.router, prefix='/api/estimates')
    app.include_router(invoice_api.router, prefix='/api/invoices')
    app.include_router(transfer_api.router, prefix='/api/document-transfers')
    app.include_router(messaging_api.router, prefix='/api/messages')
    app.dependency_overrides[get_db_session] = request_session
    app.dependency_overrides[get_cache] = lambda: cache
    client = TestClient(app)

    def as_(name):
        client.headers['Authorization'] = f'Bearer {token_for(people[name])}'
        return client

    def make_estimate(owner, number='EST-1', client_name='Pat Client'):
        session = database.get_session()
        estimate = Estimate(
            estimate_number=number, client_name=client_name, owner_id=ids[owner],
            company_id=company_id, status='sent', total_amount=100,
        )
        session.add(estimate)
        session.flush()
        session.add(EstimateItem(estimate_id=estimate.id, name='Tear-off', description='Tear-off',
                                 quantity=1, unit='ea', rate=100, amount=100))
        session.commit()
        estimate_id = str(estimate.id)
        session.close()
        return estimate_id

    def make_invoice(owner, number='INV-1', client_name='Pat Client'):
        session = database.get_session()
        invoice = Invoice(
            invoice_number=number, client_name=client_name, owner_id=ids[owner],
            company_id=company_id, status='paid', total_amount=250,
            payments=[{'amount': 250, 'date': '2026-10-01', 'method': 'CK'}],
        )
        session.add(invoice)
        session.flush()
        session.add(InvoiceItem(invoice_id=invoice.id, name='Labor', description='Labor',
                                quantity=1, unit='ea', rate=250, amount=250))
        session.commit()
        invoice_id = str(invoice.id)
        session.close()
        return invoice_id

    def row(model, row_id):
        session = database.get_session()
        found = session.query(model).filter(model.id == str(row_id)).first()
        session.close()
        return found

    def delete_estimate(estimate_id):
        session = database.get_session()
        session.query(EstimateItem).filter(EstimateItem.estimate_id == estimate_id).delete()
        session.query(Estimate).filter(Estimate.id == estimate_id).delete()
        session.commit()
        session.close()

    yield {
        'as': as_, 'ids': ids, 'company_id': company_id, 'make_estimate': make_estimate,
        'make_invoice': make_invoice, 'row': row, 'delete_estimate': delete_estimate,
    }
    database.engine.dispose()


def numbers(response, field):
    assert response.status_code == 200, response.text
    body = response.json()
    rows = body['invoices'] if isinstance(body, dict) else body
    return sorted(r[field] for r in rows)


# Ownership

def test_lists_show_only_your_own_documents(env):
    env['make_estimate']('jane', 'EST-J')
    env['make_estimate']('sam', 'EST-S')
    env['make_invoice']('jane', 'INV-J')
    env['make_invoice']('sam', 'INV-S')

    jane = env['as']('jane')
    assert numbers(jane.get('/api/estimates/'), 'estimate_number') == ['EST-J']
    assert numbers(jane.get('/api/invoices/'), 'invoice_number') == ['INV-J']
    # Asking for everyone's doesn't widen it for anyone but a super admin
    assert numbers(jane.get('/api/estimates/?scope=all'), 'estimate_number') == ['EST-J']


def test_a_super_admin_can_see_everyones_with_the_owner_named(env):
    env['make_estimate']('jane', 'EST-J')
    env['make_estimate']('sam', 'EST-S')

    boss = env['as']('boss')
    assert numbers(boss.get('/api/estimates/'), 'estimate_number') == []
    response = boss.get('/api/estimates/?scope=all')
    assert numbers(response, 'estimate_number') == ['EST-J', 'EST-S']
    assert {r['estimate_number']: r['owner_name'] for r in response.json()} == {
        'EST-J': 'Jane Tester', 'EST-S': 'Sam Tester',
    }


def test_someone_elses_document_answers_not_found(env):
    estimate_id = env['make_estimate']('sam')
    invoice_id = env['make_invoice']('sam')

    jane = env['as']('jane')
    assert jane.get(f'/api/estimates/{estimate_id}').status_code == 404
    assert jane.put(f'/api/estimates/{estimate_id}', json={}).status_code == 404
    assert jane.delete(f'/api/estimates/{estimate_id}').status_code == 404
    assert jane.post(f'/api/estimates/{estimate_id}/duplicate').status_code == 404
    assert jane.get(f'/api/invoices/{invoice_id}').status_code == 404
    assert jane.delete(f'/api/invoices/{invoice_id}').status_code == 404
    assert jane.get('/api/estimates/not-a-uuid').status_code == 404
    assert env['row'](Estimate, estimate_id) is not None

    assert env['as']('sam').get(f'/api/estimates/{estimate_id}').status_code == 200
    assert env['as']('boss').get(f'/api/invoices/{invoice_id}').status_code == 200


def test_documents_need_a_signed_in_person(env):
    client = env['as']('jane')
    del client.headers['Authorization']
    assert client.get('/api/estimates/').status_code in (401, 403)
    assert client.get('/api/invoices/').status_code in (401, 403)


def test_a_duplicate_belongs_to_whoever_made_it(env):
    estimate_id = env['make_estimate']('jane')

    response = env['as']('boss').post(f'/api/estimates/{estimate_id}/duplicate')

    assert response.status_code == 200, response.text
    assert env['row'](Estimate, response.json()['id']).owner_id == env['ids']['boss']


# Offering a document to someone else

def send(client, document_type, document_id, recipients, note=None):
    return client.post('/api/document-transfers/', json={
        'document_type': document_type, 'document_id': document_id,
        'recipient_ids': recipients, 'note': note,
    })


def test_the_recipient_gets_a_copy_only_after_accepting(env):
    estimate_id = env['make_estimate']('jane', 'EST-J', 'Pat Client')
    sam_id = env['ids']['sam']

    sent = send(env['as']('jane'), 'estimate', estimate_id, [sam_id], note='Please finish this one')
    assert sent.status_code == 200, sent.text
    transfer = sent.json()[0]
    assert transfer['status'] == 'pending'

    sam = env['as']('sam')
    assert numbers(sam.get('/api/estimates/'), 'estimate_number') == []
    assert sam.get(f'/api/estimates/{estimate_id}').status_code == 404
    assert sam.get('/api/messages/unread-count').json() == {'unread': 1}
    pending = sam.get('/api/document-transfers/incoming?status=pending').json()
    assert [(t['document_number'], t['from_name'], t['note']) for t in pending] == [
        ('EST-J', 'Jane Tester', 'Please finish this one'),
    ]

    accepted = sam.post(f"/api/document-transfers/{transfer['id']}/accept")

    assert accepted.status_code == 200, accepted.text
    copy_id = accepted.json()['copy_id']
    assert accepted.json()['copy_link'] == f'/edit/estimate/{copy_id}'
    copy = env['row'](Estimate, copy_id)
    assert copy.owner_id == sam_id
    assert copy.estimate_number != 'EST-J'
    assert copy.status == 'draft'
    assert copy.client_name == 'Pat Client'
    assert copy.company_id == env['company_id']
    assert sam.get(f'/api/estimates/{copy_id}').status_code == 200
    # The sender keeps the original, untouched
    original = env['row'](Estimate, estimate_id)
    assert (original.owner_id, original.status) == (env['ids']['jane'], 'sent')
    # And hears back
    assert env['as']('jane').get('/api/messages/unread-count').json() == {'unread': 1}


def test_an_invoice_copy_starts_without_payments(env):
    invoice_id = env['make_invoice']('jane', 'INV-J')
    transfer = send(env['as']('jane'), 'invoice', invoice_id, [env['ids']['sam']]).json()[0]

    accepted = env['as']('sam').post(f"/api/document-transfers/{transfer['id']}/accept")

    assert accepted.status_code == 200, accepted.text
    copy = env['row'](Invoice, accepted.json()['copy_id'])
    assert copy.owner_id == env['ids']['sam']
    assert copy.payments == []
    assert copy.status == 'draft'
    assert copy.company_id == env['company_id']
    assert env['row'](Invoice, invoice_id).payments != []


def test_one_send_can_go_to_several_people_but_not_twice_to_the_same_one(env):
    estimate_id = env['make_estimate']('jane')
    jane = env['as']('jane')
    sam_id, kim_id = env['ids']['sam'], env['ids']['kim']

    first = send(jane, 'estimate', estimate_id, [sam_id, kim_id, env['ids']['jane']])
    again = send(jane, 'estimate', estimate_id, [sam_id])

    assert first.status_code == 200
    assert sorted(t['to_name'] for t in first.json()) == ['Kim Tester', 'Sam Tester']
    assert again.json()[0]['id'] in {t['id'] for t in first.json()}
    assert len(env['as']('sam').get('/api/document-transfers/incoming').json()) == 1


def test_you_can_only_send_your_own_document_to_someone_real(env):
    sams = env['make_estimate']('sam')
    janes = env['make_estimate']('jane')
    jane = env['as']('jane')

    assert send(jane, 'estimate', sams, [env['ids']['kim']]).status_code == 404
    assert send(jane, 'estimate', janes, [env['ids']['jane']]).status_code == 400
    assert send(jane, 'estimate', janes, ['00000000-0000-0000-0000-000000000000']).status_code == 400


def test_declining_or_taking_back_leaves_no_copy(env):
    estimate_id = env['make_estimate']('jane')
    jane = env['as']('jane')
    to_sam = send(jane, 'estimate', estimate_id, [env['ids']['sam']]).json()[0]
    to_kim = send(jane, 'estimate', estimate_id, [env['ids']['kim']]).json()[0]

    # Only the recipient answers, only the sender takes back
    assert jane.post(f"/api/document-transfers/{to_sam['id']}/accept").status_code == 404
    assert env['as']('kim').post(f"/api/document-transfers/{to_sam['id']}/cancel").status_code == 404

    declined = env['as']('sam').post(f"/api/document-transfers/{to_sam['id']}/decline")
    cancelled = env['as']('jane').post(f"/api/document-transfers/{to_kim['id']}/cancel")
    late = env['as']('kim').post(f"/api/document-transfers/{to_kim['id']}/accept")

    assert declined.json()['status'] == 'declined'
    assert cancelled.json()['status'] == 'cancelled'
    assert late.status_code == 409
    assert numbers(env['as']('sam').get('/api/estimates/'), 'estimate_number') == []
    assert numbers(env['as']('kim').get('/api/estimates/'), 'estimate_number') == []


def test_accepting_after_the_original_was_deleted_says_so(env):
    estimate_id = env['make_estimate']('jane')
    transfer = send(env['as']('jane'), 'estimate', estimate_id, [env['ids']['sam']]).json()[0]
    env['delete_estimate'](estimate_id)

    response = env['as']('sam').post(f"/api/document-transfers/{transfer['id']}/accept")

    assert response.status_code == 410
    assert env['row'](DocumentTransfer, transfer['id']).status == 'cancelled'


def test_the_offer_shows_in_the_conversation_with_its_state(env):
    estimate_id = env['make_estimate']('jane', 'EST-J')
    transfer = send(env['as']('jane'), 'estimate', estimate_id, [env['ids']['sam']]).json()[0]
    sam = env['as']('sam')
    conversation = sam.get('/api/messages/conversations').json()[0]
    assert conversation['display_name'] == 'Jane Tester'

    sam.post(f"/api/document-transfers/{transfer['id']}/accept")
    messages = sam.get(f"/api/messages/conversations/{conversation['id']}/messages").json()

    assert [m['kind'] for m in messages] == ['document_transfer', 'transfer_reply']
    assert 'Estimate #EST-J (Pat Client)' in messages[0]['body']
    assert messages[0]['transfer']['status'] == 'accepted'
    assert messages[0]['transfer']['copy_link'].startswith('/edit/estimate/')


# Messages

def test_one_to_one_conversations_are_reused(env):
    jane = env['as']('jane')
    first = jane.post('/api/messages/conversations', json={'participant_ids': [env['ids']['sam']]})
    again = jane.post('/api/messages/conversations', json={'participant_ids': [env['ids']['sam']]})
    from_sam = env['as']('sam').post('/api/messages/conversations', json={'participant_ids': [env['ids']['jane']]})

    assert first.status_code == 200, first.text
    assert first.json()['is_group'] is False
    assert first.json()['id'] == again.json()['id'] == from_sam.json()['id']


def test_unread_counts_follow_what_each_person_has_read(env):
    jane = env['as']('jane')
    group = jane.post('/api/messages/conversations', json={
        'participant_ids': [env['ids']['sam'], env['ids']['kim']], 'title': 'Roof crew',
    }).json()
    assert group['is_group'] is True and group['display_name'] == 'Roof crew'

    jane.post(f"/api/messages/conversations/{group['id']}/messages", json={'body': 'Starting at 8'})
    jane.post(f"/api/messages/conversations/{group['id']}/messages", json={'body': 'Bring the ladder'})

    assert jane.get('/api/messages/unread-count').json() == {'unread': 0}
    sam = env['as']('sam')
    inbox = sam.get('/api/messages/conversations').json()
    assert [(c['display_name'], c['unread_count'], c['last_message']['body']) for c in inbox] == [
        ('Roof crew', 2, 'Bring the ladder'),
    ]
    assert sam.post(f"/api/messages/conversations/{group['id']}/read").json() == {'unread': 0}
    assert env['as']('kim').get('/api/messages/unread-count').json() == {'unread': 2}


def test_checking_for_new_messages_returns_only_the_new_ones(env):
    jane = env['as']('jane')
    conversation = jane.post('/api/messages/conversations', json={'participant_ids': [env['ids']['sam']]}).json()
    url = f"/api/messages/conversations/{conversation['id']}/messages"
    first = jane.post(url, json={'body': 'one'}).json()
    jane.post(url, json={'body': 'two'})

    newer = env['as']('sam').get(url, params={'after': first['created_at']}).json()

    assert [m['body'] for m in newer] == ['two']


def test_only_members_can_read_or_write_a_conversation(env):
    conversation = env['as']('jane').post(
        '/api/messages/conversations', json={'participant_ids': [env['ids']['sam']]}
    ).json()
    kim = env['as']('kim')

    assert kim.get(f"/api/messages/conversations/{conversation['id']}/messages").status_code == 404
    assert kim.post(
        f"/api/messages/conversations/{conversation['id']}/messages", json={'body': 'hi'}
    ).status_code == 404


def test_groups_can_add_people_and_be_left(env):
    jane = env['as']('jane')
    group = jane.post('/api/messages/conversations', json={
        'participant_ids': [env['ids']['sam'], env['ids']['kim']],
    }).json()
    assert group['is_group'] is True
    direct = jane.post('/api/messages/conversations', json={'participant_ids': [env['ids']['sam']]}).json()

    assert jane.post(
        f"/api/messages/conversations/{direct['id']}/participants", json={'staff_ids': [env['ids']['kim']]}
    ).status_code == 400

    added = env['as']('kim').post(
        f"/api/messages/conversations/{group['id']}/participants", json={'staff_ids': [env['ids']['boss']]}
    )
    assert sorted(p['name'] for p in added.json()['participants']) == [
        'Boss Tester', 'Jane Tester', 'Kim Tester', 'Sam Tester',
    ]
    # Joining shows the history without counting it as unread
    assert env['as']('boss').get('/api/messages/unread-count').json() == {'unread': 0}

    left = env['as']('sam').delete(f"/api/messages/conversations/{group['id']}/participants/me")
    assert left.status_code == 200
    assert env['as']('sam').get(f"/api/messages/conversations/{group['id']}").status_code == 404
    notices = env['as']('jane').get(f"/api/messages/conversations/{group['id']}/messages").json()
    assert [m['body'] for m in notices] == ['Kim Tester added Boss Tester', 'Sam Tester left the group']
    # Membership notices aren't unread messages
    assert env['as']('jane').get('/api/messages/unread-count').json() == {'unread': 0}


def test_people_lists_everyone_who_can_sign_in(env):
    people = env['as']('jane').get('/api/messages/people').json()
    assert [p['name'] for p in people] == ['Boss Tester', 'Jane Tester', 'Kim Tester', 'Sam Tester']
