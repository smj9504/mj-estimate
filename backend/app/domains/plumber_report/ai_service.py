"""
AI Report Generator for Plumber Reports — 2-Step Pipeline.

Step 1: Scope & Assessment — generates site_findings, work_performed, warranty, notes
Step 2: Invoice — uses Step 1's work_performed to build line items & pricing

Pricing note: the labor hourly rate and sales tax are NOT left to the model.
They are deterministic functions of (state, materials cost) and are applied
in code after generation — see generate_plumber_report().
"""

import json
import logging
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────
# Deterministic pricing constants — NOT left to the model
# ──────────────────────────────────────────────

LABOR_RATE = 185.00
MATERIALS_TAX_RATE = 0.06
VALID_STATES = {"MD", "VA", "DC"}

# ──────────────────────────────────────────────
# AI provider / model configuration
# ──────────────────────────────────────────────

AI_TEMPERATURE = 0.3
OPENAI_MODEL_STRONG = "gpt-4o"
OPENAI_MODEL_FAST = "gpt-4o-mini"
ANTHROPIC_MODEL_STRONG = "claude-sonnet-5"
ANTHROPIC_MODEL_FAST = "claude-haiku-4-5-20251001"

# ──────────────────────────────────────────────
# System prompts
# ──────────────────────────────────────────────

SYSTEM_PROMPT = (
    "You are an experienced licensed master plumber in the DMV area "
    "(DC, Maryland, Virginia). You generate professional plumber's "
    "field service reports for emergency repair calls."
)

# ──────────────────────────────────────────────
# Step 1: Scope & Assessment
# ──────────────────────────────────────────────

