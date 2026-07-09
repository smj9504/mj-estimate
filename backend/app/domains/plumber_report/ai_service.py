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
JOB DETAILS:
- Incident type: {incident_type}
- Location in home: {location}
- State: {state} (for tax rate)
- Total invoice amount: {invoice_amount}
- Work performed: Based on the incident type and location provided above,
  infer the most realistic and typical scope of work a licensed plumber
  would perform for this type of emergency repair in the DMV area.
- Materials used: Infer the most commonly used, code-compliant materials
  for this type of repair.
- Labor hours: Estimate realistic labor hours by phase based on the scope
  of work inferred above. Total hours should be consistent with the
  specified invoice amount.
---
REPORT REQUIREMENTS:
1. SITE FINDINGS & ASSESSMENT (→ site_findings)
   - Describe the failure as sudden and unexpected
   - State that no prior signs of leakage were reported by the homeowner
   - Use factual, field technician language — not legal or overly formal
   - Do NOT mention age of components, wear and tear, or maintenance history
   - Do NOT describe the water supply as "still pressurized," "still on,"
     or otherwise note how long water ran before shut-off — avoid any
     phrasing that implies the leak was left active or that shut-off was
     delayed. Focus only on what was observed (active discharge, location,
     affected area).
   - Do NOT estimate or describe how long the leak had been running, how
     much water escaped, or the duration of the event in any form.
     Describe only the condition observed at the moment of arrival.
   - Do NOT imply any fault, delay, or omission on the homeowner's part.
   - Use "sudden burst" or "sudden failure" once naturally — do not repeat excessively
2. WORK PERFORMED (→ work_performed)
   - Written as a narrative paragraph describing the full scope of work
   - Group related tasks together
   - Frame the water shut-off as an immediate action taken upon arrival
   - Keep it concise but clear
   - Written as a field technician would describe it
3. INVOICE (→ invoice_items)
   - 5 line items maximum
   - Include: Emergency Dispatch Fee, Labor (broken into 2-3 phases), Materials (grouped)
   - tax_amount and total must match the specified invoice amount
4. WARRANTY & NOTES (→ warranty_info, notes)
   - warranty_info: 30-day labor warranty statement (1 sentence)
   - notes: Brief technician notes — 2-3 sentences max with follow-up advisory
TONE: Professional field report. Written as a licensed technician, not a lawyer.
Avoid: wear and tear, deterioration, age-related, neglect, deferred maintenance,
       excessive repetition of "sudden," overly legal or defensive phrasing,
       any note on water pressure state at arrival, any phrasing that
       suggests the leak ran unattended or that shut-off was delayed,
       any estimate of leak duration or volume of water escaped, and any
       language implying homeowner fault, late discovery, or delayed reporting.
---
OUTPUT FORMAT: Return ONLY a valid JSON object (no markdown, no code fences).
Use the exact structure below:
{{
  "site_findings": "Upon arrival at the property, technician observed...",
  "work_performed": "Upon arrival, technician immediately isolated and shut off the main water supply...",
  "invoice_items": [
    {{
      "name": "Emergency Dispatch Fee",
      "description": "After-hours emergency response and site assessment",
      "quantity": 1,
      "unit": "EA",
      "unit_cost": 250.00
    }},
    {{
      "name": "Labor — Demolition & Access",
      "description": "Removed damaged drywall section to expose failed supply line",
      "quantity": 3,
      "unit": "HR",
      "unit_cost": 185.00
    }},
    {{
      "name": "Labor — Repair & Reassembly",
      "description": "Replaced burst section with new copper pipe, soldered joints",
      "quantity": 4,
      "unit": "HR",
      "unit_cost": 185.00
    }},
    {{
      "name": "Materials",
      "description": "3/4in Type L copper pipe, couplings, flux, solder, pipe hangers",
      "quantity": 1,
      "unit": "LOT",
      "unit_cost": 385.00
    }}
  ],
  "tax_amount": 0,
  "warranty_info": "All labor performed is covered under a 30-day workmanship warranty.",
  "notes": "Recommend allowing 48-72 hours drying time before any wall restoration. Tile and drywall restoration to be handled by separate trades."
}}"""


def generate_plumber_report(
    incident_type: str,
    location: str,
    state: str = "MD",
    invoice_amount: str = "$3,000",
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
