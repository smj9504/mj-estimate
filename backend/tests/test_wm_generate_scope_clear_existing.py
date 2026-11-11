"""Generate scope from sketch: clear_existing wipes every location, the default only sketch ones."""
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from app.domains.water_mitigation.scope_repository import ScopeRepository
from app.domains.water_mitigation.sketch_schemas import GenerateScopeRequest
from app.domains.water_mitigation.sketch_service import SketchService
from app.main import app as _app  # noqa: F401 - registers every model the mappers refer to


def floor():
    return SimpleNamespace(
        floor_label="1st Floor", floor_order=1,
        overlay_data={"demolition_zones": []}, demolition_zones=[],
        equipment_placements=[], containment_zones=[], floor_protections=[],
        content_protections=[], content_manipulations=[],
    )


def generate(monkeypatch, sketches, **request):
    sketch_loc = SimpleNamespace(name="1st Floor", description="Auto-generated from sketch: 1st Floor")
    manual_loc = SimpleNamespace(name="Kitchen", description="Added by hand")
    blank_loc = SimpleNamespace(name="Basement", description=None)
    deleted = []
    monkeypatch.setattr(
        ScopeRepository, "get_locations_by_job",
        lambda self, job_id, include_items=True: [sketch_loc, manual_loc, blank_loc],
    )
    monkeypatch.setattr(ScopeRepository, "delete_location", lambda self, loc: deleted.append(loc.name) or True)
    db = MagicMock()
    db.execute.return_value.all.return_value = []
    service = SketchService(db)
    service.repository = MagicMock()
    service.repository.get_floor_sketches_by_job.return_value = sketches
    response = service.generate_scope_from_sketch(uuid4(), GenerateScopeRequest(**request))
    return deleted, response


def test_clear_existing_deletes_every_location_first(monkeypatch):
    deleted, response = generate(monkeypatch, [floor()], clear_existing=True)
    assert deleted == ["1st Floor", "Kitchen", "Basement"]
    assert response.success
    assert response.locations_created == 1
    assert "Deleted 3 existing location(s) first." in response.message


def test_default_keeps_locations_added_by_hand(monkeypatch):
    deleted, response = generate(monkeypatch, [floor()])
    assert deleted == ["1st Floor"]
    assert "Replaced 1 previously generated location(s)." in response.message


def test_nothing_deleted_when_the_job_has_no_sketch(monkeypatch):
    deleted, response = generate(monkeypatch, [], clear_existing=True)
    assert deleted == []
    assert not response.success
