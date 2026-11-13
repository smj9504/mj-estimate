"""
Flooring estimate PDF, in one of three layouts (LAYOUTS), none of them
Xactimate's (owner, 2026-11-13):

  rooms     each room a card: its sketch with its name, floor, amount and
            measurements beside it, then its lines under work heads (tear
            out, floor, trim...)
  trades    the whole house under each kind of work, room by room within it,
            after a summary by work beside the plan
  proposal  the work in words room by room with each room's amount, the
            itemized quantities at the back

Line items are numbered in the order they print, the numbers running on
through the document. Every layout ends with the plan of every level and the
terms. Built from a
calculated estimate (FlooringEstimateService.get_estimate): the
measurements are the ones its lines were calculated from
(calculated_rooms), the drawing is its sketch.
"""

import io
from datetime import datetime, timedelta
from itertools import count
from typing import Any, Dict, Iterator, List, Mapping, Optional, Tuple

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    CondPageBreak, HRFlowable, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table,
    TableStyle,
)

from . import pricing
from .floorplan_drawing import level_plan, room_thumbnail
from .geometry import (
    CUT_TO_FIT, ON_TOP, fixture_words, fixtures_by_room, floor_fit_of, levels_of,
)

BRAND_DARK = colors.HexColor("#1a2332")
BRAND_ACCENT = colors.HexColor("#2c5282")
TEXT_GREY = colors.HexColor("#4a5568")
BORDER_GREY = colors.HexColor("#e2e2e2")

MARGIN = 0.6 * inch

TERMS = [
    "This estimate is valid for 30 days from the date issued.",
    "Quantities are taken from the rooms as measured on site, interior wall to wall.",
    "Subfloor damage, moisture or other conditions found once the old floor is up are not included; "
    "they will be documented with photos and priced as a written change order before work goes on.",
    "Material is ordered by the full box or roll; what is left over stays with the owner.",
    "Any change to the scope after signing requires a written change order.",
]


def fixture_floor_notes(estimate: Mapping[str, Any]) -> List[str]:
    """The note on how each fixture meets a new tile or wood floor: set back
    on top of it, or the floor cut to fit it (more labor). Read
    from the sketch, for the rooms getting a tile or wood floor (owner's
    rule, 2026-11-13). Empty when there is nothing to say."""
    rooms = {str(r.get("room_id")): r for r in estimate.get("calculated_rooms") or []
             if r.get("new_material") in pricing.TILES | pricing.WOOD_FLOORS}
    on_top: List[str] = []
    cut_to_fit: List[str] = []
    floors = set()
    for level in levels_of(estimate.get("sketch_data")):
        for room_id, fixtures in fixtures_by_room(level).items():
            room = rooms.get(room_id)
            if room is None or not fixtures:
                continue
            floors.add("tile" if room.get("new_material") in pricing.TILES else "wood")
            name = _escape(room.get("name") or "Room")
            for fit, out in ((ON_TOP, on_top), (CUT_TO_FIT, cut_to_fit)):  # an island left in place: neither
                these = [f for f in fixtures if floor_fit_of(f) == fit]
                if these:
                    out.append(f"{name} — {_escape(fixture_words(str(f.get('type') or 'other') for f in these))}")
    if not on_top and not cut_to_fit:
        return []
    notes = [f"<b>Fixtures on the new {' and '.join(sorted(floors))} floors</b>"]
    if on_top:
        notes.append("• Set back on top of the new floor: " + "; ".join(on_top) + ".")
    if cut_to_fit:
        notes.append("• The new floor is cut to fit these (a hole for the flange or duct), which takes more "
                     "labor; it is included in each room's new floor line: " + "; ".join(cut_to_fit) + ".")
    return notes


def _floor_key(room: Mapping[str, Any]) -> Optional[str]:
    """What colors the room on the plan: its new floor, or "refinish" for a
    hardwood floor sanded in place"""
    return "refinish" if room.get("work") == "refinish" else room.get("new_material")


def _money(n: float) -> str:
    return f"${n:,.2f}"


