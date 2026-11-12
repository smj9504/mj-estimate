"""
Flooring estimate PDF.

Laid out the way an Xactimate estimate is read: room by room, each room's
small sketch in the top-left corner of its block with its measurements
beside it and its lines below, then the General section, a summary, the
plan of every level, and the terms.

Built from a calculated estimate (FlooringEstimateService.get_estimate):
the measurements are the ones its lines were calculated from
(calculated_rooms), the drawing is its sketch.
"""

import io
from datetime import datetime, timedelta
from typing import Any, Dict, List, Mapping, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    HRFlowable, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

from . import pricing
from .floorplan_drawing import level_plan, room_thumbnail
from .geometry import format_ft_in, levels_of

BRAND_DARK = colors.HexColor("#1a2332")
BRAND_ACCENT = colors.HexColor("#2c5282")
TEXT_GREY = colors.HexColor("#4a5568")
BORDER_GREY = colors.HexColor("#e2e2e2")
SECTION_BG = colors.HexColor("#f1f1f1")
ROW_ALT = colors.HexColor("#f7f7f7")

MARGIN = 0.6 * inch
THUMB_W, THUMB_H = 2.05 * inch, 1.72 * inch

OPENING_WORDS = {
    "opening": "Opening", "door": "Door", "bifold": "Bifold", "pocket": "Pocket door",
    "slider": "Slider", "exterior_door": "Door",
}

TERMS = [
    "This estimate is valid for 30 days from the date issued.",
    "Quantities are taken from the rooms as measured on site, interior wall to wall.",
    "Subfloor damage, moisture or other conditions found once the old floor is up are not included; "
    "they will be documented with photos and priced as a written change order before work goes on.",
    "Material is ordered by the full box or roll; what is left over stays with the owner.",
    "Any change to the scope after signing requires a written change order.",
]


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


def _canvas_maker(quote_no: str, address: str):
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
                    self.drawString(MARGIN, page_h - 0.4 * inch, f"Flooring Estimate · Quote #: {quote_no}")
                    self.drawRightString(page_w - MARGIN, page_h - 0.4 * inch, address[:70])
                    self.setStrokeColor(BORDER_GREY)
                    self.line(MARGIN, page_h - 0.48 * inch, page_w - MARGIN, page_h - 0.48 * inch)
                self.drawCentredString(page_w / 2, 0.4 * inch, f"Page {i + 1} / {total}")
                self.restoreState()
                Canvas.showPage(self)
            Canvas.save(self)

    return NumberedCanvas


