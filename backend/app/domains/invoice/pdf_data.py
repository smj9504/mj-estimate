"""
What a saved invoice prints: the preview-pdf request body for it
"""

from typing import Any, Dict, List, Optional

from app.common.utils.money import line_amount
from app.domains.invoice.schemas import InvoicePDFRequest


def _day(value: Any) -> Optional[str]:
    """A stored date or timestamp as YYYY-MM-DD, the day it was saved as"""
    if not value:
        return None
    if hasattr(value, 'strftime'):
        return value.strftime('%Y-%m-%d')
    return str(value)[:10]


def _item(item: Dict[str, Any]) -> Dict[str, Any]:
    # As the invoice page loads an item (it leaves its images behind)
    return {
        'name': item.get('name') or item.get('description') or '',
        'description': item.get('description') or item.get('name') or '',
        'quantity': float(item.get('quantity') or 0),
        'unit': item.get('unit') or 'EA',
        'rate': float(item.get('rate') or 0),
        'taxable': item.get('taxable') is not False,
        'primary_group': item.get('primary_group'),
        'secondary_group': item.get('secondary_group'),
        'sort_order': item.get('sort_order') or 0,
        'note': item.get('note'),
    }


def _sections(invoice: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The invoice's sections with their items, ordered as the invoice page
    shows them: by the saved section list, or, for an invoice saved before
    sections were kept, by the items' sort order"""
    items = [_item(i) for i in sorted(invoice.get('items') or [], key=lambda i: i.get('order_index') or 0)]
    saved = invoice.get('sections_data') or []

    if saved:
        by_group: Dict[str, List[Dict[str, Any]]] = {}
        for item in items:
            by_group.setdefault(item['primary_group'] or 'Default Section', []).append(item)
        sections = [
            {
                'id': s.get('id'),
                'title': s.get('title'),
                'items': by_group.get(s.get('title'), []),
                'showSubtotal': s.get('showSubtotal') is not False,
                'isLumpSum': bool(s.get('isLumpSum')),
                'lumpSumAmount': (s.get('lumpSumAmount') or 0) if s.get('isLumpSum') else None,
                'taxable': s.get('taxable') is not False,
            }
            for s in saved
        ]
    else:
        by_group = {}
        for item in sorted(items, key=lambda i: i['sort_order']):
            by_group.setdefault(item['primary_group'] or 'Default Section', []).append(item)
        sections = [
            {'id': f'section-{index}', 'title': title, 'items': group_items,
             'showSubtotal': True, 'isLumpSum': False, 'lumpSumAmount': None, 'taxable': True}
            for index, (title, group_items) in enumerate(by_group.items())
        ]

    for section in sections:
        items_total = float(sum(line_amount(i['quantity'], i['rate']) for i in section['items']))
        # Like the page: a lump sum of 0 falls back to the items' total
        section['subtotal'] = (section['lumpSumAmount'] if section['isLumpSum'] else items_total) or items_total
    return sections


def invoice_pdf_data(invoice: Dict[str, Any]) -> Dict[str, Any]:
    """The PDF request the invoice page sends for this saved invoice (as
    get_with_items returns it), so a PDF made from it here matches one
    downloaded from the page"""
    sections = _sections(invoice)
    # The page sends every item tagged with its section, in section order
    items = [
        {**item, 'primary_group': section['title'], 'sort_order': section_index * 1000 + item_index}
        for section_index, section in enumerate(sections)
        for item_index, item in enumerate(section['items'])
    ]

    show_insurance = invoice.get('show_insurance')
    if show_insurance is None:
        show_insurance = any(invoice.get(f) for f in (
            'insurance_company', 'insurance_policy_number', 'insurance_claim_number', 'insurance_deductible'
        ))

    adjustments = [
        {
            'name': a.get('name') or '',
            'percentage': a.get('percentage') or 0,
            'fixed_amount': a.get('fixed_amount'),
            'type': a.get('type') or 'add',
            'order': a.get('order') or index + 1,
            'note': a.get('note') or '',
        }
        for index, a in enumerate(invoice.get('adjustments') or [])
    ]
    is_lump_sum_document = bool(invoice.get('is_lump_sum_document'))
    tax_method = invoice.get('tax_method') or 'percentage'
    discount = 0 if adjustments else float(invoice.get('discount_amount') or 0)

    return InvoicePDFRequest(
        invoice_number=invoice.get('invoice_number') or '',
        date=_day(invoice.get('invoice_date')) or _day(invoice.get('created_at')) or '',
        due_date=_day(invoice.get('due_date')) or '',
        revised_date=_day(invoice.get('revised_date')),
        company={
            'name': invoice.get('company_name') or '',
            'address': invoice.get('company_address') or '',
            'city': invoice.get('company_city') or '',
            'state': invoice.get('company_state') or '',
            'zipcode': invoice.get('company_zip') or '',
            'phone': invoice.get('company_phone') or '',
            'email': invoice.get('company_email') or '',
            'logo': invoice.get('company_logo') or '',
        },
        client={
            'name': invoice.get('client_name'),
            'address': invoice.get('client_address'),
            'city': invoice.get('client_city'),
            'state': invoice.get('client_state'),
            'zipcode': invoice.get('client_zipcode'),
            'phone': invoice.get('client_phone'),
            'email': invoice.get('client_email'),
        },
        insurance={
            'company': invoice.get('insurance_company'),
            'policy_number': invoice.get('insurance_policy_number'),
            'claim_number': invoice.get('insurance_claim_number'),
            'deductible': invoice.get('insurance_deductible'),
        } if show_insurance else None,
        items=items,
        sections=sections,
        is_lump_sum_document=is_lump_sum_document,
        lump_sum_document_amount=invoice.get('lump_sum_document_amount') if is_lump_sum_document else None,
        subtotal=float(invoice.get('subtotal') or 0),
        adjustments=adjustments,
        op_percent=0 if adjustments else float(invoice.get('op_percent') or 0),
        tax_method=tax_method,
        tax_rate=float(invoice.get('tax_rate') or 0) if tax_method == 'percentage' else 0,
        tax_amount=float(invoice.get('tax_amount') or 0),
        discount=discount,
        total=float(invoice.get('total_amount') or 0),
        payments=invoice.get('payments') or [],
        show_payment_dates=invoice.get('show_payment_dates') is not False,
        balance_due=float(invoice.get('balance_due') or 0),
        payment_terms=invoice.get('payment_terms'),
        notes=invoice.get('notes'),
    ).dict()
