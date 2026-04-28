"""
Water Mitigation Invoice Item Configuration Service

Service for managing invoice item configurations.

This service provides two approaches for invoice configuration:
1. Standard Scope Item Mapping (Recommended):
   - Pre-configure line item mappings at the Standard Scope Item level
   - Auto-generate invoice configs for a job using these mappings
   - Avoids duplicate configurations when same item type appears in multiple locations

2. Per-Scope-Item Configuration (Legacy):
   - Configure each scope item individually per job
   - More flexible but can lead to duplicate configuration work
"""

import logging
from decimal import Decimal
from typing import List, Optional, Tuple, Dict, Any
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.domains.water_mitigation.models import (
    WaterMitigationJob,
    WMScopeLocation,
    WMScopeItem,
    WMInvoiceItemConfig,
    WMStandardScopeItem,
    WMDebrisCalculation,
)
from app.domains.line_items.models import LineItemTemplate
from app.domains.water_mitigation.invoice_calculation_config import (
    GENERAL_CONDITIONS_TEMPLATE_ID,
    calculate_general_conditions_quantity,
    get_calculation_function,
    should_include_general_conditions_item,
)

logger = logging.getLogger(__name__)

# =====================================================
# Sketch scope item name → Standard Scope Item name
# Resolves naming mismatches between sketch-generated
# scope items and admin-configured standard scope items.
# =====================================================
_SCOPE_STANDARD_ALIASES: Dict[str, str] = {
    "wall/drywall": "drywall - wall",
    "wall/drywall (drywall)": "drywall - wall",
    "wall - drywall 2ft": "drywall - 2ft",
    "wall - drywall 2ft (drywall)": "drywall - 2ft",
    "wall - drywall 2ft (plaster)": "drywall - 2ft",
    "wall - drywall 2ft (wall panel)": "drywall - 2ft",
    "wall - drywall 4ft": "drywall - 4ft",
    "wall - drywall 4ft (drywall)": "drywall - 4ft",
    "wall - drywall 4ft (plaster)": "drywall - 4ft",
    "wall - drywall 4ft (wall panel)": "drywall - 4ft",
    "wall - drywall 4ft (wood panel)": "drywall - 4ft",
    "containment": "containment barrier",
    "containment zipper": "containment zipper",
    "stair tread demo": "stair tread removal",
}

# =====================================================
# Scope item → line item keyword matching
# Used as 3rd-tier fallback when Standard Scope Item
# and template fuzzy matching both fail.
# Each entry: (include_keywords, exclude_keywords)
# All include keywords must appear; any exclude keyword
# disqualifies the candidate.
# =====================================================
_SCOPE_LINE_ITEM_ALIASES: Dict[str, Tuple[List[str], List[str]]] = {
    # --- Demolition: Wall/Drywall ---
    "wall/drywall": (
        ["tear out", "drywall"],
        ["2'", "4'", "per lf"],
    ),
    "wall/drywall (drywall)": (
        ["tear out", "drywall"],
        ["2'", "4'", "per lf"],
    ),
    "wall - drywall 2ft": (
        ["tear out", "drywall", "2"],
        [],
    ),
    "wall - drywall 2ft (drywall)": (
        ["tear out", "drywall", "2"],
        [],
    ),
    "wall - drywall 4ft": (
        ["tear out", "drywall", "4"],
        [],
    ),
    "wall - drywall 4ft (drywall)": (
        ["tear out", "drywall", "4"],
        [],
    ),
    "wall - drywall 4ft (plaster)": (
        ["tear out", "drywall", "4"],
        [],
    ),
    "wall - drywall 4ft (wall panel)": (
        ["tear out", "drywall", "4"],
        [],
    ),
    "wall - drywall 4ft (wood panel)": (
        ["tear out", "drywall", "4"],
        [],
    ),
    # --- Demolition: Wood Floor sub-types ---
    "wood floor (lvp)": (
        ["tear out", "lvp"],
        [],
    ),
    "wood floor (laminate)": (
        ["tear out", "floating floor"],
        [],
    ),
    "wood floor (hardwood)": (
        ["tear out", "hardwood"],
        [],
    ),
    "wood floor (engineered wood)": (
        ["tear out", "wood floor"],
        ["floating", "lvp"],
    ),
    # --- Stair ---
    "stair tread demo": (
        ["stair", "tread", "remov"],
        [],
    ),
    # --- Containment ---
    "containment": (
        ["containment", "barrier"],
        ["zipper", "peel", "seal"],
    ),
    "containment zipper": (
        ["zipper"],
        ["containment barrier"],
    ),
}


