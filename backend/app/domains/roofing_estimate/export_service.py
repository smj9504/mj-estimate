"""
Roofing Estimate PDF export service.
Professional estimate PDF with 8-phase structure.
"""

import io
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

PHASE_LABELS = {
    1: "Setup & Tear-off",
    2: "Decking",
    3: "Underlayment & Ice Barrier",
    4: "Drip Edge & Flashing",
    5: "Shingle Install",
    6: "Ventilation & Penetrations",
    7: "Gutter",
    8: "Cleanup & Misc",
}

# ── Brand Colors ──
COLOR_PRIMARY = "#1B3A5C"      # dark navy
COLOR_SECONDARY = "#2A6496"    # medium blue
COLOR_ACCENT = "#E8F0FE"       # light blue tint
COLOR_DARK = "#1a1a1a"
COLOR_MEDIUM = "#555555"
COLOR_LIGHT = "#888888"
COLOR_BORDER = "#D0D5DD"
COLOR_ROW_ALT = "#F8FAFC"
COLOR_TOTAL_BG = "#1B3A5C"
COLOR_PHASE_BG = "#EBF0F5"

# ── Clause Templates ──

DECKING_CLAUSE_TEMPLATE = (
    "This estimate includes an allowance of {free_sheets} sheet(s) of decking "
    "replacement at no additional charge. If damaged, rotted, or substandard "
    "decking is discovered upon tear-off beyond the included allowance, "
    "replacement will be billed at ${rate:.2f} per 4x8 sheet ({material}) "
    "installed. Customer will be notified and provided photos before any "
    "additional replacement work proceeds."
)

HIDDEN_DAMAGE_CLAUSE = (
    "This estimate does not include repair of any structural, framing, or "
    "unforeseen damage that becomes visible only after tear-off (e.g., rafter "
    "rot, sheathing delamination, animal infestation, mold, prior leak damage "
    "to insulation or interior). Such items will be quoted as a Change Order."
)

VALIDITY_CLAUSE = (
    "Estimate valid for 30 days from issue date. Material pricing subject to "
    "manufacturer adjustments after that period. Final invoice may reflect "
    "actual square footage measured upon completion (within +/-5% of estimated)."
)

DEFAULT_LABOR_WARRANTY_YEARS = 10

DEFAULT_MATERIAL_WARRANTY_TEXT = (
    "All roofing materials installed under this contract come with "
    "the manufacturer's standard Shingle Limited Warranty, which "
    "covers manufacturing defects in the shingle products "
    "themselves. Architectural shingles are typically covered for "
    "the lifetime of the original homeowner (up to 50 years) and "
    "three-tab shingles for up to 25 years. Coverage details, "
    "including any prorated periods and wind resistance terms, "
    "are governed by the manufacturer's published warranty terms "
    "that accompany the product."
)

DEFAULT_LABOR_WARRANTY_TEXT = (
    "This roofing installation is backed by our {warranty_label}, "
    "effective from the date of substantial completion. "
    '"Lifetime" coverage, where applicable, is defined as the '
    "period during which the original property owner continuously "
    "resides at and maintains ownership of the property where "
    "the work was performed, not to exceed 50 years from the "
    "date of completion. All work performed under this contract "
    "\u2014 including shingle installation, flashing integration, "
    "ventilation systems, drip edge application, and all related "
    "roofing components \u2014 has been executed by factory-trained "
    "installers in strict accordance with manufacturer "
    "installation specifications and NRCA (National Roofing "
    "Contractors Association) guidelines. Should any defect in "
    "workmanship be identified during the coverage period \u2014 "
    "including but not limited to leaks resulting from improper "
    "installation, flashing failures, inadequate sealing, nail "
    "placement errors, or ventilation deficiencies \u2014 we will "
    "conduct an on-site inspection within 5 business days of "
    "notification and complete all necessary corrective work at "
    "no additional cost to the property owner. Emergency leak "
    "situations will be addressed within 24\u201348 hours. All repair "
    "work performed under this coverage carries the same "
    "workmanship protection for the remainder of the original "
    "coverage period. This coverage is transferable to one "
    "subsequent property owner, provided written notice is "
    "submitted within 60 days of the ownership transfer. Upon "
    "transfer, the remaining coverage period shall not exceed "
    "10 years from the original completion date or the remainder "
    "of the original warranty term, whichever is shorter."
)

DEFAULT_WARRANTY_EXCLUSIONS = (
    "Excluded from all warranty coverage: damage caused by acts "
    "of God; ice damming resulting from pre-existing or "
    "inadequate attic insulation or ventilation conditions not "
    "included in the scope of this contract \u2014 however, if "
    "ventilation improvements were performed as part of this "
    "project, any ice damming directly attributable to a defect "
    "in that ventilation work shall remain covered under the "
    "workmanship warranty; damage by foot traffic or third-party "
    "modifications after completion; pre-existing structural "
    "damage; neglect or failure to perform routine maintenance; "
    "damage from unlicensed repairs; and normal wear and tear."
)


def _get_warranty_label(years: int) -> str:
    """Return tiered warranty label based on years (0 = Lifetime)."""
    if years == 0:
        return "Lifetime Workmanship Guarantee"
    if years <= 5:
        return f"{years}-Year Standard Workmanship Warranty"
    if years <= 10:
        return f"{years}-Year Extended Workmanship Protection"
    return f"{years}-Year Premium Workmanship Protection Plan"


