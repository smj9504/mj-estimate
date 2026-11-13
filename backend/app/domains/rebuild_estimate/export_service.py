"""
The rebuild estimate as a PDF: a summary of the rooms and what went into
them, then each room with its lines under its sections (floor, cabinets,
a bathroom's phases, wall, ceiling...), numbered through the document, as a
contractor's estimate reads (owner, 2026-11-13). Unit prices have material
tax and O&P in them; nothing is added below the total.
"""

import io
from datetime import datetime, timedelta
from typing import Any, Dict, List, Mapping

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    CondPageBreak, HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

from app.domains.flooring_estimate.export_service import (
    BRAND_ACCENT, BRAND_DARK, BORDER_GREY, MARGIN, TEXT_GREY, _canvas_maker, _company_block, _escape, _money,
)

CARD_BG = colors.HexColor("#eef2f7")
RULE = colors.HexColor("#e6e9ee")
TITLE = "Rebuild Estimate"

TERMS = [
    "This estimate is valid for 30 days from the date issued.",
    "Quantities are taken from the rooms as measured on site.",
    "Hidden damage or conditions found once work is open (framing, subfloor, moisture, wiring, plumbing) are "
    "not included; they will be documented with photos and priced as a written change order before work goes on.",
    "Any change to the scope after signing requires a written change order.",
]


def _measure_words(measures: Mapping[str, Any]) -> str:
    parts = []
    for key, unit, word in (("floor_sf", "SF", "floor"), ("wall_sf", "SF", "walls"),
                            ("ceiling_sf", "SF", "ceiling"), ("perimeter_lf", "LF", "perimeter")):
        value = measures.get(key)
        if value:
            parts.append(f"{float(value):,.2f} {unit} {word}")
    return " · ".join(parts)


