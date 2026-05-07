"""
Bathroom Estimate export service - PDF generation.
Follows the 7-Phase structure from the reference doc.
"""

import io
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

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


class BathroomExportService:
    """Generates PDF estimates for bathroom remodels."""

    def generate_pdf(
        self,
        estimate: Dict[str, Any],
        show_signature: bool = True,
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

        def _on_page(canvas, doc_ref):
            canvas.saveState()
            page_num = canvas.getPageNumber()
            canvas.setFont("Helvetica", 7.5)
            canvas.setFillColor(colors.HexColor("#4a5568"))
            canvas.drawCentredString(page_w / 2, 0.45 * inch, f"Page {page_num}")
            canvas.restoreState()

        # Colors
        brand_dark = colors.HexColor("#1a2332")
        brand_accent = colors.HexColor("#2c5282")
        text_grey = colors.HexColor("#4a5568")
        border_grey = colors.HexColor("#e2e8f0")
        section_bg = colors.HexColor("#edf2f7")

        # Styles
        styles = getSampleStyleSheet()
        company_info_style = ParagraphStyle("CompanyInfo", fontSize=8, fontName="Helvetica", textColor=text_grey, leading=12)
        doc_title_style = ParagraphStyle("DocTitle", fontSize=22, fontName="Helvetica-Bold", textColor=brand_dark, spaceAfter=2)
        section_title_style = ParagraphStyle("SectionTitle", fontSize=10, fontName="Helvetica-Bold", textColor=brand_dark, spaceBefore=14, spaceAfter=4)
        normal = ParagraphStyle("NormalCustom", fontSize=9, fontName="Helvetica", textColor=brand_dark)
        small_grey = ParagraphStyle("SmallGrey", fontSize=7.5, fontName="Helvetica", textColor=text_grey, leading=10)
        terms_style = ParagraphStyle("Terms", fontSize=8.5, fontName="Helvetica", textColor=text_grey, leading=12, spaceBefore=2)

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
            f"<b>BATHROOM REMODEL ESTIMATE</b><br/>"
            f"Quote #: {est_id_short}<br/>"
            f"Date: {est_date.strftime('%m/%d/%Y')}<br/>"
            f"Valid Through: {valid_until.strftime('%m/%d/%Y')}"
        )
        right_cell = Paragraph(right_text, ParagraphStyle("RightHeader", fontSize=8, fontName="Helvetica", textColor=text_grey, leading=12, alignment=2))

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

        info_data = [
            ["Property:", prop_addr, "Client:", client_name],
            ["Bathroom:", f"{designation} - {bath_fn}", "Claim #:", estimate.get("claim_number", "") or "N/A"],
        ]

        dims = ""
        if estimate.get("length_ft") and estimate.get("width_ft"):
            dims = f"{estimate['length_ft']}'x{estimate['width_ft']}' (H:{estimate.get('height_ft', 8)}')"
            sf = estimate.get("floor_sf") or (estimate["length_ft"] * estimate["width_ft"])
            dims += f" — {sf:.0f} SF"
        info_data.append(["Dimensions:", dims, "State:", estimate.get("state", "") or ""])

        info_table = Table(info_data, colWidths=[usable_w * 0.12, usable_w * 0.38, usable_w * 0.12, usable_w * 0.38])
        info_table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
            ("TEXTCOLOR", (0, 0), (-1, -1), brand_dark),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
        ]))
        elements.append(info_table)
        elements.append(Spacer(1, 10))

        # ══════ OVERVIEW NOTE ══════
        overview = estimate.get("overview_text")
        if overview:
            elements.append(Paragraph("Project Overview", section_title_style))
            elements.append(Paragraph(overview, ParagraphStyle("Overview", fontSize=8.5, fontName="Helvetica", textColor=text_grey, leading=13, spaceBefore=2)))
            elements.append(Spacer(1, 8))

        # ══════ PHASE SUMMARY ══════
        line_items = estimate.get("line_items", [])
        sections = _group_line_items_by_phase(line_items)

        elements.append(Paragraph("Estimate Summary", section_title_style))

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

        col_widths = [usable_w * 0.08, usable_w * 0.72, usable_w * 0.20]
        summary_table = Table(summary_data, colWidths=col_widths)

        table_style = [
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
            ("TEXTCOLOR", (0, 0), (-1, -1), brand_dark),
            ("BACKGROUND", (0, 0), (-1, 0), section_bg),
            ("LINEBELOW", (0, 0), (-1, 0), 1, border_grey),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("ALIGN", (2, 0), (2, -1), "RIGHT"),
            ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ]

        # Bold subtotal and total rows
        num_phases = len(sections)
        subtotal_row = num_phases + 1
        total_row = len(summary_data) - 1
        table_style.append(("FONTNAME", (1, subtotal_row), (-1, subtotal_row), "Helvetica-Bold"))
        table_style.append(("LINEABOVE", (1, subtotal_row), (-1, subtotal_row), 1, border_grey))
        table_style.append(("FONTNAME", (1, total_row), (-1, total_row), "Helvetica-Bold"))
        table_style.append(("FONTSIZE", (1, total_row), (-1, total_row), 10))
        table_style.append(("LINEABOVE", (1, total_row), (-1, total_row), 1.5, brand_accent))
        table_style.append(("BACKGROUND", (0, total_row), (-1, total_row), colors.HexColor("#ebf8ff")))

        summary_table.setStyle(TableStyle(table_style))
        elements.append(summary_table)
        elements.append(Spacer(1, 16))

        # ══════ DETAILED LINE ITEMS ══════
        elements.append(Paragraph("Detailed Line Items", section_title_style))

        for sec in sections:
            # Section header
            elements.append(Paragraph(sec["title"], ParagraphStyle(
                "PhaseTitle", fontSize=9, fontName="Helvetica-Bold",
                textColor=brand_accent, spaceBefore=10, spaceAfter=4,
            )))

            detail_data = [["Description", "Qty", "Unit", "Rate", "Total"]]
            for li in sec["items"]:
                detail_data.append([
                    Paragraph(li.get("description", ""), ParagraphStyle("LiDesc", fontSize=8, fontName="Helvetica", textColor=brand_dark)),
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
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("TEXTCOLOR", (0, 0), (-1, -1), brand_dark),
                ("BACKGROUND", (0, 0), (-1, 0), section_bg),
                ("LINEBELOW", (0, 0), (-1, 0), 0.5, border_grey),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
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
        warnings = estimate.get("warning_flags") or []
        if warnings:
            elements.append(Paragraph("Important Notes", section_title_style))
            for w in warnings:
                elements.append(Paragraph(f"• {w}", terms_style))
            elements.append(Spacer(1, 8))

        # ══════ EXCLUSIONS ══════
        elements.append(Paragraph("Exclusions", section_title_style))
        exclusions = [
            "Structural changes or wall relocation",
            "HVAC modifications",
            "Window or door replacement",
            "Mold remediation (if suspected, separate estimate required)",
            "Asbestos testing or abatement",
            "Customer-supplied materials (unless noted)",
            "Any unforeseen conditions discovered during demolition (change order)",
        ]
        for ex in exclusions:
            elements.append(Paragraph(f"• {ex}", terms_style))
        elements.append(Spacer(1, 8))

        # ══════ PAYMENT SCHEDULE ══════
        elements.append(Paragraph("Payment Schedule", section_title_style))
        payments = [
            "30% — Upon contract signing",
            "30% — After demolition and rough trades complete",
            "30% — After tile and fixtures installed",
            "10% — Upon final punch list completion",
        ]
        for p in payments:
            elements.append(Paragraph(f"• {p}", terms_style))
        elements.append(Spacer(1, 16))

        # ══════ SIGNATURE ══════
        if show_signature:
            elements.append(HRFlowable(width="100%", thickness=0.5, color=border_grey))
            elements.append(Spacer(1, 20))

            sig_data = [
                ["Contractor Signature:", "_" * 35, "Date:", "_" * 15],
                ["", "", "", ""],
                ["Client Signature:", "_" * 35, "Date:", "_" * 15],
            ]
            sig_table = Table(sig_data, colWidths=[usable_w * 0.18, usable_w * 0.35, usable_w * 0.08, usable_w * 0.39])
            sig_table.setStyle(TableStyle([
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("TEXTCOLOR", (0, 0), (-1, -1), brand_dark),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
            ]))
            elements.append(sig_table)

        # ══════ BUILD ══════
        doc.build(elements, onFirstPage=_on_page, onLaterPages=_on_page)
        buffer.seek(0)
        return buffer
