"""
PDF Generation Service for React Backend
Separate from Streamlit's pdf_generator.py
"""

from pathlib import Path
from jinja2 import Environment, FileSystemLoader
from datetime import datetime
import os
import sys
from typing import Dict, Any, Optional, List
import json
import re
import logging

# Add GTK+ path for WeasyPrint on Windows (development only)
# In production/Docker, GTK dependencies are installed system-wide
if sys.platform == 'win32' and os.environ.get('ENVIRONMENT', 'development') == 'development':
    gtk_path = r"C:\Program Files\GTK3-Runtime Win64\bin"
    if os.path.exists(gtk_path):
        current_path = os.environ.get('PATH', '')
        os.environ['PATH'] = f"{gtk_path};{current_path}"
        if hasattr(os, 'add_dll_directory'):
            try:
                os.add_dll_directory(gtk_path)
            except Exception:
                pass

try:
    from weasyprint import HTML, CSS
    WEASYPRINT_AVAILABLE = True
except Exception as e:
    print(f"WeasyPrint not available: {e}")
    WEASYPRINT_AVAILABLE = False
    HTML = None
    CSS = None

try:
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import RectangleObject
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import letter
    import io
    PYPDF_AVAILABLE = True
except Exception as e:
    print(f"pypdf/reportlab not available: {e}")
    PYPDF_AVAILABLE = False
    PdfReader = None
    PdfWriter = None
    canvas = None

# Template directory for React backend - correct path to backend/app/templates
TEMPLATE_DIR = Path(__file__).parent.parent.parent / "templates"
TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)

# EWA Template Configuration
# Coordinates are in points (1/72 inch) from bottom-left corner
# Letter size: 612 x 792 points
# Project root is backend/app/common/services -> ../../../../.. -> mj-react-app
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
EWA_TEMPLATE_CONFIG = {
    "template_path": PROJECT_ROOT / "reference" / "EWA - Enter Construction Inc.pdf",
    # Address field: top section "property located at ___________"
    "address_x": 270,
    "address_y": 635,
    # Date fields: "on or about _____________, 20____"
    "date_month_day_x": 278,   # "October 25" part
    "date_month_day_y": 625,
    "date_year_x": 375,         # "25" (year) part after "20"
    "date_year_y": 625,
    "font_size": 8.5,
    "font_name": "Helvetica"
}


