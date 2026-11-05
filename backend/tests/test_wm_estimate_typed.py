"""A WM insurance amount typed in on the job page is not an estimate received: the
comparison card says which it is, so it doesn't show 'Estimate received' for it."""

from tests.test_wm_estimate_clear import JOBS, env  # noqa: F401  (env is the fixture)


def card(api, job_id):
    return api.get(f"{JOBS}/{job_id}/financial-comparison").json()['insurance_estimate']


def test_a_typed_amount_is_marked_manual(env):
    api, _, ids = env
    assert api.post(f"{JOBS}/{ids.job}/insurance-estimate/manual", json={'wm_amount': 5000}).status_code == 200

    estimate = card(api, ids.job)
    assert estimate['is_manual'] is True
    assert estimate['wm_section']['rcv'] == 5000


def test_an_uploaded_estimate_after_it_is_not(env):
    api, _, ids = env
    api.post(f"{JOBS}/{ids.job}/insurance-estimate/manual", json={'wm_amount': 5000})
    response = api.post(
        f"{JOBS}/{ids.job}/insurance-estimate",
        files={'file': ('wm.pdf', b'%PDF-1.4 wm', 'application/pdf')},
        data={'wm_amount': '5200', 'wm_section': '{"section_name": "Water Mitigation", "rcv": 5200}'},
    )
    assert response.status_code == 200, response.text

    estimate = card(api, ids.job)
    assert estimate['is_manual'] is False
    assert estimate['negotiation_date']


def test_no_estimate_is_not_manual(env):
    api, _, ids = env
    assert card(api, ids.job)['is_manual'] is False
