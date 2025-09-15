"""
PDF Generation Service for React Backend
Separate from Streamlit's pdf_generator.py
"""

from pathlib import Path
from jinja2 import Environment, FileSystemLoader
from datetime import datetime
import os
import sys
from typing import Dict, Any, Optional
import json
import re

# Add GTK+ path for WeasyPrint on Windows
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

# Template directory for React backend - correct path to backend/app/templates
TEMPLATE_DIR = Path(__file__).parent.parent.parent / "templates"
TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)


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
        """Format number as currency"""
        try:
            return f"${value:,.2f}"
        except (ValueError, TypeError):
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
    
    @staticmethod
    def _markdown_to_html(text: str) -> str:
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
        # Validate and prepare data
        context = self._prepare_invoice_context(data)
        
        # Load template - default to modern template
        template_path = f"invoice/general_invoice.html"
        template = self.env.get_template(template_path)
        html_content = template.render(**context)
        
        # general_invoice.html has inline CSS, so no external stylesheets needed
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
    
    def generate_estimate_html(self, data: Dict[str, Any]) -> str:
        """
        Generate estimate HTML from data (without converting to PDF)
        
        Args:
            data: Estimate data dictionary
            
        Returns:
            HTML content as string
        """
        import logging
        logger = logging.getLogger(__name__)
        
        logger.info("Starting HTML generation...")
        logger.info(f"Input data keys: {list(data.keys())}")
        
        # Validate and prepare data
        try:
            context = self._prepare_estimate_context(data)
            logger.info(f"Context prepared with keys: {list(context.keys())}")
        except Exception as e:
            logger.error(f"Error preparing context: {e}")
            raise
        
        # Load template - try standard first, fallback to estimate.html
        try:
            template = self.env.get_template("estimate/standard.html")
            logger.info("Using estimate/standard.html template")
        except Exception as e:
            logger.warning(f"Could not load standard template: {e}, trying fallback")
            try:
                template = self.env.get_template("estimate.html")
                logger.info("Using estimate.html template")
            except Exception as e2:
                logger.error(f"Could not load any template: {e2}")
                raise
        
        try:
            html_content = template.render(**context)
            logger.info(f"HTML content rendered, length: {len(html_content)}")
            return html_content
        except Exception as e:
            logger.error(f"Error rendering template: {e}")
            raise
    
    def generate_estimate_pdf(self, data: Dict[str, Any], output_path: str) -> str:
        """
        Generate estimate PDF from data
        
        Args:
            data: Estimate data dictionary
            output_path: Path to save the PDF
            
        Returns:
            Path to the generated PDF
        """
        import logging
        logger = logging.getLogger(__name__)
        
        logger.info("Starting PDF generation...")
        logger.info(f"Input data keys: {list(data.keys())}")
        
        # Validate and prepare data
        try:
            context = self._prepare_estimate_context(data)
            logger.info(f"Context prepared with keys: {list(context.keys())}")
        except Exception as e:
            logger.error(f"Error preparing context: {e}")
            raise
        
        # Load template - try standard first, fallback to estimate.html
        try:
            template = self.env.get_template("estimate/standard.html")
            logger.info("Using estimate/standard.html template")
        except Exception as e:
            logger.warning(f"Could not load standard template: {e}, trying fallback")
            try:
                template = self.env.get_template("estimate.html")
                logger.info("Using estimate.html template")
            except Exception as e2:
                logger.error(f"Could not load any template: {e2}")
                raise
        
        try:
            html_content = template.render(**context)
            logger.info(f"HTML content rendered, length: {len(html_content)}")
        except Exception as e:
            logger.error(f"Error rendering template: {e}")
            raise
        
        # Load CSS - try estimate directory first
        css_path = self.template_dir / "estimate" / "estimate.css"
        if not css_path.exists():
            css_path = self.template_dir / "estimate.css"
        stylesheets = []
        
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
        print("=== DEBUG: Starting _prepare_invoice_context ===")
        print(f"Input data: {json.dumps(data, indent=2, default=str)}")
        
        context = data.copy()
        
        # Set defaults and map to template-expected variable names
        context.setdefault('invoice_number', self._generate_invoice_number())
        context.setdefault('date', datetime.now().strftime("%Y-%m-%d"))
        context.setdefault('due_date', datetime.now().strftime("%Y-%m-%d"))
        
        # Map to template variable names
        context['date_of_issue'] = context.get('date', datetime.now().strftime("%Y-%m-%d"))
        context['date_due'] = context.get('due_date', datetime.now().strftime("%Y-%m-%d"))
        
        # Ensure required sections exist with safe defaults
        context.setdefault('company', {'name': 'Unknown Company'})
        context.setdefault('client', {'name': 'Unknown Client'})
        context.setdefault('items', [])
        context.setdefault('insurance', {})
        
        # Ensure company and client have safe name values
        if not context['company'].get('name'):
            context['company']['name'] = 'Unknown Company'
        if not context['client'].get('name'):
            context['client']['name'] = 'Unknown Client'
        
        # Calculate totals
        items = context.get('items', [])
        subtotal = sum(
            float(item.get('quantity', 0)) * float(item.get('rate', 0))
            for item in items
        )
        
        context['subtotal'] = subtotal
        context['subtotal_total'] = subtotal  # Template expects this name
        context.setdefault('tax_rate', 0)
        tax_amount = subtotal * float(context['tax_rate']) / 100
        context['tax_amount'] = tax_amount
        context['tax_calculated'] = tax_amount  # Template expects this name
        
        context.setdefault('discount', 0)
        context.setdefault('shipping', 0)
        total = subtotal - float(context.get('discount', 0)) + tax_amount + float(context.get('shipping', 0))
        context['total'] = total
        context['total_with_tax'] = total  # Template expects this name
        
        # Modern template expects serviceSections structure
        # IMPORTANT: Using 'line_items' instead of 'items' to avoid conflict with dict.items() method
        if items:
            context['serviceSections'] = [
                {
                    'title': 'Services',
                    'line_items': [
                        {
                            'name': str(item.get('name', '')),
                            'dec': str(item.get('description', '')),  # modern template uses 'dec' not 'description'
                            'qty': float(item.get('quantity', 0)),
                            'unit': str(item.get('unit', 'ea')),
                            'price': float(item.get('rate', 0)),  # modern template uses 'price' not 'rate'
                            'hide_price': False
                        }
                        for item in items
                    ],
                    'subtotal': subtotal,
                    'showSubtotal': len(items) > 1
                }
            ]
        else:
            context['serviceSections'] = []
            
        # Also keep 'items' for backward compatibility
        context['items'] = [
            {
                'name': str(item.get('name', '')),
                'description': str(item.get('description', '')),
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
        
        # Convert markdown in notes and payment_terms
        if context.get('notes'):
            context['notes'] = self._markdown_to_html(context['notes'])
        if context.get('payment_terms'):
            context['payment_terms'] = self._markdown_to_html(context['payment_terms'])
        
        print(f"=== DEBUG: Final context keys: {list(context.keys())} ===")
        print(f"=== DEBUG: Company: {context.get('company')} ===")
        print(f"=== DEBUG: Client: {context.get('client')} ===")
        print(f"=== DEBUG: Total: {context.get('total')} ===")
        print("=== DEBUG: End _prepare_invoice_context ===")
        
        return context
    
    def _prepare_estimate_context(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Prepare and validate estimate context for template"""
        context = data.copy()
        
        # Set defaults
        context.setdefault('estimate_number', self._generate_estimate_number())
        context.setdefault('date', datetime.now().strftime("%Y-%m-%d"))
        context.setdefault('valid_until', datetime.now().strftime("%Y-%m-%d"))
        
        # Ensure required sections exist and clean empty values
        company = context.get('company', {})
        client = context.get('client', {})
        
        # Clean empty string values from company and client
        cleaned_company = {k: v for k, v in company.items() if v and str(v).strip()}
        cleaned_client = {k: v for k, v in client.items() if v and str(v).strip()}
        
        # Set defaults for missing required fields
        cleaned_company.setdefault('name', 'Company Name Not Provided')
        cleaned_client.setdefault('name', 'Client Name Not Provided')
        
        context['company'] = cleaned_company
        context['client'] = cleaned_client
        context.setdefault('items', [])
        context.setdefault('sections', [])
        
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
                    unit_price = float(item.get('unit_price', 0))
                    item_total = quantity * unit_price
                    processed_item['total'] = item_total
                    section_subtotal += item_total
                    
                    processed_items.append(processed_item)
                
                processed_section = section.copy()
                processed_section['items'] = processed_items
                processed_section['subtotal'] = section_subtotal
                processed_sections.append(processed_section)
                total_subtotal += section_subtotal
            
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
        company = context.get('company', {})
        client = context.get('client', {})
        
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
        
        return f"""
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


# Singleton instance
pdf_service = PDFService() if WEASYPRINT_AVAILABLE else None