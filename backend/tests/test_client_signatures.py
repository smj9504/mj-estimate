"""A client's signature and initials kept on file: staff keep them on the client
page, the customer keeps what they drew on site, on-site signing can sign with
them, and the office can sign a new contract's client lines with them, the
customer not there, leaving the company's lines open."""

import base64
import json
from datetime import datetime, timedelta

from app.domains.client import client_signatures
from app.domains.client.models import ClaimTodo, ClientSignature
from app.domains.contract.models import ContractInstance, ContractSignature, ContractTemplate
from app.domains.contract.signature_on_file import ON_FILE, fields_from_file, kinds_needed
from tests.test_onsite_signing import MAPPINGS, SIGNATURE, both_documents, env, rows, sign_payload  # noqa: F401

# Another real PNG, so it can be told apart from what's drawn on site
KEPT = (
    'data:image/png;base64,'
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
)
KEPT_INITIALS = (
    'data:image/png;base64,'
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg=='
)

# The client's lines and the company's
WITH_COMPANY = [
    {'id': 'f-name', 'fieldKey': 'client.display_name', 'label': 'Client Name', 'pageIndex': 0, 'x': 0.1, 'y': 0.1},
    {'id': 'f-note', 'fieldKey': 'custom.note', 'label': 'Note', 'pageIndex': 0, 'x': 0.1, 'y': 0.2,
     'inputMode': 'signer'},
    {'id': 'h-sign', 'fieldKey': 'signature.homeowner', 'label': 'Homeowner', 'pageIndex': 0, 'x': 0.1, 'y': 0.6},
    {'id': 'h-init', 'fieldKey': 'initial.homeowner', 'label': 'Initials', 'pageIndex': 0, 'x': 0.5, 'y': 0.6},
    {'id': 'h-date', 'fieldKey': 'date_signed.homeowner', 'label': 'Date', 'pageIndex': 0, 'x': 0.1, 'y': 0.7},
    {'id': 'c-sign', 'fieldKey': 'signature.company_rep', 'label': 'Company', 'pageIndex': 0, 'x': 0.1, 'y': 0.8},
    {'id': 'c-date', 'fieldKey': 'date_signed.company_rep', 'label': 'Date', 'pageIndex': 0, 'x': 0.5, 'y': 0.8},
]


def signatures_of(env, client='pat'):
    return env.http.get(f"/clients/{env.ids[client]}/signatures")


def keep(env, kind='signature', image=KEPT, **over):
    body = {'image': image, 'signer_name': 'Pat Client', 'source': 'drawn', **over}
    return env.http.put(f"/clients/{env.ids['pat']}/signatures/{kind}", json=body)


def with_routes(env):
    env.http.app.include_router(client_signatures.router, prefix='/clients')
    return env


def add_template(env, mappings, name='Office Agreement'):
    session = env.database.get_session()
    try:
        base = session.query(ContractTemplate).filter(ContractTemplate.id == env.ids['completion']).first()
        row = ContractTemplate(
            company_id=base.company_id, name=name, document_type='authorization',
            file_url=base.file_url, storage_provider='local',
            field_mappings=json.dumps(mappings), is_active=True,
        )
        session.add(row)
        session.commit()
        return str(row.id)
    finally:
        session.close()


def make_contract(env, template_id, **over):
    body = {
        'template_id': template_id, 'claim_id': env.ids['claim'], 'client_id': env.ids['pat'],
        'company_id': env.ids['bethany'], **over,
    }
    response = env.http.post(f"/contracts/claims/{env.ids['claim']}/contracts", json=body)
    assert response.status_code == 200, response.text
    return response.json()['id']


def sign_on_file(env, contract_id, **over):
    body = {'authorized': True, 'authorization_text': 'Pat said yes', 'today': '11/09/2026', **over}
    return env.http.post(f"/contracts/contracts/{contract_id}/sign-on-file", json=body)


# ── What can be kept, and which lines it fills ───────────────────────────────


