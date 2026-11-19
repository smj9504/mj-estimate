"""Several bathrooms on one job share its whole-job costs.

Each bathroom is its own estimate. The job's bathrooms are those on the
same claim (or, with no claim, at the same address for the same company)
that have been priced. The first one made carries the dumpster, sized for
every bathroom's debris, the permit, the trip and the lead RRP setup; the
others leave them off and name the estimate that has them. Pricing or
deleting one brings the others' job lines in step, never their other
lines. On a throwaway SQLite database."""

from datetime import datetime, timedelta
from pathlib import Path
import sys

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: E402,F401
from app.core.database_factory import SQLAlchemySession  # noqa: E402
from app.domains.bathroom_estimate import calculator  # noqa: E402
from app.domains.bathroom_estimate.calculator import calculate_estimate  # noqa: E402
from app.domains.bathroom_estimate.job_share import JobShare  # noqa: E402
from app.domains.bathroom_estimate.models import (  # noqa: E402
    BathroomEstimate,
    BathroomEstimateHistory,
    BathroomEstimateLineItem,
)
from app.domains.bathroom_estimate.pricing import DEMO_RATES, HIDDEN_COSTS  # noqa: E402
from app.domains.bathroom_estimate.schemas import BathroomEstimateCreate  # noqa: E402
from app.domains.bathroom_estimate.service import BathroomEstimateService  # noqa: E402
from app.domains.client.models import Claim, Client  # noqa: E402
from app.domains.unit_prices.models import PriceBook, UnitPriceOverride  # noqa: E402


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


@pytest.fixture(autouse=True)
def no_material_tax(monkeypatch):
    monkeypatch.setattr(calculator, "get_material_tax_loading", lambda *a, **k: 0)


@pytest.fixture
def session(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'bath.db'}")
    for model in (PriceBook, UnitPriceOverride, Client, Claim, BathroomEstimate,
                  BathroomEstimateLineItem, BathroomEstimateHistory):
        model.__table__.create(engine)
    s = SQLAlchemySession(sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)())
    yield s
    s.close()


@pytest.fixture
def service(session):
    return BathroomEstimateService(session)


# A full gut of a tub, vanity and toilet: 3.5 CY of debris
GUT = dict(replace_tub=True, replace_vanity=True, replace_toilet=True,
           bathtub_spec={"type": "alcove", "material": "acrylic"})


_made = []


def bathroom(service, designation, address="12 Elm St", **fields):
    created = service.create_estimate(BathroomEstimateCreate(
        property_address=address, city="Rockville", state="MD", zip_code="20850",
        designation=designation, bath_function="full", length_ft=8, width_ft=5, height_ft=8,
        **{**GUT, **fields},
    ))
    # Made a minute apart (SQLite keeps whole seconds)
    _made.append(created["id"])
    est = service.estimate_repo.find_by_id_with_relations(created["id"])
    est.created_at = datetime(2026, 1, 1) + timedelta(minutes=len(_made))
    service.session.flush()
    return created


def lines(estimate):
    return {li["description"]: li for li in estimate["line_items"]}


def dumpster(estimate):
    found = [li for li in estimate["line_items"] if li["description"].startswith("Dumpster rental")]
    return found[0] if found else None


def elsewhere(estimate):
    found = [li for li in estimate["line_items"] if " - on the " in li["description"]]
    return found[0] if found else None


# ── The calculator, given the job ──

def test_one_bathroom_prices_as_before(service):
    est = service.estimate_repo.find_by_id_with_relations(bathroom(service, "hall")["id"])
    assert calculate_estimate(est, job=None)["line_items"] == calculate_estimate(est)["line_items"]
    assert calculate_estimate(est)["job_inputs"]["debris_cy"] == 3.5


def test_the_carrier_sizes_one_dumpster_for_every_bathroom(service):
    est = service.estimate_repo.find_by_id_with_relations(bathroom(service, "master")["id"])
    job = JobShare(carries=True, carrier_name="Master Bathroom", bathrooms=2,
                   others=[{"name": "Hall Bathroom", "debris_cy": 6.0}])
    items = {li["description"]: li for li in calculate_estimate(est, job=job)["line_items"]}
    line = items["Dumpster rental (15yard, 9.5 CY est.)"]
    assert line["total"] == DEMO_RATES["dumpster_15yard"] + DEMO_RATES["dump_tip_fee"]
    assert "this bathroom 3.5 CY + Hall Bathroom 6.0 CY" in line["notes"]