class RoofingExportService:
    """Generate PDF estimates for roofing projects."""

    def generate_pdf(
        self, estimate: Dict[str, Any], show_signature: bool = True,
        pricing_mode: str = "detailed",
        gutter_separate: bool = False,
    ) -> io.BytesIO:
        """Generate professional PDF from estimate data.

        pricing_mode:
            "detailed" - full breakdown with unit prices and line totals
            "lumpsum"  - scope of work only (description + qty/unit), single total
        gutter_separate:
            True  - show gutter as separate section with its own subtotal
            False - include gutter within structure line items
        """
        try:
            from reportlab.lib import colors
            from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
            from reportlab.lib.pagesizes import letter
            from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
            from reportlab.lib.units import inch
            from reportlab.platypus import (
                HRFlowable,
                Paragraph,
                SimpleDocTemplate,
                Spacer,
                Table,
                TableStyle,
            )
        except ImportError:
            logger.warning("reportlab not installed, generating text fallback")
            return self._generate_text_fallback(estimate)

        buffer = io.BytesIO()
        page_w, page_h = letter
        margin = 0.5 * inch

        # ── Page header/footer for multi-page ──
        est_id = estimate.get("id", "")
        est_num = est_id[:8].upper() if est_id else ""
        address = estimate.get("property_address", "")
        location = ", ".join(filter(None, [
            estimate.get("city", ""),
            estimate.get("state", ""),
            estimate.get("zip_code", ""),
        ]))
        address_line = f"{address}, {location}" if address and location else address or location

        def _header_footer(canvas, doc):
            """Add header (pages 2+) and footer (all pages)."""
            page_num = canvas.getPageNumber()
            canvas.saveState()

            # Header right: property address (pages 2+ only)
            if page_num > 1:
                canvas.setFont("Helvetica", 8)
                canvas.setFillColor(colors.HexColor(COLOR_MEDIUM))
                if address_line:
                    canvas.drawRightString(
                        page_w - margin, page_h - margin + 8,
                        address_line,
                    )

            # Footer: page number + estimate number (all pages)
            canvas.setFont("Helvetica", 8)
            canvas.setFillColor(colors.HexColor(COLOR_LIGHT))
            canvas.drawString(
                margin, margin - 14,
                f"Estimate #{est_num}",
            )
            canvas.drawRightString(
                page_w - margin, margin - 14,
                f"Page {page_num}",
            )
            # Footer line
            canvas.setStrokeColor(colors.HexColor(COLOR_BORDER))
            canvas.setLineWidth(0.5)
            canvas.line(margin, margin - 4, page_w - margin, margin - 4)

            canvas.restoreState()

        doc = SimpleDocTemplate(
            buffer, pagesize=letter,
            topMargin=margin, bottomMargin=margin + 10,
            leftMargin=margin, rightMargin=margin,
        )
        content_w = page_w - 2 * margin
        styles = getSampleStyleSheet()
        elements: List = []

        # ────────────────────────────────────────────────
        #  Reusable styles (increased font sizes)
        # ────────────────────────────────────────────────
        s_title = ParagraphStyle(
            "S_Title", fontName="Helvetica-Bold", fontSize=22,
            textColor=colors.HexColor(COLOR_PRIMARY), leading=26,
            spaceAfter=4,
        )
        s_subtitle = ParagraphStyle(
            "S_Subtitle", fontName="Helvetica", fontSize=10,
            textColor=colors.HexColor(COLOR_LIGHT), spaceBefore=4,
            spaceAfter=0,
        )
        s_company = ParagraphStyle(
            "S_Company", fontName="Helvetica-Bold", fontSize=9,
            textColor=colors.HexColor(COLOR_PRIMARY), alignment=TA_RIGHT,
            spaceAfter=4,
        )
        s_company_detail = ParagraphStyle(
            "S_CompanyDetail", fontName="Helvetica", fontSize=9,
            textColor=colors.HexColor(COLOR_MEDIUM), alignment=TA_RIGHT,
            leading=12,
        )
        s_section = ParagraphStyle(
            "S_Section", fontName="Helvetica-Bold", fontSize=12,
            textColor=colors.HexColor(COLOR_PRIMARY), spaceBefore=12,
            spaceAfter=6, borderPadding=(0, 0, 2, 0),
        )
        s_label = ParagraphStyle(
            "S_Label", fontName="Helvetica-Bold", fontSize=9,
            textColor=colors.HexColor(COLOR_MEDIUM),
        )
        s_value = ParagraphStyle(
            "S_Value", fontName="Helvetica", fontSize=9,
            textColor=colors.HexColor(COLOR_DARK),
        )
        s_clause_title = ParagraphStyle(
            "S_ClauseTitle", fontName="Helvetica-Bold", fontSize=9,
            textColor=colors.HexColor(COLOR_PRIMARY), spaceBefore=6,
            spaceAfter=2,
        )
        s_clause = ParagraphStyle(
            "S_Clause", fontName="Helvetica", fontSize=8.5,
            textColor=colors.HexColor(COLOR_MEDIUM), leading=11,
            spaceAfter=4,
        )

        # ────────────────────────────────────────────────
        #  HEADER: Title left + Company info right
        # ────────────────────────────────────────────────
        company = estimate.get("company_info") or {}
        company_name = company.get("name", "")

        # Left side: title block
        title_block = []
        title_block.append(Paragraph("ROOFING ESTIMATE", s_title))
        title_block.append(Paragraph(
            f"Estimate #{est_num}  |  {datetime.now().strftime('%B %d, %Y')}",
            s_subtitle,
        ))

        # Right side: company block
        company_lines = []
        if company_name:
            company_lines.append(Paragraph(company_name, s_company))
            addr_parts = filter(None, [
                company.get("address", ""),
                ", ".join(filter(None, [
                    company.get("city", ""),
                    company.get("state", ""),
                    company.get("zipcode", ""),
                ])),
            ])
            for part in addr_parts:
                company_lines.append(Paragraph(part, s_company_detail))
            contact = " | ".join(filter(None, [
                company.get("phone", ""), company.get("email", ""),
            ]))
            if contact:
                company_lines.append(Paragraph(contact, s_company_detail))

        right_cell = company_lines if company_lines else [Paragraph("", s_company)]

        header_table = Table(
            [[title_block, right_cell]],
            colWidths=[content_w * 0.55, content_w * 0.45],
        )
        header_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ALIGN", (1, 0), (1, 0), "RIGHT"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ]))
        elements.append(header_table)

        # Accent line
        elements.append(Spacer(1, 8))
        elements.append(HRFlowable(
            width="100%", thickness=3,
            color=colors.HexColor(COLOR_PRIMARY),
        ))
        elements.append(Spacer(1, 10))

        # ────────────────────────────────────────────────
        #  PROJECT INFO: full-width 2-column layout
        # ────────────────────────────────────────────────
        elements.append(Paragraph("PROJECT INFORMATION", s_section))

        def _info_pair(label: str, value: str):
            return [
                Paragraph(label, s_label),
                Paragraph(value or "\u2014", s_value),
            ]

        client_name = estimate.get("client_name", "")
        claim_number = estimate.get("claim_number", "")
        full_address = ", ".join(filter(None, [
            estimate.get("property_address", ""),
            estimate.get("city", ""),
            estimate.get("state", ""),
            estimate.get("zip_code", ""),
        ])) or "N/A"
        building = (
            f"{(estimate.get('building_type') or 'SFH').upper()} - "
            f"{estimate.get('stories', 1)} Story"
        )
        roof_area = (
            f"{estimate.get('total_sf', 0):,.0f} SF "
            f"({estimate.get('squares', 0):.1f} squares)"
        )
        pitch_display = self._build_pitch_display(estimate)
        complexity = (estimate.get("roof_complexity") or "").replace("_", " ").title()

        left_col = [
            _info_pair("Client", client_name),
            _info_pair("Property", full_address),
            _info_pair("Building Type", building),
        ]
        right_col = [
            _info_pair("Roof Area", roof_area),
            _info_pair("Pitch", pitch_display),
            _info_pair("Complexity", complexity),
        ]

        if claim_number:
            left_col.insert(1, _info_pair("Claim #", claim_number))

        # Insurance info if applicable
        if estimate.get("insurance_job"):
            ins = estimate.get("insurance_info") or {}
            left_col.append(_info_pair("Insurance", ins.get("carrier", "Yes")))
            right_col.append(_info_pair("Deductible",
                f"${ins.get('deductible', 0):,.2f}" if ins.get("deductible") else "\u2014"))

        info_rows = []
        for i in range(max(len(left_col), len(right_col))):
            l = left_col[i] if i < len(left_col) else ["", ""]
            r = right_col[i] if i < len(right_col) else ["", ""]
            info_rows.append(l + r)

        # Full-width table with minimal internal padding
        label_w = content_w * 0.13
        value_w = content_w * 0.37
        info_table = Table(
            info_rows,
            colWidths=[label_w, value_w, label_w, value_w],
        )
        info_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("LINEBELOW", (0, 0), (-1, -2), 0.3,
             colors.HexColor(COLOR_BORDER)),
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FAFBFC")),
        ]))
        elements.append(info_table)
        elements.append(Spacer(1, 10))

        # ────────────────────────────────────────────────
        #  SCOPE SUMMARY
        # ────────────────────────────────────────────────
        shingle = estimate.get("shingle_spec") or {}
        underlay = estimate.get("underlayment_spec") or {}

        shingle_desc = " ".join(filter(None, [
            (shingle.get("brand") or "").replace("_", " ").title(),
            shingle.get("product", ""),
            f"({(shingle.get('type') or '').replace('_', ' ').title()})",
        ])).strip()
        underlay_desc = (underlay.get("type") or "synthetic").replace("_", " ").title()

        scope_items = [
            _info_pair("Shingle", shingle_desc or "\u2014"),
            _info_pair("Underlayment", underlay_desc),
        ]
        if shingle.get("color"):
            scope_items.append(_info_pair("Color", shingle["color"]))

        elements.append(Paragraph("SCOPE SUMMARY", s_section))
        scope_rows = []
        for i in range(0, len(scope_items), 2):
            row = scope_items[i]
            if i + 1 < len(scope_items):
                row = row + scope_items[i + 1]
            else:
                row = row + ["", ""]
            scope_rows.append(row)

        scope_table = Table(
            scope_rows,
            colWidths=[label_w, value_w, label_w, value_w],
        )
        scope_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ]))
        elements.append(scope_table)
        elements.append(Spacer(1, 10))

        # ────────────────────────────────────────────────
        #  LINE ITEMS TABLE (supports multi-structure)
        # ────────────────────────────────────────────────
        is_lumpsum = pricing_mode == "lumpsum"
        line_items = estimate.get("line_items", [])
        struct_results = (
            estimate.get("structure_results") or []
        )

        # Detect multi-structure from line items
        struct_indices = sorted(set(
            li.get("structure_index", 0)
            for li in line_items
        ))
        is_multi = len(struct_indices) > 1

        if line_items:
            section_title = (
                "SCOPE OF WORK" if is_lumpsum
                else "DETAILED ESTIMATE"
            )
            elements.append(
                Paragraph(section_title, s_section))

            if is_multi:
                # Build info per structure
                ev_structs = (
                    estimate.get("eagleview_data", {})
                    or {}
                ).get("structures", [])

                for s_idx in struct_indices:
                    s_items = [
                        li for li in line_items
                        if li.get("structure_index", 0)
                        == s_idx
                    ]
                    if not s_items:
                        continue

                    # Get label/info from results or EV
                    sr = next(
                        (r for r in struct_results
                         if r.get("structure_index") == s_idx),
                        None,
                    )
                    ev = next(
                        (e for e in ev_structs
                         if e.get("index") == s_idx),
                        None,
                    )

                    s_label = (
                        (sr or {}).get("label")
                        or (ev or {}).get("label")
                        or f"Structure #{s_idx + 1}"
                    )
                    s_sf = (
                        (sr or {}).get("total_sf")
                        or (ev or {}).get("total_sf", 0)
                    )
                    s_pitch = (
                        (sr or {}).get("predominant_pitch")
                        or (ev or {}).get(
                            "predominant_pitch", "")
                    )
                    s_sub = sum(
                        i.get("total", 0)
                        for i in s_items
                    )

                    # Structure header
                    s_info = f"{s_sf:,.0f} SF"
                    if s_pitch:
                        s_info += f" | {s_pitch}"
                    s_info += (
                        f" | Subtotal:"
                        f" ${s_sub:,.2f}"
                    )
                    elements.append(Paragraph(
                        f"<b>{s_label}</b>"
                        f"&nbsp;&nbsp;"
                        f"<font size=8"
                        f" color='{COLOR_MEDIUM}'>"
                        f"{s_info}</font>",
                        ParagraphStyle(
                            "StructH",
                            fontName="Helvetica-Bold",
                            fontSize=10,
                            textColor=colors.HexColor(
                                COLOR_SECONDARY),
                            spaceBefore=8,
                            spaceAfter=4,
                        ),
                    ))

                    display_items = (
                        [i for i in s_items if i.get("phase") != 7]
                        if gutter_separate else s_items
                    )
                    self._build_line_table(
                        elements, display_items,
                        content_w, is_lumpsum,
                        colors, TA_RIGHT,
                        TA_CENTER,
                    )

                    # Per-structure waste note
                    s_sq = (sr or {}).get(
                        "squares",
                        s_sf / 100 if s_sf else 0,
                    )
                    s_complexity = (
                        (ev or {}).get("complexity", "hip")
                    )
                    from .pricing import get_waste_factor
                    s_waste = get_waste_factor(s_complexity)
                    s_sq_w = round(s_sq * (1 + s_waste), 1)
                    self._add_waste_note(
                        elements, colors, s_waste,
                        s_sq, s_sq_w,
                    )

            else:
                # Single structure: flat table
                display_items = (
                    [i for i in line_items if i.get("phase") != 7]
                    if gutter_separate else line_items
                )
                self._build_line_table(
                    elements, display_items,
                    content_w, is_lumpsum,
                    colors, TA_RIGHT,
                    TA_CENTER,
                )

                # Waste note
                w_pct = estimate.get("waste_factor", 0.12)
                w_sq = estimate.get("squares", 0)
                w_sq_w = round(w_sq * (1 + w_pct), 1)
                self._add_waste_note(
                    elements, colors, w_pct,
                    w_sq, w_sq_w,
                )

        # ────────────────────────────────────────────────
        #  GUTTER (separate section when gutter_separate)
        # ────────────────────────────────────────────────
        if gutter_separate and line_items:
            gutter_items = [
                i for i in line_items if i.get("phase") == 7
            ]
            if gutter_items:
                elements.append(Spacer(1, 10))
                elements.append(Paragraph(
                    "GUTTER (OPTIONAL)",
                    s_section,
                ))
                self._build_line_table(
                    elements, gutter_items,
                    content_w, is_lumpsum,
                    colors, TA_RIGHT,
                    TA_CENTER,
                )

        # ────────────────────────────────────────────────
        #  TOTALS SUMMARY BOX
        # ────────────────────────────────────────────────
        elements.append(Spacer(1, 8))

        s_tot_label = ParagraphStyle(
            "TotL", fontName="Helvetica", fontSize=10,
            textColor=colors.HexColor(COLOR_DARK),
        )
        s_tot_value = ParagraphStyle(
            "TotV", fontName="Helvetica", fontSize=10,
            textColor=colors.HexColor(COLOR_DARK), alignment=TA_RIGHT,
        )
        s_grand_label = ParagraphStyle(
            "GrandL", fontName="Helvetica-Bold", fontSize=12,
            textColor=colors.white,
        )
        s_grand_value = ParagraphStyle(
            "GrandV", fontName="Helvetica-Bold", fontSize=12,
            textColor=colors.white, alignment=TA_RIGHT,
        )

        totals_rows = []
        if not is_lumpsum:
            gutter_sub = estimate.get("gutter_subtotal", 0) or 0
            roofing_sub = estimate.get("roofing_subtotal", 0) or estimate.get("subtotal", 0)
            if gutter_sub > 0:
                totals_rows.append([
                    Paragraph("Roofing Subtotal", s_tot_label),
                    Paragraph(f"${roofing_sub:,.2f}", s_tot_value),
                ])
                totals_rows.append([
                    Paragraph("Gutter Subtotal", s_tot_label),
                    Paragraph(f"${gutter_sub:,.2f}", s_tot_value),
                ])
            else:
                totals_rows.append([
                    Paragraph("Subtotal", s_tot_label),
                    Paragraph(f"${estimate.get('subtotal', 0):,.2f}", s_tot_value),
                ])
            # Markup is included in unit prices — not shown separately
            if estimate.get("include_overhead_profit"):
                totals_rows.append([
                    Paragraph("Overhead", s_tot_label),
                    Paragraph(f"${estimate.get('overhead_amount', 0):,.2f}",
                              s_tot_value),
                ])
                totals_rows.append([
                    Paragraph("Profit", s_tot_label),
                    Paragraph(f"${estimate.get('profit_amount', 0):,.2f}",
                              s_tot_value),
                ])
            totals_rows.append([
                Paragraph("Sales Tax", s_tot_label),
                Paragraph(f"${estimate.get('tax_amount', 0):,.2f}",
                          s_tot_value),
            ])
            if estimate.get("permit_fee", 0) > 0:
                totals_rows.append([
                    Paragraph("Permit Fee", s_tot_label),
                    Paragraph(f"${estimate.get('permit_fee', 0):,.2f}",
                              s_tot_value),
                ])

        # Grand total row (dark bg)
        totals_rows.append([
            Paragraph("TOTAL", s_grand_label),
            Paragraph(f"${estimate.get('total', 0):,.2f}", s_grand_value),
        ])

        # Right-align the totals box
        totals_box_w = content_w * 0.42
        totals_table = Table(
            totals_rows,
            colWidths=[totals_box_w * 0.5, totals_box_w * 0.5],
        )
        last_row = len(totals_rows) - 1
        totals_table.setStyle(TableStyle([
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("LINEBELOW", (0, 0), (-1, last_row - 1), 0.3,
             colors.HexColor(COLOR_BORDER)),
            # Grand total row
            ("BACKGROUND", (0, last_row), (-1, last_row),
             colors.HexColor(COLOR_TOTAL_BG)),
            ("TOPPADDING", (0, last_row), (-1, last_row), 7),
            ("BOTTOMPADDING", (0, last_row), (-1, last_row), 7),
            # Border around totals
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor(COLOR_BORDER)),
        ]))

        # Wrap in outer table to right-align
        outer = Table(
            [[None, totals_table]],
            colWidths=[content_w - totals_box_w, totals_box_w],
        )
        outer.setStyle(TableStyle([
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ]))
        elements.append(outer)

        # ────────────────────────────────────────────────
        #  ADD-ON QUOTES (skylight replacement, etc.)
        # ────────────────────────────────────────────────
        add_ons = estimate.get("add_ons") or []
        if add_ons:
            elements.append(Spacer(1, 12))
            elements.append(Paragraph(
                "ADDITIONAL QUOTES (not included in estimate total)",
                ParagraphStyle(
                    "AOHead", fontName="Helvetica-Bold",
                    fontSize=10,
                    textColor=colors.HexColor(COLOR_SECONDARY),
                    spaceAfter=4,
                ),
            ))

            ao_header = [[
                Paragraph("<b>Description</b>", ParagraphStyle(
                    "AOH", fontName="Helvetica-Bold", fontSize=8.5,
                    textColor=colors.white)),
                Paragraph("<b>Qty</b>", ParagraphStyle(
                    "AOHR", fontName="Helvetica-Bold", fontSize=8.5,
                    textColor=colors.white, alignment=TA_RIGHT)),
                Paragraph("<b>Unit Price</b>", ParagraphStyle(
                    "AOHP", fontName="Helvetica-Bold", fontSize=8.5,
                    textColor=colors.white, alignment=TA_RIGHT)),
                Paragraph("<b>Total</b>", ParagraphStyle(
                    "AOHT", fontName="Helvetica-Bold", fontSize=8.5,
                    textColor=colors.white, alignment=TA_RIGHT)),
            ]]
            ao_data = list(ao_header)
            ao_td = ParagraphStyle(
                "AOD", fontName="Helvetica", fontSize=8.5,
                textColor=colors.HexColor(COLOR_DARK))
            ao_tdr = ParagraphStyle(
                "AODR", fontName="Helvetica", fontSize=8.5,
                textColor=colors.HexColor(COLOR_DARK),
                alignment=TA_RIGHT)
            for ao in add_ons:
                ao_data.append([
                    Paragraph(ao.get("description", ""), ao_td),
                    Paragraph(str(ao.get("quantity", 1)), ao_tdr),
                    Paragraph(f"${ao.get('unit_price', 0):,.2f}", ao_tdr),
                    Paragraph(f"${ao.get('total', 0):,.2f}", ao_tdr),
                ])

            ao_cw = [content_w * 0.50, content_w * 0.10,
                      content_w * 0.20, content_w * 0.20]
            ao_tbl = Table(ao_data, colWidths=ao_cw)
            ao_tbl.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0),
                 colors.HexColor(COLOR_SECONDARY)),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("LINEBELOW", (0, 0), (-1, -1), 0.3,
                 colors.HexColor(COLOR_BORDER)),
                ("BOX", (0, 0), (-1, -1), 0.5,
                 colors.HexColor(COLOR_BORDER)),
            ]))
            elements.append(ao_tbl)

        # ────────────────────────────────────────────────
        #  NOTES (if any)
        # ────────────────────────────────────────────────
        est_notes = (estimate.get("notes") or "").strip()
        if est_notes:
            elements.append(Spacer(1, 10))
            elements.append(Paragraph("NOTES", s_section))
            for line in est_notes.split("\n"):
                line = line.strip()
                if line:
                    elements.append(Paragraph(
                        f"\u2022 {line}",
                        ParagraphStyle(
                            "NoteItem", fontName="Helvetica",
                            fontSize=9,
                            textColor=colors.HexColor(COLOR_DARK),
                            leading=12, leftIndent=10,
                        ),
                    ))

        # ────────────────────────────────────────────────
        #  TERMS & CONDITIONS + WARRANTY
        # ────────────────────────────────────────────────
        elements.append(Spacer(1, 14))
        elements.append(HRFlowable(
            width="100%", thickness=0.5,
            color=colors.HexColor(COLOR_BORDER),
        ))
        elements.append(Spacer(1, 6))

        elements.append(Paragraph("TERMS & CONDITIONS", ParagraphStyle(
            "TCHead", fontName="Helvetica-Bold", fontSize=11,
            textColor=colors.HexColor(COLOR_PRIMARY), spaceAfter=4,
        )))

        # Decking clause
        decking_spec = estimate.get("decking_spec") or {}
        deck_material = (
            decking_spec.get("material", "OSB 7/16")
            .replace("_", " ").upper()
        )
        deck_rate = decking_spec.get("rate_per_sheet", 90.0)
        deck_free = decking_spec.get("free_sheets_included", 2)

        elements.append(Paragraph("Decking Replacement", s_clause_title))
        elements.append(Paragraph(
            DECKING_CLAUSE_TEMPLATE.format(
                free_sheets=deck_free, rate=deck_rate, material=deck_material,
            ),
            s_clause,
        ))

        elements.append(Paragraph("Hidden Damage", s_clause_title))
        elements.append(Paragraph(HIDDEN_DAMAGE_CLAUSE, s_clause))

        elements.append(Paragraph("Estimate Validity", s_clause_title))
        elements.append(Paragraph(VALIDITY_CLAUSE, s_clause))

        # ── WARRANTY ──
        elements.append(Spacer(1, 16))
        elements.append(HRFlowable(
            width="100%", thickness=0.5,
            color=colors.HexColor(COLOR_BORDER),
        ))
        elements.append(Spacer(1, 6))
        elements.append(Paragraph("WARRANTY", ParagraphStyle(
            "WHead", fontName="Helvetica-Bold", fontSize=11,
            textColor=colors.HexColor(COLOR_PRIMARY), spaceAfter=4,
        )))

        warranty_info = estimate.get("warranty_info") or {}
        labor_years = warranty_info.get(
            "labor_warranty_years", DEFAULT_LABOR_WARRANTY_YEARS
        )
        warranty_label = _get_warranty_label(labor_years)

        # Material text — detect legacy and upgrade
        raw_mat = warranty_info.get("material_warranty_text", "")
        if (not raw_mat
                or "manufacturer's warranty" in raw_mat
                or "manufacturer's published" in raw_mat):
            material_text = DEFAULT_MATERIAL_WARRANTY_TEXT
        else:
            material_text = raw_mat

        # Labor text — detect legacy and upgrade
        raw_labor = warranty_info.get("labor_warranty_text", "")
        if (not raw_labor
                or "Our company provides a" in raw_labor):
            labor_text = DEFAULT_LABOR_WARRANTY_TEXT.format(
                warranty_label=warranty_label,
                years=labor_years,
            )
        else:
            # Support both old {years} and new {warranty_label}
            labor_text = raw_labor.format(
                warranty_label=warranty_label,
                years=labor_years,
            )

        exclusions = warranty_info.get(
            "warranty_exclusions", DEFAULT_WARRANTY_EXCLUSIONS
        )

        elements.append(Paragraph("Material Warranty (Manufacturer)", s_clause_title))
        elements.append(Paragraph(material_text, s_clause))

        elements.append(Paragraph(warranty_label, s_clause_title))
        elements.append(Paragraph(labor_text, s_clause))

        elements.append(Paragraph("Exclusions", s_clause_title))
        elements.append(Paragraph(exclusions, s_clause))

        # ────────────────────────────────────────────────
        #  SIGNATURE BLOCK
        # ────────────────────────────────────────────────
        if show_signature:
            elements.append(Spacer(1, 18))
            elements.append(HRFlowable(
                width="100%", thickness=0.5,
                color=colors.HexColor(COLOR_BORDER),
            ))
            elements.append(Spacer(1, 6))

            s_sig_label = ParagraphStyle(
                "SigL", fontName="Helvetica", fontSize=9,
                textColor=colors.HexColor(COLOR_MEDIUM),
            )
            s_sig_line = ParagraphStyle(
                "SigLine", fontName="Helvetica", fontSize=9,
                textColor=colors.HexColor(COLOR_DARK),
                borderPadding=(0, 0, 6, 0),
            )

            half_w = content_w * 0.48
            sig_data = [
                [
                    Paragraph("Customer Acceptance", s_sig_label),
                    "",
                    Paragraph("Contractor Authorization", s_sig_label),
                    "",
                ],
                [
                    Paragraph("Signature: ____________________________", s_sig_line),
                    Paragraph("Date: ______________", s_sig_line),
                    Paragraph("Signature: ____________________________", s_sig_line),
                    Paragraph("Date: ______________", s_sig_line),
                ],
                [
                    Paragraph("Print Name: ___________________________", s_sig_line),
                    "",
                    Paragraph("Print Name: ___________________________", s_sig_line),
                    "",
                ],
            ]
            sig_table = Table(
                sig_data,
                colWidths=[half_w * 0.65, half_w * 0.35,
                           half_w * 0.65, half_w * 0.35],
            )
            sig_table.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("SPAN", (0, 0), (1, 0)),
                ("SPAN", (2, 0), (3, 0)),
            ]))
            elements.append(sig_table)

            # Footer note
            elements.append(Spacer(1, 8))
            elements.append(Paragraph(
                "By signing above, the customer authorizes the contractor to "
                "perform the work described in this estimate under the terms "
                "and conditions stated herein.",
                ParagraphStyle(
                    "FootNote", fontName="Helvetica-Oblique", fontSize=7,
                    textColor=colors.HexColor(COLOR_LIGHT), alignment=TA_CENTER,
                ),
            ))

        doc.build(elements, onFirstPage=_header_footer, onLaterPages=_header_footer)
        buffer.seek(0)
        return buffer

    def _add_waste_note(
        self, elements, colors,
        waste_pct, squares, sq_with_waste,
    ):
        """Add waste factor note below line items."""
        from reportlab.platypus import Paragraph, Spacer
        from reportlab.lib.styles import ParagraphStyle
        elements.append(Spacer(1, 3))
        elements.append(Paragraph(
            f"* Shingle qty includes"
            f" {waste_pct * 100:.0f}% waste"
            f" ({squares:.1f} SQ"
            f" + {waste_pct * 100:.0f}%"
            f" = {sq_with_waste} SQ)",
            ParagraphStyle(
                "WN",
                fontName="Helvetica-Oblique",
                fontSize=7,
                textColor=colors.HexColor(
                    COLOR_LIGHT),
            ),
        ))

    def _build_line_table(
        self, elements, items, content_w,
        is_lumpsum, colors, TA_RIGHT, TA_CENTER,
    ):
        """Build a single line-item table and append."""
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.platypus import Table, TableStyle, Paragraph

        s_th = ParagraphStyle(
            "TH2", fontName="Helvetica-Bold",
            fontSize=8.5, textColor=colors.white,
        )
        s_thr = ParagraphStyle(
            "THR2", fontName="Helvetica-Bold",
            fontSize=8.5, textColor=colors.white,
            alignment=TA_RIGHT,
        )
        s_thc = ParagraphStyle(
            "THC2", fontName="Helvetica-Bold",
            fontSize=8.5, textColor=colors.white,
            alignment=TA_CENTER,
        )
        s_td = ParagraphStyle(
            "TD2", fontName="Helvetica", fontSize=8.5,
            textColor=colors.HexColor(COLOR_DARK),
        )
        s_tdr = ParagraphStyle(
            "TDR2", fontName="Helvetica", fontSize=8.5,
            textColor=colors.HexColor(COLOR_DARK),
            alignment=TA_RIGHT,
        )
        s_tdc = ParagraphStyle(
            "TDC2", fontName="Helvetica", fontSize=8.5,
            textColor=colors.HexColor(COLOR_LIGHT),
            alignment=TA_CENTER,
        )

        if is_lumpsum:
            cw = [
                content_w * 0.70,
                content_w * 0.15,
                content_w * 0.15,
            ]
            header = [[
                Paragraph("<b>Description</b>", s_th),
                Paragraph("<b>Qty</b>", s_thr),
                Paragraph("<b>Unit</b>", s_thc),
            ]]
        else:
            cw = [
                content_w * 0.50,
                content_w * 0.11,
                content_w * 0.09,
                content_w * 0.15,
                content_w * 0.15,
            ]
            header = [[
                Paragraph("<b>Description</b>", s_th),
                Paragraph("<b>Qty</b>", s_thr),
                Paragraph("<b>Unit</b>", s_thc),
                Paragraph("<b>Unit Price</b>", s_thr),
                Paragraph("<b>Total</b>", s_thr),
            ]]

        table_data = list(header)
        row_styles = []
        row_idx = 1
        current_phase = None

        # Phase totals
        phase_totals: Dict[int, float] = {}
        sorted_items = sorted(
            items,
            key=lambda x: (
                x.get("phase", 0),
                x.get("display_order", 0),
            ),
        )
        for li in sorted_items:
            p = li.get("phase", 0)
            phase_totals[p] = (
                phase_totals.get(p, 0)
                + li.get("total", 0)
            )

        for li in sorted_items:
            phase = li.get("phase", 0)
            if phase != current_phase:
                current_phase = phase
                label = PHASE_LABELS.get(
                    phase, f"Phase {phase}")
                pt = phase_totals.get(phase, 0)
                s_ph = ParagraphStyle(
                    "PhH2",
                    fontName="Helvetica-Bold",
                    fontSize=9,
                    textColor=colors.HexColor(
                        COLOR_PRIMARY),
                )
                if is_lumpsum:
                    table_data.append([
                        Paragraph(
                            f"<b>{label}</b>", s_ph),
                        "", "",
                    ])
                else:
                    s_pt = ParagraphStyle(
                        "PhT2",
                        fontName="Helvetica-Bold",
                        fontSize=9,
                        textColor=colors.HexColor(
                            COLOR_PRIMARY),
                        alignment=TA_RIGHT,
                    )
                    table_data.append([
                        Paragraph(
                            f"<b>Phase {phase}:"
                            f" {label}</b>",
                            s_ph,
                        ),
                        "", "", "",
                        Paragraph(
                            f"<b>${pt:,.2f}</b>",
                            s_pt,
                        ),
                    ])
                row_styles.append((row_idx, True))
                row_idx += 1

            desc = li.get("description", "")
            if is_lumpsum:
                table_data.append([
                    Paragraph(
                        f"&nbsp;&nbsp;{desc}",
                        s_td),
                    Paragraph(
                        f"{li.get('quantity', 0):.1f}",
                        s_tdr),
                    Paragraph(
                        li.get("unit", ""), s_tdc),
                ])
            else:
                table_data.append([
                    Paragraph(
                        f"&nbsp;&nbsp;{desc}",
                        s_td),
                    Paragraph(
                        f"{li.get('quantity', 0):.1f}",
                        s_tdr),
                    Paragraph(
                        li.get("unit", ""), s_tdc),
                    Paragraph(
                        f"${li.get('unit_price', 0):,.2f}",
                        s_tdr),
                    Paragraph(
                        f"${li.get('total', 0):,.2f}",
                        s_tdr),
                ])
            row_styles.append((row_idx, False))
            row_idx += 1

        tbl = Table(
            table_data, colWidths=cw, repeatRows=1)
        ts = [
            ("BACKGROUND", (0, 0), (-1, 0),
             colors.HexColor(COLOR_PRIMARY)),
            ("TEXTCOLOR", (0, 0), (-1, 0),
             colors.white),
            ("TOPPADDING", (0, 0), (-1, 0), 5),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 1), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 1), (-1, -1), 3),
            ("LINEBELOW", (0, 0), (-1, -1), 0.3,
             colors.HexColor(COLOR_BORDER)),
        ]
        data_row_count = 0
        for ridx, is_phase in row_styles:
            if is_phase:
                ts.append((
                    "BACKGROUND",
                    (0, ridx), (-1, ridx),
                    colors.HexColor(COLOR_PHASE_BG),
                ))
                ts.append((
                    "LINEBELOW",
                    (0, ridx), (-1, ridx), 0.5,
                    colors.HexColor(COLOR_SECONDARY),
                ))
                data_row_count = 0
            else:
                if data_row_count % 2 == 1:
                    ts.append((
                        "BACKGROUND",
                        (0, ridx), (-1, ridx),
                        colors.HexColor(COLOR_ROW_ALT),
                    ))
                data_row_count += 1

        tbl.setStyle(TableStyle(ts))
        elements.append(tbl)

    def _build_pitch_display(self, estimate: Dict[str, Any]) -> str:
        """Build pitch display string with range and per-structure breakdown.

        Single structure: "7/12 (range: 4-15)"
        Multi structure:  "Main: 7/12 (4-15) | Shed: 4/12"
        """
        ev_data = estimate.get("eagleview_data") or {}
        structures = ev_data.get("structures", [])
        predominant = estimate.get("predominant_pitch", "N/A")

        if len(structures) > 1:
            # Multi-structure: show per-structure
            parts = []
            for s in structures:
                label = s.get("label", f"#{s.get('index', 0) + 1}")
                # Shorten "Structure #1" to just "#1"
                label = label.replace("Structure ", "")
                s_pitch = s.get("predominant_pitch", "?")
                s_min = s.get("pitch_min")
                s_max = s.get("pitch_max")
                if s_min and s_max and s_min != s_max:
                    parts.append(f"{label}: {s_pitch} ({s_min}\u2013{s_max})")
                else:
                    parts.append(f"{label}: {s_pitch}")
            return " | ".join(parts)

        # Single structure: check for range in faces
        if structures:
            s = structures[0]
            s_min = s.get("pitch_min")
            s_max = s.get("pitch_max")
            if s_min and s_max and s_min != s_max:
                return f"{predominant} (range: {s_min}\u2013{s_max})"

        # Fallback: try to get range from face data
        faces = ev_data.get("faces", [])
        if faces:
            pitches = []
            for f in faces:
                p = f.get("pitch", "")
                if p and p != "?":
                    try:
                        val = float(p.split("/")[0]) if "/" in p else float(p)
                        pitches.append(val)
                    except (ValueError, IndexError):
                        pass
            if pitches:
                p_min, p_max = min(pitches), max(pitches)
                if p_min != p_max:
                    return f"{predominant} (range: {int(p_min)}\u2013{int(p_max)})"

        return predominant

    # ════════════════════════════════════════════════
    #  INVOICE PDF (via existing invoice system)
    # ════════════════════════════════════════════════

    def generate_invoice_pdf(
        self,
        estimate: Dict[str, Any],
        completion_date: str = "",
        pricing_mode: str = "detailed",
    ) -> io.BytesIO:
        """Generate invoice PDF using the existing invoice
        template system (WeasyPrint + Jinja2).

        pricing_mode:
            "detailed" - line items with qty/unit/price
            "lumpsum"  - single total amount
        """
        import tempfile
        from collections import OrderedDict
        from pathlib import Path

        from app.common.services.pdf_service import (
            get_pdf_service,
        )

        pdf_svc = get_pdf_service()
        if not pdf_svc:
            logger.warning("pdf_service unavailable, "
                           "falling back to reportlab")
            return self._generate_invoice_reportlab(
                estimate, completion_date, pricing_mode,
            )

        # ── Map estimate data to invoice system format ──
        co = estimate.get("company_info") or {}
        est_id = (estimate.get("id") or "")[:8].upper()
        inv_number = f"INV-{est_id}" if est_id else "DRAFT"
        today = completion_date or datetime.now().strftime(
            "%Y-%m-%d"
        )

        client_name = estimate.get("client_name") or ""
        addr = estimate.get("property_address") or ""
        city = estimate.get("city") or ""
        state = estimate.get("state") or ""
        zipcode = estimate.get("zip_code") or ""
        loc = ", ".join(filter(None, [city, state, zipcode]))

        # Build line items / sections
        line_items = estimate.get("line_items") or []
        is_lumpsum = pricing_mode == "lumpsum"

        if is_lumpsum:
            # Single line item with total
            total = estimate.get("total", 0) or 0
            sections = [{
                "title": "Roofing Services",
                "items": [{
                    "name": "Complete Roof Replacement",
                    "description": (
                        f"{addr}, {loc}" if addr else ""
                    ),
                    "quantity": 1,
                    "unit": "job",
                    "rate": total,
                    "amount": total,
                }],
                "subtotal": total,
            }]
            items_subtotal = total
        else:
            # Group by phase
            items_by_phase: OrderedDict = OrderedDict()
            for li in sorted(
                line_items,
                key=lambda x: (
                    x.get("phase", 99),
                    x.get("display_order", 0),
                ),
            ):
                phase = li.get("phase", 8)
                phase_name = PHASE_LABELS.get(
                    phase, f"Phase {phase}"
                )
                if phase_name not in items_by_phase:
                    items_by_phase[phase_name] = []
                items_by_phase[phase_name].append({
                    "name": li.get("description", ""),
                    "description": li.get("notes") or "",
                    "quantity": li.get("quantity", 0),
                    "unit": li.get("unit", ""),
                    "rate": li.get("unit_price", 0),
                    "amount": li.get("total", 0),
                })

            sections = []
            for name, items in items_by_phase.items():
                sec_sub = sum(
                    i["amount"] for i in items
                )
                sections.append({
                    "title": name,
                    "items": items,
                    "subtotal": sec_sub,
                })
            items_subtotal = estimate.get(
                "subtotal", 0
            ) or 0

        # Build adjustments
        adjustments = []
        markup = estimate.get("markup_amount", 0) or 0
        overhead = estimate.get("overhead_amount", 0) or 0
        profit = estimate.get("profit_amount", 0) or 0
        permit = estimate.get("permit_fee", 0) or 0

        if not is_lumpsum:
            order = 1
            if markup:
                adjustments.append({
                    "name": "Material & Labor Markup",
                    "percentage": 0,
                    "fixed_amount": markup,
                    "type": "add",
                    "order": order,
                    "amount": markup,
                })
                order += 1
            if overhead:
                adjustments.append({
                    "name": "Overhead",
                    "percentage": 0,
                    "fixed_amount": overhead,
                    "type": "add",
                    "order": order,
                    "amount": overhead,
                })
                order += 1
            if profit:
                adjustments.append({
                    "name": "Profit",
                    "percentage": 0,
                    "fixed_amount": profit,
                    "type": "add",
                    "order": order,
                    "amount": profit,
                })
                order += 1
            if permit:
                adjustments.append({
                    "name": "Permit Fee",
                    "percentage": 0,
                    "fixed_amount": permit,
                    "type": "add",
                    "order": order,
                    "amount": permit,
                })

        total = estimate.get("total", 0) or 0
        tax = estimate.get("tax_amount", 0) or 0

        # Insurance info
        ins = estimate.get("insurance_info") or {}
        insurance_data = {}
        if ins.get("carrier"):
            insurance_data = {
                "company": ins.get("carrier", ""),
                "claim_number": ins.get(
                    "claim_number", ""
                ),
            }

        pdf_data = {
            "invoice_number": inv_number,
            "date": today,
            "due_date": today,
            "company": {
                "name": co.get("name") or "",
                "address": co.get("address") or "",
                "city": co.get("city") or "",
                "state": co.get("state") or "",
                "zip": co.get("zipcode") or "",
                "phone": co.get("phone") or "",
                "email": co.get("email") or "",
                "logo": None,
            },
            "client": {
                "name": client_name,
                "address": addr,
                "city": city,
                "state": state,
                "zip": zipcode,
            },
            "sections": sections,
            "items": [],
            "items_subtotal": items_subtotal,
            "adjustments": adjustments,
            "tax_rate": 0,
            "tax_amount": tax,
            "total": total,
            "payments": [],
            "payment_terms": (
                "Payment is due upon receipt of invoice. "
                "Accepted methods: check, credit card, "
                "or bank transfer. Please reference "
                f"invoice number {inv_number} with "
                "your payment."
            ),
            "notes": (
                f"Estimate Reference: EST-{est_id}"
                if est_id else ""
            ),
        }

        if insurance_data:
            pdf_data["insurance"] = insurance_data

        # Generate via existing system
        with tempfile.NamedTemporaryFile(
            suffix=".pdf", delete=False,
        ) as tmp:
            tmp_path = tmp.name

        try:
            pdf_svc.generate_invoice_pdf(
                pdf_data, tmp_path,
            )
            with open(tmp_path, "rb") as f:
                buffer = io.BytesIO(f.read())
            buffer.seek(0)
            return buffer
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    # ════════════════════════════════════════════════
    #  WARRANTY CERTIFICATE PDF
    # ════════════════════════════════════════════════

    def generate_warranty_cert_pdf(
        self,
        estimate: Dict[str, Any],
        completion_date: str = "",
    ) -> io.BytesIO:
        """Generate a warranty certificate PDF."""
        try:
            from reportlab.lib import colors
            from reportlab.lib.enums import TA_CENTER, TA_RIGHT
            from reportlab.lib.pagesizes import letter
            from reportlab.lib.styles import ParagraphStyle
            from reportlab.lib.units import inch
            from reportlab.platypus import (
                HRFlowable, Paragraph, SimpleDocTemplate,
                Spacer, Table, TableStyle,
            )
        except ImportError:
            return self._generate_text_fallback(estimate)

        buffer = io.BytesIO()
        page_w, page_h = letter
        margin = 0.7 * inch

        doc = SimpleDocTemplate(
            buffer, pagesize=letter,
            topMargin=margin, bottomMargin=margin,
            leftMargin=margin, rightMargin=margin,
        )
        cw = page_w - 2 * margin
        elements: List[Any] = []

        # ── Styles ──
        s_title = ParagraphStyle(
            "WCTitle", fontName="Helvetica-Bold",
            fontSize=22,
            textColor=colors.HexColor(COLOR_PRIMARY),
            alignment=TA_CENTER, spaceAfter=2,
        )
        s_cert_num = ParagraphStyle(
            "WCNum", fontName="Helvetica", fontSize=10,
            textColor=colors.HexColor(COLOR_MEDIUM),
            alignment=TA_CENTER, spaceAfter=6,
        )
        s_section = ParagraphStyle(
            "WCSec", fontName="Helvetica-Bold",
            fontSize=10,
            textColor=colors.HexColor(COLOR_PRIMARY),
            spaceBefore=8, spaceAfter=2,
        )
        s_body = ParagraphStyle(
            "WCBody", fontName="Helvetica", fontSize=8,
            textColor=colors.HexColor(COLOR_DARK),
            leading=11, spaceAfter=2,
        )
        s_label = ParagraphStyle(
            "WCL", fontName="Helvetica-Bold", fontSize=9,
            textColor=colors.HexColor(COLOR_MEDIUM),
        )
        s_val = ParagraphStyle(
            "WCV", fontName="Helvetica", fontSize=9,
            textColor=colors.HexColor(COLOR_DARK),
        )
        s_small = ParagraphStyle(
            "WCSm", fontName="Helvetica", fontSize=8,
            textColor=colors.HexColor(COLOR_MEDIUM),
            leading=11,
        )
        s_sig_label = ParagraphStyle(
            "WCSigL", fontName="Helvetica", fontSize=9,
            textColor=colors.HexColor(COLOR_MEDIUM),
        )

        # ── Data extraction ──
        co = estimate.get("company_info") or {}
        co_name = co.get("name") or ""
        co_addr = ", ".join(filter(None, [
            co.get("address") or "",
            co.get("city") or "",
            co.get("state") or "",
            co.get("zipcode") or "",
        ]))
        co_phone = co.get("phone") or ""
        co_email = co.get("email") or ""

        est_id = (
            estimate.get("id") or ""
        )[:8].upper()
        cert_num = (
            f"WC-{est_id}" if est_id else "WC-DRAFT"
        )
        client = estimate.get("client_name") or ""
        addr = estimate.get("property_address") or ""
        loc = ", ".join(filter(None, [
            estimate.get("city") or "",
            estimate.get("state") or "",
            estimate.get("zip_code") or "",
        ]))
        today = completion_date or datetime.now().strftime(
            "%B %d, %Y"
        )

        shingle = estimate.get("shingle_spec") or {}
        shingle_brand = (
            (shingle.get("brand") or "")
            .replace("_", " ").title()
        )
        shingle_type = (
            (shingle.get("type") or "")
            .replace("_", " ").title()
        )
        shingle_product = shingle.get("product") or ""
        shingle_color = shingle.get("color") or ""
        total_sf = estimate.get("total_sf") or 0
        squares = estimate.get("squares") or 0

        warranty_info = estimate.get("warranty_info") or {}
        labor_years = warranty_info.get(
            "labor_warranty_years",
            DEFAULT_LABOR_WARRANTY_YEARS,
        )
        warranty_label = _get_warranty_label(labor_years)

        # ── Header ──
        elements.append(HRFlowable(
            width="100%", thickness=2,
            color=colors.HexColor(COLOR_PRIMARY),
        ))
        elements.append(Spacer(1, 8))
        elements.append(
            Paragraph("ROOFING WARRANTY CERTIFICATE", s_title)
        )
        elements.append(Spacer(1, 4))
        elements.append(Paragraph(
            f"<b>{co_name}</b>  |  "
            f"Certificate No. {cert_num}",
            s_cert_num,
        ))
        elements.append(Paragraph(
            f"{co_addr}  |  "
            f"{co_phone}  |  {co_email}",
            ParagraphStyle(
                "WCCo2", fontName="Helvetica",
                fontSize=8,
                textColor=colors.HexColor(COLOR_LIGHT),
                alignment=TA_CENTER,
            ),
        ))
        elements.append(Spacer(1, 4))
        elements.append(HRFlowable(
            width="100%", thickness=2,
            color=colors.HexColor(COLOR_PRIMARY),
        ))
        elements.append(Spacer(1, 8))

        # ── Project Details ──
        elements.append(
            Paragraph("PROJECT DETAILS", s_section)
        )
        info_data = [
            [
                Paragraph("<b>Property Owner:</b>", s_label),
                Paragraph(client, s_val),
                Paragraph("<b>Completion Date:</b>", s_label),
                Paragraph(today, s_val),
            ],
            [
                Paragraph("<b>Property Address:</b>", s_label),
                Paragraph(f"{addr}, {loc}", s_val),
                Paragraph("<b>Certificate #:</b>", s_label),
                Paragraph(cert_num, s_val),
            ],
            [
                Paragraph("<b>Shingle Brand:</b>", s_label),
                Paragraph(
                    shingle_brand or "N/A", s_val,
                ),
                Paragraph("<b>Shingle Type:</b>", s_label),
                Paragraph(
                    shingle_type or "N/A", s_val,
                ),
            ],
            [
                Paragraph("<b>Product:</b>", s_label),
                Paragraph(
                    shingle_product or "N/A", s_val,
                ),
                Paragraph("<b>Color:</b>", s_label),
                Paragraph(
                    shingle_color or "N/A", s_val,
                ),
            ],
            [
                Paragraph("<b>Roof Area:</b>", s_label),
                Paragraph(
                    f"{total_sf:,.0f} SF "
                    f"({squares:,.1f} squares)",
                    s_val,
                ),
                Paragraph("", s_label),
                Paragraph("", s_val),
            ],
        ]
        t = Table(
            info_data,
            colWidths=[
                cw * 0.2, cw * 0.32,
                cw * 0.2, cw * 0.28,
            ],
        )
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("BACKGROUND", (0, 0), (-1, -1),
             colors.HexColor(COLOR_ACCENT)),
            ("BOX", (0, 0), (-1, -1), 0.5,
             colors.HexColor(COLOR_BORDER)),
            ("INNERGRID", (0, 0), (-1, -1), 0.3,
             colors.HexColor(COLOR_BORDER)),
        ]))
        elements.append(t)

        # ── Material Warranty ──
        elements.append(
            Paragraph("MATERIAL WARRANTY (MANUFACTURER)",
                      s_section)
        )
        raw_mat = warranty_info.get(
            "material_warranty_text", ""
        )
        if (not raw_mat
                or "manufacturer's warranty" in raw_mat
                or "manufacturer's published" in raw_mat):
            mat_text = DEFAULT_MATERIAL_WARRANTY_TEXT
        else:
            mat_text = raw_mat
        elements.append(Paragraph(mat_text, s_body))

        # ── Workmanship Warranty ──
        elements.append(
            Paragraph(warranty_label.upper(), s_section)
        )
        raw_labor = warranty_info.get(
            "labor_warranty_text", ""
        )
        if (not raw_labor
                or "Our company provides a" in raw_labor):
            labor_text = DEFAULT_LABOR_WARRANTY_TEXT.format(
                warranty_label=warranty_label,
                years=labor_years,
            )
        else:
            labor_text = raw_labor.format(
                warranty_label=warranty_label,
                years=labor_years,
            )
        elements.append(Paragraph(labor_text, s_body))

        # ── Exclusions ──
        elements.append(
            Paragraph("EXCLUSIONS", s_section)
        )
        exclusions = warranty_info.get(
            "warranty_exclusions",
            DEFAULT_WARRANTY_EXCLUSIONS,
        )
        elements.append(Paragraph(exclusions, s_small))

        # ── Signature Block ──
        elements.append(Spacer(1, 14))
        elements.append(HRFlowable(
            width="100%", thickness=0.5,
            color=colors.HexColor(COLOR_BORDER),
        ))
        elements.append(Spacer(1, 6))

        s_sig_line = ParagraphStyle(
            "WCSigLine", fontName="Helvetica",
            fontSize=9,
            textColor=colors.HexColor(COLOR_DARK),
        )

        sig_data = [
            [
                Paragraph(
                    "Contractor Signature:  "
                    "__________________________",
                    s_sig_line,
                ),
                Paragraph(
                    f"Date:  {today}",
                    s_sig_line,
                ),
            ],
            [
                Paragraph("", s_sig_line),
                Paragraph("", s_sig_line),
            ],
            [
                Paragraph(
                    "Property Owner:  "
                    "__________________________",
                    s_sig_line,
                ),
                Paragraph(
                    "Date:  ______________",
                    s_sig_line,
                ),
            ],
        ]
        t = Table(
            sig_data,
            colWidths=[cw * 0.6, cw * 0.4],
        )
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]))
        elements.append(t)

        # ── Footer note ──
        elements.append(Spacer(1, 10))
        elements.append(HRFlowable(
            width="100%", thickness=1,
            color=colors.HexColor(COLOR_PRIMARY),
        ))
        elements.append(Spacer(1, 4))
        elements.append(Paragraph(
            "This certificate is issued as confirmation "
            "of warranty coverage for the roofing work "
            "described above. Please retain this document "
            "for your records. In the event of a warranty "
            "claim, contact us with this certificate "
            "number for expedited service.",
            s_small,
        ))

        doc.build(elements)
        buffer.seek(0)
        return buffer

    def _generate_text_fallback(self, estimate: Dict[str, Any]) -> io.BytesIO:
        """Simple text fallback when reportlab is not installed."""
        buffer = io.BytesIO()
        lines = ["ROOFING ESTIMATE", "=" * 60, ""]
        lines.append(f"Property: {estimate.get('property_address', 'N/A')}")
        lines.append(f"Area: {estimate.get('total_sf', 0):,.0f} SF")
        lines.append(f"Total: ${estimate.get('total', 0):,.2f}")
        lines.append("")
        for li in estimate.get("line_items", []):
            lines.append(
                f"  {li.get('description', '')}: "
                f"{li.get('quantity', 0)} {li.get('unit', '')} "
                f"@ ${li.get('unit_price', 0):,.2f} = "
                f"${li.get('total', 0):,.2f}"
            )
        buffer.write("\n".join(lines).encode("utf-8"))
        buffer.seek(0)
        return buffer