SCOPE_PROMPT_TEMPLATE = """Write the field report sections for this plumbing service call.

## JOB DETAILS

- **Incident type / problem:** {incident_type}
- **Location in home:** {location}
- **Pipe material:** {pipe_material}
- **What was opened/torn out to access the issue:** {wall_access_type}
- **Fixture detached for access (if any):** {detached_fixture}

## INSTRUCTIONS

### FIRST, INFER (include in output, used internally for the invoice step)
- **failed_component**: the specific pipe/fixture/valve that failed, inferred from the incident type.
- **hours_estimate**: realistic total technician hours on site for this scope of work (e.g. "3.5").
- **protection_needed**: "yes" if tile/drywall/finished surfaces are involved (see access type), else "no".
- **fixture_detached**: name of any fixture detached/removed to access the work area
  (e.g. "toilet", "vanity", "dishwasher"). Use the value given above if provided;
  otherwise infer from the incident/location/access context. Use "" if nothing was detached.

### SITE FINDINGS (-> site_findings)
- Describe ONLY what was observed on site — the component failure and its location.
- State that homeowner reported no prior signs of leakage — mention once, plainly.
- "sudden burst" or "sudden failure" may appear **once** if natural, but is not required.
- Use factual, field-technician language — not legal or overly formal.
- **Describe the failure mode specifically and neutrally** — state what was physically
  observed, not a vague catch-all term. Use concrete language matched to the incident,
  e.g. "split at the pipe body," "fitting separation at the joint," "cracked at the
  elbow," "pinhole leak at the pipe wall," or "valve body failure at the stem." Avoid
  vague euphemisms like "compromised," "failed section," or "damaged section" — they
  can read as implying wear or age even when unintended.
- **Note surface-level moisture indicators only** — e.g. staining or discoloration on
  the drywall or paint, drywall that is soft/spongy to the touch, an elevated
  moisture-meter reading on the wall, or visible water/dampness on the floor or
  baseboard. Do NOT name or assume the condition of materials INSIDE the wall
  (insulation, framing, studs) — those are not visible without opening the wall,
  which is a technician action and belongs in Work Performed, not here. Not every
  wall has insulation — interior partition walls, especially bathroom walls, often
  don't — never assume it does.
- **If water migrated to a lower level or adjacent room/unit, state it plainly** —
  e.g. "active water staining was visible on the ceiling below" or "fresh staining
  consistent with the active leak was noted on the ceiling below." Qualify it as
  active/wet/fresh and tied to this incident — bare "staining" with no qualifier can
  read as an old, unrelated mark and gives an adjuster room to argue it's
  pre-existing damage rather than new damage from this failure.
- Do NOT estimate how long the leak ran or how much water escaped — describe only
  what was visibly wet or affected at the surface.
- Vary opening phrasing — do NOT always start with "Upon arrival". Use alternatives:
  - "Technician found..."
  - "On-site inspection revealed..."
  - "At time of service, technician observed..."
  - Lead directly with the observed condition: "Water staining and dampness were
    visible at..."
  Most repairs happen same-day or next-day after the leak was discovered, so by
  inspection time the leak itself has typically already stopped (isolated by the
  homeowner) — don't phrase the opening as if water is still actively discharging
  unless the incident/location genuinely indicates otherwise.
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
- Open by confirming/isolating the water supply to the affected line before any work
  begins (e.g. "Confirmed the water supply to the [line] was isolated" or "Isolated
  the supply to the affected line before beginning work"). Do NOT frame this as an
  urgent shutoff of actively-running water — most repairs happen same-day or
  next-day after the leak was discovered, so the supply has typically already been
  off for some time (isolated by the homeowner) before the technician ever arrives.
  Do NOT open with "Upon arrival" — lead with the action itself.
- Group related steps into single sentences — do not list every micro-step separately.
- Structure: (1) confirm supply isolated + surface protection, (2) access + repair —
  state the approximate access opening dimensions (e.g. "2' x 3'") when
  tile/drywall/ceiling/floor was cut, (3) test + post-repair protection.
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
  - Estimate opening size from scope: single supply-line access ≈ 1'x1' to 1.5'x1.5';
    drain/multi-fitting or leak-search access ≈ 2'x2' to 2'x3'. Skip sizing for access
    panel / under-sink cabinet (nothing is cut open).
- **If a fixture was detached for access** (see fixture_detached): explicitly mention
  detaching it before accessing the work area, and resetting/reinstalling it
  (new wax ring, supply line connections, or caulk as applicable) as one of the final steps.
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
  "failed_component": "...",
  "hours_estimate": "...",
  "protection_needed": "yes",
  "fixture_detached": "...",
  "site_findings": "...",
  "work_performed": "...",
  "warranty_info": "...",
  "notes": "..."
}}"""

# ──────────────────────────────────────────────
# Step 2: Invoice from Work Performed
# ──────────────────────────────────────────────

