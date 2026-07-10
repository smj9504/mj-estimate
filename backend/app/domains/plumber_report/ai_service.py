"""
AI Report Generator for Plumber Reports.
Uses OpenAI to generate professional plumber report JSON from job details.
"""

import json
import logging
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an experienced licensed master plumber in the DMV area (DC, Maryland, Virginia).
You generate professional plumber's service reports for emergency repair calls."""

REPORT_PROMPT_TEMPLATE = """Write a professional plumber's service report for an emergency repair call.

---

## JOB DETAILS

- **Incident type:** {incident_type}
- **Failed component:** {failed_component}
- **Pipe material:** {pipe_material}
- **Location in home:** {location}
- **Wall / access type:** {wall_access_type}
- **Protection installed:** {protection_installed}
- **State:** {state} (for tax rate)
- **Total invoice amount:** {invoice_amount}
- **Work performed:** Based on the incident type, failed component, and location above, infer the most realistic and typical scope of work a licensed plumber would perform for this type of emergency repair in the DMV area.
- **Materials used:** Infer the most commonly used, code-compliant materials for this repair, consistent with the specified pipe material.
- **Labor hours:** Estimate realistic labor hours by phase based on the scope inferred above. Total hours should be consistent with the specified invoice amount.

---

## REPORT REQUIREMENTS

### 1. SITE FINDINGS & ASSESSMENT (-> site_findings)
- Describe the failure factually as a burst/failure at the identified component and location.
- Mention once, plainly, that the homeowner reported no prior signs of leakage -- state it and move on. Do not dwell on it, repeat it, or build the whole paragraph around it.
- "sudden failure" may appear **once** if it reads naturally, but is not required. Do not stack defensive phrasing ("uncontrolled discharge," "unexpected," "no warning," etc.).
- Use factual, field-technician language -- not legal or overly formal.
- Do NOT mention age of components, wear and tear, or maintenance history.
- Do NOT describe the water supply as "still pressurized," "still on," or note how long water ran before shut-off. Focus only on what was observed (active discharge, location, affected area).
- Do NOT estimate how long the leak had been running, how much water escaped, or the duration of the event in any form.
- Do NOT imply any fault, delay, or omission on the homeowner's part -- no suggestion that the leak was noticed late, reported late, or could have been caught earlier. The homeowner's only stated role is that no prior signs of leakage were reported.

### 2. WORK PERFORMED (-> work_performed)
- Written as a narrative paragraph describing the full scope of work.
- Group related tasks together.
- Frame the water shut-off as an immediate action taken upon arrival (e.g. "technician immediately isolated and shut off the main supply to stop the active discharge") rather than a static condition found.
- **Match the repair method and materials to the specified pipe material:**
  - **copper** -> cut out the failed section and replace with Type L copper, joined by solder (sweat) or push-fit couplings.
  - **flexible / PEX** -> replace the connector or line run with code-compliant fittings.
  - Do not mix material types in the repair unless the job specifies a transition fitting.
- **Match the demolition to the specified wall/access type:**
  - **tile** -> cut and remove a section of tile and backing to expose the failed line.
  - **drywall** -> cut and remove a drywall section to expose the failed line.
  - **access panel** -> open the existing access panel; no cutting required.
- **If protection was installed (Protection installed: yes)**, describe installing protective poly sheeting over the open access area and sealing the perimeter to contain the work zone and allow follow-up drying. Include the sheeting/tape in the materials line.
- Keep it concise but clear, written as a field technician would describe it.

### 3. INVOICE (-> invoice_items)
- 5 line items maximum.
- Include: Emergency Dispatch Fee, Labor (broken into 2-3 phases), Materials (grouped).
- Labor phase names should reflect the actual scope (e.g. "Shut-off & Tile Access," "Copper Repair, Testing & Protection").
- **Tax handling:** For MD/VA/DC real-property repair, do NOT apply sales tax to labor. `tax_amount` defaults to 0 unless materials are separately taxed per the specified state's rule -- in which case apply the material-only tax and reflect it in `tax_amount`.
- `tax_amount` and the item total must reconcile to the specified invoice amount.

### 4. WARRANTY & NOTES (-> warranty_info, notes)
- **warranty_info:** 30-day labor warranty statement (1 sentence).
- **notes:** Brief technician notes -- 2-3 sentences max. Include the leak-free-under-pressure verification, drying-time advisory, and hand-off of tile/waterproofing/finish restoration to a separate qualified trade.

---

## TONE
Professional field report. Written as a licensed technician, not a lawyer.

**Avoid:** wear and tear, deterioration, age-related, neglect, deferred maintenance; excessive or repeated defensive phrasing around "sudden" / "no prior signs"; overly legal or defensive language; any note on water pressure state at arrival; any phrasing that suggests the leak ran unattended or that shut-off was delayed; any estimate of leak duration or volume of water escaped; and any language implying homeowner fault, late discovery, or delayed reporting.

---

## OUTPUT FORMAT
Return ONLY a valid JSON object (no markdown, no code fences). Use the exact structure below:

{{
  "site_findings": "Upon arrival at the property, technician observed...",
  "work_performed": "Upon arrival, technician immediately isolated and shut off the main water supply to stop the active discharge...",
  "invoice_items": [
    {{
      "name": "Emergency Dispatch Fee",
      "description": "After-hours emergency response and on-site assessment",
      "quantity": 1,
      "unit": "EA",
      "unit_cost": 175.00
    }},
    {{
      "name": "Labor — Shut-off & Access",
      "description": "Isolated main supply, cut and removed [tile/drywall] to expose failed line",
      "quantity": 2,
      "unit": "HR",
      "unit_cost": 150.00
    }},
    {{
      "name": "Labor — Repair, Testing & Protection",
      "description": "Cut out failed section, installed new [copper/PEX] with code-compliant fittings, pressure-tested, installed protective containment",
      "quantity": 2.5,
      "unit": "HR",
      "unit_cost": 150.00
    }},
    {{
      "name": "Materials",
      "description": "[Type L copper / PEX], couplings, fittings, poly sheeting, containment tape",
      "quantity": 1,
      "unit": "LOT",
      "unit_cost": 130.00
    }}
  ],
  "tax_amount": 0,
  "warranty_info": "All labor performed is covered under a 30-day workmanship warranty.",
  "notes": "Repair was verified leak-free under pressure at time of completion. Recommend allowing 48-72 hours drying time before restoration. Tile, waterproofing membrane, and finish restoration to be handled by a separate qualified trade."
}}"""


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
    Generate plumber report JSON using OpenAI API.

    Returns parsed JSON dict or None on failure.
    """
    prompt = REPORT_PROMPT_TEMPLATE.format(
        incident_type=incident_type,
        location=location,
        state=state,
        invoice_amount=invoice_amount,
        failed_component=failed_component or incident_type,
        pipe_material=pipe_material or "Type L copper",
        wall_access_type=wall_access_type or "drywall",
        protection_installed=protection_installed or "yes",
    )

    # Try OpenAI first, then Anthropic as fallback
    result = _call_openai(prompt)
    if result is None:
        result = _call_anthropic(prompt)

    if result is None:
        logger.error("All AI providers failed for plumber report generation")
        return None

    return _parse_json_response(result)


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
            model="claude-sonnet-4-20250514",
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


def _parse_json_response(raw: str) -> Optional[dict]:
    """Parse AI response, stripping markdown fences if present."""
    text = raw.strip()

    # Strip markdown code fences
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first line (```json or ```) and last line (```)
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines).strip()

    try:
        data = json.loads(text)
        # Validate required fields
        if not isinstance(data, dict):
            logger.error("AI response is not a JSON object")
            return None
        if "site_findings" not in data or "invoice_items" not in data:
            logger.error("AI response missing required fields")
            return None
        return data
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse AI JSON response: {e}")
        logger.debug(f"Raw response: {text[:500]}")
        return None
