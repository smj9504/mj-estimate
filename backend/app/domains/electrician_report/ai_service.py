"""
AI Report Generator for Electrician Reports.
Uses OpenAI to generate professional electrician inspection report JSON from job details.
"""

import json
import logging
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a licensed master electrician (DMV area). Write a water-damage electrical inspection report. The report goes to the HOMEOWNER and is shared with the insurance ADJUSTER, so it must read as an objective diagnosis whose findings justify the repair scope."""

REPORT_PROMPT_TEMPLATE = """JOB DETAILS:
{job_details}
---
=== CORE PRINCIPLES ===

1. STATE THE CAUSE ONCE in site_findings only. Everywhere else report CONDITION and MEASUREMENT.
   Do NOT spread "water damage / water intrusion" across fields.

2. CLAIM-SAFE WORDING. Banned: corrosion, corroded, oxidation, rust, deterioration, wear,
   staining, discolored, long-standing. Use ONLY measured results: "tests open",
   "fails megger / below threshold", "will not hold", "no power", "dead".
   Do NOT describe visual observations — focus on test results and functional status.

3. SCOPE HONESTY. Interior affected-area inspection only. Not inspected = N/A.
   Exterior lighting & service entrance/meter base → N/A.

4. ROOMS. Use room names exactly as given.

5. DRYWALL ACCESS CUT & PATCH: INCLUDE whenever re-pull or in-wall/in-ceiling J-box work
   is in scope — inherent to that work. Large finish restoration by separate trade.

6. SMOKE/CO DETECTORS: INCLUDE only if listed in JOB DETAILS affected items.
   Never mark DEFICIENT unless listed as damaged.
   Do NOT invent items not in JOB DETAILS.

7. CONSISTENCY CHAIN — findings, checklist, and quote MUST align:
   a) Every item in JOB DETAILS affected items → checklist status DEFICIENT + note with
      test result → matching quote repair line. No orphans in any direction.
   b) Items NOT in JOB DETAILS affected items → checklist status OK or N/A.
      Do NOT mark DEFICIENT for items not listed as damaged.
   c) electrical_findings must reference the same items/rooms as the DEFICIENT checklist
      entries. Do not mention problems in findings that are not in the checklist, and
      do not have DEFICIENT checklist items without corresponding findings.
   d) quote_items must cover ALL DEFICIENT checklist items and ONLY those items.
      Supporting scope (inspection/service call, final test/re-energization, consumables,
      drywall access cut & patch) are allowed as additional lines.
      Do NOT quote repairs for items marked OK or N/A.

8. QUOTE MATH. tax_amount + sum of all line totals (quantity × unit_cost) must equal
   the JOB DETAILS total. Materials may be LOT lines.
   When ceiling speakers are in scope, quote removal + test + reinstall as a labor line
   and speaker replacement as a material line (if non-functional).

=== STYLE ===
Field electrician on a tablet. Short bullets, one fact per line, \\n between them.
Natural abbrevs (qty, approx, w/, J-box, NM-B). Room names, counts, wire gauge, breaker #.
Notes under 15 words. Vary phrasing.
Avoid: "upon arrival", "was advised/observed/found", "consistent with", passive voice,
"technician", homeowner fault.

=== FIXTURE NAMING ===
"boob light" → "flush-mount ceiling fixture (dome)"; "can" → "recessed light".
Keep standard names (wrap fixture, vanity light) as-is.
"Ceiling speaker" → "ceiling-mount speaker". Include speaker removal, testing, and
reinstallation in quote when speakers are listed in affected items.

=== CHECKLIST — section titles & standard labels; status = OK / DEFICIENT / N/A ===
Notes = measured facts only (no cause words, no visual observations).
Use these standard sections and labels as baseline. You MAY add custom items to any
section when the affected items in JOB DETAILS include equipment not covered below
(e.g. ceiling speakers, EV charger, security system, intercom, garage door opener).
- "Lighting & Fixtures": Recessed lights (cans) — operational test | Surface-mount / flush
  ceiling fixtures | Pendant / chandelier fixtures | Ceiling fan / light combo units |
  Under-cabinet / vanity lighting | Ceiling-mount speakers (if present) |
  Exterior / porch lighting
- "Wiring & Connections": Junction boxes — condition / accessibility | Wire connectors
  (wire nuts) — condition | Wire insulation — condition | NM cable (Romex) — condition |
  Conduit / raceway — condition | Outlet / switch boxes — condition
- "Circuits & Testing (Affected Area)": Breaker(s) — tripped / functional | Circuit
  continuity test | Insulation resistance (megger) test | Ground fault test | AFCI breaker
  function (if applicable) | GFCI outlets — trip test | Outlets — polarity / ground
  (affected area)
- "Panel & Service": Main panel — general condition | Bus bars & breaker connections |
  Grounding / bonding system | Panel labeling / circuit directory | Service entrance /
  meter base (N/A if not inspected)
- "Safety & Detection": Smoke detectors — functional | CO detectors — functional | Exhaust
  fans (bath / kitchen) — operational | Arc / burn marks at any device or junction
