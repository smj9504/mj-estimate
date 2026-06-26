"""
PDF Generation Service for React Backend
Separate from Streamlit's pdf_generator.py
"""

import io
import json
import logging
import os
import re
import sys
from datetime import datetime, date
from html import escape as html_escape
from pathlib import Path
from typing import Any, Dict, List, Optional

from jinja2 import Environment, FileSystemLoader

# Month names constant to avoid Windows locale/encoding issues with strftime %B
MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
]


def safe_strftime(dt: datetime, fmt: str) -> str:
    """
    Format datetime safely, avoiding Windows strftime encoding issues.

    On Windows, strftime with %B (full month name) can produce corrupted
    characters due to locale/encoding issues. This function manually
    replaces %B with the English month name.

    Args:
        dt: datetime object to format
        fmt: strftime format string

    Returns:
        Formatted date string
    """
    if "%B" in fmt:
        month_name = MONTH_NAMES[dt.month]
        fmt = fmt.replace("%B", month_name)
    return dt.strftime(fmt)


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

# Lazy-load PDF libraries to speed up server startup (~1.5s saved)
# WeasyPrint, reportlab, pypdf are loaded on first use instead of import time
WEASYPRINT_AVAILABLE = None  # None = not checked yet
PYPDF_AVAILABLE = None
HTML = None
CSS = None
PdfReader = None
PdfWriter = None
RectangleObject = None
canvas = None
letter = None


def _ensure_weasyprint():
    global WEASYPRINT_AVAILABLE, HTML, CSS
    if WEASYPRINT_AVAILABLE is not None:
        return
    try:
        from weasyprint import CSS as _CSS, HTML as _HTML
        HTML = _HTML
        CSS = _CSS
        WEASYPRINT_AVAILABLE = True
    except Exception as e:
        print(f"WeasyPrint not available: {e}")
        WEASYPRINT_AVAILABLE = False


def _ensure_pypdf():
    global PYPDF_AVAILABLE, PdfReader, PdfWriter
    global RectangleObject, canvas, letter
    if PYPDF_AVAILABLE is not None:
        return
    try:
        import io  # noqa: F811
        from pypdf import PdfReader as _PR, PdfWriter as _PW
        from pypdf.generic import RectangleObject as _RO
        from reportlab.lib.pagesizes import letter as _letter
        from reportlab.pdfgen import canvas as _canvas
        PdfReader = _PR
        PdfWriter = _PW
        RectangleObject = _RO
        canvas = _canvas
        letter = _letter
        PYPDF_AVAILABLE = True
    except Exception as e:
        print(f"pypdf/reportlab not available: {e}")
        PYPDF_AVAILABLE = False

# Template directory for React backend - correct path to backend/app/templates
TEMPLATE_DIR = Path(__file__).parent.parent.parent / "templates"
TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)

# Locale-independent English month names for PDF/HTML templates
_EN_MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
]

def _format_date_en(dt: datetime) -> str:
    """Format a datetime as 'Month DD, YYYY' using English month names regardless of system locale."""
    return f"{_EN_MONTHS[dt.month - 1]} {dt.day}, {dt.year}"

# EWA Template Configuration
# Coordinates are in points (1/72 inch) from bottom-left corner
# Letter size: 612 x 792 points
# Project root is backend/app/common/services -> ../../../../.. -> mj-react-app
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
EWA_TEMPLATES_DIR = PROJECT_ROOT / "reference" / "ewa_templates"

# Company-specific EWA template configurations
# Each company can have different template PDF and field positions
EWA_TEMPLATE_CONFIGS = {
    # Enter Construction (default)
    "ENTER": {
        "template_path": EWA_TEMPLATES_DIR / "ENTER.pdf",
        "address_x": 270,
        "address_y": 635,
        "date_month_day_x": 278,
        "date_month_day_y": 625,
        "date_year_x": 375,
        "date_year_y": 625,
        "font_size": 8.5,
        "font_name": "Helvetica"
    },
    # Bethany Construction (company_code: BEYM)
    "BEYM": {
        "template_path": EWA_TEMPLATES_DIR / "BETHANY.pdf",
        "address_x": 270,  # Adjust coordinates as needed for Bethany template
        "address_y": 635,
        "date_month_day_x": 278,
        "date_month_day_y": 625,
        "date_year_x": 375,
        "date_year_y": 625,
        "font_size": 8.5,
        "font_name": "Helvetica"
    },
}

# Default template config (fallback to Enter Construction)
EWA_DEFAULT_COMPANY_CODE = "ENTER"

def get_ewa_template_config(company_code: Optional[str] = None) -> dict:
    """
    Get EWA template configuration for a specific company.

    Args:
        company_code: Company code (e.g., "ENTER", "BETHANY")
                     If None or not found, returns default template config.

    Returns:
        Template configuration dictionary
    """
    if company_code and company_code.upper() in EWA_TEMPLATE_CONFIGS:
        config = EWA_TEMPLATE_CONFIGS[company_code.upper()]
        # Verify template file exists
        if config["template_path"].exists():
            return config
        else:
            logging.warning(f"EWA template not found for {company_code}: {config['template_path']}, using default")

    # Return default template
    return EWA_TEMPLATE_CONFIGS[EWA_DEFAULT_COMPANY_CODE]

# Legacy compatibility - single template config (for backward compatibility)
EWA_TEMPLATE_CONFIG = EWA_TEMPLATE_CONFIGS[EWA_DEFAULT_COMPANY_CODE]


