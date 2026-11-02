"""
Validators are built on first use to keep the app inside Render's 512MB, so a schema
that can't be built no longer fails at startup. These build all of them instead.
"""

import asyncio
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi._compat import ModelField
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import BaseModel
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.cache import InMemoryCache  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.domains.product_library import extract  # noqa: E402
from app.domains.water_mitigation.ai_classification_service import ai_classification_service  # noqa: E402
from app.main import app  # noqa: E402


def _deep(calls, build):
    """Pydantic looks a few frames up when it builds a deferred model, and a request is always this far down"""
    return build() if calls == 0 else _deep(calls - 1, build)


def _fields(dependant, seen):
    found = (
        dependant.path_params + dependant.query_params + dependant.header_params
        + dependant.cookie_params + dependant.body_params
    )
    for sub in dependant.dependencies:
        if id(sub) not in seen:
            seen.add(id(sub))
            found = found + _fields(sub, seen)
    return found


def _subclasses(cls):
    seen, stack = set(), [cls]
    while stack:
        for sub in stack.pop().__subclasses__():
            if sub not in seen:
                seen.add(sub)
                stack.append(sub)
    return seen


def test_a_field_waits_for_first_use():
    route = next(r for r in app.routes if isinstance(r, APIRoute) and r.response_field is not None)
    field = ModelField(field_info=route.response_field.field_info, name='fresh', mode='serialization')
    assert '_built_type_adapter' not in field.__dict__

    adapter = field._type_adapter

    assert field.__dict__['_built_type_adapter'] is adapter
    assert field._type_adapter is adapter


def test_models_wait_for_first_use():
    assert BaseModel.model_config.get('defer_build') is True

    class Deferred(BaseModel):
        name: str

    assert Deferred.__pydantic_complete__ is False
    assert _deep(12, lambda: Deferred(name='a')).name == 'a'
    assert Deferred.__pydantic_complete__ is True


def test_every_route_field_builds():
    failures = []
    routes = [route for route in app.routes if isinstance(route, APIRoute)]
    assert len(routes) > 1000
    for route in routes:
        fields = _fields(route.dependant, set())
        fields += [f for f in (route.response_field, route.secure_cloned_response_field, route.body_field) if f]
        for field in fields:
            try:
                _deep(12, lambda: field._type_adapter)
            except Exception as e:
                failures.append(f'{route.path} {field.name}: {e}')
    assert not failures, '\n'.join(failures)


def test_every_model_of_ours_builds():
    failures = []
    models = [model for model in _subclasses(BaseModel) if model.__module__.startswith('app.')]
    assert len(models) > 1000
    for model in models:
        try:
            _deep(12, lambda: model.__pydantic_validator__.validate_python)
            _deep(12, lambda: model.__pydantic_serializer__.to_python)
        except Exception as e:
            failures.append(f'{model.__module__}.{model.__qualname__}: {e}')
            continue
        if not model.__pydantic_complete__:
            failures.append(f'{model.__module__}.{model.__qualname__}: incomplete')
    assert not failures, '\n'.join(failures)


def test_requests_are_validated_and_responses_filtered_as_ever():
    class Inner(BaseModel):
        size: int

    class Reply(BaseModel):
        name: str
        inner: Inner

    class Body(BaseModel):
        name: str
        inner: Inner

    small = FastAPI()

    @small.post('/things/{thing_id}', response_model=Reply)
    def make_thing(thing_id: int, body: Body, limit: int = 10):
        return {'name': f'{body.name}-{thing_id}-{limit}', 'inner': body.inner, 'secret': 'not for the reply'}

    client = TestClient(small)

    ok = client.post('/things/7?limit=3', json={'name': 'a', 'inner': {'size': '5'}})
    assert ok.status_code == 200
    assert ok.json() == {'name': 'a-7-3', 'inner': {'size': 5}}

    assert client.post('/things/x', json={'name': 'a', 'inner': {'size': 5}}).status_code == 422
    assert client.post('/things/7?limit=x', json={'name': 'a', 'inner': {'size': 5}}).status_code == 422
    bad_body = client.post('/things/7', json={'name': 'a', 'inner': {'size': 'big'}})
    assert bad_body.status_code == 422
    assert bad_body.json()['detail'][0]['loc'] == ['body', 'inner', 'size']


