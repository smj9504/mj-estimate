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
- **Was the detached fixture reinstalled by this technician?** {fixture_reinstalled}

## GROUND RULES — WHAT YOU CAN AND CANNOT KNOW

This report goes to an insurance adjuster and to the property owner, so every sentence
must stay true no matter which plausible real-world scenario actually occurred. The JOB
DETAILS above are the only facts you have. Never state or imply anything they do not
establish.

You do NOT know:
- **How long the leak ran, when it started, or how much water escaped.** A leak inside a
  wall can go unnoticed for an unknown length of time.
- **Whether the homeowner did anything at all before the technician arrived.** Many
  homeowners do not know where the main shutoff or an isolation valve is.
- **Whether water was still discharging when the technician arrived, or had stopped.**
- **The position of any valve, or the system pressure, on arrival.**
- **The condition of anything not visible without opening a wall, ceiling, or fixture** —
  insulation, framing, studs, subfloor. Not every wall even contains insulation; interior
  partition walls, bathroom walls especially, often do not.
- **The age, wear, deterioration, or maintenance history of the plumbing.** Nothing may
  suggest homeowner fault or a delayed response.

You DO know, and should write about: the physical conditions visible at the surface, and
the actions the technician performed.

## INSTRUCTIONS

### INFERRED FIELDS (part of the output; they also feed the invoice step)
- **failed_component** — the specific pipe, fixture, or valve that failed, inferred from
  the incident type and location.
- **hours_estimate** — realistic total technician hours on site for this scope, written as
  a decimal string (e.g. "3.5").
- **protection_needed** — "yes" if tile, drywall, or other finished surfaces are involved
  (judge from the access type above), otherwise "no".
- **fixture_detached** — the fixture detached or removed to reach the work area (e.g.
  "toilet", "vanity", "dishwasher"). Use the value given in JOB DETAILS if one was
  provided; otherwise infer it from the incident, location, and access context. Use ""
  if nothing was detached.
All four must stay consistent with the narrative sections below. Note: whether the
detached fixture was reinstalled is NOT inferred — it is given directly in JOB DETAILS
above as "Was the detached fixture reinstalled by this technician?" and must be followed
exactly wherever fixture_detached is non-empty.

### SITE FINDINGS (-> site_findings)

Purpose: what was observed on site, before any work. Observations only — no technician
action of any kind (isolation, protection, cutting, repair, testing) belongs here.

