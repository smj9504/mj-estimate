"""Report photos follow their category when it changes; no database required."""
import sys
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.domains.water_mitigation.service import WaterMitigationService, _best_section_index

JOB = uuid4()


def section(title, *photo_ids):
    return {'id': title, 'title': title, 'photos': [{'photo_id': p, 'caption': ''} for p in photo_ids]}


def relocate(sections, changes):
    """changes: [(photo_id, old_category, new_category)]"""
    config = SimpleNamespace(sections=sections)
    service = object.__new__(WaterMitigationService)
    service.report_config_repo = SimpleNamespace(find_by_job_id=lambda job_id: config)
    snapshots = [{'photo_id': p, 'job_id': JOB, 'old_category': old} for p, old, _ in changes]
    moved = service.relocate_report_photos_for_category_change(
        snapshots, {p: new for p, _, new in changes})
    return moved, {s['title']: [p['photo_id'] for p in s['photos']] for s in config.sections}


def test_best_section_matches_auto_assign_rules():
    sections = [section('Property Overview'), section('Day 1 - Drying'), section('Day 2 - Drying')]
    assert _best_section_index(sections, 'day-2') == 2
    assert _best_section_index(sections, 'property-overview') == 0
    assert _best_section_index(sections, 'documentation') is None


def test_auto_placed_photo_moves_to_new_category_section():
    a, b = str(uuid4()), str(uuid4())
    moved, result = relocate(
        [section('Day 1', a, b), section('Day 2'), section('Day 3')],
        [(a, 'day-1', 'day-3')])
    assert moved == 1
    assert result == {'Day 1': [b], 'Day 2': [], 'Day 3': [a]}


def test_manually_placed_photo_stays():
    a = str(uuid4())
    # A day-1 photo the user put in the Day 2 section by hand
    moved, result = relocate([section('Day 1'), section('Day 2', a), section('Day 3')],
                             [(a, 'day-1', 'day-3')])
    assert moved == 0
    assert result['Day 2'] == [a]


def test_photo_leaves_report_when_new_category_has_no_section():
    a, b = str(uuid4()), str(uuid4())
    moved, result = relocate([section('Day 1', a, b), section('Day 2')], [(a, 'day-1', 'documentation')])
    assert moved == 1
    assert result == {'Day 1': [b], 'Day 2': []}


def test_manually_placed_photo_stays_when_new_category_has_no_section():
    a = str(uuid4())
    moved, result = relocate([section('Day 1'), section('Day 2', a)], [(a, 'day-1', 'documentation')])
    assert moved == 0
    assert result['Day 2'] == [a]


def test_photo_not_in_report_is_not_added():
    moved, result = relocate([section('Day 1'), section('Day 2')], [(str(uuid4()), 'day-1', 'day-2')])
    assert moved == 0
    assert result == {'Day 1': [], 'Day 2': []}


def test_caller_id_casing_does_not_matter():
    a = str(uuid4())
    snapshots_id = a
    config = SimpleNamespace(sections=[section('Day 1', a), section('Day 2')])
    service = object.__new__(WaterMitigationService)
    service.report_config_repo = SimpleNamespace(find_by_job_id=lambda job_id: config)
    moved = service.relocate_report_photos_for_category_change(
        [{'photo_id': snapshots_id, 'job_id': JOB, 'old_category': 'day-1'}], {a.upper(): 'day-2'})
    assert moved == 1
    assert config.sections[1]['photos'][0]['photo_id'] == a
