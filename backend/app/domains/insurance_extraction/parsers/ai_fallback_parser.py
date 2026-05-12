"""AI-based fallback parser for non-Xactimate insurance estimate formats.

Uses LLM (Claude/OpenAI) to parse extracted PDF text into structured line items.
This is Strategy 5 in the extraction pipeline - used when all rule-based parsers fail.
"""

import json
import logging
import re
from decimal import Decimal
from typing import Any, Dict, List, Optional

from app.domains.insurance_extraction.interfaces import ParsedItemDTO

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an insurance estimate parser. Parse the insurance estimate text and extract ALL line items.

For each line item, extract:
- item_number: The sequential number of the item
- description: The work description (e.g., "Drywall/Plaster Ceiling - Paint, 2 Coats")
- quantity: The numerical quantity
- unit: The unit of measurement (SF, LF, EA, SY, HR, RM, LS, etc.)
- unit_price: The price per unit
- total_cost: The total cost for this line item
- room: The room/area this item belongs to (e.g., "Kitchen", "Bathroom")

Also extract summary information if available:
- carrier: Insurance company name
- claim_number: Claim number
- insured: Insured person's name
- subtotal: Estimate subtotal before O&P
- overhead_pct: Overhead percentage
- overhead_amount: Overhead dollar amount
- profit_pct: Profit percentage
- profit_amount: Profit dollar amount
- sales_tax: Sales tax amount
- deductible: Deductible amount
- estimate_total: Final estimate total

Output ONLY valid JSON in this exact format:
{
  "carrier": "Insurance Company Name",
  "claim_number": "A00007570451",
  "insured": "Name",
  "items": [
    {
      "item_number": 1,
      "description": "Trade Group: Plumbing",
      "quantity": 1,
      "unit": "EA",
      "unit_price": 395.00,
      "total_cost": 395.00,
      "room": "General Items"
    }
  ],
  "summary": {
    "subtotal": 19559.09,
    "overhead_pct": 15.0,
    "overhead_amount": 2930.47,
    "profit_pct": 10.0,
    "profit_amount": 1953.65,
    "sales_tax": 266.68,
    "deductible": 1000.00,
    "estimate_total": 23709.89
  }
}

Rules:
- Extract EVERY line item, do not skip any
- Keep descriptions exactly as written in the document
- Prices should be numbers, not strings
- If a field is not available, use null
- Do NOT include subtotal rows as line items
- Do NOT include header/footer text as line items"""


def _get_llm_client():
    """Get the best available LLM client."""
    from app.core.config import settings

    # Prefer Anthropic (Claude) for better structured output
    if settings.ANTHROPIC_API_KEY:
        try:
            import anthropic
            return "anthropic", anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        except ImportError:
            logger.warning("anthropic package not installed, trying openai")

    if settings.OPENAI_API_KEY:
        try:
            import openai
            return "openai", openai.OpenAI(api_key=settings.OPENAI_API_KEY)
        except ImportError:
            logger.warning("openai package not installed")

    return None, None


def _call_anthropic(client, pages_text: str) -> Optional[str]:
    """Call Claude API to parse estimate text."""
    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=8192,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": f"Parse this insurance estimate and extract all line items:\n\n{pages_text[:30000]}",
                }
            ],
        )
        return response.content[0].text
    except Exception as e:
        logger.error(f"Anthropic API call failed: {e}")
        return None


def _call_openai(client, pages_text: str) -> Optional[str]:
    """Call OpenAI API to parse estimate text."""
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            max_tokens=8192,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": f"Parse this insurance estimate and extract all line items:\n\n{pages_text[:30000]}",
                },
            ],
            response_format={"type": "json_object"},
        )
        return response.choices[0].message.content
    except Exception as e:
        logger.error(f"OpenAI API call failed: {e}")
        return None


def _safe_decimal(value) -> Optional[Decimal]:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except Exception:
        return None


def _parse_llm_response(raw_json: str) -> tuple[List[ParsedItemDTO], Dict[str, Any]]:
    """Parse the LLM JSON response into ParsedItemDTOs."""
    # Extract JSON from potential markdown code blocks
    json_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw_json)
    if json_match:
        raw_json = json_match.group(1)

    try:
        data = json.loads(raw_json.strip())
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse LLM JSON response: {e}")
        return [], {"ai_parse_error": str(e)}

    items: List[ParsedItemDTO] = []
    metadata: Dict[str, Any] = {}

    # Extract metadata
    metadata["ai_carrier"] = data.get("carrier")
    metadata["ai_claim_number"] = data.get("claim_number")
    metadata["ai_insured"] = data.get("insured")
    metadata["ai_summary"] = data.get("summary", {})

    # Convert items
    for raw_item in data.get("items", []):
        description = raw_item.get("description", "")
        if not description or len(description) < 3:
            continue

        quantity = _safe_decimal(raw_item.get("quantity"))
        unit_price = _safe_decimal(raw_item.get("unit_price"))
        unit = raw_item.get("unit")
        total_cost = _safe_decimal(raw_item.get("total_cost"))
        item_number = raw_item.get("item_number")

        if unit_price is None and total_cost and quantity and quantity > 0:
            unit_price = total_cost / quantity

        dto = ParsedItemDTO(
            line_item=description[:2000],
            room=raw_item.get("room"),
            unit_price=unit_price,
            quantity=quantity,
            measurement=f"{quantity} {unit}" if quantity and unit else None,
            unit=unit.upper() if unit else None,
            confidence=Decimal("0.75"),  # Lower confidence for AI-parsed items
            raw_line=None,
            token_offsets={"ai_parsed": True},
            validation_flags=_validate_ai_item(description, quantity, unit_price),
            item_number=item_number,
            rcv=total_cost,
        )
        items.append(dto)

    return items, metadata


def _validate_ai_item(
    description: str, quantity: Optional[Decimal], unit_price: Optional[Decimal]
) -> List[str]:
    flags: List[str] = []
    if not description:
        flags.append("line_item_missing")
    if quantity is None or quantity <= 0:
        flags.append("quantity_invalid")
    if unit_price is None or unit_price < 0:
        flags.append("unit_price_invalid")
    flags.append("ai_parsed")
    return flags


def parse_with_ai(pages: List[str]) -> tuple[List[ParsedItemDTO], Dict[str, Any]]:
    """Parse insurance estimate pages using AI/LLM.

    Returns: (items, metadata)
    """
    provider, client = _get_llm_client()
    if client is None:
        logger.warning("No LLM client available for AI fallback parsing")
        return [], {"ai_error": "no_llm_client_available"}

    # Combine pages with page markers
    pages_text = ""
    for i, page in enumerate(pages, 1):
        if page and page.strip():
            pages_text += f"\n--- Page {i} ---\n{page}\n"

    if not pages_text.strip():
        return [], {"ai_error": "no_text_to_parse"}

    logger.info(f"AI fallback parsing with {provider} ({len(pages_text)} chars)")

    # Call LLM
    if provider == "anthropic":
        raw_response = _call_anthropic(client, pages_text)
    else:
        raw_response = _call_openai(client, pages_text)

    if not raw_response:
        return [], {"ai_error": "llm_call_failed", "ai_provider": provider}

    items, metadata = _parse_llm_response(raw_response)
    metadata["ai_provider"] = provider
    metadata["ai_text_length"] = len(pages_text)
    metadata["ai_item_count"] = len(items)

    logger.info(f"AI fallback parsed {len(items)} items via {provider}")
    return items, metadata
