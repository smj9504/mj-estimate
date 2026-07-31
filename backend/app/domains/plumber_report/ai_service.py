"""
AI Report Generator for Plumber Reports — 2-Step Pipeline.

Step 1: Scope & Assessment — generates site_findings, work_performed, warranty, notes
Step 2: Invoice — uses Step 1's work_performed to build line items & pricing
"""

import json
import logging
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────
# System prompts
# ──────────────────────────────────────────────

SYSTEM_PROMPT = """You are an experienced licensed master plumber in the DMV area (DC, Maryland, Virginia).
You generate professional plumber's service reports for emergency repair calls."""

# ──────────────────────────────────────────────
# Step 1: Scope & Assessment
# ──────────────────────────────────────────────

SCOPE_PROMPT_TEMPLATE = """Assess this emergency plumbing call and write the field report sections.

## JOB DETAILS

- **Incident type:** {incident_type}
- **Failed component:** {failed_component}
- **Pipe material:** {pipe_material}
- **Location in home:** {location}
- **Wall / access type:** {wall_access_type}
- **Protection installed:** {protection_installed}

## INSTRUCTIONS

### SITE FINDINGS (-> site_findings)
- Describe the failure factually as a burst/failure at the identified component and location.
- Mention once, plainly, that the homeowner reported no prior signs of leakage — state it and move on.
- "sudden failure" may appear **once** if it reads naturally, but is not required.
- Use factual, field-technician language — not legal or overly formal.
- Do NOT mention age, wear and tear, or maintenance history.
- Do NOT describe water supply as "still pressurized" or note how long water ran.
- Do NOT estimate leak duration or volume of water.
- Do NOT imply any fault or delay on the homeowner's part.

### WORK PERFORMED (-> work_performed)
- Written as a narrative paragraph describing the full scope of work.
- Frame the water shut-off as an immediate action upon arrival.
- **Match repair method to pipe material:**
  - copper → cut out failed section, replace with Type L copper, solder/push-fit couplings.
  - PEX/flexible → replace connector or line with code-compliant fittings.
- **Match demolition to wall/access type:**
  - tile → cut and remove tile and backing.
  - drywall → cut and remove drywall section.
  - access panel → open existing panel, no cutting.
- If protection installed = yes, describe poly sheeting installation.
- Keep concise but clear.

### WARRANTY (-> warranty_info)
- 30-day labor warranty statement, 1 sentence.

### NOTES (-> notes)
- 2-3 sentences max. Include leak-free verification, drying advisory, and hand-off to qualified trade for finish restoration.

## TONE
Professional field report. Written as a licensed technician, not a lawyer.
Avoid: wear and tear, deterioration, age-related, neglect, deferred maintenance, excessive defensive phrasing, legal language, estimates of leak duration/volume, homeowner fault implications.

## OUTPUT FORMAT
Return ONLY a valid JSON object (no markdown, no code fences):

{{
  "site_findings": "...",
  "work_performed": "...",
  "warranty_info": "...",
  "notes": "..."
}}"""

# ──────────────────────────────────────────────
# Step 2: Invoice from Work Performed
# ──────────────────────────────────────────────

