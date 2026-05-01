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
    "All roofing materials installed under this contract are covered by the "
    "respective manufacturer's warranty. Shingle warranty coverage follows the "
    "manufacturer's published terms, which typically include a Limited Lifetime "
    "Warranty for architectural shingles and a 25-year warranty for three-tab "
    "shingles. Coverage may be prorated after an initial non-prorated period. "
    "Warranty is transferable once to a subsequent owner within the first 10 "
    "years of installation, subject to manufacturer requirements."
)

DEFAULT_LABOR_WARRANTY_TEXT = (
    "Our company provides a {years}-year workmanship warranty covering all "
    "labor performed under this contract, effective from the date of project "
    "completion. Should any defect in workmanship arise during the warranty "
    "period, we will repair or correct the deficiency at no additional cost."
)

DEFAULT_WARRANTY_EXCLUSIONS = (
    "Excluded from all warranty coverage: damage caused by acts of God; ice "
    "damming resulting from inadequate attic insulation or ventilation; damage "
    "by foot traffic or third-party modifications after completion; "
    "pre-existing structural damage; neglect or failure to perform routine "
    "maintenance; damage from unlicensed repairs; and normal wear and tear."
)


class RoofingExportService:
    """Generate PDF estimates for roofing projects."""

    def generate_pdf(
        self, estimate: Dict[str, Any], show_signature: bool = True,
        pricing_mode: str = "detailed",
    ) -> io.BytesIO:
        """Generate professional PDF from estimate data.

        pricing_mode:
            "detailed" - full breakdown with unit prices and line totals
            "lumpsum"  - scope of work only (description + qty/unit), single total
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
            "S_Company", fontName="Helvetica-Bold", fontSize=13,
            textColor=colors.HexColor(COLOR_PRIMARY), alignment=TA_RIGHT,
            spaceAfter=2,
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

        elements.append(Paragraph("SCOPE OF WORK", s_section))
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
                    if not is_lumpsum:
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

                    self._build_line_table(
                        elements, s_items,
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
                self._build_line_table(
                    elements, line_items,
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
            totals_rows.append([
                Paragraph("Subtotal", s_tot_label),
                Paragraph(f"${estimate.get('subtotal', 0):,.2f}", s_tot_value),
            ])
            if estimate.get("markup_amount", 0) > 0:
                totals_rows.append([
                    Paragraph("Markup", s_tot_label),
                    Paragraph(f"${estimate.get('markup_amount', 0):,.2f}",
                              s_tot_value),
                ])
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
        labor_years = warranty_info.get("labor_warranty_years", DEFAULT_LABOR_WARRANTY_YEARS)
        material_text = warranty_info.get(
            "material_warranty_text", DEFAULT_MATERIAL_WARRANTY_TEXT)
        labor_text = warranty_info.get(
            "labor_warranty_text", DEFAULT_LABOR_WARRANTY_TEXT
        ).format(years=labor_years)
        exclusions = warranty_info.get(
            "warranty_exclusions", DEFAULT_WARRANTY_EXCLUSIONS)

        elements.append(Paragraph("Material Warranty (Manufacturer)", s_clause_title))
        elements.append(Paragraph(material_text, s_clause))

        elements.append(Paragraph(
            f"Workmanship Warranty ({labor_years} Years)", s_clause_title))
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
