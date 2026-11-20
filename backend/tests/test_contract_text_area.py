"""Contract field mapping: a text field can be a text area (2026-11-20). It is
typed in on several lines, and the PDF prints it from the top of its box with
the line breaks kept; a plain text field prints as before."""

from io import BytesIO
from pathlib import Path
import sys

import fitz
from reportlab.pdfgen import canvas

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.domains.contract.onsite_signing import build_questions  # noqa: E402
from app.domains.contract.schemas import FieldMappingItem, SignerEditableField  # noqa: E402
from app.domains.contract.service import _draw_text_wrapped, wrap_text_area  # noqa: E402

FONT = 'Helvetica'


def _render(value, multiline, box=(100, 500, 300, 120), font_size=12):
    """One field drawn on a page; returns the page's words as
    (x0, y0, x1, y1, word, block, line, n) in PDF top-down coordinates"""
    fx, fy, fw, fh = box
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=(612, 792))
    _draw_text_wrapped(c, value, fx, fy, fw, fh, font_size, multiline=multiline)
    c.save()
    doc = fitz.open(stream=buffer.getvalue(), filetype='pdf')
    return doc[0].get_text('words'), doc[0].get_text('text')


def _lines(words):
    """The words grouped by their line on the page, top to bottom"""
    rows = {}
    for x0, y0, x1, y1, word, *_ in words:
        rows.setdefault(round(y0), []).append((x0, word))
    return [' '.join(w for _, w in sorted(row)) for _, row in sorted(rows.items())]


def test_line_breaks_are_kept_and_blank_lines_too():
    assert wrap_text_area('First line\nSecond line', FONT, 12, 300) == ['First line', 'Second line']
    assert wrap_text_area('One\n\nThree', FONT, 12, 300) == ['One', '', 'Three']
    assert wrap_text_area('Windows\r\nbreaks', FONT, 12, 300) == ['Windows', 'breaks']


def test_long_lines_wrap_and_a_long_word_is_cut():
    lines = wrap_text_area('word ' * 30, FONT, 12, 100)
    assert len(lines) > 3
    from reportlab.pdfbase.pdfmetrics import stringWidth
    assert all(stringWidth(line, FONT, 12) <= 100 for line in lines)
    cut = wrap_text_area('x' * 80, FONT, 12, 60)
    assert ''.join(cut) == 'x' * 80
    assert all(stringWidth(piece, FONT, 12) <= 60 for piece in cut)


def test_text_area_prints_each_line_from_the_top():
    words, _ = _render('Remove wet drywall\nRun 3 dehumidifiers\n\nMonitor daily', multiline=True)
    assert _lines(words) == ['Remove wet drywall', 'Run 3 dehumidifiers', 'Monitor daily']
    # From the top of the box (its top edge is at 792 - (500 + 120) = 172):
    # the first line ends within its first line height and padding
    first_bottom = min(w[3] for w in words)
    assert 172 < first_bottom < 172 + 20
    # The blank line keeps its space
    ys = sorted({round(w[1]) for w in words})
    assert ys[2] - ys[1] > 1.8 * (ys[1] - ys[0])


def test_plain_text_field_keeps_one_line_as_before():
    words, _ = _render('Remove wet drywall\nRun 3 dehumidifiers', multiline=False)
    assert _lines(words) == ['Remove wet drywall Run 3 dehumidifiers']


def test_text_area_shrinks_only_when_it_has_to():
    ten = '\n'.join(f'Line {i}' for i in range(1, 11))
    words, _ = _render(ten, multiline=True, box=(100, 500, 300, 80))
    assert _lines(words)[0] == 'Line 1'
    assert _lines(words)[-1] == 'Line 10'  # all ten fit after shrinking
    assert max(round(w[3] - w[1], 1) for w in words) < 12
    few, _ = _render('A\nB', multiline=True, box=(100, 500, 300, 80))
    assert max(round(w[3] - w[1], 1) for w in few) >= 12


def test_text_area_never_prints_below_its_box():
    # Twenty lines can't fit 80pt even at 6pt: the last ones are left off
    many = '\n'.join(f'Line {i}' for i in range(1, 21))
    words, _ = _render(many, multiline=True, box=(100, 500, 300, 80))
    lines = _lines(words)
    assert lines[0] == 'Line 1' and 'Line 20' not in lines
    box_bottom = 792 - 500
    assert max(w[3] for w in words) <= box_bottom + 2


def test_saved_mapping_keeps_the_flag():
    item = FieldMappingItem(id='f1', pageIndex=0, x=0.1, y=0.1, width=0.4, height=0.1,
                            fieldKey='custom.field_1', label='Scope notes', multiline=True)
    assert item.dict()['multiline'] is True
    plain = FieldMappingItem(id='f2', pageIndex=0, x=0.1, y=0.1, width=0.4, height=0.03,
                             fieldKey='custom.field_2', label='Code')
    assert plain.dict()['multiline'] is None
    assert SignerEditableField(id='f1', fieldKey='custom.field_1', label='Notes', pageIndex=0,
                               x=0, y=0, width=0.4, height=0.1, multiline=True).multiline is True


def test_onsite_asks_a_text_area_on_several_lines():
    mappings = [
        {'fieldKey': 'custom.field_1', 'label': 'Scope notes', 'multiline': True},
        {'fieldKey': 'custom.field_2', 'label': 'Job code'},
        # The same fact in a plain box first, then a text area: asked on several lines
        {'fieldKey': 'custom.field_3', 'label': 'Remarks'},
        {'fieldKey': 'custom.field_3', 'label': 'Remarks', 'multiline': True},
        # A text area flag on a phone field changes nothing
        {'fieldKey': 'client.phone', 'label': 'Phone', 'multiline': True},
    ]
    kinds = {q['key']: q['kind'] for q in build_questions(mappings, {})}
    assert kinds['custom.field_1'] == 'textarea'
    assert kinds['custom.field_2'] == 'text'
    assert kinds['custom.field_3'] == 'textarea'
    assert kinds['client.phone'] == 'phone'