def test_only_a_real_png_or_jpeg_is_kept():
    assert client_signatures.image_problem(KEPT) is None
    assert client_signatures.image_problem('data:image/svg+xml;base64,PHN2Zz4=')
    assert client_signatures.image_problem('data:image/png;base64,not-base64!')
    # Says PNG, isn't one
    assert client_signatures.image_problem('data:image/png;base64,' + base64.b64encode(b'GIF89a').decode())
    big = b'\x89PNG\r\n\x1a\n' + b'0' * client_signatures.MAX_IMAGE_BYTES
    assert client_signatures.image_problem('data:image/png;base64,' + base64.b64encode(big).decode())


def test_the_file_fills_the_clients_lines_only():
    images = {'signature': KEPT, 'initial': KEPT_INITIALS}
    assert kinds_needed(WITH_COMPANY) == ['signature', 'initial']
    assert fields_from_file(WITH_COMPANY, images, '11/09/2026') == {
        'h-sign': KEPT, 'h-init': KEPT_INITIALS, 'h-date': '11/09/2026',
    }


def test_nothing_is_signed_with_part_of_what_it_needs():
    try:
        fields_from_file(WITH_COMPANY, {'signature': KEPT}, '11/09/2026')
        assert False, 'signed without initials'
    except ValueError as e:
        assert 'initials' in str(e)
    try:
        fields_from_file([WITH_COMPANY[5]], {'signature': KEPT}, '11/09/2026')
        assert False, "signed a contract with no line for the client"
    except ValueError as e:
        assert "client's signature" in str(e)


# ── The client page ──────────────────────────────────────────────────────────


def test_staff_keep_replace_and_take_off_a_signature(env):
    with_routes(env)
    assert signatures_of(env).json() == {'signature': None, 'initial': None}

    kept = keep(env)
    assert kept.status_code == 200, kept.text
    signature = kept.json()['signature']
    assert signature['image'] == KEPT
    assert signature['signer_name'] == 'Pat Client'
    assert signature['source'] == 'drawn'
    assert signature['saved_by_name'] == 'Field Test'
    assert kept.json()['initial'] is None

    # Keeping again replaces it: one of each kind per client
    keep(env, image=SIGNATURE, source='uploaded')
    assert len(rows(env, ClientSignature)) == 1
    assert signatures_of(env).json()['signature']['source'] == 'uploaded'

    assert env.http.delete(f"/clients/{env.ids['pat']}/signatures/signature").json()['signature'] is None
    assert rows(env, ClientSignature) == []


def test_what_staff_keep_must_be_an_image_with_a_name(env):
    with_routes(env)
    assert keep(env, image='data:image/svg+xml;base64,PHN2Zz4=').status_code == 400
    assert keep(env, signer_name='  ').status_code == 400
    # Only the customer keeps one on site
    assert keep(env, source='onsite').status_code == 400
    assert env.http.put(
        f"/clients/{env.ids['pat']}/signatures/stamp", json={'image': KEPT, 'signer_name': 'x'}
    ).status_code == 404
    assert rows(env, ClientSignature) == []


def test_someone_who_cannot_see_the_client_cannot_see_or_change_its_signature(env):
    with_routes(env)
    keep(env)
    env.current['as'] = 'outsider'
    assert signatures_of(env).status_code == 404
    assert keep(env, image=SIGNATURE).status_code == 404
    assert env.http.delete(f"/clients/{env.ids['pat']}/signatures/signature").status_code == 404
    assert rows(env, ClientSignature)[0].image == KEPT


# ── On site ──────────────────────────────────────────────────────────────────


def onsite_for_pat(env, **over):
    return sign_payload(env, client_id=env.ids['pat'], address=None, **over)


def test_the_form_brings_the_signature_on_file(env):
    with_routes(env)
    keep(env)
    form = env.http.post('/onsite/form', json={
        'template_ids': [env.ids['ewa'], env.ids['cos']], 'company_id': env.ids['bethany'],
        'client_id': env.ids['pat'],
    }).json()
    assert form['signature_on_file']['signature']['image'] == KEPT
    assert form['signature_on_file']['initial'] is None


