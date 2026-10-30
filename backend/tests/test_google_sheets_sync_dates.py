"""Water mitigation dates coming off the Google Sheet and how the API hands them
to the browser. Runs on plain values, so nothing reaches the sheet or a database."""

from datetime import datetime, timezone
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.domains.integrations.google_sheets.client import VANESSA_HEADER_MAPPING, GoogleSheetsClient  # noqa: E402
from app.domains.integrations.google_sheets.sync_service import GoogleSheetsSyncService  # noqa: E402
from app.domains.integrations.google_sheets.utils import (  # noqa: E402
    parse_mitigation_period,
    parse_month_day_value,
)
from app.domains.water_mitigation.schemas import JobResponse  # noqa: E402

# Laid out and typed the way the Vanessa tab is, with the people made up
SHEET_ROW = [
    '100 Example Ct, Springfield VA 22152', 'Test Homeowner', 'inspection',
    '555-010-0100', 'homeowner@example.com ', 'Test Insurance',
    '00-000000-00 ', '202600000000', '10/02', '10/2-10/4', 'Test Adjuster',
    '555-010-0101 Ext 2450', 'adjuster@example.com', '11/2/2026', '12:00 PM',
]
ANCHOR = datetime(2026, 10, 14, 6, 0, tzinfo=timezone.utc)


def prepare(row, anchor=ANCHOR):
    service = GoogleSheetsSyncService(None, 'test-sheet')
    return service._prepare_job_data(
        GoogleSheetsClient('test-sheet').parse_row_to_dict(row, VANESSA_HEADER_MAPPING),
        anchor,
    )


def with_cells(dol, wm):
    row = list(SHEET_ROW)
    row[8], row[9] = dol, wm
    return row


def test_a_row_without_a_year_still_gets_its_date_of_loss_and_period():
    data = prepare(SHEET_ROW)
    assert data['date_of_loss'] == datetime(2026, 10, 2)
    assert data['mitigation_period'] == '10/2-10/4'
    assert data['mitigation_start_date'] == datetime(2026, 10, 2)
    assert data['mitigation_end_date'] == datetime(2026, 10, 4)
    assert data['inspection_date'] == datetime(2026, 11, 2)


def test_a_full_date_is_read_as_before():
    data = prepare(with_cells('10/2/25', '10/3-10/5 (3)'))
    assert data['date_of_loss'] == datetime(2025, 10, 2)
    assert data['mitigation_start_date'] == datetime(2025, 10, 3)
    assert data['mitigation_end_date'] == datetime(2025, 10, 5)


@pytest.mark.parametrize('value, anchor, expected', [
    ('10/02', datetime(2026, 10, 14), datetime(2026, 10, 2)),
    ('8/27', datetime(2026, 8, 24), datetime(2026, 8, 27)),     # typed just after the row appeared
    ('12/28', datetime(2027, 1, 5), datetime(2026, 12, 28)),    # the job appeared after New Year
    ('1/2', datetime(2026, 12, 30), datetime(2027, 1, 2)),
    ('3/1', datetime(2026, 10, 14), datetime(2026, 3, 1)),      # never lands far in the future
    ('2/29', datetime(2026, 3, 10), datetime(2024, 2, 29)),
])
def test_year_for_a_month_and_day(value, anchor, expected):
    assert parse_month_day_value(value, anchor) == expected


@pytest.mark.parametrize('value', ['13/40', 'TBD', '10/02/26', None, 45000])
def test_only_month_and_day_text_is_taken(value):
    assert parse_month_day_value(value, datetime(2026, 10, 14)) is None


def process_row(existing_job):
    """Run a sheet row through matching and return the data it would save."""
    service = GoogleSheetsSyncService(None, 'test-sheet')
    saved = {}
    service._find_job_by_row_number = lambda row, sheet: existing_job
    service._find_unlinked_job_by_address = lambda address: None
    service._update_job = lambda job, data, row, sheet: saved.update(data)
    service._create_job = lambda data, row, sheet: saved.update(data)
    service._process_row(SHEET_ROW, 21, 'Vanessa')
    return saved


def test_a_later_sync_keeps_the_year_the_job_started_with():
    # A job from 2024 is still in 2024 however many syncs later: the year comes
    # from its created_at, not from the day the sync happens to run
    job = SimpleNamespace(created_at=datetime(2024, 10, 14, tzinfo=timezone.utc), active=True)
    saved = process_row(job)
    assert saved['date_of_loss'] == datetime(2024, 10, 2)
    assert saved['mitigation_start_date'] == datetime(2024, 10, 2)
    assert saved['mitigation_end_date'] == datetime(2024, 10, 4)


def test_a_new_row_is_placed_relative_to_now():
    assert process_row(None)['date_of_loss'].year in (
        datetime.utcnow().year, datetime.utcnow().year - 1,
    )


def test_a_period_running_over_new_year():
    start, end = parse_mitigation_period('12/29-1/2', 2026)
    assert (start, end) == (datetime(2026, 12, 29), datetime(2027, 1, 2))


def test_a_december_loss_mitigated_in_january():
    data = prepare(with_cells('12/30/26', '1/2-1/4'))
    assert data['mitigation_start_date'] == datetime(2027, 1, 2)
    assert data['mitigation_end_date'] == datetime(2027, 1, 4)


def test_december_work_without_a_loss_date_on_a_january_job():
    data = prepare(with_cells('', '12/29-12/31'), datetime(2027, 1, 5))
    assert data['mitigation_start_date'] == datetime(2026, 12, 29)
    assert data['mitigation_end_date'] == datetime(2026, 12, 31)


def test_a_backwards_period_stays_as_typed():
    start, end = parse_mitigation_period('10/4-10/2', 2026)
    assert (start, end) == (datetime(2026, 10, 4), datetime(2026, 10, 2))


def test_an_emptied_cell_clears_the_date_but_unreadable_text_leaves_it():
    assert prepare(with_cells('', '10/2-10/4'))['date_of_loss'] is None
    assert 'date_of_loss' not in prepare(with_cells('TBD', '10/2-10/4'))


def job_response(**fields):
    return JobResponse(
        id='00000000-0000-0000-0000-000000000001', active=True, status='Lead',
        property_address=SHEET_ROW[0],
        created_at=datetime(2026, 10, 14, tzinfo=timezone.utc), **fields,
    )


def test_the_api_sends_calendar_days_without_a_time():
    midnight_utc = datetime(2026, 10, 2, tzinfo=timezone.utc)
    job = job_response(
        date_of_loss=midnight_utc, mitigation_start_date=midnight_utc,
        mitigation_end_date=datetime(2026, 10, 4, tzinfo=timezone.utc),
        inspection_date=datetime(2026, 11, 2, tzinfo=timezone.utc),
    )
    body = job.model_dump(mode='json')
    assert body['date_of_loss'] == '2026-10-02'
    assert body['mitigation_start_date'] == '2026-10-02'
    assert body['mitigation_end_date'] == '2026-10-04'
    assert body['inspection_date'] == '2026-11-02'
    assert body['check_date'] is None
    # Real moments keep their time, and python code still gets datetimes
    assert body['created_at'].startswith('2026-10-14T00:00:00')
    assert job.model_dump()['date_of_loss'] == midnight_utc
