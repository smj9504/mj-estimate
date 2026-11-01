"""
Packing report PDF

What an adjuster asks for besides the estimate: its contents list (each
room's items), its room photos, or both. Room by room, under the same header
as the estimate: the company, whom and which property and claim it is for.
"""

import io
from datetime import datetime
from typing import Any, Dict, List, Optional
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    BaseDocTemplate, CondPageBreak, Frame, HRFlowable, Image, PageTemplate, Paragraph, Spacer, Table,
    TableStyle,
)

INK = colors.Color(0.13, 0.13, 0.13)
GREY = colors.Color(0.42, 0.42, 0.42)
HAIRLINE = colors.Color(0.86, 0.86, 0.86)
HEADER_FILL = colors.Color(0.94, 0.94, 0.94)

PAGE_W, PAGE_H = letter
MARGIN = 0.5 * inch
CONTENT_W = PAGE_W - 2 * MARGIN  # 7.5"

PHOTO_COLS = 2
PHOTO_GAP = 0.15 * inch
PHOTO_MAX_H = 2.7 * inch
PHOTO_ROW_H = PHOTO_MAX_H + 0.35 * inch  # with its caption

# Room needed to start a room on the page: its heading and first rows, or
# its heading and first row of photos, so a heading is never left alone
ROOM_START_LIST = 1.5 * inch
ROOM_START_PHOTOS = 0.6 * inch + PHOTO_ROW_H

_FLOOR_LABEL = {
    "basement": "Basement", "1st": "1st Floor", "2nd": "2nd Floor",
    "3rd": "3rd Floor", "4th+": "4th Floor+",
}

STYLE_NORMAL = ParagraphStyle("PRNormal", fontName="Helvetica", fontSize=9, leading=12, textColor=INK)
STYLE_GREY = ParagraphStyle("PRGrey", parent=STYLE_NORMAL, textColor=GREY)
STYLE_BOLD = ParagraphStyle("PRBold", parent=STYLE_NORMAL, fontName="Helvetica-Bold")
STYLE_RIGHT = ParagraphStyle("PRRight", parent=STYLE_NORMAL, alignment=TA_RIGHT)
STYLE_CELL = ParagraphStyle("PRCell", parent=STYLE_NORMAL, fontSize=8.5, leading=11)
STYLE_CELL_GREY = ParagraphStyle("PRCellGrey", parent=STYLE_CELL, textColor=GREY)
STYLE_CELL_HEAD = ParagraphStyle("PRCellHead", parent=STYLE_CELL, fontName="Helvetica-Bold")
STYLE_CAPTION = ParagraphStyle("PRCaption", parent=STYLE_NORMAL, fontSize=7.5, leading=9, textColor=GREY)
STYLE_ROOM = ParagraphStyle(
    "PRRoom", parent=STYLE_NORMAL, fontName="Helvetica-Bold", fontSize=11.5, leading=15, spaceBefore=14,
)
STYLE_SUBHEAD = ParagraphStyle("PRSubhead", parent=STYLE_BOLD, spaceBefore=8, spaceAfter=4)


def _text(value: Any) -> str:
    """Typed text as a paragraph shows it: & and < print as they are"""
    return escape(" ".join(str(value or "").split()))


def _lines(value: Optional[str]) -> List[str]:
    return [_text(line) for line in (value or "").split("\n") if line.strip()]


def report_title(contents_list: bool, photos: bool) -> str:
    if contents_list and photos:
        return "Contents Report"
    return "Contents List" if contents_list else "Photo Report"


def _plural(n: int, word: str) -> str:
    return f"{n:,} {word}{'' if n == 1 else 's'}"


def _pieces(items: List[Dict]) -> int:
    return sum(int(item.get("quantity") or 1) for item in items)


def _room_count(room: Dict) -> int:
    """A room's items: its items' quantities, or the count a quick estimate kept"""
    items = room.get("items") or []
    return _pieces(items) if items else int(room.get("item_count") or 0)


def _has_contents(room: Dict) -> bool:
    return bool(room.get("items") or room.get("notable_items") or room.get("item_count"))


def _item_notes(item: Dict) -> str:
    flags = []
    if item.get("is_fragile"):
        flags.append("Fragile")
    if item.get("is_high_value"):
        flags.append("High value")
    if item.get("needs_disassembly"):
        flags.append("Disassembly")
    return ", ".join(flags)


