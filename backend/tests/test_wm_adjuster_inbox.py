"""Mail from a job's adjuster, or quoting its claim number, is filed on the
water mitigation job so it shows before the next follow-up goes out."""

from datetime import datetime, timezone
from pathlib import Path
import sys

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401
from app.domains.claim_followup.models import FollowUpTask, SentEmail  # noqa: E402
from app.domains.client.models import Claim, Client  # noqa: E402
from app.domains.email_ingestion.email_client import FetchedEmail, IMAPClient  # noqa: E402
from app.domains.email_ingestion.models import EmailAccount, ReceivedEmail  # noqa: E402
from app.domains.email_ingestion.service import EmailIngestionService  # noqa: E402
from app.domains.water_mitigation.adjuster_email_service import AdjusterEmailService  # noqa: E402
from app.domains.water_mitigation.adjuster_inbox import (  # noqa: E402
    AdjusterInboxService,
    JobMailIndex,
    classify_reply,
)
from app.domains.water_mitigation.models import WaterMitigationJob  # noqa: E402


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


class FakeDatabase:
    def __init__(self, engine):
        self._sessions = sessionmaker(bind=engine)

    def get_session(self):
        return self._sessions()

    get_readonly_session = get_session


@pytest.fixture
def env(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'inbox.db'}")
    for model in (WaterMitigationJob, Client, Claim, SentEmail, FollowUpTask, EmailAccount, ReceivedEmail):
        model.__table__.create(engine)
    database = FakeDatabase(engine)
    session = database.get_session()

    account = EmailAccount(
        display_name='Office', email_address='office@ourco.com', username='office@ourco.com',
        encrypted_password='x', imap_server='imap.gmail.com', imap_port=993,
    )
    session.add(account)
    session.commit()

    def add_job(**fields):
        job = WaterMitigationJob(
            property_address=fields.pop('property_address', '12 Elm St, Austin TX'),
            status=fields.pop('status', 'Sent to adjuster'),
            **fields,
        )
        session.add(job)
        session.commit()
        return job

    def add_claim(claim_number='UNRELATED-0001', adjuster_email=None):
        client = Client(display_name='Someone Else')
        session.add(client)
        session.flush()
        claim = Claim(client_id=client.id, claim_number=claim_number, adjuster_email=adjuster_email)
        session.add(claim)
        session.commit()
        return claim

    yield {
        'database': database, 'session': session, 'account': account,
        'add_job': add_job, 'add_claim': add_claim,
    }
    session.close()
    engine.dispose()


def mail(sender='Pat Lee <pat@carrier.com>', subject='Checking in', body='', message_id='<m1@carrier.com>'):
    return FetchedEmail(
        message_id=message_id, subject=subject, sender=sender,
        received_at=datetime(2026, 10, 20, 15, tzinfo=timezone.utc),
        body_text=body, body_html='',
    )


def save(env, fetched):
    service = EmailIngestionService(env['database'])
    session = env['session']
    return service._save_received_email(
        session, str(env['account'].id), fetched,
        wm_index=JobMailIndex.load(session), own_address='office@ourco.com',
    )


def stored(env):
    env['session'].expire_all()
    return env['session'].query(ReceivedEmail).all()


# ---- matching ----

def test_claim_number_matches_however_it_is_punctuated(env):
    job = env['add_job'](claim_number='0123-456-789', adjuster_email='pat@carrier.com')
    index = JobMailIndex.load(env['session'])

    job_id, method, _ = index.match('RE: Follow Up - 0123456789', '', 'claims@other.com')

    assert (job_id, method) == (str(job.id), 'claim_number')


def test_short_claim_numbers_are_not_matched_inside_other_numbers(env):
    env['add_job'](claim_number='77')
    index = JobMailIndex.load(env['session'])

    assert index.match('Call me at 512-555-7700', 'Zip 78777', 'x@y.com')[0] is None


def test_adjuster_with_one_open_job_matches_by_sender(env):
    job = env['add_job'](adjuster_emails=[{'name': 'Desk', 'email': 'Desk@Carrier.com', 'role': 'adjuster'}])
    index = JobMailIndex.load(env['session'])

    job_id, method, _ = index.match('Status', 'Still under review.', 'Desk <desk@carrier.com>')

    assert (job_id, method) == (str(job.id), 'adjuster_email')


