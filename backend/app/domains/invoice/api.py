"""
Invoice domain API endpoints
"""

import logging
import os
import re
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile


def sanitize_surrogates(text: str) -> str:
    """
    Remove or replace surrogate characters (U+D800 to U+DFFF) that are invalid in UTF-8.
    These characters can cause encoding errors when returning HTTP responses.
    """
    if not text:
        return text
    # Remove surrogate pairs (characters in range U+D800 to U+DFFF)
    return re.sub(r'[\ud800-\udfff]', '', text)

from app.common.services.pdf_service import get_pdf_service
from app.common.utils.security import validate_file_path, PathTraversalError
from app.common.utils.temp_file import temp_file_handler, get_temp_dir
from app.core.database_factory import get_db_session as get_db
from app.domains.invoice.schemas import (
    ClientInfo,
    CompanyInfo,
    InvoiceCreate,
    InvoiceItemResponse,
    InvoiceListResponse,
    InvoiceNumberResponse,
    InvoicePDFRequest,
    InvoiceResponse,
    InvoiceUpdate,
    PaymentRecord,
)
from app.domains.invoice.service import InvoiceService

logger = logging.getLogger(__name__)

def get_invoice_service():
    """Get invoice service instance"""
    try:
        logger.info("get_invoice_service: Creating database connection...")
        from app.core.database_factory import get_database
        database = get_database()
        logger.info(f"get_invoice_service: Database created: {type(database)}")
        
        service = InvoiceService(database)
        logger.info(f"get_invoice_service: Service created: {type(service)}")
        return service
    except Exception as e:
        import traceback
        logger.error(f"get_invoice_service ERROR: {e}")
        logger.error(f"get_invoice_service TRACEBACK: {traceback.format_exc()}")
        raise

router = APIRouter()