def _contents_table(items: List[Dict], first_number: int) -> Table:
    rows = [[
        Paragraph("#", STYLE_CELL_HEAD),
        Paragraph("Item", STYLE_CELL_HEAD),
        Paragraph("Category", STYLE_CELL_HEAD),
        Paragraph("Qty", ParagraphStyle("PRQtyHead", parent=STYLE_CELL_HEAD, alignment=TA_RIGHT)),
        Paragraph("Handling", STYLE_CELL_HEAD),
    ]]
    qty_style = ParagraphStyle("PRQty", parent=STYLE_CELL, alignment=TA_RIGHT)
    for i, item in enumerate(items):
        rows.append([
            Paragraph(str(first_number + i), STYLE_CELL_GREY),
            Paragraph(_text(item.get("name")), STYLE_CELL),
            Paragraph(_text(item.get("category")), STYLE_CELL_GREY),
            Paragraph(f"{int(item.get('quantity') or 1):,}", qty_style),
            Paragraph(_item_notes(item), STYLE_CELL_GREY),
        ])
    table = Table(
        rows,
        colWidths=[0.45 * inch, 3.35 * inch, 1.5 * inch, 0.5 * inch, 1.7 * inch],
        repeatRows=1,
        hAlign="LEFT",
    )
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_FILL),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, HAIRLINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return table


def _photo_grid(photos: List[bytes], first_number: int) -> Table:
    """Photos two to a row, each fit to its cell, numbered across the report"""
    col_w = CONTENT_W / PHOTO_COLS
    photo_w = col_w - PHOTO_GAP / 2
    cells = []
    for i, jpeg in enumerate(photos):
        w, h = ImageReader(io.BytesIO(jpeg)).getSize()
        scale = min(photo_w / w, PHOTO_MAX_H / h)
        cells.append([
            Image(io.BytesIO(jpeg), width=w * scale, height=h * scale, hAlign="LEFT"),
            Spacer(1, 2),
            Paragraph(f"Photo {first_number + i}", STYLE_CAPTION),
        ])
    cells += [""] * (-len(cells) % PHOTO_COLS)
    rows = [cells[i:i + PHOTO_COLS] for i in range(0, len(cells), PHOTO_COLS)]
    table = Table(rows, colWidths=[col_w] * PHOTO_COLS, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        # The gap between the columns, split between their facing sides
        ("LEFTPADDING", (0, 0), (0, -1), 0),
        ("RIGHTPADDING", (0, 0), (0, -1), PHOTO_GAP / 2),
        ("LEFTPADDING", (1, 0), (1, -1), PHOTO_GAP / 2),
        ("RIGHTPADDING", (1, 0), (1, -1), 0),
    ]))
    return table