def test_adjuster_on_several_jobs_needs_the_homeowner_or_street(env):
    env['add_job'](adjuster_email='pat@carrier.com', homeowner_name='Ann Brown', property_street='12 Elm St')
    jones = env['add_job'](adjuster_email='pat@carrier.com', homeowner_name='Bo Jones', property_street='88 Oak Ave')
    index = JobMailIndex.load(env['session'])

    assert index.match('Update', 'Still reviewing.', 'pat@carrier.com')[0] is None
    assert index.match('Jones loss', 'Still reviewing.', 'pat@carrier.com')[0] == str(jones.id)
    assert index.match('Update', 'The 88 Oak file is in review.', 'pat@carrier.com')[0] == str(jones.id)


def test_finished_jobs_are_not_matched_by_sender_alone(env):
    env['add_job'](adjuster_email='pat@carrier.com', status='Complete')
    index = JobMailIndex.load(env['session'])

    assert index.match('Hi', 'New loss assigned to me.', 'pat@carrier.com')[0] is None


def test_our_own_copy_is_not_an_adjuster_email(env):
    env['add_job'](claim_number='CLM-12345', adjuster_email='pat@carrier.com')
    index = JobMailIndex.load(env['session'])

    assert index.match('Follow Up - CLM-12345', '', 'Office <office@ourco.com>',
                       own_address='office@ourco.com')[0] is None


# ---- storing ----

def test_adjuster_reply_on_a_job_without_a_claim_is_kept(env):
    job = env['add_job'](claim_number='CLM-12345', adjuster_email='pat@carrier.com')

    assert save(env, mail(subject='RE: Follow Up - CLM-12345', body='Still under review.'))

    [row] = stored(env)
    assert str(row.matched_wm_job_id) == str(job.id)
    assert row.matched_claim_id is None
    assert row.match_method == 'claim_number'


def test_job_claim_is_filled_in_from_the_job(env):
    claim = env['add_claim']()
    job = env['add_job'](claim_id=claim.id, adjuster_email='pat@carrier.com')

    assert save(env, mail(body='We received the documents.'))

    [row] = stored(env)
    assert str(row.matched_wm_job_id) == str(job.id)
    assert str(row.matched_claim_id) == str(claim.id)
    assert str(row.matched_client_id) == str(claim.client_id)


def test_claim_matched_by_number_keeps_its_own_job(env):
    claim = env['add_claim'](claim_number='CLM-99999')
    job = env['add_job'](claim_id=claim.id, claim_number='CLM-99999', adjuster_email='pat@carrier.com')

    assert save(env, mail(subject='Claim # CLM-99999'))

    [row] = stored(env)
    assert str(row.matched_claim_id) == str(claim.id)
    assert str(row.matched_wm_job_id) == str(job.id)
    assert row.match_method == 'claim_number'


def test_unrelated_mail_is_still_dropped(env):
    env['add_job'](claim_number='CLM-12345', adjuster_email='pat@carrier.com')

    assert not save(env, mail(sender='news@shop.com', subject='Sale ends today'))
    assert stored(env) == []


# ---- the job's list and the on-demand check ----

def test_job_lists_its_own_and_its_claims_mail(env):
    claim = env['add_claim']()
    job = env['add_job'](claim_id=claim.id, adjuster_email='pat@carrier.com')
    session = env['session']
    account_id = env['account'].id
    session.add_all([
        ReceivedEmail(email_account_id=account_id, message_id='<a>', sender='Pat <pat@carrier.com>',
                      matched_wm_job_id=job.id, received_at=datetime(2026, 10, 21, tzinfo=timezone.utc)),
        ReceivedEmail(email_account_id=account_id, message_id='<b>', sender='home@owner.com',
                      matched_claim_id=claim.id, received_at=datetime(2026, 10, 19, tzinfo=timezone.utc)),
        ReceivedEmail(email_account_id=account_id, message_id='<c>', sender='pat@carrier.com'),
    ])
    session.commit()

    result = AdjusterInboxService(env['database']).list_job_emails(str(job.id))

    assert [i['message_id'] for i in result['items']] == ['<a>', '<b>']
    assert [i['from_adjuster'] for i in result['items']] == [True, False]
    assert result['adjuster_addresses'] == ['pat@carrier.com']
    assert result['items'][0]['account_email'] == 'office@ourco.com'


def test_check_searches_for_the_adjuster_and_claim_number(env, monkeypatch):
    job = env['add_job'](claim_number='CLM-12345', adjuster_email='pat@carrier.com')
    searches = []

    def fake_search(self, criteria, since_date=None, limit=50):
        searches.append(criteria)
        return [mail(subject='RE: Follow Up - CLM-12345', body='Under review.')]

    monkeypatch.setattr(IMAPClient, 'search_emails', fake_search)
    monkeypatch.setattr('app.domains.email_ingestion.service.decrypt_password', lambda _: 'pw')

    service = AdjusterInboxService(env['database'])
    result = service.check_job_inbox(str(job.id))

    assert searches == [['FROM "pat@carrier.com"', 'TEXT "CLM-12345"']]
    assert result['accounts_checked'] == 1
    assert result['saved'] == 1
    assert result['errors'] == []
    # Running it again finds the same message already stored
    assert service.check_job_inbox(str(job.id))['saved'] == 0
    [row] = stored(env)
    assert str(row.matched_wm_job_id) == str(job.id)


