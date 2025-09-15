"""
Document service for combined document operations
"""

from typing import Optional, Dict, Any, List
import io
from datetime import datetime

from app.domains.estimate.service import EstimateService
from app.domains.invoice.service import InvoiceService
from app.domains.document.schemas import DocumentFilter, PaginatedDocuments
from app.core.database_factory import get_database

class DocumentService:
    """Service for document-related operations"""
    
    def __init__(self, db_session=None):
        # Get the database provider
        self.database = get_database()
        self.db_session = db_session
        
        # Initialize services with the database provider
        self.estimate_service = EstimateService(self.database)
        self.invoice_service = InvoiceService(self.database)
    
    def get_documents(self, filter_params: DocumentFilter, page: int, page_size: int) -> PaginatedDocuments:
        """Get documents with filters and pagination"""
        documents = []
        
        # Get estimates if included in filter
        if not filter_params.type or filter_params.type in ['all', 'estimate']:
            estimates = self.estimate_service.get_all()
            for estimate in estimates:
                # Apply filters
                if filter_params.status and estimate.get('status') != filter_params.status:
                    continue
                if filter_params.company_id and estimate.get('company_id') != filter_params.company_id:
                    continue
                if filter_params.date_from and estimate.get('created_at') < filter_params.date_from:
                    continue
                if filter_params.date_to and estimate.get('created_at') > filter_params.date_to:
                    continue
                
                documents.append({
                    'id': estimate['id'],
                    'type': 'estimate',
                    'document_number': estimate.get('estimate_number', ''),  # Changed from 'number' to 'document_number'
                    'date': estimate.get('estimate_date', estimate.get('created_at', '')),
                    'created_at': estimate.get('created_at', ''),  # Added created_at field
                    'status': estimate.get('status', 'draft'),
                    'total_amount': estimate.get('total_amount', estimate.get('total', 0)),  # Changed from 'total' to 'total_amount'
                    'company_id': estimate.get('company_id'),
                    'company_name': estimate.get('company_name', ''),
                    'client_name': estimate.get('client_name', ''),
                })
        
        # Get invoices if included in filter
        if not filter_params.type or filter_params.type in ['all', 'invoice']:
            invoices = self.invoice_service.get_all()
            for invoice in invoices:
                # Apply filters
                if filter_params.status and invoice.get('status') != filter_params.status:
                    continue
                if filter_params.company_id and invoice.get('company_id') != filter_params.company_id:
                    continue
                if filter_params.date_from and invoice.get('created_at') < filter_params.date_from:
                    continue
                if filter_params.date_to and invoice.get('created_at') > filter_params.date_to:
                    continue
                
                documents.append({
                    'id': invoice['id'],
                    'type': 'invoice',
                    'document_number': invoice.get('invoice_number', ''),  # Changed from 'number' to 'document_number'
                    'date': invoice.get('invoice_date', invoice.get('created_at', '')),
                    'created_at': invoice.get('created_at', ''),  # Added created_at field
                    'status': invoice.get('status', 'pending'),
                    'total_amount': invoice.get('total_amount', invoice.get('total', 0)),  # Changed from 'total' to 'total_amount'
                    'company_id': invoice.get('company_id'),
                    'company_name': invoice.get('company_name', ''),  # This might be None, need to get from company
                    'client_name': invoice.get('client_name', ''),
                })
        
        # Sort by date (newest first)
        documents.sort(key=lambda x: x['date'], reverse=True)
        
        # Apply search filter
        if filter_params.search:
            search_term = filter_params.search.lower()
            documents = [
                doc for doc in documents
                if search_term in doc['document_number'].lower()  # Fixed field name
                or search_term in doc.get('client_name', '').lower()
                or search_term in doc.get('company_name', '').lower()
            ]
        
        # Pagination
        total = len(documents)
        start = (page - 1) * page_size
        end = start + page_size
        paginated_docs = documents[start:end]
        
        # Calculate total pages
        total_pages = (total + page_size - 1) // page_size if page_size > 0 else 0
        
        return PaginatedDocuments(
            items=paginated_docs,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages
        )
    
    def get_document(self, document_id: str) -> Optional[Dict[str, Any]]:
        """Get a single document by ID"""
        # First try to get it as an invoice
        invoice = self.invoice_service.get_by_id(document_id)
        if invoice:
            return {
                'id': invoice['id'],
                'type': 'invoice',
                'document_number': invoice.get('invoice_number', ''),
                'date': invoice.get('invoice_date', invoice.get('created_at', '')),
                'created_at': invoice.get('created_at', ''),
                'status': invoice.get('status', 'pending'),
                'total_amount': invoice.get('total_amount', invoice.get('total', 0)),
                'company_id': invoice.get('company_id'),
                'company_name': invoice.get('company_name', ''),
                'client_name': invoice.get('client_name', ''),
                'data': invoice  # Include full data for detailed view
            }
        
        # Then try to get it as an estimate
        estimate = self.estimate_service.get_by_id(document_id)
        if estimate:
            return {
                'id': estimate['id'],
                'type': 'estimate',
                'document_number': estimate.get('estimate_number', ''),
                'date': estimate.get('estimate_date', estimate.get('created_at', '')),
                'created_at': estimate.get('created_at', ''),
                'status': estimate.get('status', 'draft'),
                'total_amount': estimate.get('total_amount', estimate.get('total', 0)),
                'company_id': estimate.get('company_id'),
                'company_name': estimate.get('company_name', ''),
                'client_name': estimate.get('client_name', ''),
                'data': estimate  # Include full data for detailed view
            }
        
        return None
    
    def delete_document(self, document_id: str) -> bool:
        """Delete a document by ID"""
        # Try to delete as invoice first
        if self.invoice_service.delete(document_id):
            return True
        
        # Then try as estimate
        if self.estimate_service.delete(document_id):
            return True
        
        return False
    
    def duplicate_document(self, document_id: str) -> Optional[Dict[str, Any]]:
        """Duplicate a document"""
        # Get the original document first
        document = self.get_document(document_id)
        if not document:
            return None
        
        if document['type'] == 'invoice':
            # Duplicate invoice
            original = self.invoice_service.get_by_id(document_id)
            if original:
                # Remove ID and update number
                new_invoice = original.copy()
                new_invoice.pop('id', None)
                new_invoice['invoice_number'] = f"{original.get('invoice_number', 'INV')}-COPY"
                new_invoice['status'] = 'draft'
                return self.invoice_service.create(new_invoice)
        
        elif document['type'] == 'estimate':
            # Duplicate estimate
            original = self.estimate_service.get_by_id(document_id)
            if original:
                # Remove ID and update number
                new_estimate = original.copy()
                new_estimate.pop('id', None)
                new_estimate['estimate_number'] = f"{original.get('estimate_number', 'EST')}-COPY"
                new_estimate['status'] = 'draft'
                return self.estimate_service.create(new_estimate)
        
        return None
    
    def generate_pdf(self, document_id: str) -> bytes:
        """Generate PDF for a document"""
        # Get the document first
        document = self.get_document(document_id)
        if not document:
            return b''
        
        # TODO: Implement actual PDF generation
        # This would involve using WeasyPrint or similar library
        # For now, return empty bytes
        return b''
    
    def send_document(self, document_id: str, email: str) -> bool:
        """Send document via email"""
        # Get the document first
        document = self.get_document(document_id)
        if not document:
            return False
        
        # TODO: Implement email sending functionality
        # This would involve setting up email configuration
        # For now, just return True to indicate success
        return True
    
    def export_to_excel(self, filter_params: DocumentFilter) -> bytes:
        """Export documents to Excel format"""
        # Get all documents with the filter
        documents = self.get_documents(filter_params, 1, 10000)  # Get all documents
        
        # TODO: Implement Excel export using pandas or openpyxl
        # For now, return empty bytes
        return b''