class InvoiceConfigService:
    """Service for managing invoice item configurations"""

    def __init__(self, db: Session):
        self.db = db

    def get_invoice_item_configs(
        self, job_id: UUID, include_calculated: bool = True
    ) -> List[Dict[str, Any]]:
        """Get all invoice item configurations for a job"""
        # Expire all cached objects to ensure we get fresh data (especially line item prices)
        self.db.expire_all()

        job = self.db.query(WaterMitigationJob).filter(
            WaterMitigationJob.id == job_id
        ).first()

        if not job:
            return []

        mitigation_days = self._calculate_mitigation_days(job)

        configs = self.db.query(WMInvoiceItemConfig).options(
            joinedload(WMInvoiceItemConfig.scope_item).joinedload(WMScopeItem.location),
            joinedload(WMInvoiceItemConfig.line_item),
            joinedload(WMInvoiceItemConfig.standard_scope_item),
        ).filter(
            WMInvoiceItemConfig.job_id == job_id
        ).order_by(
            WMInvoiceItemConfig.display_order
        ).all()

        result = []
        for config in configs:
            config_dict = {
                "id": config.id,
                "job_id": config.job_id,
                "scope_item_id": config.scope_item_id,
                "line_item_id": config.line_item_id,
                "custom_name": config.custom_name,
                "custom_rate": float(config.custom_rate) if config.custom_rate else None,
                "custom_unit": config.custom_unit,
                "quantity_calc_type": config.quantity_calc_type,
                "max_days": config.max_days,
                "default_note": config.default_note,
                "is_enabled": config.is_enabled,
                "display_order": config.display_order,
            }

            if config.scope_item:
                config_dict.update({
                    "scope_item_name": config.scope_item.name,
                    "scope_item_quantity": float(config.scope_item.quantity) if config.scope_item.quantity else None,
                    "scope_item_unit": config.scope_item.unit,
                    "location_name": config.scope_item.location.name if config.scope_item.location else None,
                })

            if config.line_item:
                config_dict.update({
                    "line_item_description": config.line_item.description,
                    "line_item_rate": float(config.line_item.untaxed_unit_price) if config.line_item.untaxed_unit_price else None,
                })
            elif config.custom_name:
                config_dict.update({
                    "line_item_description": config.custom_name,
                    "line_item_rate": float(config.custom_rate) if config.custom_rate else None,
                })

            if include_calculated:
                rate = config_dict.get("line_item_rate") or 0

                if config.scope_item:
                    # Scope item-based config - calculate quantity dynamically
                    base_qty = float(config.scope_item.quantity) if config.scope_item.quantity else 0
                    calc_qty, calc_note = self._calculate_quantity(
                        base_qty, config.quantity_calc_type, mitigation_days, config.max_days
                    )

                    # Process default_note template with placeholders
                    processed_note = config.default_note
                    if processed_note:
                        # Replace placeholders with actual values
                        processed_note = processed_note.replace("{qty}", str(int(base_qty)))
                        processed_note = processed_note.replace("{days}", str(mitigation_days))
                        # Also support variations
                        processed_note = processed_note.replace("{quantity}", str(int(base_qty)))
                        processed_note = processed_note.replace("{wm_days}", str(mitigation_days))
                        # Handle singular/plural for Unit(s) placeholder
                        # e.g., "1 Unit(s) @ 3 days" -> "1 Unit @ 3 days"
                        # e.g., "13 Unit(s) @ 3 days" -> "13 Units @ 3 days"
                        if "Unit(s)" in processed_note:
                            unit_text = "Unit" if int(base_qty) == 1 else "Units"
                            processed_note = processed_note.replace("Unit(s)", unit_text)

                    config_dict.update({
                        "calculated_quantity": calc_qty,
                        "calculation_note": calc_note,
                        "effective_rate": rate,
                        "calculated_amount": calc_qty * rate,
                        "default_note": processed_note,  # Override with processed note
                    })
                else:
                    # General Conditions item (no scope_item) - use pre-calculated quantity
                    calc_qty = float(config.calculated_quantity) if config.calculated_quantity else 1.0
                    calc_note = config.default_note or ""

                    # For General Conditions items, determine name and unit from line_item or custom fields
                    if config.line_item:
                        gc_name = config.line_item.description
                        gc_unit = config.line_item.unit or "HR"
                        gc_rate = float(config.line_item.untaxed_unit_price) if config.line_item.untaxed_unit_price else 0
                    elif config.custom_name:
                        gc_name = config.custom_name
                        gc_unit = config.custom_unit or "EA"
                        gc_rate = float(config.custom_rate) if config.custom_rate else 0
                    else:
                        gc_name = "Unknown GC Item"
                        gc_unit = "EA"
                        gc_rate = 0

                    config_dict.update({
                        "scope_item_name": f"[GC] {gc_name}",
                        "scope_item_quantity": calc_qty,
                        "scope_item_unit": gc_unit,
                        "location_name": "General Conditions",
                        "line_item_description": gc_name,
                        "line_item_rate": gc_rate,
                    })

                    # Override rate with the GC rate
                    rate = gc_rate

                    config_dict.update({
                        "calculated_quantity": calc_qty,
                        "calculation_note": calc_note,
                        "effective_rate": rate,
                        "calculated_amount": calc_qty * rate,
                        "is_general_condition": True,
                    })

            result.append(config_dict)

        return result

    def create_invoice_item_config(self, config_data) -> Dict[str, Any]:
        """Create a new invoice item configuration"""
        config = WMInvoiceItemConfig(
            job_id=config_data.job_id,
            scope_item_id=config_data.scope_item_id,
            line_item_id=config_data.line_item_id,
            custom_name=config_data.custom_name,
            custom_rate=Decimal(str(config_data.custom_rate)) if config_data.custom_rate else None,
            custom_unit=config_data.custom_unit,
            quantity_calc_type=config_data.quantity_calc_type,
            max_days=config_data.max_days,
            default_note=config_data.default_note,
            is_enabled=config_data.is_enabled,
            display_order=config_data.display_order,
        )

        self.db.add(config)
        self.db.commit()
        self.db.refresh(config)

        return {"id": config.id, "job_id": config.job_id, "scope_item_id": config.scope_item_id}

    def update_invoice_item_config(self, config_id: UUID, update_data) -> Optional[Dict[str, Any]]:
        """Update an invoice item configuration"""
        config = self.db.query(WMInvoiceItemConfig).filter(WMInvoiceItemConfig.id == config_id).first()
        if not config:
            return None

        update_dict = update_data.dict(exclude_unset=True)
        for key, value in update_dict.items():
            if key == "custom_rate" and value is not None:
                value = Decimal(str(value))
            setattr(config, key, value)

        self.db.commit()
        self.db.refresh(config)
        return {"id": config.id, "updated": True}

    def delete_invoice_item_config(self, config_id: UUID) -> bool:
        """Delete an invoice item configuration"""
        config = self.db.query(WMInvoiceItemConfig).filter(WMInvoiceItemConfig.id == config_id).first()
        if not config:
            return False

        self.db.delete(config)
        self.db.commit()
        return True

    def auto_generate_invoice_configs(
        self,
        job_id: UUID,
        template_id: UUID,
        overwrite: bool = False,
        include_general_conditions: bool = True
    ) -> Dict[str, Any]:
        """
        Auto-generate invoice item configurations based on scope items.

        NEW: First checks Standard Scope Item mappings for pre-configured line item associations.
        Falls back to template name matching only if no standard mapping exists.

        Args:
            job_id: Water mitigation job ID
            template_id: Line item template ID (e.g., WM Essentials)
            overwrite: Whether to overwrite existing configs
            include_general_conditions: Whether to auto-include General Conditions items
        """
        # Expire all cached objects to ensure we get fresh data (especially line item prices)
        self.db.expire_all()

        EQUIPMENT_KEYWORDS = ["air mover", "dehumidifier", "air scrubber", "fan", "blower", "equipment", "monitoring"]

        job = self.db.query(WaterMitigationJob).filter(WaterMitigationJob.id == job_id).first()
        if not job:
            raise ValueError(f"Job not found: {job_id}")

        from app.domains.line_items.models import TemplateLineItem

        template = self.db.query(LineItemTemplate).options(
            joinedload(LineItemTemplate.template_items).joinedload(TemplateLineItem.line_item)
        ).filter(LineItemTemplate.id == template_id).first()

        if not template:
            raise ValueError(f"Template not found: {template_id}")

        # =====================================================
        # Step 1: Build Standard Scope Item mapping dictionary
        # This is the PRIMARY source for line item mappings
        # =====================================================
        standard_mappings: Dict[str, WMStandardScopeItem] = {}

        # Get company_id from job for company-specific mappings
        company_id = job.company_id

        standard_items_query = self.db.query(WMStandardScopeItem).options(
            joinedload(WMStandardScopeItem.line_item)
        ).filter(WMStandardScopeItem.is_active == True)

        if company_id:
            standard_items_query = standard_items_query.filter(
                (WMStandardScopeItem.company_id == None) |
                (WMStandardScopeItem.company_id == company_id)
            )
        else:
            standard_items_query = standard_items_query.filter(
                WMStandardScopeItem.company_id == None
            )

        for std_item in standard_items_query.all():
            standard_mappings[std_item.name.lower().strip()] = std_item

        logger.info(f"[AutoGenerate] Loaded {len(standard_mappings)} Standard Scope Item mappings")

        # =====================================================
        # Step 2: Build template rate map (fallback source)
        # =====================================================
        template_rate_map = {}
        for tli in template.template_items:
            if tli.line_item:
                # Reference mode - use line_item_id
                name_key = tli.line_item.description.lower().strip()
                template_rate_map[name_key] = {
                    "line_item_id": tli.line_item.id,
                    "template_item_id": tli.id
                }
            elif tli.embedded_data:
                # Embedded mode - store embedded data for custom rate
                embedded = tli.embedded_data
                name_key = embedded.get("description", "").lower().strip()
                if name_key:
                    template_rate_map[name_key] = {
                        "template_item_id": tli.id,
                        "custom_name": embedded.get("description"),
                        "custom_rate": embedded.get("rate"),
                        "custom_unit": embedded.get("unit")
                    }
                # Also map by item_code if available
                item_code = embedded.get("item_code", "").lower().strip()
                if item_code and item_code != name_key:
                    template_rate_map[item_code] = {
                        "template_item_id": tli.id,
                        "custom_name": embedded.get("description"),
                        "custom_rate": embedded.get("rate"),
                        "custom_unit": embedded.get("unit")
                    }

        locations = self.db.query(WMScopeLocation).options(
            joinedload(WMScopeLocation.scope_items)
        ).filter(WMScopeLocation.job_id == job_id).all()

        if overwrite:
            self.db.query(WMInvoiceItemConfig).filter(WMInvoiceItemConfig.job_id == job_id).delete()

        created_count, matched_count = 0, 0
        unmatched_items = []

        for location in locations:
            for scope_item in location.scope_items:
                if not overwrite:
                    existing = self.db.query(WMInvoiceItemConfig).filter(
                        WMInvoiceItemConfig.job_id == job_id,
                        WMInvoiceItemConfig.scope_item_id == scope_item.id
                    ).first()
                    if existing:
                        continue

                item_name_lower = scope_item.name.lower().strip()
                logger.info(
                    f"[AutoGenerate] Processing scope item: "
                    f"'{scope_item.name}' (lower='{item_name_lower}')"
                )

                # =====================================================
                # Step 3: Check Standard Scope Item mapping FIRST
                # Order: exact → alias → fuzzy substring
                # =====================================================
                std_item = standard_mappings.get(item_name_lower)

                # Try alias lookup (handles sketch name mismatches)
                if not std_item:
                    alias_std = _SCOPE_STANDARD_ALIASES.get(
                        item_name_lower
                    )
                    if alias_std:
                        std_item = standard_mappings.get(alias_std)
                        if std_item:
                            logger.info(
                                f"[AutoGenerate] STD ALIAS: "
                                f"'{item_name_lower}' → "
                                f"'{alias_std}'"
                            )

                # Try fuzzy match if exact/alias not found
                if not std_item:
                    for std_name, std in standard_mappings.items():
                        if item_name_lower in std_name or std_name in item_name_lower:
                            std_item = std
                            break

                # Check if standard item has a mapping configured
                std_mapping_found = False
                if std_item and (std_item.line_item_id or std_item.custom_line_item_name):
                    std_mapping_found = True
                    logger.info(f"[AutoGenerate] STD MATCH: '{scope_item.name}' → line_item_id={std_item.line_item_id}")

                # =====================================================
                # Step 4: Fall back to template matching if no standard mapping
                # Order: exact → keyword alias → fuzzy substring
                # =====================================================
                template_matched = None
                if not std_mapping_found:
                    # 4a: Exact match by name
                    template_matched = template_rate_map.get(
                        item_name_lower
                    )

                    # 4b: Keyword alias match (precise, takes priority
                    #     over fuzzy to avoid mis-matches)
                    if not template_matched:
                        alias = _SCOPE_LINE_ITEM_ALIASES.get(
                            item_name_lower
                        )
                        if alias:
                            inc_kw, exc_kw = alias
                            for key, val in template_rate_map.items():
                                if (
                                    all(k in key for k in inc_kw)
                                    and not any(
                                        k in key for k in exc_kw
                                    )
                                ):
                                    template_matched = val
                                    logger.info(
                                        f"[AutoGenerate] ALIAS "
                                        f"match: "
                                        f"{scope_item.name} → {key}"
                                    )
                                    break

                    # 4c: Fuzzy substring match (last resort)
                    if not template_matched:
                        for key, val in template_rate_map.items():
                            if (
                                item_name_lower in key
                                or key in item_name_lower
                            ):
                                template_matched = val
                                break

                # Log match result
                if std_mapping_found:
                    logger.info(
                        f"[AutoGenerate] '{scope_item.name}' → "
                        f"StandardScopeItem (line_item_id="
                        f"{std_item.line_item_id})"
                    )
                elif template_matched:
                    logger.info(
                        f"[AutoGenerate] '{scope_item.name}' → "
                        f"Template match: {template_matched}"
                    )
                else:
                    logger.info(
                        f"[AutoGenerate] '{scope_item.name}' → "
                        f"NO MATCH"
                    )

                # Determine calculation type
                is_equipment = any(kw in item_name_lower for kw in EQUIPMENT_KEYWORDS)

                # Use standard item's calc type if available, otherwise default
                if std_item and std_item.quantity_calc_type:
                    calc_type = std_item.quantity_calc_type
                else:
                    calc_type = "per_day" if is_equipment else "fixed"

                # =====================================================
                # Step 5: Build config based on match source
                # =====================================================
                config_kwargs = {
                    "job_id": job_id,
                    "scope_item_id": scope_item.id,
                    "quantity_calc_type": calc_type,
                    "is_enabled": True,
                    "display_order": created_count,
                }

                # Add max_days if using standard item with capped calculation
                if std_item and std_item.max_days and calc_type == "per_day_capped":
                    config_kwargs["max_days"] = std_item.max_days

                # Add default note from standard item
                if std_item and std_item.default_invoice_note:
                    config_kwargs["default_note"] = std_item.default_invoice_note
                # Auto-generate demolition material note
                elif "drywall" in item_name_lower:
                    if "wall" in item_name_lower:
                        config_kwargs["default_note"] = "wall"
                    elif "ceiling" in item_name_lower:
                        config_kwargs["default_note"] = "ceiling"
                elif "baseboard" in item_name_lower:
                    if "quarter round" in item_name_lower:
                        config_kwargs["default_note"] = (
                            "baseboard + quarter round"
                        )
                    else:
                        config_kwargs["default_note"] = "baseboard"
                elif "quarter round" in item_name_lower:
                    config_kwargs["default_note"] = "quarter round"
                # Auto-generate equipment note if not already set
                elif is_equipment and not config_kwargs.get("default_note"):
                    # Use placeholder format: {qty} Unit(s) @ {days} days
                    # The Unit(s) will be replaced with "Unit" or "Units" during invoice generation
                    # Different notes for different equipment types
                    item_name_lower = scope_item.name.lower()

                    if "air mover" in item_name_lower:
                        config_kwargs["default_note"] = (
                            "{qty} Unit(s) @ {days} days\n"
                            "Excludes: HEPA filter and setup, take down, and monitoring."
                        )
                    elif "air scrubber" in item_name_lower:
                        config_kwargs["default_note"] = (
                            "{qty} Unit(s) @ {days} days\n"
                            "Excludes: Set-up, take down, and monitoring.\n"
                            "Air Scrubber with HEPA and carbon filters use of an Air scrubber for a whole day"
                        )
                    elif "dehumidifier" in item_name_lower:
                        config_kwargs["default_note"] = (
                            "{qty} Unit(s) @ {days} days\n"
                            "Excludes: Set-up, take down, and monitoring."
                        )
                    else:
                        # Generic equipment note
                        config_kwargs["default_note"] = "{qty} Unit(s) @ {days} days"

                matched = False

                if std_mapping_found:
                    # Use Standard Scope Item mapping (PRIORITY)
                    if std_item.line_item_id:
                        config_kwargs["line_item_id"] = std_item.line_item_id
                    elif std_item.custom_line_item_name:
                        config_kwargs["custom_name"] = std_item.custom_line_item_name
                        config_kwargs["custom_rate"] = std_item.custom_line_item_rate
                        config_kwargs["custom_unit"] = std_item.unit
                    matched = True
                elif template_matched:
                    # Use template matching (FALLBACK)
                    if "line_item_id" in template_matched:
                        config_kwargs["line_item_id"] = template_matched["line_item_id"]
                    else:
                        config_kwargs["custom_name"] = template_matched.get("custom_name")
                        config_kwargs["custom_rate"] = Decimal(str(template_matched.get("custom_rate", 0))) if template_matched.get("custom_rate") else None
                        config_kwargs["custom_unit"] = template_matched.get("custom_unit")
                    matched = True

                config = WMInvoiceItemConfig(**config_kwargs)
                self.db.add(config)
                created_count += 1
                if matched:
                    matched_count += 1
                else:
                    unmatched_items.append(scope_item.name)

        self.db.commit()
        logger.info(f"[AutoGenerate] Created {created_count} configs, {matched_count} matched, {len(unmatched_items)} unmatched")

        # =====================================================
        # Step 6: Add General Conditions items (once per invoice)
        # =====================================================
        gc_created = 0
        gc_calculated = 0
        if include_general_conditions:
            gc_result = self._add_general_conditions_items(job_id, overwrite)
            gc_created = gc_result.get("created_count", 0)
            gc_calculated = gc_result.get("calculated_count", 0)
            logger.info(f"[AutoGenerate] Added {gc_created} General Conditions items, {gc_calculated} auto-calculated")

        return {
            "success": True,
            "created_count": created_count,
            "matched_count": matched_count,
            "unmatched_items": unmatched_items,
            "general_conditions_created": gc_created,
            "general_conditions_calculated": gc_calculated,
        }

    def preview_invoice(self, job_id: UUID, template_id: UUID) -> Dict[str, Any]:
        """Preview invoice generation without creating"""
        job = self.db.query(WaterMitigationJob).filter(WaterMitigationJob.id == job_id).first()
        if not job:
            raise ValueError(f"Job not found: {job_id}")

        mitigation_days = self._calculate_mitigation_days(job)
        configs = self.get_invoice_item_configs(job_id, include_calculated=True)

        from app.domains.line_items.models import TemplateLineItem

        template = self.db.query(LineItemTemplate).options(
            joinedload(LineItemTemplate.template_items).joinedload(TemplateLineItem.line_item)
        ).filter(LineItemTemplate.id == template_id).first()

        template_rate_map = {}
        if template:
            for tli in template.template_items:
                if tli.line_item:
                    template_rate_map[tli.line_item.description.lower().strip()] = tli.line_item.untaxed_unit_price or Decimal("0")

        items, subtotal, unmapped_items = [], Decimal("0"), []

        for config in configs:
            if not config.get("is_enabled"):
                continue

            rate = Decimal(str(config.get("effective_rate") or 0))
            if rate == 0 and config.get("scope_item_name"):
                rate = template_rate_map.get(config["scope_item_name"].lower().strip(), Decimal("0"))
                if rate == 0:
                    unmapped_items.append(config["scope_item_name"])

            calc_qty = Decimal(str(config.get("calculated_quantity") or 0))
            amount = calc_qty * rate

            items.append({
                "scope_item_name": config.get("scope_item_name") or "Unknown",
                "location_name": config.get("location_name") or "",
                "line_item_description": config.get("line_item_description") or config.get("scope_item_name") or "Unknown",
                "base_quantity": float(config.get("scope_item_quantity") or 0),
                "calculated_quantity": float(calc_qty),
                "calculation_note": config.get("calculation_note") or "",
                "unit": config.get("scope_item_unit") or "EA",
                "rate": float(rate),
                "amount": float(amount),
                "default_note": config.get("default_note"),
            })
            subtotal += amount

        return {
            "items": items,
            "subtotal": float(subtotal),
            "total": float(subtotal),
            "mitigation_days": mitigation_days,
            "mitigation_start": job.mitigation_start_date,
            "mitigation_end": job.mitigation_end_date,
            "unmapped_items": unmapped_items,
        }

    def _calculate_mitigation_days(self, job: WaterMitigationJob) -> int:
        """Calculate the number of mitigation days"""
        if job.mitigation_start_date and job.mitigation_end_date:
            delta = job.mitigation_end_date - job.mitigation_start_date
            return max(1, delta.days + 1)
        return 1

    def _gather_scope_data_for_calculations(self, job_id: UUID) -> Dict[str, Any]:
        """
        Gather scope data needed for General Conditions calculations.

        Returns:
            Dictionary with:
            - total_debris_ton: Total debris weight in tons
            - has_stairs: Whether any location has stairs
            - primary_location: Primary location name for notes
            - equipment_items: List of equipment items with quantities
            - floor_count: Number of unique floors
            - debris_floors: Set of floor names where debris items exist
        """
        # Get debris calculation if exists
        debris_calc = self.db.query(WMDebrisCalculation).filter(
            WMDebrisCalculation.job_id == job_id
        ).first()

        total_debris_ton = Decimal("0")
        bag_count = 0
        if debris_calc and debris_calc.total_weight_ton:
            total_debris_ton = debris_calc.total_weight_ton
        if debris_calc and debris_calc.bag_count:
            bag_count = debris_calc.bag_count

        # Get all locations and scope items
        locations = self.db.query(WMScopeLocation).options(
            joinedload(WMScopeLocation.scope_items)
        ).filter(WMScopeLocation.job_id == job_id).all()

        # Check for stairs (check if any location has "stair" in name or description)
        has_stairs = False
        primary_location = "the property"
        floors = set()
        debris_floors = set()

        for location in locations:
            # Check for stairs indicators
            location_text = f"{location.name or ''} {location.description or ''}".lower()
            if "stair" in location_text or "2nd floor" in location_text or "basement" in location_text:
                has_stairs = True

            # Track floors
            if location.floor:
                floors.add(location.floor)

            # Track floors with debris items
            has_debris_in_location = False
            for scope_item in location.scope_items:
                # Check if this is a demolition/debris item
                if (scope_item.item_type == "demolition" or
                    scope_item.include_in_debris or
                    scope_item.material_weight_id):
                    has_debris_in_location = True
                    break

            if has_debris_in_location and location.floor:
                # Normalize floor names for consistency
                floor_normalized = self._normalize_floor_name(location.floor)
                debris_floors.add(floor_normalized)

            # Use first location as primary
            if location == locations[0]:
                primary_location = location.name or "the property"

        # Gather equipment items
        equipment_keywords = ["air mover", "dehumidifier", "air scrubber", "fan", "blower"]
        equipment_items = []

        for location in locations:
            for scope_item in location.scope_items:
                item_name_lower = scope_item.name.lower()
                if any(keyword in item_name_lower for keyword in equipment_keywords):
                    equipment_items.append({
                        "name": scope_item.name,
                        "quantity": float(scope_item.quantity or 0)
                    })

        return {
            "total_debris_ton": total_debris_ton,
            "bag_count": bag_count,
            "has_stairs": has_stairs,
            "primary_location": primary_location,
            "equipment_items": equipment_items,
            "floor_count": len(floors) if floors else 1,
            "debris_floors": debris_floors,
        }

    def _normalize_floor_name(self, floor: str) -> str:
        """
        Normalize floor name for consistent display.

        Examples:
        - "1st Floor" -> "ground floor"
        - "2nd Floor" -> "2nd floor"
        - "Basement" -> "basement"
        """
        floor_lower = floor.lower().strip()

        # Ground floor variations
        if any(term in floor_lower for term in ["1st", "first", "main", "ground"]):
            return "ground floor"

        # Basement variations
        if "basement" in floor_lower or "bsmt" in floor_lower:
            return "basement"

        # Upper floors
        if "2nd" in floor_lower or "second" in floor_lower:
            return "2nd floor"

        if "3rd" in floor_lower or "third" in floor_lower:
            return "3rd floor"

        # Default - return as-is if can't normalize
        return floor_lower

    def _add_general_conditions_items(self, job_id: UUID, overwrite: bool = False) -> Dict[str, Any]:
        """
        Add General Conditions template items to the invoice configuration.

        These items appear once per invoice (not per scope item):
        - Auto-calculates quantities for specific items (debris disposal, equipment monitoring)
        - Includes all other General Conditions items with quantity 1

        Returns:
            Dictionary with created_count and calculated_count
        """
        from app.domains.line_items.models import TemplateLineItem

        # Get General Conditions template
        gc_template = self.db.query(LineItemTemplate).options(
            joinedload(LineItemTemplate.template_items).joinedload(TemplateLineItem.line_item)
        ).filter(LineItemTemplate.id == GENERAL_CONDITIONS_TEMPLATE_ID).first()

        if not gc_template:
            logger.warning(f"General Conditions template not found: {GENERAL_CONDITIONS_TEMPLATE_ID}")
            return {"created_count": 0, "calculated_count": 0}

        # Get job for mitigation days calculation
        job = self.db.query(WaterMitigationJob).filter(WaterMitigationJob.id == job_id).first()
        if not job:
            return {"created_count": 0, "calculated_count": 0}

        mitigation_days = self._calculate_mitigation_days(job)

        # Gather scope data for calculations
        scope_data = self._gather_scope_data_for_calculations(job_id)
        job_data = {"mitigation_days": mitigation_days}

        created_count = 0
        calculated_count = 0

        # Get max display_order for proper ordering
        max_order_result = self.db.query(func.max(WMInvoiceItemConfig.display_order)).filter(
            WMInvoiceItemConfig.job_id == job_id
        ).scalar()
        display_order = (max_order_result or 0) + 1

        for tli in gc_template.template_items:
            # Handle both reference mode (line_item_id) and embedded mode (embedded_data)
            line_item_id = None
            line_item_description = None
            line_item_rate = None
            line_item_unit = None

            if tli.line_item:
                # Reference mode - use linked line item
                line_item_id = tli.line_item.id
                line_item_description = tli.line_item.description
                line_item_rate = tli.line_item.untaxed_unit_price
                line_item_unit = tli.line_item.unit
            elif tli.embedded_data:
                # Embedded mode - use embedded data
                embedded = tli.embedded_data
                line_item_description = embedded.get("description", "")
                line_item_rate = Decimal(str(embedded.get("rate", 0))) if embedded.get("rate") else None
                line_item_unit = embedded.get("unit", "EA")
            else:
                continue  # Skip items with neither

            if not line_item_description:
                continue

            # Check if should include this item
            if not should_include_general_conditions_item(line_item_description):
                continue

            # Check if already exists (unless overwrite)
            # For embedded items, check by custom_name instead of line_item_id
            if not overwrite:
                if line_item_id:
                    existing = self.db.query(WMInvoiceItemConfig).filter(
                        WMInvoiceItemConfig.job_id == job_id,
                        WMInvoiceItemConfig.line_item_id == line_item_id,
                        WMInvoiceItemConfig.scope_item_id == None
                    ).first()
                else:
                    existing = self.db.query(WMInvoiceItemConfig).filter(
                        WMInvoiceItemConfig.job_id == job_id,
                        WMInvoiceItemConfig.custom_name == line_item_description,
                        WMInvoiceItemConfig.scope_item_id == None
                    ).first()
                if existing:
                    continue

            # Try to calculate quantity
            calc_quantity, calc_note = calculate_general_conditions_quantity(
                line_item_description,
                job_data,
                scope_data
            )

            # Create config
            config_kwargs = {
                "job_id": job_id,
                "scope_item_id": None,  # General Conditions are not tied to specific scope items
                "is_enabled": True,
                "display_order": display_order,
            }

            # Set line_item_id or custom fields based on item type
            if line_item_id:
                config_kwargs["line_item_id"] = line_item_id
            else:
                # Embedded item - use custom fields
                config_kwargs["custom_name"] = line_item_description
                config_kwargs["custom_rate"] = line_item_rate
                config_kwargs["custom_unit"] = line_item_unit

            if calc_quantity is not None and calc_quantity > 0 and calc_note:
                # Auto-calculated quantity - store in calculated_quantity field
                config_kwargs["quantity_calc_type"] = "auto_calculated"
                config_kwargs["calculated_quantity"] = calc_quantity
                config_kwargs["default_note"] = calc_note
                calculated_count += 1
                logger.info(f"[GC] Auto-calculated {line_item_description}: {calc_quantity} HR")
            else:
                # Default to 1 unit for non-calculated items
                config_kwargs["quantity_calc_type"] = "fixed"
                config_kwargs["calculated_quantity"] = Decimal("1")  # Default quantity
                config_kwargs["default_note"] = f"General Conditions: {line_item_description}"

            config = WMInvoiceItemConfig(**config_kwargs)
            self.db.add(config)
            created_count += 1
            display_order += 1
            logger.info(f"[GC] Created config for: {line_item_description}")

        self.db.commit()

        return {
            "created_count": created_count,
            "calculated_count": calculated_count,
        }

    def _calculate_quantity(self, base_quantity: float, calc_type: str, mitigation_days: int, max_days: Optional[int] = None) -> Tuple[float, str]:
        """Calculate quantity based on calculation type."""
        if calc_type == "fixed":
            return base_quantity, f"{base_quantity}"
        elif calc_type == "per_day":
            calculated = base_quantity * mitigation_days
            return calculated, f"{base_quantity} x {mitigation_days} days = {calculated}"
        elif calc_type == "per_day_capped":
            days_to_use = min(mitigation_days, max_days) if max_days else mitigation_days
            calculated = base_quantity * days_to_use
            return calculated, f"{base_quantity} x {days_to_use} days = {calculated}"
        return base_quantity, f"{base_quantity}"

    # ========================================
    # Standard Scope Item Mapping Methods
    # ========================================

    def get_standard_scope_item_mappings(self, company_id: Optional[UUID] = None) -> List[Dict[str, Any]]:
        """
        Get all Standard Scope Items with their line item mappings.

        Returns both system-wide items (company_id=NULL) and company-specific items.
        Used to show pre-configured mappings in the UI.
        """
        from app.domains.line_items.models import LineItem

        query = self.db.query(WMStandardScopeItem).options(
            joinedload(WMStandardScopeItem.line_item),
            joinedload(WMStandardScopeItem.category_rel),
        ).filter(
            WMStandardScopeItem.is_active == True
        )

        # Get system-wide items and company-specific items
        if company_id:
            query = query.filter(
                (WMStandardScopeItem.company_id == None) |
                (WMStandardScopeItem.company_id == company_id)
            )
        else:
            query = query.filter(WMStandardScopeItem.company_id == None)

        items = query.order_by(WMStandardScopeItem.display_order).all()

        result = []
        for item in items:
            mapping = {
                "id": item.id,
                "name": item.name,
                "item_type": item.item_type,
                "unit": item.unit,
                "category_id": item.category_id,
                "category_name": item.category_rel.name if item.category_rel else None,
                "company_id": item.company_id,
                # Invoice mapping fields
                "line_item_id": item.line_item_id,
                "line_item_description": item.line_item.description if item.line_item else None,
                "line_item_rate": float(item.line_item.untaxed_unit_price) if item.line_item and item.line_item.untaxed_unit_price else None,
                "custom_line_item_name": item.custom_line_item_name,
                "custom_line_item_rate": float(item.custom_line_item_rate) if item.custom_line_item_rate else None,
                "quantity_calc_type": item.quantity_calc_type,
                "max_days": item.max_days,
                "default_invoice_note": item.default_invoice_note,
                # Computed field: has mapping?
                "has_mapping": bool(item.line_item_id or item.custom_line_item_name),
            }
            result.append(mapping)

        return result

    def update_standard_scope_item_mapping(
        self,
        standard_item_id: UUID,
        line_item_id: Optional[UUID] = None,
        custom_line_item_name: Optional[str] = None,
        custom_line_item_rate: Optional[float] = None,
        quantity_calc_type: Optional[str] = None,
        max_days: Optional[int] = None,
        default_invoice_note: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Update invoice mapping for a Standard Scope Item.

        This is the recommended way to set up invoice configurations:
        - Configure once at the standard item level
        - All jobs using this standard item will inherit the mapping
        """
        item = self.db.query(WMStandardScopeItem).filter(
            WMStandardScopeItem.id == standard_item_id
        ).first()

        if not item:
            return None

        # Update mapping fields
        if line_item_id is not None:
            item.line_item_id = line_item_id if line_item_id else None
            # Clear custom fields if using line_item_id
            if line_item_id:
                item.custom_line_item_name = None
                item.custom_line_item_rate = None

        if custom_line_item_name is not None:
            item.custom_line_item_name = custom_line_item_name if custom_line_item_name else None

        if custom_line_item_rate is not None:
            item.custom_line_item_rate = Decimal(str(custom_line_item_rate)) if custom_line_item_rate else None

        if quantity_calc_type is not None:
            item.quantity_calc_type = quantity_calc_type

        if max_days is not None:
            item.max_days = max_days if max_days > 0 else None

        if default_invoice_note is not None:
            item.default_invoice_note = default_invoice_note if default_invoice_note else None

        self.db.commit()
        self.db.refresh(item)

        return {
            "id": item.id,
            "name": item.name,
            "line_item_id": item.line_item_id,
            "custom_line_item_name": item.custom_line_item_name,
            "custom_line_item_rate": float(item.custom_line_item_rate) if item.custom_line_item_rate else None,
            "quantity_calc_type": item.quantity_calc_type,
            "max_days": item.max_days,
            "default_invoice_note": item.default_invoice_note,
            "updated": True,
        }

    def generate_invoice_preview_from_standard_mappings(
        self, job_id: UUID, company_id: Optional[UUID] = None
    ) -> Dict[str, Any]:
        """
        Generate invoice preview using Standard Scope Item mappings.

        This is the recommended approach:
        1. Get unique item types from the job's scope items
        2. Look up mappings from Standard Scope Items
        3. Aggregate quantities per item type across all locations
        4. Calculate totals using the mapped rates and calculation types
        """
        job = self.db.query(WaterMitigationJob).filter(
            WaterMitigationJob.id == job_id
        ).first()

        if not job:
            raise ValueError(f"Job not found: {job_id}")

        mitigation_days = self._calculate_mitigation_days(job)

        # Get all scope items for the job
        locations = self.db.query(WMScopeLocation).options(
            joinedload(WMScopeLocation.scope_items)
        ).filter(WMScopeLocation.job_id == job_id).all()

        # Aggregate quantities by item name (case-insensitive)
        # Structure: {item_name_lower: {"name": str, "total_quantity": Decimal, "unit": str, "locations": List[str]}}
        aggregated_items: Dict[str, Dict[str, Any]] = {}

        for location in locations:
            for scope_item in location.scope_items:
                name_lower = scope_item.name.lower().strip()

                if name_lower not in aggregated_items:
                    aggregated_items[name_lower] = {
                        "name": scope_item.name,
                        "total_quantity": Decimal("0"),
                        "unit": scope_item.unit,
                        "locations": [],
                    }

                qty = scope_item.quantity or Decimal("0")
                aggregated_items[name_lower]["total_quantity"] += qty
                aggregated_items[name_lower]["locations"].append(location.name)

        # Get Standard Scope Item mappings
        standard_items_query = self.db.query(WMStandardScopeItem).options(
            joinedload(WMStandardScopeItem.line_item)
        ).filter(WMStandardScopeItem.is_active == True)

        if company_id:
            standard_items_query = standard_items_query.filter(
                (WMStandardScopeItem.company_id == None) |
                (WMStandardScopeItem.company_id == company_id)
            )
        else:
            standard_items_query = standard_items_query.filter(
                WMStandardScopeItem.company_id == None
            )

        standard_items = standard_items_query.all()

        # Build mapping dictionary
        standard_mappings: Dict[str, WMStandardScopeItem] = {}
        for std_item in standard_items:
            standard_mappings[std_item.name.lower().strip()] = std_item

        # Generate invoice items
        items = []
        subtotal = Decimal("0")
        unmapped_items = []

        for name_lower, agg_data in aggregated_items.items():
            std_item = standard_mappings.get(name_lower)

            # Try fuzzy match if exact match not found
            if not std_item:
                for std_name, std in standard_mappings.items():
                    if name_lower in std_name or std_name in name_lower:
                        std_item = std
                        break

            base_qty = float(agg_data["total_quantity"])

            if std_item and (std_item.line_item_id or std_item.custom_line_item_name):
                # Has mapping - use standard item configuration
                calc_type = std_item.quantity_calc_type
                max_days = std_item.max_days

                calc_qty, calc_note = self._calculate_quantity(
                    base_qty, calc_type, mitigation_days, max_days
                )

                if std_item.line_item:
                    rate = float(std_item.line_item.untaxed_unit_price or 0)
                    description = std_item.line_item.description
                elif std_item.custom_line_item_rate:
                    rate = float(std_item.custom_line_item_rate)
                    description = std_item.custom_line_item_name or agg_data["name"]
                else:
                    rate = 0
                    description = std_item.custom_line_item_name or agg_data["name"]

                amount = Decimal(str(calc_qty)) * Decimal(str(rate))

                items.append({
                    "scope_item_name": agg_data["name"],
                    "location_names": list(set(agg_data["locations"])),
                    "line_item_description": description,
                    "base_quantity": base_qty,
                    "calculated_quantity": calc_qty,
                    "calculation_note": calc_note,
                    "unit": agg_data["unit"],
                    "rate": rate,
                    "amount": float(amount),
                    "default_note": std_item.default_invoice_note,
                    "has_mapping": True,
                    "standard_item_id": std_item.id,
                })
                subtotal += amount
            else:
                # No mapping - add to unmapped list
                items.append({
                    "scope_item_name": agg_data["name"],
                    "location_names": list(set(agg_data["locations"])),
                    "line_item_description": agg_data["name"],
                    "base_quantity": base_qty,
                    "calculated_quantity": base_qty,
                    "calculation_note": f"{base_qty}",
                    "unit": agg_data["unit"],
                    "rate": 0,
                    "amount": 0,
                    "default_note": None,
                    "has_mapping": False,
                    "standard_item_id": std_item.id if std_item else None,
                })
                unmapped_items.append(agg_data["name"])

        return {
            "items": items,
            "subtotal": float(subtotal),
            "total": float(subtotal),
            "mitigation_days": mitigation_days,
            "mitigation_start": job.mitigation_start_date,
            "mitigation_end": job.mitigation_end_date,
            "unmapped_items": unmapped_items,
            "mapped_count": len([i for i in items if i["has_mapping"]]),
            "total_count": len(items),
        }

    # ========================================
    # General Conditions Template Seeding
    # ========================================

    def seed_general_conditions_template(self) -> Dict[str, Any]:
        """
        Seed the General Conditions template with necessary line items.

        This ensures the template has the required items:
        - Emergency service call
        - Hand loading disposal of construction debris
        - Equipment setup, take down, and monitoring

        Returns:
            Dictionary with seed results
        """
        from app.domains.line_items.models import LineItem, TemplateLineItem

        # General Conditions line item keywords/codes to find
        GC_LINE_ITEMS = [
            {
                "keywords": ["emergency service", "emeseca"],
                "description": "Emergency service call",
                "order": 0,
            },
            {
                "keywords": ["hand loading disposal", "genlape", "hand load", "debris disposal"],
                "description": "Hand loading disposal of construction debris",
                "order": 1,
            },
            {
                "keywords": ["equipment setup", "equseta", "monitoring"],
                "description": "Equipment setup, take down, and monitoring",
                "order": 2,
            },
        ]

        # Get or create General Conditions template
        gc_template = self.db.query(LineItemTemplate).filter(
            LineItemTemplate.id == GENERAL_CONDITIONS_TEMPLATE_ID
        ).first()

        if not gc_template:
            # Create the template if it doesn't exist
            gc_template = LineItemTemplate(
                id=GENERAL_CONDITIONS_TEMPLATE_ID,
                name="General Conditions",
                description="General Conditions items for Water Mitigation invoices",
                is_active=True,
            )
            self.db.add(gc_template)
            self.db.flush()
            logger.info(f"Created General Conditions template: {gc_template.id}")

        # Check existing template items
        existing_items = self.db.query(TemplateLineItem).filter(
            TemplateLineItem.template_id == GENERAL_CONDITIONS_TEMPLATE_ID
        ).all()

        existing_line_item_ids = {str(ti.line_item_id) for ti in existing_items if ti.line_item_id}

        added_count = 0
        skipped_count = 0
        not_found = []

        for gc_item in GC_LINE_ITEMS:
            # Find matching line item
            line_item = None
            for keyword in gc_item["keywords"]:
                # Search by description or item code
                line_item = self.db.query(LineItem).filter(
                    LineItem.is_active == True,
                    (
                        LineItem.description.ilike(f"%{keyword}%") |
                        LineItem.item.ilike(f"%{keyword}%")
                    )
                ).first()

                if line_item:
                    break

            if not line_item:
                not_found.append(gc_item["description"])
                logger.warning(f"Line item not found for GC: {gc_item['description']}")
                continue

            # Check if already exists
            if str(line_item.id) in existing_line_item_ids:
                skipped_count += 1
                logger.debug(f"Line item already in template: {line_item.description}")
                continue

            # Add to template
            template_item = TemplateLineItem(
                template_id=GENERAL_CONDITIONS_TEMPLATE_ID,
                line_item_id=line_item.id,
                order_index=gc_item["order"],
            )
            self.db.add(template_item)
            added_count += 1
            logger.info(f"Added GC line item: {line_item.description}")

        self.db.commit()

        return {
            "success": True,
            "template_id": str(GENERAL_CONDITIONS_TEMPLATE_ID),
            "added_count": added_count,
            "skipped_count": skipped_count,
            "not_found": not_found,
            "message": f"Added {added_count} items to General Conditions template"
        }

    def get_general_conditions_template_status(self) -> Dict[str, Any]:
        """
        Get the status of the General Conditions template.

        Returns:
            Dictionary with template info and item count
        """
        from app.domains.line_items.models import TemplateLineItem

        gc_template = self.db.query(LineItemTemplate).options(
            joinedload(LineItemTemplate.template_items).joinedload(TemplateLineItem.line_item)
        ).filter(
            LineItemTemplate.id == GENERAL_CONDITIONS_TEMPLATE_ID
        ).first()

        if not gc_template:
            return {
                "exists": False,
                "template_id": str(GENERAL_CONDITIONS_TEMPLATE_ID),
                "item_count": 0,
                "items": [],
            }

        items = []
        for tli in gc_template.template_items:
            if tli.line_item:
                items.append({
                    "id": str(tli.id),
                    "line_item_id": str(tli.line_item_id),
                    "description": tli.line_item.description,
                    "rate": float(tli.line_item.untaxed_unit_price) if tli.line_item.untaxed_unit_price else 0,
                    "unit": tli.line_item.unit,
                })
            elif tli.embedded_data:
                items.append({
                    "id": str(tli.id),
                    "line_item_id": None,
                    "description": tli.embedded_data.get("description", "Unknown"),
                    "rate": tli.embedded_data.get("rate", 0),
                    "unit": tli.embedded_data.get("unit", "EA"),
                    "is_embedded": True,
                })

        return {
            "exists": True,
            "template_id": str(GENERAL_CONDITIONS_TEMPLATE_ID),
            "template_name": gc_template.name,
            "item_count": len(items),
            "items": items,
        }