def test_check_skips_a_job_with_nothing_to_search_for(env):
    job = env['add_job']()

    result = AdjusterInboxService(env['database']).check_job_inbox(str(job.id))

    assert result['accounts_checked'] == 0
    assert result['skipped_reason']


# ---- picking the follow-up template from the adjuster's reply ----

@pytest.mark.parametrize('text, template', [
    ('Hi, the file is still under review. Thanks.', 'review_update'),
    ("Received - I'll be reviewing it this week.", 'review_update'),
    ('Got it, thanks!', 'review_status'),
    ('We received the invoice and photo report.', 'review_status'),
    ("Sorry, I haven't received the documents yet.", 'receipt'),
    ('Can you resend the W-9?', None),
])
def test_reply_is_read_for_where_the_documents_stand(text, template):
    found = classify_reply(text)
    assert (found[0] if found else None) == template


def test_reason_is_the_sentence_that_says_so():
    assert classify_reply('Hi Pat. The file is under review with our desk! More soon.') == (
        'review_update', 'The file is under review with our desk!'
    )


def add_reply(env, job, body, sender='Pat Lee <pat@carrier.com>', at=datetime(2026, 10, 20, tzinfo=timezone.utc)):
    env['session'].add(ReceivedEmail(
        email_account_id=env['account'].id, message_id=f'<{body[:20]}{at}>', sender=sender,
        body_text=body, matched_wm_job_id=job.id, received_at=at,
    ))
    env['session'].commit()


def followup(env, job):
    return AdjusterEmailService(env['database']).generate_followup_email(str(job.id))


SENT = datetime(2026, 10, 10, tzinfo=timezone.utc)


def test_followup_asks_for_an_update_once_the_adjuster_says_under_review(env):
    job = env['add_job'](adjuster_email='pat@carrier.com', documents_sent_date=SENT)
    add_reply(env, job, 'Thanks, this is under review.\n\nOn Fri, Oct 9, 2026 Office wrote:\n> Could you confirm you received them?')

    result = followup(env, job)

    assert result['template'] == 'review_update'
    assert result['suggested_by']['sentence'] == 'Thanks, this is under review.'
    assert 'mentioned were under review' in result['body_html']


def test_quoted_follow_up_text_does_not_count_as_a_reply(env):
    job = env['add_job'](adjuster_email='pat@carrier.com', documents_sent_date=SENT)
    add_reply(env, job, 'Who is this?\n\nOn Fri, Oct 9, 2026 Office wrote:\n> Could you confirm you received them?')

    result = followup(env, job)

    assert result['template'] == 'receipt'
    assert result['suggested_by'] is None


def test_only_the_adjusters_mail_since_the_documents_counts(env):
    job = env['add_job'](adjuster_email='pat@carrier.com', documents_sent_date=SENT)
    add_reply(env, job, 'It is under review, the adjuster says.', sender='home@owner.com')
    add_reply(env, job, 'I will review once I have them.', at=datetime(2026, 10, 1, tzinfo=timezone.utc))

    assert followup(env, job)['template'] == 'receipt'


def test_newest_reply_wins(env):
    job = env['add_job'](adjuster_email='pat@carrier.com', documents_sent_date=SENT)
    add_reply(env, job, 'Got it, thanks.', at=datetime(2026, 10, 12, tzinfo=timezone.utc))
    add_reply(env, job, 'Still under review.', at=datetime(2026, 10, 18, tzinfo=timezone.utc))

    assert followup(env, job)['template'] == 'review_update'


def test_status_already_past_the_reply_is_kept(env):
    job = env['add_job'](adjuster_email='pat@carrier.com', documents_sent_date=SENT, status='Paperwork received')
    add_reply(env, job, "I haven't received anything yet.")

    result = followup(env, job)

    assert result['template'] == 'review_status'
    assert result['suggested_by'] is None


def test_a_picked_template_is_left_alone(env):
    job = env['add_job'](adjuster_email='pat@carrier.com', documents_sent_date=SENT)
    add_reply(env, job, 'Still under review.')

    result = AdjusterEmailService(env['database']).generate_followup_email(str(job.id), template='receipt')

    assert result['template'] == 'receipt'
    assert result['suggested_by'] is None