INVOICE_PROMPT_TEMPLATE = """Based on the plumbing work performed below, create an itemized invoice.

## WORK PERFORMED
{work_performed}

## JOB CONTEXT
- **Incident type:** {incident_type}
- **Pipe material:** {pipe_material}
- **Wall / access type:** {wall_access_type}
- **Protection installed:** {protection_installed}
- **State:** {state}
- **Target total invoice amount:** {invoice_amount}

## INVOICE RULES
- 5 line items maximum.
- Include: Emergency Dispatch Fee, Labor (broken into 2-3 phases), Materials (grouped).
- Labor phase names must reflect the ACTUAL work described above (e.g. "Shut-off & Tile Access," "Copper Repair, Testing & Protection").
- Estimate realistic labor hours per phase based on the work described.
- Materials should list the actual items used in the work description.
- **CRITICAL — Total must match {invoice_amount} exactly.**
  Before outputting, compute: sum of (quantity × unit_cost) for every item + tax_amount.
  That number MUST equal {invoice_amount} (strip $ and commas to compare).
  Strategy: set Emergency Fee, then set labor hours & rate, then set Materials unit_cost = target − (Emergency + Labor totals) − tax.
  Double-check your arithmetic before responding.
- **Tax handling:** For MD/VA/DC real-property repair, do NOT apply sales tax to labor. tax_amount defaults to 0 unless materials are separately taxed per the state's rule.

## OUTPUT FORMAT
Return ONLY a valid JSON object (no markdown, no code fences):

{{
  "invoice_items": [
    {{
      "name": "Emergency Dispatch Fee",
      "description": "After-hours emergency response and on-site assessment",
      "quantity": 1,
      "unit": "EA",
      "unit_cost": 175.00
    }},
    {{
      "name": "Labor — [Phase Name]",
      "description": "Description of labor performed",
      "quantity": 2,
      "unit": "HR",
      "unit_cost": 150.00
    }},
    {{
      "name": "Materials",
      "description": "List of materials used",
      "quantity": 1,
      "unit": "LOT",
      "unit_cost": 130.00
    }}
  ],
  "tax_amount": 0
}}"""


# ──────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────

def generate_plumber_report(
    incident_type: str,
    location: str,
    state: str = "MD",
    invoice_amount: str = "$3,000",
    failed_component: str = "",
    pipe_material: str = "",
    wall_access_type: str = "drywall",
    protection_installed: str = "yes",
) -> Optional[dict]:
    """
    2-step AI pipeline for plumber report generation.

    Step 1: Scope & Assessment → site_findings, work_performed, warranty, notes
    Step 2: Invoice → invoice_items, tax_amount (based on Step 1 work_performed)

    Returns merged JSON dict or None on failure.
    """
    resolved_component = failed_component or incident_type
    resolved_material = pipe_material or "Type L copper"
    resolved_wall = wall_access_type or "drywall"
    resolved_protection = protection_installed or "yes"

    # ── Step 1: Scope & Assessment ──
    logger.info("AI Step 1/2: Generating scope & assessment...")
    scope_prompt = SCOPE_PROMPT_TEMPLATE.format(
        incident_type=incident_type,
        location=location,
        failed_component=resolved_component,
        pipe_material=resolved_material,
        wall_access_type=resolved_wall,
        protection_installed=resolved_protection,
    )

    scope_raw = _call_ai(scope_prompt)
    if scope_raw is None:
        logger.error("Step 1 failed: all AI providers returned None")
        return None

    scope_data = _parse_json_response(scope_raw)
    if scope_data is None or "work_performed" not in scope_data:
        logger.error("Step 1 failed: invalid JSON or missing work_performed")
        return None

    logger.info("AI Step 1/2 complete.")

    # ── Step 2: Invoice from work performed ──
    logger.info("AI Step 2/2: Generating invoice from work performed...")
    invoice_prompt = INVOICE_PROMPT_TEMPLATE.format(
        work_performed=scope_data["work_performed"],
        incident_type=incident_type,
        pipe_material=resolved_material,
        wall_access_type=resolved_wall,
        protection_installed=resolved_protection,
        state=state,
        invoice_amount=invoice_amount,
    )

    invoice_raw = _call_ai(invoice_prompt)
    if invoice_raw is None:
        logger.error("Step 2 failed: all AI providers returned None")
        return None

    invoice_data = _parse_json_response(invoice_raw)
    if invoice_data is None or "invoice_items" not in invoice_data:
        logger.error("Step 2 failed: invalid JSON or missing invoice_items")
        return None

    logger.info("AI Step 2/2 complete.")

    # ── Reconcile total to target amount ──
    items = invoice_data.get("invoice_items", [])
    tax = invoice_data.get("tax_amount", 0)
    items = _reconcile_total(items, tax, invoice_amount)

    # ── Merge results ──
    return {
        "site_findings": scope_data.get("site_findings", ""),
        "work_performed": scope_data.get("work_performed", ""),
        "warranty_info": scope_data.get("warranty_info", ""),
        "notes": scope_data.get("notes", ""),
        "invoice_items": items,
        "tax_amount": tax,
    }


