"""
Reading a Xactimate item off a screenshot of Xactimate's "Item Activity
Information" window (open an item in the line item grid, capture the window
with the snipping tool, paste it into the app).

Claude transcribes what the window shows (`read_screenshot`); `to_draft`
turns that into an item the price list can store and an estimate line can
use. Nothing is saved here - `save_item` stores a draft the person checked.

The window's numbers fit together like this:

    Material + Equipment + Retail Labor + Market Conditions = Replace Price
    Retail Labor = Worker's Wage + Labor Burden + Labor Overhead

so the stored item keeps the wage as `labor_cost` and burden + overhead as
`labor_burden`, and its cost fields add up to the replace price.
"""

import base64
import json
import logging
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.core.config import settings

logger = logging.getLogger(__name__)

# Room for adaptive thinking on top of the JSON, which is under a thousand tokens.
MAX_TOKENS = 8192

# Models that accept fallbacks="default" (another model retries if Claude declines).
SERVER_FALLBACK_MODELS = {"claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"}

ACTIVITIES = {
    "+": "Replace",
    "-": "Remove",
    "&": "Remove and Replace",
    "R": "Detach & Reset",
    "I": "Install",
    "M": "Material Only",
}


def _nullable(schema: Dict[str, Any]) -> Dict[str, Any]:
    return {"anyOf": [schema, {"type": "null"}]}


NUMBER = _nullable({"type": "number"})
STRING = _nullable({"type": "string"})

COMPONENT_SCHEMA = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": ["Labor", "Material", "Equipment", "Other"]},
        "description": STRING,
        "price_per_unit": NUMBER,
    },
    "required": ["type", "description", "price_per_unit"],
    "additionalProperties": False,
}

SCHEMA = {
    "type": "object",
    "properties": {
        "is_item_window": {"type": "boolean"},
        "category": STRING,
        "selector": STRING,
        "activity": _nullable({"type": "string", "enum": list(ACTIVITIES)}),
        "phase": STRING,
        "description": STRING,
        "unit": STRING,
        "material": NUMBER,
        "equipment": NUMBER,
        "retail_labor": NUMBER,
        "market_conditions": NUMBER,
        "replace_price": NUMBER,
        "remove_price": NUMBER,
        "workers_wage": NUMBER,
        "labor_burden": NUMBER,
        "labor_overhead": NUMBER,
        "components": {"type": "array", "items": COMPONENT_SCHEMA},
        "includes": STRING,
        "excludes": STRING,
        "quality": STRING,
        "reference": STRING,
        "green": STRING,
        "notes": STRING,
    },
    "required": [
        "is_item_window", "category", "selector", "activity", "phase", "description", "unit",
        "material", "equipment", "retail_labor", "market_conditions", "replace_price", "remove_price",
        "workers_wage", "labor_burden", "labor_overhead", "components",
        "includes", "excludes", "quality", "reference", "green", "notes",
    ],
    "additionalProperties": False,
}

SYSTEM = """You transcribe a screenshot from Xactimate, the insurance restoration estimating software, for a contractor who keeps their own copy of Xactimate's price list. The screenshot is usually the "Item Activity Information" window for one line item. Answer with the JSON the schema asks for.

Copy exactly what the screen shows; give null for anything it doesn't show or that is cut off or hidden behind another window. Never work a number out or guess one.

- is_item_window: true when the picture shows a Xactimate item's prices (the Item Activity Information window or a similar item detail); false otherwise, with everything else null and components empty.
- category, selector: the codes after "Category:" and "Selector:" (e.g. APP and CT). activity: the symbol after "Activity:" (+ Replace, - Remove, & Remove and Replace, R Detach & Reset, I Install, M Material Only). phase: the Phase box text.
- description: the line item's description only where it shows in full (a Desc box or the line item grid). null if it is cut off.
- unit: the unit of measure (EA, LF, SF, ...) only if shown.
- material, equipment, retail_labor, market_conditions, replace_price, remove_price: the dollar amounts in those boxes, as numbers without $ or commas. workers_wage, labor_burden, labor_overhead: the Labor breakdown boxes (Worker's Wage, Labor Burden, Labor Overhead).
- components: each row of the Type / Description / Price Per Unit table.
- includes, excludes, quality, reference, green, notes: the Definition tab's boxes, as written; null when empty."""