class RebuildExportService:
    def generate_pdf(self, estimate: Mapping[str, Any], show_signature: bool = True) -> io.BytesIO:
        buffer = io.BytesIO()
        page_w, _ = letter
        w = page_w - 2 * MARGIN
        quote_no = str(estimate.get("id", ""))[:8].upper()
        address = ", ".join(filter(None, [
            estimate.get("property_address"),
            ", ".join(filter(None, [estimate.get("city"), " ".join(filter(None, [estimate.get("state"), estimate.get("zip_code")]))])),
        ]))
        doc = SimpleDocTemplate(buffer, pagesize=letter, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN,
                                bottomMargin=0.8 * inch, title=TITLE)
        st = self._styles()
        assembled = estimate.get("assembled") or {}
        rooms = assembled.get("rooms") or []

        el: List[Any] = self._header(estimate, st, w, quote_no, address)
        el += self._summary(estimate, assembled, st, w)
        for room in rooms:
            if room.get("sections"):    # a room with nothing in it yet isn't printed
                el += self._room(room, st, w)

        grand = Table([["Grand total", _money(float(assembled.get("total") or 0))]], colWidths=[w * 0.7, w * 0.3])
        grand.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), BRAND_DARK), ("TEXTCOLOR", (0, 0), (-1, -1), colors.white),
            ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 11),
            ("ALIGN", (1, 0), (1, 0), "RIGHT"), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]))
        el += [Spacer(1, 6), grand, Spacer(1, 4),
               Paragraph("Material tax and overhead &amp; profit, where they apply, are in the unit prices.", st["small"])]

        el.append(CondPageBreak(2.6 * inch))
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

        doc.build(el, canvasmaker=_canvas_maker(quote_no, address, TITLE))
        buffer.seek(0)
        return buffer

    def _styles(self) -> Dict[str, ParagraphStyle]:
        def style(name: str, size: float, bold: bool = False, color=BRAND_DARK, **kw) -> ParagraphStyle:
            return ParagraphStyle(name, fontSize=size, fontName="Helvetica-Bold" if bold else "Helvetica",
                                  textColor=color, **kw)

        return {
            "company": style("c", 9, color=TEXT_GREY, leading=13),
            "right": style("r", 9, color=TEXT_GREY, leading=13, alignment=2),
            "section": style("s", 11, True, spaceBefore=12, spaceAfter=8),
            "card_title": style("ct", 12, True, leading=15),
            "card_total": style("cm", 12, True, leading=15, alignment=2),
            "chip": style("ch", 8.5, color=BRAND_ACCENT, leading=11),
            "group": style("g", 7.6, True, BRAND_ACCENT, leading=9.5),
            "desc": style("d", 8.8, leading=11),
            "num": style("n", 8.8, leading=11, alignment=2),
            "line_no": style("ln", 8.8, color=TEXT_GREY, leading=11, alignment=2),
            "sub": style("sb", 7.8, color=TEXT_GREY, leading=10, alignment=2),
            "small": style("sm", 7.8, color=TEXT_GREY, leading=10.5),
            "bullet": style("b", 8.5, color=TEXT_GREY, leading=12, leftIndent=8, firstLineIndent=-8),
        }

    def _header(self, estimate, st, w, quote_no, address) -> List[Any]:
        today = datetime.now()
        right = Paragraph(
            f"<font size=18 color='#1a2332'><b>{TITLE.upper()}</b></font><br/><br/>"
            f"Quote #: {quote_no}<br/>Date: {today:%m/%d/%Y}<br/>"
            f"Valid Through: {today + timedelta(days=30):%m/%d/%Y}", st["right"])
        header = Table([[_company_block(estimate.get("company_info"), st["company"]), right]],
                       colWidths=[w * 0.5, w * 0.5])
        header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                                    ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
        info = [["Property:", address or "—", "Claim #:", estimate.get("claim_number") or "—"]]
        if estimate.get("client_name"):
            info.append(["Client:", estimate["client_name"], "", ""])
        it = Table(info, colWidths=[w * 0.11, w * 0.47, w * 0.15, w * 0.27])
        it.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"), ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9), ("TEXTCOLOR", (0, 0), (-1, -1), BRAND_DARK),
            ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ]))
        return [header, Spacer(1, 10), HRFlowable(width="100%", thickness=1.5, color=BRAND_ACCENT), Spacer(1, 8),
                it, Spacer(1, 10)]

    def _summary(self, estimate, assembled, st, w) -> List[Any]:
        """Each room's amount, then what the estimate is made of"""
        rows = [["Room", "Amount"]]
        for room in assembled.get("rooms") or []:
            if room.get("sections"):
                rows.append([room.get("name") or "", _money(float(room.get("total") or 0))])
        rows.append(["Total", _money(float(assembled.get("total") or 0))])
        table = Table(rows, colWidths=[w * 0.7, w * 0.3])
        table.setStyle(TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 9), ("TEXTCOLOR", (0, 0), (-1, -1), BRAND_DARK),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("TEXTCOLOR", (0, 0), (-1, 0), BRAND_ACCENT),
            ("LINEBELOW", (0, 0), (-1, 0), 1, BRAND_ACCENT), ("LINEBELOW", (0, 1), (-1, -2), 0.4, RULE),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"), ("LINEABOVE", (0, -1), (-1, -1), 1, BRAND_DARK),
            ("ALIGN", (1, 0), (1, -1), "RIGHT"), ("LEFTPADDING", (0, 0), (0, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        out: List[Any] = [Paragraph("Summary", st["section"]), table]
        parts = [f"{_escape(s.get('label'))} ({_money(float(s.get('total') or 0))})"
                 for s in assembled.get("by_source") or []]
        if float(assembled.get("added_total") or 0):
            parts.append(f"other repairs ({_money(float(assembled['added_total']))})")
        if parts:
            out += [Spacer(1, 6), Paragraph("Made up of: " + "; ".join(parts) + ".", st["small"])]
        return out + [Spacer(1, 14)]

    def _room(self, room, st, w) -> List[Any]:
        head = Table([[Paragraph(_escape(room.get("name")), st["card_title"]),
                       Paragraph(_money(float(room.get("total") or 0)), st["card_total"])]],
                     colWidths=[w * 0.7, w * 0.3])
        head.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), CARD_BG), ("LINEBEFORE", (0, 0), (0, -1), 3, BRAND_ACCENT),
            ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        intro: List[Any] = [head]
        words = _measure_words(room.get("measures") or {})
        if words:
            intro += [Spacer(1, 3), Paragraph(_escape(words), st["chip"])]

        widths = [w * 0.06, w * 0.5, w * 0.14, w * 0.14, w * 0.16]
        rows: List[List[Any]] = [["#", "Description", "Qty", "Unit price", "Amount"]]
        styles = [
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, 0), 7.6),
            ("TEXTCOLOR", (0, 0), (-1, 0), TEXT_GREY), ("LINEBELOW", (0, 0), (-1, 0), 0.6, BORDER_GREY),
            ("ALIGN", (2, 0), (-1, 0), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
        ]
        sections = room.get("sections") or []
        general = room.get("id") is None
        for section in sections:
            if not general or len(sections) > 1:
                rows.append(["", Paragraph(_escape(section.get("label")).upper(), st["group"]), "", "", ""])
                styles.append(("TOPPADDING", (0, len(rows) - 1), (-1, len(rows) - 1), 7))
            for li in section.get("lines") or []:
                text = _escape(li.get("description"))
                if li.get("notes"):
                    text += f"<br/><font size=7.6 color='#4a5568'>{_escape(li['notes'])}</font>"
                rows.append([
                    Paragraph(f"{li.get('n')}.", st["line_no"]), Paragraph(text, st["desc"]),
                    Paragraph(f"{float(li.get('quantity') or 0):,.2f} {_escape(li.get('unit'))}", st["num"]),
                    Paragraph(f"{float(li.get('unit_price') or 0):,.2f}", st["num"]),
                    Paragraph(f"{float(li.get('total') or 0):,.2f}", st["num"]),
                ])
                styles.append(("LINEBELOW", (0, len(rows) - 1), (-1, len(rows) - 1), 0.3, RULE))
            if len(sections) > 1:
                rows.append(["", "", "", Paragraph(f"{_escape(section.get('label'))} subtotal", st["sub"]),
                             Paragraph(_money(float(section.get("total") or 0)), st["sub"])])
        table = Table(rows, colWidths=widths, repeatRows=1)
        table.setStyle(TableStyle(styles))
        # A room starts where its head and a few lines fit
        return [CondPageBreak(1.6 * inch), *intro, Spacer(1, 4), table, Spacer(1, 16)]
