"""A 'Prepare Supplement Estimate' follow-up task left open after the supplement went
out doesn't hold the claim on Supplement Prep (9512 Ash Hollow Pl: the task from
Aug 27 was still pending when the supplement was submitted on Oct 20). Uses the
helpers and the throwaway database from test_claim_stage.py."""

from datetime import datetime, timezone

from app.domains.claim_followup.models import FollowUpTask
from app.domains.client.models import Claim, Client
from app.domains.supplement.models import SupplementRequest

from test_claim_stage import env, stage, task  # noqa: F401  (env is a fixture)

ESTIMATE = {'insurance_estimate_received': True}
OPENED = datetime(2026, 8, 27)
SUBMITTED = datetime(2026, 10, 20)


def prep(opened=(OPENED,), supplements=None, out=None):
    return stage(
        ESTIMATE,
        tasks=[task('supplement_estimate_prep')] * len(opened),
        prep_tasks_opened=list(opened),
        supplements=supplements or {'s1': ('submitted', 'supplement')},
        supplements_out={'s1': SUBMITTED} if out is None else out,
    )


def test_a_supplement_submitted_after_the_prep_task_is_followed_up():
    assert prep() == ('supplement_followup', 'Submitted, awaiting approval')
    assert prep(supplements={'s1': ('under_review', 'supplement')})[0] == 'supplement_followup'


def test_a_supplement_answered_after_the_prep_task_moves_on():
    assert prep(supplements={'s1': ('approved', 'supplement')}) == ('construction', 'Not started')


def test_a_prep_task_opened_after_the_supplement_went_out_is_a_new_round():
    assert prep(opened=(datetime(2026, 11, 1),))[0] == 'supplement_prep'
    # One old task and one new: the new one is still being written
    assert prep(opened=(OPENED, datetime(2026, 11, 1)))[0] == 'supplement_prep'


def test_a_prep_task_still_counts_without_anything_out():
    assert prep(supplements={'s1': ('identified', 'supplement')}, out={})[0] == 'supplement_prep'
    # An estimate the carrier asked us for isn't the supplement
    assert prep(supplements={'s1': ('submitted', 'estimate_request')})[0] == 'supplement_prep'
    # A task whose opening time isn't known is taken as still open
    assert stage(ESTIMATE, tasks=[task('supplement_estimate_prep')],
                 supplements={'s1': ('submitted', 'supplement')},
                 supplements_out={'s1': SUBMITTED})[0] == 'supplement_prep'


def test_the_client_list_shows_the_submitted_supplement(env):
    api, database = env
    session = database.get_session()
    ahn = Client(display_name='Ahn Client', owners=[])
    session.add(ahn)
    session.flush()
    claim = Claim(client_id=ahn.id, claim_number='JIT-1', status='open', insurance_estimate_received=True)
    session.add(claim)
    session.flush()
    session.add(FollowUpTask(claim_id=claim.id, task_type='supplement_estimate_prep', status='pending',
                             title='Prepare Supplement Estimate', created_at=OPENED))
    session.add(SupplementRequest(claim_id=claim.id, title='Supplement', status='submitted',
                                  submitted_date=SUBMITTED.replace(tzinfo=timezone.utc)))
    session.commit()
    ahn_id = str(ahn.id)
    session.close()

    row = api.get('/api/clients/').json()['clients'][0]
    assert (row['claim_stage'], row['claim_stage_detail']) == (
        'supplement_followup', 'Submitted, awaiting approval')
    [listed] = api.get(f'/api/clients/{ahn_id}/claims').json()['claims']
    assert listed['stage'] == 'supplement_followup'
