"""
Receipt domain API endpoints
"""

from fastapi import APIRouter, HTTPException, Depends, Response
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import tempfile
import os
import logging

from app.core.database_factory import get_db_session as get_db
from app.domains.receipt.schemas import (
    ReceiptCreate,
    ReceiptUpdate,
    ReceiptResponse,
    ReceiptListResponse,
    ReceiptListItem,
    ReceiptGenerateRequest,
    ReceiptTemplateCreate,
    ReceiptTemplateUpdate,
    ReceiptTemplateResponse
)
from app.common.services.pdf_service import pdf_service
from app.domains.receipt.service import ReceiptService, ReceiptTemplateService

logger = logging.getLogger(__name__)


def get_receipt_service():
    """Get receipt service instance"""
    try:
        logger.info("get_receipt_service: Creating database connection...")
        from app.core.database_factory import get_database
        database = get_database()
        logger.info(f"get_receipt_service: Database created: {type(database)}")

        service = ReceiptService(database)
        logger.info(f"get_receipt_service: Service created: {type(service)}")
        return service
    except Exception as e:
        import traceback
        logger.error(f"get_receipt_service ERROR: {e}")
        logger.error(f"get_receipt_service TRACEBACK: {traceback.format_exc()}")
        raise


def get_receipt_template_service():
    """Get receipt template service instance"""
    try:
        from app.core.database_factory import get_database
        database = get_database()
        return ReceiptTemplateService(database)
    except Exception as e:
        logger.error(f"get_receipt_template_service ERROR: {e}")
        raise


router = APIRouter()


def _get_payment_method_mapping():
    """Get payment method code to name mapping from database"""
    try:
        from app.core.database_factory import get_database
        from sqlalchemy import text

        database = get_database()
        db = database.get_db()

        # Query payment_methods table
        query = text("SELECT code, name FROM payment_methods WHERE is_active = true")
        result = db.execute(query)

        # Create mapping dictionary
        mapping = {}
        for row in result:
            mapping[row.code] = row.name

        db.close()
        return mapping
    except Exception as e:
        logger.error(f"Error fetching payment method mapping: {e}")
        # Return default mapping if database query fails
        return {
            'ZELLE': 'Zelle',
            'ZL': 'Zelle',
            'CHECK': 'Check',
            'CK': 'Check',
            'CASH': 'Cash',
            'CS': 'Cash',
            'CREDIT_CARD': 'Credit Card',
            'CC': 'Credit Card',
            'WIRE': 'Wire Transfer',
            'WT': 'Wire Transfer'
        }


def _map_payment_methods(payments, method_mapping):
    """Map payment method codes to display names"""
    if not payments:
        return []

    mapped_payments = []
    for payment in payments:
        mapped_payment = payment.copy()
        method_code = payment.get('method', '')
        # Look up the full name, fallback to code if not found
        mapped_payment['method'] = method_mapping.get(method_code, method_code)
        mapped_payments.append(mapped_payment)

    return mapped_payments


def _convert_to_receipt_response(receipt: Dict[str, Any]) -> ReceiptResponse:
    """Helper function to convert receipt dict to ReceiptResponse"""
    return ReceiptResponse(
        id=receipt['id'],
        receipt_number=receipt.get('receipt_number', ''),
        company_id=receipt.get('company_id'),
        invoice_id=receipt.get('invoice_id', ''),
        template_id=receipt.get('template_id'),
        receipt_date=receipt.get('receipt_date', ''),
        payment_amount=receipt.get('payment_amount', 0.0),
        payment_method=receipt.get('payment_method'),
        payment_reference=receipt.get('payment_reference'),
        invoice_number=receipt.get('invoice_number', ''),
        original_amount=receipt.get('original_amount', 0.0),
        paid_amount_to_date=receipt.get('paid_amount_to_date', 0.0),
        balance_due=receipt.get('balance_due', 0.0),
        top_note=receipt.get('top_note'),
        bottom_note=receipt.get('bottom_note'),
        status=receipt.get('status', 'issued'),
        version=receipt.get('version', 1),
        superseded_by=receipt.get('superseded_by'),
        created_by=receipt.get('created_by'),
        updated_by=receipt.get('updated_by'),
        voided_at=receipt.get('voided_at'),
        voided_by=receipt.get('voided_by'),
        void_reason=receipt.get('void_reason'),
        created_at=receipt.get('created_at', ''),
        updated_at=receipt.get('updated_at', '')
    )