def test_the_app_loads_without_the_claude_and_google_clients(tmp_path):
    """A line at the top of any module would bring their memory back for good, on every start"""
    code = "import sys, app.main; print([m for m in ('anthropic', 'googleapiclient') if m in sys.modules])"
    # Away from backend/, where config would pick up .env.development and its real database
    result = subprocess.run(
        [sys.executable, '-c', code],
        cwd=tmp_path,
        env={**os.environ, 'PYTHONPATH': str(Path(__file__).resolve().parents[1])},
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr[-2000:]
    assert result.stdout.strip().splitlines()[-1] == '[]'


def _claude_reply(text):
    return SimpleNamespace(
        model='a-model',
        usage=SimpleNamespace(
            input_tokens=1, output_tokens=1, cache_read_input_tokens=0, cache_creation_input_tokens=0,
        ),
        stop_reason='end_turn',
        stop_details=None,
        content=[SimpleNamespace(type='text', text=text)],
    )


def test_a_photo_classification_loads_claude_when_it_calls(monkeypatch):
    class Client:
        def __init__(self, **kwargs):
            async def create(**kwargs):
                return _claude_reply(' {"room": "kitchen"} ')
            self.beta = SimpleNamespace(messages=SimpleNamespace(create=create))

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

    monkeypatch.setitem(sys.modules, 'anthropic', SimpleNamespace(AsyncAnthropic=Client))

    text = asyncio.run(ai_classification_service._call_anthropic('prompt', {'type': 'object'}, b'image'))

    assert text == '{"room": "kitchen"}'


def test_reading_a_listing_loads_claude_when_it_calls(monkeypatch):
    class Client:
        def __init__(self, **kwargs):
            self.messages = SimpleNamespace(create=lambda **kwargs: _claude_reply('{"name": "Faucet"}'))

    monkeypatch.setitem(sys.modules, 'anthropic', SimpleNamespace(Anthropic=Client))
    monkeypatch.setattr(settings, 'ANTHROPIC_API_KEY', 'a-key')

    assert extract._call([{'type': 'text', 'text': 'a listing'}]) == {'name': 'Faucet'}


@pytest.fixture
def cache(monkeypatch):
    monkeypatch.setattr(InMemoryCache, '_shared_cache', {})
    monkeypatch.setattr(InMemoryCache, '_shared_ttls', {})
    return InMemoryCache()


def test_memory_cache_refuses_what_could_only_be_a_photo(cache):
    photo = 'x' * (InMemoryCache.MAX_VALUE_SIZE + 1)

    assert cache.setex('photo', 60, photo) is False

    assert cache.get('photo') is None


def test_memory_cache_doesnt_keep_the_old_value_of_one_it_refuses(cache):
    assert cache.setex('key', 60, 'old') is True

    cache.setex('key', 60, 'x' * (InMemoryCache.MAX_VALUE_SIZE + 1))

    assert cache.get('key') is None


def test_memory_cache_drops_the_oldest_past_its_limit(cache, monkeypatch):
    monkeypatch.setattr(InMemoryCache, 'MAX_TOTAL_SIZE', 25)

    cache.setex('first', 60, 'x' * 10)
    cache.setex('second', 60, 'x' * 10)
    cache.setex('third', 60, 'x' * 10)

    assert cache.get('first') is None
    assert cache.get('second') == 'x' * 10
    assert cache.get('third') == 'x' * 10


def test_memory_cache_counts_a_rewrite_as_new(cache, monkeypatch):
    monkeypatch.setattr(InMemoryCache, 'MAX_TOTAL_SIZE', 25)

    cache.setex('running status', 60, 'x' * 10)
    cache.setex('other', 60, 'x' * 10)
    cache.setex('running status', 60, 'y' * 10)
    cache.setex('newest', 60, 'x' * 10)

    assert cache.get('other') is None
    assert cache.get('running status') == 'y' * 10
