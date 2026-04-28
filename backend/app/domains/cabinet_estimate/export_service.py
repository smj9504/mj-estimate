"""
Cabinet Estimate export service - PDF and Excel generation.
"""

import io
import logging
from datetime import datetime
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


class CabinetExportService:
    """Generates PDF estimates and Excel purchase orders."""

    # ── PDF Export (for insurance / customer) ──

    def generate_pdf(self, estimate: Dict[str, Any]) -> io.BytesIO:
        """Generate a professional PDF estimate using ReportLab."""
        from reportlab.lib import colors
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

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,
            rightMargin=0.75 * inch,
            leftMargin=0.75 * inch,
            topMargin=0.75 * inch,
            bottomMargin=0.75 * inch,
        )

        styles = getSampleStyleSheet()
        title_style = ParagraphStyle(
            "Title2",
            parent=styles["Title"],
            fontSize=18,
            spaceAfter=6,
        )
        heading_style = ParagraphStyle(
            "Heading2Custom",
            parent=styles["Heading2"],
            fontSize=12,
            spaceAfter=4,
            spaceBefore=12,
        )
        normal_style = styles["Normal"]
        small_style = ParagraphStyle(
            "Small",
            parent=styles["Normal"],
            fontSize=8,
            textColor=colors.grey,
        )

        elements = []

        # Header
        elements.append(Paragraph("Cabinet Estimate", title_style))
        elements.append(Spacer(1, 4))

        # Project info
        info_data = []
        if estimate.get("property_address"):
            info_data.append(["Property:", estimate["property_address"]])
        if estimate.get("claim_number"):
            info_data.append(["Claim #:", estimate["claim_number"]])
        if estimate.get("client_name"):
            info_data.append(["Client:", estimate["client_name"]])
        if estimate.get("zip_code"):
            info_data.append(["Zip Code:", estimate["zip_code"]])
        info_data.append(["Date:", datetime.now().strftime("%B %d, %Y")])

        if info_data:
            info_table = Table(info_data, colWidths=[1.2 * inch, 5 * inch])
            info_table.setStyle(TableStyle([
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]))
            elements.append(info_table)

        # Specifications
        elements.append(Paragraph("Specifications", heading_style))
        spec_data = [
            ["Tier:", estimate.get("tier", "-"), "Material:", estimate.get("box_material", "-")],
            ["Finish:", estimate.get("finish", "-"), "Door Style:", estimate.get("door_style", "-")],
            ["Layout:", estimate.get("layout_type", "-"), "Kitchen Size:", f'{estimate.get("kitchen_size_sqft", "-")} sqft'],
        ]
        spec_table = Table(spec_data, colWidths=[1 * inch, 1.8 * inch, 1 * inch, 2.4 * inch])
        spec_table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        elements.append(spec_table)

        # Line items
        elements.append(Paragraph("Itemized Estimate", heading_style))

        line_items = estimate.get("line_items", [])
        if line_items:
            header = ["Description", "Qty", "Unit", "Unit Price", "Total"]
            table_data = [header]

            for li in line_items:
                table_data.append([
                    li.get("description", ""),
                    f'{li.get("quantity", 0):.1f}',
                    li.get("unit", ""),
                    f'${li.get("unit_price", 0):,.2f}',
                    f'${li.get("total", 0):,.2f}',
                ])

            col_widths = [3.2 * inch, 0.6 * inch, 0.5 * inch, 1 * inch, 1 * inch]
            li_table = Table(table_data, colWidths=col_widths)
            li_table.setStyle(TableStyle([
                # Header
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2c3e50")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 9),
                # Body
                ("FONTSIZE", (0, 1), (-1, -1), 8),
                ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                ("ALIGN", (0, 0), (0, -1), "LEFT"),
                # Borders
                ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
                ("LINEBELOW", (0, 0), (-1, 0), 1, colors.HexColor("#2c3e50")),
                # Alternating rows
                *[
                    ("BACKGROUND", (0, i), (-1, i), colors.HexColor("#f8f9fa"))
                    for i in range(2, len(table_data), 2)
                ],
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
            ]))
            elements.append(li_table)

        # Totals
        elements.append(Spacer(1, 12))
        subtotal = estimate.get("subtotal", 0)
        overhead = estimate.get("overhead_amount", 0)
        profit = estimate.get("profit_amount", 0)
        total = estimate.get("total", 0)
        overhead_pct = estimate.get("overhead_pct", 0.10)
        profit_pct = estimate.get("profit_pct", 0.10)

        totals_data = [
            ["Subtotal:", f"${subtotal:,.2f}"],
            [f"Overhead ({overhead_pct*100:.0f}%):", f"${overhead:,.2f}"],
            [f"Profit ({profit_pct*100:.0f}%):", f"${profit:,.2f}"],
            ["TOTAL:", f"${total:,.2f}"],
        ]
        totals_table = Table(totals_data, colWidths=[4.8 * inch, 1.5 * inch])
        totals_table.setStyle(TableStyle([
            ("ALIGN", (0, 0), (0, -1), "RIGHT"),
            ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("FONTSIZE", (0, -1), (-1, -1), 12),
            ("LINEABOVE", (0, -1), (-1, -1), 1, colors.black),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        elements.append(totals_table)

        # Warnings
        warnings = estimate.get("warning_flags", [])
        if warnings:
            elements.append(Spacer(1, 12))
            elements.append(Paragraph("Notes", heading_style))
            for w in warnings:
                elements.append(Paragraph(f"- {w}", small_style))

        # Methodology
        methodology = estimate.get("methodology_notes", "")
        if methodology:
            elements.append(Spacer(1, 12))
            elements.append(Paragraph("Methodology", heading_style))
            for line in methodology.split("\n"):
                elements.append(Paragraph(line, small_style))

        # Cabinet detail appendix
        boxes = estimate.get("boxes", [])
        if boxes:
            elements.append(Spacer(1, 16))
            elements.append(Paragraph("Appendix: Cabinet Box Detail", heading_style))
            box_header = ["Code", "Type", "Width", "Height", "Specialty", "Qty"]
            box_data = [box_header]
            for b in boxes:
                box_data.append([
                    b.get("code", ""),
                    b.get("cab_type", ""),
                    f'{b.get("width_inches", 0)}"',
                    f'{b.get("height_inches", 0)}"',
                    (b.get("specialty_type") or "-").replace("_", " ").title(),
                    str(b.get("qty", 0)),
                ])

            box_table = Table(
                box_data,
                colWidths=[1 * inch, 0.8 * inch, 0.8 * inch, 0.8 * inch, 1.5 * inch, 0.5 * inch],
            )
            box_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#34495e")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
                ("ALIGN", (2, 0), (-1, -1), "CENTER"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
            ]))
            elements.append(box_table)

        doc.build(elements)
        buffer.seek(0)
        return buffer

    # ── Excel Export (for supplier purchase order) ──

    def generate_excel(
        self, estimate: Dict[str, Any], purchase_order: Dict[str, Any]
    ) -> io.BytesIO:
        """Generate an Excel purchase order for cabinet supplier."""
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

        wb = Workbook()

        # ── Sheet 1: Purchase Order ──
        ws = wb.active
        ws.title = "Purchase Order"

        header_font = Font(bold=True, size=11, color="FFFFFF")
        header_fill = PatternFill(start_color="2C3E50", end_color="2C3E50", fill_type="solid")
        thin_border = Border(
            left=Side(style="thin"),
            right=Side(style="thin"),
            top=Side(style="thin"),
            bottom=Side(style="thin"),
        )

        # Title
        ws["A1"] = "Cabinet Purchase Order"
        ws["A1"].font = Font(bold=True, size=14)
        ws["A2"] = f"Property: {estimate.get('property_address', '-')}"
        ws["A3"] = f"Date: {datetime.now().strftime('%B %d, %Y')}"
        ws["A4"] = f"Tier: {estimate.get('tier', '-')} | Material: {estimate.get('box_material', '-')} | Finish: {estimate.get('finish', '-')}"

        # Headers
        headers = ["Code", "Type", "Description", "Width", "Height", "Qty"]
        for col, header in enumerate(headers, 1):
            cell = ws.cell(row=6, column=col, value=header)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center")
            cell.border = thin_border

        # Data
        items = purchase_order.get("items", [])
        for i, item in enumerate(items, 7):
            ws.cell(row=i, column=1, value=item["code"]).border = thin_border
            ws.cell(row=i, column=2, value=item["cab_type"]).border = thin_border
            ws.cell(row=i, column=3, value=item["description"]).border = thin_border
            ws.cell(row=i, column=4, value=f'{item["width_inches"]}"').border = thin_border
            ws.cell(row=i, column=5, value=f'{item["height_inches"]}"').border = thin_border
            qty_cell = ws.cell(row=i, column=6, value=item["qty"])
            qty_cell.border = thin_border
            qty_cell.alignment = Alignment(horizontal="center")

        # Total row
        total_row = 7 + len(items)
        ws.cell(row=total_row, column=5, value="Total Boxes:").font = Font(bold=True)
        ws.cell(row=total_row, column=6, value=purchase_order.get("total_boxes", 0)).font = Font(bold=True)

        # Column widths
        ws.column_dimensions["A"].width = 12
        ws.column_dimensions["B"].width = 10
        ws.column_dimensions["C"].width = 40
        ws.column_dimensions["D"].width = 10
        ws.column_dimensions["E"].width = 10
        ws.column_dimensions["F"].width = 8

        # ── Sheet 2: Estimate Summary ──
        ws2 = wb.create_sheet("Estimate Summary")

        ws2["A1"] = "Cabinet Estimate Summary"
        ws2["A1"].font = Font(bold=True, size=14)

        line_items = estimate.get("line_items", [])
        li_headers = ["Description", "Qty", "Unit", "Unit Price", "Total"]
        for col, header in enumerate(li_headers, 1):
            cell = ws2.cell(row=3, column=col, value=header)
            cell.font = header_font
            cell.fill = header_fill
            cell.border = thin_border

        for i, li in enumerate(line_items, 4):
            ws2.cell(row=i, column=1, value=li.get("description", "")).border = thin_border
            ws2.cell(row=i, column=2, value=round(li.get("quantity", 0), 2)).border = thin_border
            ws2.cell(row=i, column=3, value=li.get("unit", "")).border = thin_border
            ws2.cell(row=i, column=4, value=round(li.get("unit_price", 0), 2)).border = thin_border
            ws2.cell(row=i, column=5, value=round(li.get("total", 0), 2)).border = thin_border

        summary_row = 4 + len(line_items) + 1
        ws2.cell(row=summary_row, column=4, value="Subtotal:").font = Font(bold=True)
        ws2.cell(row=summary_row, column=5, value=estimate.get("subtotal", 0))
        ws2.cell(row=summary_row + 1, column=4, value="Overhead:").font = Font(bold=True)
        ws2.cell(row=summary_row + 1, column=5, value=estimate.get("overhead_amount", 0))
        ws2.cell(row=summary_row + 2, column=4, value="Profit:").font = Font(bold=True)
        ws2.cell(row=summary_row + 2, column=5, value=estimate.get("profit_amount", 0))
        ws2.cell(row=summary_row + 3, column=4, value="TOTAL:").font = Font(bold=True, size=12)
        ws2.cell(row=summary_row + 3, column=5, value=estimate.get("total", 0)).font = Font(bold=True, size=12)

        ws2.column_dimensions["A"].width = 40
        ws2.column_dimensions["B"].width = 10
        ws2.column_dimensions["C"].width = 8
        ws2.column_dimensions["D"].width = 12
        ws2.column_dimensions["E"].width = 12

        buffer = io.BytesIO()
        wb.save(buffer)
        buffer.seek(0)
        return buffer