# Receipt endpoints

@router.get("/", response_model=ReceiptListResponse)
async def list_receipts(
    skip: int = 0,
    limit: int = 100,
    status: Optional[str] = None,
    invoice_id: Optional[str] = None,
    service: ReceiptService = Depends(get_receipt_service)
):
    """List all receipts with optional filtering"""

    try:
        logger.info("Starting list_receipts endpoint")
        logger.info(f"Parameters - skip: {skip}, limit: {limit}, status: {status}, invoice_id: {invoice_id}")

        # Build filters
        filters = {}
        if status:
            filters['status'] = status
        if invoice_id:
            filters['invoice_id'] = invoice_id

        # Get receipts with filtering
        receipts = service.get_all(
            filters=filters if filters else None,
            limit=limit,
            offset=skip,
            order_by='-created_at'
        )

        # Convert to response format
        receipt_responses = []
        for receipt in receipts:
            receipt_responses.append({
                'id': receipt.get('id'),
                'receipt_number': receipt.get('receipt_number', ''),
                'invoice_number': receipt.get('invoice_number', ''),
                'receipt_date': receipt.get('receipt_date', ''),
                'payment_amount': float(receipt.get('payment_amount', 0)),
                'status': receipt.get('status', ''),
                'created_at': receipt.get('created_at', '')
            })

        return {
            "receipts": receipt_responses,
            "total": len(receipt_responses),
            "skip": skip,
            "limit": limit
        }

    except Exception as e:
        import traceback
        error_details = {
            "error": str(e),
            "type": type(e).__name__,
            "traceback": traceback.format_exc(),
            "message": "Error fetching receipts"
        }
        logger.error(f"Receipt API error: {error_details}")
        raise HTTPException(status_code=500, detail=error_details)


@router.post("/generate", response_model=ReceiptResponse)
async def generate_receipt(
    request: ReceiptGenerateRequest,
    service: ReceiptService = Depends(get_receipt_service)
):
    """Generate a receipt from an invoice"""

    try:
        logger.info(f"Generating receipt for invoice: {request.invoice_id}")
        logger.info(f"Request data: {request.dict()}")

        # Generate receipt with all request fields
        receipt = service.generate_receipt(
            invoice_id=request.invoice_id,
            template_id=request.template_id,
            receipt_date=request.receipt_date,
            payment_amount=request.payment_amount,
            payment_method=request.payment_method,
            payment_reference=request.payment_reference,
            receipt_number=request.receipt_number,
            top_note=request.top_note,
            bottom_note=request.bottom_note
        )

        if not receipt:
            raise HTTPException(status_code=400, detail="Failed to generate receipt")

        # Convert to response format
        return _convert_to_receipt_response(receipt)

    except ValueError as e:
        logger.error(f"Validation error generating receipt: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error generating receipt: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate receipt: {str(e)}")


@router.get("/by-invoice/{invoice_id}", response_model=List[ReceiptResponse])
async def get_receipts_by_invoice(
    invoice_id: str,
    service: ReceiptService = Depends(get_receipt_service)
):
    """Get all receipts for a specific invoice"""

    try:
        logger.info(f"=== Getting receipts for invoice: {invoice_id} ===")
        receipts = service.get_receipts_by_invoice(invoice_id)
        logger.info(f"Found {len(receipts)} receipts for invoice {invoice_id}")

        # Convert to response format
        result = [_convert_to_receipt_response(receipt) for receipt in receipts]
        logger.info(f"Returning {len(result)} receipt responses")

        return result

    except Exception as e:
        logger.error(f"Error getting receipts for invoice {invoice_id}: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to get receipts: {str(e)}")


@router.get("/{receipt_id}", response_model=ReceiptResponse)
async def get_receipt(
    receipt_id: str,
    service: ReceiptService = Depends(get_receipt_service)
):
    """Get a specific receipt by ID"""

    try:
        receipt = service.get_by_id(receipt_id)
        if not receipt:
            raise HTTPException(status_code=404, detail="Receipt not found")

        # Convert to response format
        return _convert_to_receipt_response(receipt)

    except Exception as e:
        logger.error(f"Error getting receipt {receipt_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get receipt: {str(e)}")


