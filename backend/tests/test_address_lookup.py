"""Address boxes: Google's answers become the street, city, state and zip our
forms store, and a Google failure is a 502 the browser falls back from."""

from pathlib import Path
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient
import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.config import settings
from app.domains.address import google_places
from app.domains.address.api import router
from app.domains.auth.dependencies import get_current_staff


def component(kind, long_text, short_text=None):
    return {'types': [kind], 'longText': long_text, 'shortText': short_text or long_text}


def place(*components):
    return {'addressComponents': list(components)}


MUSKET_BALL = [
    component('street_number', '6305'),
    component('route', 'Musket Ball Drive', 'Musket Ball Dr'),
    component('locality', 'Centreville'),
    component('administrative_area_level_2', 'Fairfax County'),
    component('administrative_area_level_1', 'Virginia', 'VA'),
    component('country', 'United States', 'US'),
    component('postal_code', '20121'),
    component('postal_code_suffix', '2382'),
]


def test_details_split_into_the_fields_forms_store():
    parsed = google_places.parse_details(place(*MUSKET_BALL))

    assert parsed.street_address == '6305 Musket Ball Dr'
    assert parsed.city == 'Centreville'
    assert parsed.state == 'VA'
    assert parsed.zip == '20121'
    assert parsed.county == 'Fairfax County'


@pytest.mark.parametrize('unit, expected', [
    ('5', '4000 Massachusetts Ave NW #5'),
    ('apt 5', '4000 Massachusetts Ave NW apt 5'),
])
def test_unit_stays_on_the_street_line(unit, expected):
    parsed = google_places.parse_details(place(
        component('street_number', '4000'),
        component('route', 'Massachusetts Avenue Northwest', 'Massachusetts Ave NW'),
        component('subpremise', unit),
        component('locality', 'Washington'),
        component('administrative_area_level_1', 'District of Columbia', 'DC'),
    ))

    assert parsed.street_address == expected


def test_city_falls_back_when_the_place_has_no_locality():
    parsed = google_places.parse_details(place(
        component('street_number', '1'),
        component('route', 'Main Street', 'Main St'),
        component('neighborhood', 'Bailey Crossroads'),
        component('administrative_area_level_1', 'Virginia', 'VA'),
    ))

    assert parsed.city == 'Bailey Crossroads'


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(settings, 'GOOGLE_ADDRESS_AUTOCOMPLETE_API_KEY', 'test-key')
    app = FastAPI()
    app.include_router(router, prefix='/api/address')
    app.dependency_overrides[get_current_staff] = lambda: object()
    return TestClient(app)


def answer_with(monkeypatch, handler):
    """Every Google call goes to handler; the rest of httpx stays real."""
    monkeypatch.setattr(google_places, '_client', httpx.AsyncClient(transport=httpx.MockTransport(handler)))


def test_autocomplete_returns_suggestions(client, monkeypatch):
    sent = {}

    def handler(request):
        sent['key'] = request.headers['X-Goog-Api-Key']
        sent['body'] = request.read().decode()
        return httpx.Response(200, json={'suggestions': [{'placePrediction': {
            'placeId': 'abc',
            'text': {'text': '6305 Musket Ball Dr, Centreville, VA, USA'},
            'structuredFormat': {
                'mainText': {'text': '6305 Musket Ball Dr'},
                'secondaryText': {'text': 'Centreville, VA, USA'},
            },
        }}]})

    answer_with(monkeypatch, handler)
    response = client.get('/api/address/autocomplete', params={'q': '6305 Musket', 'session_token': 'tok'})

    assert response.status_code == 200
    assert response.json()['suggestions'] == [{
        'place_id': 'abc',
        'full_text': '6305 Musket Ball Dr, Centreville, VA, USA',
        'main_text': '6305 Musket Ball Dr',
        'secondary_text': 'Centreville, VA, USA',
    }]
    assert sent['key'] == 'test-key'
    assert '"sessionToken":"tok"' in sent['body'].replace(' ', '')


def test_details_returns_the_parts(client, monkeypatch):
    answer_with(monkeypatch, lambda request: httpx.Response(200, json=place(*MUSKET_BALL)))

    response = client.get('/api/address/details', params={'place_id': 'abc'})

    assert response.status_code == 200
    assert response.json()['street_address'] == '6305 Musket Ball Dr'


def test_google_refusing_is_a_502(client, monkeypatch):
    answer_with(monkeypatch, lambda request: httpx.Response(403, json={'error': {'status': 'PERMISSION_DENIED'}}))

    response = client.get('/api/address/autocomplete', params={'q': '6305 Musket'})

    assert response.status_code == 502


def test_the_client_is_kept_between_calls(monkeypatch):
    monkeypatch.setattr(google_places, '_client', None)

    assert google_places._get_client() is google_places._get_client()


def test_google_answering_nonsense_is_a_502(client, monkeypatch):
    answer_with(monkeypatch, lambda request: httpx.Response(200, text='<html>not json</html>'))

    response = client.get('/api/address/details', params={'place_id': 'abc'})

    assert response.status_code == 502


def test_google_unreachable_is_a_502(client, monkeypatch):
    def handler(request):
        raise httpx.ConnectTimeout('timed out')

    answer_with(monkeypatch, handler)

    response = client.get('/api/address/autocomplete', params={'q': '6305 Musket'})

    assert response.status_code == 502


def test_no_key_is_a_502_without_calling_google(client, monkeypatch):
    monkeypatch.setattr(settings, 'GOOGLE_ADDRESS_AUTOCOMPLETE_API_KEY', '')

    def handler(request):
        raise AssertionError('Google should not be called')

    answer_with(monkeypatch, handler)

    response = client.get('/api/address/autocomplete', params={'q': '6305 Musket'})

    assert response.status_code == 502


def test_a_place_id_cannot_reach_another_google_path(client):
    response = client.get('/api/address/details', params={'place_id': '../secret'})

    assert response.status_code == 422


def test_needs_a_login(monkeypatch):
    app = FastAPI()
    app.include_router(router, prefix='/api/address')
    response = TestClient(app).get('/api/address/autocomplete', params={'q': '6305 Musket'})

    assert response.status_code in (401, 403)
