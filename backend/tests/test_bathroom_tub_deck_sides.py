"""A drop-in tub's deck side by side: a lip at the front, wide ledges at the
ends. The sketch sends its deck SF (the platform less the tub) and each side's
width; the deck line names them."""

from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: E402,F401
from app.domains.bathroom_estimate import calculator  # noqa: E402
from app.domains.bathroom_estimate.calculator import calculate_estimate  # noqa: E402
from app.domains.bathroom_estimate.models import BathroomEstimate  # noqa: E402

ZIP = "20850"


@pytest.fixture(autouse=True)
def no_material_tax(monkeypatch):
    monkeypatch.setattr(calculator, "get_material_tax_loading", lambda *a, **k: 0)


def test_a_drop_in_tubs_deck_side_by_side_is_named_in_its_line():
    est = BathroomEstimate(
        property_address="12 Elm St", state="MD", zip_code=ZIP, length_ft=10, width_ft=8,
        floor_sf=80, wall_sf=288, height_ft=8, replace_tub=True,
        bathtub_spec={"type": "drop_in", "deck_tile": True, "deck_tile_sf": 21.5, "deck_tile_sides": 4,
                      "deck_width_in": 24, "deck_side_widths_in": {"back": 12, "front": 4, "left": 24, "right": 24},
                      "deck_tub_in": [60, 32]},
    )
    deck = next(li for li in calculate_estimate(est)["line_items"] if li["description"].startswith("Bathtub deck tile"))
    assert deck["quantity"] == 21.5
    assert deck["description"] == "Bathtub deck tile (4 sides)"
    assert 'Deck top surface — back 12", front 4", left 24", right 24" round a 60" × 32" tub' in deck["notes"]
