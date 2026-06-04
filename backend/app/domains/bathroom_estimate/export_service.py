"""
Bathroom Estimate export service - PDF generation.
Follows the 7-Phase structure from the reference doc.
"""

import io
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class _NumberedCanvas:
    """Mixin-style canvas that tracks total page count.

    Usage: pass the *class* returned by make_numbered_canvas()
    as the ``canvasmaker`` arg to doc.build().
    """

    @staticmethod
    def make(on_first, on_later, page_w, margin):
        """Return a Canvas subclass wired to the callbacks."""
        from reportlab.pdfgen.canvas import Canvas

        class NC(Canvas):
            _first_cb = on_first
            _later_cb = on_later
            _pw = page_w
            _mg = margin

            def __init__(self, *args, **kwargs):
                Canvas.__init__(self, *args, **kwargs)
                self._saved_pages = []

            def showPage(self):
                self._saved_pages.append(dict(self.__dict__))
                self._startPage()  # reset for next page without committing current

            def save(self):
                total = len(self._saved_pages)
                for idx, state in enumerate(self._saved_pages):
                    self.__dict__.update(state)
                    self._draw_footer(idx + 1, total)
                    Canvas.showPage(self)
                Canvas.save(self)

            def _draw_footer(self, pg, total):
                from reportlab.lib import colors as c
                self.saveState()
                self.setFont("Helvetica", 7.5)
                self.setFillColor(c.HexColor("#4a5568"))
                self.drawCentredString(
                    self._pw / 2, 0.4 * 72,
                    f"Page {pg} / {total}",
                )
                self.restoreState()

        return NC

# Phase labels for grouping line items
PHASE_LABELS = {
    1: "Demo & Disposal",
    2: "Rough Trades (Plumbing & Electrical)",
    3: "Substrate & Waterproofing",
    4: "Tile & Flooring",
    5: "Fixtures Install",
    6: "Finish (Paint & Trim)",
    7: "Punch / Cleanup / Accessories",
}


def _group_line_items_by_phase(line_items: List[Dict]) -> List[Dict]:
    """Group line items by phase number."""
    sections = []
    for phase_num in sorted(PHASE_LABELS.keys()):
        items = [li for li in line_items if li.get("phase") == phase_num]
        if items:
            total = sum(li.get("total", 0) for li in items)
            sections.append({
                "phase": phase_num,
                "title": f"Phase {phase_num}: {PHASE_LABELS[phase_num]}",
                "items": items,
                "total": total,
            })
    return sections


def _filter_notes_prices(notes: Optional[str], show_prices: bool) -> Optional[str]:
    """Filter dollar amounts from notes if show_prices is False.

    Keeps area/dimension info (SF, LF, IN, %, waste) but removes $xxx.xx amounts.
    """
    import re
    if not notes or show_prices:
        return notes
    # Remove standalone dollar amounts like "$700.00" or "$1,234.56"
    filtered = re.sub(r'\s*\$[\d,]+\.?\d*', '', notes)
    # Clean up leftover artifacts: empty labels like "Cabinet: " or double separators
    filtered = re.sub(r':\s*(?=\||$)', '', filtered)
    filtered = re.sub(r'\|\s*\|', '|', filtered)
    filtered = re.sub(r'^\s*\|\s*', '', filtered)
    filtered = re.sub(r'\s*\|\s*$', '', filtered)
    filtered = re.sub(r'\s{2,}', ' ', filtered)
    return filtered.strip() or None