def generate_report_pdf(
    rooms: List[Dict[str, Any]],
    contents_list: bool = True,
    photos: bool = True,
    company_info: Optional[Dict] = None,
    client_name: Optional[str] = None,
    client_phone: Optional[str] = None,
    property_address: Optional[str] = None,
    claim_number: Optional[str] = None,
    insurance_company: Optional[str] = None,
    estimate_total: Optional[float] = None,
    report_date: Optional[datetime] = None,
) -> bytes:
    """The report of an estimate's rooms, each a dict of room_name, floor,
    items (name, category, quantity and handling flags), or for a quick
    estimate item_count and notable_items, and photos (JPEG bytes).

    contents_list prints each room's items, photos its photos; a room with
    neither to show is left out. estimate_total, when given, goes in the
    summary at the top.
    """
    title = report_title(contents_list, photos)
    shown_rooms = [
        room for room in rooms
        if (contents_list and _has_contents(room)) or (photos and room.get("photos"))
    ]
    # The canvas draws plain text, no markup to escape
    address_line = ", ".join(" ".join(line.split()) for line in (property_address or "").split("\n") if line.strip())

    def footer(cvs, doc):
        cvs.saveState()
        cvs.setFont("Helvetica", 8)
        cvs.setFillColor(GREY)
        y = 0.35 * inch
        cvs.drawString(MARGIN, y, f"Page {doc.page}")
        cvs.drawRightString(PAGE_W - MARGIN, y, title)
        if doc.page > 1 and address_line:
            line = address_line if len(address_line) <= 70 else address_line[:67] + "..."
            cvs.drawCentredString(PAGE_W / 2, y, line)
        cvs.restoreState()

    buffer = io.BytesIO()
    doc = BaseDocTemplate(
        buffer, pagesize=letter, title=title,
        leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=0.6 * inch,
    )
    doc.addPageTemplates([PageTemplate(
        id="report",
        frames=[Frame(
            MARGIN, 0.6 * inch, CONTENT_W, PAGE_H - 1.1 * inch, id="body",
            leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
        )],
        onPage=footer,
    )])

    story: List[Any] = []

    # ── Header: the company, then the report ──
    company = company_info or {}
    company_lines = [f"<b>{_text(company.get('name')) or 'Packing Report'}</b>"]
    company_lines += _lines(company.get("address"))
    company_lines += [_text(company[k]) for k in ("phone", "email") if company.get(k)]
    day = report_date or datetime.now()
    when = f"{day:%B} {day.day}, {day.year}"
    header = Table([[
        Paragraph("<br/>".join(company_lines), STYLE_NORMAL),
        Paragraph(f'<font size="18"><b>{title}</b></font><br/><br/>Date: {when}', STYLE_RIGHT),
    ]], colWidths=[4.2 * inch, 3.3 * inch], hAlign="LEFT")
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story += [header, Spacer(1, 0.22 * inch)]

    # ── Whom, where and which claim it is for ──
    prepared = ["<b>Prepared for</b>"]
    prepared += [_text(v) for v in (client_name, client_phone) if v]
    prepared += _lines(property_address)
    claim = []
    if claim_number or insurance_company:
        claim = ["<b>Claim</b>"]
        if claim_number:
            claim.append(f"Claim # {_text(claim_number)}")
        if insurance_company:
            claim.append(_text(insurance_company))
    who = Table([[
        Paragraph("<br/>".join(prepared), STYLE_NORMAL),
        Paragraph("<br/>".join(claim), STYLE_NORMAL) if claim else "",
    ]], colWidths=[4.2 * inch, 3.3 * inch], hAlign="LEFT")
    who.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story += [who, Spacer(1, 0.16 * inch)]

    # ── Summary ──
    summary = [_plural(len(shown_rooms), "room")]
    if contents_list:
        summary.append(_plural(sum(_room_count(r) for r in shown_rooms), "item"))
    if photos:
        summary.append(_plural(sum(len(r.get("photos") or []) for r in shown_rooms), "photo"))
    story.append(Paragraph(" &#183; ".join(summary), STYLE_BOLD))
    if estimate_total is not None:
        story.append(Paragraph(f"Estimate total: ${estimate_total:,.2f}", STYLE_NORMAL))
    story += [Spacer(1, 0.08 * inch), HRFlowable(width="100%", thickness=0.6, color=HAIRLINE)]

    if not shown_rooms:
        story += [Spacer(1, 0.2 * inch), Paragraph(
            "No photos of this estimate's rooms are on its claim." if photos and not contents_list
            else "This estimate has no rooms to list.",
            STYLE_GREY,
        )]

    # ── Room by room ──
    item_number = 1
    photo_number = 1
    for room in shown_rooms:
        items = room.get("items") or []
        room_photos = (room.get("photos") or []) if photos else []
        meta = [_FLOOR_LABEL.get(room.get("floor") or "", "")]
        if contents_list:
            meta.append(_plural(_room_count(room), "item"))
        if photos:
            meta.append(_plural(len(room_photos), "photo"))
        meta_text = " &#183; ".join(m for m in meta if m)
        lists_items = contents_list and _has_contents(room)
        story.append(CondPageBreak(ROOM_START_LIST if lists_items else ROOM_START_PHOTOS))
        story.append(Paragraph(
            f'{_text(room.get("room_name")) or "Room"}'
            f'<font name="Helvetica" size="9" color="#6b6b6b">&nbsp;&nbsp;&nbsp;{meta_text}</font>',
            STYLE_ROOM,
        ))
        story += [HRFlowable(width="100%", thickness=0.4, color=HAIRLINE, spaceBefore=3, spaceAfter=6)]

        if contents_list:
            if items:
                story.append(_contents_table(items, item_number))
                item_number += len(items)
            elif room.get("notable_items"):
                story.append(Paragraph(
                    "<b>Notable items:</b> " + ", ".join(_text(n) for n in room["notable_items"]),
                    STYLE_NORMAL,
                ))
            else:
                story.append(Paragraph("No items listed", STYLE_GREY))

        if room_photos:
            if contents_list:
                story.append(CondPageBreak(0.4 * inch + PHOTO_ROW_H))
                story.append(Paragraph("Photos", STYLE_SUBHEAD))
            story.append(_photo_grid(room_photos, photo_number))
            photo_number += len(room_photos)

    doc.build(story)
    return buffer.getvalue()
