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

SYSTEM_PROMPT = (
    "You are an experienced licensed master plumber in the DMV area "
    "(DC, Maryland, Virginia). You generate professional plumber's "
    "field service reports for emergency repair calls."
)

# ──────────────────────────────────────────────
# Pipe‑type inference rules (shared context)
# ──────────────────────────────────────────────

PIPE_INFERENCE_RULES = """
### Pipe Type Inference (use when pipe_material is not specified)
- Kitchen/bathroom sink drain line -> PVC (DWV)
- Supply line (hot/cold) -> Copper or CPVC
- Older home drain -> Cast iron or PVC
"""

# ──────────────────────────────────────────────
# Step 1: Scope & Assessment
# ──────────────────────────────────────────────

SCOPE_PROMPT_TEMPLATE = """Write the field report sections for this plumbing service call.

## JOB DETAILS

- **Incident type:** {incident_type}
- **Failed component:** {failed_component}
- **Pipe material:** {pipe_material}
- **Location in home:** {location}
- **Wall / access type:** {wall_access_type}
- **Protection installed:** {protection_installed}
""" + PIPE_INFERENCE_RULES + """
## INSTRUCTIONS

### SITE FINDINGS (-> site_findings)
- Describe ONLY what was observed on site — the component failure and its location.
- State that homeowner reported no prior signs of leakage — mention once, plainly.
- "sudden burst" or "sudden failure" may appear **once** if natural, but is not required.
- Use factual, field-technician language — not legal or overly formal.
- Vary opening phrasing — do NOT always start with "Upon arrival". Use alternatives:
  - "Technician found..."
  - "On-site inspection revealed..."
  - "At time of service, technician observed..."
  - Lead directly with the condition: "Active discharge was present at..."
- **NEVER include any of the following in Site Findings:**
  - Main water valve state upon arrival (open, closed, shut off, already turned off)
  - Water pressure state upon arrival
  - Any suggestion the supply was "still running" or left unattended
  - Estimated leak duration or volume of water escaped
  - Age, wear, deterioration, or maintenance history
  - Any implication of homeowner fault or delayed response
  - Any technician actions (shut-off, protection, repair) — those belong in Work Performed

### WORK PERFORMED (-> work_performed)
- Keep it to 3-4 sentences maximum.
- Open with supply/drain shutoff as the immediate first action.
  Do NOT open with "Upon arrival" — lead with the action itself.
- Group related steps into single sentences — do not list every micro-step separately.
- Structure: (1) shutoff + surface protection, (2) access + repair, (3) test + post-repair protection.
- **Two protection phases when tile/drywall/finished surfaces are involved:**
  - Phase 1 (pre-demo): Protect surrounding surfaces and fixtures BEFORE any cutting.
  - Phase 2 (post-repair): Temporarily seal the exposed wall cavity with plastic sheeting
    and tape AFTER plumbing work is complete, before leaving the job.
- **Match repair method to pipe material:**
  - copper -> cut out failed section, replace with Type L copper, solder/push-fit couplings.
  - PEX/flexible -> replace connector or line with code-compliant fittings.
  - PVC (DWV) -> cut out failed section, fit replacement PVC with couplings, replace P-trap.
  - CPVC -> cut and replace with CPVC transition fittings.
- **Match access to wall/access type:**
  - tile -> protect surrounding tile and fixtures, cut and remove tile and backing for access.
  - drywall -> cut and remove drywall section.
  - access panel -> open existing panel, no cutting.
  - under-sink / cabinet -> protect cabinet interior and flooring.
- Use field technician language — clear and factual, not legal.

### CRITICAL CONSISTENCY CHECK
Before outputting, verify ALL of these:
1. Site Findings must NOT mention any action the technician performed (shut-off, repair, protection).
2. Work Performed must NOT contradict Site Findings.
3. If Site Findings says something was in a certain state, Work Performed must not claim the opposite.
4. The word count for work_performed should be roughly 3-4 sentences, not a long list.

### WARRANTY (-> warranty_info)
- One sentence: 30-day workmanship warranty from date of service.

### NOTES (-> notes)
- 2-3 sentences max.
- Include: drying advisory, monitoring recommendation, no additional issues found.
- If tile or drywall was removed, note that restoration is pending and the cavity has been temporarily sealed.

## TONE
Professional field report. Written as a licensed technician, not a lawyer.
Avoid: wear and tear, deterioration, age-related, neglect, deferred maintenance,
excessive defensive phrasing, legal language, estimates of leak duration/volume,
homeowner fault implications.

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
- **Hours on site:** {hours_on_site}
- **Target total invoice amount:** {invoice_amount}

## INVOICE RULES
- 5 line items maximum.
- Structure: Emergency Dispatch Fee + Labor (2-3 phases) + Materials.
- **Emergency Dispatch Fee**: $125-$200 depending on urgency (1 EA).
- **Labor rate**: $185/hr (DMV standard rate). Use HR as unit.
  Labor hours across all phases should roughly match {hours_on_site} total hours on site.
- **Materials**: Group all materials into a single LOT line item.
  Include temporary protection materials (plastic sheeting, tape) if protection was installed.
  Materials description should list the actual items used in the work description.
- Labor phase names must reflect the ACTUAL work described above.
  Example phase names: "Shut-off, Protection & Access", "Repair, Testing & Seal-up".
- **CRITICAL — Total must match {invoice_amount} exactly.**
  Strategy: set Emergency Fee first, then set labor hours & $185/hr rate,
  then set Materials unit_cost = target - (Emergency + Labor totals) - tax.
  Double-check your arithmetic before responding.
- **Tax handling:**
  - VA: Labor exempt, materials 6% (if bundled into flat rate, tax can be $0).
  - MD: Labor exempt, materials 6%.
  - DC: Labor exempt, materials 6%.
  - If materials cost is included in the flat rate, tax_amount = 0.

## OUTPUT FORMAT
Return ONLY a valid JSON object (no markdown, no code fences):

{{
  "invoice_items": [
    {{
      "name": "Emergency Dispatch Fee",
      "description": "Emergency response and on-site assessment",
      "quantity": 1,
      "unit": "EA",
      "unit_cost": 150.00
    }},
    {{
      "name": "Labor - [Phase Name]",
      "description": "Description of labor performed",
      "quantity": 1.5,
      "unit": "HR",
      "unit_cost": 185.00
    }},
    {{
      "name": "Materials",
      "description": "List of materials used including protection materials",
      "quantity": 1,
      "unit": "LOT",
      "unit_cost": 0.00
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
    hours_on_site: str = "",
) -> Optional[dict]:
    """
    2-step AI pipeline for plumber report generation.

    Step 1: Scope & Assessment -> site_findings, work_performed, warranty, notes
    Step 2: Invoice -> invoice_items, tax_amount (based on Step 1 work_performed)

    Returns merged JSON dict or None on failure.
    """
    resolved_component = failed_component or incident_type
    resolved_material = pipe_material or "not specified (infer from incident and location)"
    resolved_wall = wall_access_type or "drywall"
    resolved_protection = protection_installed or "yes"
    resolved_hours = hours_on_site or "3"

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
        hours_on_site=resolved_hours,
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

    # ── Compute subtotal and total ──
    subtotal = round(sum(
        item.get("quantity", 1) * item.get("unit_cost", 0)
        for item in items
    ), 2)
    total = round(subtotal + tax, 2)

    # ── Merge results ──
    return {
        "site_findings": scope_data.get("site_findings", ""),
        "work_performed": scope_data.get("work_performed", ""),
        "warranty_info": scope_data.get("warranty_info", ""),
        "notes": scope_data.get("notes", ""),
        "invoice_items": items,
        "subtotal": subtotal,
        "tax_amount": tax,
        "total": total,
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
        lines = [
            ln for ln in lines
            if not ln.strip().startswith("```")
        ]
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
