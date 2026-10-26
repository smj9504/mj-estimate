"""Water mitigation sketch door styles: saved with the overlay, drawn in the PDF."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.domains.water_mitigation.sketch_pdf_service import SketchPdfService
from app.domains.water_mitigation.sketch_schemas import WMOverlayData


def door(**patch):
    return {
        "id": "d1", "preset_id": "door", "shape_type": "rectangle",
        "x": 100, "y": 200, "width": 60, "height": 60, "rotation": 0,
        "fill_color": "transparent", "stroke_color": "#6B3410",
        "stroke_width": 2, "opacity": 0.7, "label": "", **patch,
    }


def render(shape):
    return "".join(SketchPdfService(None)._render_shape_annotation(shape))


def test_overlay_keeps_door_style_and_flip():
    # flip_x used to be dropped on save, so a flipped door came back unflipped
    saved = WMOverlayData(shapes=[door(door_type="pocket", flip_x=True)]).dict()
    shape = saved["shapes"][0]
    assert shape["door_type"] == "pocket"
    assert shape["flip_x"] is True


def test_non_door_shapes_save_without_a_style():
    shape = WMOverlayData(shapes=[door(preset_id="cabinet")]).dict()["shapes"][0]
    assert shape["door_type"] is None
    assert shape["flip_x"] is False


def test_legacy_door_draws_as_swing():
    svg = render(door())
    assert '<polyline points="0.0,60.0 60.0,60.0"' in svg  # leaf along the wall
    assert '<path d="M 0.0 60.0 L 0.0 0.0 A 60.0 60.0 0 0 1 60.0 60.0 Z"' in svg
    assert '<circle cx="0.0" cy="60.0" r="3"' in svg  # hinge on the left


def test_flipped_swing_hinges_on_the_right():
    svg = render(door(flip_x=True))
    assert '<circle cx="60.0" cy="60.0" r="3"' in svg


@pytest.mark.parametrize("door_type, expected", [
    ("double", ['<circle cx="0.0"', '<circle cx="80.0"']),
    ("sliding", ['<rect x="0.0" y="15.0" width="44.0"', '<rect x="36.0" y="3.0" width="44.0"']),
    ("pocket", ['stroke-dasharray="3,2"', '<rect x="40.0" y="9.0" width="8.0"']),
    ("bifold", ['<polyline points="0.0,30.0 20.0,0.0 40.0,30.0"']),
    ("barn", ['stroke-dasharray="4,3"', '<rect x="36.0" y="7.5" width="44.0"']),
])
def test_each_style_draws_its_symbol(door_type, expected):
    svg = render(door(door_type=door_type, width=80, height=30))
    for fragment in expected:
        assert fragment in svg
    assert svg.startswith('<g transform="translate(100.0,200.0)">')
    assert svg.endswith("</g>")


def test_flipped_pocket_parks_on_the_right():
    svg = render(door(door_type="pocket", width=80, height=30, flip_x=True))
    # Hidden panel mirrored into the right half: x = 80 - 8 - 32
    assert '<rect x="40.0" y="9.0" width="32.0" height="12.0" fill="none"' in svg


def test_unknown_style_falls_back_to_swing():
    assert render(door(door_type="garage")) == render(door())