def _escape(text: Any) -> str:
    from xml.sax.saxutils import escape
    return escape(str(text or ""))


def _company_block(company: Optional[Mapping[str, Any]], style: ParagraphStyle):
    if not company:
        return Spacer(1, 1)
    parts = []
    if company.get("name"):
        parts.append(f"<b><font size=11 color='#1a2332'>{_escape(company['name'])}</font></b>")
    address = company.get("address") or ""
    place = ", ".join(filter(None, [company.get("city"), company.get("state"), company.get("zipcode")]))
    if address or place:
        parts.append(_escape(", ".join(filter(None, [address, place]))))
    contact = " | ".join(filter(None, [company.get("phone"), company.get("email")]))
    if contact:
        parts.append(_escape(contact))
    if company.get("license_number"):
        parts.append(f"License #: {_escape(company['license_number'])}")
    return Paragraph("<br/>".join(parts), style)


def _canvas_maker(quote_no: str, address: str, title: str = "Flooring Estimate"):
    page_w, page_h = letter

    class NumberedCanvas(Canvas):
        def __init__(self, *args, **kwargs):
            Canvas.__init__(self, *args, **kwargs)
            self._pages: List[Dict[str, Any]] = []

        def showPage(self):
            self._pages.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._pages)
            for i, state in enumerate(self._pages):
                self.__dict__.update(state)
                self.saveState()
                self.setFont("Helvetica", 7.5)
                self.setFillColor(TEXT_GREY)
                if i:
                    self.drawString(MARGIN, page_h - 0.4 * inch, f"{title} · Quote #: {quote_no}")
                    self.drawRightString(page_w - MARGIN, page_h - 0.4 * inch, address[:70])
                    self.setStrokeColor(BORDER_GREY)
                    self.line(MARGIN, page_h - 0.48 * inch, page_w - MARGIN, page_h - 0.48 * inch)
                self.drawCentredString(page_w / 2, 0.4 * inch, f"Page {i + 1} / {total}")
                self.restoreState()
                Canvas.showPage(self)
            Canvas.save(self)

    return NumberedCanvas


# The PDF can be laid out three ways (owner, 2026-11-13: not like Xactimate)
LAYOUTS = ("rooms", "trades", "proposal")
LAYOUT_LABELS = {"rooms": "Room cards", "trades": "By trade", "proposal": "Proposal"}

# A room's lines in the order the work is done, under these heads
SECTIONS = (
    ("Move & detach", ("contents", "detach_reset")),
    ("Tear out", ("removal",)),
    ("Prep", ("prep",)),
    ("Floor", ("install", "refinish")),
    ("Trim", ("trim",)),
    ("Transitions & stairs", ("transition", "stairs")),
    ("Other work", ("general", "custom")),
)
_SECTION_OF = {category: title for title, categories in SECTIONS for category in categories}

CARD_BG = colors.HexColor("#eef2f7")
RULE = colors.HexColor("#e6e9ee")
CARD_THUMB_W, CARD_THUMB_H = 1.55 * inch, 1.25 * inch


def _grouped(lines: List[Mapping[str, Any]]) -> List[Tuple[str, List[Mapping[str, Any]]]]:
    """Lines under their heads (SECTIONS), heads in work order, lines as they came"""
    by: Dict[str, List[Mapping[str, Any]]] = {}
    for li in lines:
        by.setdefault(_SECTION_OF.get(str(li.get("category") or ""), "Other work"), []).append(li)
    return [(title, by[title]) for title, _ in SECTIONS if title in by]


def _total(lines: List[Mapping[str, Any]]) -> float:
    return sum(float(li.get("total") or 0) for li in lines)


def _qty(li: Mapping[str, Any]) -> str:
    return f"{float(li.get('quantity') or 0):,.2f} {li.get('unit') or ''}".strip()