@router.get("/generate-number", response_model=InvoiceNumberResponse)
async def generate_invoice_number(
    company_id: Optional[str] = None,
    db=Depends(get_db)
):
    """Generate next invoice number with company-specific formatting"""
    import logging
    import traceback
    logger = logging.getLogger(__name__)

    # Log the incoming request
    logger.info(f"=== GENERATE INVOICE NUMBER REQUEST ===")
    logger.info(f"company_id: {company_id}")
    logger.info(f"db dependency: {db}")

    try:
        # Initialize database and service
        logger.info("Initializing database connection...")
        from app.core.database_factory import get_database
        database = get_database()
        logger.info(f"Database initialized: {database}")

        logger.info("Creating InvoiceService...")
        service = InvoiceService(database)
        logger.info(f"InvoiceService created: {service}")

        # Call the service method
        logger.info("Calling service.generate_invoice_number...")
        result = service.generate_invoice_number(company_id)
        logger.info(f"Service result: {result}")

        # Create response
        logger.info("Creating InvoiceNumberResponse...")
        response = InvoiceNumberResponse(**result)
        logger.info(f"Response created: {response}")

        logger.info("=== GENERATE INVOICE NUMBER SUCCESS ===")
        return response

    except Exception as e:
        logger.error(f"=== GENERATE INVOICE NUMBER ERROR ===")
        logger.error(f"Error type: {type(e).__name__}")
        logger.error(f"Error message: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        logger.error(f"=== END ERROR ===")
        raise HTTPException(status_code=500, detail=f"Failed to generate invoice number: {str(e)}")


@router.get("/")
async def list_invoices(
    skip: int = 0,
    limit: int = 100,
    client_name: Optional[str] = None,
    status: Optional[str] = None,
    service: InvoiceService = Depends(get_invoice_service)
):
    """List all invoices with optional filtering"""
    
    try:
        logger.info("Starting list_invoices endpoint with proper dependency injection")
        logger.info(f"Parameters - skip: {skip}, limit: {limit}, client_name: {client_name}, status: {status}")
        
        # Get invoices with filtering
        invoices = service.get_all(
            status=status,
            limit=limit,
            offset=skip,
            filters={'client_name': client_name} if client_name else None
        )
        
        
        
        # Convert to response format
        invoice_responses = []
        for invoice in invoices:
            # Calculate paid amount from payments JSON field
            payments = invoice.get('payments', [])
            if isinstance(payments, str):
                import json
                try:
                    payments = json.loads(payments)
                except (json.JSONDecodeError, TypeError, ValueError):
                    payments = []
            elif payments is None:
                payments = []

            paid_amount = sum(float(payment.get('amount', 0)) for payment in payments if isinstance(payment, dict))

            invoice_responses.append({
                'id': invoice.get('id', ''),
                'invoice_number': invoice.get('invoice_number', ''),
                'client_name': invoice.get('client_name', ''),
                'client_address': invoice.get('client_address', ''),
                'client_city': invoice.get('client_city', ''),
                'status': invoice.get('status', ''),
                'total': float(invoice.get('total_amount', 0)),
                'total_amount': float(invoice.get('total_amount', 0)),
                'paid_amount': paid_amount,
                'date': invoice.get('invoice_date', invoice.get('date', '')),
                'due_date': invoice.get('due_date', ''),
                'created_at': str(invoice.get('created_at', '')),
                'updated_at': str(invoice.get('updated_at', ''))
            })
        
        return {
            "invoices": invoice_responses,
            "total": len(invoice_responses),
            "skip": skip,
            "limit": limit
        }
        
    except Exception as e:
        import traceback
        error_details = {
            "error": str(e),
            "type": type(e).__name__,
            "traceback": traceback.format_exc(),
            "message": "Error fetching invoices"
        }
        logger.error(f"Invoice API error: {error_details}")
        raise HTTPException(status_code=500, detail=error_details)




@router.post("/", response_model=InvoiceResponse)
async def create_invoice(invoice_data: InvoiceCreate, db=Depends(get_db)):
    """Create a new invoice"""
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"Received invoice data: {invoice_data.dict()}")

    # Initialize repository with the injected db session for consistent transaction management
    from app.domains.invoice.repository import get_invoice_repository
    invoice_repo = get_invoice_repository(db)
    
    # Determine if using saved company or custom company
    company_code = None
    company_name = None
    
    if invoice_data.company_id:
        # Using saved company - get company details
        try:
            from app.domains.company.repository import get_company_repository
            company_repo = get_company_repository(db)
            company = company_repo.get_by_id(str(invoice_data.company_id))
            if company:
                company_code = company.get('company_code')
                company_name = company.get('name')
                # Set company info for storage
                invoice_data.company = CompanyInfo(
                    name=company.get('name'),
                    address=company.get('address'),
                    city=company.get('city'),
                    state=company.get('state'),
                    zip=company.get('zipcode'),
                    phone=company.get('phone'),
                    email=company.get('email'),
                    logo=company.get('logo')
                )
        except Exception as e:
            logger.error(f"Error fetching company: {e}")
    elif invoice_data.company:
        # Using custom company - generate temporary code
        company_name = invoice_data.company.name
        if company_name:
            # Generate a simple temp code for now
            company_code = f"TEMP-{company_name[:3].upper()}"
    
    # Handle client information - fetch from Client model if client_id is provided
    if invoice_data.client_id and (not invoice_data.client or not invoice_data.client.name):
        try:
            from app.domains.client.models import Client as ClientModel
            client_record = db.query(ClientModel).filter(ClientModel.id == str(invoice_data.client_id)).first()
            if client_record:
                # Get primary owner's contact info if available
                owners = client_record.owners or []
                primary_owner = next((o for o in owners if o.get('is_primary')), owners[0] if owners else None)
                invoice_data.client = ClientInfo(
                    name=client_record.display_name,
                    address=client_record.address,
                    city=client_record.city,
                    state=client_record.state,
                    zipcode=client_record.zipcode,
                    phone=client_record.phone or (primary_owner.get('phone') if primary_owner else None),
                    email=client_record.email or (primary_owner.get('email') if primary_owner else None),
                )
        except Exception as e:
            logger.error(f"Error fetching client: {e}")

    # Handle client information - fetch from company if client_company_id is provided
    if invoice_data.client_company_id and (not invoice_data.client or not invoice_data.client.name):
        try:
            from app.domains.company.repository import get_company_repository
            company_repo = get_company_repository(db)
            client_company = company_repo.get_by_id(str(invoice_data.client_company_id))
            if client_company:
                # Populate client info from the company
                invoice_data.client = ClientInfo(
                    name=client_company.get('name'),
                    address=client_company.get('address'),
                    city=client_company.get('city'),
                    state=client_company.get('state'),
                    zipcode=client_company.get('zipcode'),
                    phone=client_company.get('phone'),
                    email=client_company.get('email')
                )
        except Exception as e:
            logger.error(f"Error fetching client company: {e}")
    
    # Generate invoice number if not provided
    if not invoice_data.invoice_number:
        # Fallback to timestamp-based number
        invoice_data.invoice_number = f"INV-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    
    # Calculate totals using service method (supports adjustments)
    from app.core.database_factory import get_database
    database = get_database()
    service = InvoiceService(database)
    
    # Prepare items for calculation
    items_for_calc = [
        {
            'quantity': item.quantity,
            'rate': item.rate,
            'taxable': item.taxable if hasattr(item, 'taxable') else True
        }
        for item in invoice_data.items
    ]
    
    # Prepare adjustments if provided
    adjustments_data = None
    if hasattr(invoice_data, 'adjustments') and invoice_data.adjustments:
        adjustments_data = [adj.dict() for adj in invoice_data.adjustments]
    
    # Calculate totals with adjustments support
    tax_method = invoice_data.tax_method or 'percentage'
    tax_rate = invoice_data.tax_rate or 0
    tax_amount = invoice_data.tax_amount if tax_method == 'specific' else 0
    discount = invoice_data.discount if hasattr(invoice_data, 'discount') else 0
    op_percent = invoice_data.op_percent if hasattr(invoice_data, 'op_percent') else 0
    
    totals = service.calculate_totals(
        items=items_for_calc,
        tax_method=tax_method,
        tax_rate=tax_rate,
        tax_amount=tax_amount,
        discount_amount=discount,
        op_percent=op_percent,
        adjustments=adjustments_data
    )
    
    subtotal = totals['items_subtotal']
    tax_amount = totals['tax_amount']
    total = totals['total_amount']
    
    # Calculate paid amount from payment records
    payments = invoice_data.payments or []
    paid_amount = sum(payment.amount for payment in payments)
    balance_due = total - paid_amount
    
    # Convert date strings to datetime objects for SQLAlchemy
    invoice_date = invoice_data.date
    due_date = invoice_data.due_date
    
    # Parse date strings if provided
    if invoice_date:
        if isinstance(invoice_date, str):
            invoice_date = datetime.strptime(invoice_date, '%Y-%m-%d')
    else:
        invoice_date = datetime.now()
    
    if due_date:
        if isinstance(due_date, str):
            due_date = datetime.strptime(due_date, '%Y-%m-%d')
    else:
        due_date = datetime.now() + timedelta(days=30)
    
    # Prepare data for SQLAlchemy Invoice model
    invoice_dict = {
        'invoice_number': invoice_data.invoice_number,
        'invoice_date': invoice_date,
        'due_date': due_date,
        'status': invoice_data.status or 'pending',
        'company_id': str(invoice_data.company_id) if invoice_data.company_id else None,

        # Client information - directly on Invoice model
        'client_id': str(invoice_data.client_id) if invoice_data.client_id else None,
        'client_name': invoice_data.client.name if invoice_data.client else '',
        'client_company_id': str(invoice_data.client_company_id) if invoice_data.client_company_id else None,
        'client_address': invoice_data.client.address if invoice_data.client else '',
        'client_city': invoice_data.client.city if invoice_data.client else '',
        'client_state': invoice_data.client.state if invoice_data.client else '',
        'client_zipcode': invoice_data.client.zipcode if invoice_data.client else '',
        'client_phone': invoice_data.client.phone if invoice_data.client else '',
        'client_email': invoice_data.client.email if invoice_data.client else '',

        # Insurance information
        'show_insurance': invoice_data.show_insurance or False,
        'insurance_company': invoice_data.insurance.company if invoice_data.insurance else None,
        'insurance_policy_number': invoice_data.insurance.policy_number if invoice_data.insurance else None,
        'insurance_claim_number': invoice_data.insurance.claim_number if invoice_data.insurance else None,
        'insurance_deductible': invoice_data.insurance.deductible if invoice_data.insurance else None,

        # Financial information
        'subtotal': totals['subtotal'],
        'adjustments': totals.get('adjustments', []),
        'tax_method': tax_method,
        'tax_rate': tax_rate,
        'tax_amount': tax_amount,
        'discount_amount': totals.get('discount_amount', discount),
        'op_percent': op_percent,
        'total_amount': total,

        # Payment tracking
        'payments': [payment.dict() for payment in payments],
        'show_payment_dates': invoice_data.show_payment_dates if hasattr(invoice_data, 'show_payment_dates') else True,
        'balance_due': balance_due,

        # Additional fields
        'payment_terms': invoice_data.payment_terms if hasattr(invoice_data, 'payment_terms') else 'Net 30',
        'notes': invoice_data.notes if hasattr(invoice_data, 'notes') else None,
        'terms': invoice_data.terms if hasattr(invoice_data, 'terms') else None,
    }
    
    # Prepare items separately
    items_data = [
        {
            'name': item.name,
            'description': item.description or '',
            'quantity': item.quantity,
            'unit': item.unit or 'ea',
            'rate': item.rate,
            'amount': item.quantity * item.rate,
            'taxable': item.taxable if item.taxable is not None else True,
            'note': item.note,
            'images': [img.dict() for img in item.images] if item.images else [],
            # Section/Group fields — must be preserved so sections survive a round-trip
            'primary_group': item.primary_group,
            'secondary_group': item.secondary_group,
            'sort_order': item.sort_order or 0,
        }
        for item in invoice_data.items
    ]
    logger.info(f"Items with notes: {[(i.get('name'), bool(i.get('note'))) for i in items_data]}")
    
    # Add items to the invoice_dict for the repository
    invoice_dict['items'] = items_data

    # Create invoice using repository (uses consistent db session)
    created_invoice = invoice_repo.create_with_items(invoice_dict)
    
    # Get company information from created_invoice (already flattened by get_with_items)
    company_name = created_invoice.get('company_name', '')
    company_address = created_invoice.get('company_address')
    company_city = created_invoice.get('company_city')
    company_state = created_invoice.get('company_state')
    company_zipcode = created_invoice.get('company_zip')
    company_phone = created_invoice.get('company_phone')
    company_email = created_invoice.get('company_email')
    company_logo = created_invoice.get('company_logo')
    
    # Convert date back to string for response
    date_str = created_invoice.get('invoice_date', '')
    if isinstance(date_str, datetime):
        date_str = date_str.strftime('%Y-%m-%d')
    
    due_date_str = created_invoice.get('due_date', '')
    if isinstance(due_date_str, datetime):
        due_date_str = due_date_str.strftime('%Y-%m-%d')
    
    # Convert to response format
    return InvoiceResponse(
        id=created_invoice['id'],
        invoice_number=created_invoice.get('invoice_number', ''),
        date=date_str,
        due_date=due_date_str,
        status=created_invoice.get('status', 'pending'),
        company_id=created_invoice.get('company_id'),
        company_name=company_name,
        company_address=company_address,
        company_city=company_city,
        company_state=company_state,
        company_zipcode=company_zipcode,
        company_phone=company_phone,
        company_email=company_email,
        company_logo=company_logo,
        client_id=created_invoice.get('client_id'),
        client_name=created_invoice.get('client_name', ''),
        client_address=created_invoice.get('client_address'),
        client_city=created_invoice.get('client_city'),
        client_state=created_invoice.get('client_state'),
        client_zipcode=created_invoice.get('client_zipcode'),
        client_phone=created_invoice.get('client_phone'),
        client_email=created_invoice.get('client_email'),
        show_insurance=created_invoice.get('show_insurance', False),
        insurance_company=created_invoice.get('insurance_company'),
        insurance_policy_number=created_invoice.get('insurance_policy_number'),
        insurance_claim_number=created_invoice.get('insurance_claim_number'),
        insurance_deductible=created_invoice.get('insurance_deductible'),
        subtotal=created_invoice.get('subtotal', 0),
        adjustments=created_invoice.get('adjustments', []),  # Include adjustments in response
        tax_method=created_invoice.get('tax_method', 'percentage'),
        tax_rate=created_invoice.get('tax_rate', 0),
        tax_amount=created_invoice.get('tax_amount', 0),
        discount=created_invoice.get('discount_amount', 0),  # Map from discount_amount to discount
        total=created_invoice.get('total_amount', 0),  # Map from total_amount to total
        paid_amount=sum(float(payment.get('amount', 0)) for payment in created_invoice.get('payments', [])),
        payments=created_invoice.get('payments', []),
        show_payment_dates=created_invoice.get('show_payment_dates', True),
        balance_due=created_invoice.get('balance_due', 0),
        payment_terms=created_invoice.get('payment_terms'),
        notes=created_invoice.get('notes'),
        created_at=created_invoice.get('created_at'),
        updated_at=created_invoice.get('updated_at'),
        items=[
            InvoiceItemResponse(
                id=item.get('id'),
                invoice_id=item.get('invoice_id'),
                name=item.get('description', ''),  # Map from description to name
                description=item.get('description'),
                quantity=item.get('quantity', 0),
                unit=item.get('unit', ''),
                rate=item.get('rate', 0),
                amount=item.get('amount', 0),
                taxable=item.get('taxable', True),
                primary_group=item.get('primary_group'),
                secondary_group=item.get('secondary_group'),
                sort_order=item.get('sort_order'),
                order_index=item.get('order_index'),
                images=item.get('images', []),
                created_at=item.get('created_at'),
                updated_at=item.get('updated_at')
            )
            for item in created_invoice.get('items', [])
        ]
    )