class FlooringExportService:
    def generate_pdf(self, estimate: Mapping[str, Any], show_signature: bool = True) -> io.BytesIO:
        buffer = io.BytesIO()
        page_w, _ = letter
        usable_w = page_w - 2 * MARGIN
        quote_no = str(estimate.get("id", ""))[:8].upper()
        address = ", ".join(filter(None, [
            estimate.get("property_address"),
            ", ".join(filter(None, [estimate.get("city"), " ".join(filter(None, [estimate.get("state"), estimate.get("zip_code")]))])),
        ]))
        doc = SimpleDocTemplate(
            buffer, pagesize=letter, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN,
            bottomMargin=0.8 * inch, title="Flooring Estimate",
        )
        st = {
            "company": ParagraphStyle("c", fontSize=9, fontName="Helvetica", textColor=TEXT_GREY, leading=13),
            "right": ParagraphStyle("r", fontSize=9, fontName="Helvetica", textColor=TEXT_GREY, leading=13, alignment=2),
            "section": ParagraphStyle("s", fontSize=11, fontName="Helvetica-Bold", textColor=BRAND_DARK, spaceBefore=12, spaceAfter=8),
            "room": ParagraphStyle("rn", fontSize=10.5, fontName="Helvetica", textColor=BRAND_DARK),
            "height": ParagraphStyle("h", fontSize=8.5, fontName="Helvetica", textColor=TEXT_GREY, alignment=2),
            "desc": ParagraphStyle("d", fontSize=8.8, fontName="Helvetica", textColor=BRAND_DARK, leading=11),
            "meas": ParagraphStyle("m", fontSize=8.3, fontName="Helvetica", textColor=BRAND_DARK, leading=11),
            "small": ParagraphStyle("sm", fontSize=7.8, fontName="Helvetica", textColor=TEXT_GREY, leading=10.5),
            "terms": ParagraphStyle("t", fontSize=8.5, fontName="Helvetica", textColor=TEXT_GREY, leading=12),
            "plan": ParagraphStyle("fp", fontSize=14, leading=18, fontName="Helvetica-Bold", textColor=BRAND_DARK, spaceAfter=2),
        }
        el: List[Any] = []

        # ── Header ──
        today = datetime.now()
        right = Paragraph(
            "<font size=18 color='#1a2332'><b>FLOORING ESTIMATE</b></font><br/><br/>"
            f"Quote #: {quote_no}<br/>Date: {today:%m/%d/%Y}<br/>"
            f"Valid Through: {today + timedelta(days=30):%m/%d/%Y}", st["right"])
        header = Table([[_company_block(estimate.get("company_info"), st["company"]), right]],
                       colWidths=[usable_w * 0.5, usable_w * 0.5])
        header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                                    ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
        el += [header, Spacer(1, 10), HRFlowable(width="100%", thickness=1.5, color=BRAND_ACCENT), Spacer(1, 8)]

        rooms: List[Dict[str, Any]] = list(estimate.get("calculated_rooms") or [])
        names = {r["room_id"]: r.get("name") for r in rooms}
        lines = sorted(estimate.get("line_items") or [], key=lambda li: li.get("display_order") or 0)
        total_sf = sum(float(r.get("floor_sf") or 0) for r in rooms)
        levels = {str(lvl.get("id")): lvl for lvl in levels_of(estimate.get("sketch_data"))}

        info = [["Property:", address or "—", "Claim #:", estimate.get("claim_number") or "—"]]
        if estimate.get("client_name"):
            info.append(["Client:", estimate["client_name"], "", ""])
        level_names = list(dict.fromkeys(r.get("level_name") or "" for r in rooms))
        info.append(["Scope:", f"{' / '.join(n for n in level_names if n) or 'Rooms'} · {len(rooms)} rooms "
                               f"· {total_sf:,.2f} SF", "Measured:", "Interior, wall to wall"])
        it = Table(info, colWidths=[usable_w * 0.11, usable_w * 0.47, usable_w * 0.15, usable_w * 0.27])
        it.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"), ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9), ("TEXTCOLOR", (0, 0), (-1, -1), BRAND_DARK),
            ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ]))
        el += [it, Spacer(1, 6)]

        col_w = [usable_w * 0.045, usable_w * 0.515, usable_w * 0.11, usable_w * 0.06, usable_w * 0.12, usable_w * 0.15]
        number = 1

        def line_table(items: List[Mapping[str, Any]], total_label: str, total: float):
            nonlocal number
            rows: List[List[Any]] = [["", "DESCRIPTION", "QTY", "UNIT", "UNIT PRICE", "TOTAL"]]
            for li in items:
                desc = _escape(li.get("description"))
                if li.get("notes"):
                    desc += f"<br/><font size=7.5 color='#4a5568'>{_escape(li['notes'])}</font>"
                rows.append([f"{number}.", Paragraph(desc, st["desc"]), f"{float(li.get('quantity') or 0):,.2f}",
                             li.get("unit") or "", f"{float(li.get('unit_price') or 0):,.2f}",
                             f"{float(li.get('total') or 0):,.2f}"])
                number += 1
            rows.append(["", "", "", "", total_label, f"{total:,.2f}"])
            table = Table(rows, colWidths=col_w, repeatRows=1)
            style = [
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, 0), 7.5),
                ("TEXTCOLOR", (0, 0), (-1, 0), TEXT_GREY), ("LINEBELOW", (0, 0), (-1, 0), 0.6, BORDER_GREY),
                ("FONTSIZE", (0, 1), (-1, -1), 8.8), ("TEXTCOLOR", (0, 1), (-1, -1), BRAND_DARK),
                ("VALIGN", (0, 0), (-1, -1), "TOP"), ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
                ("ALIGN", (3, 0), (3, -1), "CENTER"),
                ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("FONTNAME", (4, -1), (-1, -1), "Helvetica-Bold"), ("LINEABOVE", (4, -1), (-1, -1), 0.6, BORDER_GREY),
                ("SPAN", (0, -1), (3, -1)),
            ]
            for r in range(2, len(rows) - 1, 2):
                style.append(("BACKGROUND", (0, r), (-1, r), ROW_ALT))
            table.setStyle(TableStyle(style))
            return table

        def bar(title_html: str, right_text: str = ""):
            t = Table([[Paragraph(title_html, st["room"]), Paragraph(right_text, st["height"])]],
                      colWidths=[usable_w * 0.7, usable_w * 0.3])
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), SECTION_BG), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LINEBELOW", (0, 0), (-1, -1), 0.8, BRAND_ACCENT),
            ]))
            return t

        def level_bar(name: str):
            t = Table([[name]], colWidths=[usable_w])
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), BRAND_ACCENT), ("TEXTCOLOR", (0, 0), (-1, -1), colors.white),
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]))
            return t

        summary: List[List[Any]] = []
        current_level = None
        for room in rooms:
            room_lines = [li for li in lines if li.get("room_id") == room["room_id"]]
            if not room_lines:
                continue
            if room.get("level_name") != current_level:
                current_level = room.get("level_name")
                el += [Spacer(1, 6), level_bar(current_level or "Rooms"), Spacer(1, 8)]
            total = sum(float(li.get("total") or 0) for li in room_lines)
            summary.append([room.get("name"), f"{float(room.get('floor_sf') or 0):,.2f}",
                            pricing.MATERIALS.get(room.get("new_material") or "", {}).get("short", "—"), _money(total)])

            title = f"<b>{_escape(room.get('name'))}</b>"
            if room.get("subroom_of") and names.get(room["subroom_of"]):
                title += f"  <font size=8 color='#4a5568'>(subroom of {_escape(names[room['subroom_of']])})</font>"
            block = [bar(title, f"Height: {format_ft_in(float(room.get('height_ft') or 8))}")]
            block.append(self._room_top(room, levels.get(str(room.get("level_id"))), st, usable_w))
            block += [line_table(room_lines, f"Totals: {room.get('name')}", total), Spacer(1, 14)]
            el.append(KeepTogether(block))

        general = [li for li in lines if not li.get("room_id")]
        general_total = sum(float(li.get("total") or 0) for li in general)
        if general:
            el.append(KeepTogether([
                bar("<b>General</b>"), Spacer(1, 4), line_table(general, "Totals: General", general_total), Spacer(1, 14),
            ]))
            summary.append(["General", "", "", _money(general_total)])

        # ── Summary ──
        srows = [["Area", "Floor SF", "New Flooring", "Total"], *summary,
                 ["", f"{total_sf:,.2f}", "GRAND TOTAL", _money(float(estimate.get("total") or 0))]]
        stbl = Table(srows, colWidths=[usable_w * 0.40, usable_w * 0.18, usable_w * 0.22, usable_w * 0.20])
        stbl.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("BACKGROUND", (0, 0), (-1, 0), SECTION_BG),
            ("FONTSIZE", (0, 0), (-1, -1), 9.5), ("TEXTCOLOR", (0, 0), (-1, -1), BRAND_DARK),
            ("ALIGN", (1, 0), (1, -1), "RIGHT"), ("ALIGN", (3, 0), (3, -1), "RIGHT"),
            ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"), ("FONTSIZE", (0, -1), (-1, -1), 10.5),
            ("LINEABOVE", (0, -1), (-1, -1), 1.5, BRAND_ACCENT), ("BACKGROUND", (0, -1), (-1, -1), SECTION_BG),
        ]))
        notes = "Quantities are measured from the sketch, interior wall to wall."
        if estimate.get("include_overhead_profit"):
            notes += " Unit prices include overhead &amp; profit."
        el.append(KeepTogether([Paragraph("Estimate Summary", st["section"]), stbl, Spacer(1, 4), Paragraph(notes, st["small"])]))

        # ── The plan of each level ──
        materials = {r["room_id"]: r.get("new_material") for r in rooms}
        for lvl in levels.values():
            if not lvl.get("rooms"):
                continue
            el.append(PageBreak())
            el.append(Paragraph(f"Floor Plan — {_escape(lvl.get('name') or 'Level')}", st["plan"]))
            el.append(Paragraph("Interior dimensions, wall to wall. For estimating only — not for construction.", st["small"]))
            el.append(Spacer(1, 10))
            el.append(level_plan(lvl, usable_w, 7.6 * inch, materials, materials.keys()))

        # ── Terms ──
        el.append(PageBreak())
        el.append(Paragraph("Terms &amp; Conditions", st["section"]))
        for term in TERMS:
            el.append(Paragraph(f"• {term}", st["terms"]))
        if show_signature:
            el.append(Spacer(1, 36))
            sig = Table([["_______________________________", "", "_______________________________"],
                         ["Customer Signature / Date", "", "Contractor Signature / Date"]],
                        colWidths=[usable_w * 0.42, usable_w * 0.16, usable_w * 0.42])
            sig.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 8.5), ("TEXTCOLOR", (0, 0), (-1, -1), TEXT_GREY)]))
            el.append(sig)

        doc.build(el, canvasmaker=_canvas_maker(quote_no, address))
        buffer.seek(0)
        return buffer

    def _room_top(self, room: Mapping[str, Any], level: Optional[Mapping[str, Any]], st, usable_w: float):
        """The room's sketch in the corner, its measurements beside it"""
        sketch_room = None
        if level:
            sketch_room = next((r for r in level.get("rooms") or [] if str(r.get("id")) == room["room_id"]), None)
        drawn = sketch_room or {"id": room["room_id"], "name": room.get("name"), "points": room.get("points") or []}
        thumb = room_thumbnail(level or {}, drawn, THUMB_W, THUMB_H, room.get("new_material"))

        def row(v1: float, l1: str, v2: float, l2: str):
            return [Paragraph(f"<b>{v1:,.2f}</b>", st["meas"]), Paragraph(l1, st["meas"]),
                    Paragraph(f"<b>{v2:,.2f}</b>", st["meas"]), Paragraph(l2, st["meas"])]

        f = lambda k: float(room.get(k) or 0)  # noqa: E731
        table = Table([
            row(f("floor_sf"), "SF Floor", f("floor_sy"), "SY Flooring"),
            row(f("perimeter_lf"), "LF Floor Perimeter", f("base_lf"), "LF Baseboard"),
            row(f("wall_sf"), "SF Walls", f("ceiling_sf"), "SF Ceiling"),
        ], colWidths=[0.62 * inch, 1.25 * inch, 0.62 * inch, 1.3 * inch])
        table.setStyle(TableStyle([
            ("ALIGN", (0, 0), (0, -1), "RIGHT"), ("ALIGN", (2, 0), (2, -1), "RIGHT"),
            ("TOPPADDING", (0, 0), (-1, -1), 1.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
            ("LEFTPADDING", (0, 0), (-1, -1), 2), ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ]))
        details: List[Any] = [table, Spacer(1, 4)]
        openings = room.get("openings") or []
        if openings:
            text = " · ".join(
                f"{format_ft_in(float(o.get('width_lf') or 0))} {OPENING_WORDS.get(o.get('kind'), 'Opening')} "
                f"→ {_escape(o.get('to_room_name') or 'Exterior')}"
                for o in openings
            )
            details.append(Paragraph(f"<b>Openings:</b> {text}", st["small"]))
        deductions = ["openings"] + (["cabinet runs"] if room.get("cabinet_run_lf") else [])
        details.append(Paragraph(f"Baseboard = perimeter less {' and '.join(deductions)}", st["small"]))
        new = room.get("new_material")
        spec = "<b>New:</b> "
        if new:
            spec += _escape(pricing.MATERIALS.get(new, {}).get("label", new))
            if new in pricing.PATTERNED:
                spec += f" - {_escape(pricing.PATTERNS.get(room.get('pattern') or 'straight', 'straight lay'))}, " \
                        f"{float(room.get('waste_pct') or 0):g}% waste"
        else:
            spec += "—"
        existing = room.get("existing_material")
        existing_label = _escape(pricing.MATERIALS.get(existing, {}).get("label", existing)) if existing else "—"
        spec += f" &nbsp;&nbsp;<b>Existing:</b> {existing_label}"
        details += [Spacer(1, 3), Paragraph(spec, st["small"])]
        top = Table([[thumb, details]], colWidths=[THUMB_W + 10, usable_w - THUMB_W - 10])
        top.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (0, 0), 0),
            ("LEFTPADDING", (1, 0), (1, 0), 6), ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        return top