INVOICE_PROMPT_TEMPLATE = """Based on the plumbing work performed below, price a realistic itemized invoice using DMV-area market rates.

## WORK PERFORMED
{work_performed}

## JOB CONTEXT
- **Incident type:** {incident_type}
- **Pipe material:** {pipe_material}
- **Wall / access type:** {wall_access_type}
- **Protection installed:** {protection_installed}
- **Fixture detached for access:** {fixture_detached}
- **State:** {state}
- **Estimated hours on site:** {hours_estimate}

## INVOICE RULES
- Up to 5 line items (6 if a fixture detach/reset line is needed — see below).
- Structure: Emergency Dispatch Fee + Labor (2-3 phases) + Materials.
- **Emergency Dispatch Fee**: $125-$200 depending on urgency (1 EA).
- **Labor rate**: Use $185/hr as your reference when deciding realistic hours — the
  unit_cost for every HR line is normalized to this exact rate automatically after
  generation, so focus on realistic HOURS per phase, not the dollar figure. Use HR as
  the unit for all labor lines.
  Total labor hours across all phases should be realistic for the scope described —
  use {hours_estimate} as a starting reference, but adjust to fit the actual work performed.
- **Fixture detach & reset**: if "Fixture detached for access" above is not empty/"none",
  add a dedicated labor line item for it — e.g. "Labor — Toilet Detach & Reset" or
  "Labor — Vanity Detach & Reinstall" — typically 0.5-1.5 HR, separate from the other
  labor phases. Include any reset materials (wax ring, caulk, etc.) in Materials.
- **Materials**: Group all materials into a single LOT line item. Price it bottom-up by
  summing realistic DMV-area retail/wholesale costs for the SPECIFIC items actually used
  (see work performed above) — never pick a round placeholder number.
  Reference price anchors (scale with quantity/scope):
  - Copper pipe (Type L): ~$8-12/ft · CPVC pipe: ~$3-5/ft · PEX pipe: ~$1-2/ft
  - Copper fittings (elbow/coupling): ~$3-8 each · CPVC/PVC fittings: ~$1-3 each
  - Primer & cement (shared from can): ~$8-15 · Solder & flux (partial use): ~$5-10
  - Wax ring: ~$8-15 · Toilet/appliance supply line: ~$8-15 · Braided connector: ~$10-20
  - Protection plastic sheeting + tape: ~$15-30
  Include temporary protection materials in this sum if protection was installed.
  Materials description should list the actual items used with approximate quantities.
  **The Materials total must NOT coincidentally equal the labor hourly rate ($185) or
  any other line item's total** — if your first pass lands on a round or matching
  number, recompute it from the itemized components above.
- Labor phase names must reflect the ACTUAL work described above.
  Example phase names: "Shut-off, Protection & Access", "Repair, Testing & Seal-up".
- Price each line item independently at realistic market rates — there is no
  predetermined total to hit. Add the line items up naturally.
- **Tax**: Do not calculate or include sales tax, and do not add a tax/sales-tax line
  item — it is computed automatically after generation from the state and materials cost.
- Double-check your arithmetic (quantity × unit_cost per line) before responding.

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
  ]
}}"""


# ──────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────

def generate_plumber_report(
    incident_type: str,
    location: str,
    wall_access_type: str,
    pipe_material: str,
    state: str,
    detached_fixture: str = "",
) -> Optional[dict]:
    """
    2-step AI pipeline for plumber report generation.

    Step 1 (strong model): Scope & Assessment -> site_findings, work_performed,
            warranty, notes, plus AI-inferred failed_component, hours_estimate,
            protection_needed, and fixture_detached. pipe_material is a given
            input, not inferred — the technician knows what's actually there.
    Step 2 (fast model): Invoice -> invoice_items priced at realistic DMV market
            rates from Step 1's inferred scope (no fixed target).

    The labor hourly rate and sales tax are deterministic — they are computed
    in code below, not trusted from the model's output.

    Raises ValueError if `state` is not one of VALID_STATES (MD/VA/DC) — this
    should be unreachable via the API, which validates state before calling
    in; it's an internal contract check for direct callers.

    Returns merged JSON dict or None if all AI providers fail.
    """
    state_normalized = (state or "").strip().upper()
    if state_normalized not in VALID_STATES:
        raise ValueError(
            f"state must be one of {sorted(VALID_STATES)}, got {state!r}"
        )

    # ── Step 1: Scope & Assessment ──
    logger.info("AI Step 1/2: Generating scope & assessment...")
    scope_prompt = SCOPE_PROMPT_TEMPLATE.format(
        incident_type=incident_type,
        location=location,
        pipe_material=pipe_material,
        wall_access_type=wall_access_type,
        detached_fixture=detached_fixture or "none specified — infer from context if applicable",
    )

    scope_data = _call_ai_json(scope_prompt, "work_performed", strong=True)
    if scope_data is None:
        logger.error("Step 1 failed: all providers returned unusable output")
        return None

    logger.info("AI Step 1/2 complete.")

    # ── Step 2: Invoice from work performed ──
    logger.info("AI Step 2/2: Generating invoice from work performed...")
    invoice_prompt = INVOICE_PROMPT_TEMPLATE.format(
        work_performed=scope_data["work_performed"],
        incident_type=incident_type,
        pipe_material=pipe_material,
        wall_access_type=wall_access_type,
        protection_installed=scope_data.get("protection_needed") or "yes",
        fixture_detached=detached_fixture or scope_data.get("fixture_detached") or "none",
        state=state_normalized,
        hours_estimate=scope_data.get("hours_estimate") or "3",
    )

    invoice_data = _call_ai_json(invoice_prompt, "invoice_items", strong=False)
    if invoice_data is None:
        logger.error("Step 2 failed: all providers returned unusable output")
        return None

    logger.info("AI Step 2/2 complete.")

    # ── Deterministic pricing — labor rate and tax are NOT trusted from the model ──
    items = invoice_data.get("invoice_items", [])
    for item in items:
        if (item.get("unit") or "").upper() == "HR":
            item["unit_cost"] = LABOR_RATE

    subtotal = round(sum(
        item.get("quantity", 1) * item.get("unit_cost", 0)
        for item in items
    ), 2)
    materials_cost = sum(
        item.get("quantity", 1) * item.get("unit_cost", 0)
        for item in items
        if (item.get("unit") or "").upper() == "LOT"
    )
    tax = (
        0.0 if state_normalized == "VA"
        else round(materials_cost * MATERIALS_TAX_RATE, 2)
    )
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