# ──────────────────────────────────────────────
# AI Provider calls
# ──────────────────────────────────────────────

def _call_ai(prompt: str) -> Optional[str]:
    """Try OpenAI first, then Anthropic as fallback."""
    result = _call_openai(prompt)
    if result is None:
        result = _call_anthropic(prompt)
    if result is None:
        logger.error("All AI providers failed")
    return result


def _call_openai(prompt: str) -> Optional[str]:
    """Call OpenAI API."""
    api_key = settings.OPENAI_API_KEY
    if not api_key:
        logger.warning("No OPENAI_API_KEY configured")
        return None

    try:
        import openai
        client = openai.OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=2000,
        )
        return response.choices[0].message.content
    except Exception as e:
        logger.error(f"OpenAI API error: {e}")
        return None


def _call_anthropic(prompt: str) -> Optional[str]:
    """Call Anthropic API as fallback."""
    api_key = settings.ANTHROPIC_API_KEY
    if not api_key:
        logger.warning("No ANTHROPIC_API_KEY configured")
        return None

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=2000,
            system=SYSTEM_PROMPT,
            messages=[
                {"role": "user", "content": prompt},
            ],
        )
        return response.content[0].text
    except Exception as e:
        logger.error(f"Anthropic API error: {e}")
        return None


# ──────────────────────────────────────────────
# Invoice total reconciliation
# ──────────────────────────────────────────────

def _parse_amount(amount_str: str) -> float:
    """Parse '$3,500' or '3500' into float."""
    cleaned = amount_str.replace("$", "").replace(",", "").strip()
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def _reconcile_total(
    items: list, tax: float, target_str: str
) -> list:
    """
    Adjust the last 'Materials' or 'LOT' line item so the
    invoice total matches the target exactly.
    AI often gets arithmetic wrong — this fixes it in code.
    """
    target = _parse_amount(target_str)
    if target <= 0 or not items:
        return items

    current = sum(
        item.get("quantity", 1) * item.get("unit_cost", 0)
        for item in items
    ) + tax

    diff = target - current
    if abs(diff) < 0.01:
        return items  # already correct

    # Find the Materials/LOT line to adjust (usually last)
    adjust_idx = None
    for idx in reversed(range(len(items))):
        item = items[idx]
        name = (item.get("name") or "").lower()
        unit = (item.get("unit") or "").upper()
        if "material" in name or unit == "LOT":
            adjust_idx = idx
            break

    if adjust_idx is None:
        # Fallback: adjust the last item
        adjust_idx = len(items) - 1

    item = items[adjust_idx]
    qty = item.get("quantity", 1)
    if qty <= 0:
        qty = 1
    new_cost = item.get("unit_cost", 0) + (diff / qty)
    if new_cost < 0:
        new_cost = 0

    items[adjust_idx]["unit_cost"] = round(new_cost, 2)

    logger.info(
        f"Reconciled invoice: adjusted '{item.get('name')}' "
        f"by ${diff:+,.2f} to hit target ${target:,.2f}"
    )
    return items


# ──────────────────────────────────────────────
# JSON parsing
# ──────────────────────────────────────────────

def _parse_json_response(raw: str) -> Optional[dict]:
    """Parse AI response, stripping markdown fences if present."""
    text = raw.strip()

    # Strip markdown code fences
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [ln for ln in lines if not ln.strip().startswith("```")]
        text = "\n".join(lines).strip()

    try:
        data = json.loads(text)
        if not isinstance(data, dict):
            logger.error("AI response is not a JSON object")
            return None
        return data
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse AI JSON response: {e}")
        logger.debug(f"Raw response: {text[:500]}")
        return None