class PDFService:
    """Service for generating PDF documents"""
    
    def __init__(self):
        if not WEASYPRINT_AVAILABLE:
            raise RuntimeError("WeasyPrint is not available. Please install it with GTK+ runtime.")
        
        self.template_dir = TEMPLATE_DIR
        self.env = Environment(loader=FileSystemLoader(str(self.template_dir)))
        self._register_filters()
    
    def _register_filters(self):
        """Register custom Jinja2 filters"""
        self.env.filters['format_currency'] = self._format_currency
        self.env.filters['format_number'] = self._format_number
        self.env.filters['format_date'] = self._format_date
        self.env.filters['markdown_to_html'] = self._markdown_to_html
    
    @staticmethod
    def _format_currency(value: float) -> str:
        """Format number as currency with proper negative handling"""
        import logging
        logger = logging.getLogger(__name__)
        
        try:
            if value < 0:
                # Format negative as -$X,XXX.XX instead of $-X,XXX.XX
                result = f"-${abs(value):,.2f}"
                logger.info(f"_format_currency: {value} -> {result}")
                return result
            else:
                result = f"${value:,.2f}"
                return result
        except (ValueError, TypeError) as e:
            logger.error(f"_format_currency error for value {value}: {e}")
            return "$0.00"
    
    @staticmethod
    def _format_number(value: float, decimal_places: int = 2) -> str:
        """Format number with commas and decimal places"""
        try:
            return f"{value:,.{decimal_places}f}"
        except (ValueError, TypeError):
            return "0"
    
    @staticmethod
    def _format_date(value, format: str = "%B %d, %Y") -> str:
        """Format date string - accepts YYYY-MM-DD or MM-DD-YYYY"""
        if isinstance(value, str):
            try:
                # Try YYYY-MM-DD format first
                dt = datetime.strptime(value, "%Y-%m-%d")
                return dt.strftime(format)
            except:
                try:
                    # Try MM-DD-YYYY format
                    dt = datetime.strptime(value, "%m-%d-%Y")
                    return dt.strftime(format)
                except:
                    # Return as-is if neither format works
                    return value
        elif isinstance(value, datetime):
            return value.strftime(format)
        return str(value)
    
    def _markdown_to_html(self, text: str) -> str:
        """Convert basic markdown to HTML for notes section"""
        if not text:
            return ""

        # Preserve line breaks
        text = text.replace('\n', '<br>\n')

        # Convert bold text (**text** or __text__)
        text = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)
        text = re.sub(r'__([^_]+)__', r'<strong>\1</strong>', text)
        
        # Convert italic text (*text* or _text_)
        text = re.sub(r'\*([^*]+)\*', r'<em>\1</em>', text)
        text = re.sub(r'_([^_]+)_', r'<em>\1</em>', text)
        
        # Convert underline text (~~text~~)
        text = re.sub(r'~~([^~]+)~~', r'<u>\1</u>', text)
        
        # Convert headers (### Header)
        text = re.sub(r'^###\s+(.+)$', r'<h4>\1</h4>', text, flags=re.MULTILINE)
        text = re.sub(r'^##\s+(.+)$', r'<h3>\1</h3>', text, flags=re.MULTILINE)
        text = re.sub(r'^#\s+(.+)$', r'<h2>\1</h2>', text, flags=re.MULTILINE)
        
        # Convert unordered lists (- item)
        def convert_ul(match):
            items = match.group(0).split('\n')
            html = '<ul>\n'
            for item in items:
                if item.strip().startswith('- '):
                    html += f'  <li>{item.strip()[2:]}</li>\n'
            html += '</ul>'
            return html
        
        text = re.sub(r'(?:^- .+$\n?)+', convert_ul, text, flags=re.MULTILINE)
        
        # Convert ordered lists (1. item)
        def convert_ol(match):
            items = match.group(0).split('\n')
            html = '<ol>\n'
            for item in items:
                if re.match(r'^\d+\.\s+', item.strip()):
                    html += f'  <li>{re.sub(r"^\d+\.\s+", "", item.strip())}</li>\n'
            html += '</ol>'
            return html
        
        text = re.sub(r'(?:^\d+\.\s+.+$\n?)+', convert_ol, text, flags=re.MULTILINE)
        
        # Wrap paragraphs
        paragraphs = text.split('<br>\n<br>\n')
        text = ''.join(f'<p>{p}</p>' for p in paragraphs if p.strip())
        
        return text
    
    def generate_invoice_pdf(self, data: Dict[str, Any], output_path: str, template_variant: str = "modern") -> str:
        """
        Generate invoice PDF from data

        Args:
            data: Invoice data dictionary
            output_path: Path to save the PDF
            template_variant: Template variant to use (default: "modern")

        Returns:
            Path to the generated PDF
        """
        import logging
        import traceback
        logger = logging.getLogger(__name__)

        logger.info("=== INVOICE PDF GENERATION START ===")
        logger.info(f"Input data keys: {list(data.keys())}")

        # Validate and prepare data
        try:
            logger.info("Preparing invoice context...")
            context = self._prepare_invoice_context(data)
            logger.info(f"Context prepared successfully with {len(context)} keys")
        except Exception as e:
            logger.error(f"Error preparing invoice context: {e}")
            logger.error(traceback.format_exc())
            raise

        # Load template - default to modern template
        template_path = f"invoice/general_invoice.html"
        logger.info(f"Loading template: {template_path}")
        template = self.env.get_template(template_path)
        html_content = template.render(**context)
        logger.info(f"Template rendered, HTML length: {len(html_content)}")

        # general_invoice.html has inline CSS, so no external stylesheets needed
        stylesheets = []

        # Add header/footer CSS - same as estimate PDF generation
        logger.info("Attempting to generate header/footer CSS...")
        try:
            header_footer_css = self._generate_header_footer_css(context)
            stylesheets.append(CSS(string=header_footer_css))
            logger.info("Header/footer CSS added to invoice PDF")
        except Exception as e:
            logger.error(f"Error generating header/footer CSS for invoice: {e}")
            logger.error(traceback.format_exc())

        # Generate PDF
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        HTML(string=html_content).write_pdf(
            output_path,
            stylesheets=stylesheets
        )

        return str(output_path)

    def generate_invoice_html(self, data: Dict[str, Any]) -> str:
        """
        Generate invoice HTML from data (without converting to PDF)

        Args:
            data: Invoice data dictionary

        Returns:
            HTML content as string
        """
        import logging
        logger = logging.getLogger(__name__)

        logger.info("Starting invoice HTML generation...")
        logger.info(f"Input data keys: {list(data.keys())}")

        # Validate and prepare data
        try:
            context = self._prepare_invoice_context(data)
            logger.info(f"Context prepared with keys: {list(context.keys())}")
        except Exception as e:
            logger.error(f"Error preparing context: {e}")
            raise

        # Load template
        try:
            template_path = "invoice/general_invoice.html"
            template = self.env.get_template(template_path)
            logger.info(f"Using {template_path} template")
        except Exception as e:
            logger.error(f"Could not load template: {e}")
            raise

        try:
            html_content = template.render(**context)
            logger.info(f"HTML content rendered, length: {len(html_content)}")
            return html_content
        except Exception as e:
            logger.error(f"Error rendering template: {e}")
            raise

    def generate_estimate_html(self, data: Dict[str, Any], template_type: str = "estimate") -> str:
        """
        Generate estimate HTML from data (without converting to PDF)

        Args:
            data: Estimate data dictionary
            template_type: Template type to use ("estimate" or "invoice")

        Returns:
            HTML content as string
        """
        import logging
        logger = logging.getLogger(__name__)

        logger.info("Starting HTML generation...")
        logger.info(f"Input data keys: {list(data.keys())}")
        logger.info(f"Template type: {template_type}")

        # Validate and prepare data
        try:
            if template_type == "invoice":
                # Use invoice context preparation for Invoice-style Estimate template
                context = self._prepare_invoice_context(data)
            else:
                context = self._prepare_estimate_context(data)

            # All estimates use estimate document type
            context['document_type'] = 'estimate'
            context['document_title'] = 'Estimate'
            logger.info(f"Context prepared with keys: {list(context.keys())}")
        except Exception as e:
            logger.error(f"Error preparing context: {e}")
            raise

        # Load template based on template_type
        try:
            if template_type == "invoice":
                template = self.env.get_template("estimate/invoice_style.html")
                logger.info("Using estimate/invoice_style.html template")
            else:
                template = self.env.get_template("estimate/standard.html")
                logger.info("Using estimate/standard.html template")
        except Exception as e:
            logger.warning(f"Could not load template: {e}, trying fallback")
            try:
                if template_type == "invoice":
                    template = self.env.get_template("invoice/general_invoice.html")
                    logger.info("Using invoice/general_invoice.html fallback template")
                else:
                    template = self.env.get_template("estimate.html")
                    logger.info("Using estimate.html fallback template")
            except Exception as e2:
                logger.error(f"Could not load any template: {e2}")
                raise

        try:
            # Debug: Log the exact context structure before rendering
            if 'sections' in context:
                logger.info(f"Context has {len(context['sections'])} sections before rendering")
                for i, section in enumerate(context['sections']):
                    logger.info(f"  Context Section {i}: type={type(section)}")
                    logger.info(f"    keys: {list(section.keys()) if hasattr(section, 'keys') else 'No keys method'}")
                    if 'items' in section:
                        logger.info(f"    items value type: {type(section['items'])}")
                        logger.info(f"    items is list: {isinstance(section['items'], list)}")

            html_content = template.render(**context)
            logger.info(f"HTML content rendered, length: {len(html_content)}")
            return html_content
        except Exception as e:
            logger.error(f"Error rendering template: {e}")
            raise
    
    def generate_estimate_pdf(self, data: Dict[str, Any], output_path: str, template_type: str = "estimate") -> str:
        """
        Generate estimate PDF from data

        Args:
            data: Estimate data dictionary
            output_path: Path to save the PDF
            template_type: Template type to use ("estimate" or "invoice")

        Returns:
            Path to the generated PDF
        """
        import logging
        logger = logging.getLogger(__name__)

        logger.info("Starting PDF generation...")
        logger.info(f"Input data keys: {list(data.keys())}")
        logger.info(f"Template type: {template_type}")

        # Validate and prepare data
        try:
            if template_type == "invoice":
                # Use invoice context preparation for Invoice-style Estimate template
                context = self._prepare_invoice_context(data)
            else:
                context = self._prepare_estimate_context(data)

            # All estimates use estimate document type
            context['document_type'] = 'estimate'
            context['document_title'] = 'Estimate'
            logger.info(f"Context prepared with keys: {list(context.keys())}")
        except Exception as e:
            logger.error(f"Error preparing context: {e}")
            raise

        # Load template based on template_type
        try:
            if template_type == "invoice":
                template = self.env.get_template("estimate/invoice_style.html")
                logger.info("Using estimate/invoice_style.html template")
            else:
                template = self.env.get_template("estimate/standard.html")
                logger.info("Using estimate/standard.html template")
        except Exception as e:
            logger.warning(f"Could not load template: {e}, trying fallback")
            try:
                if template_type == "invoice":
                    template = self.env.get_template("invoice/general_invoice.html")
                    logger.info("Using invoice/general_invoice.html fallback template")
                else:
                    template = self.env.get_template("estimate.html")
                    logger.info("Using estimate.html fallback template")
            except Exception as e2:
                logger.error(f"Could not load any template: {e2}")
                raise

        try:
            html_content = template.render(**context)
            logger.info(f"HTML content rendered, length: {len(html_content)}")
        except Exception as e:
            logger.error(f"Error rendering template: {e}")
            raise

        # Load CSS based on template type
        stylesheets = []

        if template_type == "invoice":
            # Invoice templates have inline CSS, so no external stylesheets needed
            logger.info("Invoice template uses inline CSS")
        else:
            # Load CSS for estimate template
            css_path = self.template_dir / "estimate" / "estimate.css"
            if not css_path.exists():
                css_path = self.template_dir / "estimate.css"

            if css_path.exists():
                logger.info(f"Loading CSS from: {css_path}")
                try:
                    with open(css_path, 'r', encoding='utf-8') as f:
                        stylesheets.append(CSS(string=f.read()))
                except Exception as e:
                    logger.warning(f"Error loading CSS: {e}")
            else:
                logger.warning(f"No CSS file found at: {css_path}")

        # Add header/footer CSS
        try:
            header_footer_css = self._generate_header_footer_css(context)
            stylesheets.append(CSS(string=header_footer_css))
            logger.info("Header/footer CSS added")
        except Exception as e:
            logger.warning(f"Error generating header/footer CSS: {e}")

        # Generate PDF
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            logger.info(f"Generating PDF at: {output_path}")
            HTML(string=html_content).write_pdf(
                output_path,
                stylesheets=stylesheets
            )
            logger.info("PDF generation completed successfully")
        except Exception as e:
            logger.error(f"Error generating PDF: {e}")
            raise
        
        return str(output_path)
    
    def _prepare_invoice_context(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Prepare and validate invoice context for template"""
        import logging
        logger = logging.getLogger(__name__)
        
        context = data.copy()
        
        # Log sections before and after copy
        logger.info(f"_prepare_invoice_context - sections in input data: {len(data.get('sections', []))}")
        logger.info(f"_prepare_invoice_context - sections in context: {len(context.get('sections', []))}")

        # Set invoice defaults
        context.setdefault('invoice_number', self._generate_invoice_number())
        context.setdefault('date', datetime.now().strftime("%Y-%m-%d"))
        context.setdefault('due_date', datetime.now().strftime("%Y-%m-%d"))

        # Map to template variable names (keep in YYYY-MM-DD format, filter will format for display)
        context['date_of_issue'] = context.get('date', datetime.now().strftime("%Y-%m-%d"))
        context['date_due'] = context.get('due_date', datetime.now().strftime("%Y-%m-%d"))
        
        # Ensure required sections exist with safe defaults
        context.setdefault('company', {'name': 'Unknown Company'})
        context.setdefault('client', {'name': 'Unknown Client'})
        context.setdefault('items', [])

        # Add flat client address fields for page header (two lines)
        # Support both field name variations: street_address/address and zip_code/zip
        client = context.get('client', {})
        company = context.get('company', {})

        client_street = client.get('street_address') or client.get('address', '')
        client_zip = client.get('zip_code') or client.get('zip', '')

        context['client_address_line1'] = client_street
        context['client_address_line2'] = f"{client.get('city', '')}, {client.get('state', '')} {client_zip}".strip(', ')
        context['company_name'] = company.get('name', '')
        context['estimate_number'] = context.get('estimate_number', '')

        # Handle insurance data - map fields to template variables
        # Check if we have insurance data in nested dict OR as direct fields
        if 'insurance' in context and isinstance(context['insurance'], dict) and context['insurance']:
            insurance_data = context['insurance']
            # Map insurance fields to both nested and flat variables for template compatibility
            context['insurance'] = {
                'insurance_company': insurance_data.get('company') or insurance_data.get('insurance_company'),
                'insurance_policy_number': insurance_data.get('policy_number') or insurance_data.get('insurance_policy_number'),
                'insurance_claim_number': insurance_data.get('claim_number') or insurance_data.get('insurance_claim_number'),
                'insurance_deductible': insurance_data.get('deductible') or insurance_data.get('insurance_deductible')
            }
            # Also set flat variables for direct access (both prefixed and simple names)
            context['insurance_company'] = context['insurance']['insurance_company']
            context['insurance_policy_number'] = context['insurance']['insurance_policy_number']
            context['insurance_claim_number'] = context['insurance']['insurance_claim_number']
            context['insurance_deductible'] = context['insurance']['insurance_deductible']

            # Simple field names for Estimate templates (avoiding conflict with company info)
            context['insurance_company_name'] = context['insurance']['insurance_company']
            context['claim_number'] = context['insurance']['insurance_claim_number']
            context['policy_number'] = context['insurance']['insurance_policy_number']
            context['deductible'] = context['insurance']['insurance_deductible']
        else:
            # Check for direct insurance fields (Estimate data format)
            context['insurance'] = {
                'insurance_company': context.get('insurance_company'),
                'insurance_policy_number': context.get('policy_number') or context.get('insurance_policy_number'),
                'insurance_claim_number': context.get('claim_number') or context.get('insurance_claim_number'),
                'insurance_deductible': context.get('deductible') or context.get('insurance_deductible')
            }
            # Set all variable name variations for maximum template compatibility
            context['insurance_company'] = context['insurance']['insurance_company']
            context['insurance_policy_number'] = context['insurance']['insurance_policy_number']
            context['insurance_claim_number'] = context['insurance']['insurance_claim_number']
            context['insurance_deductible'] = context['insurance']['insurance_deductible']

            context['insurance_company_name'] = context['insurance']['insurance_company']
            context['claim_number'] = context['insurance']['insurance_claim_number']
            context['policy_number'] = context['insurance']['insurance_policy_number']
            context['deductible'] = context['insurance']['insurance_deductible']

        # Ensure company and client have safe name values
        if not context['company'].get('name'):
            context['company']['name'] = 'Unknown Company'
        if not context['client'].get('name'):
            context['client']['name'] = 'Unknown Client'
        
        # Calculate totals - matching frontend logic
        items = context.get('items', [])
        items_subtotal = sum(
            float(item.get('quantity', 0)) * float(item.get('rate', 0))
            for item in items
        )

        # Get O&P percentage and calculate O&P amount
        op_percent = float(context.get('op_percent', 0))
        op_amount = items_subtotal * (op_percent / 100)

        # Calculate tax
        context.setdefault('tax_rate', 0)
        tax_method = context.get('tax_method', 'percentage')

        if tax_method == 'percentage':
            # Calculate tax on taxable items + proportional O&P
            taxable_amount = sum(
                float(item.get('quantity', 0)) * float(item.get('rate', 0))
                for item in items
                if item.get('taxable', True)  # Default to taxable
            )
            taxable_ratio = taxable_amount / items_subtotal if items_subtotal > 0 else 0
            taxable_op_amount = op_amount * taxable_ratio
            tax_amount = (taxable_amount + taxable_op_amount) * float(context['tax_rate']) / 100
        else:
            tax_amount = float(context.get('tax_amount', 0))

        # Subtotal includes Items + O&P + Tax
        subtotal = items_subtotal + op_amount + tax_amount

        context.setdefault('discount', 0)
        context.setdefault('shipping', 0)

        # Total is subtotal minus discount plus shipping
        total = subtotal - float(context.get('discount', 0)) + float(context.get('shipping', 0))

        # Ensure discount and shipping are properly set in context
        context['discount'] = float(context.get('discount', 0))
        context['shipping'] = float(context.get('shipping', 0))

        # Set all required context values
        context['items_subtotal'] = items_subtotal
        context['op_percent'] = op_percent
        context['op_amount'] = op_amount
        context['subtotal'] = subtotal
        context['subtotal_total'] = subtotal  # Template expects this name
        context['tax_amount'] = tax_amount
        context['tax_calculated'] = tax_amount  # Template expects this name
        context['total'] = total
        context['total_with_tax'] = total  # Template expects this name
        
        # Modern template expects serviceSections structure (legacy)
        # But prefer 'sections' (new format with subtotals) if available
        if data.get('sections'):
            # Keep sections as-is (don't convert to serviceSections)
            # Template will use 'sections' with subtotals
            logger.info(f"Using 'sections' format with {len(data['sections'])} sections")
            pass  # sections already in context from data.copy()
        elif items:
            # Group items by primary_group if available
            sections_map = {}
            for item in items:
                group_name = item.get('primary_group', 'Services')
                if group_name not in sections_map:
                    sections_map[group_name] = []
                sections_map[group_name].append(item)

            # Convert to sections structure
            context['serviceSections'] = []
            for section_name, section_items in sections_map.items():
                context['serviceSections'].append({
                    'title': section_name,
                    'line_items': [
                        {
                            'name': str(item.get('name', '')),
                            'dec': str(item.get('description', '')) if item.get('description') else None,
                            'note': str(item.get('note', '')) if item.get('note') else None,
                            'qty': float(item.get('quantity', 0)),
                            'unit': str(item.get('unit', 'ea')),
                            'price': float(item.get('rate', 0)),
                            'hide_price': False
                        }
                        for item in section_items
                    ],
                    'subtotal': sum(
                        float(item.get('quantity', 0)) * float(item.get('rate', 0))
                        for item in section_items
                    ),
                    'showSubtotal': len(section_items) > 1
                })
        else:
            context['serviceSections'] = []
            
        # Also keep 'items' for backward compatibility
        context['items'] = [
            {
                'name': str(item.get('name', '')),
                'description': str(item.get('description', '')) if item.get('description') else None,
                'note': str(item.get('note', '')) if item.get('note') else None,
                'quantity': float(item.get('quantity', 0)),
                'unit': str(item.get('unit', 'ea')),
                'rate': float(item.get('rate', 0))
            }
            for item in items
        ]
        
        # Set default values for template variables
        context.setdefault('top_note', '')
        context.setdefault('bottom_note', context.get('notes', ''))
        context.setdefault('disclaimer', '')
        context.setdefault('payments', [])
        context.setdefault('tax_type', 'percentage')

        # Calculate payment totals
        payments = context.get('payments', [])
        total_paid = sum(float(payment.get('amount', 0)) for payment in payments)
        balance_due = total - total_paid

        context['total_paid'] = total_paid
        context['balance_due'] = balance_due
        
        # Convert markdown in notes and payment_terms
        if context.get('notes'):
            context['notes'] = self._markdown_to_html(context['notes'])
        if context.get('payment_terms'):
            context['payment_terms'] = self._markdown_to_html(context['payment_terms'])

        return context
    
    def _prepare_estimate_context(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Prepare and validate estimate context for template"""
        logger = logging.getLogger(__name__)
        context = data.copy()
        
        # Set defaults
        context.setdefault('estimate_number', self._generate_estimate_number())
        context.setdefault('date', datetime.now().strftime("%Y-%m-%d"))
        context.setdefault('valid_until', datetime.now().strftime("%Y-%m-%d"))
        
        # Ensure required sections exist
        company = context.get('company', {})
        client = context.get('client', {})

        # Set defaults for missing required fields but preserve all fields (including logo)
        # Don't clean empty values as templates need to check for their existence
        company.setdefault('name', 'Company Name Not Provided')
        # Don't set default for client name - let template handle it

        context['company'] = company
        context['client'] = client
        context.setdefault('items', [])
        context.setdefault('sections', [])

        # Add flat client address fields for page header (two lines)
        # Support both field name variations: street_address/address and zip_code/zip
        client_street = client.get('street_address') or client.get('address', '')
        client_zip = client.get('zip_code') or client.get('zip', '')

        context['client_address_line1'] = client_street
        context['client_address_line2'] = f"{client.get('city', '')}, {client.get('state', '')} {client_zip}".strip(', ')

        # Add flat company name for page header
        context['company_name'] = company.get('name', '')

        # Handle insurance data - same as invoice context
        if 'insurance' in context and isinstance(context['insurance'], dict) and context['insurance']:
            insurance_data = context['insurance']
            # Map insurance fields to both nested and flat variables for template compatibility
            context['insurance'] = {
                'insurance_company': insurance_data.get('company') or insurance_data.get('insurance_company'),
                'insurance_policy_number': insurance_data.get('policy_number') or insurance_data.get('insurance_policy_number'),
                'insurance_claim_number': insurance_data.get('claim_number') or insurance_data.get('insurance_claim_number'),
                'insurance_deductible': insurance_data.get('deductible') or insurance_data.get('insurance_deductible')
            }
            # Also set flat variables for direct access (both prefixed and simple names)
            context['insurance_company'] = context['insurance']['insurance_company']
            context['insurance_policy_number'] = context['insurance']['insurance_policy_number']
            context['insurance_claim_number'] = context['insurance']['insurance_claim_number']
            context['insurance_deductible'] = context['insurance']['insurance_deductible']

            # Simple field names for Estimate templates
            context['insurance_company_name'] = context['insurance']['insurance_company']
            context['claim_number'] = context['insurance']['insurance_claim_number']
            context['policy_number'] = context['insurance']['insurance_policy_number']
            context['deductible'] = context['insurance']['insurance_deductible']

            logger.info(f"Insurance data processed: company={context.get('insurance_company_name')}, claim={context.get('claim_number')}")
        else:
            # Check for direct insurance fields (Estimate data format)
            logger.info(f"No nested insurance dict, checking direct fields...")
            context['insurance'] = {
                'insurance_company': context.get('insurance_company'),
                'insurance_policy_number': context.get('policy_number') or context.get('insurance_policy_number'),
                'insurance_claim_number': context.get('claim_number') or context.get('insurance_claim_number'),
                'insurance_deductible': context.get('deductible') or context.get('insurance_deductible')
            }
            # Set all variable name variations for maximum template compatibility
            context['insurance_company'] = context['insurance']['insurance_company']
            context['insurance_policy_number'] = context['insurance']['insurance_policy_number']
            context['insurance_claim_number'] = context['insurance']['insurance_claim_number']
            context['insurance_deductible'] = context['insurance']['insurance_deductible']

            context['insurance_company_name'] = context['insurance']['insurance_company']
            context['claim_number'] = context['insurance']['insurance_claim_number']
            context['policy_number'] = context['insurance']['insurance_policy_number']
            context['deductible'] = context['insurance']['insurance_deductible']

            logger.info(f"Direct insurance fields: company={context.get('insurance_company_name')}, claim={context.get('claim_number')}")

        # Log sections data for debugging
        logger.info(f"PDF Service - Processing sections: {len(context.get('sections', []))} sections")
        for i, section in enumerate(context.get('sections', [])):
            logger.info(f"  Section {i+1}: '{section.get('title')}' with {len(section.get('items', []))} items")

        # Process sections and items to preserve HTML content
        if context.get('sections'):
            # Section-based structure
            processed_sections = []
            total_subtotal = 0
            
            for section in context['sections']:
                processed_items = []
                section_subtotal = 0
                
                for item in section.get('items', []):
                    # Preserve HTML in description and note fields
                    processed_item = item.copy()
                    
                    # Keep description HTML as-is (from RichTextEditor)
                    if item.get('description'):
                        processed_item['description'] = item['description']
                    
                    # Keep note HTML as-is (from RichTextEditor)  
                    if item.get('note'):
                        processed_item['note'] = item['note']
                    
                    # Calculate item total
                    quantity = float(item.get('quantity', 0))
                    unit_price = float(item.get('unit_price', item.get('rate', 0)))
                    item_total = quantity * unit_price
                    processed_item['total'] = item_total
                    section_subtotal += item_total
                    
                    processed_items.append(processed_item)
                
                processed_section = {
                    'title': section.get('title', ''),
                    'items': processed_items,
                    'subtotal': section_subtotal,
                    'showSubtotal': section.get('showSubtotal', True)
                }
                processed_sections.append(processed_section)
                total_subtotal += section_subtotal
            
            # Debug logging before assigning to context
            logger.info(f"Final processed_sections count: {len(processed_sections)}")
            for i, section in enumerate(processed_sections):
                logger.info(f"  Final Section {i+1}: type={type(section)}, keys={list(section.keys())}")
                logger.info(f"    items type: {type(section.get('items'))}, items count: {len(section.get('items', []))}")

            context['sections'] = processed_sections
            context['subtotal'] = total_subtotal
        else:
            # Legacy flat items structure
            processed_items = []
            subtotal = 0
            
            for item in context['items']:
                processed_item = item.copy()
                
                # Preserve HTML in description and note fields
                if item.get('description'):
                    processed_item['description'] = item['description']
                if item.get('note'):
                    processed_item['note'] = item['note']
                
                # Calculate item total
                quantity = float(item.get('quantity', 0))
                unit_price = float(item.get('unit_price', item.get('rate', 0)))
                item_total = quantity * unit_price
                processed_item['total'] = item_total
                subtotal += item_total
                
                processed_items.append(processed_item)
            
            context['items'] = processed_items
            context['subtotal'] = subtotal
        
        # Calculate O&P and final totals
        op_percent = float(context.get('op_percent', 0))
        subtotal = context['subtotal']
        op_amount = subtotal * (op_percent / 100)
        
        context['op_percent'] = op_percent
        context['op_amount'] = op_amount
        context.setdefault('tax_rate', 0)
        context['tax_amount'] = subtotal * float(context['tax_rate']) / 100
        context['total'] = subtotal + op_amount + context['tax_amount']
        
        # Preserve HTML in global notes fields
        if context.get('notes'):
            # Don't convert - keep as HTML from RichTextEditor
            pass
        if context.get('terms'):
            # Don't convert - keep as HTML from RichTextEditor  
            pass
        
        return context
    
    def _generate_header_footer_css(self, context: Dict[str, Any]) -> str:
        """Generate CSS for PDF headers and footers"""
        import logging
        logger = logging.getLogger(__name__)

        company = context.get('company', {})
        client = context.get('client', {})

        logger.info(f"=== Header/Footer CSS Generation ===")
        logger.info(f"Company data: {company}")
        logger.info(f"Client data: {client}")

        # Build company info text
        company_lines = []
        if company.get('name'):
            company_lines.append(company['name'])
        if company.get('address'):
            company_lines.append(company['address'])
        if company.get('phone'):
            company_lines.append(f"Tel: {company['phone']}")
        if company.get('email'):
            company_lines.append(company['email'])

        company_text = '\\A '.join(company_lines)

        # Build client info text
        client_lines = []
        if client.get('name'):
            client_lines.append(client['name'])
        if client.get('address'):
            client_lines.append(client['address'])
        if client.get('phone'):
            client_lines.append(f"Tel: {client['phone']}")

        client_text = '\\A '.join(client_lines)

        logger.info(f"Company text for header: {company_text}")
        logger.info(f"Client text for header: {client_text}")

        css = f"""
        @page {{
            size: A4;
            margin: 2.5cm 2cm 2cm 2cm;

            @top-left {{
                content: "{company_text}";
                font-size: 9pt;
                white-space: pre;
                padding-top: 10px;
            }}

            @top-right {{
                content: "{client_text}";
                font-size: 9pt;
                white-space: pre;
                text-align: right;
                padding-top: 10px;
            }}

            @bottom-center {{
                content: "Page " counter(page) " of " counter(pages);
                font-size: 9pt;
            }}

            @bottom-right {{
                content: "Generated on {datetime.now().strftime('%Y-%m-%d')}";
                font-size: 8pt;
                color: #666;
            }}
        }}

        @page :first {{
            margin: 1.2cm 2cm 2cm 2cm;
            @top-left {{
                content: none;
            }}
            @top-right {{
                content: none;
            }}
        }}
        """

        logger.info(f"Generated header/footer CSS length: {len(css)}")
        return css
    
    def _generate_invoice_number(self) -> str:
        """Generate unique invoice number"""
        return f"INV-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    
    def _generate_estimate_number(self) -> str:
        """Generate unique estimate number"""
        return f"EST-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    
    @staticmethod
    def generate_plumber_report_pdf(
        report_data: Dict[str, Any],
        include_photos: bool = True,
        include_financial: bool = True
    ) -> bytes:
        """Generate PDF for Plumber's Report"""
        if not WEASYPRINT_AVAILABLE:
            raise RuntimeError("WeasyPrint is not available")
        
        # Setup template environment
        template_dir = TEMPLATE_DIR / "plumber_report" / "standard"
        env = Environment(loader=FileSystemLoader(str(template_dir)))
        
        # Register filters
        def date_filter(value):
            if isinstance(value, str):
                try:
                    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
                    return dt.strftime("%B %d, %Y")
                except:
                    return value
            return value
        
        def nl2br_filter(value):
            if value:
                return value.replace('\n', '<br>')
            return value
        
        def safe_filter(value):
            # Allow HTML tags for rich text
            return value
        
        env.filters['date'] = date_filter
        env.filters['nl2br'] = nl2br_filter
        env.filters['safe'] = safe_filter
        
        # Prepare context
        context = report_data.copy()
        context['include_photos'] = include_photos
        context['include_financial'] = include_financial
        
        # Load template
        template = env.get_template('template.html')
        html_content = template.render(**context)
        
        # Load CSS
        css_path = template_dir / 'style.css'
        stylesheets = []
        if css_path.exists():
            with open(css_path, 'r', encoding='utf-8') as f:
                stylesheets.append(CSS(string=f.read()))
        
        # Add page numbering CSS
        page_css = """
        @page {
            size: letter;
            margin: 0.75in;
            
            @bottom-center {
                content: "Page " counter(page) " of " counter(pages);
                font-size: 9pt;
                color: #666;
            }
        }
        
        .page:after { content: counter(page); }
        .topage:after { content: counter(pages); }
        """
        stylesheets.append(CSS(string=page_css))
        
        # Generate PDF
        pdf_document = HTML(string=html_content).write_pdf(stylesheets=stylesheets)

        return pdf_document

    def generate_receipt_html(self, data: Dict[str, Any]) -> str:
        """
        Generate receipt HTML from data (without converting to PDF)

        Args:
            data: Receipt data dictionary (same structure as invoice)

        Returns:
            HTML content as string
        """
        import logging
        logger = logging.getLogger(__name__)

        logger.info("Starting receipt HTML generation...")
        logger.info(f"Input data keys: {list(data.keys())}")

        # Validate and prepare data (use same context preparation as invoice)
        try:
            context = self._prepare_invoice_context(data)
            logger.info(f"Context prepared with keys: {list(context.keys())}")
        except Exception as e:
            logger.error(f"Error preparing context: {e}")
            raise

        # Load receipt template
        try:
            template_path = "receipt/general_receipt.html"
            template = self.env.get_template(template_path)
            logger.info(f"Using {template_path} template")
        except Exception as e:
            logger.error(f"Could not load template: {e}")
            raise

        try:
            html_content = template.render(**context)
            logger.info(f"HTML content rendered, length: {len(html_content)}")
            return html_content
        except Exception as e:
            logger.error(f"Error rendering template: {e}")
            raise

    def generate_receipt_pdf(self, data: Dict[str, Any], output_path: str) -> str:
        """
        Generate receipt PDF from data

        Args:
            data: Receipt data dictionary
            output_path: Path to save the PDF

        Returns:
            Path to the generated PDF
        """
        # Validate and prepare data
        context = self._prepare_invoice_context(data)

        # Use provided receipt_number from data, or generate from invoice number as fallback
        if 'receipt_number' in data and data['receipt_number']:
            context['receipt_number'] = data['receipt_number']
        else:
            # Fallback: Generate receipt number from invoice number (INV → RCT)
            invoice_number = context.get('invoice_number', '')
            if invoice_number.startswith('INV-'):
                context['receipt_number'] = invoice_number.replace('INV-', 'RCT-', 1)
            else:
                context['receipt_number'] = 'RCT-' + invoice_number

        # Format dates for receipt display (e.g., "Oct 12, 2025")
        context['date_of_issue_formatted'] = self._format_date_readable(context.get('date_of_issue', ''))
        context['date_due_formatted'] = self._format_date_readable(context.get('date_due', ''))

        # Format payment dates
        if context.get('payments'):
            for payment in context['payments']:
                if payment.get('date'):
                    payment['date_formatted'] = self._format_date_readable(payment['date'])

        # Load receipt template
        template_path = "receipt/general_receipt.html"
        template = self.env.get_template(template_path)

        html_content = template.render(**context)

        # general_receipt.html has inline CSS, so no external stylesheets needed
        stylesheets = []

        # Add header/footer CSS
        header_footer_css = self._generate_header_footer_css(context)
        stylesheets.append(CSS(string=header_footer_css))

        # Generate PDF
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        HTML(string=html_content).write_pdf(
            output_path,
            stylesheets=stylesheets
        )

        return str(output_path)

    def _format_date_readable(self, date_str: str) -> str:
        """
        Format date string to readable format (e.g., "Oct 12, 2025")

        Args:
            date_str: Date string in ISO format

        Returns:
            Formatted date string
        """
        if not date_str:
            return ''

        try:
            # Parse ISO datetime string
            if 'T' in str(date_str):
                dt = datetime.fromisoformat(str(date_str).replace('Z', '+00:00'))
            else:
                dt = datetime.strptime(str(date_str), '%Y-%m-%d')

            # Format as "Oct 12, 2025"
            return dt.strftime('%b %d, %Y')
        except Exception as e:
            # Return original if parsing fails
            return str(date_str)


def generate_images_pdf(image_paths: list[str], output_path: str) -> str:
    """
    Generate PDF from images with each image taking up one full page.
    No margins - images fill the entire page.

    Args:
        image_paths: List of paths to image files
        output_path: Path to save the generated PDF

    Returns:
        Path to the generated PDF
    """
    if not WEASYPRINT_AVAILABLE:
        raise RuntimeError("WeasyPrint is not available")

    from PIL import Image

    # HTML template for each image - fill entire page with no margins
    html_template = """
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            @page {{
                size: letter;
                margin: 0;
            }}
            body {{
                margin: 0;
                padding: 0;
            }}
            .page {{
                width: 100%;
                height: 100vh;
                page-break-after: always;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
            }}
            .page:last-child {{
                page-break-after: auto;
            }}
            .page img {{
                width: 100%;
                height: 100%;
                object-fit: contain;
            }}
        </style>
    </head>
    <body>
    {pages}
    </body>
    </html>
    """

    # Generate HTML for each image
    pages_html = []
    for img_path in image_paths:
        # Convert image to base64 for embedding
        import base64
        with open(img_path, 'rb') as img_file:
            img_data = base64.b64encode(img_file.read()).decode('utf-8')

        # Determine image mime type
        img_ext = Path(img_path).suffix.lower()
        mime_types = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp'
        }
        mime_type = mime_types.get(img_ext, 'image/jpeg')

        # Create page HTML
        page_html = f'''
        <div class="page">
            <img src="data:{mime_type};base64,{img_data}" />
        </div>
        '''
        pages_html.append(page_html)

    # Combine all pages
    html_content = html_template.format(pages='\n'.join(pages_html))

    # Generate PDF
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    HTML(string=html_content).write_pdf(output_path)

    return str(output_path)