@router.put("/{invoice_id}", response_model=InvoiceResponse)
async def update_invoice(
    invoice_id: str,
    invoice_data: InvoiceUpdate,
    db=Depends(get_db)
):
    """Update an existing invoice"""
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"Updating invoice {invoice_id}")

    # Initialize repository with the injected db session for consistent transaction
    from app.domains.invoice.repository import get_invoice_repository
    invoice_repo = get_invoice_repository(db)

    # For calculate_totals (pure calculation, no DB access needed)
    from app.core.database_factory import get_database
    database = get_database()
    service = InvoiceService(database)

    # Check if invoice exists
    existing = invoice_repo.get_with_items(invoice_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    # Prepare update data
    # Use exclude_unset=False to include all fields, then filter None values manually
    # This ensures company_id is included even if it's explicitly set
    update_dict = invoice_data.dict(exclude_unset=True)
    
    # Also check if company_id was provided in the request body
    if hasattr(invoice_data, 'company_id') and invoice_data.company_id is not None:
        update_dict['company_id'] = invoice_data.company_id
    
    logger.info(f"Update dict keys: {list(update_dict.keys())}")
    logger.info(f"Company ID in update: {update_dict.get('company_id')}")
    logger.info(f"Company ID type: {type(update_dict.get('company_id'))}")

    # Check if company_id is being changed
    existing_company_id = existing.get('company_id')
    new_company_id = update_dict.get('company_id') if 'company_id' in update_dict else None
    
    # Handle company_id update if provided
    company_changed = False
    if 'company_id' in update_dict:
        company_id_value = update_dict.get('company_id')
        logger.info(f"Raw company_id_value: {company_id_value} (type: {type(company_id_value)})")
        if company_id_value:
            # Keep as string - UUIDType will handle conversion
            # Don't convert UUID to string here, let the repository handle it
            if not isinstance(company_id_value, str):
                update_dict['company_id'] = str(company_id_value)
            logger.info(f"Setting company_id to: {update_dict['company_id']} (type: {type(update_dict['company_id'])})")
        else:
            # If company_id is explicitly set to None, allow it
            update_dict['company_id'] = None
            logger.info("Setting company_id to None (custom company)")
        
        # Check if company_id actually changed
        existing_company_id_str = str(existing_company_id) if existing_company_id else None
        new_company_id_str = str(update_dict['company_id']) if update_dict['company_id'] else None
        company_changed = existing_company_id_str != new_company_id_str
        logger.info(f"Company changed: {company_changed} (from {existing_company_id_str} to {new_company_id_str})")
    
    # If company changed, regenerate invoice number
    if company_changed:
        logger.info("Company changed, regenerating invoice number...")
        try:
            new_invoice_number_data = service.generate_invoice_number(new_company_id_str)
            new_invoice_number = new_invoice_number_data.get('invoice_number')
            if new_invoice_number:
                update_dict['invoice_number'] = new_invoice_number
                logger.info(f"Generated new invoice number: {new_invoice_number}")
            else:
                logger.warning("Failed to generate new invoice number, keeping existing")
        except Exception as e:
            logger.error(f"Error generating new invoice number: {e}")
            # Don't fail the update if invoice number generation fails

    # Handle client information - fetch from Client model if client_id is provided
    client_id_value = update_dict.get('client_id')
    if client_id_value and (not invoice_data.client or not invoice_data.client.name):
        try:
            from app.domains.client.models import Client as ClientModel
            client_record = db.query(ClientModel).filter(ClientModel.id == str(client_id_value)).first()
            if client_record:
                owners = client_record.owners or []
                primary_owner = next((o for o in owners if o.get('is_primary')), owners[0] if owners else None)
                if 'client' not in update_dict:
                    update_dict['client'] = {}
                update_dict['client'].update({
                    'name': client_record.display_name,
                    'address': client_record.address,
                    'city': client_record.city,
                    'state': client_record.state,
                    'zipcode': client_record.zipcode,
                    'phone': client_record.phone or (primary_owner.get('phone') if primary_owner else None),
                    'email': client_record.email or (primary_owner.get('email') if primary_owner else None),
                })
        except Exception as e:
            logger.error(f"Error fetching client: {e}")

    # Handle client information - fetch from company if client_company_id is provided
    client_company_id = update_dict.get('client_company_id') or getattr(invoice_data, 'client_company_id', None)
    if client_company_id and (not invoice_data.client or not invoice_data.client.name):
        try:
            from app.domains.company.repository import get_company_repository
            company_repo = get_company_repository(db)
            client_company = company_repo.get_by_id(str(client_company_id))
            if client_company:
                # Populate client info from the company
                if 'client' not in update_dict:
                    update_dict['client'] = {}
                update_dict['client'].update({
                    'name': client_company.get('name'),
                    'address': client_company.get('address'),
                    'city': client_company.get('city'),
                    'state': client_company.get('state'),
                    'zipcode': client_company.get('zipcode'),
                    'phone': client_company.get('phone'),
                    'email': client_company.get('email')
                })
        except Exception as e:
            logger.error(f"Error fetching client company: {e}")

    # Handle company information
    # If company_id is provided, use it (company info comes from Company table)
    # If company object is provided without company_id, set company_id to None (custom company)
    if 'company' in update_dict:
        company = update_dict.pop('company')
        # If company_id is not explicitly provided in update, keep existing company_id
        # Custom company info is not stored in Invoice table - only company_id is stored
        # If user wants to use a custom company, they should set company_id to None
        logger.info(f"Company object provided in update, but Invoice model only stores company_id")
        # Don't modify company_id unless explicitly provided
    
    if 'client' in update_dict:
        client = update_dict.pop('client')
        for key, value in client.items():
            update_dict[f'client_{key}'] = value
    
    if 'insurance' in update_dict:
        insurance = update_dict.pop('insurance')
        if insurance:
            for key, value in insurance.items():
                update_dict[f'insurance_{key}'] = value

    # Convert date strings to datetime objects for SQLAlchemy
    if 'date' in update_dict:
        invoice_date = update_dict['date']
        if invoice_date and isinstance(invoice_date, str):
            try:
                update_dict['invoice_date'] = datetime.strptime(invoice_date, '%Y-%m-%d')
            except ValueError:
                logger.warning(f"Invalid date format: {invoice_date}")
        update_dict.pop('date', None)
    
    if 'due_date' in update_dict:
        due_date = update_dict['due_date']
        if due_date and isinstance(due_date, str):
            try:
                update_dict['due_date'] = datetime.strptime(due_date, '%Y-%m-%d')
            except ValueError:
                logger.warning(f"Invalid due_date format: {due_date}")

    # Prepare adjustments if provided
    adjustments_data = None
    if 'adjustments' in update_dict and update_dict['adjustments']:
        adjustments_data = update_dict['adjustments']
    elif hasattr(invoice_data, 'adjustments') and invoice_data.adjustments:
        adjustments_data = [adj.dict() if hasattr(adj, 'dict') else adj for adj in invoice_data.adjustments]
    
    # Calculate totals if items are provided
    if 'items' in update_dict and update_dict['items']:
        items = update_dict['items']
        
        # Prepare items for calculation
        items_for_calc = [
            {
                'quantity': item.get('quantity', 0),
                'rate': item.get('rate', 0),
                'taxable': item.get('taxable', True)
            }
            for item in items
        ]
        
        # Handle tax calculation based on method
        tax_method = update_dict.get('tax_method', invoice_data.tax_method if hasattr(invoice_data, 'tax_method') else 'percentage')
        tax_rate = update_dict.get('tax_rate', invoice_data.tax_rate if hasattr(invoice_data, 'tax_rate') else 0)
        tax_amount = update_dict.get('tax_amount', 0) if tax_method == 'specific' else 0
        
        # Use discount and op_percent from update_dict or invoice_data (for backward compatibility)
        discount = update_dict.get('discount', invoice_data.discount if hasattr(invoice_data, 'discount') else 0)
        op_percent = update_dict.get('op_percent', invoice_data.op_percent if hasattr(invoice_data, 'op_percent') else 0)
        
        # Calculate totals using service method (supports adjustments)
        totals = service.calculate_totals(
            items=items_for_calc,
            tax_method=tax_method,
            tax_rate=tax_rate,
            tax_amount=tax_amount,
            discount_amount=discount,
            op_percent=op_percent,
            adjustments=adjustments_data
        )
        
        # Calculate paid amount from payment records
        payments = update_dict.get('payments', invoice_data.payments or [])
        if payments:
            paid_amount = sum(
                payment.get('amount', 0) if isinstance(payment, dict)
                else payment.amount
                for payment in payments
            )
        else:
            paid_amount = 0
        
        total = totals['total_amount']
        balance_due = total - paid_amount
        
        # Update totals in update_dict
        update_dict['subtotal'] = totals['subtotal']
        update_dict['adjustments'] = totals.get('adjustments', [])
        update_dict['tax_method'] = tax_method
        update_dict['tax_rate'] = tax_rate
        update_dict['tax_amount'] = totals['tax_amount']
        update_dict['discount_amount'] = totals.get('discount_amount', discount)
        update_dict['op_percent'] = op_percent
        update_dict['total_amount'] = total
        update_dict['balance_due'] = balance_due
        
        # Prepare items separately
        items_data = [
            {
                'name': item.get('name', ''),
                'description': item.get('description', ''),
                'quantity': item.get('quantity', 0),
                'unit': item.get('unit', 'ea'),
                'rate': item.get('rate', 0),
                'amount': item.get('quantity', 0) * item.get('rate', 0),
                'taxable': item.get('taxable', True),
                'primary_group': item.get('primary_group'),
                'secondary_group': item.get('secondary_group'),
                'sort_order': item.get('sort_order', 0),
                'note': item.get('note'),
                'line_item_id': item.get('line_item_id'),
                'images': item.get('images', []),
            }
            for item in items
        ]
        update_dict['items'] = items_data
    elif adjustments_data:
        # If only adjustments are provided without items, use existing invoice items to recalculate totals
        # Get existing invoice to use its items
        existing_items = existing.get('items', [])
        if existing_items:
            items_for_calc = [
                {
                    'quantity': item.get('quantity', 0),
                    'rate': item.get('rate', 0),
                    'taxable': item.get('taxable', True)
                }
                for item in existing_items
            ]
            
            # Use existing tax configuration
            tax_method = update_dict.get('tax_method', existing.get('tax_method', 'percentage'))
            tax_rate = update_dict.get('tax_rate', existing.get('tax_rate', 0))
            tax_amount = update_dict.get('tax_amount', existing.get('tax_amount', 0)) if tax_method == 'specific' else 0
            
            # Use discount and op_percent from update_dict or existing (for backward compatibility)
            discount = update_dict.get('discount', existing.get('discount_amount', 0))
            op_percent = update_dict.get('op_percent', existing.get('op_percent', 0))
            
            # Calculate totals using service method (supports adjustments)
            totals = service.calculate_totals(
                items=items_for_calc,
                tax_method=tax_method,
                tax_rate=tax_rate,
                tax_amount=tax_amount,
                discount_amount=discount,
                op_percent=op_percent,
                adjustments=adjustments_data
            )
            
            # Calculate paid amount from payment records
            payments = update_dict.get('payments', existing.get('payments', []))
            if payments:
                paid_amount = sum(
                    payment.get('amount', 0) if isinstance(payment, dict)
                    else payment.amount
                    for payment in payments
                )
            else:
                paid_amount = 0
            
            total = totals['total_amount']
            balance_due = total - paid_amount
            
            # Update totals in update_dict
            update_dict['subtotal'] = totals['subtotal']
            update_dict['adjustments'] = totals.get('adjustments', [])
            update_dict['tax_method'] = tax_method
            update_dict['tax_rate'] = tax_rate
            update_dict['tax_amount'] = totals['tax_amount']
            update_dict['discount_amount'] = totals.get('discount_amount', discount)
            update_dict['op_percent'] = op_percent
            update_dict['total_amount'] = total
            update_dict['balance_due'] = balance_due
        else:
            # No items available, just save adjustments
            update_dict['adjustments'] = adjustments_data
    
    # Update invoice with items (using repository with consistent db session)
    logger.info(f"Calling invoice_repo.update_with_items with invoice_id: {invoice_id}")
    updated_invoice = invoice_repo.update_with_items(invoice_id, update_dict)
    if not updated_invoice:
        raise HTTPException(status_code=500, detail="Failed to update invoice")

    # Sync invoice updates to linked Water Mitigation Job (if any)
    try:
        from app.domains.water_mitigation.scope_invoice_service import ScopeInvoiceService
        from decimal import Decimal
        scope_service = ScopeInvoiceService(db)
        invoice_amount = updated_invoice.get('total_amount') or updated_invoice.get('total')
        scope_service.sync_invoice_to_wm_job(
            invoice_id=invoice_id,
            invoice_number=updated_invoice.get('invoice_number'),
            invoice_amount=Decimal(str(invoice_amount)) if invoice_amount else None,
        )
    except Exception as e:
        # Log but don't fail the invoice update if WM sync fails
        logger.warning(f"Failed to sync invoice to WM Job: {e}")

    # Get company information from updated_invoice (already flattened by get_with_items)
    logger.info(f"Updated invoice company_id: {updated_invoice.get('company_id')}")
    logger.info(f"Updated invoice company_name: {updated_invoice.get('company_name')}")
    company_name = updated_invoice.get('company_name', '')
    company_address = updated_invoice.get('company_address')
    company_city = updated_invoice.get('company_city')
    company_state = updated_invoice.get('company_state')
    company_zipcode = updated_invoice.get('company_zip')
    company_phone = updated_invoice.get('company_phone')
    company_email = updated_invoice.get('company_email')
    company_logo = updated_invoice.get('company_logo')
    
    # Convert date back to string for response
    date_str = updated_invoice.get('invoice_date', updated_invoice.get('date', ''))
    if isinstance(date_str, datetime):
        date_str = date_str.strftime('%Y-%m-%d')
    
    due_date_str = updated_invoice.get('due_date', '')
    if isinstance(due_date_str, datetime):
        due_date_str = due_date_str.strftime('%Y-%m-%d')
    
    # Convert to response format
    return InvoiceResponse(
        id=updated_invoice['id'],
        invoice_number=updated_invoice.get('invoice_number', ''),
        date=date_str,
        due_date=due_date_str,
        status=updated_invoice.get('status', 'draft'),
        company_id=updated_invoice.get('company_id'),
        company_name=company_name,
        company_address=company_address,
        company_city=company_city,
        company_state=company_state,
        company_zipcode=company_zipcode,
        company_phone=company_phone,
        company_email=company_email,
        company_logo=company_logo,
        client_id=updated_invoice.get('client_id'),
        client_name=updated_invoice.get('client_name') or '',
        client_address=updated_invoice.get('client_address'),
        client_city=updated_invoice.get('client_city'),
        client_state=updated_invoice.get('client_state'),
        client_zipcode=updated_invoice.get('client_zip'),
        client_phone=updated_invoice.get('client_phone'),
        client_email=updated_invoice.get('client_email'),
        show_insurance=updated_invoice.get('show_insurance', False),
        insurance_company=updated_invoice.get('insurance_company'),
        insurance_policy_number=updated_invoice.get('insurance_policy_number'),
        insurance_claim_number=updated_invoice.get('insurance_claim_number'),
        insurance_deductible=updated_invoice.get('insurance_deductible'),
        subtotal=updated_invoice.get('subtotal', 0),
        adjustments=updated_invoice.get('adjustments', []),  # Include adjustments in response
        tax_method=updated_invoice.get('tax_method', 'percentage'),
        tax_rate=updated_invoice.get('tax_rate', 0),
        tax_amount=updated_invoice.get('tax_amount', 0),
        discount=updated_invoice.get('discount_amount', updated_invoice.get('discount', 0)),
        total=updated_invoice.get('total_amount', updated_invoice.get('total', 0)),
        paid_amount=sum(float(payment.get('amount', 0)) for payment in updated_invoice.get('payments', [])) if updated_invoice.get('payments') else 0,
        payments=updated_invoice.get('payments', []),
        show_payment_dates=updated_invoice.get('show_payment_dates', True),
        balance_due=updated_invoice.get('balance_due', 0),
        payment_terms=updated_invoice.get('payment_terms'),
        notes=updated_invoice.get('notes'),
        created_at=updated_invoice.get('created_at'),
        updated_at=updated_invoice.get('updated_at'),
        items=[
            InvoiceItemResponse(
                id=item.get('id'),
                invoice_id=item.get('invoice_id'),
                name=item.get('description', ''),  # Map description to name for compatibility
                description=item.get('description'),
                quantity=item.get('quantity', 0),
                unit=item.get('unit', ''),
                rate=item.get('rate', 0),
                amount=item.get('amount', 0),
                taxable=item.get('taxable', True),
                primary_group=item.get('primary_group'),
                secondary_group=item.get('secondary_group'),
                sort_order=item.get('sort_order'),
                order_index=item.get('order_index'),
                note=item.get('note'),
                images=item.get('images', []),
                created_at=item.get('created_at'),
                updated_at=item.get('updated_at')
            )
            for item in updated_invoice.get('items', [])
        ]
    )


@router.delete("/{invoice_id}")
async def delete_invoice(invoice_id: str, db=Depends(get_db)):
    """Delete an invoice"""
    from app.core.database_factory import get_database
    database = get_database()
    service = InvoiceService(database)
    
    # Check if invoice exists
    existing = service.get_by_id(invoice_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    # Delete invoice
    if not service.delete(invoice_id):
        raise HTTPException(status_code=500, detail="Failed to delete invoice")
    
    return {"message": "Invoice deleted successfully"}


@router.get("/{invoice_id}/html")
async def generate_invoice_html(invoice_id: str, db=Depends(get_db)):
    """Generate HTML for an invoice"""
    from app.core.database_factory import get_database
    database = get_database()
    service = InvoiceService(database)

    # Get invoice from database with items and company info
    # Use get_with_items to ensure we get the latest company info
    invoice = service.get_with_items(invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    logger.info(f"HTML generation - invoice company_id: {invoice.get('company_id')}")
    logger.info(f"HTML generation - invoice company_name: {invoice.get('company_name')}")

    # Company info is already included by get_with_items, but ensure it's present
    # If company_id exists but company info is missing, fetch it
    if invoice.get('company_id') and not invoice.get('company_name'):
        try:
            from app.domains.company.repository import get_company_repository
            company_repo = get_company_repository(db)
            company_info = company_repo.get_by_id(str(invoice['company_id']))
            if company_info:
                # Merge company info
                invoice['company_name'] = company_info.get('name')
                invoice['company_address'] = company_info.get('address')
                invoice['company_city'] = company_info.get('city')
                invoice['company_state'] = company_info.get('state')
                invoice['company_zip'] = company_info.get('zipcode')
                invoice['company_phone'] = company_info.get('phone')
                invoice['company_email'] = company_info.get('email')
                invoice['company_logo'] = company_info.get('logo')
        except Exception as e:
            logger.error(f"Error fetching company info: {e}")
            import traceback
            logger.error(traceback.format_exc())

    # Prepare data for HTML generation
    # Group items by section (primary_group) while preserving order via sort_order
    from collections import defaultdict, OrderedDict
    all_items_html = invoice.get('items', [])

    logger.info(f"Processing {len(all_items_html)} items for HTML generation")

    # Sort items by sort_order to preserve section ordering
    sorted_items_html = sorted(all_items_html, key=lambda x: x.get('sort_order', 0) or 0)

    # Use OrderedDict to maintain section order based on first item appearance
    items_by_section_html = OrderedDict()
    for item in sorted_items_html:
        section_name = item.get('primary_group') or 'Items'
        if section_name not in items_by_section_html:
            items_by_section_html[section_name] = []
        logger.info(f"Item: {item.get('name')} -> Section: {section_name}, sort_order: {item.get('sort_order')}")
        items_by_section_html[section_name].append({
            "name": item.get('name', ''),
            "description": item.get('description'),
            "note": item.get('note'),
            "quantity": item.get('quantity', 0),
            "unit": item.get('unit', ''),
            "rate": item.get('rate', 0),
            "amount": item.get('quantity', 0) * item.get('rate', 0)
        })

    # Create sections with subtotals (order is preserved from OrderedDict)
    sections_html = []
    for section_name, section_items in items_by_section_html.items():
        section_subtotal = sum(item['amount'] for item in section_items)
        sections_html.append({
            "title": section_name,
            "items": section_items,
            "subtotal": section_subtotal
        })
        logger.info(f"Section '{section_name}': {len(section_items)} items, subtotal: {section_subtotal}")

    logger.info(f"Created {len(sections_html)} sections for HTML (ordered by sort_order)")
    
    html_data = {
        "invoice_number": invoice.get('invoice_number', ''),
        "date": invoice.get('date', invoice.get('invoice_date', invoice.get('created_at', ''))),
        "due_date": invoice.get('due_date', ''),
        "company": {
            "name": invoice.get('company_name', ''),
            "address": invoice.get('company_address'),
            "city": invoice.get('company_city'),
            "state": invoice.get('company_state'),
            "zip": invoice.get('company_zip', invoice.get('company_zipcode')),
            "phone": invoice.get('company_phone'),
            "email": invoice.get('company_email'),
            "logo": invoice.get('company_logo')
        },
        "client": {
            "name": invoice.get('client_name', ''),
            "address": invoice.get('client_address'),
            "city": invoice.get('client_city'),
            "state": invoice.get('client_state'),
            "zip": invoice.get('client_zip', invoice.get('client_zipcode')),
            "phone": invoice.get('client_phone'),
            "email": invoice.get('client_email')
        },
        "items": all_items_html,  # Keep original items for backward compatibility
        "sections": sections_html,  # New: grouped by section with subtotals
        "subtotal": invoice.get('subtotal', 0),
        "adjustments": invoice.get('adjustments', []),  # New: adjustments list
        "op_percent": invoice.get('op_percent', 0),  # For backward compatibility
        "tax_rate": invoice.get('tax_rate', 0),
        "tax_amount": invoice.get('tax_amount', 0),
        "discount": invoice.get('discount_amount', invoice.get('discount', 0)),  # For backward compatibility
        "shipping": invoice.get('shipping', 0),
        "total": invoice.get('total_amount', invoice.get('total', 0)),
        "payments": invoice.get('payments', []),
        "paid_amount": invoice.get('paid_amount', 0),
        "payment_terms": invoice.get('payment_terms'),
        "notes": invoice.get('notes')
    }

    # Add insurance info if present
    if invoice.get('insurance_company'):
        html_data["insurance"] = {
            "company": invoice.get('insurance_company'),
            "policy_number": invoice.get('insurance_policy_number'),
            "claim_number": invoice.get('insurance_claim_number'),
            "deductible": invoice.get('insurance_deductible')
        }

    # Generate HTML
    if not get_pdf_service():
        raise HTTPException(status_code=500, detail="PDF service not available")

    try:
        # Generate HTML
        html_content = get_pdf_service().generate_invoice_html(html_data)

        # Return HTML as response
        return Response(
            content=html_content,
            media_type="text/html",
            headers={
                "Content-Disposition": f"inline; filename=invoice_{invoice.get('invoice_number', 'unknown')}.html"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{invoice_id}/pdf")
async def generate_invoice_pdf(
    invoice_id: str,
    template_variant: str = Query("a", description="Template variant: a (default), b (formal), c (modern)"),
    db=Depends(get_db),
):
    """Generate PDF for an invoice"""
    from app.core.database_factory import get_database
    database = get_database()
    service = InvoiceService(database)

    # Get invoice from database with items and company info
    # Use get_with_items to ensure we get the latest company info
    invoice = service.get_with_items(invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    logger.info(f"PDF generation - invoice company_id: {invoice.get('company_id')}")
    logger.info(f"PDF generation - invoice company_name: {invoice.get('company_name')}")
    logger.info(f"PDF generation - invoice company_address: {invoice.get('company_address')}")
    logger.info(f"PDF generation - invoice company_city: {invoice.get('company_city')}")
    logger.info(f"PDF generation - invoice company_state: {invoice.get('company_state')}")

    # Company info is already included by get_with_items, but ensure it's present
    # If company_id exists but company info is missing, fetch it
    if invoice.get('company_id') and not invoice.get('company_name'):
        try:
            from app.domains.company.repository import get_company_repository
            company_repo = get_company_repository(db)
            company_info = company_repo.get_by_id(str(invoice['company_id']))
            if company_info:
                # Merge company info
                invoice['company_name'] = company_info.get('name')
                invoice['company_address'] = company_info.get('address')
                invoice['company_city'] = company_info.get('city')
                invoice['company_state'] = company_info.get('state')
                invoice['company_zip'] = company_info.get('zipcode')
                invoice['company_phone'] = company_info.get('phone')
                invoice['company_email'] = company_info.get('email')
                invoice['company_logo'] = company_info.get('logo')
        except Exception as e:
            logger.error(f"Error fetching company info: {e}")
            import traceback
            logger.error(traceback.format_exc())

    # Prepare data for PDF generation
    # Group items by section (primary_group) while preserving order via sort_order
    from collections import defaultdict, OrderedDict
    all_items = invoice.get('items', [])

    logger.info(f"Processing {len(all_items)} items for PDF generation")

    # Sort items by sort_order to preserve section ordering
    sorted_items = sorted(all_items, key=lambda x: x.get('sort_order', 0) or 0)

    # Use OrderedDict to maintain section order based on first item appearance
    items_by_section = OrderedDict()
    for item in sorted_items:
        section_name = item.get('primary_group') or 'Items'
        if section_name not in items_by_section:
            items_by_section[section_name] = []
        logger.info(f"Item: {item.get('name')} -> Section: {section_name}, sort_order: {item.get('sort_order')}")
        items_by_section[section_name].append({
            "name": item.get('name', ''),
            "description": item.get('description'),
            "note": item.get('note'),
            "quantity": item.get('quantity', 0),
            "unit": item.get('unit', ''),
            "rate": item.get('rate', 0),
            "amount": item.get('quantity', 0) * item.get('rate', 0)
        })

    # Create sections with subtotals (order is preserved from OrderedDict)
    sections = []
    for section_name, section_items in items_by_section.items():
        section_subtotal = sum(item['amount'] for item in section_items)
        sections.append({
            "title": section_name,
            "items": section_items,
            "subtotal": section_subtotal
        })
        logger.info(f"Section '{section_name}': {len(section_items)} items, subtotal: {section_subtotal}")

    logger.info(f"Created {len(sections)} sections for PDF (ordered by sort_order)")
    
    # Log company info before creating pdf_data
    company_name = invoice.get('company_name', '')
    company_address = invoice.get('company_address')
    logger.info(f"PDF data - company_name: {company_name}")
    logger.info(f"PDF data - company_address: {company_address}")
    
    pdf_data = {
        "invoice_number": invoice.get('invoice_number', ''),
        "date": invoice.get('date', invoice.get('invoice_date', invoice.get('created_at', ''))),
        "due_date": invoice.get('due_date', ''),
        "company": {
            "name": company_name,
            "address": company_address,
            "city": invoice.get('company_city'),
            "state": invoice.get('company_state'),
            "zip": invoice.get('company_zip', invoice.get('company_zipcode')),
            "phone": invoice.get('company_phone'),
            "email": invoice.get('company_email'),
            "logo": invoice.get('company_logo')
        },
        "client": {
            "name": invoice.get('client_name', ''),
            "address": invoice.get('client_address'),
            "city": invoice.get('client_city'),
            "state": invoice.get('client_state'),
            "zip": invoice.get('client_zip', invoice.get('client_zipcode')),
            "phone": invoice.get('client_phone'),
            "email": invoice.get('client_email')
        },
        "items": all_items,  # Keep original items for backward compatibility
        "sections": sections,  # New: grouped by section with subtotals
        "subtotal": invoice.get('subtotal', 0),
        "adjustments": invoice.get('adjustments', []),  # New: adjustments list
        "op_percent": invoice.get('op_percent', 0),  # For backward compatibility
        "tax_rate": invoice.get('tax_rate', 0),
        "tax_amount": invoice.get('tax_amount', 0),
        "discount": invoice.get('discount_amount', invoice.get('discount', 0)),  # For backward compatibility
        "total": invoice.get('total_amount', invoice.get('total', 0)),
        "paid_amount": invoice.get('paid_amount', 0),
        "payments": invoice.get('payments', []),
        "payment_terms": invoice.get('payment_terms'),
        "notes": invoice.get('notes')
    }

    # Add insurance info if present
    if invoice.get('insurance_company'):
        pdf_data["insurance"] = {
            "company": invoice.get('insurance_company'),
            "policy_number": invoice.get('insurance_policy_number'),
            "claim_number": invoice.get('insurance_claim_number'),
            "deductible": invoice.get('insurance_deductible')
        }

    # Generate PDF
    if not get_pdf_service():
        raise HTTPException(status_code=500, detail="PDF service not available")

    # Use temp_file_handler for automatic cleanup
    with temp_file_handler(suffix=".pdf", prefix="invoice_") as temp_path:
        try:
            # Generate PDF
            pdf_path = get_pdf_service().generate_invoice_pdf(pdf_data, str(temp_path), template_variant=template_variant)

            # Validate the PDF path to prevent path traversal attacks
            try:
                validated_path = validate_file_path(pdf_path, get_temp_dir())
            except PathTraversalError:
                logger.error(
                    f"Security: Path traversal attempt in invoice PDF: {pdf_path}"
                )
                raise HTTPException(status_code=400, detail="Invalid file path")

            # Read PDF file using validated path
            with open(validated_path, "rb") as pdf_file:
                pdf_content = pdf_file.read()

            # Return PDF as response (temp file auto-cleaned after context exits)
            return Response(
                content=pdf_content,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f"attachment; filename=invoice_{invoice.get('invoice_number', 'unknown')}.pdf"
                }
            )
        except HTTPException:
            raise  # Re-raise HTTP exceptions
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@router.post("/preview-html")
async def preview_invoice_html(data: InvoicePDFRequest):
    """Generate a preview HTML from invoice data without saving"""
    import logging
    logger = logging.getLogger(__name__)

    if not get_pdf_service():
        raise HTTPException(status_code=500, detail="PDF service not available")

    try:
        # Prepare data for HTML generation
        html_data = data.dict()
        logger.info(f"Generating HTML preview with data keys: {html_data.keys()}")
        
        # Log sections info
        sections_data = html_data.get('sections', [])
        logger.info(f"Sections field exists: {'sections' in html_data}, Sections length: {len(sections_data)}")
        
        if sections_data and len(sections_data) > 0:
            logger.info(f"Sections in HTML preview data: {len(sections_data)} sections")
            for sec in sections_data:
                logger.info(f"  - Section '{sec.get('title')}': {len(sec.get('items', []))} items, subtotal: {sec.get('subtotal')}")
        else:
            logger.warning(f"No valid sections in HTML preview data - sections value: {sections_data}")

        # Generate HTML
        html_content = get_pdf_service().generate_invoice_html(html_data)

        # Sanitize any surrogate characters that could cause encoding errors
        html_content = sanitize_surrogates(html_content)

        # Return HTML as response
        return Response(
            content=html_content,
            media_type="text/html",
            headers={
                "Content-Disposition": "inline; filename=preview_invoice.html"
            }
        )
    except Exception as e:
        logger.error(f"HTML generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/preview-pdf")
async def preview_invoice_pdf(data: InvoicePDFRequest):
    """Generate a preview PDF from invoice data without saving"""
    import logging
    import traceback
    logger = logging.getLogger(__name__)
    
    # Debug pdf_service import
    
    if not get_pdf_service():
        raise HTTPException(status_code=500, detail="PDF service not available")
    
    # Use temp_file_handler for automatic cleanup (cross-platform compatible)
    with temp_file_handler(suffix=".pdf", prefix="invoice_preview_") as temp_path:
        try:
            # Prepare data for PDF generation
            pdf_data = data.dict()
            logger.info(f"Generating PDF preview with data keys: {pdf_data.keys()}")

            # Log sections info
            sections_data = pdf_data.get('sections', [])
            logger.info(f"Sections field exists: {'sections' in pdf_data}, Sections length: {len(sections_data)}")

            if sections_data and len(sections_data) > 0:
                logger.info(f"Sections in preview data: {len(sections_data)} sections")
                for sec in sections_data:
                    logger.info(f"  - Section '{sec.get('title')}': {len(sec.get('items', []))} items, subtotal: {sec.get('subtotal')}")
            else:
                logger.warning(f"No valid sections in preview data - sections value: {sections_data}")

            # Generate PDF
            pdf_path = get_pdf_service().generate_invoice_pdf(pdf_data, str(temp_path))

            # Validate the PDF path to prevent path traversal attacks
            try:
                validated_path = validate_file_path(pdf_path, get_temp_dir())
            except PathTraversalError:
                logger.error(f"Security: Path traversal attempt in PDF preview: {pdf_path}")
                raise HTTPException(status_code=400, detail="Invalid file path")

            # Read PDF file using validated path
            with open(validated_path, "rb") as pdf_file:
                pdf_content = pdf_file.read()

            # Return PDF as response (temp file auto-cleaned by context manager)
            return Response(
                content=pdf_content,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": "inline; filename=preview_invoice.pdf"
                }
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"PDF generation error: {str(e)}")
            logger.error(f"Traceback: {traceback.format_exc()}")
            raise HTTPException(status_code=500, detail=str(e))


@router.post("/{invoice_id}/duplicate", response_model=InvoiceResponse)
async def duplicate_invoice(invoice_id: str, db=Depends(get_db)):
    """Duplicate an existing invoice"""
    from app.core.database_factory import get_database
    database = get_database()
    service = InvoiceService(database)
    
    # Duplicate invoice
    duplicated = service.duplicate(invoice_id)
    if not duplicated:
        raise HTTPException(status_code=404, detail="Invoice not found or failed to duplicate")
    
    # Convert to response format
    return InvoiceResponse(
        id=duplicated['id'],
        invoice_number=duplicated.get('invoice_number', ''),
        date=duplicated.get('date', duplicated.get('created_at', '')),
        due_date=duplicated.get('due_date', ''),
        status=duplicated.get('status', 'draft'),
        company_name=duplicated.get('company_name', ''),
        company_address=duplicated.get('company_address'),
        company_city=duplicated.get('company_city'),
        company_state=duplicated.get('company_state'),
        company_zipcode=duplicated.get('company_zip'),
        company_phone=duplicated.get('company_phone'),
        company_email=duplicated.get('company_email'),
        company_logo=duplicated.get('company_logo'),
        client_id=duplicated.get('client_id'),
        client_name=duplicated.get('client_name', ''),
        client_address=duplicated.get('client_address'),
        client_city=duplicated.get('client_city'),
        client_state=duplicated.get('client_state'),
        client_zipcode=duplicated.get('client_zip'),
        client_phone=duplicated.get('client_phone'),
        client_email=duplicated.get('client_email'),
        show_insurance=duplicated.get('show_insurance', False),
        insurance_company=duplicated.get('insurance_company'),
        insurance_policy_number=duplicated.get('insurance_policy_number'),
        insurance_claim_number=duplicated.get('insurance_claim_number'),
        insurance_deductible=duplicated.get('insurance_deductible'),
        subtotal=duplicated.get('subtotal', 0),
        tax_rate=duplicated.get('tax_rate', 0),
        tax_amount=duplicated.get('tax_amount', 0),
        discount=duplicated.get('discount', 0),
                total=duplicated.get('total', 0),
        paid_amount=duplicated.get('paid_amount', 0),
        payment_terms=duplicated.get('payment_terms'),
        notes=duplicated.get('notes'),
        created_at=duplicated.get('created_at', ''),
        updated_at=duplicated.get('updated_at', ''),
        items=[
            InvoiceItemResponse(
                id=item.get('id'),
                invoice_id=item.get('invoice_id'),
                name=item.get('description', ''),  # Map description to name for compatibility
                description=item.get('description'),
                quantity=item.get('quantity', 0),
                unit=item.get('unit', ''),
                rate=item.get('rate', 0),
                amount=item.get('amount', 0),
                taxable=item.get('taxable', True),
                primary_group=item.get('primary_group'),
                secondary_group=item.get('secondary_group'),
                sort_order=item.get('sort_order'),
                order_index=item.get('order_index'),
                images=item.get('images', []),
                created_at=item.get('created_at'),
                updated_at=item.get('updated_at')
            )
            for item in duplicated.get('items', [])
        ]
    )




# Payment management endpoints
@router.post("/{invoice_id}/payments", response_model=InvoiceResponse)
async def add_payment(
    invoice_id: str,
    payment: PaymentRecord,
    db=Depends(get_db)
):
    """Add a payment record to an invoice"""
    from app.core.database_factory import get_database
    database = get_database()
    service = InvoiceService(database)

    # Add payment to invoice
    updated_invoice = service.add_payment(invoice_id, payment.dict())
    if not updated_invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    # Convert to response format
    return InvoiceResponse(
        id=updated_invoice['id'],
        invoice_number=updated_invoice.get('invoice_number', ''),
        date=updated_invoice.get('invoice_date', updated_invoice.get('date', '')),
        due_date=updated_invoice.get('due_date', ''),
        status=updated_invoice.get('status', 'draft'),
        company_id=updated_invoice.get('company_id'),
        company_name=updated_invoice.get('company_name', ''),
        company_address=updated_invoice.get('company_address'),
        company_city=updated_invoice.get('company_city'),
        company_state=updated_invoice.get('company_state'),
        company_zipcode=updated_invoice.get('company_zipcode'),
        company_phone=updated_invoice.get('company_phone'),
        company_email=updated_invoice.get('company_email'),
        company_logo=updated_invoice.get('company_logo'),
        client_id=updated_invoice.get('client_id'),
        client_name=updated_invoice.get('client_name', ''),
        client_address=updated_invoice.get('client_address'),
        client_city=updated_invoice.get('client_city'),
        client_state=updated_invoice.get('client_state'),
        client_zipcode=updated_invoice.get('client_zipcode'),
        client_phone=updated_invoice.get('client_phone'),
        client_email=updated_invoice.get('client_email'),
        show_insurance=updated_invoice.get('show_insurance', False),
        insurance_company=updated_invoice.get('insurance_company'),
        insurance_policy_number=updated_invoice.get('insurance_policy_number'),
        insurance_claim_number=updated_invoice.get('insurance_claim_number'),
        insurance_deductible=updated_invoice.get('insurance_deductible'),
        subtotal=updated_invoice.get('subtotal', 0),
        tax_method=updated_invoice.get('tax_method', 'percentage'),
        tax_rate=updated_invoice.get('tax_rate', 0),
        tax_amount=updated_invoice.get('tax_amount', 0),
        discount=updated_invoice.get('discount_amount', 0),
                total=updated_invoice.get('total_amount', 0),
        paid_amount=sum(float(payment.get('amount', 0)) for payment in updated_invoice.get('payments', [])),
        payments=updated_invoice.get('payments', []),
        show_payment_dates=updated_invoice.get('show_payment_dates', True),
        balance_due=updated_invoice.get('balance_due', 0),
        payment_terms=updated_invoice.get('payment_terms'),
        notes=updated_invoice.get('notes'),
        created_at=updated_invoice.get('created_at', ''),
        updated_at=updated_invoice.get('updated_at', ''),
        items=[
            InvoiceItemResponse(
                id=item.get('id'),
                invoice_id=item.get('invoice_id'),
                name=item.get('name', item.get('description', '')),
                description=item.get('description'),
                quantity=item.get('quantity', 0),
                unit=item.get('unit', ''),
                rate=item.get('rate', 0),
                amount=item.get('amount', 0),
                taxable=item.get('taxable', True),
                primary_group=item.get('primary_group'),
                secondary_group=item.get('secondary_group'),
                sort_order=item.get('sort_order'),
                order_index=item.get('order_index'),
                images=item.get('images', []),
                created_at=item.get('created_at'),
                updated_at=item.get('updated_at')
            )
            for item in updated_invoice.get('items', [])
        ]
    )


@router.delete("/{invoice_id}/payments/{payment_index}", response_model=InvoiceResponse)
async def remove_payment(
    invoice_id: str,
    payment_index: int,
    db=Depends(get_db)
):
    """Remove a payment record from an invoice"""
    from app.core.database_factory import get_database
    database = get_database()
    service = InvoiceService(database)

    # Remove payment from invoice
    updated_invoice = service.remove_payment(invoice_id, payment_index)
    if not updated_invoice:
        raise HTTPException(status_code=404, detail="Invoice not found or invalid payment index")

    # Convert to response format (similar to add_payment response)
    return InvoiceResponse(
        id=updated_invoice['id'],
        invoice_number=updated_invoice.get('invoice_number', ''),
        date=updated_invoice.get('invoice_date', updated_invoice.get('date', '')),
        due_date=updated_invoice.get('due_date', ''),
        status=updated_invoice.get('status', 'draft'),
        company_id=updated_invoice.get('company_id'),
        company_name=updated_invoice.get('company_name', ''),
        company_address=updated_invoice.get('company_address'),
        company_city=updated_invoice.get('company_city'),
        company_state=updated_invoice.get('company_state'),
        company_zipcode=updated_invoice.get('company_zipcode'),
        company_phone=updated_invoice.get('company_phone'),
        company_email=updated_invoice.get('company_email'),
        company_logo=updated_invoice.get('company_logo'),
        client_id=updated_invoice.get('client_id'),
        client_name=updated_invoice.get('client_name', ''),
        client_address=updated_invoice.get('client_address'),
        client_city=updated_invoice.get('client_city'),
        client_state=updated_invoice.get('client_state'),
        client_zipcode=updated_invoice.get('client_zipcode'),
        client_phone=updated_invoice.get('client_phone'),
        client_email=updated_invoice.get('client_email'),
        show_insurance=updated_invoice.get('show_insurance', False),
        insurance_company=updated_invoice.get('insurance_company'),
        insurance_policy_number=updated_invoice.get('insurance_policy_number'),
        insurance_claim_number=updated_invoice.get('insurance_claim_number'),
        insurance_deductible=updated_invoice.get('insurance_deductible'),
        subtotal=updated_invoice.get('subtotal', 0),
        tax_method=updated_invoice.get('tax_method', 'percentage'),
        tax_rate=updated_invoice.get('tax_rate', 0),
        tax_amount=updated_invoice.get('tax_amount', 0),
        discount=updated_invoice.get('discount_amount', 0),
                total=updated_invoice.get('total_amount', 0),
        paid_amount=sum(float(payment.get('amount', 0)) for payment in updated_invoice.get('payments', [])),
        payments=updated_invoice.get('payments', []),
        show_payment_dates=updated_invoice.get('show_payment_dates', True),
        balance_due=updated_invoice.get('balance_due', 0),
        payment_terms=updated_invoice.get('payment_terms'),
        notes=updated_invoice.get('notes'),
        created_at=updated_invoice.get('created_at', ''),
        updated_at=updated_invoice.get('updated_at', ''),
        items=[
            InvoiceItemResponse(
                id=item.get('id'),
                invoice_id=item.get('invoice_id'),
                name=item.get('name', item.get('description', '')),
                description=item.get('description'),
                quantity=item.get('quantity', 0),
                unit=item.get('unit', ''),
                rate=item.get('rate', 0),
                amount=item.get('amount', 0),
                taxable=item.get('taxable', True),
                primary_group=item.get('primary_group'),
                secondary_group=item.get('secondary_group'),
                sort_order=item.get('sort_order'),
                order_index=item.get('order_index'),
                images=item.get('images', []),
                created_at=item.get('created_at'),
                updated_at=item.get('updated_at')
            )
            for item in updated_invoice.get('items', [])
        ]
    )


# Generic route will be moved to very end of file to prevent catching specific routes


# IMPORTANT: Generic parameterized routes must be at the very end to prevent route conflicts
@router.get("/{invoice_id}", response_model=InvoiceResponse)
async def get_invoice(invoice_id: str, service: InvoiceService = Depends(get_invoice_service)):
    """Get a specific invoice by ID"""
    try:
        invoice = service.get_by_id(invoice_id)
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found")
        
        # Convert to response format
        return InvoiceResponse(
            id=invoice['id'],
            invoice_number=invoice.get('invoice_number', ''),
            date=invoice.get('invoice_date', invoice.get('date', invoice.get('created_at', ''))),
            invoice_date=invoice.get('invoice_date', invoice.get('date', invoice.get('created_at', ''))),
            due_date=invoice.get('due_date', ''),
            status=invoice.get('status', 'draft'),
            company_id=invoice.get('company_id'),
            company_name=invoice.get('company_name', ''),
            company_address=invoice.get('company_address'),
            company_city=invoice.get('company_city'),
            company_state=invoice.get('company_state'),
            company_zipcode=invoice.get('company_zipcode', invoice.get('company_zip')),
            company_phone=invoice.get('company_phone'),
            company_email=invoice.get('company_email'),
            company_logo=invoice.get('company_logo'),
            client_id=invoice.get('client_id'),
            client_name=invoice.get('client_name', ''),
            client_address=invoice.get('client_address'),
            client_city=invoice.get('client_city'),
            client_state=invoice.get('client_state'),
            client_zipcode=invoice.get('client_zipcode', invoice.get('client_zip')),
            client_phone=invoice.get('client_phone'),
            client_email=invoice.get('client_email'),
            show_insurance=invoice.get('show_insurance', False),
            insurance_company=invoice.get('insurance_company'),
            insurance_policy_number=invoice.get('insurance_policy_number'),
            insurance_claim_number=invoice.get('insurance_claim_number'),
            insurance_deductible=invoice.get('insurance_deductible'),
            subtotal=invoice.get('subtotal', 0),
            adjustments=invoice.get('adjustments', []),  # Include adjustments in response
            op_percent=invoice.get('op_percent', 0),
            tax_method=invoice.get('tax_method', 'percentage'),
            tax_rate=invoice.get('tax_rate', 0),
            tax_amount=invoice.get('tax_amount', 0),
            discount=invoice.get('discount_amount', invoice.get('discount', 0)),
            discount_amount=invoice.get('discount_amount', invoice.get('discount', 0)),
            total=invoice.get('total_amount', invoice.get('total', 0)),
            total_amount=invoice.get('total_amount', invoice.get('total', 0)),
            paid_amount=sum(float(payment.get('amount', 0)) for payment in invoice.get('payments', [])),
            payments=invoice.get('payments', []),
            show_payment_dates=invoice.get('show_payment_dates', True),
            balance_due=invoice.get('balance_due', 0),
            payment_terms=invoice.get('payment_terms'),
            notes=invoice.get('notes'),
            created_at=invoice.get('created_at', ''),
            updated_at=invoice.get('updated_at', ''),
            items=[
                InvoiceItemResponse(
                    id=item.get('id'),
                    invoice_id=item.get('invoice_id'),
                    name=item.get('name', ''),
                    description=item.get('description'),
                    note=item.get('note'),
                    quantity=item.get('quantity', 0),
                    unit=item.get('unit', ''),
                    rate=item.get('rate', 0),
                    amount=item.get('amount', 0),
                    taxable=item.get('taxable', True),
                    primary_group=item.get('primary_group'),
                    secondary_group=item.get('secondary_group'),
                    sort_order=item.get('sort_order'),
                    order_index=item.get('order_index'),
                    images=item.get('images', []),
                    created_at=item.get('created_at'),
                    updated_at=item.get('updated_at')
                )
                for item in invoice.get('items', [])
            ]
        )
    except Exception as e:
        logger.error(f"Error getting invoice {invoice_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get invoice: {str(e)}")


# TEMPORARY EXPLANATION: The generic {invoice_id} route has been temporarily
# disabled to test if it's causing route conflicts with the list invoices endpoint.


# Receipt Generation Endpoints

@router.get("/{invoice_id}/receipt-html")
async def generate_receipt_html(invoice_id: str, db=Depends(get_db)):
    """Generate HTML receipt for a paid invoice"""
    from app.core.database_factory import get_database
    database = get_database()
    service = InvoiceService(database)

    # Get invoice from database
    invoice = service.get_by_id(invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    # Prepare data for HTML generation
    html_data = {
        "invoice_number": invoice.get('invoice_number', ''),
        "date": invoice.get('date', invoice.get('created_at', '')),
        "due_date": invoice.get('due_date', ''),
        "company": {
            "name": invoice.get('company_name', ''),
            "address": invoice.get('company_address'),
            "city": invoice.get('company_city'),
            "state": invoice.get('company_state'),
            "zip": invoice.get('company_zip'),
            "phone": invoice.get('company_phone'),
            "email": invoice.get('company_email'),
            "logo": invoice.get('company_logo')
        },
        "client": {
            "name": invoice.get('client_name', ''),
            "address": invoice.get('client_address'),
            "city": invoice.get('client_city'),
            "state": invoice.get('client_state'),
            "zip": invoice.get('client_zip'),
            "phone": invoice.get('client_phone'),
            "email": invoice.get('client_email')
        },
        "items": [
            {
                "name": item.get('name', ''),
                "description": item.get('description'),
                "note": item.get('note'),
                "quantity": item.get('quantity', 0),
                "unit": item.get('unit', ''),
                "rate": item.get('rate', 0),
                "images": item.get('images', [])
            }
            for item in invoice.get('items', [])
        ],
        "subtotal": invoice.get('subtotal', 0),
        "tax_rate": invoice.get('tax_rate', 0),
        "tax_amount": invoice.get('tax_amount', 0),
        "discount": invoice.get('discount', 0),
        "total": invoice.get('total', 0),
        "payments": invoice.get('payments', []),
        "paid_amount": invoice.get('paid_amount', 0),
        "payment_terms": invoice.get('payment_terms'),
        "notes": invoice.get('notes')
    }

    # Add insurance info if present
    if invoice.get('insurance_company'):
        html_data["insurance"] = {
            "company": invoice.get('insurance_company'),
            "policy_number": invoice.get('insurance_policy_number'),
            "claim_number": invoice.get('insurance_claim_number'),
            "deductible": invoice.get('insurance_deductible')
        }

    # Generate HTML receipt
    if not get_pdf_service():
        raise HTTPException(status_code=500, detail="PDF service not available")

    try:
        # Generate HTML receipt
        html_content = get_pdf_service().generate_receipt_html(html_data)

        # Update invoice with receipt generation timestamp
        service.update(invoice_id, {
            'has_receipt': True,
            'receipt_generated_at': datetime.now()
        })

        # Return HTML as response
        return Response(
            content=html_content,
            media_type="text/html",
            headers={
                "Content-Disposition": f"inline; filename=receipt_{invoice['invoice_number']}.html"
            }
        )
    except Exception as e:
        logger.error(f"Receipt HTML generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{invoice_id}/receipt-pdf")
async def generate_receipt_pdf(invoice_id: str, db=Depends(get_db)):
    """Generate PDF receipt for a paid invoice"""
    from app.core.database_factory import get_database
    database = get_database()
    service = InvoiceService(database)

    # Get invoice from database
    invoice = service.get_by_id(invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    # Prepare data for PDF generation
    pdf_data = {
        "invoice_number": invoice.get('invoice_number', ''),
        "date": invoice.get('date', invoice.get('created_at', '')),
        "due_date": invoice.get('due_date', ''),
        "company": {
            "name": invoice.get('company_name', ''),
            "address": invoice.get('company_address'),
            "city": invoice.get('company_city'),
            "state": invoice.get('company_state'),
            "zip": invoice.get('company_zip'),
            "phone": invoice.get('company_phone'),
            "email": invoice.get('company_email'),
            "logo": invoice.get('company_logo')
        },
        "client": {
            "name": invoice.get('client_name', ''),
            "address": invoice.get('client_address'),
            "city": invoice.get('client_city'),
            "state": invoice.get('client_state'),
            "zip": invoice.get('client_zip'),
            "phone": invoice.get('client_phone'),
            "email": invoice.get('client_email')
        },
        "items": [
            {
                "name": item.get('name', ''),
                "description": item.get('description'),
                "note": item.get('note'),
                "quantity": item.get('quantity', 0),
                "unit": item.get('unit', ''),
                "rate": item.get('rate', 0),
                "images": item.get('images', [])
            }
            for item in invoice.get('items', [])
        ],
        "subtotal": invoice.get('subtotal', 0),
        "tax_rate": invoice.get('tax_rate', 0),
        "tax_amount": invoice.get('tax_amount', 0),
        "discount": invoice.get('discount', 0),
        "total": invoice.get('total', 0),
        "payments": invoice.get('payments', []),
        "paid_amount": invoice.get('paid_amount', 0),
        "payment_terms": invoice.get('payment_terms'),
        "notes": invoice.get('notes')
    }

    # Add insurance info if present
    if invoice.get('insurance_company'):
        pdf_data["insurance"] = {
            "company": invoice.get('insurance_company'),
            "policy_number": invoice.get('insurance_policy_number'),
            "claim_number": invoice.get('insurance_claim_number'),
            "deductible": invoice.get('insurance_deductible')
        }

    # Generate PDF receipt
    if not get_pdf_service():
        raise HTTPException(status_code=500, detail="PDF service not available")

    # Use temp_file_handler for automatic cleanup (cross-platform compatible)
    with temp_file_handler(suffix=".pdf", prefix="invoice_receipt_") as temp_path:
        try:
            # Generate PDF receipt
            pdf_path = get_pdf_service().generate_receipt_pdf(pdf_data, str(temp_path))

            # Validate the PDF path to prevent path traversal attacks
            try:
                validated_path = validate_file_path(pdf_path, get_temp_dir())
            except PathTraversalError:
                logger.error(f"Security: Path traversal attempt in receipt PDF: {pdf_path}")
                raise HTTPException(status_code=400, detail="Invalid file path")

            # Update invoice with receipt generation timestamp
            service.update(invoice_id, {
                'has_receipt': True,
                'receipt_generated_at': datetime.now()
            })

            # Read PDF file using validated path
            with open(validated_path, "rb") as pdf_file:
                pdf_content = pdf_file.read()

            # Return PDF as response (temp file auto-cleaned by context manager)
            return Response(
                content=pdf_content,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f"attachment; filename=receipt_{invoice['invoice_number']}.pdf"
                }
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Receipt PDF generation error: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