class _PermanentProviderError(Exception):
    """
    Raised by a provider call when the failure is known to be non-transient
    for this request (e.g. the account has no API credits left). Retrying
    the SAME provider again in a later round would just repeat the exact
    same failure and waste time, so _call_ai_json drops it instead.
    """


def _call_ai_json(
    prompt: str,
    required_key: str,
    strong: bool = False,
    max_rounds: int = 2,
) -> Optional[dict]:
    """
    Call OpenAI (if enabled), then Anthropic, retrying across all enabled
    providers for up to `max_rounds` rounds, until one returns a parseable
    JSON object containing `required_key`.

    A provider returning malformed/incomplete JSON is treated the same as a
    provider returning nothing — it does NOT end the pipeline; the next
    provider (or the next round) gets a chance instead. A provider that
    raises _PermanentProviderError (e.g. no credits) is dropped for the
    remainder of this call instead of being retried in later rounds.
    """
    openai_model = OPENAI_MODEL_STRONG if strong else OPENAI_MODEL_FAST
    anthropic_model = ANTHROPIC_MODEL_STRONG if strong else ANTHROPIC_MODEL_FAST
    providers = []
    if settings.PLUMBER_REPORT_USE_OPENAI:
        providers.append((_call_openai, openai_model))
    providers.append((_call_anthropic, anthropic_model))

    for round_num in range(1, max_rounds + 1):
        if not providers:
            break
        for call, model in list(providers):
            try:
                raw = call(prompt, model)
            except _PermanentProviderError as e:
                logger.warning(
                    f"{call.__name__} ({model}) failed permanently, dropping "
                    f"it for the rest of this request: {e}"
                )
                providers.remove((call, model))
                continue
            if raw is None:
                continue
            data = _parse_json_response(raw)
            if data is not None and required_key in data:
                return data
            logger.warning(
                f"{call.__name__} ({model}) round {round_num}: response "
                f"missing '{required_key}' or unparseable, trying next"
            )

    logger.error(f"All providers/rounds exhausted without a usable '{required_key}'")
    return None


def _call_openai(prompt: str, model: str) -> Optional[str]:
    """Call OpenAI API in JSON mode."""
    api_key = settings.OPENAI_API_KEY
    if not api_key:
        logger.warning("No OPENAI_API_KEY configured")
        return None

    try:
        import openai
        client = openai.OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=AI_TEMPERATURE,
            max_tokens=2000,
            response_format={"type": "json_object"},
        )
        return response.choices[0].message.content
    except openai.APIStatusError as e:
        if e.type == "insufficient_quota":
            raise _PermanentProviderError(
                f"OpenAI account has no remaining credits (code={e.code})"
            ) from e
        logger.error(f"OpenAI API error ({model}): {e}")
        return None
    except Exception as e:
        logger.error(f"OpenAI API error ({model}): {e}")
        return None