def generate_water_mitigation_report_pdf(
    job_data: Dict[str, Any],
    config: Dict[str, Any],
    photos: List[Dict[str, Any]],
    output_path: str,
    company_data: Optional[Dict[str, Any]] = None
) -> str:
    """
    Generate professional Water Mitigation photo report PDF

    Args:
        job_data: Water mitigation job data
        config: Report configuration (cover page, sections)
        photos: List of all photos for the job
        output_path: Path to save the PDF
        company_data: Company information (name, logo, etc.)

    Returns:
        Path to the generated PDF
    """
    if not WEASYPRINT_AVAILABLE:
        raise RuntimeError("WeasyPrint is not available")

    from datetime import datetime
    import logging
    import base64

    logger = logging.getLogger(__name__)

    # Setup template environment
    template_dir = TEMPLATE_DIR / "water-mitigation"
    env = Environment(loader=FileSystemLoader(str(template_dir)))

    # Register filters
    def format_date_filter(value, format="%B %d, %Y"):
        """Format date string"""
        if not value:
            return ""
        if isinstance(value, str):
            try:
                dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
                return dt.strftime(format)
            except:
                return value
        elif isinstance(value, datetime):
            return value.strftime(format)
        return str(value)

    env.filters['format_date'] = format_date_filter

    # Prepare context
    context = {
        # Cover page
        'cover_title': config.get('cover_title', 'Water Mitigation Report'),
        'cover_description': config.get('cover_description', ''),
        'property_address': job_data.get('property_address', ''),
        'client_name': job_data.get('homeowner_name', ''),
        'date_of_loss': job_data.get('date_of_loss'),
        'report_date': datetime.now().isoformat(),

        # Company info
        'company_name': company_data.get('name', '') if company_data else '',
        'company_logo': None,  # Will be set below if available

        # Sections
        'sections': []
    }

    # Process company logo
    if company_data and company_data.get('logo'):
        logo_path = company_data['logo']
        if Path(logo_path).exists():
            try:
                with open(logo_path, 'rb') as f:
                    logo_data = base64.b64encode(f.read()).decode('utf-8')
                    logo_ext = Path(logo_path).suffix.lower()
                    mime_types = {
                        '.jpg': 'image/jpeg',
                        '.jpeg': 'image/jpeg',
                        '.png': 'image/png',
                        '.gif': 'image/gif'
                    }
                    mime_type = mime_types.get(logo_ext, 'image/png')
                    context['company_logo'] = f"data:{mime_type};base64,{logo_data}"
            except Exception as e:
                logger.warning(f"Failed to load company logo: {e}")

    # Create photo lookup dictionary
    photo_dict = {photo['id']: photo for photo in photos}

    # Define photos per page for each layout
    photos_per_page = {
        'single': 1,
        'two': 2,
        'three': 3,
        'four': 4,
        'six': 6
    }

    # Process sections
    for section_data in config.get('sections', []):
        section_title = section_data.get('title', 'Section')
        section_summary = section_data.get('summary', '')
        layout = section_data.get('layout', 'four')
        max_photos = photos_per_page.get(layout, 4)

        # Collect all photos for this section
        all_photos = []
        for photo_meta in section_data.get('photos', []):
            photo_id = photo_meta.get('photo_id')
            if photo_id not in photo_dict:
                continue

            photo = photo_dict[photo_id]
            photo_file_path = Path(photo['file_path'])

            if not photo_file_path.exists():
                logger.warning(f"Photo file not found: {photo_file_path}")
                continue

            # Embed photo as base64
            try:
                with open(photo_file_path, 'rb') as f:
                    img_data = base64.b64encode(f.read()).decode('utf-8')

                mime_type = photo.get('mime_type', 'image/jpeg')
                embedded_path = f"data:{mime_type};base64,{img_data}"

                all_photos.append({
                    'file_path': embedded_path,
                    'caption': photo_meta.get('caption', ''),
                    'title': photo.get('title', ''),
                    'description': photo.get('description', ''),
                    'captured_date': photo.get('captured_date'),
                    'show_date': photo_meta.get('show_date', True),
                    'show_description': photo_meta.get('show_description', True)
                })
            except Exception as e:
                logger.error(f"Failed to process photo {photo_id}: {e}")

        # Split photos into multiple pages if needed
        if all_photos:
            for page_num, i in enumerate(range(0, len(all_photos), max_photos), start=1):
                page_photos = all_photos[i:i + max_photos]
                page_title = section_title
                if len(all_photos) > max_photos:
                    page_title = f"{section_title} (Page {page_num})"

                context['sections'].append({
                    'title': page_title,
                    'summary': section_summary if page_num == 1 else '',  # Only show summary on first page
                    'layout': layout,
                    'photos': page_photos
                })

    logger.info(f"Generating report with {len(context['sections'])} sections")

    # Load template
    template = env.get_template('photo_report.html')
    html_content = template.render(**context)

    # Load CSS
    css_path = template_dir / 'photo_report.css'
    stylesheets = []
    if css_path.exists():
        with open(css_path, 'r', encoding='utf-8') as f:
            stylesheets.append(CSS(string=f.read()))

    # Generate PDF
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    HTML(string=html_content).write_pdf(
        output_path,
        stylesheets=stylesheets
    )

    logger.info(f"Report PDF generated: {output_path}")
    return str(output_path)