@router.put("/{receipt_id}", response_model=ReceiptResponse)
async def update_receipt(
    receipt_id: str,
    receipt_data: ReceiptUpdate,
    service: ReceiptService = Depends(get_receipt_service)
):
    """Update an existing receipt"""

    try:
        # Check if receipt exists
        existing = service.get_by_id(receipt_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Receipt not found")

        # Prepare update data
        update_dict = receipt_data.dict(exclude_unset=True)

        # Update receipt
        updated_receipt = service.update(receipt_id, update_dict)
        if not updated_receipt:
            raise HTTPException(status_code=500, detail="Failed to update receipt")

        # Fetch complete receipt data with invoice information
        complete_receipt = service.get_by_id(receipt_id)
        if not complete_receipt:
            raise HTTPException(status_code=500, detail="Failed to fetch updated receipt")

        # Convert to response format using helper function
        return _convert_to_receipt_response(complete_receipt)

    except Exception as e:
        logger.error(f"Error updating receipt {receipt_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update receipt: {str(e)}")


@router.post("/{receipt_id}/void", response_model=ReceiptResponse)
async def void_receipt(
    receipt_id: str,
    reason: str,
    service: ReceiptService = Depends(get_receipt_service)
):
    """Void a receipt"""

    try:
        # Check if receipt exists
        existing = service.get_by_id(receipt_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Receipt not found")

        # Void the receipt
        voided_receipt = service.void_receipt(receipt_id, reason)
        if not voided_receipt:
            raise HTTPException(status_code=500, detail="Failed to void receipt")

        # Convert to response format
        return ReceiptResponse(
            id=voided_receipt['id'],
            receipt_number=voided_receipt.get('receipt_number', ''),
            invoice_id=voided_receipt.get('invoice_id', ''),
            receipt_date=voided_receipt.get('receipt_date', ''),
            status=voided_receipt.get('status', 'voided'),
            template_id=voided_receipt.get('template_id'),
            company_id=voided_receipt.get('company_id'),
            client_name=voided_receipt.get('client_name', ''),
            client_address=voided_receipt.get('client_address'),
            client_city=voided_receipt.get('client_city'),
            client_state=voided_receipt.get('client_state'),
            client_zipcode=voided_receipt.get('client_zipcode'),
            client_phone=voided_receipt.get('client_phone'),
            client_email=voided_receipt.get('client_email'),
            amount=voided_receipt.get('amount', 0),
            payment_method=voided_receipt.get('payment_method'),
            payment_date=voided_receipt.get('payment_date'),
            items_summary=voided_receipt.get('items_summary'),
            notes=voided_receipt.get('notes'),
            void_reason=voided_receipt.get('void_reason'),
            voided_at=voided_receipt.get('voided_at'),
            created_at=voided_receipt.get('created_at', ''),
            updated_at=voided_receipt.get('updated_at', '')
        )

    except Exception as e:
        logger.error(f"Error voiding receipt {receipt_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to void receipt: {str(e)}")


@router.delete("/{receipt_id}")
async def delete_receipt(
    receipt_id: str,
    service: ReceiptService = Depends(get_receipt_service)
):
    """Delete a receipt"""

    try:
        # Check if receipt exists
        existing = service.get_by_id(receipt_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Receipt not found")

        # Delete receipt
        if not service.delete(receipt_id):
            raise HTTPException(status_code=500, detail="Failed to delete receipt")

        return {"message": "Receipt deleted successfully"}

    except Exception as e:
        logger.error(f"Error deleting receipt {receipt_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete receipt: {str(e)}")


# PDF generation endpoints

@router.get("/{receipt_id}/html")
async def generate_receipt_html(
    receipt_id: str,
    service: ReceiptService = Depends(get_receipt_service)
):
    """Generate HTML for a receipt"""

    try:
        # Get receipt from database
        receipt = service.get_by_id(receipt_id)
        if not receipt:
            raise HTTPException(status_code=404, detail="Receipt not found")

        # Get invoice data for full context
        from app.domains.invoice.service import InvoiceService
        from app.core.database_factory import get_database
        database = get_database()
        invoice_service = InvoiceService(database)
        invoice = invoice_service.get_with_items(receipt.get('invoice_id'))

        if not invoice:
            raise HTTPException(status_code=404, detail="Associated invoice not found")

        # Get payment method mapping
        method_mapping = _get_payment_method_mapping()

        # Filter payments up to receipt date (include only payments on or before receipt date)
        receipt_date_str = receipt.get('receipt_date', '')
        payments = invoice.get('payments', [])

        # Filter payments by date
        if receipt_date_str:
            filtered_payments = []
            for payment in payments:
                payment_date = payment.get('date')
                if payment_date and payment_date <= receipt_date_str:
                    filtered_payments.append(payment)
                elif not payment_date:  # Include payments without date
                    filtered_payments.append(payment)
            payments = filtered_payments

        # Map payment method codes to names
        mapped_payments = _map_payment_methods(payments, method_mapping)

        # Determine receipt number to display - same logic as PDF endpoint
        display_receipt_number = receipt.get('receipt_number', '')
        receipt_amount = receipt.get('payment_amount', 0)
        matched_payment = None

        for payment in mapped_payments:
            if payment.get('receipt_number') and abs(float(payment.get('amount', 0)) - float(receipt_amount)) < 0.01:
                matched_payment = payment
                break

        if matched_payment and matched_payment.get('receipt_number'):
            display_receipt_number = matched_payment.get('receipt_number')
        elif mapped_payments:
            sorted_payments = sorted(
                [p for p in mapped_payments if p.get('receipt_number')],
                key=lambda p: p.get('date', ''),
                reverse=True
            )
            if sorted_payments:
                display_receipt_number = sorted_payments[0].get('receipt_number', display_receipt_number)

        # Prepare data for HTML generation - get client info from invoice
        html_data = {
            "receipt_number": display_receipt_number,
            "receipt_date": receipt.get('receipt_date', ''),
            "invoice_number": invoice.get('invoice_number', ''),
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
                "name": invoice.get('client_name', 'Unknown Client'),
                "address": invoice.get('client_address'),
                "city": invoice.get('client_city'),
                "state": invoice.get('client_state'),
                "zip": invoice.get('client_zipcode'),
                "phone": invoice.get('client_phone'),
                "email": invoice.get('client_email')
            },
            "amount": receipt.get('payment_amount', 0),
            "payment_method": receipt.get('payment_method', ''),
            "payment_date": receipt.get('receipt_date', ''),
            "payments": mapped_payments,
            "original_amount": receipt.get('original_amount', 0),
            "paid_amount_to_date": receipt.get('paid_amount_to_date', 0),
            "balance_due": receipt.get('balance_due', 0),
            "items": invoice.get('items', []),
            "top_note": receipt.get('top_note', ''),
            "bottom_note": receipt.get('bottom_note', ''),
            # Financial details from invoice
            "items_subtotal": invoice.get('subtotal', 0),
            "op_percent": invoice.get('op_percent', 0),
            "op_amount": invoice.get('subtotal', 0) * (invoice.get('op_percent', 0) / 100) if invoice.get('op_percent') else 0,
            "tax_rate": invoice.get('tax_rate', 0),
            "tax_amount": invoice.get('tax_amount', 0),
            "tax_method": invoice.get('tax_method', 'percentage'),
            "discount": invoice.get('discount', 0),
            "shipping": invoice.get('shipping', 0) if 'shipping' in invoice else 0,
            "subtotal": invoice.get('subtotal', 0),
            "total": invoice.get('total', 0)
        }

        # Debug: Log items data to verify note field
        logger.info(f"=== Receipt PDF - Items Debug ===")
        logger.info(f"Number of items: {len(invoice.get('items', []))}")
        for idx, item in enumerate(invoice.get('items', [])):
            logger.info(f"Item {idx}: name={item.get('name')}, description={item.get('description')}, note={item.get('note')}")

        # Group items by primary_group to create sections (same as invoice)
        items = invoice.get('items', [])
        if items:
            sections_map = {}
            for item in items:
                group_name = item.get('primary_group', 'Services')
                if group_name not in sections_map:
                    sections_map[group_name] = []
                sections_map[group_name].append(item)

            # Convert to sections structure
            sections = []
            for section_name, section_items in sections_map.items():
                sections.append({
                    'title': section_name,
                    'items': section_items,
                    'subtotal': sum(float(item.get('quantity', 0)) * float(item.get('rate', 0)) for item in section_items),
                    'showSubtotal': len(section_items) > 1
                })
            pdf_data['sections'] = sections
            logger.info(f"Created {len(sections)} sections from items")

        # Generate HTML using PDF service
        if not pdf_service:
            raise HTTPException(status_code=500, detail="PDF service not available")

        html_content = pdf_service.generate_receipt_html(html_data)

        # Return HTML as response
        return Response(
            content=html_content,
            media_type="text/html",
            headers={
                "Content-Disposition": f"inline; filename=receipt_{receipt['receipt_number']}.html"
            }
        )

    except Exception as e:
        logger.error(f"Receipt HTML generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{receipt_id}/pdf")
async def generate_receipt_pdf(
    receipt_id: str,
    service: ReceiptService = Depends(get_receipt_service)
):
    """Generate PDF for a receipt"""

    try:
        # Get receipt from database
        receipt = service.get_by_id(receipt_id)
        if not receipt:
            raise HTTPException(status_code=404, detail="Receipt not found")

        # Get invoice data for full context
        from app.domains.invoice.service import InvoiceService
        from app.core.database_factory import get_database
        database = get_database()
        invoice_service = InvoiceService(database)
        invoice = invoice_service.get_with_items(receipt.get('invoice_id'))

        if not invoice:
            raise HTTPException(status_code=404, detail="Associated invoice not found")

        # Get payment method mapping
        method_mapping = _get_payment_method_mapping()

        # Format receipt_date for comparison
        from datetime import datetime as dt
        receipt_date_value = receipt.get('receipt_date', '')
        if receipt_date_value:
            if isinstance(receipt_date_value, str):
                # Parse ISO format string to datetime then format to YYYY-MM-DD
                try:
                    parsed_date = dt.fromisoformat(receipt_date_value.replace('Z', '+00:00'))
                    receipt_date_str = parsed_date.strftime('%Y-%m-%d')
                except (ValueError, AttributeError):
                    # If parsing fails, use as-is
                    receipt_date_str = receipt_date_value.split('T')[0] if 'T' in receipt_date_value else receipt_date_value
            else:
                # Convert date/datetime object to string format (YYYY-MM-DD)
                receipt_date_str = receipt_date_value.strftime('%Y-%m-%d') if hasattr(receipt_date_value, 'strftime') else str(receipt_date_value)
        else:
            receipt_date_str = ''

        # Filter payments up to receipt date (include only payments on or before receipt date)
        payments = invoice.get('payments', [])

        # Filter payments by date
        if receipt_date_str:
            filtered_payments = []
            for payment in payments:
                payment_date = payment.get('date')
                if payment_date and payment_date <= receipt_date_str:
                    filtered_payments.append(payment)
                elif not payment_date:  # Include payments without date
                    filtered_payments.append(payment)
            payments = filtered_payments

        # Debug: Log payments data
        logger.info(f"=== Receipt PDF Generation - Payments Debug ===")
        logger.info(f"Receipt date: {receipt_date_str}")
        logger.info(f"Number of filtered payments: {len(payments)}")
        for idx, payment in enumerate(payments):
            logger.info(f"Payment {idx}: amount={payment.get('amount')}, date={payment.get('date')}, receipt_number={payment.get('receipt_number')}")

        mapped_payments = _map_payment_methods(payments, method_mapping)

        # Use the receipt_number from the receipt record itself
        # This is the receipt_number that was generated when the receipt was created
        display_receipt_number = receipt.get('receipt_number', '')

        logger.info(f"=== Receipt Number Display ===")
        logger.info(f"Receipt record receipt_number: {receipt.get('receipt_number')}")
        logger.info(f"Display receipt_number: {display_receipt_number}")

        # Prepare data for PDF generation - get client info from invoice
        pdf_data = {
            "receipt_number": display_receipt_number,
            "receipt_date": receipt_date_str,
            "invoice_number": invoice.get('invoice_number', ''),
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
                "name": invoice.get('client_name', 'Unknown Client'),
                "address": invoice.get('client_address'),
                "city": invoice.get('client_city'),
                "state": invoice.get('client_state'),
                "zip": invoice.get('client_zipcode'),
                "phone": invoice.get('client_phone'),
                "email": invoice.get('client_email')
            },
            "amount": receipt.get('payment_amount', 0),
            "payment_method": receipt.get('payment_method', ''),
            "payment_date": receipt_date_str,
            "payments": mapped_payments,
            "original_amount": receipt.get('original_amount', 0),
            "paid_amount_to_date": receipt.get('paid_amount_to_date', 0),
            "balance_due": receipt.get('balance_due', 0),
            "items": invoice.get('items', []),
            "top_note": receipt.get('top_note', ''),
            "bottom_note": receipt.get('bottom_note', ''),
            # Financial details from invoice
            "items_subtotal": invoice.get('subtotal', 0),
            "op_percent": invoice.get('op_percent', 0),
            "op_amount": invoice.get('subtotal', 0) * (invoice.get('op_percent', 0) / 100) if invoice.get('op_percent') else 0,
            "tax_rate": invoice.get('tax_rate', 0),
            "tax_amount": invoice.get('tax_amount', 0),
            "tax_method": invoice.get('tax_method', 'percentage'),
            "discount": invoice.get('discount', 0),
            "shipping": invoice.get('shipping', 0) if 'shipping' in invoice else 0,
            "subtotal": invoice.get('subtotal', 0),
            "total": invoice.get('total', 0)
        }

        # Debug: Log items data to verify note field
        logger.info(f"=== Receipt PDF - Items Debug ===")
        logger.info(f"Number of items: {len(invoice.get('items', []))}")
        for idx, item in enumerate(invoice.get('items', [])):
            logger.info(f"Item {idx}: name={item.get('name')}, description={item.get('description')}, note={item.get('note')}")

        # Group items by primary_group to create sections (same as invoice)
        items = invoice.get('items', [])
        if items:
            sections_map = {}
            for item in items:
                group_name = item.get('primary_group', 'Services')
                if group_name not in sections_map:
                    sections_map[group_name] = []
                sections_map[group_name].append(item)

            # Convert to sections structure
            sections = []
            for section_name, section_items in sections_map.items():
                sections.append({
                    'title': section_name,
                    'items': section_items,
                    'subtotal': sum(float(item.get('quantity', 0)) * float(item.get('rate', 0)) for item in section_items),
                    'showSubtotal': len(section_items) > 1
                })
            pdf_data['sections'] = sections
            logger.info(f"Created {len(sections)} sections from items")

        # Generate PDF using PDF service
        if not pdf_service:
            raise HTTPException(status_code=500, detail="PDF service not available")

        # Create temporary file for PDF
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp_file:
            output_path = tmp_file.name

        try:
            # Generate PDF
            pdf_path = pdf_service.generate_receipt_pdf(pdf_data, output_path)

            # Read PDF file
            with open(pdf_path, "rb") as pdf_file:
                pdf_content = pdf_file.read()

            # Clean up temp file
            os.unlink(pdf_path)

            # Return PDF as response
            return Response(
                content=pdf_content,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f"attachment; filename=receipt_{receipt['receipt_number']}.pdf"
                }
            )
        except Exception as e:
            # Clean up on error
            if os.path.exists(output_path):
                os.unlink(output_path)
            raise

    except Exception as e:
        logger.error(f"Receipt PDF generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/preview-html")
