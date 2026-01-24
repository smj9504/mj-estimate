"""
Water Mitigation Scope Invoice Service

Service for generating invoices from scope items.
Uses the Invoice domain without modifying it.
"""

import logging
import re
from datetime import datetime, timedelta
from decimal import Decimal
from typing import List, Optional, Tuple, Dict, Any
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.domains.water_mitigation.models import (
    WaterMitigationJob,
    WMScopeLocation,
    WMScopeItem,
    WMScopeInvoice,
    WMScopeItemInvoiceLink,
    WMInvoiceItemConfig,
)
from app.domains.invoice.models import Invoice, InvoiceItem
from app.domains.line_items.models import (
    LineItemTemplate,
    TemplateLineItem,
    LineItem,
)

logger = logging.getLogger(__name__)


class ScopeInvoiceService:
    """Service for generating invoices from WM scope items"""

    # US State abbreviations for address parsing
    US_STATES = {
        'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
        'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
        'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
        'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
        'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
        'DC', 'PR', 'VI', 'GU', 'AS', 'MP'
    }

    def __init__(self, db: Session):
        self.db = db

    def _parse_us_address(
        self, full_address: Optional[str]
    ) -> Dict[str, Optional[str]]:
        """
        Parse a US address string into components.

        Handles formats like:
        - "12312 La Plata, Silver Spring MD 20904"
        - "123 Main St, Anytown, MD 20001"
        - "456 Oak Ave, Washington, DC 20500"

        Returns:
            Dict with keys: street, city, state, zipcode
        """
        result = {
            "street": None,
            "city": None,
            "state": None,
            "zipcode": None
        }

        if not full_address or not full_address.strip():
            return result

        address = full_address.strip()

        # Pattern 1: "Street, City STATE ZIP" or "Street, City, STATE ZIP"
        # ZIP code pattern (5 digits or 5+4 format)
        zip_pattern = r'\b(\d{5}(?:-\d{4})?)\s*$'
        zip_match = re.search(zip_pattern, address)

        if zip_match:
            result["zipcode"] = zip_match.group(1)
            address = address[:zip_match.start()].strip()

        # Find state abbreviation (2 capital letters before ZIP or at end)
        # Look for state pattern: word boundary + 2-letter state code
        state_pattern = r'\b([A-Z]{2})\s*$'
        state_match = re.search(state_pattern, address)

        if state_match:
            potential_state = state_match.group(1)
            if potential_state in self.US_STATES:
                result["state"] = potential_state
                address = address[:state_match.start()].strip()
                # Remove trailing comma if present
                address = address.rstrip(',').strip()

        # Now split remaining address by comma
        # The last part should be the city, everything before is the street
        parts = [p.strip() for p in address.split(',') if p.strip()]

        if len(parts) >= 2:
            # Last part is city, rest is street
            result["city"] = parts[-1]
            result["street"] = ', '.join(parts[:-1])
        elif len(parts) == 1:
            # Only one part - could be just street or street with city
            # Try to find city by looking for common patterns
            # For now, treat the whole thing as street address
            result["street"] = parts[0]

        return result

    def generate_invoice_from_scope(
        self,
        job_id: UUID,
        template_id: UUID,
        user_id: UUID,
        billing_company_id: Optional[UUID] = None,
        invoice_date: Optional[datetime] = None,
        scope_item_ids: Optional[List[UUID]] = None,
        notes: Optional[str] = None,
        holiday_premium: bool = False,
    ) -> Tuple[Dict[str, Any], List[str]]:
        """
        Generate an invoice from scope items.

        Args:
            job_id: Water mitigation job ID
            template_id: Line item template ID (WM Template) for pricing lookup
            user_id: User generating the invoice
            billing_company_id: Optional billing company (defaults to job's company)
            invoice_date: Optional invoice date (defaults to now)
            scope_item_ids: Optional specific scope items (all if None)
            notes: Optional notes
            holiday_premium: Whether to apply holiday premium (30% surcharge)

        Returns:
            Tuple of (result dict, warnings list)
        """
        # Expire all cached objects to ensure we get fresh line item prices
        self.db.expire_all()

        warnings = []

        # Get the WM Job
        job = self.db.query(WaterMitigationJob).filter(
            WaterMitigationJob.id == job_id
        ).first()

        if not job:
            raise ValueError(f"Water mitigation job not found: {job_id}")

        # Default billing company to job's company
        if not billing_company_id:
            billing_company_id = job.company_id
            if not billing_company_id:
                raise ValueError("No billing company specified and job has no company")

        # Get the template
        template = self.db.query(LineItemTemplate).options(
            joinedload(LineItemTemplate.template_items).joinedload(TemplateLineItem.line_item)
        ).filter(
            LineItemTemplate.id == template_id,
            LineItemTemplate.is_active.is_(True)
        ).first()

        if not template:
            raise ValueError(f"Line item template not found: {template_id}")

        # Build a lookup map from template items (item name/code → rate)
        template_rate_map = self._build_template_rate_map(template)

        # Get scope items to invoice
        scope_items = self._get_scope_items_for_invoice(job_id, scope_item_ids)

        logger.info(f"Found {len(scope_items)} scope items for job {job_id}")
        for item in scope_items:
            logger.info(f"  - Item: {item.name}, invoiced={item.invoiced}")

        if not scope_items:
            raise ValueError("No scope items found to invoice")

        # Filter out already invoiced items
        uninvoiced_items = [item for item in scope_items if not item.invoiced]

        logger.info(f"Uninvoiced items: {len(uninvoiced_items)}")

        if not uninvoiced_items:
            raise ValueError("All selected scope items have already been invoiced")

        if len(uninvoiced_items) < len(scope_items):
            skipped_count = len(scope_items) - len(uninvoiced_items)
            warnings.append(f"Skipped {skipped_count} items that were already invoiced")

        # Generate invoice number
        invoice_number = self._generate_invoice_number(job)

        # Calculate due date: invoice_date + 7 days
        effective_invoice_date = invoice_date or datetime.utcnow()
        due_date = effective_invoice_date + timedelta(days=7)

        # Generate header note with WM details if not provided
        invoice_notes = notes
        if not invoice_notes:
            invoice_notes = self._generate_wm_header_note(job, holiday_premium)

        # Prepare adjustments list
        adjustments = []
        if holiday_premium:
            adjustments.append({
                "name": "Holiday Premium",
                "type": "percentage",
                "value": 30,  # 30% surcharge
                "description": "Holiday Special Labor rates (130% of standard rate)"
            })

        # Parse the property address into components
        parsed_address = self._parse_us_address(job.property_address)

        # Create the invoice
        invoice = Invoice(
            invoice_number=invoice_number,
            version=1,
            is_latest=True,
            company_id=billing_company_id,
            client_name=job.homeowner_name,
            client_address=parsed_address["street"],
            client_city=parsed_address["city"],
            client_state=parsed_address["state"],
            client_zipcode=parsed_address["zipcode"],
            invoice_date=effective_invoice_date,
            due_date=due_date,
            status="pending",
            notes=invoice_notes,
            adjustments=adjustments if adjustments else [],
            insurance_company=job.insurance_company,
            insurance_policy_number=job.insurance_policy_number,
            insurance_claim_number=job.claim_number,
        )

        self.db.add(invoice)
        self.db.flush()  # Get the invoice ID

        # Load invoice configs for this job (keyed by scope_item_id)
        configs = self.db.query(WMInvoiceItemConfig).filter(
            WMInvoiceItemConfig.job_id == job_id,
            WMInvoiceItemConfig.is_enabled.is_(True)
        ).all()
        config_map = {
            str(c.scope_item_id): c for c in configs if c.scope_item_id
        }

        # Calculate mitigation days for per_day calculations
        mitigation_days = self._calculate_mitigation_days(job)

        # =============================================================
        # Add General Conditions items FIRST (items without scope_item_id)
        # =============================================================
        # GC configs can have either line_item_id (reference mode) or custom_name (embedded mode)
        gc_configs = [
            c for c in configs
            if c.scope_item_id is None and (c.line_item_id or c.custom_name)
        ]
        gc_items_created = []
        total_amount = Decimal("0")
        current_order_index = 0

        if gc_configs:
            logger.info(f"Processing {len(gc_configs)} General Conditions items")

            for gc_config in gc_configs:
                # Determine item details based on config type
                gc_name = None
                gc_rate = Decimal("0")
                gc_unit = "EA"
                resolved_line_item_id = None

                if gc_config.line_item_id:
                    # Reference mode - get line item
                    line_item = self.db.query(LineItem).filter(
                        LineItem.id == gc_config.line_item_id
                    ).first()

                    if not line_item:
                        warnings.append(f"Line item not found for GC config: {gc_config.id}")
                        continue

                    gc_name = line_item.description
                    gc_rate = line_item.untaxed_unit_price or Decimal("0")
                    gc_unit = line_item.unit or "HR"
                    resolved_line_item_id = gc_config.line_item_id
                else:
                    # Embedded mode - use custom fields
                    gc_name = gc_config.custom_name
                    gc_rate = gc_config.custom_rate or Decimal("0")
                    gc_unit = gc_config.custom_unit or "EA"

                if not gc_name:
                    warnings.append(f"No name for GC config: {gc_config.id}")
                    continue

                # Use calculated_quantity from config, or default to 1
                gc_quantity = Decimal(str(gc_config.calculated_quantity or 1))
                gc_amount = gc_quantity * gc_rate

                logger.info(
                    f"[GC] Creating invoice item: {gc_name}, "
                    f"qty={gc_quantity}, rate=${gc_rate}, amount=${gc_amount}"
                )

                # Determine note - skip if note is redundant (same as or contains line item name)
                gc_note = None
                if gc_config.default_note and gc_config.default_note.strip():
                    note_text = gc_config.default_note.strip().lower()
                    name_text = gc_name.lower()
                    # Skip note if it's redundant:
                    # - Exact match
                    # - Note contains line item name (e.g., "General Conditions: Emergency service call")
                    # - Line item name contains note
                    is_redundant = (
                        note_text == name_text or
                        name_text in note_text or
                        note_text in name_text
                    )
                    if not is_redundant:
                        gc_note = gc_config.default_note

                gc_invoice_item = InvoiceItem(
                    invoice_id=invoice.id,
                    name=gc_name,
                    description=gc_name,
                    quantity=gc_quantity,
                    unit=gc_unit,
                    rate=gc_rate,
                    amount=gc_amount,
                    taxable=True,
                    order_index=current_order_index,
                    primary_group="General Conditions",
                    note=gc_note,
                    line_item_id=resolved_line_item_id,
                )

                self.db.add(gc_invoice_item)
                self.db.flush()

                gc_items_created.append({
                    "config": gc_config,
                    "invoice_item": gc_invoice_item,
                })

                total_amount += gc_amount
                current_order_index += 1

            logger.info(f"Created {len(gc_items_created)} General Conditions invoice items")

        # =============================================================
        # Create invoice items from scope items (AFTER General Conditions)
        # =============================================================
        invoice_items_created = []

        for idx, scope_item in enumerate(uninvoiced_items):
            # Check for invoice config for this scope item
            config = config_map.get(str(scope_item.id))

            # Determine rate (priority: config -> scope_item -> template)
            rate = None
            line_item_name = scope_item.name
            resolved_line_item_id = None  # Track which line item was used

            # Priority 1: Use config's line_item_id if available
            if config and config.line_item_id:
                line_item = self.db.query(LineItem).filter(
                    LineItem.id == config.line_item_id
                ).first()
                if line_item:
                    rate = line_item.untaxed_unit_price or Decimal("0")
                    line_item_name = (
                        line_item.description or scope_item.name
                    )
                    resolved_line_item_id = config.line_item_id
                    logger.info(
                        f"Config line_item rate for "
                        f"'{scope_item.name}': ${rate}"
                    )

            # Priority 2: Use config's custom rate
            if rate is None and config and config.custom_rate:
                rate = config.custom_rate
                if config.custom_name:
                    line_item_name = config.custom_name
                logger.info(
                    f"Config custom rate for '{scope_item.name}': "
                    f"${rate}"
                )

            # Priority 3: Use scope item's linked line_item_id
            if rate is None and scope_item.line_item_id:
                line_item = self.db.query(LineItem).filter(
                    LineItem.id == scope_item.line_item_id
                ).first()
                if line_item:
                    rate = line_item.untaxed_unit_price or Decimal("0")
                    line_item_name = (
                        line_item.description or scope_item.name
                    )
                    resolved_line_item_id = scope_item.line_item_id
                    logger.info(
                        f"Scope item line_item rate for "
                        f"'{scope_item.name}': ${rate}"
                    )

            # Priority 4: Fall back to template rate map lookup
            if rate is None:
                rate = self._find_rate_for_scope_item(
                    scope_item, template_rate_map
                )

            if rate is None:
                warnings.append(
                    f"No matching template item for "
                    f"'{scope_item.name}', using rate 0"
                )
                rate = Decimal("0")

            # Calculate quantity based on config type
            base_quantity = Decimal(str(scope_item.quantity or 0))
            quantity = base_quantity

            if config:
                calc_type = config.quantity_calc_type or "fixed"
                if calc_type == "per_day":
                    quantity = base_quantity * mitigation_days
                    logger.info(
                        f"Per-day calc for '{scope_item.name}': "
                        f"{base_quantity} x {mitigation_days} = {quantity}"
                    )
                elif calc_type == "per_day_capped":
                    days_to_use = min(
                        mitigation_days, config.max_days
                    ) if config.max_days else mitigation_days
                    quantity = base_quantity * days_to_use
                    logger.info(
                        f"Per-day-capped calc for '{scope_item.name}': "
                        f"{base_quantity} x {days_to_use} = {quantity}"
                    )

            item_amount = quantity * rate

            # Process note with placeholders if configured
            # Priority: config.default_note > scope_item.description
            item_note = None
            if config and config.default_note and config.default_note.strip():
                item_note = config.default_note
                # Replace placeholders with actual values
                base_qty = Decimal(str(scope_item.quantity or 0))
                item_note = item_note.replace("{qty}", str(int(base_qty)))
                item_note = item_note.replace("{days}", str(int(mitigation_days)))
                item_note = item_note.replace("{quantity}", str(int(base_qty)))
                item_note = item_note.replace("{wm_days}", str(int(mitigation_days)))
                # Clear note if it becomes empty after processing
                if not item_note.strip():
                    item_note = None
            elif scope_item.description and scope_item.description.strip():
                # Use scope item description as note if no config note
                item_note = scope_item.description.strip()

            # Create invoice item
            # name: line item description (display name)
            # description: same as name (for invoice display)
            # note: processed note from config (separate field)
            # line_item_id: reference to line item for Cat/Item code lookup
            invoice_item = InvoiceItem(
                invoice_id=invoice.id,
                name=line_item_name,
                description=line_item_name,
                quantity=quantity,
                unit=scope_item.unit,
                rate=rate,
                amount=item_amount,
                taxable=True,
                order_index=current_order_index + idx,
                primary_group=(
                    scope_item.location.name
                    if scope_item.location else None
                ),
                note=item_note,
                line_item_id=resolved_line_item_id,
            )

            self.db.add(invoice_item)
            self.db.flush()

            invoice_items_created.append({
                "scope_item": scope_item,
                "invoice_item": invoice_item,
            })

            total_amount += item_amount

        # Update invoice totals
        invoice.subtotal = total_amount
        invoice.total_amount = total_amount
        invoice.balance_due = total_amount

        # Create WMScopeInvoice link
        scope_invoice = WMScopeInvoice(
            job_id=job_id,
            invoice_id=invoice.id,
            generated_by_id=user_id,
            notes=notes,
        )

        self.db.add(scope_invoice)
        self.db.flush()

        # Create item links and mark scope items as invoiced
        now = datetime.utcnow()

        for item_data in invoice_items_created:
            scope_item = item_data["scope_item"]
            invoice_item = item_data["invoice_item"]

            # Create link
            link = WMScopeItemInvoiceLink(
                wm_scope_invoice_id=scope_invoice.id,
                scope_item_id=scope_item.id,
                invoice_item_id=invoice_item.id,
            )
            self.db.add(link)

            # Mark scope item as invoiced
            scope_item.invoiced = True
            scope_item.invoiced_at = now

        # Update WM Job financial fields with invoice info
        job.invoice_number = invoice.invoice_number
        job.invoice_amount = total_amount
        logger.info(
            f"Updated WM Job {job_id} with invoice_number={invoice.invoice_number}, "
            f"invoice_amount={total_amount}"
        )

        self.db.commit()

        result = {
            "invoice_id": invoice.id,
            "invoice_number": invoice.invoice_number,
            "scope_invoice_id": scope_invoice.id,
            "items_invoiced": len(invoice_items_created),
            "gc_items_count": len(gc_items_created),
            "total_items": len(invoice_items_created) + len(gc_items_created),
            "total_amount": float(total_amount),
        }

        return result, warnings

    def sync_invoice_to_wm_job(
        self,
        invoice_id: UUID,
        invoice_number: Optional[str] = None,
        invoice_amount: Optional[Decimal] = None,
    ) -> bool:
        """
        Sync invoice information to the linked Water Mitigation Job.

        When an invoice is updated, this method updates the corresponding
        WM Job's financial fields (invoice_number, invoice_amount).

        Args:
            invoice_id: The invoice ID to sync from
            invoice_number: Optional invoice number (fetched from Invoice if not provided)
            invoice_amount: Optional invoice amount (fetched from Invoice if not provided)

        Returns:
            True if a WM Job was updated, False if no linked job found
        """
        # Find the WMScopeInvoice link for this invoice
        scope_invoice = self.db.query(WMScopeInvoice).filter(
            WMScopeInvoice.invoice_id == invoice_id
        ).first()

        if not scope_invoice:
            logger.debug(f"No WM Job linked to invoice {invoice_id}")
            return False

        # Get the WM Job
        job = self.db.query(WaterMitigationJob).filter(
            WaterMitigationJob.id == scope_invoice.job_id
        ).first()

        if not job:
            logger.warning(
                f"WM Job {scope_invoice.job_id} not found for invoice {invoice_id}"
            )
            return False

        # If invoice_number or invoice_amount not provided, fetch from Invoice
        if invoice_number is None or invoice_amount is None:
            invoice = self.db.query(Invoice).filter(Invoice.id == invoice_id).first()
            if invoice:
                if invoice_number is None:
                    invoice_number = invoice.invoice_number
                if invoice_amount is None:
                    invoice_amount = invoice.total_amount

        # Update WM Job financial fields
        updated = False
        if invoice_number is not None and job.invoice_number != invoice_number:
            job.invoice_number = invoice_number
            updated = True

        if invoice_amount is not None and job.invoice_amount != invoice_amount:
            job.invoice_amount = invoice_amount
            updated = True

        if updated:
            self.db.commit()
            logger.info(
                f"Synced invoice {invoice_id} to WM Job {job.id}: "
                f"invoice_number={invoice_number}, invoice_amount={invoice_amount}"
            )

        return updated

    def _build_template_rate_map(
        self, template: LineItemTemplate
    ) -> Dict[str, Decimal]:
        """Build a map of item names/codes to rates from template"""
        rate_map = {}

        logger.info(f"Building rate map from template: {template.name}")
        logger.info(f"Template has {len(template.template_items)} items")

        for template_item in template.template_items:
            if template_item.line_item_id and template_item.line_item:
                # Reference mode
                line_item = template_item.line_item
                key = line_item.description.lower().strip()
                rate = line_item.untaxed_unit_price or Decimal("0")
                rate_map[key] = rate
                logger.info(f"  Template item (ref): '{key}' -> ${rate}")

                # Also map by item code if available
                if line_item.item:
                    item_key = line_item.item.lower().strip()
                    rate_map[item_key] = rate
                    logger.info(
                        f"  Template item code: '{item_key}' -> ${rate}"
                    )

            elif template_item.embedded_data:
                # Embedded mode
                embedded = template_item.embedded_data
                desc = embedded.get("description", "").lower().strip()
                if desc:
                    rate_map[desc] = Decimal(str(embedded.get("rate", 0)))
                    logger.info(
                        f"  Template item (embedded): "
                        f"'{desc}' -> ${rate_map[desc]}"
                    )

                item_code = embedded.get("item_code", "").lower().strip()
                if item_code:
                    rate_map[item_code] = Decimal(str(embedded.get("rate", 0)))

        logger.info(f"Rate map built with {len(rate_map)} entries")
        return rate_map

    def _find_rate_for_scope_item(
        self,
        scope_item: WMScopeItem,
        rate_map: Dict[str, Decimal]
    ) -> Optional[Decimal]:
        """Find the rate for a scope item from the template rate map"""
        # Try exact match on name
        name_key = scope_item.name.lower().strip()
        logger.info(f"Looking for rate for scope item: '{name_key}'")

        if name_key in rate_map:
            logger.info(f"  -> Exact match found: ${rate_map[name_key]}")
            return rate_map[name_key]

        # Try partial matches (scope item name contains template item name)
        for key, rate in rate_map.items():
            if key in name_key or name_key in key:
                logger.info(f"  -> Partial match '{key}': ${rate}")
                return rate

        logger.warning(f"  -> No match found for '{name_key}'")
        return None

    def _get_scope_items_for_invoice(
        self,
        job_id: UUID,
        scope_item_ids: Optional[List[UUID]] = None
    ) -> List[WMScopeItem]:
        """Get scope items to invoice"""
        # Get all locations for the job with items
        locations = self.db.query(WMScopeLocation).options(
            joinedload(WMScopeLocation.scope_items)
        ).filter(
            WMScopeLocation.job_id == job_id
        ).all()

        # Flatten all scope items
        all_items = []
        for location in locations:
            for item in location.scope_items:
                # Attach location reference for grouping
                item.location = location
                all_items.append(item)

        # Filter by specific IDs if provided
        if scope_item_ids:
            scope_item_ids_set = set(scope_item_ids)
            all_items = [
                item for item in all_items
                if item.id in scope_item_ids_set
            ]

        return all_items

    def _calculate_mitigation_days(self, job: WaterMitigationJob) -> Decimal:
        """
        Calculate the number of mitigation days for a job.
        Used for per_day quantity calculations.
        """
        if job.mitigation_start_date and job.mitigation_end_date:
            delta = job.mitigation_end_date - job.mitigation_start_date
            # Include both start and end days
            days = delta.days + 1
            return Decimal(str(max(1, days)))
        # Default to 1 day if dates not set
        return Decimal("1")

    def _generate_wm_header_note(
        self,
        job: WaterMitigationJob,
        holiday_premium: bool = False
    ) -> str:
        """
        Generate the standard Water Mitigation header note for invoices.

        Includes:
        - WATER MITIGATION: Category 2
        - SERVICE TERMS: {start_date} - {end_date}
        - Standard disclaimer text
        - Holiday Premium notice (if applicable)
        """
        # Format dates
        start_date_str = "N/A"
        end_date_str = "N/A"

        if job.mitigation_start_date:
            start_date_str = job.mitigation_start_date.strftime("%m/%d/%Y")
        if job.mitigation_end_date:
            end_date_str = job.mitigation_end_date.strftime("%m/%d/%Y")

        # Build the header note with HTML line breaks for RichTextEditor
        # Line 1: WATER MITIGATION: Category 2
        # Line 2: SERVICE TERMS: {dates}
        # Blank line
        # Disclaimer text
        header_note = (
            "<p><strong>WATER MITIGATION: Category 2</strong><br/>"
            f"SERVICE TERMS: {start_date_str} - {end_date_str}</p>"
            "<p>At the customer's request, water mitigation services were provided "
            "for the insured property due to an unexpected incident. This service "
            "was intended to prevent further damage and to mitigate the spread of "
            "the loss, and it is hereby specified that the damage control and loss "
            "containment work was carried out with the customer's consent.</p>"
        )

        # Add holiday premium notice if applicable
        if holiday_premium:
            header_note += (
                "<p><strong>Holiday Special Labor rates were applied; "
                "130% of the standard service rate</strong></p>"
            )

        return header_note

    def _generate_invoice_number(self, job: WaterMitigationJob) -> str:
        """Generate a unique invoice number for WM job"""
        # Format: WM-{claim_number or job_id suffix}-{sequence}
        base = job.claim_number or str(job.id)[:8]

        # Count existing invoices for this job
        existing_count = self.db.query(WMScopeInvoice).filter(
            WMScopeInvoice.job_id == job.id
        ).count()

        sequence = existing_count + 1
        return f"WM-{base}-{sequence:03d}"

    def get_job_invoice_history(
        self, job_id: UUID
    ) -> Dict[str, Any]:
        """Get invoice history for a job"""
        scope_invoices = self.db.query(WMScopeInvoice).options(
            joinedload(WMScopeInvoice.invoice),
            joinedload(WMScopeInvoice.item_links)
        ).filter(
            WMScopeInvoice.job_id == job_id
        ).order_by(
            WMScopeInvoice.generated_at.desc()
        ).all()

        invoices = []
        total_invoiced = Decimal("0")

        for scope_invoice in scope_invoices:
            invoice = scope_invoice.invoice
            invoice_total = invoice.total_amount or Decimal("0")
            total_invoiced += invoice_total

            invoices.append({
                "id": scope_invoice.id,
                "job_id": scope_invoice.job_id,
                "invoice_id": invoice.id,
                "invoice_number": invoice.invoice_number,
                "invoice_total": float(invoice_total),
                "generated_at": scope_invoice.generated_at,
                "generated_by_id": scope_invoice.generated_by_id,
                "notes": scope_invoice.notes,
                "item_count": len(scope_invoice.item_links),
            })

        return {
            "invoices": invoices,
            "total_invoiced": float(total_invoiced),
            "invoice_count": len(invoices),
        }

    def get_scope_item_invoice_status(
        self, job_id: UUID
    ) -> List[Dict[str, Any]]:
        """Get invoice status for all scope items in a job"""
        # Get all scope items
        locations = self.db.query(WMScopeLocation).options(
            joinedload(WMScopeLocation.scope_items)
        ).filter(
            WMScopeLocation.job_id == job_id
        ).all()

        result = []
        for location in locations:
            for item in location.scope_items:
                # Check if there's a link to an invoice item
                link = self.db.query(WMScopeItemInvoiceLink).options(
                    joinedload(WMScopeItemInvoiceLink.invoice_item),
                    joinedload(WMScopeItemInvoiceLink.scope_invoice)
                    .joinedload(WMScopeInvoice.invoice)
                ).filter(
                    WMScopeItemInvoiceLink.scope_item_id == item.id
                ).first()

                invoice_data = None
                if link:
                    inv_num = link.scope_invoice.invoice.invoice_number
                    invoice_data = {
                        "invoice_item_id": link.invoice_item_id,
                        "invoice_id": link.scope_invoice.invoice_id,
                        "invoice_number": inv_num,
                    }

                result.append({
                    "scope_item_id": item.id,
                    "scope_item_name": item.name,
                    "location_name": location.name,
                    "invoiced": item.invoiced or False,
                    "invoiced_at": item.invoiced_at,
                    **(invoice_data or {}),
                })

        return result

    def get_uninvoiced_items_count(self, job_id: UUID) -> int:
        """Get count of uninvoiced scope items for a job"""
        locations = self.db.query(WMScopeLocation).options(
            joinedload(WMScopeLocation.scope_items)
        ).filter(
            WMScopeLocation.job_id == job_id
        ).all()

        count = 0
        for location in locations:
            for item in location.scope_items:
                if not item.invoiced:
                    count += 1

        return count

    def delete_scope_invoice(self, scope_invoice_id: UUID) -> bool:
        """
        Delete a WM scope invoice and reset scope items' invoiced status.

        This will:
        1. Find the scope invoice
        2. Get all linked scope items
        3. Reset their invoiced status to False
        4. Delete the links and scope invoice record
        5. Optionally delete the actual invoice

        Args:
            scope_invoice_id: WMScopeInvoice ID

        Returns:
            True if deleted successfully
        """
        # Get the scope invoice with links
        scope_invoice = self.db.query(WMScopeInvoice).options(
            joinedload(WMScopeInvoice.item_links)
        ).filter(
            WMScopeInvoice.id == scope_invoice_id
        ).first()

        if not scope_invoice:
            return False

        # Reset scope items' invoiced status
        for link in scope_invoice.item_links:
            scope_item = self.db.query(WMScopeItem).filter(
                WMScopeItem.id == link.scope_item_id
            ).first()
            if scope_item:
                scope_item.invoiced = False
                scope_item.invoiced_at = None

        # Delete links
        self.db.query(WMScopeItemInvoiceLink).filter(
            WMScopeItemInvoiceLink.wm_scope_invoice_id == scope_invoice_id
        ).delete()

        # Delete the scope invoice record
        self.db.delete(scope_invoice)
        self.db.commit()

        return True

    def delete_invoice_and_reset_scope(self, invoice_id: UUID) -> dict:
        """
        Delete an invoice that was generated from WM scope.
        Also resets the scope items' invoiced status.

        Args:
            invoice_id: Invoice ID

        Returns:
            Dict with deletion result
        """
        # Find the scope invoice linked to this invoice
        scope_invoice = self.db.query(WMScopeInvoice).filter(
            WMScopeInvoice.invoice_id == invoice_id
        ).first()

        if not scope_invoice:
            return {
                "success": False,
                "message": "No WM scope invoice found for this invoice"
            }

        scope_invoice_id = scope_invoice.id
        job_id = scope_invoice.job_id

        try:
            # Delete the actual invoice first (before resetting scope items)
            invoice = self.db.query(Invoice).filter(
                Invoice.id == invoice_id
            ).first()

            if invoice:
                # Delete invoice items first
                self.db.query(InvoiceItem).filter(
                    InvoiceItem.invoice_id == invoice_id
                ).delete()

                # Delete any receipts linked to this invoice
                from app.domains.receipt.models import Receipt
                self.db.query(Receipt).filter(
                    Receipt.invoice_id == invoice_id
                ).delete()

                # Delete any sketches linked to this invoice
                from app.domains.sketch.models import Sketch
                self.db.query(Sketch).filter(
                    Sketch.invoice_id == invoice_id
                ).update({Sketch.invoice_id: None})

                # Now delete the invoice
                self.db.delete(invoice)

            # Reset scope items and delete scope invoice
            # Get the scope invoice with links
            scope_invoice_loaded = self.db.query(WMScopeInvoice).options(
                joinedload(WMScopeInvoice.item_links)
            ).filter(
                WMScopeInvoice.id == scope_invoice_id
            ).first()

            if scope_invoice_loaded:
                # Reset scope items' invoiced status
                for link in scope_invoice_loaded.item_links:
                    scope_item = self.db.query(WMScopeItem).filter(
                        WMScopeItem.id == link.scope_item_id
                    ).first()
                    if scope_item:
                        scope_item.invoiced = False
                        scope_item.invoiced_at = None

                # Delete links
                self.db.query(WMScopeItemInvoiceLink).filter(
                    WMScopeItemInvoiceLink.wm_scope_invoice_id == scope_invoice_id
                ).delete()

                # Delete the scope invoice record
                self.db.delete(scope_invoice_loaded)

            self.db.commit()

            logger.info(f"Successfully deleted invoice {invoice_id} and reset scope items for job {job_id}")

            return {
                "success": True,
                "message": "Invoice deleted and scope items reset",
                "job_id": str(job_id),
                "items_reset": True
            }

        except Exception as e:
            self.db.rollback()
            logger.error(f"Failed to delete invoice {invoice_id}: {str(e)}")
            return {
                "success": False,
                "message": f"Failed to delete invoice: {str(e)}"
            }

    def reset_scope_items_for_job(self, job_id: UUID) -> dict:
        """
        Reset all scope items' invoiced status for a job.
        Use this when an invoice was deleted outside of WM flow.

        Args:
            job_id: Water mitigation job ID

        Returns:
            Dict with reset result
        """
        logger.info(f"Resetting scope items for job {job_id}")

        # First, delete all WMScopeItemInvoiceLink records for this job's scope items
        # Get scope item IDs for this job
        scope_item_ids = self.db.query(WMScopeItem.id).join(
            WMScopeLocation
        ).filter(
            WMScopeLocation.job_id == job_id
        ).all()
        scope_item_id_list = [str(sid[0]) for sid in scope_item_ids]
        logger.info(f"Found {len(scope_item_id_list)} scope items to reset")

        # Delete invoice links
        if scope_item_id_list:
            deleted_links = self.db.query(WMScopeItemInvoiceLink).filter(
                WMScopeItemInvoiceLink.scope_item_id.in_(
                    [UUID(sid) for sid in scope_item_id_list]
                )
            ).delete(synchronize_session='fetch')
            logger.info(f"Deleted {deleted_links} invoice links")

        # Delete scope invoices for this job
        deleted_invoices = self.db.query(WMScopeInvoice).filter(
            WMScopeInvoice.job_id == job_id
        ).delete(synchronize_session='fetch')
        logger.info(f"Deleted {deleted_invoices} scope invoices")

        # Flush the deletes before updating scope items
        self.db.flush()

        # Now reset all scope items' invoiced status using direct update
        # This is more reliable than iterating through ORM objects
        reset_count = self.db.query(WMScopeItem).filter(
            WMScopeItem.id.in_([UUID(sid) for sid in scope_item_id_list]),
            WMScopeItem.invoiced.is_(True)
        ).update(
            {"invoiced": False, "invoiced_at": None},
            synchronize_session='fetch'
        )
        logger.info(f"Reset {reset_count} scope items invoiced status")

        self.db.commit()

        return {
            "success": True,
            "items_reset": reset_count,
            "message": f"Reset {reset_count} scope items"
        }
