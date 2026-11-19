"""A bathroom's name: a listed type, or a name typed in.

The bathroom type (designation) is a listed one (master, hall, powder,
three quarter, jack & jill) or a name typed in ("Basement bath"). A listed
type keeps its name ("Master Bathroom") and its label on description lines
("Master"); a typed name shows as typed everywhere: the job's bathrooms, the
PDF, the estimate's notes, the rebuild estimate's room."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: E402,F401
from app.domains.bathroom_estimate.export_service import _bath_desc  # noqa: E402
from app.domains.bathroom_estimate.job_share import bathroom_name, bathroom_type_label  # noqa: E402
from app.domains.bathroom_estimate.models import BathroomEstimate  # noqa: E402
from app.domains.rebuild_estimate.sources import _bathroom, label_of  # noqa: E402


def test_a_listed_type_keeps_its_name_and_label():
    assert bathroom_name("master") == "Master Bathroom"
    assert bathroom_name("powder") == "Powder Room"
    assert bathroom_type_label("three_quarter") == "Three Quarter"
    assert bathroom_name(None) == "Bathroom" and bathroom_type_label(None) == ""


def test_a_typed_name_shows_as_typed():
    assert bathroom_name("Basement bath") == "Basement bath"
    assert bathroom_type_label("Basement bath") == "Basement bath"
    # Spaces tidied, the words left alone (no "2Nd Floor")
    assert bathroom_name("  2nd floor   bath ") == "2nd floor bath"


def test_the_pdf_and_the_rebuild_estimate_show_a_typed_name():
    assert _bath_desc({"designation": "Basement bath", "bath_function": "full"}) == "Basement bath - Full"
    assert _bath_desc({"designation": "master", "bath_function": "half"}) == "Master - Half"
    est = BathroomEstimate(designation="Basement bath", floor_sf=40, length_ft=8, width_ft=5, height_ft=8)
    assert label_of("bathroom", est) == "Bathroom estimate - Basement bath"
    assert _bathroom(est)["rooms"][0]["name"] == "Basement bath"
    # No type: the plain label and room name, as before
    plain = BathroomEstimate(floor_sf=40)
    assert label_of("bathroom", plain) == "Bathroom estimate"
    assert _bathroom(plain)["rooms"][0]["name"] == "Bathroom"
