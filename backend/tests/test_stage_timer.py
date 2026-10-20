"""StageTimer reports each stage once, adding up a stage lapped repeatedly."""

from types import SimpleNamespace

from app.common.utils import timing
from app.common.utils.timing import StageTimer


def fake_clock(monkeypatch, *readings):
    clock = iter(readings)
    monkeypatch.setattr(timing, 'time', SimpleNamespace(monotonic=lambda: next(clock)))


def test_laps_measure_since_previous_lap_and_repeats_add_up(monkeypatch):
    fake_clock(monkeypatch, 10.0, 10.5, 12.0, 12.25, 13.0)

    timer = StageTimer()            # 10.0
    timer.lap('connect')            # 10.5
    timer.lap('compress')           # 12.0
    timer.lap('compress')           # 12.25

    assert timer.summary() == '3.00s (connect 0.50s, compress 1.75s)'  # 13.0


def test_summary_without_laps_is_just_the_total(monkeypatch):
    fake_clock(monkeypatch, 5.0, 5.4)

    assert StageTimer().summary() == '0.40s'