class BathroomExportService:
    """Generates PDF estimates for bathroom remodels."""

    def generate_pdf(
        self,
        estimate: Dict[str, Any],
        show_signature: bool = True,
        sketch_image_base64: Optional[str] = None,
        show_breakdown_prices: bool = True,
    ) -> io.BytesIO:
        """Generate a professional PDF estimate."""
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import inch
        from reportlab.platypus import (
            HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
        )

        buffer = io.BytesIO()
        page_w, page_h = letter
        margin = 0.6 * inch

        doc = SimpleDocTemplate(
            buffer, pagesize=letter,
            rightMargin=margin, leftMargin=margin,
            topMargin=margin, bottomMargin=0.8 * inch,
        )

        usable_w = page_w - 2 * margin
        est_id_short = str(estimate.get("id", ""))[:8].upper()
        prop_addr = estimate.get("property_address", "") or ""

        def _on_later_pages(canvas, doc_ref):
            """Header on pages 2+ (footer handled by NumberedCanvas)."""
            canvas.saveState()
            grey = colors.HexColor("#4a5568")
            canvas.setFont("Helvetica", 7.5)
            canvas.setFillColor(grey)
            canvas.drawString(
                margin, page_h - 0.4 * inch,
                f"Quote #: {est_id_short}"
            )
            canvas.drawRightString(
                page_w - margin, page_h - 0.4 * inch,
                prop_addr[:60]
            )
            canvas.setStrokeColor(colors.HexColor("#e2e8f0"))
            canvas.line(
                margin, page_h - 0.48 * inch,
                page_w - margin, page_h - 0.48 * inch
            )
            canvas.restoreState()

        def _on_first_page(canvas, doc_ref):
            """No header on page 1 (footer handled by NumberedCanvas)."""
            pass

        # Colors
        brand_dark = colors.HexColor("#1a2332")
        brand_accent = colors.HexColor("#2c5282")
        text_grey = colors.HexColor("#4a5568")
        border_grey = colors.HexColor("#e2e8f0")
        section_bg = colors.HexColor("#edf2f7")

        # Styles
        styles = getSampleStyleSheet()
        company_info_style = ParagraphStyle("CompanyInfo", fontSize=9, fontName="Helvetica", textColor=text_grey, leading=13)
        doc_title_style = ParagraphStyle("DocTitle", fontSize=22, fontName="Helvetica-Bold", textColor=brand_dark, spaceAfter=2)
        section_title_style = ParagraphStyle("SectionTitle", fontSize=11, fontName="Helvetica-Bold", textColor=brand_dark, spaceBefore=14, spaceAfter=10)
        normal = ParagraphStyle("NormalCustom", fontSize=10, fontName="Helvetica", textColor=brand_dark)
        small_grey = ParagraphStyle("SmallGrey", fontSize=8, fontName="Helvetica", textColor=text_grey, leading=11)
        terms_style = ParagraphStyle("Terms", fontSize=9, fontName="Helvetica", textColor=text_grey, leading=13, spaceBefore=2)

        elements = []

        # ══════ HEADER ══════
        company = estimate.get("company_info") or {}
        company_parts = []
        if company.get("name"):
            company_parts.append(f"<b>{company['name']}</b>")
        if company.get("address"):
            addr = company["address"]
            city_state = ", ".join(filter(None, [company.get("city"), company.get("state"), company.get("zipcode")]))
            if city_state:
                addr += f", {city_state}"
            company_parts.append(addr)
        contact = []
        if company.get("phone"):
            contact.append(company["phone"])
        if company.get("email"):
            contact.append(company["email"])
        if contact:
            company_parts.append(" | ".join(contact))
        if company.get("license_number"):
            company_parts.append(f"License #: {company['license_number']}")

        company_cell = Paragraph("<br/>".join(company_parts), company_info_style) if company_parts else Spacer(1, 1)

        est_date = datetime.now()
        valid_until = est_date + timedelta(days=30)
        right_text = (
            f"<b>ESTIMATE</b><br/>"
            f"Quote #: {est_id_short}<br/>"
            f"Date: {est_date.strftime('%m/%d/%Y')}<br/>"
            f"Valid Through: {valid_until.strftime('%m/%d/%Y')}"
        )
        right_cell = Paragraph(right_text, ParagraphStyle("RightHeader", fontSize=9, fontName="Helvetica", textColor=text_grey, leading=13, alignment=2))

        header_table = Table([[company_cell, right_cell]], colWidths=[usable_w * 0.55, usable_w * 0.45])
        header_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ]))
        elements.append(header_table)
        elements.append(Spacer(1, 12))
        elements.append(HRFlowable(width="100%", thickness=1.5, color=brand_accent))
        elements.append(Spacer(1, 12))

        # ══════ PROJECT INFO ══════
        designation = (estimate.get("designation") or "").replace("_", " ").title()
        bath_fn = (estimate.get("bath_function") or "").replace("_", " ").title()
        client_name = estimate.get("client_name", "") or ""

        # Full address: street, city, state zip
        full_addr_parts = [prop_addr]
        city_state_zip = ", ".join(filter(None, [
            estimate.get("city", ""),
            estimate.get("state", ""),
        ]))
        if estimate.get("zip_code"):
            city_state_zip += f" {estimate['zip_code']}" if city_state_zip else estimate['zip_code']
        if city_state_zip:
            full_addr_parts.append(city_state_zip)
        full_address = ", ".join(filter(None, full_addr_parts))

        # Use full-width rows for long values, 2-col for short pairs
        info_data = []

        # Property address (full width)
        info_data.append(["Property:", full_address])

        # Client (full width, skip if empty)
        if client_name:
            info_data.append(["Client:", client_name])

        # Bathroom type
        bath_desc = " - ".join(filter(None, [designation, bath_fn]))
        if bath_desc:
            info_data.append(["Bathroom:", bath_desc])

        # Claim # (only if present)
        claim_number = estimate.get("claim_number", "") or ""
        if claim_number:
            info_data.append(["Claim #:", claim_number])

        # Size: floor SF + ceiling height
        height_ft = estimate.get("height_ft", 8) or 8
        floor_sf = estimate.get("floor_sf")
        if not floor_sf and estimate.get("length_ft") and estimate.get("width_ft"):
            floor_sf = estimate["length_ft"] * estimate["width_ft"]
        if floor_sf:
            info_data.append([
                "Size:",
                f"{floor_sf:.0f} SF  (Ceiling: {height_ft}')",
            ])

        info_table = Table(
            info_data,
            colWidths=[usable_w * 0.14, usable_w * 0.86],
        )
        info_table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9.5),
            ("TEXTCOLOR", (0, 0), (-1, -1), brand_dark),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
        ]))
        elements.append(info_table)
        elements.append(Spacer(1, 10))

        # ══════ OVERVIEW NOTE ══════
        overview = estimate.get("overview_text")
        if overview:
            elements.append(Paragraph("Project Overview", section_title_style))
            elements.append(Paragraph(overview, ParagraphStyle("Overview", fontSize=9.5, fontName="Helvetica", textColor=text_grey, leading=14, spaceBefore=2)))
            elements.append(Spacer(1, 8))

        # ══════ SKETCH + PHASE SUMMARY (side by side) ══════
        sketch_element = None

        sketch_col_w = usable_w * 0.46
        sketch_max_h = 3.2 * inch

        # Try client-captured PNG first
        if sketch_image_base64:
            try:
                import base64
                from reportlab.platypus import Image
                img_data = base64.b64decode(sketch_image_base64)
                img_stream = io.BytesIO(img_data)
                img = Image(img_stream)
                iw, ih = img.drawWidth, img.drawHeight
                # Scale to fill column, constrain by height
                s = min(sketch_col_w / iw, sketch_max_h / ih)
                img.drawWidth = iw * s
                img.drawHeight = ih * s
                img.hAlign = 'CENTER'
                sketch_element = img
            except Exception as e:
                logger.warning(f"Failed to embed sketch image in PDF: {e}")

        # Fallback: server-side rendering from sketch_data
        if not sketch_element:
            sketch_data = estimate.get("sketch_data")
            if sketch_data and (sketch_data.get("rooms") or sketch_data.get("fixtures")):
                try:
                    drawing = self._render_sketch_drawing(sketch_data, sketch_col_w, sketch_max_h)
                    if drawing:
                        sketch_element = drawing
                except Exception as e:
                    logger.warning(f"Failed to render sketch drawing: {e}")

        # Build summary table
        line_items = estimate.get("line_items", [])
        sections = _group_line_items_by_phase(line_items)

        if sketch_element:
            summary_col_w = usable_w * 0.50
        else:
            summary_col_w = usable_w

        s_col_widths = [summary_col_w * 0.10, summary_col_w * 0.64, summary_col_w * 0.26]
        summary_data = [["Phase", "Description", "Amount"]]
        for sec in sections:
            summary_data.append([
                str(sec["phase"]),
                PHASE_LABELS.get(sec["phase"], ""),
                f"${sec['total']:,.2f}",
            ])

        subtotal = estimate.get("subtotal", 0)
        summary_data.append(["", "Subtotal", f"${subtotal:,.2f}"])

        if estimate.get("include_overhead_profit"):
            oh = estimate.get("overhead_amount", 0)
            pr = estimate.get("profit_amount", 0)
            oh_pct = estimate.get("overhead_pct", 0.10)
            pr_pct = estimate.get("profit_pct", 0.10)
            summary_data.append(["", f"Overhead ({oh_pct*100:.0f}%)", f"${oh:,.2f}"])
            summary_data.append(["", f"Profit ({pr_pct*100:.0f}%)", f"${pr:,.2f}"])

        tax = estimate.get("tax_amount", 0)
        if tax > 0:
            summary_data.append(["", "Sales Tax (material)", f"${tax:,.2f}"])

        total = estimate.get("total", 0)
        summary_data.append(["", "GRAND TOTAL", f"${total:,.2f}"])

        summary_table = Table(summary_data, colWidths=s_col_widths)

        table_style = [
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9 if sketch_element else 9.5),
            ("TEXTCOLOR", (0, 0), (-1, -1), brand_dark),
            ("BACKGROUND", (0, 0), (-1, 0), section_bg),
            ("LINEBELOW", (0, 0), (-1, 0), 1, border_grey),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("ALIGN", (2, 0), (2, -1), "RIGHT"),
            ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ]

        num_phases = len(sections)
        subtotal_row = num_phases + 1
        total_row = len(summary_data) - 1
        table_style.append(("FONTNAME", (1, subtotal_row), (-1, subtotal_row), "Helvetica-Bold"))
        table_style.append(("LINEABOVE", (1, subtotal_row), (-1, subtotal_row), 1, border_grey))
        table_style.append(("FONTNAME", (1, total_row), (-1, total_row), "Helvetica-Bold"))
        table_style.append(("FONTSIZE", (1, total_row), (-1, total_row), 10.5 if sketch_element else 11))
        table_style.append(("LINEABOVE", (1, total_row), (-1, total_row), 1.5, brand_accent))
        table_style.append(("BACKGROUND", (0, total_row), (-1, total_row), colors.HexColor("#ebf8ff")))
        summary_table.setStyle(TableStyle(table_style))

        if sketch_element:
            # Side by side: Floor Plan (left) | Estimate Summary (right)
            sketch_title = Paragraph("Floor Plan", section_title_style)
            summary_title = Paragraph("Estimate Summary", section_title_style)

            # Stack title + content in each cell
            left_cell = Table([[sketch_title], [sketch_element]], colWidths=[usable_w * 0.48])
            left_cell.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (0, 0), 12),
            ]))
            right_cell = Table([[summary_title], [summary_table]], colWidths=[usable_w * 0.50])
            right_cell.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (0, 0), 12),
            ]))

            side_by_side = Table([[left_cell, right_cell]], colWidths=[usable_w * 0.48, usable_w * 0.52])
            side_by_side.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]))
            elements.append(side_by_side)
        else:
            elements.append(Paragraph("Estimate Summary", section_title_style))
            elements.append(summary_table)

        elements.append(Spacer(1, 28))

        # ══════ DETAILED LINE ITEMS ══════
        elements.append(Paragraph("Detailed Line Items", section_title_style))

        for sec in sections:
            # Section header
            elements.append(Paragraph(sec["title"], ParagraphStyle(
                "PhaseTitle", fontSize=10, fontName="Helvetica-Bold",
                textColor=brand_accent, spaceBefore=10, spaceAfter=4,
            )))

            detail_data = [["Description", "Qty", "Unit", "Rate", "Total"]]
            for li in sec["items"]:
                desc_text = li.get("description", "")
                notes_text = _filter_notes_prices(
                    li.get("notes", ""), show_breakdown_prices)
                if notes_text:
                    desc_text += (
                        f'<br/><font size="7" color="#666666">'
                        f'{notes_text}</font>'
                    )
                detail_data.append([
                    Paragraph(desc_text, ParagraphStyle(
                        "LiDesc", fontSize=10,
                        fontName="Helvetica",
                        textColor=brand_dark)),
                    f"{li.get('quantity', 0):.1f}",
                    li.get("unit", ""),
                    f"${li.get('unit_price', 0):,.2f}",
                    f"${li.get('total', 0):,.2f}",
                ])

            # Section subtotal
            detail_data.append(["", "", "", "Subtotal:", f"${sec['total']:,.2f}"])

            dcol = [usable_w * 0.45, usable_w * 0.10, usable_w * 0.10, usable_w * 0.15, usable_w * 0.20]
            detail_table = Table(detail_data, colWidths=dcol)
            detail_style = [
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("TEXTCOLOR", (0, 0), (-1, -1), brand_dark),
                ("BACKGROUND", (0, 0), (-1, 0), section_bg),
                ("LINEBELOW", (0, 0), (-1, 0), 0.5, border_grey),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                ("ALIGN", (0, 0), (0, -1), "LEFT"),
                ("FONTNAME", (3, -1), (-1, -1), "Helvetica-Bold"),
                ("LINEABOVE", (3, -1), (-1, -1), 0.5, border_grey),
            ]
            # Alternating row colors
            for i in range(1, len(detail_data) - 1):
                if i % 2 == 0:
                    detail_style.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#f7fafc")))
            detail_table.setStyle(TableStyle(detail_style))
            elements.append(detail_table)

        elements.append(Spacer(1, 16))

        # ══════ WARNINGS ══════
        # Filter out internal-only fields from client-facing PDF
        _internal_keywords = {"adjustment factor", "target total", "factor:", "multiplier:"}
        warnings = [
            w for w in (estimate.get("warning_flags") or [])
            if not any(kw in w.lower() for kw in _internal_keywords)
        ]
        if warnings:
            elements.append(Paragraph("Important Notes", section_title_style))
            for w in warnings:
                elements.append(Paragraph(f"\u2022 {w}", terms_style))
            elements.append(Spacer(1, 8))

        # ══════ EXCLUSIONS ══════
        elements.append(Paragraph("Exclusions", section_title_style))
        exclusions = [
            "Structural changes or wall relocation",
            "HVAC modifications",
            "Window or door replacement",
            "Environmental remediation (if required, separate estimate)",
            "Asbestos testing or abatement",
            "Customer-supplied materials (unless pre-approved in writing)",
        ]
        for ex in exclusions:
            elements.append(Paragraph(f"• {ex}", terms_style))
        elements.append(Spacer(1, 8))


        # ══════ WARRANTY ══════
        elements.append(Paragraph("Warranty", section_title_style))
        warranty_items = [
            "Workmanship warranty: 1 year from completion date",
            "Waterproofing (shower pan, membrane): 5 years",
            "Manufacturer warranties on fixtures and materials apply per product",
            "Warranty does not cover issues from misuse, neglect, or acts of nature",
        ]
        for w in warranty_items:
            elements.append(Paragraph(f"\u2022 {w}", terms_style))
        elements.append(Spacer(1, 8))

        # ══════ PAYMENT SCHEDULE ══════
        elements.append(Paragraph("Payment Schedule", section_title_style))
        payment_items = [
            "10% \u2014 Upon contract signing",
            "20% \u2014 Demo complete & rough trades inspected",
            "25% \u2014 Substrate & waterproofing complete",
            "25% \u2014 Tile installation complete",
            "20% \u2014 Final walkthrough & punch list complete",
        ]
        for p in payment_items:
            elements.append(Paragraph(f"\u2022 {p}", terms_style))
        elements.append(Paragraph(
            "Partial lien waiver required with each progress payment. "
            "Final lien waiver issued upon final payment.",
            ParagraphStyle("LienNote", fontSize=8, fontName="Helvetica-Oblique",
                           textColor=text_grey, leading=11, spaceBefore=4)
        ))
        elements.append(Spacer(1, 8))

        # ══════ TERMS ══════
        elements.append(Paragraph("Terms & Conditions", section_title_style))
        general_terms = [
            "This estimate is valid for 30 days from the date issued.",
            "Any changes to the scope of work after contract signing "
            "will require a written change order.",
            "Unforeseen conditions discovered during demolition "
            "(e.g., concealed conditions, plumbing/electrical "
            "code violations) will be documented with photos, "
            "presented as a written change order with itemized cost, "
            "and require Owner's written approval before work "
            "proceeds. Verbal approvals will not be honored.",
            "Work schedule is weather-permitting and subject to "
            "material availability.",
            "Customer-supplied materials must be on-site before "
            "scheduled installation date.",
            "Owner-selected materials exceeding allowances specified "
            "in this estimate will be billed at cost difference "
            "plus 15% handling.",
        ]
        for t in general_terms:
            elements.append(Paragraph(f"\u2022 {t}", terms_style))
        elements.append(Spacer(1, 8))

        # ══════ LIEN RIGHTS DISCLOSURE ══════
        est_state = estimate.get("state", "")
        if est_state in ("VA", "FL"):
            elements.append(Paragraph(
                "Lien Rights Disclosure", section_title_style))
            if est_state == "VA":
                elements.append(Paragraph(
                    "Virginia law (VA Code \u00a7 43-3 et seq.) permits "
                    "contractors and subcontractors to file a mechanic's "
                    "lien on your property for unpaid work. To protect "
                    "your property, obtain a partial lien waiver with "
                    "each progress payment and a final unconditional "
                    "lien waiver upon final payment.",
                    terms_style))
            elif est_state == "FL":
                elements.append(Paragraph(
                    "Under Florida law (FL Statute \u00a7 713), "
                    "contractors and subcontractors may claim a "
                    "construction lien on your property for unpaid work "
                    "or materials. You are entitled to receive a "
                    "Contractor's Final Payment Affidavit before making "
                    "final payment. Obtain partial lien waivers with "
                    "each progress payment and a final waiver upon "
                    "completion.",
                    terms_style))
            elements.append(Spacer(1, 8))

        elements.append(Spacer(1, 8))

        # ══════ SIGNATURE ══════
        if show_signature:
            sig_data = [
                [Paragraph("<b>Accepted By:</b>", normal), "", Paragraph("<b>Date:</b>", normal), ""],
                ["_" * 40, "", "_" * 25, ""],
                [Paragraph("Customer Signature", small_grey), "",
                 Paragraph("Date", small_grey), ""],
            ]
            sig_table = Table(sig_data, colWidths=[usable_w * 0.45, usable_w * 0.05,
                                                    usable_w * 0.30, usable_w * 0.20])
            sig_table.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]))
            elements.append(sig_table)

        # ══════ BUILD ══════
        numbered_canvas = _NumberedCanvas.make(
            _on_first_page, _on_later_pages, page_w, margin,
        )
        doc.build(
            elements,
            onFirstPage=_on_first_page,
            onLaterPages=_on_later_pages,
            canvasmaker=numbered_canvas,
        )
        buffer.seek(0)
        return buffer

    def _render_sketch_drawing(
        self, sketch_data: Dict[str, Any], max_w: float, max_h: float
    ):
        """Render sketch_data as a ReportLab Drawing (server-side fallback)."""
        from reportlab.graphics.shapes import Drawing, Line, Rect, String
        from reportlab.lib import colors

        rooms = sketch_data.get("rooms", [])
        walls = sketch_data.get("walls", [])
        fixtures = sketch_data.get("fixtures", [])
        ppf = sketch_data.get("settings", {}).get("pixelsPerFoot", 30)

        if not rooms and not walls and not fixtures:
            return None

        # Compute bounding box of all elements
        all_x, all_y = [], []
        for r in rooms:
            for pt in r.get("boundary", []):
                all_x.append(pt["x"])
                all_y.append(pt["y"])
        for w in walls:
            all_x.extend([w["start"]["x"], w["end"]["x"]])
            all_y.extend([w["start"]["y"], w["end"]["y"]])
        for f in fixtures:
            all_x.append(f["position"]["x"])
            all_y.append(f["position"]["y"])

        if not all_x:
            return None

        min_x, max_x_val = min(all_x), max(all_x)
        min_y, max_y_val = min(all_y), max(all_y)
        src_w = max(max_x_val - min_x + 20, 1)
        src_h = max(max_y_val - min_y + 20, 1)

        scale = min(max_w / src_w, max_h / src_h)
        draw_w = src_w * scale
        draw_h = src_h * scale

        d = Drawing(draw_w, draw_h)

        def tx(x):
            return (x - min_x + 10) * scale

        def ty(y):
            return draw_h - (y - min_y + 10) * scale  # flip Y

        # Draw rooms
        for r in rooms:
            pts = r.get("boundary", [])
            if len(pts) < 3:
                continue
            for i in range(len(pts)):
                p1 = pts[i]
                p2 = pts[(i + 1) % len(pts)]
                d.add(Line(tx(p1["x"]), ty(p1["y"]), tx(p2["x"]), ty(p2["y"]),
                           strokeColor=colors.HexColor("#90caf9"), strokeWidth=1))
            # Area label
            cx = sum(p["x"] for p in pts) / len(pts)
            cy = sum(p["y"] for p in pts) / len(pts)
            area = r.get("netFloorAreaSF") or r.get("floorAreaSF", 0)
            name = r.get("name", "Room")
            d.add(String(tx(cx) - 15, ty(cy), f"{name} {area}SF",
                         fontSize=7, fillColor=colors.HexColor("#333333")))

        # Draw walls
        for w in walls:
            d.add(Line(tx(w["start"]["x"]), ty(w["start"]["y"]),
                        tx(w["end"]["x"]), ty(w["end"]["y"]),
                        strokeColor=colors.HexColor("#333333"), strokeWidth=1.5))

        # Draw fixtures
        for f in fixtures:
            px = tx(f["position"]["x"])
            py = ty(f["position"]["y"])
            fw = (f.get("dimensions", {}).get("width", 24) / 12) * ppf * scale
            fh = (f.get("dimensions", {}).get("height", 24) / 12) * ppf * scale
            d.add(Rect(px - fw / 2, py - fh / 2, fw, fh,
                        strokeColor=colors.HexColor("#666666"), fillColor=None, strokeWidth=0.8))
            label = f.get("label") or f.get("type", "")
            d.add(String(px - 10, py - 3, label, fontSize=5.5,
                         fillColor=colors.HexColor("#666666")))

        return d