class PDFService:
    """Service for generating PDF documents"""
    
    def __init__(self):
        _ensure_weasyprint()
        if not WEASYPRINT_AVAILABLE:
            raise RuntimeError("WeasyPrint is not available. Please install it with GTK+ runtime.")
        
        self.template_dir = TEMPLATE_DIR
        self.env = Environment(loader=FileSystemLoader(str(self.template_dir)))
        self._register_filters()
    
    def _register_filters(self):
        """Register custom Jinja2 filters"""
        self.env.filters['format_currency'] = self._format_currency
        self.env.filters['format_number'] = self._format_number
        self.env.filters['format_number_smart'] = self._format_number_smart
        self.env.filters['format_quantity'] = self._format_quantity
        self.env.filters['format_date'] = self._format_date
        self.env.filters['markdown_to_html'] = self._markdown_to_html
    
    @staticmethod
    def _format_currency(value: float) -> str:
        """Format number as currency with proper negative handling.
        Shows 2 decimal places if decimal part exists, otherwise shows integer only.
        Examples: 94.24 -> $94.24, 20.10 -> $20.10, 78.0 -> $78, 10.0 -> $10
        """
        import logging
        logger = logging.getLogger(__name__)
        
        try:
            # Check if value has decimal part (with small epsilon for floating point precision)
            has_decimal = abs(value % 1) > 1e-10
            
            if value < 0:
                # Format negative as -$X,XXX.XX instead of $-X,XXX.XX
                if has_decimal:
                    result = f"-${abs(value):,.2f}"
                else:
                    result = f"-${abs(int(value)):,}"
                logger.info(f"_format_currency: {value} -> {result}")
                return result
            else:
                if has_decimal:
                    result = f"${value:,.2f}"
                else:
                    result = f"${int(value):,}"
                return result
        except (ValueError, TypeError) as e:
            logger.error(f"_format_currency error for value {value}: {e}")
            return "$0"
    
    @staticmethod
    def _format_number(value: float, decimal_places: int = 2) -> str:
        """Format number with commas and decimal places.
        Shows decimal places if decimal part exists, otherwise shows integer only.
        Examples: 94.24 -> 94.24, 20.10 -> 20.10, 78.0 -> 78, 10.0 -> 10
        """
        try:
            # Check if value has decimal part (with small epsilon for floating point precision)
            has_decimal = abs(value % 1) > 1e-10
            
            if has_decimal:
                return f"{value:,.{decimal_places}f}"
            else:
                return f"{int(value):,}"
        except (ValueError, TypeError):
            return "0"
    
    @staticmethod
    def _format_number_smart(value: float) -> str:
        """Format number smartly: shows 2 decimal places if decimal part exists, otherwise shows integer only.
        This is the same as format_number but without the dollar sign, for use in templates with $ prefix.
        Examples: 94.24 -> 94.24, 20.10 -> 20.10, 78.0 -> 78, 10.0 -> 10
        """
        return PDFService._format_number(value, decimal_places=2)
    
    @staticmethod
    def _format_quantity(value: float) -> str:
        """Format quantity: shows decimal places if decimal part exists, otherwise shows integer only.
        No thousand separators (commas) for quantities.
        Examples: 94.24 -> 94.24, 20.10 -> 20.10, 78.0 -> 78, 10.0 -> 10
        """
        try:
            num_value = float(value)
            # Check if value has decimal part (with small epsilon for floating point precision)
            has_decimal = abs(num_value % 1) > 1e-10
            
            if has_decimal:
                return f"{num_value:.2f}"
            else:
                return f"{int(num_value)}"
        except (ValueError, TypeError):
            return "0"
    
    @staticmethod
    def _format_date(value, output_format: str = "%B %d, %Y") -> str:
        """Format date string - accepts various date formats

        Supported input formats:
        - YYYY-MM-DD (ISO format)
        - MM-DD-YYYY
        - M-D-YYYY (without leading zeros)
        - MM/DD/YYYY
        - M/D/YYYY (without leading zeros)
        - YYYY/MM/DD

        Note: Uses safe_strftime to avoid Windows encoding issues.
        """
        if not value:
            return ""

        if isinstance(value, datetime):
            return safe_strftime(value, output_format)

        if isinstance(value, str):
            value = value.strip()
            if not value:
                return ""

            # List of formats to try (most specific first)
            date_formats = [
                "%Y-%m-%d",      # 2026-02-06 (ISO format)
                "%m-%d-%Y",      # 02-06-2026
                "%m/%d/%Y",      # 02/06/2026
                "%Y/%m/%d",      # 2026/02/06
                "%d-%m-%Y",      # 06-02-2026 (European)
                "%d/%m/%Y",      # 06/02/2026 (European)
            ]

            for fmt in date_formats:
                try:
                    dt = datetime.strptime(value, fmt)
                    return safe_strftime(dt, output_format)
                except ValueError:
                    continue

            # If none of the strict formats work, try dateutil parser
            try:
                from dateutil import parser as dateutil_parser
                dt = dateutil_parser.parse(value)
                return safe_strftime(dt, output_format)
            except Exception:
                pass

            # Return original value if all parsing fails
            return value

        return str(value) if value else ""
    
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

        # Strip logo for subprocess PDF (base64 logos crash WeasyPrint
        # subprocess on Windows). Logo still renders fine in HTML preview.
        if 'company' in context and isinstance(context['company'], dict):
            context['company']['logo'] = None

        # Load template - select based on variant
        variant_suffix = f"_{template_variant}" if template_variant and template_variant != "a" else ""
        template_path = f"invoice/general_invoice{variant_suffix}.html"
        logger.info(f"Loading template: {template_path} (variant={template_variant})")
        template = self.env.get_template(template_path)
        html_content = template.render(**context)
        logger.info(f"Template rendered, HTML length: {len(html_content)}")

        # Collect CSS strings for subprocess
        css_strings = []

        # Add invoice-specific header/footer CSS
        logger.info("Generating invoice header/footer CSS...")
        try:
            hf_css = self._generate_invoice_header_footer_css(context)
            css_strings.append(hf_css)
            logger.info("Invoice header/footer CSS added")
        except Exception as e:
            logger.error(f"Error generating header/footer CSS: {e}")
            logger.error(traceback.format_exc())

        # Generate PDF via subprocess
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        logger.info("Starting write_pdf for invoice (subprocess)...")
        try:
            self._write_pdf_subprocess(
                html_content, css_strings, str(output_path)
            )
            logger.info(
                f"write_pdf completed. File size: "
                f"{output_path.stat().st_size} bytes"
            )
        except Exception as e:
            logger.error(f"write_pdf FAILED: {e}")
            logger.error(traceback.format_exc())
            raise

        return str(output_path)

    def _write_pdf_subprocess(
        self, html_content: str, css_strings: list, output_path: str
    ) -> None:
        """Run WeasyPrint write_pdf in a separate script file to avoid
        GLib/event-loop conflicts in the uvicorn process.

        Args:
            html_content: HTML string to render
            css_strings: List of raw CSS strings
            output_path: Output PDF file path
        """
        import subprocess
        import tempfile
        import json

        logger = logging.getLogger(__name__)

        # Save HTML to temp file
        with tempfile.NamedTemporaryFile(
            mode='w', suffix='.html', delete=False, encoding='utf-8'
        ) as f:
            f.write(html_content)
            html_path = f.name

        # Save CSS strings to temp file
        css_path = None
        if css_strings:
            with tempfile.NamedTemporaryFile(
                mode='w', suffix='.json', delete=False, encoding='utf-8'
            ) as f:
                json.dump(css_strings, f)
                css_path = f.name

        # Write a standalone script file instead of -c inline
        script_content = """
import sys, json, os
os.environ['FONTCONFIG_PATH'] = os.path.join(
    os.path.expanduser('~'), 'anaconda3', 'Library', 'etc', 'fonts'
)
os.environ.pop('FONTCONFIG_FILE', None)

html_path = sys.argv[1]
output_path = sys.argv[2]
css_path = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != 'None' else None

from weasyprint import HTML, CSS

stylesheets = []
if css_path:
    with open(css_path, 'r', encoding='utf-8') as f:
        for s in json.load(f):
            stylesheets.append(CSS(string=s))

with open(html_path, 'r', encoding='utf-8') as f:
    html = f.read()

HTML(string=html).write_pdf(output_path, stylesheets=stylesheets)
print(os.path.getsize(output_path))
"""
        with tempfile.NamedTemporaryFile(
            mode='w', suffix='.py', delete=False, encoding='utf-8'
        ) as f:
            f.write(script_content)
            script_path = f.name

        try:
            import sys
            python_exe = sys.executable

            cmd = [python_exe, script_path, html_path, output_path]
            if css_path:
                cmd.append(css_path)
            else:
                cmd.append('None')

            logger.info(
                f"Subprocess PDF: html={len(html_content)} chars, "
                f"css_count={len(css_strings)}"
            )

            # Use clean environment to avoid inheriting GLib state
            env = os.environ.copy()
            env.pop('G_SLICE', None)
            env['FONTCONFIG_PATH'] = os.path.join(
                os.path.expanduser('~'),
                'anaconda3', 'Library', 'etc', 'fonts'
            )
            env.pop('FONTCONFIG_FILE', None)

            result = subprocess.run(
                cmd, capture_output=True, text=True,
                timeout=60, env=env
            )

            logger.info(
                f"Subprocess result: rc={result.returncode}, "
                f"stdout={result.stdout.strip()}, "
                f"stderr={result.stderr[:300] if result.stderr else ''}"
            )

            out_path = Path(output_path)
            if not out_path.exists() or out_path.stat().st_size == 0:
                raise RuntimeError(
                    f"PDF subprocess failed (rc={result.returncode}): "
                    f"{result.stderr[:500]}"
                )

            # Validate PDF header
            with open(output_path, 'rb') as f:
                header = f.read(5)
            if header != b'%PDF-':
                raise RuntimeError(
                    f"Invalid PDF output (header={header!r})"
                )

        finally:
            for p in [html_path, css_path, script_path]:
                if p:
                    try:
                        os.unlink(p)
                    except Exception:
                        pass

    def generate_invoice_html(self, data: Dict[str, Any], template_variant: str = "a") -> str:
        """
        Generate invoice HTML from data (without converting to PDF)

        Args:
            data: Invoice data dictionary
            template_variant: Template variant ('a', 'b', or 'c')

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
            variant_suffix = f"_{template_variant}" if template_variant and template_variant != "a" else ""
            template_path = f"invoice/general_invoice{variant_suffix}.html"
            template = self.env.get_template(template_path)
            logger.info(f"Using {template_path} template (variant={template_variant})")
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
        context.setdefault('company', {})
        context.setdefault('client', {})
        context.setdefault('items', [])

        # Add flat client address fields for page header (two lines)
        # Support both field name variations: street_address/address and zip_code/zip
        client = context.get('client', {})
        company = context.get('company', {})

        client_street = client.get('street_address') or client.get('address', '')
        client_zip = client.get('zip_code') or client.get('zip', '')

        context['client_address_line1'] = client_street
        context['client_address_line2'] = f"{client.get('city', '')}, {client.get('state', '')} {client_zip}".strip(', ')
        # Add full client_address for title tag (using direct field if available, otherwise construct from parts)
        context['client_address'] = context.get('client_address') or client_street
        logger.info(f"=== Client Address Debug ===")
        logger.info(f"client_street: {client_street}")
        logger.info(f"context['client_address']: {context.get('client_address')}")
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
        # Don't set default for client name - let template handle empty values
        
        # Calculate totals - matching frontend logic
        items = context.get('items', [])
        sections = context.get('sections', [])
        if items:
            items_subtotal = sum(
                float(item.get('quantity', 0)) * float(item.get('rate', 0))
                for item in items
            )
        elif sections:
            # When items is empty but sections exist (e.g. roofing invoice),
            # calculate subtotal from sections
            items_subtotal = sum(
                float(s.get('subtotal', 0)) or sum(
                    float(i.get('quantity', 0)) * float(i.get('rate', 0))
                    for i in s.get('items', [])
                )
                for s in sections
            )
        else:
            items_subtotal = 0

        # Process adjustments if provided (new flexible system)
        adjustments = context.get('adjustments', [])
        current_subtotal = items_subtotal
        calculated_adjustments = []
        
        if adjustments and len(adjustments) > 0:
            # Sort adjustments by order
            sorted_adjustments = sorted(adjustments, key=lambda x: x.get('order', 999))
            
            for adj in sorted_adjustments:
                percentage = float(adj.get('percentage', 0))
                fixed_amount = adj.get('fixed_amount')
                adj_type = adj.get('type', 'add')
                adj_name = adj.get('name', 'Adjustment')

                # Calculate adjustment amount: use fixed_amount when percentage is 0
                if percentage != 0:
                    adj_amount = current_subtotal * (abs(percentage) / 100)
                else:
                    adj_amount = abs(float(fixed_amount)) if fixed_amount else 0

                # Apply adjustment
                if adj_type == 'subtract' or percentage < 0:
                    current_subtotal -= adj_amount
                else:
                    current_subtotal += adj_amount

                calculated_adjustments.append({
                    'name': adj_name,
                    'percentage': percentage,
                    'fixed_amount': fixed_amount,
                    'type': adj_type,
                    'order': adj.get('order', 999),
                    'amount': adj_amount,
                    'note': adj.get('note') or '',
                })
            
            context['adjustments'] = calculated_adjustments
            op_percent = 0
            op_amount = 0
            discount = 0
        else:
            # Backward compatibility: use op_percent and discount
            op_percent = float(context.get('op_percent', 0))
            op_amount = items_subtotal * (op_percent / 100)
            current_subtotal = items_subtotal + op_amount
            discount = float(context.get('discount', 0))
            current_subtotal -= discount
            context['adjustments'] = []

        # Calculate tax on adjusted subtotal
        context.setdefault('tax_rate', 0)
        tax_method = context.get('tax_method', 'percentage')

        if tax_method == 'percentage':
            # Calculate tax on taxable items proportionally
            taxable_amount = sum(
                float(item.get('quantity', 0)) * float(item.get('rate', 0))
                for item in items
                if item.get('taxable', True)  # Default to taxable
            )
            
            if taxable_amount > 0 and items_subtotal > 0:
                taxable_ratio = taxable_amount / items_subtotal
                
                # Apply adjustments proportionally to taxable amount
                taxable_current = taxable_amount
                
                if adjustments and len(adjustments) > 0:
                    for adj in sorted_adjustments:
                        percentage = float(adj.get('percentage', 0))
                        fixed_amt = adj.get('fixed_amount')
                        adj_type = adj.get('type', 'add')

                        if percentage != 0:
                            taxable_adj_amount = taxable_current * (abs(percentage) / 100)
                        else:
                            taxable_adj_amount = abs(float(fixed_amt)) * taxable_ratio if fixed_amt else 0

                        if adj_type == 'subtract' or percentage < 0:
                            taxable_current -= taxable_adj_amount
                        else:
                            taxable_current += taxable_adj_amount
                else:
                    # Legacy: apply op_percent and discount proportionally
                    taxable_op_amount = taxable_amount * (op_percent / 100)
                    taxable_current = taxable_amount + taxable_op_amount
                    taxable_discount = discount * taxable_ratio
                    taxable_current -= taxable_discount
                
                tax_amount = taxable_current * float(context['tax_rate']) / 100
            else:
                tax_amount = 0
        else:
            tax_amount = float(context.get('tax_amount', 0))

        # Final subtotal after adjustments and before tax
        subtotal_before_tax = current_subtotal
        
        # Subtotal includes Items + Adjustments + Tax
        subtotal = subtotal_before_tax + tax_amount

        context.setdefault('shipping', 0)

        # Total is subtotal plus shipping
        total = subtotal + float(context.get('shipping', 0))

        # Ensure values are properly set in context
        context['discount'] = discount
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
        logger.info(f"=== PDF Context - Payments Debug ===")
        logger.info(f"Number of payments in context: {len(payments)}")
        for idx, payment in enumerate(payments):
            logger.info(f"Payment {idx}: {payment}")
        total_paid = sum(float(payment.get('amount', 0)) for payment in payments)
        context['total_paid'] = total_paid

        # Use explicit balance_due if provided, otherwise calculate
        if 'balance_due' in context and context['balance_due'] is not None:
            balance_due = float(context['balance_due'])
        else:
            balance_due = total - total_paid
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
        
        # Process adjustments if provided (new flexible system)
        adjustments = context.get('adjustments', [])
        current_subtotal = context['subtotal']
        
        if adjustments and len(adjustments) > 0:
            # Sort adjustments by order
            sorted_adjustments = sorted(adjustments, key=lambda x: x.get('order', 999))
            
            # Calculate adjustment amounts and apply to subtotal
            processed_adjustments = []
            for adj in sorted_adjustments:
                percentage = float(adj.get('percentage', 0))
                fixed_amount = adj.get('fixed_amount')
                adj_type = adj.get('type', 'add')

                if percentage != 0:
                    amount = current_subtotal * (abs(percentage) / 100)
                else:
                    amount = abs(float(fixed_amount)) if fixed_amount else 0

                if adj_type == 'subtract' or percentage < 0:
                    current_subtotal -= amount
                else:
                    current_subtotal += amount

                processed_adjustments.append({
                    'name': adj.get('name', ''),
                    'percentage': percentage,
                    'fixed_amount': fixed_amount,
                    'type': adj_type,
                    'order': adj.get('order', 999),
                    'amount': amount,
                    'note': adj.get('note') or '',
                })
            
            context['adjustments'] = processed_adjustments
            context['op_amount'] = 0  # No O&P when using adjustments
            context['op_percent'] = 0
        else:
            # Legacy O&P calculation (only if no adjustments)
            op_percent = float(context.get('op_percent', 0))
            op_amount = context['subtotal'] * (op_percent / 100)
            context['op_percent'] = op_percent
            context['op_amount'] = op_amount
            current_subtotal = context['subtotal'] + op_amount
        
        # Calculate tax
        context.setdefault('tax_rate', 0)
        tax_rate = float(context['tax_rate'])
        tax_method = context.get('tax_method', 'percentage')
        
        if tax_method == 'percentage':
            # Calculate tax on adjusted subtotal
            context['tax_amount'] = current_subtotal * (tax_rate / 100)
        else:
            # Specific tax amount
            context['tax_amount'] = float(context.get('tax_amount', 0))
        
        # Final total
        context['total'] = current_subtotal + context['tax_amount']
        
        # Preserve HTML in global notes fields
        if context.get('notes'):
            # Don't convert - keep as HTML from RichTextEditor
            pass
        if context.get('terms'):
            # Don't convert - keep as HTML from RichTextEditor  
            pass
        
        return context
    
    def _generate_header_footer_css(
        self, context: Dict[str, Any]
    ) -> str:
        """Generate CSS for estimate PDF headers and footers.
        Shows company info (top-left), client info (top-right),
        page number (bottom-center), and generated date (bottom-right).
        """
        company = context.get('company', {})
        client = context.get('client', {})

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

        client_lines = []
        if client.get('name'):
            client_lines.append(client['name'])
        if client.get('address'):
            client_lines.append(client['address'])
        if client.get('phone'):
            client_lines.append(f"Tel: {client['phone']}")
        client_text = '\\A '.join(client_lines)

        return f"""
        @page {{
            size: A4;
            margin: 2.5cm 2cm 2cm 2cm;

            @top-left {{
                content: "{company_text}";
                font-family: Arial, sans-serif;
                font-size: 9pt;
                white-space: pre;
                padding-top: 10px;
            }}

            @top-right {{
                content: "{client_text}";
                font-family: Arial, sans-serif;
                font-size: 9pt;
                white-space: pre;
                text-align: right;
                padding-top: 10px;
            }}

            @bottom-center {{
                content: "Page " counter(page) "/" counter(pages);
                font-family: Arial, sans-serif;
                font-size: 9pt;
            }}

            @bottom-right {{
                content: "Generated on {datetime.now().strftime('%Y-%m-%d')}";
                font-family: Arial, sans-serif;
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

    def _generate_invoice_header_footer_css(
        self, context: Dict[str, Any]
    ) -> str:
        """Generate CSS for invoice PDF - no header/footer content."""
        return """
        @page {
            size: A4;
            margin: 1.2cm 2cm 2cm 2cm;
        }
        """
    
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
        _ensure_weasyprint()
        if not WEASYPRINT_AVAILABLE:
            raise RuntimeError("WeasyPrint is not available")
        
        # Setup template environment
        template_dir = TEMPLATE_DIR / "plumber_report" / "standard"
        env = Environment(loader=FileSystemLoader(str(template_dir)))
        
        # Register filters
        def date_filter(value):
            if isinstance(value, datetime):
                return _format_date_en(value)
            if isinstance(value, date):
                return f"{_EN_MONTHS[value.month - 1]} {value.day}, {value.year}"
            if isinstance(value, str):
                try:
                    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
                    return _format_date_en(dt)
                except (ValueError, TypeError):
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
        context['generated_date'] = datetime.now().strftime("%B %d, %Y")
        
        # Load template and render HTML
        template = env.get_template('template.html')
        html_content = template.render(**context)

        # Remove external CSS link - we load CSS via stylesheets param (same as invoice PDF)
        html_content = html_content.replace(
            '<link rel="stylesheet" href="style.css">', ''
        )

        # Load style.css as stylesheet object
        css_path = template_dir / 'style.css'
        stylesheets = []
        if css_path.exists():
            with open(css_path, 'r', encoding='utf-8') as f:
                stylesheets.append(CSS(string=f.read()))

        # Build header/footer text values
        report_number = report_data.get('report_number', '')
        report_label = f"Report #{report_number}" if report_number else ''

        prop = report_data.get('property', {}) or {}
        if isinstance(prop, dict):
            addr_parts = [p for p in [
                prop.get('address', ''),
                prop.get('city', ''),
                prop.get('state', ''),
                prop.get('zipcode', ''),
            ] if p]
            property_address = ', '.join(addr_parts)
        else:
            property_address = ''

        # Page CSS for footer (WeasyPrint PDF)
        # First page: no footer
        # Pages 2+: footer with report#, page number, address
        page_css = f"""
        @page {{
            size: letter;
            margin: 0.2in 0.4in 0.5in 0.4in;

            @bottom-left {{
                content: "{report_label}";
                font-size: 8pt;
                color: #666;
                border-top: 0.5pt solid #ccc;
                padding-top: 3px;
            }}

            @bottom-center {{
                content: "Page " counter(page) "/" counter(pages);
                font-size: 8pt;
                color: #666;
                border-top: 0.5pt solid #ccc;
                padding-top: 3px;
            }}

            @bottom-right {{
                content: "{property_address}";
                font-size: 8pt;
                color: #666;
                border-top: 0.5pt solid #ccc;
                padding-top: 3px;
            }}
        }}

        @page :first {{
            margin: 0.2in 0.4in 0.3in 0.4in;
            @bottom-left {{ content: none; }}
            @bottom-center {{ content: none; }}
            @bottom-right {{ content: none; }}
        }}

        .report-footer {{
            display: none !important;
        }}
        """
        stylesheets.append(CSS(string=page_css))

        # Generate PDF - same pattern as invoice: stylesheets param
        pdf_document = HTML(
            string=html_content,
            base_url=str(template_dir)
        ).write_pdf(stylesheets=stylesheets)

        return pdf_document

    @staticmethod
    def generate_plumber_report_html(
        report_data: Dict[str, Any],
        include_photos: bool = True,
        include_financial: bool = True
    ) -> str:
        """Generate HTML for Plumber's Report (browser-renderable preview)"""
        template_dir = TEMPLATE_DIR / "plumber_report" / "standard"
        env = Environment(loader=FileSystemLoader(str(template_dir)))

        def date_filter(value):
            if isinstance(value, datetime):
                return _format_date_en(value)
            if isinstance(value, date):
                return f"{_EN_MONTHS[value.month - 1]} {value.day}, {value.year}"
            if isinstance(value, str):
                try:
                    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
                    return _format_date_en(dt)
                except (ValueError, TypeError):
                    return value
            return value

        def nl2br_filter(value):
            if value:
                return value.replace('\n', '<br>')
            return value

        def safe_filter(value):
            return value

        env.filters['date'] = date_filter
        env.filters['nl2br'] = nl2br_filter
        env.filters['safe'] = safe_filter

        context = report_data.copy()
        context['include_photos'] = include_photos
        context['include_financial'] = include_financial
        context['generated_date'] = datetime.now().strftime("%B %d, %Y")

        template = env.get_template('template.html')
        html_content = template.render(**context)

        # Inline the CSS so the HTML works as a standalone blob URL
        css_path = template_dir / 'style.css'
        css_content = css_path.read_text(encoding='utf-8', errors='replace') if css_path.exists() else ''

        # Build report info for print running header/footer
        report_number = report_data.get('report_number', '')
        report_label = f"Report #{report_number}" if report_number else ''

        prop = report_data.get('property', {}) or {}
        if isinstance(prop, dict):
            addr_parts = [p for p in [
                prop.get('address', ''),
                prop.get('city', ''),
                prop.get('state', ''),
                prop.get('zipcode', ''),
            ] if p]
            property_address = ', '.join(addr_parts)
        else:
            property_address = ''

        report_label_safe = html_escape(report_label)
        property_address_safe = html_escape(property_address)

        # Print button style (screen only — CSS already hides it on print)
        print_btn_style = """
        .print-btn {
            position: fixed; top: 12px; right: 16px; z-index: 9999;
            background: #1f2937; color: white; border: none;
            padding: 9px 18px; font-size: 13px; font-family: Arial, sans-serif;
            cursor: pointer; border-radius: 4px;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        }
        .print-btn:hover { background: #374151; }
        """

        # Print footer: hidden on first page / single-page reports.
        # JS (onbeforeprint) detects multi-page content and adds .footer-active
        # so the footer only appears starting from page 2 onwards.
        # Browser @page margin boxes are not supported in Chrome/Edge, so we use
        # position:fixed which repeats on every page — hidden by default until JS enables it.
        print_hf_css = """
        /* Screen: hide print-only footer */
        .print-running-footer { display: none; }

        @media print {
            /* Default: footer hidden (no footer on first page or single-page reports) */
            .print-running-footer {
                display: none;
            }
            /* JS adds .footer-active when content spans multiple pages */
            .print-running-footer.footer-active {
                display: flex;
                justify-content: space-between;
                align-items: center;
                position: fixed;
                bottom: 0;
                left: 0.3in;
                right: 0.3in;
                padding: 4px 0 0.2in 0;
                border-top: 0.5pt solid #ccc;
                font-size: 8pt;
                color: #666;
            }
            /* Hide the original template footer */
            .report-footer { display: none !important; }

            /* Top/bottom margins with extra bottom room for footer */
            .page-wrapper {
                padding: 0.25in 0.4in 0.45in 0.4in !important;
            }
        }

        @page {
            size: letter;
            margin: 0 !important;
        }
        """

        html_content = html_content.replace(
            '<link rel="stylesheet" href="style.css">',
            f'<style>{css_content}\n{print_btn_style}\n{print_hf_css}</style>'
        )

        # Inject print button
        html_content = html_content.replace(
            '<body>',
            '<body>'
            '<button class="print-btn" onclick="window.print()">&#128438; Print / Save as PDF</button>'
        )

        # Insert fixed footer (position:fixed in print CSS
        # renders on every page, anchored to page bottom).
        footer_div = (
            f'<div class="print-running-footer">'
            f'<span>{report_label_safe}</span>'
            f'<span>{property_address_safe}</span>'
            f'</div>'
        )
        html_content = html_content.replace(
            '<div class="page-wrapper">',
            f'{footer_div}<div class="page-wrapper">'
        )

        # Inject JS: show footer only when content spans multiple pages.
        # onbeforeprint fires before print layout; scrollHeight in screen units
        # approximates page count (letter = 11in = 1056px at 96dpi).
        js_snippet = (
            '<script>'
            '(function(){'
            'var PH=1056;'  # letter height at 96dpi
            'function rf(){'
            'var f=document.querySelector(".print-running-footer");'
            'var w=document.querySelector(".page-wrapper");'
            'if(!f||!w)return;'
            'if(w.scrollHeight>PH*0.9){'
            'f.classList.add("footer-active");'
            '}else{'
            'f.classList.remove("footer-active");'
            '}'
            '}'
            'window.onbeforeprint=rf;'
            'window.onafterprint=function(){'
            'var f=document.querySelector(".print-running-footer");'
            'if(f)f.classList.remove("footer-active");'
            '};'
            '})();'
            '</script>'
        )
        html_content = html_content.replace('</body>', js_snippet + '</body>')

        # Sanitize surrogate characters that Windows file paths/fonts can introduce
        html_content = html_content.encode('utf-8', errors='replace').decode('utf-8')

        return html_content

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

        # general_receipt.html has inline CSS including @page headers/footers
        # No external stylesheets needed - template is self-contained
        stylesheets = []

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


def generate_images_pdf(
    image_paths: list[str],
    output_path: str,
    rotations: dict[str, int] | None = None
) -> str:
    """
    Generate PDF from images with each image taking up one full page.
    Uses reportlab + pypdf instead of WeasyPrint to avoid GTK+ dependencies.

    Args:
        image_paths: List of paths to image files
        output_path: Path to save the generated PDF
        rotations: Optional dict mapping photo_id to rotation degrees (0, 90, 180, 270)

    Returns:
        Path to the generated PDF
    """
    _ensure_pypdf()
    if not PYPDF_AVAILABLE:
        raise RuntimeError("pypdf and reportlab are required for PDF generation")

    import io
    import logging
    import tempfile

    from PIL import Image

    logger = logging.getLogger(__name__)
    logger.info(f"Starting PDF generation with {len(image_paths)} images using reportlab")

    # Create PDF writer
    writer = PdfWriter()

    for img_path in image_paths:
        try:
            # Get rotation for this image
            rotation = 0
            if rotations:
                for photo_id, degrees in rotations.items():
                    if photo_id in str(img_path):
                        rotation = degrees
                        break

            logger.info(f"Processing image: {img_path} (rotation: {rotation})")

            # Load image with PIL
            from PIL import ImageOps
            img = Image.open(img_path)
            # Apply EXIF orientation (smartphones store images sideways with EXIF rotation tag)
            img = ImageOps.exif_transpose(img)

            # Resize large images
            max_width = 2550
            max_height = 3300
            if img.width > max_width or img.height > max_height:
                logger.info(f"Resizing image from {img.width}x{img.height}")
                img.thumbnail((max_width, max_height), Image.Resampling.LANCZOS)

            # Apply rotation if needed
            if rotation != 0:
                logger.info(f"Rotating image by {rotation} degrees")
                img = img.rotate(-rotation, expand=True)

            # Always save processed image to temp file so ReportLab uses
            # the EXIF-corrected (and optionally rotated) version
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.jpg')
            img.save(temp_file.name, format='JPEG', quality=95)
            img_path = temp_file.name

            img_width, img_height = img.size

            # Create PDF page with image
            page_buffer = io.BytesIO()
            c = canvas.Canvas(page_buffer, pagesize=letter)

            # Calculate scaling to fit letter size while maintaining aspect ratio
            page_width, page_height = letter
            width_scale = page_width / img_width
            height_scale = page_height / img_height
            scale = min(width_scale, height_scale)

            # Calculate centered position
            scaled_width = img_width * scale
            scaled_height = img_height * scale
            x = (page_width - scaled_width) / 2
            y = (page_height - scaled_height) / 2

            # Draw image centered on page
            c.drawImage(
                str(img_path),
                x, y,
                width=scaled_width,
                height=scaled_height,
                preserveAspectRatio=True
            )
            c.save()
            page_buffer.seek(0)

            # Add page to writer
            page_reader = PdfReader(page_buffer)
            writer.add_page(page_reader.pages[0])

            logger.info(f"Added image to PDF: {img_path}")

        except Exception as e:
            logger.error(f"Failed to process image {img_path}: {e}")
            raise RuntimeError(f"Failed to process image {img_path}: {str(e)}") from e

    # Write final PDF
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, 'wb') as output_file:
        writer.write(output_file)

    logger.info(f"PDF generation completed: {output_path}")
    return str(output_path)


def _get_report_style(template_variant: str = "a") -> Dict[str, Any]:
    """Return style configuration for a photo report variant.

    Each variant produces a visually distinct PDF so that reports from
    different companies do not look identical.

    Variants:
        a (default) - Professional grayscale with Helvetica
        b           - Serif / warm tones with Georgia-like fonts
        c           - Modern blue accent with clean sans-serif
    """
    styles = {
        "a": {
            # ── fonts & sizes ──
            "font_title": "Helvetica-Bold",
            "font_body": "Helvetica",
            "font_body_bold": "Helvetica-Bold",
            "title_size": 24,
            "section_title_size": 16,
            # ── colors ──
            "color_black": "#000000",
            "color_dark": "#333333",
            "color_medium": "#666666",
            "color_light": "#CCCCCC",
            "color_very_light": "#F5F5F5",
            "color_accent": "#000000",
            # ── layout modes ──
            "cover_title_align": "center",
            "cover_line_style": "single",
            "cover_info_layout": "vertical",   # vertical | two_column | card
            "cover_prepared_pos": "center",     # center | bottom_left | top_right
            "section_header_mode": "underline", # underline | filled_box | left_bar
            "section_header_bg": None,
            "footer_style": "center",           # center | split | full_bar
            "logo_grayscale": True,
            "logo_position": "center",          # center | top_left | top_right
            # ── content / wording ──
            "default_title": "Water Mitigation Report",
            "info_heading": "JOB INFORMATION",
            "prepared_label": "PREPARED BY",
            "footer_date_label": "Report Generated",
            "label_property": "Property Address:",
            "label_client": "Client Name:",
            "label_dol": "Date of Loss:",
            "label_mitigation": "Water Mitigation Period:",
            "photo_date_prefix": "Captured",
        },
        "b": {
            # ── fonts & sizes ──
            "font_title": "Courier-Bold",
            "font_body": "Courier",
            "font_body_bold": "Courier-Bold",
            "title_size": 26,
            "section_title_size": 15,
            # ── colors ──
            "color_black": "#1a1a1a",
            "color_dark": "#2c2c2c",
            "color_medium": "#555555",
            "color_light": "#BBBBBB",
            "color_very_light": "#F0EFEB",
            "color_accent": "#6B4C3B",
            # ── layout modes ──
            "cover_title_align": "left",
            "cover_line_style": "double",
            "cover_info_layout": "two_column",
            "cover_prepared_pos": "bottom_left",
            "section_header_mode": "filled_box",
            "section_header_bg": "#F0EFEB",
            "footer_style": "split",
            "logo_grayscale": False,
            "logo_position": "top_right",
            # ── content / wording ──
            "default_title": "Moisture Remediation Documentation",
            "info_heading": "Project Details",
            "prepared_label": "Submitted by",
            "footer_date_label": "Document Date",
            "label_property": "Site Address:",
            "label_client": "Homeowner:",
            "label_dol": "Loss Date:",
            "label_mitigation": "Remediation Period:",
            "photo_date_prefix": "Date",
        },
        "c": {
            # ── fonts & sizes ──
            "font_title": "Helvetica-Bold",
            "font_body": "Helvetica",
            "font_body_bold": "Helvetica-Bold",
            "title_size": 22,
            "section_title_size": 14,
            # ── colors ──
            "color_black": "#0D47A1",
            "color_dark": "#1565C0",
            "color_medium": "#42A5F5",
            "color_light": "#BBDEFB",
            "color_very_light": "#E3F2FD",
            "color_accent": "#0D47A1",
            # ── layout modes ──
            "cover_title_align": "left",
            "cover_line_style": "thick",
            "cover_info_layout": "card",
            "cover_prepared_pos": "top_right",
            "section_header_mode": "left_bar",
            "section_header_bg": "#E3F2FD",
            "footer_style": "full_bar",
            "logo_grayscale": False,
            "logo_position": "top_left",
            # ── content / wording ──
            "default_title": "Water Damage Restoration Report",
            "info_heading": "Claim Information",
            "prepared_label": "Documented by",
            "footer_date_label": "Date of Report",
            "label_property": "Property:",
            "label_client": "Insured Name:",
            "label_dol": "Date of Loss:",
            "label_mitigation": "Restoration Period:",
            "photo_date_prefix": "Taken",
        },
    }
    return styles.get(template_variant, styles["a"])


def generate_water_mitigation_report_pdf(
    job_data: Dict[str, Any],
    config: Dict[str, Any],
    photos: List[Dict[str, Any]],
    output_path: str,
    company_data: Optional[Dict[str, Any]] = None,
    report_date: Optional[str] = None,
    compress: bool = False,
    template_variant: str = "a",
) -> str:
    """
    Generate professional Water Mitigation photo report PDF using ReportLab

    Creates a comprehensive report with:
    - Cover page with job/company information
    - Section pages with titles and summaries
    - Photo grids with captions and dates
    - Page footers with numbers and generation date

    Args:
        job_data: Water mitigation job data (may include 'company' relationship)
        config: Report configuration (cover page, sections)
        photos: List of all photos for the job
        output_path: Path to save the PDF
        company_data: Company information (name, logo, etc.) - if not provided, will use job.company
        report_date: Custom report date in ISO format (YYYY-MM-DD). If not provided, uses current date.
        compress: If True, compress images for smaller file size (quality=50, max 1200px)

    Returns:
        Path to the generated PDF
    """
    _ensure_pypdf()
    if not PYPDF_AVAILABLE:
        raise RuntimeError("pypdf and reportlab are required for PDF generation")

    import base64
    import io
    import logging
    import tempfile
    from datetime import datetime

    from PIL import Image
    from pypdf import PdfReader, PdfWriter
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.pdfgen import canvas as pdf_canvas
    from reportlab.platypus import Paragraph, Table, TableStyle

    logger = logging.getLogger(__name__)
    logger.info(f"Generating photo report for job {job_data.get('id', 'unknown')} (compress={compress}, variant={template_variant})")

    # Load style variant
    style = _get_report_style(template_variant)

    # Compression settings - balanced quality and file size
    if compress:
        IMAGE_QUALITY = 50  # Balanced quality (25=low, 95=original)
        IMAGE_MAX_SIZE = 1200  # Maximum dimension in pixels
    else:
        IMAGE_QUALITY = 95  # High quality for original
        IMAGE_MAX_SIZE = None  # No resizing

    # Get storage provider from settings
    from app.core.config import settings
    storage_provider = settings.STORAGE_PROVIDER
    logger.info(f"Using storage provider: {storage_provider}")

    # Use job's assigned company if available, otherwise use provided company_data
    if not company_data and job_data.get('company'):
        logger.info("Using job's assigned company data for report")
        company_obj = job_data['company']
        company_data = {
            'name': company_obj.get('name', '') if isinstance(company_obj, dict) else getattr(company_obj, 'name', ''),
            'logo': company_obj.get('logo', '') if isinstance(company_obj, dict) else getattr(company_obj, 'logo', '')
        }
        logger.info(f"Company name: {company_data['name']}, Logo: {company_data.get('logo', 'N/A')}")

    # Page settings
    page_width, page_height = letter
    margin = 0.4 * inch  # Reduced margin for wider photo display area

    # Color palette from style variant
    COLOR_BLACK = colors.HexColor(style["color_black"])
    COLOR_DARK_GRAY = colors.HexColor(style["color_dark"])
    COLOR_MEDIUM_GRAY = colors.HexColor(style["color_medium"])
    COLOR_LIGHT_GRAY = colors.HexColor(style["color_light"])
    COLOR_VERY_LIGHT_GRAY = colors.HexColor(style["color_very_light"])
    COLOR_ACCENT = colors.HexColor(style["color_accent"])
    COLOR_WHITE = colors.white

    # Font configuration from style variant
    FONT_TITLE = style["font_title"]
    FONT_BODY = style["font_body"]
    FONT_BODY_BOLD = style["font_body_bold"]
    TITLE_SIZE = style["title_size"]
    SECTION_TITLE_SIZE = style["section_title_size"]

    # Create PDF writer
    writer = PdfWriter()

    # Format dates
    def format_date(date_value):
        if not date_value:
            return ""
        try:
            if isinstance(date_value, str):
                dt = datetime.fromisoformat(date_value.replace('Z', '+00:00'))
            else:
                dt = date_value
            return safe_strftime(dt, "%B %d, %Y")
        except Exception:
            return str(date_value)

    # Use custom report_date if provided, otherwise use current date
    if report_date:
        try:
            custom_date = datetime.fromisoformat(report_date.replace('Z', '+00:00'))
            report_date_formatted = format_date(custom_date)
        except (ValueError, AttributeError):
            report_date_formatted = format_date(datetime.now())
    else:
        report_date_formatted = format_date(datetime.now())

    # ===== COVER PAGE =====
    logger.info("Creating cover page")
    cover_buffer = io.BytesIO()
    c = pdf_canvas.Canvas(cover_buffer, pagesize=letter)

    # ── Helper: draw company logo, returns (logo_width, logo_h) or None ──
    def _draw_logo(lx, ly, max_w=2.5 * inch):
        if not (company_data and company_data.get('logo')):
            return None
        logo_path = Path(company_data['logo'])
        if not logo_path.exists():
            return None
        try:
            logo_img = Image.open(logo_path)
            if style["logo_grayscale"]:
                logo_img = logo_img.convert('L')
            lw, lh = logo_img.size
            if lw > max_w:
                s = max_w / lw
                lw, lh = max_w, lh * s
            else:
                lw = lw * (inch / 100)
                lh = lh * (inch / 100)
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.jpg')
            logo_img.save(tmp.name, 'JPEG')
            c.drawImage(tmp.name, lx, ly, width=lw, height=lh)
            tmp.close()
            return lw, lh
        except Exception as e:
            logger.warning(f"Failed to load company logo: {e}")
            return None

    # ── Helper: wrap description text ──
    def _wrap_lines(text, max_chars=80):
        result = []
        for para in text.split('\n'):
            para = para.strip()
            if not para:
                result.append('')
                continue
            if len(para) <= max_chars:
                result.append(para)
                continue
            words = para.split()
            cur = []
            for w in words:
                cur.append(w)
                if len(' '.join(cur)) > max_chars:
                    if len(cur) > 1:
                        cur.pop()
                        result.append(' '.join(cur))
                        cur = [w]
                    else:
                        result.append(w)
                        cur = []
            if cur:
                result.append(' '.join(cur))
        return result

    # ── Build job info rows using variant labels ──
    mitigation_start = job_data.get('mitigation_start_date')
    mitigation_end = job_data.get('mitigation_end_date')
    mitigation_period = ''
    if mitigation_start or mitigation_end:
        start_str = format_date(mitigation_start) if mitigation_start else 'N/A'
        end_str = format_date(mitigation_end) if mitigation_end else 'N/A'
        mitigation_period = f"{start_str} - {end_str}"

    job_info = [
        (style.get("label_property", "Property Address:"),
         job_data.get('property_address', 'N/A')),
        (style.get("label_client", "Client Name:"),
         job_data.get('homeowner_name', 'N/A')),
        (style.get("label_dol", "Date of Loss:"),
         format_date(job_data.get('date_of_loss'))),
    ]
    if mitigation_period:
        job_info.append((
            style.get("label_mitigation", "Water Mitigation Period:"),
            mitigation_period,
        ))
    job_info = [(l, v) for l, v in job_info if v and v != 'N/A']

    title = config.get('cover_title', style.get(
        "default_title", "Water Mitigation Report"
    ))
    description = config.get('cover_description', '')
    info_heading = style.get("info_heading", "JOB INFORMATION")
    prepared_label = style.get("prepared_label", "PREPARED BY")
    company_name = (company_data or {}).get('name', '')

    # ─────────────────────────────────────────────────────
    # Variant A: centered layout (original)
    # ─────────────────────────────────────────────────────
    if template_variant == "a" or template_variant not in ("b", "c"):
        # Logo (centered)
        logo_height = 0
        logo_result = _draw_logo(
            0, 0, max_w=2.5 * inch  # dummy position, measure first
        )
        # Re-draw at correct position
        if logo_result:
            lw, lh = logo_result
            logo_x = (page_width - lw) / 2
            logo_y = page_height - margin - lh - 0.5 * inch
            # Clear and redraw
            c = pdf_canvas.Canvas(cover_buffer, pagesize=letter)
            _draw_logo(logo_x, logo_y, max_w=2.5 * inch)
            logo_height = lh + 1.2 * inch

        y_position = page_height - margin - logo_height - 0.5 * inch

        # Title (centered)
        c.setFillColor(COLOR_ACCENT)
        c.setFont(FONT_TITLE, TITLE_SIZE)
        c.drawCentredString(page_width / 2, y_position, title)
        y_position -= 0.25 * inch

        # Single line
        c.setStrokeColor(COLOR_MEDIUM_GRAY)
        c.setLineWidth(0.5)
        lm = 2 * inch
        c.line(lm, y_position, page_width - lm, y_position)
        y_position -= 0.6 * inch

        # Description
        if description:
            c.setFillColor(COLOR_DARK_GRAY)
            c.setFont(FONT_BODY, 11)
            for line in _wrap_lines(description):
                if line:
                    c.drawCentredString(page_width / 2, y_position, line)
                y_position -= 0.22 * inch
            y_position -= 0.3 * inch

        # Job info header
        y_position -= 0.6 * inch
        c.setFillColor(COLOR_VERY_LIGHT_GRAY)
        c.rect(margin - 0.1 * inch, y_position,
               page_width - 2 * margin + 0.2 * inch,
               0.4 * inch, fill=1, stroke=0)
        c.setFillColor(COLOR_ACCENT)
        c.setFont(FONT_BODY_BOLD, 14)
        c.drawString(margin + 0.1 * inch,
                     y_position + 0.12 * inch, info_heading)
        y_position -= 0.3 * inch

        # Job info table (vertical)
        if job_info:
            table_data = [[l, v] for l, v in job_info]
            table = Table(table_data,
                          colWidths=[2.2 * inch, 4 * inch])
            table.setStyle(TableStyle([
                ('FONT', (0, 0), (0, -1), FONT_BODY_BOLD, 10),
                ('FONT', (1, 0), (1, -1), FONT_BODY, 10),
                ('TEXTCOLOR', (0, 0), (-1, -1), COLOR_DARK_GRAY),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('LINEBELOW', (0, 0), (-1, -2), 0.5,
                 COLOR_VERY_LIGHT_GRAY),
                ('TOPPADDING', (0, 0), (-1, 0), 4),
                ('TOPPADDING', (0, 1), (-1, -1), 8),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
                ('LEFTPADDING', (0, 0), (0, -1), 0),
                ('RIGHTPADDING', (1, 0), (1, -1), 0),
            ]))
            tw, th = table.wrapOn(c, page_width, page_height)
            table.drawOn(c, margin, y_position - th)
            y_position -= th
            c.setStrokeColor(COLOR_LIGHT_GRAY)
            c.setLineWidth(1)
            c.line(margin - 0.1 * inch, y_position,
                   page_width - margin + 0.1 * inch, y_position)

        # Prepared By (centered)
        if company_name:
            y_position -= 1.4 * inch
            c.setFillColor(COLOR_MEDIUM_GRAY)
            c.setFont(FONT_BODY, 10)
            c.drawCentredString(page_width / 2, y_position,
                                prepared_label)
            y_position -= 0.3 * inch
            c.setFillColor(COLOR_ACCENT)
            c.setFont(FONT_TITLE, 13)
            c.drawCentredString(page_width / 2, y_position,
                                company_name)

    # ─────────────────────────────────────────────────────
    # Variant B: formal / left-aligned / two-column info
    # ─────────────────────────────────────────────────────
    elif template_variant == "b":
        y_position = page_height - margin - 0.5 * inch

        # Logo (top-right)
        if company_data and company_data.get('logo'):
            _draw_logo(page_width - margin - 1.8 * inch,
                       y_position - 0.6 * inch, max_w=1.8 * inch)

        # Title (left-aligned, large)
        c.setFillColor(COLOR_ACCENT)
        c.setFont(FONT_TITLE, TITLE_SIZE)
        c.drawString(margin, y_position, title)
        y_position -= 0.3 * inch

        # Double line
        c.setStrokeColor(COLOR_MEDIUM_GRAY)
        c.setLineWidth(0.5)
        c.line(margin, y_position, page_width - margin, y_position)
        c.line(margin, y_position - 3,
               page_width - margin, y_position - 3)
        y_position -= 0.7 * inch

        # Description (left-aligned)
        if description:
            c.setFillColor(COLOR_DARK_GRAY)
            c.setFont(FONT_BODY, 11)
            for line in _wrap_lines(description):
                if line:
                    c.drawString(margin, y_position, line)
                y_position -= 0.22 * inch
            y_position -= 0.3 * inch

        # Job info heading
        y_position -= 0.3 * inch
        c.setFillColor(COLOR_ACCENT)
        c.setFont(FONT_BODY_BOLD, 13)
        c.drawString(margin, y_position, info_heading)
        y_position -= 0.08 * inch
        c.setStrokeColor(COLOR_ACCENT)
        c.setLineWidth(0.8)
        c.line(margin, y_position,
               margin + 2.5 * inch, y_position)
        y_position -= 0.25 * inch

        # Two-column job info table
        if job_info:
            # Split into two columns
            mid = (len(job_info) + 1) // 2
            col1 = job_info[:mid]
            col2 = job_info[mid:]
            max_rows = max(len(col1), len(col2))
            table_data = []
            for i in range(max_rows):
                row = []
                if i < len(col1):
                    row += [col1[i][0], col1[i][1]]
                else:
                    row += ['', '']
                if i < len(col2):
                    row += [col2[i][0], col2[i][1]]
                else:
                    row += ['', '']
                table_data.append(row)

            table = Table(table_data, colWidths=[
                1.8 * inch, 2 * inch, 1.8 * inch, 2 * inch
            ])
            table.setStyle(TableStyle([
                ('FONT', (0, 0), (0, -1), FONT_BODY_BOLD, 9),
                ('FONT', (1, 0), (1, -1), FONT_BODY, 10),
                ('FONT', (2, 0), (2, -1), FONT_BODY_BOLD, 9),
                ('FONT', (3, 0), (3, -1), FONT_BODY, 10),
                ('TEXTCOLOR', (0, 0), (-1, -1), COLOR_DARK_GRAY),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('TOPPADDING', (0, 0), (-1, -1), 5),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
                ('LEFTPADDING', (0, 0), (-1, -1), 0),
                ('LINEBELOW', (0, 0), (-1, -1), 0.3,
                 COLOR_VERY_LIGHT_GRAY),
            ]))
            tw, th = table.wrapOn(c, page_width, page_height)
            table.drawOn(c, margin, y_position - th)
            y_position -= th + 0.2 * inch

        # Prepared By (bottom-left block)
        if company_name:
            by = 1.5 * inch
            c.setStrokeColor(COLOR_LIGHT_GRAY)
            c.setLineWidth(0.5)
            c.line(margin, by + 0.4 * inch,
                   margin + 3 * inch, by + 0.4 * inch)
            c.setFillColor(COLOR_MEDIUM_GRAY)
            c.setFont(FONT_BODY, 9)
            c.drawString(margin, by + 0.5 * inch, prepared_label)
            c.setFillColor(COLOR_ACCENT)
            c.setFont(FONT_BODY_BOLD, 12)
            c.drawString(margin, by + 0.15 * inch, company_name)

    # ─────────────────────────────────────────────────────
    # Variant C: modern / blue accent / card info
    # ─────────────────────────────────────────────────────
    elif template_variant == "c":
        # Full-width accent bar at top
        c.setFillColor(COLOR_ACCENT)
        c.rect(0, page_height - 0.35 * inch,
               page_width, 0.35 * inch, fill=1, stroke=0)

        y_position = page_height - 0.35 * inch - margin

        # Logo + company name on same line (top-left)
        logo_offset = 0
        if company_data and company_data.get('logo'):
            res = _draw_logo(margin, y_position - 0.5 * inch,
                             max_w=1.2 * inch)
            if res:
                logo_offset = res[0] + 0.15 * inch

        if company_name:
            c.setFillColor(COLOR_DARK_GRAY)
            c.setFont(FONT_BODY, 10)
            c.drawString(margin + logo_offset,
                         y_position - 0.2 * inch,
                         f"{prepared_label}:")
            c.setFont(FONT_BODY_BOLD, 12)
            c.drawString(margin + logo_offset,
                         y_position - 0.4 * inch, company_name)

        y_position -= 0.9 * inch

        # Title (left-aligned, large)
        c.setFillColor(COLOR_ACCENT)
        c.setFont(FONT_TITLE, TITLE_SIZE)
        c.drawString(margin, y_position, title)
        y_position -= 0.15 * inch

        # Thick accent line
        c.setStrokeColor(COLOR_ACCENT)
        c.setLineWidth(3)
        c.line(margin, y_position,
               page_width - margin, y_position)
        y_position -= 0.6 * inch

        # Description (left-aligned)
        if description:
            c.setFillColor(COLOR_DARK_GRAY)
            c.setFont(FONT_BODY, 11)
            for line in _wrap_lines(description):
                if line:
                    c.drawString(margin, y_position, line)
                y_position -= 0.22 * inch
            y_position -= 0.2 * inch

        # Job info as "cards" with left accent bar
        y_position -= 0.3 * inch
        c.setFillColor(COLOR_ACCENT)
        c.setFont(FONT_BODY_BOLD, 13)
        c.drawString(margin + 0.15 * inch, y_position, info_heading)
        y_position -= 0.3 * inch

        if job_info:
            card_h = 0.45 * inch
            for label, value in job_info:
                # Card background
                c.setFillColor(COLOR_VERY_LIGHT_GRAY)
                c.rect(margin, y_position - 0.05 * inch,
                       page_width - 2 * margin, card_h,
                       fill=1, stroke=0)
                # Left accent bar
                c.setFillColor(COLOR_ACCENT)
                c.rect(margin, y_position - 0.05 * inch,
                       4, card_h, fill=1, stroke=0)
                # Label
                c.setFillColor(COLOR_MEDIUM_GRAY)
                c.setFont(FONT_BODY, 8)
                c.drawString(margin + 0.15 * inch,
                             y_position + 0.22 * inch, label)
                # Value
                c.setFillColor(COLOR_DARK_GRAY)
                c.setFont(FONT_BODY_BOLD, 11)
                c.drawString(margin + 0.15 * inch,
                             y_position + 0.04 * inch, value)
                y_position -= card_h + 0.08 * inch

    # Cover page footer
    _fdate_label = style.get(
        "footer_date_label", "Report Generated"
    )
    footer_y = 0.8 * inch
    ft_mode = style.get("footer_style", "center")

    if ft_mode == "full_bar":
        c.setFillColor(COLOR_ACCENT)
        c.rect(0, footer_y - 0.1 * inch,
               page_width, 0.35 * inch,
               fill=1, stroke=0)
        c.setFillColor(colors.white)
        c.setFont(FONT_BODY, 9)
        c.drawCentredString(
            page_width / 2, footer_y - 0.02 * inch,
            f"{_fdate_label}: {report_date_formatted}")
    elif ft_mode == "split":
        c.setStrokeColor(COLOR_ACCENT)
        c.setLineWidth(1)
        c.line(margin, footer_y,
               page_width - margin, footer_y)
        c.setFillColor(COLOR_DARK_GRAY)
        c.setFont(FONT_BODY, 9)
        c.drawString(
            margin, 0.4 * inch,
            f"{_fdate_label}: {report_date_formatted}")
    else:
        c.setStrokeColor(COLOR_LIGHT_GRAY)
        c.setLineWidth(0.5)
        c.line(margin, footer_y,
               page_width - margin, footer_y)
        c.setFillColor(COLOR_MEDIUM_GRAY)
        c.setFont(FONT_BODY, 9)
        c.drawCentredString(
            page_width / 2, 0.4 * inch,
            f"{_fdate_label}: {report_date_formatted}")

    c.save()
    cover_buffer.seek(0)

    # Add cover page to writer
    cover_reader = PdfReader(cover_buffer)
    writer.add_page(cover_reader.pages[0])

    # ===== PHOTO SECTIONS =====
    # Create photo lookup dictionary
    photo_dict = {photo['id']: photo for photo in photos}

    # Photos per page layout mapping
    photos_per_page_map = {
        'single': 1,
        'two': 2,
        'three': 3,
        'four': 4,
        'six': 6
    }

    # Grid layouts (rows, cols)
    grid_layouts = {
        'single': (1, 1),
        'two': (2, 1),
        'three': (3, 1),
        'four': (2, 2),
        'six': (3, 2)
    }

    total_pages = 1  # Start at 1 for cover page

    for section_data in config.get('sections', []):
        section_title = section_data.get('title', 'Section')
        section_summary = section_data.get('summary', '')
        layout = section_data.get('layout', 'four')
        max_photos = photos_per_page_map.get(layout, 4)
        rows, cols = grid_layouts.get(layout, (2, 2))

        logger.info(f"Processing section: {section_title} (layout: {layout})")

        # Collect all photos for this section
        section_photos = []
        for photo_meta in section_data.get('photos', []):
            photo_id = photo_meta.get('photo_id')
            if photo_id not in photo_dict:
                continue

            photo = photo_dict[photo_id]
            file_path_str = photo.get('file_path', '')

            # Use per-photo storage_provider if available, fallback to global setting
            photo_storage = photo.get('storage_provider', '') or storage_provider
            photo_storage = (photo_storage or 'local').lower()

            # Get photo file (local or cloud storage)
            photo_file_path = None
            temp_files = []  # Track temp files for cleanup

            if photo_storage == 'local':
                local_path = Path(file_path_str)
                if local_path.exists():
                    photo_file_path = str(local_path)
                else:
                    logger.warning(f"Local file not found: {local_path}")
                    continue
            else:
                # Cloud storage: download to temp file
                try:
                    from app.domains.storage.factory import StorageFactory
                    storage = StorageFactory.get_instance(photo_storage)
                    photo_data = storage.download(file_path_str)
                    if photo_data:
                        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.jpg')
                        temp_file.write(photo_data)
                        temp_file.close()
                        photo_file_path = temp_file.name
                        temp_files.append(temp_file.name)
                    else:
                        continue
                except Exception as e:
                    logger.error(f"Failed to download photo: {e}")
                    continue

            if photo_file_path:
                section_photos.append({
                    'file_path': photo_file_path,
                    'caption': photo_meta.get('caption', ''),
                    'captured_date': photo.get('captured_date'),
                    'show_date': photo_meta.get('show_date', True),
                })

        if not section_photos:
            logger.warning(f"No photos found for section: {section_title}")
            continue

        # Split photos into pages
        for page_num, i in enumerate(range(0, len(section_photos), max_photos), start=1):
            page_photos = section_photos[i:i + max_photos]

            # Create page
            page_buffer = io.BytesIO()
            c = pdf_canvas.Canvas(page_buffer, pagesize=letter)

            # Simple header with section name (small, top)
            header_height = 0.3 * inch

            # Only show section header with description on first page of each section
            if page_num == 1:
                sh_mode = style.get(
                    "section_header_mode", "underline"
                )
                title_y = page_height - margin - 0.25 * inch

                if sh_mode == "filled_box":
                    # ── Filled box behind title ──
                    bg = style.get("section_header_bg")
                    if bg:
                        c.setFillColor(colors.HexColor(bg))
                    else:
                        c.setFillColor(COLOR_VERY_LIGHT_GRAY)
                    c.rect(
                        margin - 0.1 * inch,
                        page_height - margin - 0.4 * inch,
                        page_width - 2 * margin + 0.2 * inch,
                        0.4 * inch, fill=1, stroke=0,
                    )
                    c.setFillColor(COLOR_ACCENT)
                    c.setFont(FONT_TITLE, SECTION_TITLE_SIZE)
                    c.drawString(
                        margin + 0.1 * inch, title_y,
                        section_title,
                    )
                elif sh_mode == "left_bar":
                    # ── Left accent bar + title ──
                    c.setFillColor(COLOR_ACCENT)
                    c.rect(
                        margin - 0.05 * inch,
                        title_y - 0.05 * inch,
                        4, 0.25 * inch,
                        fill=1, stroke=0,
                    )
                    c.setFont(FONT_TITLE, SECTION_TITLE_SIZE)
                    c.drawString(
                        margin + 0.15 * inch, title_y,
                        section_title,
                    )
                else:
                    # ── Default: underline ──
                    c.setFillColor(COLOR_ACCENT)
                    c.setFont(FONT_TITLE, SECTION_TITLE_SIZE)
                    c.drawString(margin, title_y, section_title)

                # Section description
                if section_summary:
                    c.setFillColor(COLOR_DARK_GRAY)
                    c.setFont(FONT_BODY, 10)
                    summary_lines = _wrap_lines(
                        section_summary, max_chars=100
                    )
                    y_pos = page_height - margin - 0.5 * inch
                    for line in summary_lines[:3]:
                        if line:
                            c.drawString(margin, y_pos, line)
                        y_pos -= 0.15 * inch

                    separator_y = y_pos - 0.1 * inch
                    c.setStrokeColor(COLOR_LIGHT_GRAY)
                    c.setLineWidth(0.5)
                    c.line(margin, separator_y,
                           page_width - margin, separator_y)
                    header_height = page_height - separator_y
                else:
                    sep_y = page_height - margin - 0.35 * inch
                    c.setStrokeColor(COLOR_LIGHT_GRAY)
                    c.setLineWidth(0.5)
                    c.line(margin, sep_y,
                           page_width - margin, sep_y)
                    header_height = 0.5 * inch
            else:
                # Continuation pages: section name with divider
                c.setFillColor(COLOR_DARK_GRAY)
                c.setFont(FONT_BODY_BOLD, 11)
                c.drawString(margin, page_height - margin - 0.25 * inch, section_title)

                # Add divider line below section name
                c.setStrokeColor(COLOR_LIGHT_GRAY)
                c.setLineWidth(0.5)
                divider_y = page_height - margin - 0.35 * inch
                c.line(margin, divider_y, page_width - margin, divider_y)

                # Calculate header height same as first page: from top to divider
                header_height = page_height - divider_y

            # Calculate photo grid dimensions
            # Minimize reserved space to maximize photo area
            footer_reserve = 0.7 * inch  # Reduced footer reserve
            content_height = page_height - header_height - margin - footer_reserve
            content_width = page_width - 2 * margin

            # Minimal horizontal gap for wider photos
            h_gap = 0.1 * inch  # Reduced gap between columns
            photo_width = (content_width - h_gap * (cols - 1)) / cols  # Full width minus gaps
            photo_height = content_height / rows - 0.15 * inch  # Reduced vertical gap for more height per photo

            # Draw photos in grid
            for idx, photo_item in enumerate(page_photos):
                row = idx // cols
                col = idx % cols

                # Calculate position with minimal horizontal gap
                x = margin + col * (photo_width + h_gap)
                # Tighter vertical spacing
                y = page_height - header_height - 0.15 * inch - (row + 1) * (photo_height + 0.25 * inch)

                # Draw photo with caption below and date overlay at bottom-right
                try:
                    img = Image.open(photo_item['file_path'])

                    # Apply compression if enabled (resize and reduce quality)
                    actual_photo_path = photo_item['file_path']
                    if compress and IMAGE_MAX_SIZE:
                        original_size = f"{img.width}x{img.height}"
                        # Resize if image is larger than max size
                        if img.width > IMAGE_MAX_SIZE or img.height > IMAGE_MAX_SIZE:
                            img.thumbnail((IMAGE_MAX_SIZE, IMAGE_MAX_SIZE), Image.Resampling.LANCZOS)
                            logger.debug(f"Resized image from {original_size} to {img.width}x{img.height}")

                        # Save compressed image to temp file with aggressive compression
                        compressed_temp = tempfile.NamedTemporaryFile(delete=False, suffix='.jpg')
                        # Convert to RGB if necessary (for PNG with alpha)
                        if img.mode in ('RGBA', 'P'):
                            img = img.convert('RGB')
                        # subsampling='4:2:0' for maximum compression
                        img.save(compressed_temp.name, format='JPEG', quality=IMAGE_QUALITY, optimize=True, subsampling='4:2:0')
                        compressed_temp.close()
                        actual_photo_path = compressed_temp.name
                        temp_files.append(compressed_temp.name)

                    img_width, img_height = img.size

                    # All photos use full cell width for maximum size
                    # This ensures portrait and landscape photos have the same width
                    target_photo_width = photo_width

                    # Reserve space for caption below image
                    caption_reserve = 0.35 * inch
                    available_photo_height = photo_height - caption_reserve

                    # Calculate scaling to fit within available space while maintaining aspect ratio
                    width_scale = target_photo_width / img_width
                    height_scale = available_photo_height / img_height
                    scale = min(width_scale, height_scale)  # Use smaller scale to fit both dimensions

                    # Calculate actual scaled dimensions (preserves aspect ratio)
                    scaled_width = img_width * scale
                    scaled_height = img_height * scale

                    # Center image horizontally within cell, position at top of available space
                    img_x = x + (photo_width - scaled_width) / 2
                    img_y = y + caption_reserve + (available_photo_height - scaled_height) / 2

                    c.drawImage(
                        actual_photo_path,
                        img_x, img_y,
                        width=scaled_width,
                        height=scaled_height,
                        preserveAspectRatio=True,
                        mask='auto'
                    )

                    # Draw date overlay at bottom-right of image
                    if photo_item.get('show_date') and photo_item.get('captured_date'):
                        date_str = format_date(photo_item['captured_date'])
                        _dp = style.get("photo_date_prefix", "Captured")
                        date_text = f"{_dp}: {date_str}"

                        # Date overlay styling
                        c.setFont(FONT_BODY, 7)
                        date_text_width = c.stringWidth(date_text, FONT_BODY, 7)

                        # Position at bottom-right corner of actual image
                        date_padding = 4  # padding in points
                        date_bg_width = date_text_width + date_padding * 2
                        date_bg_height = 12  # height in points

                        date_x = img_x + scaled_width - date_bg_width - 3
                        date_y = img_y + 3  # 3 points from bottom of image

                        # Draw semi-transparent dark background
                        c.setFillColor(colors.Color(0, 0, 0, alpha=0.6))
                        c.rect(date_x, date_y, date_bg_width, date_bg_height, fill=1, stroke=0)

                        # Draw date text in white
                        c.setFillColor(COLOR_WHITE)
                        c.drawString(date_x + date_padding, date_y + 3, date_text)

                    # Caption below image (centered under the image)
                    caption_text = photo_item.get('caption', '') or photo_item.get('description', '')
                    if caption_text:
                        c.setFillColor(colors.HexColor(style["color_black"]))
                        c.setFont(FONT_BODY, 8)

                        # Calculate caption area
                        caption_y = y + caption_reserve - 0.12 * inch
                        line_height = 0.12 * inch
                        max_caption_width = scaled_width + 0.3 * inch  # Slightly wider than image

                        # Wrap text to fit
                        words = caption_text.split()
                        lines = []
                        current_line = []
                        for word in words:
                            current_line.append(word)
                            test_line = ' '.join(current_line)
                            # Estimate text width (approx 5 points per char at 8pt)
                            if len(test_line) * 5 > max_caption_width * 72 / inch:
                                if len(current_line) > 1:
                                    current_line.pop()
                                    lines.append(' '.join(current_line))
                                    current_line = [word]
                                else:
                                    lines.append(word)
                                    current_line = []
                        if current_line:
                            lines.append(' '.join(current_line))

                        # Draw caption lines (max 2 lines), centered under image
                        for line in lines[:2]:
                            line_width = c.stringWidth(line, FONT_BODY, 8)
                            line_x = img_x + (scaled_width - line_width) / 2
                            c.drawString(line_x, caption_y, line)
                            caption_y -= line_height

                except Exception as e:
                    logger.error(f"Failed to draw photo: {e}")
                    # Draw professional placeholder
                    c.setStrokeColor(COLOR_LIGHT_GRAY)
                    c.setFillColor(COLOR_VERY_LIGHT_GRAY)
                    c.rect(x, y + 0.3 * inch, photo_width, photo_height - 0.3 * inch, fill=1)
                    c.setFillColor(COLOR_MEDIUM_GRAY)
                    c.setFont(FONT_BODY, 10)
                    c.drawCentredString(x + photo_width / 2, y + photo_height / 2, "Image not available")
                    c.setFillColor(colors.HexColor(style["color_black"]))

            # Page footer — variant layout
            total_pages += 1
            ft_mode = style.get("footer_style", "center")
            footer_y = 0.65 * inch
            footer_text_y = 0.4 * inch
            prop_addr = job_data.get('property_address', '')

            if ft_mode == "full_bar":
                # ── Full accent bar + 3 columns ──
                c.setFillColor(COLOR_ACCENT)
                c.rect(0, footer_y - 0.05 * inch,
                       page_width, 0.35 * inch,
                       fill=1, stroke=0)
                c.setFillColor(colors.white)
                c.setFont(FONT_BODY, 8)
                c.drawString(margin, footer_text_y,
                             f"Page {total_pages}")
                c.drawCentredString(
                    page_width / 2, footer_text_y,
                    section_title)
                c.drawRightString(
                    page_width - margin, footer_text_y,
                    prop_addr)
            elif ft_mode == "split":
                # ── Split: page left, address right, no center ──
                c.setStrokeColor(COLOR_ACCENT)
                c.setLineWidth(1)
                c.line(margin, footer_y,
                       page_width - margin, footer_y)
                c.setFillColor(COLOR_DARK_GRAY)
                c.setFont(FONT_BODY, 8)
                c.drawString(
                    margin, footer_text_y,
                    f"Page {total_pages} — {section_title}")
                c.setFont(FONT_BODY, 8)
                c.drawRightString(
                    page_width - margin, footer_text_y,
                    prop_addr)
            else:
                # ── Default center ──
                c.setStrokeColor(COLOR_LIGHT_GRAY)
                c.setLineWidth(0.5)
                c.line(margin, footer_y,
                       page_width - margin, footer_y)
                c.setFillColor(COLOR_MEDIUM_GRAY)
                c.setFont(FONT_BODY, 8)
                c.drawString(
                    margin, footer_text_y,
                    f"Page {total_pages}")
                c.drawCentredString(
                    page_width / 2, footer_text_y,
                    section_title)
                c.drawRightString(
                    page_width - margin, footer_text_y,
                    prop_addr)

            c.save()
            page_buffer.seek(0)

            # Add page to writer
            page_reader = PdfReader(page_buffer)
            writer.add_page(page_reader.pages[0])

    # ===== WRITE FINAL PDF =====
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, 'wb') as output_file:
        writer.write(output_file)

    # Cleanup temporary files (compressed images)
    for temp_file_path in temp_files:
        try:
            import os
            os.unlink(temp_file_path)
        except Exception as e:
            logger.warning(f"Failed to cleanup temp file {temp_file_path}: {e}")

    logger.info(f"Report PDF generated successfully: {output_path} ({total_pages} pages)")
    return str(output_path)


def generate_ewa_pdf(
    job_address: str,
    date_of_loss: str,
    photo_path: str,
    output_path: str,
    rotation: int = 0,
    company_code: Optional[str] = None,
    compress: bool = False
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
        rotation: Rotation degrees for the photo (0, 90, 180, 270)
        company_code: Company code to select company-specific template (e.g., "ENTER", "BETHANY")
                     If None, uses default template (Enter Construction)
        compress: If True, compress the photo to reduce file size

    Returns:
        Path to the generated PDF

    Raises:
        RuntimeError: If pypdf or reportlab is not available
        FileNotFoundError: If template or photo file not found
    """
    _ensure_pypdf()
    if not PYPDF_AVAILABLE:
        raise RuntimeError("pypdf and reportlab are required for EWA PDF generation")

    import logging
    logger = logging.getLogger(__name__)

    # Get company-specific template configuration
    template_config = get_ewa_template_config(company_code)
    template_path = template_config["template_path"]
    logger.info(f"Using EWA template for company '{company_code or 'default'}': {template_path}")

    # Validate template exists
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
        # "October 25" format for first blank (use safe_strftime for %B)
        date_month_day = safe_strftime(dt, "%B %d")
        # "25" format for year (last 2 digits) for second blank after "20"
        date_year = dt.strftime("%y")
    except Exception as e:
        logger.warning(f"Failed to format date: {e}, using as-is")
        date_month_day = str(date_of_loss)
        date_year = ""

    # Step 1: Create overlay PDF with text fields
    overlay_buffer = io.BytesIO()
    c = canvas.Canvas(overlay_buffer, pagesize=letter)

    # Set font and text color using company-specific config
    c.setFont(template_config["font_name"], template_config["font_size"])
    c.setFillColorRGB(0, 0, 0)  # Black color
    c.setStrokeColorRGB(0, 0, 0)

    # Log what we're drawing
    logger.info(f"Drawing address at ({template_config['address_x']}, {template_config['address_y']}): '{job_address}'")
    logger.info(f"Drawing date (month/day) at ({template_config['date_month_day_x']}, {template_config['date_month_day_y']}): '{date_month_day}'")
    logger.info(f"Drawing date (year) at ({template_config['date_year_x']}, {template_config['date_year_y']}): '{date_year}'")

    # Draw address
    c.drawString(
        template_config["address_x"],
        template_config["address_y"],
        job_address
    )

    # Draw date - month and day part (e.g., "October 25")
    c.drawString(
        template_config["date_month_day_x"],
        template_config["date_month_day_y"],
        date_month_day
    )

    # Draw date - year part (e.g., "25" for 2025)
    c.drawString(
        template_config["date_year_x"],
        template_config["date_year_y"],
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

    # Load and optionally rotate image
    from PIL import Image, ImageOps
    img = Image.open(photo_path)
    # Apply EXIF orientation (smartphones store images sideways with EXIF rotation tag)
    img = ImageOps.exif_transpose(img)

    # Compression settings - balanced quality and file size
    if compress:
        IMAGE_QUALITY = 50  # Balanced quality (25=low, 95=original)
        IMAGE_MAX_SIZE = 1200  # Maximum dimension in pixels
        logger.info("Compression enabled: quality=50, max_size=1200px")
    else:
        IMAGE_QUALITY = 95  # High quality for original
        IMAGE_MAX_SIZE = None  # No resizing

    # Apply rotation if needed
    if rotation != 0:
        # PIL's rotate is counter-clockwise, so we negate for clockwise rotation
        img = img.rotate(-rotation, expand=True)
        logger.info(f"Rotated photo by {rotation} degrees")

    # Apply compression (resize if needed)
    if compress and IMAGE_MAX_SIZE:
        original_size = f"{img.width}x{img.height}"
        if img.width > IMAGE_MAX_SIZE or img.height > IMAGE_MAX_SIZE:
            img.thumbnail((IMAGE_MAX_SIZE, IMAGE_MAX_SIZE), Image.Resampling.LANCZOS)
            logger.info(f"Resized image from {original_size} to {img.width}x{img.height}")

    # Convert to RGB if necessary (for PNG with alpha)
    if img.mode in ('RGBA', 'P'):
        img = img.convert('RGB')

    # Always save processed image to temp file so ReportLab uses
    # the EXIF-corrected (and optionally rotated/compressed) version
    import tempfile
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.jpg')
    # subsampling='4:2:0' for maximum compression
    img.save(temp_file.name, format='JPEG', quality=IMAGE_QUALITY, optimize=True, subsampling='4:2:0')
    photo_path = temp_file.name
    logger.info(f"Saved processed photo to: {photo_path}")

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


# Lazy singleton - initialized on first access to avoid loading WeasyPrint at import time
_pdf_service = None


def get_pdf_service():
    global _pdf_service
    if _pdf_service is None:
        _ensure_weasyprint()
        if WEASYPRINT_AVAILABLE:
            _pdf_service = PDFService()
    return _pdf_service


# Keep backward-compatible module-level name via property-like access
# Code importing `pdf_service` directly will get None initially;
# callers should use get_pdf_service() or the attribute will be populated on first call
pdf_service = None