def generate_ewa_pdf(
    job_address: str,
    date_of_loss: str,
    photo_path: str,
    output_path: str
) -> str:
    """
    Generate EWA (Emergency Work Agreement & Authorization) PDF

    Creates a PDF with:
    1. First page: EWA template with overlaid job address and date of loss
    2. Second page: Selected photo (full page)

    Args:
        job_address: Property address to overlay on template
        date_of_loss: Date of loss in ISO format (will be formatted as "January 23, 2025")
        photo_path: Path to photo file to append as second page
        output_path: Path to save the generated PDF

    Returns:
        Path to the generated PDF

    Raises:
        RuntimeError: If pypdf or reportlab is not available
        FileNotFoundError: If template or photo file not found
    """
    if not PYPDF_AVAILABLE:
        raise RuntimeError("pypdf and reportlab are required for EWA PDF generation")

    import logging
    logger = logging.getLogger(__name__)

    # Validate template exists
    template_path = EWA_TEMPLATE_CONFIG["template_path"]
    if not template_path.exists():
        raise FileNotFoundError(f"EWA template not found: {template_path}")

    # Validate photo exists
    photo_path = Path(photo_path)
    if not photo_path.exists():
        raise FileNotFoundError(f"Photo not found: {photo_path}")

    logger.info(f"Generating EWA PDF: {output_path}")
    logger.info(f"  Address: {job_address}")
    logger.info(f"  Date of Loss: {date_of_loss}")
    logger.info(f"  Photo: {photo_path}")

    # Format date_of_loss - split into "Month Day" and "YY" parts
    try:
        if isinstance(date_of_loss, str):
            dt = datetime.fromisoformat(date_of_loss.replace('Z', '+00:00'))
        else:
            dt = date_of_loss
        # "October 25" format for first blank
        date_month_day = dt.strftime("%B %d")
        # "25" format for year (last 2 digits) for second blank after "20"
        date_year = dt.strftime("%y")
    except Exception as e:
        logger.warning(f"Failed to format date: {e}, using as-is")
        date_month_day = str(date_of_loss)
        date_year = ""

    # Step 1: Create overlay PDF with text fields
    overlay_buffer = io.BytesIO()
    c = canvas.Canvas(overlay_buffer, pagesize=letter)

    # Set font and text color
    c.setFont(EWA_TEMPLATE_CONFIG["font_name"], EWA_TEMPLATE_CONFIG["font_size"])
    c.setFillColorRGB(0, 0, 0)  # Black color
    c.setStrokeColorRGB(0, 0, 0)

    # Log what we're drawing
    logger.info(f"Drawing address at ({EWA_TEMPLATE_CONFIG['address_x']}, {EWA_TEMPLATE_CONFIG['address_y']}): '{job_address}'")
    logger.info(f"Drawing date (month/day) at ({EWA_TEMPLATE_CONFIG['date_month_day_x']}, {EWA_TEMPLATE_CONFIG['date_month_day_y']}): '{date_month_day}'")
    logger.info(f"Drawing date (year) at ({EWA_TEMPLATE_CONFIG['date_year_x']}, {EWA_TEMPLATE_CONFIG['date_year_y']}): '{date_year}'")

    # Draw address
    c.drawString(
        EWA_TEMPLATE_CONFIG["address_x"],
        EWA_TEMPLATE_CONFIG["address_y"],
        job_address
    )

    # Draw date - month and day part (e.g., "October 25")
    c.drawString(
        EWA_TEMPLATE_CONFIG["date_month_day_x"],
        EWA_TEMPLATE_CONFIG["date_month_day_y"],
        date_month_day
    )

    # Draw date - year part (e.g., "25" for 2025)
    c.drawString(
        EWA_TEMPLATE_CONFIG["date_year_x"],
        EWA_TEMPLATE_CONFIG["date_year_y"],
        date_year
    )

    c.save()
    overlay_buffer.seek(0)

    # Step 2: Read template PDF and overlay
    template_reader = PdfReader(str(template_path))
    overlay_reader = PdfReader(overlay_buffer)

    # Create writer and add first page with overlay
    writer = PdfWriter()

    # Get overlay page first
    overlay_page = overlay_reader.pages[0]

    # Get template page and merge it UNDER the overlay
    # This ensures text is on top of the template
    template_page = template_reader.pages[0]
    overlay_page.merge_page(template_page)

    writer.add_page(overlay_page)

    # Step 3: Convert photo to PDF page and append
    # Create a temporary PDF with the photo
    photo_pdf_buffer = io.BytesIO()
    photo_canvas = canvas.Canvas(photo_pdf_buffer, pagesize=letter)

    # Get image dimensions
    from PIL import Image
    img = Image.open(photo_path)
    img_width, img_height = img.size

    # Calculate scaling to fit letter size (612 x 792 points) while maintaining aspect ratio
    page_width, page_height = letter

    # Calculate scale factors
    width_scale = page_width / img_width
    height_scale = page_height / img_height
    scale = min(width_scale, height_scale)

    # Calculate centered position
    scaled_width = img_width * scale
    scaled_height = img_height * scale
    x = (page_width - scaled_width) / 2
    y = (page_height - scaled_height) / 2

    # Draw image centered on page
    photo_canvas.drawImage(
        str(photo_path),
        x, y,
        width=scaled_width,
        height=scaled_height,
        preserveAspectRatio=True
    )
    photo_canvas.save()
    photo_pdf_buffer.seek(0)

    # Add photo page to writer
    photo_reader = PdfReader(photo_pdf_buffer)
    writer.add_page(photo_reader.pages[0])

    # Step 4: Write final PDF
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, 'wb') as output_file:
        writer.write(output_file)

    logger.info(f"EWA PDF generated successfully: {output_path}")
    return str(output_path)


# Singleton instance
pdf_service = PDFService() if WEASYPRINT_AVAILABLE else None