def test_on_site_lines_can_be_signed_with_the_signature_on_file(env):
    with_routes(env)
    keep(env)
    keep(env, kind='initial', image=KEPT_INITIALS)
    documents = [
        {'template_id': env.ids['ewa'], 'signature_fields': {'s-home': ON_FILE, 's-init': ON_FILE}},
        {'template_id': env.ids['cos'], 'signature_fields': {'c-sign': ON_FILE}},
    ]
    response = env.http.post('/onsite/contracts', json=onsite_for_pat(env, documents=documents))
    assert response.status_code == 200, response.text
    assert response.json()['signature_kept'] is False

    signatures = rows(env, ContractSignature)
    assert {s.signature_image for s in signatures} == {KEPT}
    assert {s.signature_type for s in signatures} == {'on_file'}
    contract = rows(env, ContractInstance)[0]
    signed = next(e for e in json.loads(contract.audit_log) if e['action'] == 'signed')
    assert signed['detail']['signature_on_file'] is True
    assert signed['detail']['applied_by'] == 'Field Test'


def test_on_site_a_line_cannot_take_a_signature_that_is_not_on_file(env):
    with_routes(env)
    keep(env)
    # Initials asked for from the file, which has none
    documents = both_documents(env, ewa={'s-home': ON_FILE, 's-init': ON_FILE})
    response = env.http.post('/onsite/contracts', json=onsite_for_pat(env, documents=documents))
    assert response.status_code == 400
    assert 'Initials' in response.json()['detail']
    assert rows(env, ContractInstance) == []


def test_the_customer_keeps_what_they_drew_on_file(env):
    with_routes(env)
    text = 'Keep my signature on file for my future documents.'
    response = env.http.post('/onsite/contracts', json=onsite_for_pat(
        env, keep_signature_on_file=True, keep_on_file_text=text,
    ))
    assert response.status_code == 200, response.text
    assert response.json()['signature_kept'] is True

    kept = {row.kind: row for row in rows(env, ClientSignature)}
    assert set(kept) == {'signature', 'initial'}
    assert kept['signature'].source == 'onsite'
    assert kept['signature'].signer_name == 'Sam Homeowner'
    assert kept['signature'].consent_text == text
    assert kept['signature'].saved_by_name == 'Field Test'
    assert str(kept['signature'].contract_id) in {str(c.id) for c in rows(env, ContractInstance)}


def test_a_new_client_made_on_site_keeps_it_too(env):
    response = env.http.post('/onsite/contracts', json=sign_payload(env, keep_signature_on_file=True))
    assert response.status_code == 200, response.text
    assert {str(r.client_id) for r in rows(env, ClientSignature)} == {response.json()['client_id']}


def test_nothing_is_kept_unless_the_customer_asks(env):
    env.http.post('/onsite/contracts', json=onsite_for_pat(env))
    assert rows(env, ClientSignature) == []


def test_a_kind_signed_from_the_file_is_not_kept_again(env):
    with_routes(env)
    keep(env)
    documents = [
        {'template_id': env.ids['ewa'], 'signature_fields': {'s-home': ON_FILE, 's-init': SIGNATURE}},
        {'template_id': env.ids['cos'], 'signature_fields': {'c-sign': ON_FILE}},
    ]
    env.http.post('/onsite/contracts', json=onsite_for_pat(env, documents=documents, keep_signature_on_file=True))
    kept = {row.kind: row for row in rows(env, ClientSignature)}
    assert kept['signature'].source == 'drawn'
    assert kept['initial'].source == 'onsite'


# ── The office ───────────────────────────────────────────────────────────────


