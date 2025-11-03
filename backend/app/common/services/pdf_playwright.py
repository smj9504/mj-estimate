"""
Playwright-based PDF Generation Service for React Backend
Separate from Streamlit's WeasyPrint pdf_generator.py
"""

import asyncio
from pathlib import Path
from typing import Dict, Any, Optional
import json
import re
from datetime import datetime
from jinja2 import Environment, FileSystemLoader
from playwright.async_api import async_playwright, Browser, Page
import logging

logger = logging.getLogger(__name__)

# Template directory for React backend (separate from Streamlit)
REACT_TEMPLATE_DIR = Path(__file__).parent.parent / "templates" / "react_pdf"
REACT_TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)

class PlaywrightPDFService:
    """Playwright-based PDF service for React backend"""
    
    def __init__(self):
        self.template_dir = REACT_TEMPLATE_DIR
        self.env = Environment(loader=FileSystemLoader(str(self.template_dir)))
        self._register_filters()
        self._browser: Optional[Browser] = None
        
    def _register_filters(self):
        """Register custom Jinja2 filters (copied from Streamlit pdf_generator.py)"""
        self.env.filters['format_currency'] = self._format_currency
        self.env.filters['format_number'] = self._format_number
        self.env.filters['format_date'] = self._format_date
        self.env.filters['float'] = self._safe_float_filter
        self.env.filters['replace'] = self._safe_replace
        
    @staticmethod
    def _format_currency(value: Any) -> str:
        """Format number as currency with proper negative handling"""
        try:
            if value is None or value == '':
                return "$0.00"
            if isinstance(value, str):
                value = value.replace('$', '').replace(',', '').strip()
            num_value = float(value)
            if num_value < 0:
                # Format negative as -$X,XXX.XX instead of $-X,XXX.XX
                return f"-${abs(num_value):,.2f}"
            else:
                return f"${num_value:,.2f}"
        except (ValueError, TypeError):
            return "$0.00"
    
    @staticmethod
    def _format_number(value: Any, decimal_places: int = 2) -> str:
        """Format number with commas (copied from Streamlit)"""
        try:
            if value is None or value == '':
                return "0.00"
            num_value = float(str(value).replace('$', '').replace(',', ''))
            return f"{num_value:,.{decimal_places}f}"
        except (ValueError, TypeError):
            return "0.00"
    
    @staticmethod
    def _format_date(value: Any, format_str: str = "%B %d, %Y") -> str:
        """Format date string (copied from Streamlit)"""
        if isinstance(value, str):
            try:
                dt = datetime.strptime(value, "%Y-%m-%d")
                return dt.strftime(format_str)
            except:
                try:
                    dt = datetime.strptime(value, "%m-%d-%Y")
                    return dt.strftime(format_str)
                except:
                    return value
        elif isinstance(value, datetime):
            return value.strftime(format_str)
        return str(value)
    
    @staticmethod 
    def _safe_float_filter(value: Any) -> float:
        """Safe float conversion (copied from Streamlit safe_float_conversion)"""
        if value is None or value == '' or value == 'None':
            return 0.0
        try:
            str_value = str(value).strip()
            if not str_value or str_value.lower() in ['nan', 'none', 'null']:
                return 0.0
            cleaned_value = re.sub(r'[$,\s]', '', str_value)
            if '%' in cleaned_value:
                cleaned_value = cleaned_value.replace('%', '')
                return float(cleaned_value)
            if not cleaned_value:
                return 0.0
            return float(cleaned_value)
        except (ValueError, TypeError, AttributeError):
            return 0.0
    
    @staticmethod
    def _safe_replace(text: Any, old: str, new: str) -> str:
        """Safe string replacement (copied from Streamlit)"""
        if text is None:
            return ''
        try:
            return str(text).replace(str(old), str(new))
        except Exception:
            return str(text)
    
    async def _get_browser(self) -> Browser:
        """Get or create browser instance"""
        if self._browser is None:
            playwright = await async_playwright().__aenter__()
            self._browser = await playwright.chromium.launch(headless=True)
        return self._browser
    
    async def _close_browser(self):
        """Close browser instance"""
        if self._browser:
            await self._browser.close()
            self._browser = None
    
    def _clean_nan(self, obj: Any) -> Any:
        """Clean NaN values (copied from Streamlit clean_nan function)"""
        if isinstance(obj, dict):
            return {k: self._clean_nan(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self._clean_nan(v) for v in obj]
        elif isinstance(obj, float) and str(obj) == "nan":
            return 0.0
        elif obj is None:
            return ""
        return obj
    
    def _safe_note_processing(self, note_value: Any) -> str:
        """Safe note processing (copied from Streamlit)"""
        if note_value is None:
            return ""
        if isinstance(note_value, (int, float)):
            if str(note_value) == "nan":
                return ""
            return str(note_value)
        try:
            note_str = str(note_value).strip()
            if note_str.lower() in ['nan', 'none', 'null', '']:
                return ""
            return note_str
        except Exception:
            return ""
    
    def _validate_estimate_data(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Validate estimate data (adapted from Streamlit validate_estimate_data)"""
        import copy
        
        logger.info("Validating estimate data with Playwright service")
        context = copy.deepcopy(context)
        
        # Clean NaN values first
        context = self._clean_nan(context)
        
        # Initialize basic structure
        if 'company' not in context:
            context['company'] = {}
        if 'client' not in context:
            context['client'] = {}
        if 'trades' not in context:
            context['trades'] = []
        
        # Generate estimate number and date if missing
        if not context.get('estimate_number'):
            client_address = context.get('client', {}).get('address', '')
            context['estimate_number'] = self._generate_estimate_number(client_address)
        
        if not context.get('estimate_date'):
            context['estimate_date'] = datetime.now().strftime("%B %d, %Y")
        
        # Initialize financial fields
        context['subtotal'] = self._safe_float_filter(context.get('subtotal', 0.0))
        context['discount'] = self._safe_float_filter(context.get('discount', 0.0))
        context['tax_rate'] = self._safe_float_filter(context.get('tax_rate', 0.0))
        context['sales_tax'] = self._safe_float_filter(context.get('sales_tax', 0.0))
        context['overhead_rate'] = self._safe_float_filter(context.get('overhead_rate', 0.0))
        context['overhead_amount'] = self._safe_float_filter(context.get('overhead_amount', 0.0))
        context['profit_rate'] = self._safe_float_filter(context.get('profit_rate', 0.0))
        context['profit_amount'] = self._safe_float_filter(context.get('profit_amount', 0.0))
        context['sales_tax_amount'] = self._safe_float_filter(context.get('sales_tax_amount', 0.0))
        context['total'] = self._safe_float_filter(context.get('total', 0.0))
        
        # Handle nested overhead/profit structures
        if 'overhead' not in context:
            context['overhead'] = {
                'rate': context.get('overhead_rate', 0.0),
                'amount': context.get('overhead_amount', 0.0)
            }
        
        if 'profit' not in context:
            context['profit'] = {
                'rate': context.get('profit_rate', 0.0),
                'amount': context.get('profit_amount', 0.0)
            }
        
        if 'sales_tax' not in context or not isinstance(context['sales_tax'], dict):
            context['sales_tax'] = {
                'amount': context.get('sales_tax_amount', context.get('sales_tax', 0.0))
            }
        
        # Process notes
        context['top_note'] = self._safe_note_processing(context.get('top_note', ''))
        context['bottom_note'] = self._safe_note_processing(context.get('bottom_note', ''))
        context['disclaimer'] = self._safe_note_processing(context.get('disclaimer', ''))
        
        # Set defaults for company and client
        company_defaults = {
            'name': 'Company Name', 'address': 'Company Address', 'city': 'City', 
            'state': 'State', 'zip': 'ZIP', 'phone': 'Phone', 'email': 'Email', 'logo': ''
        }
        for key, default in company_defaults.items():
            context['company'].setdefault(key, default)
        
        client_defaults = {
            'name': 'Client Name', 'address': 'Client Address', 'city': 'City',
            'state': 'State', 'zip': 'ZIP', 'phone': 'Phone', 'email': 'Email'
        }
        for key, default in client_defaults.items():
            context['client'].setdefault(key, default)
        
        # Process trades (copied logic from Streamlit)
        new_trades = []
        for i, trade in enumerate(context.get('trades', [])):
            new_trade = {
                'name': self._safe_note_processing(trade.get('name', f'Trade {i+1}')),
                'note': self._safe_note_processing(trade.get('note', '')),
                'locations': []
            }
            
            for j, location in enumerate(trade.get('locations', [])):
                location_subtotal = self._safe_float_filter(location.get('subtotal', 0.0))
                
                new_location = {
                    'name': self._safe_note_processing(location.get('name', f'Location {j+1}')),
                    'note': self._safe_note_processing(location.get('note', '')),
                    'showSubtotal': location.get('showSubtotal', True),
                    'subtotal': location_subtotal,
                    'categories': []
                }
                
                # Process categories
                categories = location.get('categories', [])
                for k, category in enumerate(categories):
                    new_category = {
                        'name': self._safe_note_processing(category.get('name', f'Category {k+1}')),
                        'items': []
                    }
                    
                    items = category.get('items', [])
                    if isinstance(items, list):
                        for l, item in enumerate(items):
                            if isinstance(item, dict):
                                new_item = {
                                    'name': self._safe_note_processing(item.get('name', '')),
                                    'qty': self._safe_float_filter(item.get('qty', 0)),
                                    'unit': str(item.get('unit', 'ea')),
                                    'price': self._safe_float_filter(item.get('price', 0)),
                                    'description': self._safe_note_processing(item.get('description', ''))
                                }
                                if new_item['name']:
                                    new_category['items'].append(new_item)
                    
                    new_location['categories'].append(new_category)
                
                new_trade['locations'].append(new_location)
            
            new_trades.append(new_trade)
        
        context['trades'] = new_trades
        logger.info(f"Validated estimate data - trades count: {len(context['trades'])}")
        
        return context
    
    def _calculate_estimate_totals(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate estimate totals (copied from Streamlit calculate_estimate_totals)"""
        logger.info("Calculating estimate totals with Playwright service")
        
        subtotal = 0.0
        
        # Calculate location subtotals
        for trade in data.get('trades', []):
            for location in trade.get('locations', []):
                location_subtotal = self._calculate_location_subtotal(location)
                location['subtotal'] = location_subtotal
                subtotal += location_subtotal
        
        data['subtotal'] = subtotal
        logger.info(f"Calculated total subtotal: ${subtotal}")
        
        # Calculate overhead and profit
        overhead_rate = self._safe_float_filter(data.get('overhead_rate', 0))
        profit_rate = self._safe_float_filter(data.get('profit_rate', 0))
        
        overhead_amount = self._safe_float_filter(data.get('overhead_amount', 0))
        profit_amount = self._safe_float_filter(data.get('profit_amount', 0))
        
        if overhead_amount <= 0 and overhead_rate > 0:
            if overhead_rate <= 1:
                overhead_amount = subtotal * overhead_rate
            else:
                overhead_amount = subtotal * (overhead_rate / 100)
            data['overhead_amount'] = overhead_amount
        
        if profit_amount <= 0 and profit_rate > 0:
            if profit_rate <= 1:
                profit_amount = subtotal * profit_rate
            else:
                profit_amount = subtotal * (profit_rate / 100)
            data['profit_amount'] = profit_amount
        
        # Sales tax (fixed amount)
        sales_tax_amount = 0.0
        if 'sales_tax_amount' in data:
            sales_tax_amount = self._safe_float_filter(data['sales_tax_amount'])
        elif isinstance(data.get('sales_tax'), dict):
            sales_tax_amount = self._safe_float_filter(data['sales_tax'].get('amount', 0))
        elif 'sales_tax' in data:
            sales_tax_amount = self._safe_float_filter(data['sales_tax'])
        
        data['sales_tax_amount'] = sales_tax_amount
        
        # Final total calculation
        discount = self._safe_float_filter(data.get('discount', 0))
        total = subtotal + overhead_amount + profit_amount + sales_tax_amount - discount
        data['total'] = total
        
        logger.info(f"Final calculations - Subtotal: ${subtotal}, Overhead: ${overhead_amount}, "
                   f"Profit: ${profit_amount}, Sales Tax: ${sales_tax_amount}, Total: ${total}")
        
        # Update nested structures
        data['overhead'] = {'rate': overhead_rate, 'amount': overhead_amount}
        data['profit'] = {'rate': profit_rate, 'amount': profit_amount}
        data['sales_tax'] = {'amount': sales_tax_amount}
        
        return data
    
    def _calculate_location_subtotal(self, location: Dict[str, Any]) -> float:
        """Calculate location subtotal (copied from Streamlit)"""
        # Use stored subtotal if available
        stored_subtotal = self._safe_float_filter(location.get('subtotal', 0))
        if stored_subtotal > 0:
            logger.info(f"Using stored subtotal for location '{location.get('name', 'Unknown')}': ${stored_subtotal}")
            return stored_subtotal
        
        # Calculate from categories
        categories = location.get('categories', [])
        if not categories:
            logger.info(f"No categories for location '{location.get('name', 'Unknown')}', returning 0")
            return 0.0
        
        total = 0.0
        for category in categories:
            items = category.get('items', [])
            for item in items:
                if 'qty' in item and 'price' in item:
                    qty = self._safe_float_filter(item['qty'])
                    price = self._safe_float_filter(item['price'])
                    total += qty * price
        
        logger.info(f"Calculated subtotal for location '{location.get('name', 'Unknown')}': ${total}")
        return total
    
    def _generate_estimate_number(self, client_address: str = "") -> str:
        """Generate estimate number (copied from Streamlit)"""
        now = datetime.now()
        year_month = now.strftime("%Y%m")
        
        address_prefix = ""
        if client_address:
            alphanumeric = ''.join(c.upper() for c in client_address if c.isalnum())
            address_prefix = alphanumeric[:4].ljust(4, '0')
        else:
            address_prefix = "0000"
        
        return f"EST_{year_month}_{address_prefix}"
    
    async def generate_pdf(
        self, 
        context: Dict[str, Any], 
        template_key: str
    ) -> bytes:
        """Generate PDF using registered template"""
        logger.info(f"Generating PDF with template key: {template_key}")
        
        try:
            # Get template manager
            from .template_manager import get_template_manager
            template_manager = get_template_manager()
            
            # Get template path
            template_path = template_manager.get_template_path(template_key)
            if not template_path:
                raise ValueError(f"Template key '{template_key}' not registered")
            
            if not template_manager.template_exists(template_key):
                raise FileNotFoundError(f"Template file not found: {template_path}")
            
            # Validate and calculate data (using Streamlit logic)
            context = self._validate_estimate_data(context)
            context = self._calculate_estimate_totals(context)
            
            # Load and render template
            template = self.env.get_template(template_path)
            html_content = template.render(**context)
            
            # Generate PDF with Playwright
            browser = await self._get_browser()
            page = await browser.new_page()
            
            # Set content and wait for load
            await page.set_content(html_content, wait_until='networkidle')
            
            # Generate PDF with same settings as WeasyPrint
            pdf_bytes = await page.pdf(
                format='A4',
                margin={
                    'top': '0.32in',
                    'right': '0.32in', 
                    'bottom': '0.75in',
                    'left': '0.32in'
                },
                print_background=True,
                display_header_footer=True,
                header_template=self._generate_header_template(context),
                footer_template=self._generate_footer_template(),
                prefer_css_page_size=False
            )
            
            await page.close()
            
            logger.info("PDF generated successfully with Playwright")
            return pdf_bytes
            
        except Exception as e:
            logger.error(f"Error generating PDF: {e}")
            raise e
    
    def _generate_header_template(self, context: Dict[str, Any]) -> str:
        """Generate header template for PDF"""
        company = context.get('company', {})
        client = context.get('client', {})
        
        company_info = []
        if company.get('name'):
            company_info.append(company['name'])
        if company.get('address'):
            company_info.append(company['address'])
        if company.get('phone'):
            company_info.append(company['phone'])
        
        client_info = []
        if client.get('name'):
            client_info.append(client['name'])
        if client.get('address'):
            client_info.append(client['address'])
        
        return f'''
        <div style="font-size: 11px; margin: 0 32px; width: 100%; display: flex; justify-content: space-between;">
            <div style="text-align: left;">
                {chr(10).join(company_info)}
            </div>
            <div style="text-align: right;">
                {chr(10).join(client_info)}
            </div>
        </div>
        '''
    
    def _generate_footer_template(self) -> str:
        """Generate footer template for PDF"""
        today_str = datetime.now().strftime("%Y-%m-%d")
        return f'''
        <div style="font-size: 10px; margin: 0 32px; width: 100%; display: flex; justify-content: space-between;">
            <div>Generated on {today_str}</div>
            <div>Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>
        </div>
        '''
    
    async def close(self):
        """Close service and cleanup resources"""
        await self._close_browser()

# Singleton instance
playwright_pdf_service = None

async def get_playwright_pdf_service() -> PlaywrightPDFService:
    """Get or create Playwright PDF service instance"""
    global playwright_pdf_service
    if playwright_pdf_service is None:
        playwright_pdf_service = PlaywrightPDFService()
    return playwright_pdf_service