def test_the_others_name_the_estimate_that_has_the_job_costs(service):
    est = service.estimate_repo.find_by_id_with_relations(bathroom(
        service, "hall", year_built=1960, hidden_costs={"mobilization": True, "permit": True})["id"])
    job = JobShare(carries=False, carrier_name="Master Bathroom", bathrooms=2,
                   others=[{"name": "Master Bathroom", "debris_cy": 3.5}])
    items = calculate_estimate(est, job=job)["line_items"]
    names = [li["description"] for li in items if " - on the " not in li["description"]]
    assert not any(n.startswith(("Dumpster", "Debris disposal", "Mobilization", "Lead paint")) for n in names)
    line = next(li for li in items if " - on the " in li["description"])
    assert line["description"].startswith("Dumpster, lead RRP, mobilization")
    assert line["description"].endswith(" - on the Master Bathroom estimate")
    assert line["total"] == 0


def test_the_carrier_has_what_any_bathroom_needs(service):
    est = service.estimate_repo.find_by_id_with_relations(bathroom(service, "master")["id"])
    job = JobShare(carries=True, carrier_name="Master Bathroom", bathrooms=2,
                   others=[{"name": "Hall Bathroom", "debris_cy": 1.0, "mobilization": True, "lead_rrp": True}])
    items = {li["description"]: li for li in calculate_estimate(est, job=job)["line_items"]}
    assert items["Mobilization / setup"]["unit_price"] == pytest.approx(HIDDEN_COSTS["mobilization"], rel=0.5)
    assert "Whole job (2 bathrooms)" in items["Mobilization / setup"]["notes"]
    assert "Lead paint RRP compliance (pre-1978)" in items


def test_small_jobs_keep_bagging_their_own(service):
    est = service.estimate_repo.find_by_id_with_relations(bathroom(
        service, "powder", replace_tub=False, replace_vanity=False, bathtub_spec=None)["id"])
    job = JobShare(carries=False, carrier_name="Master Bathroom", bathrooms=2,
                   others=[{"name": "Master Bathroom", "debris_cy": 0.5}])
    names = [li["description"] for li in calculate_estimate(est, job=job)["line_items"]]
    assert any(n.startswith("Debris disposal (") for n in names)
    assert not any(" - on the " in n for n in names)


# ── Kept in step on the job ──

def test_pricing_a_second_bathroom_moves_the_job_costs_onto_the_first(service):
    master = bathroom(service, "master")
    hall = bathroom(service, "hall")
    priced = service.calculate(master["id"])
    assert dumpster(priced)["description"] == "Dumpster rental (10yard, 3.5 CY est.)"
    assert priced["job_updated"] == []

    hall_priced = service.calculate(hall["id"])
    assert dumpster(hall_priced) is None
    assert elsewhere(hall_priced)["description"] == "Dumpster - on the Master Bathroom estimate"
    assert hall_priced["job_updated"] == ["Master Bathroom"]

    master_now = service.get_estimate(master["id"])
    assert dumpster(master_now)["description"] == "Dumpster rental (10yard, 7.0 CY est.)"
    assert "Hall Bathroom 3.5 CY" in dumpster(master_now)["notes"]
    assert master_now["total"] == pytest.approx(sum(li["total"] for li in master_now["line_items"]))
    assert any("Job costs moved" in (h.get("change_description") or "") for h in service.get_history(master["id"]))


def test_a_line_edited_by_hand_stays_when_the_job_costs_move(service):
    master = bathroom(service, "master")
    hall = bathroom(service, "hall")
    priced = service.calculate(master["id"])
    first = priced["line_items"][0]
    service.update_line_item(master["id"], first["id"], {"description": "Demo - by hand", "unit_price": 999})

    service.calculate(hall["id"])
    after = lines(service.get_estimate(master["id"]))
    assert after["Demo - by hand"]["unit_price"] == 999
    assert "Dumpster rental (10yard, 7.0 CY est.)" in after


def test_the_first_bathroom_made_carries_once_priced(service):
    master = bathroom(service, "master")
    hall = bathroom(service, "hall")
    # Not priced yet, the master isn't on the job: the hall has its own dumpster
    assert dumpster(service.calculate(hall["id"]))["description"] == "Dumpster rental (10yard, 3.5 CY est.)"

    priced = service.calculate(master["id"])
    assert dumpster(priced)["description"] == "Dumpster rental (10yard, 7.0 CY est.)"
    assert priced["job_updated"] == ["Hall Bathroom"]
    assert elsewhere(service.get_estimate(hall["id"])) is not None


def test_deleting_the_carrier_hands_the_job_costs_on(service):
    master = bathroom(service, "master")
    hall = bathroom(service, "hall")
    service.calculate(master["id"])
    service.calculate(hall["id"])

    service.delete_estimate(master["id"], whole_group=True)
    hall_now = service.get_estimate(hall["id"])
    assert dumpster(hall_now)["description"] == "Dumpster rental (10yard, 3.5 CY est.)"
    assert elsewhere(hall_now) is None


def test_another_address_is_another_job(service):
    master = bathroom(service, "master")
    other = bathroom(service, "hall", address="40 Oak Ave")
    service.calculate(master["id"])
    priced = service.calculate(other["id"])
    assert dumpster(priced)["description"] == "Dumpster rental (10yard, 3.5 CY est.)"
    assert priced["job_updated"] == []