REQUIRED:
- The component that failed and where it is.
- **The failure mode, described specifically and neutrally — but only if it was actually
  visible without opening anything.** Whether it was depends on wall_access_type:
  - Exposed component (access panel, under-sink/cabinet, or anything not behind a cut
    surface) → state what was physically observed: "split at the pipe body," "fitting
    separation at the joint," "cracked at the elbow," "pinhole leak at the pipe wall,"
    "valve body failure at the stem."
  - Enclosed behind drywall, tile, ceiling, or floor → the specific failure mode is NOT
    knowable at this stage without cutting into it, which is a technician action. Describe
    only the general suspected area instead (e.g. "a failure believed to be at the supply
    line running through this section of wall"). Work Performed states the confirmed
    failure mode once access was actually made — see its access step below. Do NOT write
    "once exposed..." or "upon opening..." here; that describes a cutting action, which
    belongs in Work Performed, not Site Findings.
  Either way, never write "compromised," "failed section," or "damaged section" — vague
  terms read as implying wear or age even when that is not intended.
- **Never draw a conclusion about whether the failure was sudden or gradual** — e.g. never
  write "this appears to have been a sudden failure rather than a gradual leak" or anything
  like it. That is an argued conclusion aimed at a specific insurance objection, not an
  observation, and it can conflict with the staining language a sentence or two away
  (staining takes some time to develop, so pairing it with "not gradual" hands an adjuster
  an opening to pick apart). The failure-mode description above already reads as an acute
  mechanical failure — let it stand on its own without an added editorial verdict.
- **Surface-level moisture indicators only** — staining or discoloration on the drywall or
  paint, drywall that is soft or spongy to the touch, visible water or dampness on the
  floor or baseboard. Do NOT mention a moisture-meter reading: no input here carries an
  actual measured value, and citing an instrument reading with no number — or inventing
  one — either hands an adjuster an unanswerable "what was the reading?" or puts a
  fabricated figure in a report that has to hold up under scrutiny. If a real reading is
  ever captured, it must ship with its baseline (e.g. "32% WME at the wall base vs. 9% on
  unaffected wall in the same room") — a number with nothing to compare it to isn't
  meaningful either. Nothing inside the wall: naming or characterizing insulation, framing,
  or studs requires opening the wall, which is a technician action and belongs in Work
  Performed.
- One plain mention, exactly once, that the homeowner reported no prior signs of leakage.
- **If water reached a lower level or an adjacent room/unit, say so, and qualify it as
  active, fresh, or wet and tied to this incident** — e.g. "active water staining was
  visible on the ceiling below," or "fresh staining consistent with the leak was noted on
  the ceiling below." Bare "staining" with no qualifier reads as an old, unrelated mark and
  gives an adjuster room to argue the damage is pre-existing rather than new. ("Active" and
  "fresh" here describe the mark as new and wet — they are not a claim that water is still
  flowing, which stays off-limits.)

OPENING SENTENCE — vary it; do not always start with "Upon arrival":
- "Technician found..."
- "On-site inspection revealed..."
- "At time of service, technician observed..."
- Or lead straight into the condition: "Water staining and dampness were visible at..."
Whichever you choose, open on the observed condition, and do not characterize the leak as
either still discharging or already stopped — neither is knowable. "Water was present at
the base of the wall" is safe; "water was actively discharging" and "the leak had since
stopped" are both not.

NEVER in Site Findings: valve position or pressure on arrival; any suggestion the supply
was "still running" or left unattended; estimated leak duration or water volume; age, wear,
deterioration, or maintenance history; homeowner fault or delayed response; any technician
action.

### WORK PERFORMED (-> work_performed)

Purpose: what the technician did. 3-4 sentences maximum — group related steps into single
sentences; never list every micro-step separately.

Cover these steps, in this order:
1. **Isolate the supply** — always (on a drain/DWV job, take the affected fixture out of
   service instead). See "Opening step" below for the required phrasing.
2. **Protect the surrounding surfaces and fixtures, before any cutting** — only when tile,
   drywall, or other finished surfaces are involved (i.e. protection_needed is "yes").
3. **Detach the fixture** — only if a fixture was detached for access (see fixture_detached).
4. **Open access and make the repair** — always; state the approximate opening dimensions
   (e.g. "2' x 3'") whenever tile, drywall, ceiling, or floor was cut. If Site Findings
   could only describe a general suspected area (component was enclosed, not exposed —
   see the failure-mode rule in Site Findings above), state the confirmed failure mode
   here once access was made, e.g. "once exposed, the line was found split at the pipe
   body." If Site Findings already stated the specific failure mode (component was
   exposed), don't repeat it here.
5. **Test the repair, reset the detached fixture (if applicable), and temporarily seal the
   opened cavity** with plastic sheeting and tape before leaving — reset only if step 3
   applied AND fixture_reinstalled is "yes"; sealing only if something was cut open in
   step 4. If step 3 applied but fixture_reinstalled is "no," state instead that the
   fixture remains detached, pending replacement or reinstallation by others.

**Opening step — supply isolation, phrased neutrally.** Lead with the action itself (never
"Upon arrival"). The sentence has to hold true whether the water was already off when the
technician arrived or the technician had to close a still-open valve — you cannot know
which, so state the isolation as a completed step, without attributing it to anyone and
without dating it.
- Use: "Water supply to the affected line was isolated before any work began."
- Use: "Secured the water supply serving the affected line, then ..."
- Use: "With the supply to the affected line isolated, ..." — efficient, since it folds
  step 2 into the same sentence.
- If the failure is on a drain/DWV line with no supply to isolate, the equivalent step is
  taking the fixture out of service: "The affected fixture was taken out of service before
  work began."
- NEVER: "confirmed the supply was already isolated," "found the water already shut off,"
  or anything else asserting a homeowner action before arrival.
- NEVER: "shut off the actively running water," "emergency shutoff," or anything else
  asserting the leak was still discharging.
- NEVER state how long the supply had been off, or who turned it off.
- You MAY add that the line was verified depressurized before cutting — that verifies the
  technician's own isolation rather than a pre-arrival condition.

Isolation belongs here and not in Site Findings because it is an action the technician
took, not a condition found on arrival — so writing it here does not conflict with the
Site Findings ban on valve position and pressure.

**Repair method — match the pipe material:**
- copper -> cut out the failure point, replace with Type L copper, solder or push-fit couplings.
- PEX / flexible -> replace the affected connector or line with code-compliant fittings.
- PVC (DWV) -> cut out the failure point, fit replacement PVC with couplings, replace the P-trap.
- CPVC -> cut out the failure point and replace with CPVC transition fittings.

**Access method — match the wall/access type:**
- tile -> protect surrounding tile and fixtures, cut and remove tile and backing for access.
- drywall -> cut and remove a drywall section.
- access panel -> open the existing panel; nothing is cut.
- under-sink / cabinet -> protect the cabinet interior and flooring; nothing is cut.

**Opening dimensions** — required whenever something was cut open, since they are the
evidentiary basis for the restoration scope that follows. Estimate from the scope:
- single supply-line access ≈ 1'x1' to 1.5'x1.5'
- drain, multi-fitting, or leak-search access ≈ 2'x2' to 2'x3'
- access panel and under-sink cabinet -> omit dimensions entirely; nothing was cut open.

**Fixture detach & reset** — if a fixture was detached, Work Performed must state that it
was detached before the work area was accessed.
- If the detached fixture WAS reinstalled by this technician (fixture_reinstalled is
  "yes"), also state that it was reset/reinstalled near the end (new wax ring,
  supply-line reconnection, or re-caulking, as applicable). Never mention the detach
  without the reset in this case.
- If it was NOT reinstalled by this technician (fixture_reinstalled is "no" — e.g. it is
  being replaced, or another trade will reinstall it), say so plainly instead: the fixture
  remains detached/removed, pending replacement or reinstallation by others. Do NOT
  describe a reset, reinstall, new wax ring, or re-caulking of that fixture anywhere in
  the report.

### WARRANTY (-> warranty_info)
- One sentence: 30-day workmanship warranty from date of service.

### NOTES (-> notes)
- 2-3 sentences max.
- Cover: drying advisory, monitoring recommendation, and that no additional issues were found.
- If tile or drywall was removed, add that restoration is pending and the cavity has been
  temporarily sealed.

## TONE
A professional field report written by a licensed technician — clear, factual, plain. Not
legal writing, not defensive, not formal for its own sake. This applies to every section.
Never describe the pipe or the damage as "compromised," a "failed section," or a "damaged
section"; name the specific failure instead. Avoid entirely: wear and tear, deterioration,
age-related, neglect, deferred maintenance.

## FINAL CHECK — verify every item before you output
1. Site Findings contains no technician action at all (isolation, protection, cutting,
   repair, testing) — including no "once exposed," "on opening," or similar phrasing that
   implies the wall was already cut into.
2. Site Findings names nothing inside the wall — no insulation, framing, studs, or subfloor.
   If wall_access_type means the component was enclosed, Site Findings names only a
   general suspected area, not a specific failure mode — that goes in Work Performed once
   access was actually made.
3. Nothing anywhere states or implies valve position or pressure on arrival, leak duration,
   water volume, age or wear, or homeowner fault.
4. The Work Performed opening does not say who isolated the supply or when, and does not
   imply the water was either still running or already off.
5. If water reached another level or room, it is described as active/fresh/wet and tied to
   this incident.
6. If a fixture was detached AND fixture_reinstalled is "yes", Work Performed describes
   BOTH detaching and resetting it. If fixture_reinstalled is "no", Work Performed
   describes the detach only and states the fixture remains removed pending
   replacement/reinstallation by others — it must NOT describe a reset, reinstall, new
   wax ring, or re-caulking of that fixture.
7. If anything was cut open, Work Performed states approximate dimensions.
8. work_performed is 3-4 sentences, not a list of micro-steps.
9. Work Performed does not contradict Site Findings.
10. Site Findings contains no sudden-vs-gradual conclusion (e.g. "rather than a gradual
    leak") and no moisture-meter reading of any kind.

## OUTPUT FORMAT
Return ONLY a valid JSON object — no markdown, no code fences, no commentary before or
after it. All eight keys are required, and every value is a string:
- `failed_component` — the specific component that failed
- `hours_estimate` — a decimal number written as a string, e.g. "3.5"
- `protection_needed` — exactly "yes" or "no"
- `fixture_detached` — the fixture name, or "" if nothing was detached
- `site_findings`, `work_performed`, `warranty_info`, `notes` — the sections written above

{{
  "failed_component": "...",
  "hours_estimate": "...",
  "protection_needed": "...",
  "fixture_detached": "...",
  "site_findings": "...",
  "work_performed": "...",
  "warranty_info": "...",
  "notes": "..."
}}"""

# ──────────────────────────────────────────────
# Step 2: Invoice from Work Performed
# ──────────────────────────────────────────────

INVOICE_PROMPT_TEMPLATE = """Price a realistic itemized invoice for the plumbing work described below, at DMV-area market rates.

## WORK PERFORMED
{work_performed}

## JOB CONTEXT
- **Incident type:** {incident_type}
- **Pipe material:** {pipe_material}
- **Wall / access type:** {wall_access_type}
- **Protection installed:** {protection_installed}
- **Fixture detached for access:** {fixture_detached}
- **Detached fixture reinstalled by this technician:** {fixture_reinstalled}
- **State:** {state} — regional pricing context only; see the tax rule below
- **Estimated hours on site:** {hours_estimate}

## LINE ITEMS — 4 to 6 total, in this order
1. **Emergency Dispatch Fee** — exactly one line, quantity 1, unit EA, $125-$200
   depending on urgency.
2. **Labor** — 2 to 3 phase lines, unit HR. Phase names must reflect the ACTUAL work in
   WORK PERFORMED above, e.g. "Labor - Isolation, Protection & Access" and
   "Labor - Repair, Testing & Seal-up".
3. **Fixture detach & reset labor** — one additional HR line, required ONLY if "Fixture
   detached for access" above names a real fixture (i.e. it is not empty and not "none")
   AND "Detached fixture reinstalled by this technician" is "yes". Name it for that
   fixture, e.g. "Labor - Toilet Detach & Reset" or "Labor - Vanity Detach & Reinstall".
   Typically 0.5-1.5 HR, kept separate from the other labor phases. If a fixture was
   detached but will NOT be reinstalled by this technician, instead use a "Labor -
   [Fixture] Detach" line (detach-only labor, no reset/reinstall wording) — still
   separate from the other labor phases.
4. **Materials** — exactly one line, quantity 1, unit LOT.

## PRICING

**Labor hours.** Spend your effort on realistic HOURS per phase, not on the dollar
figure: every HR line's unit_cost is normalized to the standard $185/hr rate
automatically after generation, so output 185.00 for each of them and do not vary it.
Total hours across all labor lines should fit the scope described — {hours_estimate} is
the starting reference; adjust up or down to match the work actually performed.

**Materials.** Build the LOT price bottom-up, by summing realistic DMV-area
retail/wholesale costs for the SPECIFIC items named in the work performed. Never pick a
round or placeholder number. Reference anchors, scaled to quantity and scope:
- Copper pipe (Type L) ~$8-12/ft · CPVC ~$3-5/ft · PEX ~$1-2/ft
- Copper fittings (elbow/coupling) ~$3-8 each · CPVC/PVC fittings ~$1-3 each
- Primer & cement (shared from a can) ~$8-15 · Solder & flux (partial use) ~$5-10
- Wax ring ~$8-15 · Toilet/appliance supply line ~$8-15 · Braided connector ~$10-20
- Protection plastic sheeting + tape ~$15-30
Include the temporary protection materials if protection was installed, and the fixture
reset materials (wax ring, caulk, supply line) ONLY if a fixture was detached AND will be
reinstalled by this technician. If the detached fixture will NOT be reinstalled by this
technician, do not include any reset/reinstall materials for it. The description must list
the actual items with approximate quantities.
**The Materials total must not equal $185.00 or any other line's total** — a match reads
as an unpriced placeholder rather than a real estimate. If your first pass lands on a
round number or a coincidental match, recompute it from the components.

**Tax.** Do not calculate tax, do not add a tax or sales-tax line item, and do not adjust
any price for tax. It is computed automatically after generation.

**No target total.** Price every line independently at realistic market rates; the invoice
total is simply whatever they add up to. Before responding, multiply quantity × unit_cost
for each line and sanity-check both the individual line totals and their sum against the
scope of work.

## OUTPUT FORMAT
Return ONLY a valid JSON object — no markdown, no code fences, no commentary:

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
      "description": "What was done in this phase",
      "quantity": 1.5,
      "unit": "HR",
      "unit_cost": 185.00
    }},
    {{
      "name": "Materials",
      "description": "Actual items used, with approximate quantities",
      "quantity": 1,
      "unit": "LOT",
      "unit_cost": 142.85
    }}
  ]
}}

That skeleton shows shape only — the item count, the names, the descriptions, and every
dollar figure except the 185.00 labor rate must come from the rules above."""


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
    fixture_reinstalled: bool = True,
) -> Optional[dict]:
    """
    2-step AI pipeline for plumber report generation.

    Step 1 (strong model): Scope & Assessment -> site_findings, work_performed,
            warranty, notes, plus AI-inferred failed_component, hours_estimate,
            protection_needed, and fixture_detached. pipe_material is a given
            input, not inferred — the technician knows what's actually there.
            fixture_reinstalled is also a given input (not inferred): whether
            the detached fixture was put back by this technician, or is being
            left detached (e.g. for replacement, or reinstall by another
            trade) — defaults to True to preserve prior behavior for callers
            that don't pass it.
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
        fixture_reinstalled="yes" if fixture_reinstalled else "no",
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
        fixture_reinstalled="yes" if fixture_reinstalled else "no",
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