def read_screenshot(image: bytes, media_type: str) -> Dict[str, Any]:
    """Claude's transcription of the screenshot (the schema's fields)."""
    if not settings.ANTHROPIC_API_KEY:
        raise RuntimeError("Reading Xactimate screenshots is not set up: ANTHROPIC_API_KEY is missing")
    model = settings.XACTIMATE_SCREEN_MODEL
    output_config: Dict[str, Any] = {"format": {"type": "json_schema", "schema": SCHEMA}}
    if settings.XACTIMATE_SCREEN_EFFORT:
        output_config["effort"] = settings.XACTIMATE_SCREEN_EFFORT
    extra: Dict[str, Any] = {}
    if model in SERVER_FALLBACK_MODELS:
        # If Claude declines, another model retries inside the same call.
        extra = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}

    import anthropic  # 30MB+ once loaded, and only this read needs it
    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=120.0, max_retries=1)
    response = client.beta.messages.create(
        model=model,
        max_tokens=MAX_TOKENS,
        output_config=output_config,
        # The instructions are the same every time; cache them.
        system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {
                    "type": "base64", "media_type": media_type,
                    "data": base64.b64encode(image).decode("ascii"),
                }},
                {"type": "text", "text": "Transcribe this Xactimate screenshot."},
            ],
        }],
        **extra,
    )
    usage = response.usage
    logger.info(
        "Xactimate screen read: model=%s input=%s cache_read=%s output=%s",
        response.model, usage.input_tokens, usage.cache_read_input_tokens, usage.output_tokens,
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("Claude declined to read this screenshot")
    if response.stop_reason == "max_tokens":
        raise RuntimeError("The read was cut off")
    for block in response.content:
        if block.type == "text":
            return json.loads(block.text)
    raise RuntimeError(f"No answer in the read (stop_reason={response.stop_reason})")


# ---------------------------------------------------------------------------


def _money(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    except Exception:
        return None


def _code(value: Any) -> str:
    return "".join(str(value or "").split()).upper()


def _text(value: Any) -> Optional[str]:
    text = (value or "").strip() if isinstance(value, str) else None
    return text or None


def _close(a: float, b: float) -> bool:
    return abs(a - b) <= 0.02


COMPONENT_TYPES = {"Labor": "lab", "Material": "mat", "Equipment": "equ"}


def to_draft(read: Dict[str, Any], today: Optional[date] = None) -> Dict[str, Any]:
    """
    The item as the app stores it, plus what an estimate line needs
    (`unit_price` for the activity shown). `warnings` lists what the person
    should check before saving.
    """
    today = today or date.today()
    warnings: List[str] = []
    if not read.get("is_item_window"):
        warnings.append("This doesn't look like Xactimate's Item Activity Information window")

    category = _code(read.get("category"))[:3]
    selector = _code(read.get("selector"))
    activity = read.get("activity") if read.get("activity") in ACTIVITIES else None

    material = _money(read.get("material"))
    equipment = _money(read.get("equipment"))
    retail_labor = _money(read.get("retail_labor"))
    market = _money(read.get("market_conditions"))
    wage = _money(read.get("workers_wage"))
    burden = _money(read.get("labor_burden"))
    overhead = _money(read.get("labor_overhead"))
    replace_price = _money(read.get("replace_price"))
    remove_price = _money(read.get("remove_price"))

    parts = [v for v in (material, equipment, retail_labor, market) if v is not None]
    parts_sum = _money(sum(parts)) if parts else None
    if replace_price is None and parts_sum is not None and activity != "-":
        replace_price = parts_sum
        warnings.append("Replace price worked out from material, equipment, labor and market conditions")
    elif replace_price is not None and parts_sum is not None and not _close(parts_sum, replace_price):
        warnings.append(
            f"Material + equipment + labor + market conditions = {parts_sum:.2f}, "
            f"but the replace price reads {replace_price:.2f}"
        )

    # Keep the wage as labor and burden + overhead as burden, so the cost
    # fields add up to the replace price. Without the breakdown, all retail
    # labor is labor.
    if wage is not None and (burden is not None or overhead is not None):
        labor_cost = wage
        labor_burden = _money((burden or 0) + (overhead or 0))
        if retail_labor is not None and not _close(labor_cost + labor_burden, retail_labor):
            warnings.append(
                f"Wage + burden + overhead = {labor_cost + labor_burden:.2f}, "
                f"but retail labor reads {retail_labor:.2f}"
            )
    else:
        labor_cost = retail_labor
        labor_burden = None

    components = []
    for comp in read.get("components") or []:
        kind = COMPONENT_TYPES.get(comp.get("type"))
        price = _money(comp.get("price_per_unit"))
        if not kind or price is None or price < 0:
            continue
        components.append({
            "component_type": kind,
            "component_code": (_text(comp.get("description")) or "")[:50] or None,
            "unit_price": price,
            "cost": price,
        })

    description = _text(read.get("description"))
    if not description:
        material_names = [c["component_code"] for c in components if c["component_type"] == "mat" and c["component_code"]]
        description = material_names[0] if material_names else None
        warnings.append("The item's description isn't on the screenshot - check it")

    if activity == "-":
        unit_price = remove_price
    elif activity == "&":
        unit_price = _money((remove_price or 0) + (replace_price or 0)) if (remove_price or replace_price) else None
    else:
        unit_price = replace_price
    if unit_price is None:
        warnings.append("No price found")

    if not category:
        warnings.append("No category code found")

    green = _text(read.get("green"))
    reference = "\n".join(t for t in (_text(read.get("reference")), green and f"Green: {green}") if t) or None

    return {
        "item_code": f"{category}{selector}" if category else selector,
        "category_code": category,
        "selector": selector or None,
        "activity": activity,
        "activity_label": ACTIVITIES.get(activity) if activity else None,
        "phase": _text(read.get("phase")),
        "description": description or "",
        "unit": _code(read.get("unit")) or None,
        "price_year": today.year,
        "price_month": today.month,
        "material_cost": material,
        "equipment_cost": equipment,
        "labor_cost": labor_cost,
        "labor_burden": labor_burden,
        "market_conditions": market,
        "retail_labor": retail_labor,
        "replace_price": replace_price,
        "remove_price": remove_price,
        "untaxed_unit_price": replace_price if replace_price is not None else unit_price,
        "unit_price": unit_price,
        "includes_description": _text(read.get("includes")),
        "excludes_description": _text(read.get("excludes")),
        "quality_description": _text(read.get("quality")),
        "reference_description": reference,
        "note_description": _text(read.get("notes")),
        "components": components,
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------

ITEM_FIELDS = (
    "description", "labor_cost", "material_cost", "equipment_cost", "labor_burden", "market_conditions",
    "untaxed_unit_price", "includes_description", "excludes_description", "note_description",
    "quality_description", "reference_description",
)


def save_item(db: Session, data: Dict[str, Any], category_name: Optional[str] = None):
    """
    Store a checked draft in the price list. The same item code for the same
    price month is updated rather than added twice; a category the list
    doesn't know yet is added.
    """
    from .models import XactimateCategory, XactimateComponent, XactimateItem

    code = data["category_code"]
    if not db.query(XactimateCategory).filter(XactimateCategory.category_code == code).first():
        db.add(XactimateCategory(category_code=code, category_name=(category_name or code)[:100]))
        db.flush()

    item = db.query(XactimateItem).filter(
        XactimateItem.item_code == data["item_code"],
        XactimateItem.price_year == data["price_year"],
        XactimateItem.price_month == data["price_month"],
    ).first()
    created = item is None
    if created:
        item = XactimateItem(
            item_code=data["item_code"], category_code=code,
            price_year=data["price_year"], price_month=data["price_month"],
        )
        db.add(item)
    item.category_code = code
    for field in ITEM_FIELDS:
        value = data.get(field)
        if field in ("labor_cost", "material_cost", "equipment_cost", "labor_burden", "market_conditions",
                     "untaxed_unit_price"):
            value = Decimal(str(value or 0))
        setattr(item, field, value)
    db.flush()

    db.query(XactimateComponent).filter(XactimateComponent.item_id == item.id).delete()
    for comp in data.get("components") or []:
        db.add(XactimateComponent(
            item_id=item.id,
            component_type=comp["component_type"],
            component_code=comp.get("component_code"),
            cost=Decimal(str(comp.get("cost") or comp.get("unit_price") or 0)),
            unit_price=Decimal(str(comp.get("unit_price") or 0)),
        ))
    db.commit()
    db.refresh(item)
    return item, created