---
=== OUTPUT ===
Return ONLY a valid JSON object (no markdown, no code fences). \\n for line breaks. Keys:
site_findings, electrical_findings, safety_concerns, recommendations,
inspection_checklist [{{"title": "...", "items": [{{"label": "...", "status": "...", "note": "..."}}]}}],
quote_items [{{"name": "...", "description": "...", "quantity": ..., "unit": "...", "unit_cost": ...}}],
tax_amount, overall_assessment ("satisfactory"/"unsatisfactory" — any DEFICIENT → unsatisfactory),
extent_and_limitations, warranty_info, notes."""


def generate_electrician_report(
    affected_items: list,
    water_source: str,
    state: str = "MD",
    total_amount: Optional[str] = None,
    mitigation_status: str = "completed",
    drywall_cuts: Optional[str] = None,
    additional_context: Optional[str] = None,
    photos: Optional[list] = None,
) -> Optional[dict]:
    """
    Generate electrician inspection report JSON using OpenAI API.

    Args:
        affected_items: List of dicts with {area: str, items: list of {name: str, qty: int}}
        water_source: Description of water source/origin
        state: State abbreviation for tax rate (default "MD")
        total_amount: Total quote amount as string (e.g. "3500")
        mitigation_status: Status of water mitigation (default "completed")
        drywall_cuts: Description of drywall access cuts if applicable
        additional_context: Any additional context for the report
        photos: List of dicts with {category, caption, location} for photo context

    Returns:
        Parsed JSON dict or None on failure.
    """
    # Build affected areas list
    affected_lines = []
    for idx, item in enumerate(affected_items, 1):
        area = item.get("area", "")
        items_list = item.get("items", [])
        items_str = ", ".join(
            f"{it['qty']} {it['name']}{'s' if it['qty'] > 1 else ''}"
            for it in items_list
        )
        line = f"  {idx}. {area}"
        if items_str:
            line += f" — {items_str}"
        affected_lines.append(line)

    details = [
        "- Affected areas & non-working items:\n" + "\n".join(affected_lines),
        f"- Source of water: {water_source or '(not specified)'}",
        f"- Mitigation status: {mitigation_status or 'completed'}",
        f"- State: {state or 'MD'}",
    ]
    if total_amount:
        details.append(f"- Total quote amount: ${total_amount}")
    else:
        details.append("- Total quote amount: (use your best judgment based on scope)")
    if drywall_cuts:
        details.append(f"- Drywall cut & patch: {drywall_cuts}")
    if additional_context:
        details.append(f"- Additional context: {additional_context}")

    # Add photo descriptions if provided
    if photos:
        photo_lines = []
        for idx, ph in enumerate(photos, 1):
            location = ph.get("location", "")
            category = ph.get("category", "")
            caption = ph.get("caption", "")
            parts = []
            if location:
                parts.append(location)
            if category:
                parts.append(f"[{category}]")
            if caption:
                parts.append(caption)
            photo_lines.append(f"  Photo {idx}: {' — '.join(parts)}")
        details.append("- Attached photos (descriptions only, not actual images):\n" + "\n".join(photo_lines))
        details.append("  NOTE: Use these photo descriptions to inform your findings. "
                       "Reference specific photos where relevant (e.g. 'Photo 3 shows staining at J-box').")

    job_details = "\n".join(details)

    prompt = REPORT_PROMPT_TEMPLATE.format(job_details=job_details)

    # Try OpenAI first, then Gemini, then Anthropic as fallback
    result = _call_openai(prompt)
    if result is None:
        result = _call_gemini(prompt)
    if result is None:
        result = _call_anthropic(prompt)

    if result is None:
        logger.error("All AI providers failed for electrician report generation")
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
        client = openai.OpenAI(api_key=api_key, max_retries=1, timeout=30.0)
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=4000,
        )
        return response.choices[0].message.content
    except Exception as e:
        logger.error(f"OpenAI API error: {e}")
        return None


def _call_gemini(prompt: str) -> Optional[str]:
    """Call Google Gemini API as fallback."""
    api_key = settings.GEMINI_API_KEY
    if not api_key:
        logger.warning("No GEMINI_API_KEY configured")
        return None

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")
        response = model.generate_content(
            f"{SYSTEM_PROMPT}\n\n{prompt}",
            generation_config=genai.types.GenerationConfig(
                temperature=0.7,
                max_output_tokens=4000,
            ),
        )
        return response.text
    except Exception as e:
        logger.error(f"Gemini API error: {e}")
        return None


def _call_anthropic(prompt: str) -> Optional[str]:
    """Call Anthropic API as fallback."""
    api_key = settings.ANTHROPIC_API_KEY
    if not api_key:
        logger.warning("No ANTHROPIC_API_KEY configured")
        return None

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key, max_retries=1, timeout=60.0)
        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=4000,
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
        if "site_findings" not in data or "inspection_checklist" not in data:
            logger.error("AI response missing required fields")
            return None
        return data
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse AI JSON response: {e}")
        logger.debug(f"Raw response: {text[:500]}")
        return None