def test_two_bathrooms_of_a_name_are_told_apart(service):
    first = bathroom(service, "hall")
    second = bathroom(service, "hall")
    service.calculate(first["id"])
    priced = service.calculate(second["id"])
    assert elsewhere(priced)["description"] == "Dumpster - on the Hall Bathroom estimate"
    assert "Hall Bathroom 2 3.5 CY" in dumpster(service.get_estimate(first["id"]))["notes"]


def test_a_bathroom_priced_on_its_own_keeps_its_costs_and_stays_off_the_job(service):
    master = bathroom(service, "master")
    second_try = bathroom(service, "master", hidden_costs={"price_alone": True})
    service.calculate(master["id"])
    priced = service.calculate(second_try["id"])
    assert dumpster(priced)["description"] == "Dumpster rental (10yard, 3.5 CY est.)"
    assert priced["job"] is None and priced["job_updated"] == []
    assert dumpster(service.get_estimate(master["id"]))["description"] == "Dumpster rental (10yard, 3.5 CY est.)"


def test_the_page_is_told_the_jobs_bathrooms(service):
    master = bathroom(service, "master")
    hall = bathroom(service, "hall")
    service.calculate(master["id"])
    assert service.get_estimate(master["id"])["job"] is None
    assert service.calculate(hall["id"])["job"] == {
        "bathrooms": ["Master Bathroom", "Hall Bathroom"], "this": "Hall Bathroom",
        "carrier": "Master Bathroom", "carries": False,
    }
    assert service.get_estimate(master["id"])["job"]["carries"] is True


# ── Switching between the job's bathrooms, adding one ──

def test_a_bathroom_added_on_the_job_takes_the_houses_facts(service):
    master = bathroom(service, "master", year_built=1985)
    hall = service.add_bathroom(master["id"], "hall")
    assert hall["group_id"] != master["group_id"]
    assert hall["designation"] == "hall" and hall["kind"] == "restore"
    for field in ("property_address", "city", "state", "zip_code", "year_built"):
        assert hall[field] == master[field]
    # Its scope is its own
    assert not hall["replace_tub"]

    rows = service.get_job_bathrooms(hall["id"])
    assert [(r["name"], r["current"]) for r in rows] == [("Master Bathroom", False), ("Hall Bathroom", True)]
    assert rows[0]["estimate_id"] == master["id"]


def test_a_bathroom_needs_a_claim_or_an_address_to_join(service):
    lone = service.create_estimate(BathroomEstimateCreate(designation="hall"))
    with pytest.raises(ValueError):
        service.add_bathroom(lone["id"], "master")
    assert [r["name"] for r in service.get_job_bathrooms(lone["id"])] == ["Hall Bathroom"]


def test_the_houses_facts_changed_on_one_bathroom_change_on_all(service):
    from app.domains.bathroom_estimate.schemas import BathroomEstimateUpdate
    master = bathroom(service, "master")
    hall = service.add_bathroom(master["id"], "hall")
    service.update_estimate(master["id"], BathroomEstimateUpdate(
        property_address="12 Elm Street", year_built=1960, designation="master", length_ft=9,
    ))
    hall_now = service.get_estimate(hall["id"])
    assert hall_now["property_address"] == "12 Elm Street" and hall_now["year_built"] == 1960
    # One bathroom's own facts stay its own
    assert hall_now["designation"] == "hall" and hall_now["length_ft"] != 9
    assert [r["name"] for r in service.get_job_bathrooms(hall["id"])] == ["Master Bathroom", "Hall Bathroom"]


def test_a_save_that_changes_nothing_of_the_house_leaves_the_others(service):
    from app.domains.bathroom_estimate.schemas import BathroomEstimateUpdate
    master = bathroom(service, "master")
    hall = service.add_bathroom(master["id"], "hall")
    service.update_estimate(hall["id"], BathroomEstimateUpdate(city="Gaithersburg"))
    # The master's form sends its (old) city back with everything else
    service.update_estimate(master["id"], BathroomEstimateUpdate(city="Gaithersburg", length_ft=10))
    assert service.get_estimate(hall["id"])["city"] == "Gaithersburg"
    assert service.get_estimate(master["id"])["city"] == "Gaithersburg"


def test_a_bathroom_priced_on_its_own_keeps_its_own_facts(service):
    from app.domains.bathroom_estimate.schemas import BathroomEstimateUpdate
    master = bathroom(service, "master")
    copy = bathroom(service, "master", hidden_costs={"price_alone": True})
    service.update_estimate(master["id"], BathroomEstimateUpdate(year_built=1950))
    assert service.get_estimate(copy["id"])["year_built"] is None
    assert [r["alone"] for r in service.get_job_bathrooms(master["id"])] == [False, True]