async def preview_receipt_html(
    data: dict,
    service: ReceiptService = Depends(get_receipt_service)
):
    """
    Preview receipt HTML without saving to database
    Used for previewing receipt before generation
    """
    try:
        logger.info("Starting receipt HTML preview generation")
        logger.info(f"Preview data keys: {list(data.keys())}")

        # Get invoice data if invoice_id is provided
        invoice_id = data.get('invoice_id')
        if invoice_id:
            from app.domains.invoice.service import InvoiceService
            from app.core.database_factory import get_database
            database = get_database()
            invoice_service = InvoiceService(database)
            invoice = invoice_service.get_with_items(invoice_id)

            if not invoice:
                raise HTTPException(status_code=404, detail="Invoice not found")
        else:
            # Use provided data directly for preview
            invoice = data

        # Get payment method mapping
        method_mapping = _get_payment_method_mapping()

        # Format receipt_date for comparison
        receipt_date_value = data.get('receipt_date', '')
        if receipt_date_value and not isinstance(receipt_date_value, str):
            # Convert date/datetime object to string format (YYYY-MM-DD)
            receipt_date_str = receipt_date_value.strftime('%Y-%m-%d') if hasattr(receipt_date_value, 'strftime') else str(receipt_date_value)
        else:
            receipt_date_str = receipt_date_value

        # Filter payments up to receipt date (include only payments on or before receipt date)
        payments = data.get('payments', invoice.get('payments', []))

        # Filter payments by date
        if receipt_date_str:
            filtered_payments = []
            for payment in payments:
                payment_date = payment.get('date')
                if payment_date and payment_date <= receipt_date_str:
                    filtered_payments.append(payment)
                elif not payment_date:  # Include payments without date
                    filtered_payments.append(payment)
            payments = filtered_payments

        mapped_payments = _map_payment_methods(payments, method_mapping)

        # Determine receipt number to display for preview
        # Use the receipt_number provided in the request data
        display_receipt_number = data.get('receipt_number', 'PREVIEW')

        # Prepare receipt preview data
        preview_data = {
            "receipt_number": display_receipt_number,
            "receipt_date": receipt_date_str,
            "invoice_number": data.get('invoice_number', invoice.get('invoice_number', '')),
            "company": data.get('company', {
                "name": invoice.get('company_name', ''),
                "address": invoice.get('company_address'),
                "city": invoice.get('company_city'),
                "state": invoice.get('company_state'),
                "zip": invoice.get('company_zip'),
                "phone": invoice.get('company_phone'),
                "email": invoice.get('company_email'),
                "logo": invoice.get('company_logo')
            }),
            "client": data.get('client', {
                "name": invoice.get('client_name', 'Unknown Client'),
                "address": invoice.get('client_address'),
                "city": invoice.get('client_city'),
                "state": invoice.get('client_state'),
                "zip": invoice.get('client_zipcode'),
                "phone": invoice.get('client_phone'),
                "email": invoice.get('client_email')
            }),
            "amount": data.get('payment_amount', 0),
            "paid_amount_to_date": data.get('payment_amount', 0),
            "payment_method": data.get('payment_method', ''),
            "payment_date": receipt_date_str,
            "payments": mapped_payments,
            "items": invoice.get('items', []),
            "sections": invoice.get('sections', []),
            "serviceSections": invoice.get('sections', []),
            "items_subtotal": invoice.get('subtotal', 0),
            "op_percent": invoice.get('op_percent', 0),
            "op_amount": invoice.get('subtotal', 0) * (invoice.get('op_percent', 0) / 100) if invoice.get('op_percent') else 0,
            "tax_rate": invoice.get('tax_rate', 0),
            "tax_amount": invoice.get('tax_amount', 0),
            "tax_method": invoice.get('tax_method', 'percentage'),
            "discount": invoice.get('discount', 0),
            "shipping": invoice.get('shipping', 0) if 'shipping' in invoice else 0,
            "subtotal": invoice.get('subtotal', 0),
            "total": invoice.get('total', 0),
            "top_note": data.get('top_note', ''),
            "bottom_note": data.get('bottom_note', ''),
            "original_amount": invoice.get('total', 0),
            "balance_due": invoice.get('balance_due', 0)
        }

        # Generate HTML using PDF service
        if not pdf_service:
            raise HTTPException(status_code=500, detail="PDF service not available")

        html_content = pdf_service.generate_receipt_html(preview_data)

        logger.info(f"Receipt HTML preview generated successfully, length: {len(html_content)}")

        # Return HTML
        return Response(
            content=html_content,
            media_type="text/html",
            headers={
                "Content-Disposition": "inline; filename=receipt_preview.html"
            }
        )

    except Exception as e:
        logger.error(f"Receipt HTML preview error: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


# Receipt template endpoints

@router.get("/templates/", response_model=List[ReceiptTemplateResponse])
async def list_templates(
    active_only: bool = True,
    service: ReceiptTemplateService = Depends(get_receipt_template_service)
):
    """List receipt templates"""

    try:
        if active_only:
            templates = service.get_active_templates()
        else:
            templates = service.get_all(order_by='name')

        # Convert to response format
        return [
            ReceiptTemplateResponse(
                id=template['id'],
                name=template.get('name', ''),
                description=template.get('description'),
                html_template=template.get('html_template', ''),
                css_styles=template.get('css_styles'),
                is_active=template.get('is_active', True),
                is_default=template.get('is_default', False),
                created_at=template.get('created_at', ''),
                updated_at=template.get('updated_at', '')
            )
            for template in templates
        ]

    except Exception as e:
        logger.error(f"Error listing templates: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list templates: {str(e)}")


@router.get("/templates/company/{company_id}", response_model=List[ReceiptTemplateResponse])
async def list_templates_by_company(
    company_id: str,
    active_only: bool = True,
    service: ReceiptTemplateService = Depends(get_receipt_template_service)
):
    """List receipt templates for a specific company"""

    try:
        # Build filters
        filters = {'company_id': company_id}
        if active_only:
            filters['is_active'] = True

        templates = service.get_all(
            filters=filters,
            order_by='name'
        )

        # Convert to response format
        return [
            ReceiptTemplateResponse(
                id=template['id'],
                company_id=template.get('company_id'),
                name=template.get('name', ''),
                description=template.get('description'),
                template_type=template.get('template_type', 'standard'),
                is_active=template.get('is_active', True),
                is_default=template.get('is_default', False),
                top_note=template.get('top_note'),
                bottom_note=template.get('bottom_note'),
                display_options=template.get('display_options'),
                version=template.get('version', 1),
                created_at=template.get('created_at', ''),
                updated_at=template.get('updated_at', '')
            )
            for template in templates
        ]

    except Exception as e:
        logger.error(f"Error listing templates for company {company_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list templates: {str(e)}")


@router.get("/templates/default", response_model=ReceiptTemplateResponse)
async def get_default_template(
    service: ReceiptTemplateService = Depends(get_receipt_template_service)
):
    """Get the default receipt template"""

    try:
        template = service.get_default_template()
        if not template:
            raise HTTPException(status_code=404, detail="No default template found")

        return ReceiptTemplateResponse(
            id=template['id'],
            name=template.get('name', ''),
            description=template.get('description'),
            html_template=template.get('html_template', ''),
            css_styles=template.get('css_styles'),
            is_active=template.get('is_active', True),
            is_default=template.get('is_default', False),
            created_at=template.get('created_at', ''),
            updated_at=template.get('updated_at', '')
        )

    except Exception as e:
        logger.error(f"Error getting default template: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get default template: {str(e)}")


@router.post("/templates/", response_model=ReceiptTemplateResponse)
async def create_template(
    template_data: ReceiptTemplateCreate,
    service: ReceiptTemplateService = Depends(get_receipt_template_service)
):
    """Create a new receipt template"""

    try:
        # Create template
        template = service.create(template_data.dict())

        return ReceiptTemplateResponse(
            id=template['id'],
            name=template.get('name', ''),
            description=template.get('description'),
            html_template=template.get('html_template', ''),
            css_styles=template.get('css_styles'),
            is_active=template.get('is_active', True),
            is_default=template.get('is_default', False),
            created_at=template.get('created_at', ''),
            updated_at=template.get('updated_at', '')
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating template: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create template: {str(e)}")


@router.put("/templates/{template_id}", response_model=ReceiptTemplateResponse)
async def update_template(
    template_id: str,
    template_data: ReceiptTemplateUpdate,
    service: ReceiptTemplateService = Depends(get_receipt_template_service)
):
    """Update a receipt template"""

    try:
        # Check if template exists
        existing = service.get_by_id(template_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Template not found")

        # Update template
        updated_template = service.update(template_id, template_data.dict(exclude_unset=True))
        if not updated_template:
            raise HTTPException(status_code=500, detail="Failed to update template")

        return ReceiptTemplateResponse(
            id=updated_template['id'],
            name=updated_template.get('name', ''),
            description=updated_template.get('description'),
            html_template=updated_template.get('html_template', ''),
            css_styles=updated_template.get('css_styles'),
            is_active=updated_template.get('is_active', True),
            is_default=updated_template.get('is_default', False),
            created_at=updated_template.get('created_at', ''),
            updated_at=updated_template.get('updated_at', '')
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating template {template_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update template: {str(e)}")


@router.post("/templates/{template_id}/set-default")
async def set_default_template(
    template_id: str,
    service: ReceiptTemplateService = Depends(get_receipt_template_service)
):
    """Set a template as the default"""

    try:
        # Check if template exists
        existing = service.get_by_id(template_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Template not found")

        # Set as default
        if not service.set_default_template(template_id):
            raise HTTPException(status_code=500, detail="Failed to set default template")

        return {"message": "Template set as default successfully"}

    except Exception as e:
        logger.error(f"Error setting default template {template_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to set default template: {str(e)}")


@router.delete("/templates/{template_id}")
async def delete_template(
    template_id: str,
    service: ReceiptTemplateService = Depends(get_receipt_template_service)
):
    """Delete a receipt template"""

    try:
        # Check if template exists
        existing = service.get_by_id(template_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Template not found")

        # Check if it's the default template
        if existing.get('is_default'):
            raise HTTPException(status_code=400, detail="Cannot delete the default template")

        # Delete template
        if not service.delete(template_id):
            raise HTTPException(status_code=500, detail="Failed to delete template")

        return {"message": "Template deleted successfully"}

    except Exception as e:
        logger.error(f"Error deleting template {template_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete template: {str(e)}")


# Summary endpoint

@router.get("/summary/stats")
async def get_receipt_summary(
    service: ReceiptService = Depends(get_receipt_service)
):
    """Get receipt summary statistics"""

    try:
        summary = service.get_receipt_summary()
        return summary

    except Exception as e:
        logger.error(f"Error getting receipt summary: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get receipt summary: {str(e)}")