def _floor_words(room: Mapping[str, Any]) -> str:
    """What the room's floor gets: "Ceramic tile · straight lay", "Hardwood · sand, stain, and finish" """
    if room.get("work") == "refinish":
        label, _ = pricing.REFINISH_FINISHES.get(room.get("finish") or "", ("Sand & refinish", ""))
        existing = pricing.MATERIALS.get(room.get("existing_material") or "", {}).get("short", "Hardwood")
        return f"{existing} · {label[0].lower()}{label[1:]}"
    new = room.get("new_material")
    if not new:
        return "No new floor"
    words = pricing.MATERIALS.get(new, {}).get("label", new)
    if new in pricing.PATTERNED:
        words += f" · {pricing.PATTERNS.get(room.get('pattern') or 'straight', 'straight lay')}"
    return words


class FlooringExportService:
    def generate_pdf(
        self, estimate: Mapping[str, Any], show_signature: bool = True, layout: str = "rooms",
    ) -> io.BytesIO:
        layout = layout if layout in LAYOUTS else "rooms"
        buffer = io.BytesIO()
        page_w, _ = letter
        w = page_w - 2 * MARGIN
        quote_no = str(estimate.get("id", ""))[:8].upper()
        address = ", ".join(filter(None, [
            estimate.get("property_address"),
            ", ".join(filter(None, [estimate.get("city"), " ".join(filter(None, [estimate.get("state"), estimate.get("zip_code")]))])),
        ]))
        title = "Flooring Proposal" if layout == "proposal" else "Flooring Estimate"
        doc = SimpleDocTemplate(
            buffer, pagesize=letter, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN,
            bottomMargin=0.8 * inch, title=title,
        )
        st = self._styles()
        rooms: List[Dict[str, Any]] = list(estimate.get("calculated_rooms") or [])
        lines = sorted(estimate.get("line_items") or [], key=lambda li: li.get("display_order") or 0)
        levels = {str(lvl.get("id")): lvl for lvl in levels_of(estimate.get("sketch_data"))}

        el: List[Any] = self._header(estimate, rooms, st, w, quote_no, address, title)
        if layout == "trades":
            el += self._by_trade(estimate, rooms, lines, levels, st, w)
        elif layout == "proposal":
            el += self._proposal(estimate, rooms, lines, st, w)
        else:
            el += self._room_cards(estimate, rooms, lines, levels, st, w)

        # The plan of each level
        materials = {r["room_id"]: _floor_key(r) for r in rooms}
        for lvl in levels.values():
            if not lvl.get("rooms"):
                continue
            el.append(PageBreak())
            el.append(Paragraph(f"Floor Plan — {_escape(lvl.get('name') or 'Level')}", st["plan"]))
            el.append(Paragraph("Interior dimensions, wall to wall. For estimating only — not for construction.", st["small"]))
            el.append(Spacer(1, 10))
            el.append(level_plan(lvl, w, 7.6 * inch, materials, materials.keys()))

        if layout == "proposal":
            el += self._itemized_appendix(rooms, lines, st, w)

        # Terms
        el.append(PageBreak())
        el.append(Paragraph("Terms &amp; Conditions", st["section"]))
        for term in TERMS:
            el.append(Paragraph(f"• {term}", st["bullet"]))
        if show_signature:
            el.append(Spacer(1, 36))
            sig = Table([["_______________________________", "", "_______________________________"],
                         ["Customer Signature / Date", "", "Contractor Signature / Date"]],
                        colWidths=[w * 0.42, w * 0.16, w * 0.42])
            sig.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 8.5), ("TEXTCOLOR", (0, 0), (-1, -1), TEXT_GREY)]))
            el.append(sig)

        doc.build(el, canvasmaker=_canvas_maker(quote_no, address, title))
        buffer.seek(0)
        return buffer

    # ── Shared ──

    def _styles(self) -> Dict[str, ParagraphStyle]:
        def style(name: str, size: float, bold: bool = False, color=BRAND_DARK, **kw) -> ParagraphStyle:
            return ParagraphStyle(name, fontSize=size, fontName="Helvetica-Bold" if bold else "Helvetica",
                                  textColor=color, **kw)

        return {
            "company": style("c", 9, color=TEXT_GREY, leading=13),
            "right": style("r", 9, color=TEXT_GREY, leading=13, alignment=2),
            "section": style("s", 11, True, spaceBefore=12, spaceAfter=8),
            "level": style("lv", 8, True, BRAND_ACCENT, leading=11, spaceBefore=4, spaceAfter=6),
            "card_title": style("ct", 12, True, leading=15),
            "card_total": style("cm", 12, True, leading=15, alignment=2),
            "chip": style("ch", 8.5, color=BRAND_ACCENT, leading=11),
            "group": style("g", 7.3, True, BRAND_ACCENT, leading=9),
            "desc": style("d", 8.8, leading=11),
            "num": style("n", 8.8, leading=11, alignment=2),
            "line_no": style("ln", 8.8, color=TEXT_GREY, leading=11, alignment=2),
            "small_no": style("sn", 7.8, color=TEXT_GREY, leading=10.5, alignment=2),
            "sub": style("sb", 7.8, color=TEXT_GREY, leading=10, alignment=2),
            "small": style("sm", 7.8, color=TEXT_GREY, leading=10.5),
            "body": style("bd", 9.5, leading=13.5),
            "terms": style("t", 8.5, color=TEXT_GREY, leading=12),
            # A bullet whose wrapped lines start under its text
            "bullet": style("b", 8.5, color=TEXT_GREY, leading=12, leftIndent=8, firstLineIndent=-8),
            "scope": style("sc", 9.2, leading=12.5, leftIndent=10, firstLineIndent=-10),
            "plan": style("fp", 14, True, leading=18, spaceAfter=2),
            "big": style("bg", 20, True, leading=24),
        }

    def _header(self, estimate, rooms, st, w, quote_no, address, title) -> List[Any]:
        today = datetime.now()
        right = Paragraph(
            f"<font size=18 color='#1a2332'><b>{title.upper()}</b></font><br/><br/>"
            f"Quote #: {quote_no}<br/>Date: {today:%m/%d/%Y}<br/>"
            f"Valid Through: {today + timedelta(days=30):%m/%d/%Y}", st["right"])
        header = Table([[_company_block(estimate.get("company_info"), st["company"]), right]],
                       colWidths=[w * 0.5, w * 0.5])
        header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                                    ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
        total_sf = sum(float(r.get("floor_sf") or 0) for r in rooms)
        info = [["Property:", address or "—", "Claim #:", estimate.get("claim_number") or "—"]]
        if estimate.get("client_name"):
            info.append(["Client:", estimate["client_name"], "", ""])
        level_names = list(dict.fromkeys(r.get("level_name") or "" for r in rooms))
        info.append(["Scope:", f"{' / '.join(n for n in level_names if n) or 'Rooms'} · {len(rooms)} rooms "
                               f"· {total_sf:,.2f} SF", "Measured:", "Interior, wall to wall"])
        it = Table(info, colWidths=[w * 0.11, w * 0.47, w * 0.15, w * 0.27])
        it.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"), ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9), ("TEXTCOLOR", (0, 0), (-1, -1), BRAND_DARK),
            ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ]))
        return [header, Spacer(1, 10), HRFlowable(width="100%", thickness=1.5, color=BRAND_ACCENT), Spacer(1, 8),
                it, Spacer(1, 10)]

    def _totals_table(self, rows: List[List[str]], grand_row: List[str], heads: List[str],
                      widths: List[float]) -> Table:
        """A short table of amounts: an accent rule under its heads, the grand total on a dark band"""
        data = [heads, *rows, grand_row]
        t = Table(data, colWidths=widths)
        t.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, 0), 7.5),
            ("TEXTCOLOR", (0, 0), (-1, 0), BRAND_ACCENT), ("LINEBELOW", (0, 0), (-1, 0), 1, BRAND_ACCENT),
            ("FONTSIZE", (0, 1), (-1, -1), 9.5), ("TEXTCOLOR", (0, 1), (-1, -2), BRAND_DARK),
            ("LINEBELOW", (0, 1), (-1, -2), 0.4, RULE),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("BACKGROUND", (0, -1), (-1, -1), BRAND_DARK), ("TEXTCOLOR", (0, -1), (-1, -1), colors.white),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"), ("FONTSIZE", (0, -1), (-1, -1), 11),
        ]))
        return t

    def _notes(self, estimate, st) -> List[Any]:
        """What the summary says under it, then the fixtures note"""
        text = "Quantities are measured from the sketch, interior wall to wall."
        if estimate.get("include_overhead_profit"):
            text += " Unit prices include overhead &amp; profit."
        out: List[Any] = [Spacer(1, 4), Paragraph(text, st["small"])]
        fixture_notes = fixture_floor_notes(estimate)
        if fixture_notes:
            out.append(Spacer(1, 8))
            out += [Paragraph(t, st["bullet" if t.startswith("•") else "terms"]) for t in fixture_notes]
        return out

    def _lines_table(self, lines, st, w, numbers: Iterator[int], area: bool = False, heads: bool = True) -> Table:
        """Lines under their heads, each with its number (taken from numbers,
        which run on through the document): description (with its note),
        quantity, unit price, amount; a head's subtotal when it has more than
        one line. With area, the room is a column after the number, said once
        per room within a head. A page never ends on a head without its first
        line, nor starts on a subtotal."""
        widths = [w * 0.05] + ([w * 0.16, w * 0.39] if area else [w * 0.55]) + [w * 0.15, w * 0.11, w * 0.14]
        n = len(widths)
        rows: List[List[Any]] = [[""] * (n - 3) + ["QTY", "UNIT PRICE", "AMOUNT"]]
        style: List[Any] = [
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, 0), 7),
            ("TEXTCOLOR", (0, 0), (-1, 0), TEXT_GREY), ("ALIGN", (n - 3, 0), (-1, -1), "RIGHT"),
            ("VALIGN", (0, 0), (-1, -1), "TOP"), ("FONTSIZE", (0, 1), (-1, -1), 8.8),
            ("TEXTCOLOR", (0, 1), (-1, -1), BRAND_DARK),
            ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
            ("LEFTPADDING", (0, 0), (0, -1), 2), ("RIGHTPADDING", (0, 0), (0, -1), 5),
        ]
        groups = _grouped(lines) if heads else [("", list(lines))]
        for title, group in groups:
            if heads:
                r = len(rows)
                rows.append([Paragraph(title.upper(), st["group"])] + [""] * (n - 1))
                style += [("SPAN", (0, r), (-1, r)), ("TOPPADDING", (0, r), (-1, r), 7),
                          ("NOSPLIT", (0, r), (-1, r + 1))]
            last_area = None
            for li in group:
                desc = _escape(li.get("description"))
                if li.get("notes"):
                    desc += f"<br/><font size=7.3 color='#4a5568'>{_escape(li['notes'])}</font>"
                cells = [Paragraph(f"{next(numbers)}.", st["line_no"]), Paragraph(desc, st["desc"]), _qty(li),
                         f"{float(li.get('unit_price') or 0):,.2f}", f"{float(li.get('total') or 0):,.2f}"]
                if area:
                    name = li.get("room_name") or "Whole job"
                    cells.insert(1, Paragraph(_escape(name) if name != last_area else "", st["desc"]))
                    last_area = name
                rows.append(cells)
                style.append(("LINEBELOW", (0, len(rows) - 1), (-1, len(rows) - 1), 0.3, RULE))
            if heads and len(group) > 1:
                r = len(rows)
                rows.append([""] * (n - 3) + [Paragraph(f"{_escape(title)} subtotal", st["sub"]), "",
                                               Paragraph(f"{_total(group):,.2f}", st["sub"])])
                style += [("SPAN", (n - 3, r), (n - 2, r)), ("NOSPLIT", (0, r - 1), (-1, r))]
        t = Table(rows, colWidths=widths, repeatRows=1)
        t.setStyle(TableStyle(style))
        return t

    @staticmethod
    def _starting_together(lead: List[Any], w: float, table: Optional[Table] = None, rows: int = 5) -> List[Any]:
        """lead, then table: on the next page when lead and the table's first
        rows (its column heads, the first work head and its first lines)
        don't fit in what is left of this one; the rest of the table runs on
        over the next pages, its column heads repeated. Not KeepTogether,
        which sends a room taller than what is left to the next page whole
        and leaves this one blank."""
        tall = letter[1]
        need = sum(f.wrap(w, tall)[1] + f.getSpaceBefore() + f.getSpaceAfter() for f in lead)
        if table is None:
            return [CondPageBreak(need), *lead]
        table.wrap(w, tall)
        need += sum(table._rowHeights[:rows])
        return [CondPageBreak(need), *lead, table]

    # ── Room cards: each room a card, its lines under work heads ──

    def _room_cards(self, estimate, rooms, lines, levels, st, w) -> List[Any]:
        el: List[Any] = []
        names = {r["room_id"]: r.get("name") for r in rooms}
        numbers = count(1)
        current_level = None
        summary: List[List[str]] = []
        for room in rooms:
            room_lines = [li for li in lines if li.get("room_id") == room["room_id"]]
            if not room_lines:
                continue
            lead: List[Any] = []
            if room.get("level_name") != current_level:
                current_level = room.get("level_name")
                lead.append(Paragraph((current_level or "Rooms").upper(), st["level"]))
            total = _total(room_lines)
            short = "Refinish" if room.get("work") == "refinish" else \
                pricing.MATERIALS.get(room.get("new_material") or "", {}).get("short", "—")
            summary.append([room.get("name"), f"{float(room.get('floor_sf') or 0):,.2f}", short, _money(total)])
            title = _escape(room.get("name"))
            if room.get("subroom_of") and names.get(room["subroom_of"]):
                title += f"  <font size=8 color='#4a5568'>in {_escape(names[room['subroom_of']])}</font>"
            lead += [self._room_head(room, title, total, levels.get(str(room.get("level_id"))), st, w), Spacer(1, 4)]
            el += self._starting_together(lead, w, self._lines_table(room_lines, st, w, numbers))
            el.append(Spacer(1, 16))

        general = [li for li in lines if not li.get("room_id")]
        if general:
            total = _total(general)
            el += self._starting_together([self._card_head("Whole job", "Once for the whole job", total, st, w),
                                           Spacer(1, 2)], w, self._lines_table(general, st, w, numbers))
            el.append(Spacer(1, 16))
            summary.append(["Whole job", "", "", _money(total)])

        total_sf = sum(float(r.get("floor_sf") or 0) for r in rooms)
        grand = ["Grand total", f"{total_sf:,.2f}", "", _money(float(estimate.get("total") or 0))]
        table = self._totals_table(summary, grand, ["AREA", "FLOOR SF", "FLOORING", "AMOUNT"],
                                   [w * 0.40, w * 0.18, w * 0.22, w * 0.20])
        el.append(KeepTogether([Paragraph("Summary", st["section"]), table, *self._notes(estimate, st)]))
        return el

    def _card_head(self, title_html: str, chip_html: str, total: float, st, w) -> Table:
        t = Table([[Paragraph(title_html, st["card_title"]), Paragraph(_money(total), st["card_total"])],
                   [Paragraph(chip_html, st["chip"]), ""]], colWidths=[w * 0.7, w * 0.3])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), CARD_BG), ("LINEBEFORE", (0, 0), (0, -1), 3, BRAND_ACCENT),
            ("SPAN", (1, 0), (1, 1)), ("VALIGN", (1, 0), (1, 1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (0, -1), 9), ("RIGHTPADDING", (1, 0), (1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, 0), 6), ("BOTTOMPADDING", (0, 1), (-1, 1), 6),
            ("TOPPADDING", (0, 1), (-1, 1), 0), ("BOTTOMPADDING", (0, 0), (-1, 0), 1),
        ]))
        return t

    def _room_head(self, room, title_html: str, total: float, level, st, w) -> Table:
        """The room's card head: its sketch small, beside it its name, its new
        floor and one line of measurements, its amount at the right. No
        doorways or old floor (owner, 2026-11-13: too much words)."""
        f = lambda k: float(room.get(k) or 0)  # noqa: E731
        facts = [f"<b>{f('floor_sf'):,.2f}</b> SF floor", f"<b>{f('base_lf'):,.2f}</b> LF baseboard"]
        if f("cabinet_run_lf"):
            facts.append(f"<b>{f('cabinet_run_lf'):,.2f}</b> LF cabinets")
        text = [Paragraph(title_html, st["card_title"]), Paragraph(_escape(_floor_words(room)), st["chip"]),
                Spacer(1, 6), Paragraph(" &nbsp;·&nbsp; ".join(facts), st["desc"])]
        sketch_room = None
        if level:
            sketch_room = next((r for r in level.get("rooms") or [] if str(r.get("id")) == room["room_id"]), None)
        drawn = sketch_room or {"id": room["room_id"], "name": room.get("name"), "points": room.get("points") or []}
        thumb = room_thumbnail(level or {}, drawn, CARD_THUMB_W, CARD_THUMB_H, _floor_key(room))
        thumb_w, total_w = CARD_THUMB_W + 15, w * 0.2
        t = Table([[thumb, text, Paragraph(_money(total), st["card_total"])]],
                  colWidths=[thumb_w, w - thumb_w - total_w, total_w])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), CARD_BG), ("LINEBEFORE", (0, 0), (0, -1), 3, BRAND_ACCENT),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (0, 0), 9), ("LEFTPADDING", (1, 0), (1, 0), 6),
            ("RIGHTPADDING", (2, 0), (2, 0), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        return t

    # ── By trade: the whole house under each kind of work ──

    def _by_trade(self, estimate, rooms, lines, levels, st, w) -> List[Any]:
        groups = _grouped(lines)
        summary = [[title, _money(_total(group))] for title, group in groups]
        table = self._totals_table(summary, ["Grand total", _money(float(estimate.get("total") or 0))],
                                   ["WORK", "AMOUNT"], [w * 0.32, w * 0.18])
        # The summary by work beside its notes (the plan is at the back)
        notes = self._notes(estimate, st)
        top = Table([[table, notes[1:] or ""]], colWidths=[w * 0.52, w * 0.48])
        top.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (0, 0), 0),
                                 ("LEFTPADDING", (1, 0), (1, 0), 14)]))
        el: List[Any] = [Paragraph("Project Summary", st["section"]), top, Spacer(1, 18)]
        numbers = count(1)
        for title, group in groups:
            head = Table([[Paragraph(_escape(title), st["card_title"]),
                           Paragraph(_money(_total(group)), st["card_total"])]], colWidths=[w * 0.7, w * 0.3])
            head.setStyle(TableStyle([
                ("LINEBELOW", (0, 0), (-1, -1), 1.2, BRAND_ACCENT), ("LEFTPADDING", (0, 0), (0, 0), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]))
            el += self._starting_together([head], w, self._lines_table(group, st, w, numbers, area=True, heads=False),
                                          rows=4)
            el.append(Spacer(1, 14))
        return el

    # ── Proposal: the work in words, room by room; the quantities at the back ──

    def _proposal(self, estimate, rooms, lines, st, w) -> List[Any]:
        el: List[Any] = [
            Paragraph("Scope of Work", st["section"]),
            Paragraph("The work below is priced room by room, labor and materials included. The quantities each "
                      "price comes from are itemized at the back.", st["body"]),
            Spacer(1, 12),
        ]
        names = {r["room_id"]: r.get("name") for r in rooms}

        def block(title: str, sub: str, room_lines: List[Mapping[str, Any]]) -> List[Any]:
            head = Table([[Paragraph(title, st["card_title"]), Paragraph(_money(_total(room_lines)), st["card_total"])]],
                         colWidths=[w * 0.7, w * 0.3])
            head.setStyle(TableStyle([
                ("LINEBELOW", (0, 0), (-1, -1), 1, BRAND_ACCENT), ("LEFTPADDING", (0, 0), (0, 0), 0),
                ("RIGHTPADDING", (1, 0), (1, 0), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]))
            items = []
            for li in room_lines:
                text = _escape(li.get("description"))
                unit = li.get("unit") or ""
                qty = float(li.get("quantity") or 0)
                if unit in ("SF", "LF", "SY"):
                    text += f" <font color='#4a5568'>({qty:,.2f} {unit})</font>"
                elif qty != 1:
                    text += f" <font color='#4a5568'>({qty:g})</font>"
                if li.get("notes"):
                    text += f"<br/><font size=7.8 color='#4a5568'>{_escape(li['notes'])}</font>"
                items.append(Paragraph(f"•&nbsp;&nbsp;{text}", st["scope"]))
            # The head with its first three items on one page, the rest free to run on
            return [*self._starting_together([head, Spacer(1, 3), Paragraph(sub, st["chip"]), Spacer(1, 4),
                                              *items[:3]], w), *items[3:], Spacer(1, 14)]

        for room in rooms:
            room_lines = [li for li in lines if li.get("room_id") == room["room_id"]]
            if not room_lines:
                continue
            title = _escape(room.get("name"))
            if room.get("subroom_of") and names.get(room["subroom_of"]):
                title += f"  <font size=8 color='#4a5568'>in {_escape(names[room['subroom_of']])}</font>"
            sub = f"{_escape(_floor_words(room))} · {float(room.get('floor_sf') or 0):,.2f} SF"
            el += block(title, sub, room_lines)
        general = [li for li in lines if not li.get("room_id")]
        if general:
            el += block("Whole job", "Once for the whole job", general)

        total = Table([["Total", _money(float(estimate.get("total") or 0))]], colWidths=[w * 0.7, w * 0.3])
        total.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), BRAND_DARK), ("TEXTCOLOR", (0, 0), (-1, -1), colors.white),
            ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 13),
            ("ALIGN", (1, 0), (1, 0), "RIGHT"), ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8), ("LEFTPADDING", (0, 0), (0, 0), 10),
            ("RIGHTPADDING", (1, 0), (1, 0), 10),
        ]))
        el.append(KeepTogether([total, *self._notes(estimate, st)]))
        return el

    def _itemized_appendix(self, rooms, lines, st, w) -> List[Any]:
        rows: List[List[Any]] = [["", "AREA", "DESCRIPTION", "QTY", "UNIT PRICE", "AMOUNT"]]
        last = None
        for i, li in enumerate(lines, 1):
            name = li.get("room_name") or "Whole job"
            rows.append([Paragraph(f"{i}.", st["small_no"]),
                         Paragraph(_escape(name) if name != last else "", st["small"]),
                         Paragraph(_escape(li.get("description")), st["small"]), _qty(li),
                         f"{float(li.get('unit_price') or 0):,.2f}", f"{float(li.get('total') or 0):,.2f}"])
            last = name
        t = Table(rows, colWidths=[w * 0.05, w * 0.15, w * 0.42, w * 0.13, w * 0.11, w * 0.14], repeatRows=1)
        t.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, 0), 7),
            ("TEXTCOLOR", (0, 0), (-1, 0), BRAND_ACCENT), ("LINEBELOW", (0, 0), (-1, 0), 1, BRAND_ACCENT),
            ("FONTSIZE", (0, 1), (-1, -1), 7.8), ("TEXTCOLOR", (0, 1), (-1, -1), BRAND_DARK),
            ("ALIGN", (3, 0), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LINEBELOW", (0, 1), (-1, -1), 0.3, RULE),
            ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ("LEFTPADDING", (0, 0), (0, -1), 0), ("RIGHTPADDING", (0, 0), (0, -1), 4),
        ]))
        return [PageBreak(), Paragraph("Itemized Quantities", st["section"]), t]
