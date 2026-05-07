"""
Material Order PDF export service.
Generates Supply Order and Internal Estimate documents.
Uses reportlab for PDF generation.
"""

import io
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from .schemas import MaterialCategory, MaterialItem, OutputType

logger = logging.getLogger(__name__)

# ── Colors ──
COLOR_PRIMARY = "#1B3A5C"
COLOR_SECONDARY = "#2A6496"
COLOR_ACCENT = "#E8F0FE"
COLOR_DARK = "#1a1a1a"
COLOR_BORDER = "#D0D5DD"
COLOR_ROW_ALT = "#F8FAFC"
COLOR_HEADER_BG = "#1B3A5C"
COLOR_CATEGORY_BG = "#EBF0F5"
COLOR_TOTAL_BG = "#1B3A5C"

CATEGORY_LABELS = {
    "main": "Main Material",
    "underlayment": "Underlayment",
    "trim": "Trim & Flashing",
    "fastener": "Fasteners",
    "misc": "Miscellaneous",
}

CATEGORY_ORDER = ["main", "underlayment", "trim", "fastener", "misc"]


def generate_pdf(
    output_type: OutputType,
    scope_type: str,
    property_address: str,
    report_number: str,
    delivery_date: Optional[str],
    brand: str,
    product: Optional[str],
    color: Optional[str],
    measurements: Dict[str, Any],
    materials: List[Dict[str, Any]],
    notes: List[str],
) -> bytes:
    """Generate PDF document for material order."""
    try:
        from reportlab.lib import colors
        from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import inch
        from reportlab.platypus import (
            Paragraph,
            SimpleDocTemplate,
            Spacer,
            Table,
            TableStyle,
        )
    except ImportError:
        raise RuntimeError("reportlab is required for PDF export. Install with: pip install reportlab")

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        topMargin=0.5 * inch,
        bottomMargin=0.6 * inch,
        leftMargin=0.6 * inch,
        rightMargin=0.6 * inch,
    )

    styles = getSampleStyleSheet()
    elements = []

    # ── Custom styles ──
    title_style = ParagraphStyle(
        "DocTitle",
        parent=styles["Heading1"],
        fontSize=16,
        textColor=colors.HexColor(COLOR_PRIMARY),
        spaceAfter=4,
        leading=20,
    )
    subtitle_style = ParagraphStyle(
        "DocSubtitle",
        parent=styles["Normal"],
        fontSize=10,
        textColor=colors.HexColor("#555555"),
        spaceAfter=2,
    )
    section_style = ParagraphStyle(
        "SectionHeader",
        parent=styles["Heading2"],
        fontSize=11,
        textColor=colors.HexColor(COLOR_PRIMARY),
        spaceBefore=12,
        spaceAfter=6,
    )
    normal_style = ParagraphStyle(
        "NormalText",
        parent=styles["Normal"],
        fontSize=9,
        leading=12,
    )
    small_style = ParagraphStyle(
        "SmallText",
        parent=styles["Normal"],
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#666666"),
    )
    note_style = ParagraphStyle(
        "NoteText",
        parent=styles["Normal"],
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#555555"),
        leftIndent=10,
    )

    is_supply_order = output_type == OutputType.supply_order
    doc_title = "Supply Order" if is_supply_order else "Internal Estimate"
    scope_label = scope_type.capitalize()

    # ── Header ──
    elements.append(Paragraph("Enter Construction Inc.", title_style))
    elements.append(Paragraph(
        f"<b>{doc_title}</b> &mdash; {scope_label} Materials", subtitle_style
    ))
    elements.append(Spacer(1, 8))

    # ── Job Info Table ──
    today = datetime.now().strftime("%m/%d/%Y")
    info_val_style = ParagraphStyle(
        "InfoValue",
        parent=styles["Normal"],
        fontSize=9,
        leading=12,
    )
    info_data = [
        ["Property Address:", Paragraph(property_address or "N/A", info_val_style), "Order Date:", today],
        ["EagleView Report #:", report_number or "N/A", "Delivery Date:", delivery_date or "TBD"],
        ["Brand:", brand or "N/A", "Product:", product or "N/A"],
        ["Color:", color or "N/A", "", ""],
    ]

    info_table = Table(info_data, colWidths=[1.3 * inch, 2.5 * inch, 1.2 * inch, 2.0 * inch])
    info_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor(COLOR_PRIMARY)),
        ("TEXTCOLOR", (2, 0), (2, -1), colors.HexColor(COLOR_PRIMARY)),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 12))

    # ── Measurement Summary (Internal Estimate only) ──
    if not is_supply_order and measurements:
        elements.append(Paragraph("EagleView Measurement Summary", section_style))
        meas_rows = []
        for key, val in measurements.items():
            if key.endswith("_pct"):
                display_val = f"{val}%"
            elif isinstance(val, float):
                display_val = f"{val:,.1f}"
            elif isinstance(val, int):
                display_val = str(val)
            elif val is None:
                continue
            else:
                display_val = str(val)
            label = key.replace("_", " ").title()
            meas_rows.append([label, display_val])

        if meas_rows:
            # Split into 2 columns
            half = (len(meas_rows) + 1) // 2
            left = meas_rows[:half]
            right = meas_rows[half:]
            combined = []
            for i in range(max(len(left), len(right))):
                row = []
                if i < len(left):
                    row.extend(left[i])
                else:
                    row.extend(["", ""])
                if i < len(right):
                    row.extend(right[i])
                else:
                    row.extend(["", ""])
                combined.append(row)

            meas_table = Table(combined, colWidths=[1.8 * inch, 1.5 * inch, 1.8 * inch, 1.5 * inch])
            meas_table.setStyle(TableStyle([
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
                ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#555555")),
                ("TEXTCOLOR", (2, 0), (2, -1), colors.HexColor("#555555")),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("ALIGN", (3, 0), (3, -1), "RIGHT"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("LINEBELOW", (0, -1), (-1, -1), 0.5, colors.HexColor(COLOR_BORDER)),
            ]))
            elements.append(meas_table)
            elements.append(Spacer(1, 10))

    # ── Material Table ──
    elements.append(Paragraph("Material List", section_style))

    # Group by category
    mat_items = [MaterialItem(**m) if isinstance(m, dict) else m for m in materials]

    if is_supply_order:
        # Supply Order: Qty + U/M + Description
        header = ["#", "Qty", "U/M", "Description"]
        col_widths = [0.35 * inch, 0.6 * inch, 0.5 * inch, 5.55 * inch]
    else:
        # Internal Estimate: Qty + U/M + Description + Unit Price + Subtotal
        header = ["#", "Qty", "U/M", "Description", "Formula", "Unit $", "Subtotal"]
        col_widths = [0.3 * inch, 0.5 * inch, 0.45 * inch, 2.2 * inch, 1.5 * inch, 0.7 * inch, 0.85 * inch]

    table_data = []
    row_idx = 0
    grand_total = 0.0
    category_subtotals: Dict[str, float] = {}

    for cat_key in CATEGORY_ORDER:
        cat_items = [m for m in mat_items if m.category.value == cat_key]
        if not cat_items:
            continue

        # Category header row
        cat_label = CATEGORY_LABELS.get(cat_key, cat_key.title())
        if is_supply_order:
            table_data.append(["", "", "", Paragraph(f"<b>{cat_label}</b>", normal_style)])
        else:
            table_data.append(["", "", "", Paragraph(f"<b>{cat_label}</b>", normal_style), "", "", ""])
        row_idx += 1

        cat_total = 0.0
        for item in cat_items:
            line_num = row_idx
            subtotal = (item.qty * (item.unit_price or 0)) if item.unit_price else None

            if is_supply_order:
                table_data.append([
                    str(line_num),
                    str(int(item.qty)) if item.qty == int(item.qty) else f"{item.qty:.1f}",
                    item.unit,
                    Paragraph(item.item, small_style),
                ])
            else:
                price_str = f"${item.unit_price:,.2f}" if item.unit_price else "-"
                sub_str = f"${subtotal:,.2f}" if subtotal is not None else "-"
                if subtotal:
                    cat_total += subtotal
                    grand_total += subtotal
                table_data.append([
                    str(line_num),
                    str(int(item.qty)) if item.qty == int(item.qty) else f"{item.qty:.1f}",
                    item.unit,
                    Paragraph(item.item, small_style),
                    Paragraph(item.formula, small_style) if item.formula else "",
                    price_str,
                    sub_str,
                ])
            row_idx += 1

        # Category subtotal for estimate
        if not is_supply_order and cat_total > 0:
            category_subtotals[cat_key] = cat_total
            table_data.append([
                "", "", "", "",
                Paragraph(f"<i>{cat_label} Subtotal</i>", small_style),
                "", f"${cat_total:,.2f}",
            ])
            row_idx += 1

    # Grand total for estimate
    if not is_supply_order:
        if is_supply_order:
            table_data.append(["", "", "", "", ""])
        else:
            table_data.append([
                "", "", "", "",
                Paragraph("<b>TOTAL MATERIAL COST</b>", normal_style),
                "", f"${grand_total:,.2f}",
            ])
        row_idx += 1

    # Build table
    if table_data:
        # Add header
        full_data = [header] + table_data
        mat_table = Table(full_data, colWidths=col_widths, repeatRows=1)

        style_commands = [
            # Header
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(COLOR_HEADER_BG)),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 8),
            ("ALIGN", (0, 0), (-1, 0), "CENTER"),
            # Body
            ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 1), (-1, -1), 8),
            ("ALIGN", (0, 1), (0, -1), "CENTER"),  # #
            ("ALIGN", (1, 1), (1, -1), "CENTER"),  # Qty
            ("ALIGN", (2, 1), (2, -1), "CENTER"),  # U/M
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("GRID", (0, 0), (-1, 0), 0.5, colors.HexColor(COLOR_HEADER_BG)),
            ("LINEBELOW", (0, 0), (-1, -2), 0.3, colors.HexColor("#E0E0E0")),
        ]

        if not is_supply_order:
            style_commands.extend([
                ("ALIGN", (5, 1), (5, -1), "RIGHT"),  # Unit $
                ("ALIGN", (6, 1), (6, -1), "RIGHT"),  # Subtotal
            ])
            # Grand total row styling
            last_row = len(full_data) - 1
            style_commands.extend([
                ("BACKGROUND", (0, last_row), (-1, last_row), colors.HexColor(COLOR_TOTAL_BG)),
                ("TEXTCOLOR", (0, last_row), (-1, last_row), colors.white),
                ("FONTNAME", (0, last_row), (-1, last_row), "Helvetica-Bold"),
                ("FONTSIZE", (0, last_row), (-1, last_row), 9),
            ])

        # Alternating row colors
        for i in range(1, len(full_data)):
            if i % 2 == 0:
                style_commands.append(
                    ("BACKGROUND", (0, i), (-1, i), colors.HexColor(COLOR_ROW_ALT))
                )

        mat_table.setStyle(TableStyle(style_commands))
        elements.append(mat_table)

    # ── Notes (Internal Estimate only) ──
    if not is_supply_order and notes:
        elements.append(Spacer(1, 12))
        elements.append(Paragraph("Notes", section_style))
        for note_text in notes:
            elements.append(Paragraph(f"\u2022 {note_text}", note_style))

    # ── Footer / Contact ──
    elements.append(Spacer(1, 20))
    elements.append(Paragraph(
        "<b>Enter Construction Inc.</b>", normal_style
    ))
    elements.append(Paragraph(
        "Contact: Minjee Song | Jason Yoo", small_style
    ))
    elements.append(Paragraph(
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}", small_style
    ))

    doc.build(elements)
    return buffer.getvalue()
