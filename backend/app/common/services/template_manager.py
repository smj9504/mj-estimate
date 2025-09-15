"""
Unified Template Manager for PDF Templates
"""

import json
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
from jinja2 import Environment, FileSystemLoader
from weasyprint import CSS


class UnifiedTemplateManager:
    """
    Centralized template and CSS management system for PDF generation
    
    Features:
    - Template registry management
    - Company-specific template overrides
    - Automatic CSS loading and compilation
    - Template variant support
    """
    
    def __init__(self, template_base_dir: Path):
        self.template_base_dir = Path(template_base_dir)
        self.registry_path = self.template_base_dir / "template_registry.json"
        self.registry = self._load_registry()
        
        # Setup Jinja2 environment
        self.env = Environment(loader=FileSystemLoader(str(self.template_base_dir)))
        self._register_filters()
    
    def _load_registry(self) -> Dict[str, Any]:
        """Load template registry from JSON file"""
        if not self.registry_path.exists():
            return {}
        
        try:
            with open(self.registry_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"Failed to load template registry: {e}")
            return {}
    
    def _save_registry(self) -> None:
        """Save template registry to JSON file"""
        try:
            with open(self.registry_path, 'w', encoding='utf-8') as f:
                json.dump(self.registry, f, indent=2)
        except Exception as e:
            print(f"Failed to save template registry: {e}")
    
    def _register_filters(self) -> None:
        """Register custom Jinja2 filters"""
        from datetime import datetime
        import re
        
        def format_currency(value: float) -> str:
            try:
                return f"${value:,.2f}"
            except (ValueError, TypeError):
                return "$0.00"
        
        def format_date(value, format: str = "%B %d, %Y") -> str:
            if isinstance(value, str):
                try:
                    dt = datetime.strptime(value, "%Y-%m-%d")
                    return dt.strftime(format)
                except:
                    try:
                        dt = datetime.strptime(value, "%m-%d-%Y")
                        return dt.strftime(format)
                    except:
                        return value
            elif isinstance(value, datetime):
                return value.strftime(format)
            return str(value)
        
        self.env.filters['format_currency'] = format_currency
        self.env.filters['format_date'] = format_date
    
    def get_template_info(self, document_type: str, variant: str = "standard", company_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Get template information from registry
        
        Args:
            document_type: Type of document (invoice, estimate, etc.)
            variant: Template variant (standard, modern, etc.)
            company_id: Optional company ID for custom templates
            
        Returns:
            Template information dictionary or None
        """
        # Check for company-specific template first
        if company_id:
            company_key = f"{document_type}_company_{company_id}"
            if company_key in self.registry and variant in self.registry[company_key]:
                return self.registry[company_key][variant]
        
        # Fall back to standard template
        if document_type in self.registry and variant in self.registry[document_type]:
            return self.registry[document_type][variant]
        
        return None
    
    def get_template_path(self, document_type: str, variant: str = "standard", company_id: Optional[str] = None) -> Optional[str]:
        """
        Get template file path
        
        Args:
            document_type: Type of document
            variant: Template variant
            company_id: Optional company ID for custom templates
            
        Returns:
            Template file path or None
        """
        template_info = self.get_template_info(document_type, variant, company_id)
        if template_info:
            return template_info.get("template")
        return None
    
    def load_template_css(self, document_type: str, variant: str = "standard", company_id: Optional[str] = None) -> List[CSS]:
        """
        Load and compile CSS files for a template
        
        Args:
            document_type: Type of document
            variant: Template variant
            company_id: Optional company ID for custom templates
            
        Returns:
            List of compiled CSS objects
        """
        template_info = self.get_template_info(document_type, variant, company_id)
        if not template_info:
            return []
        
        stylesheets = []
        css_files = template_info.get("css_files", [])
        
        for css_file in css_files:
            css_path = self.template_base_dir / css_file
            if css_path.exists():
                try:
                    with open(css_path, 'r', encoding='utf-8') as f:
                        stylesheets.append(CSS(string=f.read()))
                except Exception as e:
                    print(f"Failed to load CSS file {css_file}: {e}")
        
        return stylesheets
    
    def render_template(self, document_type: str, variant: str, context: Dict[str, Any], company_id: Optional[str] = None) -> Optional[str]:
        """
        Render template with context data
        
        Args:
            document_type: Type of document
            variant: Template variant
            context: Template context data
            company_id: Optional company ID for custom templates
            
        Returns:
            Rendered HTML string or None
        """
        template_path = self.get_template_path(document_type, variant, company_id)
        if not template_path:
            return None
        
        try:
            template = self.env.get_template(template_path)
            return template.render(**context)
        except Exception as e:
            print(f"Failed to render template {template_path}: {e}")
            return None
    
    def register_template(self, document_type: str, variant: str, template_path: str, css_files: List[str] = None, description: str = "", company_customizable: bool = True) -> None:
        """
        Register a new template in the registry
        
        Args:
            document_type: Type of document
            variant: Template variant
            template_path: Path to template file
            css_files: List of CSS file paths
            description: Template description
            company_customizable: Whether template can be customized per company
        """
        if document_type not in self.registry:
            self.registry[document_type] = {}
        
        self.registry[document_type][variant] = {
            "template": template_path,
            "css_files": css_files or [],
            "description": description,
            "company_customizable": company_customizable
        }
        
        self._save_registry()
    
    def register_company_template(self, company_id: str, document_type: str, variant: str, template_path: str, css_files: List[str] = None) -> None:
        """
        Register a company-specific template
        
        Args:
            company_id: Company identifier
            document_type: Type of document
            variant: Template variant
            template_path: Path to template file
            css_files: List of CSS file paths
        """
        company_key = f"{document_type}_company_{company_id}"
        if company_key not in self.registry:
            self.registry[company_key] = {}
        
        self.registry[company_key][variant] = {
            "template": template_path,
            "css_files": css_files or [],
            "description": f"Company {company_id} custom {document_type} template",
            "company_customizable": False,  # Company templates are final
            "company_id": company_id
        }
        
        self._save_registry()
    
    def list_templates(self, document_type: Optional[str] = None) -> Dict[str, Dict[str, Any]]:
        """
        List all available templates
        
        Args:
            document_type: Optional filter by document type
            
        Returns:
            Dictionary of templates organized by document type and variant
        """
        if document_type:
            return {document_type: self.registry.get(document_type, {})}
        
        # Filter out metadata keys
        templates = {}
        for key, value in self.registry.items():
            if key not in ["shared_components", "company_overrides"]:
                templates[key] = value
        
        return templates
    
    def get_company_templates(self, company_id: str) -> Dict[str, Dict[str, Any]]:
        """
        Get all templates for a specific company
        
        Args:
            company_id: Company identifier
            
        Returns:
            Dictionary of company-specific templates
        """
        company_templates = {}
        
        for key, value in self.registry.items():
            if key.endswith(f"_company_{company_id}"):
                # Extract document type from key
                document_type = key.replace(f"_company_{company_id}", "")
                company_templates[document_type] = value
        
        return company_templates
    
    def template_exists(self, document_type: str, variant: str = "standard", company_id: Optional[str] = None) -> bool:
        """
        Check if a template exists
        
        Args:
            document_type: Type of document
            variant: Template variant
            company_id: Optional company ID
            
        Returns:
            True if template exists, False otherwise
        """
        template_path = self.get_template_path(document_type, variant, company_id)
        if not template_path:
            return False
        
        full_path = self.template_base_dir / template_path
        return full_path.exists()


# Create a global template manager instance
def get_template_manager() -> UnifiedTemplateManager:
    """Get the global template manager instance"""
    from pathlib import Path
    template_dir = Path(__file__).parent.parent.parent / "templates"
    return UnifiedTemplateManager(template_dir)


# Global instance for convenience
template_manager = None

def init_template_manager():
    """Initialize the global template manager"""
    global template_manager
    if template_manager is None:
        template_manager = get_template_manager()
    return template_manager