_anthropic_model_capabilities: dict = {}
"""
Per-process cache of {model: {"temperature": bool, "prefill": bool}} —
once a model's rejection of `temperature`/prefill is confirmed, later calls
to the SAME model skip straight to the working configuration instead of
re-discovering it (via a guaranteed-failing request) on every single call.
Cleared on process restart; harmless to rediscover if Anthropic changes a
model's behavior later, and safe across the sync-blocking call pattern used
here (worst case under rare concurrent first-calls: one wasted extra request).
"""


def _call_anthropic(prompt: str, model: str) -> Optional[str]:
    """
    Call Anthropic API as fallback.

    Optionally uses `temperature` and an assistant-turn '{' prefill (to bias
    toward clean, code-fence-free JSON). Some models — e.g. claude-sonnet-5,
    a reasoning model — reject one or both with a 400 ("temperature is
    deprecated for this model" / "does not support assistant message
    prefill"). Rather than hardcode per-model capability, each is dropped on
    its own confirmed rejection and the call retried; this terminates in at
    most 3 attempts since each retry strictly removes one of the two. The
    resolved configuration is cached per-model so future calls skip straight
    to it (see _anthropic_model_capabilities).
    """
    api_key = settings.ANTHROPIC_API_KEY
    if not api_key:
        logger.warning("No ANTHROPIC_API_KEY configured")
        return None

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)

        cached = _anthropic_model_capabilities.get(model, {})
        use_temperature = cached.get("temperature", True)
        use_prefill = cached.get("prefill", True)
        while True:
            messages = [{"role": "user", "content": prompt}]
            if use_prefill:
                messages.append({"role": "assistant", "content": "{"})
            kwargs = dict(model=model, max_tokens=2000, system=SYSTEM_PROMPT, messages=messages)
            if use_temperature:
                kwargs["temperature"] = AI_TEMPERATURE

            try:
                response = client.messages.create(**kwargs)
                break
            except anthropic.BadRequestError as e:
                msg = str(e).lower()
                if use_temperature and "temperature" in msg:
                    logger.warning(f"{model} rejects 'temperature', retrying without it (caching for future calls)")
                    use_temperature = False
                elif use_prefill and "prefill" in msg:
                    logger.warning(f"{model} rejects assistant prefill, retrying without it (caching for future calls)")
                    use_prefill = False
                else:
                    raise

        _anthropic_model_capabilities[model] = {"temperature": use_temperature, "prefill": use_prefill}

        # Reasoning models (e.g. claude-sonnet-5) prepend non-text blocks
        # (thinking/redacted-thinking) — the text block is NOT reliably at
        # index 0, so scan for the first block that actually has text.
        text = next(
            (t for b in response.content if (t := getattr(b, "text", None)) is not None),
            None,
        )
        if text is None:
            block_types = [type(b).__name__ for b in response.content]
            logger.error(f"Anthropic API ({model}): no text block found (got: {block_types})")
            return None
        return ("{" + text) if use_prefill else text
    except Exception as e:
        logger.error(f"Anthropic API error ({model}): {e}")
        return None


# ──────────────────────────────────────────────
# JSON parsing
# ──────────────────────────────────────────────

def _parse_json_response(raw: str) -> Optional[dict]:
    """
    Parse an AI response into a dict, tolerating prose preambles/postambles
    and markdown code fences by extracting the outermost {...} span instead
    of assuming the response starts with a fence or a brace.
    """
    text = raw.strip()

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        logger.error("No JSON object found in AI response")
        logger.debug(f"Raw response: {text[:500]}")
        return None

    candidate = text[start:end + 1]

    try:
        data = json.loads(candidate)
        if not isinstance(data, dict):
            logger.error("AI response is not a JSON object")
            return None
        return data
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse AI JSON response: {e}")
        logger.debug(f"Raw response: {text[:500]}")
        return None
