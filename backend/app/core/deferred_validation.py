"""
Builds request and response validators when they're first needed, not at startup.

Render's starter plan kills the container at 512MB, and this app sat at about 500MB
before serving anything, so opening a job's Photos tab was enough to take the server
down. Most of that was Pydantic: FastAPI built validators for every parameter and
response of all 1,067 routes, twice over because include_router declares each route
again, and every model built its own. Most routes are never called in the life of a
process, and leaving these until first use takes about 250MB off the idle footprint.

The first call to a route pays for its own validators, and a schema that can't be
built now fails on that call rather than at startup, so test_deferred_validation
builds all of them.

Call defer_validators() before FastAPI or any model is imported. Nothing depends on
it having run: a model or route behaves the same either way, only built earlier.
"""

from pydantic import BaseModel, TypeAdapter
from typing_extensions import Annotated


def _type_adapter(field) -> TypeAdapter:
    adapter = field.__dict__.get('_built_type_adapter')
    if adapter is None:
        adapter = TypeAdapter(Annotated[field.field_info.annotation, field.field_info])
        field.__dict__['_built_type_adapter'] = adapter
    return adapter


def defer_validators() -> None:
    # Models take it from here by inheritance, as the OpenAI and Anthropic SDKs' already do
    BaseModel.model_config['defer_build'] = True

    # FastAPI has no setting for this one. fastapi is pinned, and the test fails if this stops applying.
    from fastapi._compat import ModelField

    ModelField.__post_init__ = lambda field: None
    ModelField._type_adapter = property(_type_adapter)