def test_the_office_signs_the_clients_lines_with_the_signature_on_file(env):
    with_routes(env)
    env.current['as'] = 'admin'
    keep(env)
    keep(env, kind='initial', image=KEPT_INITIALS)
    template_id = add_template(env, WITH_COMPANY)
    contract_id = make_contract(env, template_id, prefill_overrides={'custom': {'note': 'Back door code 1234'}})

    response = sign_on_file(env, contract_id)
    assert response.status_code == 200, response.text
    contract = response.json()
    assert contract['status'] == 'signed'
    assert contract['signed_pdf_url']
    # The company still signs its own line
    assert [line['id'] for line in contract['open_company_lines']] == ['c-sign', 'c-date']

    signature = rows(env, ContractSignature)[0]
    assert signature.signer_name == 'Pat Client'
    assert signature.signature_type == 'on_file'
    assert signature.signature_image == KEPT
    assert signature.consent_agreed is False
    assert signature.consent_text == 'Pat said yes'
    assert set(json.loads(signature.signed_field_ids)) == {'h-sign', 'h-init', 'h-date'}

    instance = rows(env, ContractInstance)[0]
    # Nobody signs from the link now
    assert instance.token_expires_at <= datetime.utcnow() + timedelta(seconds=1)
    signed = next(e for e in json.loads(instance.audit_log) if e['action'] == 'signed')
    assert signed['actor_name'] == 'Admin Test'
    assert signed['detail']['applied_by'] == 'Admin Test'
    assert signed['detail']['signature_type'] == 'on_file'
    # The admins are asked for the company's signature
    assert [t.contract_task for t in rows(env, ClaimTodo)] == ['company_signature']


def test_the_office_text_for_the_signer_is_drawn_with_the_signature(env):
    from pypdf import PdfReader

    with_routes(env)
    env.current['as'] = 'admin'
    keep(env)
    keep(env, kind='initial', image=KEPT_INITIALS)
    contract_id = make_contract(
        env, add_template(env, WITH_COMPANY), prefill_overrides={'custom': {'note': 'Back door code 1234'}},
    )
    contract = sign_on_file(env, contract_id).json()
    text = ''.join(page.extract_text() for page in PdfReader(contract['signed_pdf_url']).pages)
    assert 'Back door code 1234' in text


def test_the_office_must_say_the_client_allowed_it(env):
    with_routes(env)
    env.current['as'] = 'admin'
    keep(env)
    contract_id = make_contract(env, env.ids['completion'])
    keep(env, kind='initial', image=KEPT_INITIALS)
    assert sign_on_file(env, contract_id, authorized=False).status_code == 400
    assert rows(env, ContractSignature) == []


def test_the_office_cannot_sign_with_what_is_not_on_file(env):
    with_routes(env)
    env.current['as'] = 'admin'
    contract_id = make_contract(env, env.ids['completion'])
    assert sign_on_file(env, contract_id).status_code == 400
    keep(env)
    # The template has initials lines too
    response = sign_on_file(env, contract_id)
    assert response.status_code == 400 and 'initials' in response.json()['detail']
    assert rows(env, ContractSignature) == []


def test_a_contract_is_signed_with_the_file_once(env):
    with_routes(env)
    env.current['as'] = 'admin'
    keep(env)
    keep(env, kind='initial', image=KEPT_INITIALS)
    contract_id = make_contract(env, env.ids['completion'])
    assert sign_on_file(env, contract_id).status_code == 200
    assert sign_on_file(env, contract_id).status_code == 409
    assert len(rows(env, ContractSignature)) == 1


def test_an_old_link_does_not_stop_the_office(env):
    with_routes(env)
    env.current['as'] = 'admin'
    keep(env)
    keep(env, kind='initial', image=KEPT_INITIALS)
    contract_id = make_contract(env, env.ids['completion'])
    session = env.database.get_session()
    session.query(ContractInstance).filter(ContractInstance.id == contract_id).update(
        {'token_expires_at': datetime.utcnow() - timedelta(days=3)}
    )
    session.commit()
    session.close()
    assert sign_on_file(env, contract_id).status_code == 200


def test_someone_out_of_reach_cannot_sign_with_it(env):
    with_routes(env)
    env.current['as'] = 'admin'
    keep(env)
    keep(env, kind='initial', image=KEPT_INITIALS)
    contract_id = make_contract(env, env.ids['completion'])
    env.current['as'] = 'outsider'
    assert sign_on_file(env, contract_id).status_code == 404
    assert rows(env, ContractSignature) == []
