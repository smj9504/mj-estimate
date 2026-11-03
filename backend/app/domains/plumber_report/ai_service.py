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
import re
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
# Reasoning models (claude-sonnet-5) spend part of this on thinking — at 2000,
# Step 1's thinking often used all of it and the reply had no text at all.
ANTHROPIC_MAX_TOKENS = 8000
MAX_AI_PHOTOS = 10
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
- **How the problem was noticed (what led to the call):** {how_noticed}
- **Location in home:** {location}
- **Pipe material:** {pipe_material}
- **What was opened/torn out to access the issue:** {wall_access_type}
- **Fixture detached for access (if any):** {detached_fixture}
- **Was the detached fixture reinstalled by this technician?** {fixture_reinstalled}
- **Other areas the water reached (floors below, adjacent rooms/units):** {affected_areas}

## GROUND RULES — WHAT YOU CAN AND CANNOT KNOW

This report goes to an insurance adjuster and to the property owner, so every sentence
must stay true no matter which plausible real-world scenario actually occurred. The JOB
DETAILS above — plus what any attached photos clearly show (see PHOTOS below) — are the
only facts you have. Never state or imply anything they do not establish.

You do NOT know:
- **How long the leak ran, when it started, or how much water escaped.** A leak inside a
  wall can go unnoticed for an unknown length of time.
- **Whether the homeowner did anything at all before the technician arrived.** Many
  homeowners do not know where the main shutoff or an isolation valve is.
- **Whether water was still discharging when the technician arrived, or had stopped.**
- **Whether the water reached any other floor, room, or unit, beyond what JOB DETAILS
  lists.** A leak on an upper floor may or may not have reached the floors below — never
  infer it from the location alone.
- **The pipe material, if JOB DETAILS says it was not specified** — unless the incident
  description itself names it, or an attached photo clearly shows it.
- **The position of any valve, or the system pressure, on arrival.**
- **The condition of anything not visible without opening a wall, ceiling, or fixture** —
  insulation, framing, studs, subfloor. Not every wall even contains insulation; interior
  partition walls, bathroom walls especially, often do not.
- **The age, wear, deterioration, or maintenance history of the plumbing.** Nothing may
  suggest homeowner fault or a delayed response.

You DO know, and should write about: what led to the call (when JOB DETAILS give it), the
physical conditions visible at the surface, and the actions the technician performed.

{photos_section}

## INSTRUCTIONS

### INFERRED FIELDS (part of the output; they also feed the invoice step)
- **failed_component** — the specific pipe, fixture, or valve that failed, inferred from
  the incident type and location.
- **hours_estimate** — realistic total technician hours on site for this scope, written as
  a decimal string (e.g. "3.5").
- **protection_needed** — "yes" if tile, drywall, or other finished surfaces are involved
  (judge from the access type above), otherwise "no".
- **fixture_detached** — a fixture, trim piece, or appliance removed to reach the work
  area (e.g. "toilet", "vanity", "dishwasher"). Never a surface that
  was cut or removed for access — tile, backer board, drywall, plaster, ceiling, flooring,
  or an access panel. Removing those is part of the access step (step 4 of Work
  Performed), not a detached fixture. Use the value given in JOB DETAILS if one was
  provided, minus any such surface: if it names only a surface (e.g. "shower tile"),
  output ""; if it names a fixture and a surface (e.g. "toilet and floor tile"), keep
  only the fixture. If none was provided, infer it from the incident, location, and
  access context. Use "" if no fixture was detached.
- **pipe_material** — the pipe material the report names. Use the value given in JOB
  DETAILS if one was provided; if it says "not specified," use a material only when the
  incident description itself names one (e.g. "burst copper line") or an attached photo
  clearly shows it, otherwise "".
All five must stay consistent with the narrative sections below. Note: whether the
detached fixture was reinstalled is NOT inferred — it is given directly in JOB DETAILS
above as "Was the detached fixture reinstalled by this technician?" and must be followed
exactly wherever fixture_detached is non-empty.

### SITE FINDINGS (-> site_findings)

Purpose: what led to the call and what was observed on site, before any work. No
technician action of any kind (isolation, protection, cutting, repair, testing) belongs
here.

REQUIRED:
- **What led to the call — the basis for this repair.** The report has to show why an
  emergency visit and an opened wall were warranted, so state the evidence that pointed
  to this leak:
  - If "How the problem was noticed" in JOB DETAILS gives it, state it as what the
    homeowner reported (e.g. "The homeowner called after noticing water staining on the
    kitchen ceiling below and a drop in water pressure at the shower").
  - Then what the technician observed that located it — the surface indicators below,
    and the areas the water reached.
  - If it says "not specified," build the basis only from what is established: the
    problem named in the incident description, the areas the water reached, and what
    photos clearly show. When none of those shows a condition, the basis is the report
    itself — e.g. "Technician responded to a report of a burst supply line behind the
    shower wall." Never invent a symptom or a condition — no "sound of running water,"
    "drop in pressure," "staining," or "dampness" unless JOB DETAILS or a photo gives it.
- **Record what was present, never what was absent.** Do not write "no moisture," "no
  staining," "no visible signs of leakage," "no water damage was observed," or any other
  negative finding about the source area or the areas the water reached. A report that
  records no evidence of a leak and then bills an emergency call and an opened wall
  contradicts itself. If nothing beyond the reported problem is established, describe
  only that — say less rather than state that something was not there.
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
  floor or baseboard — and only the ones "How the problem was noticed," "Other areas the
  water reached," or a photo establishes. Do NOT mention a moisture-meter reading: no input here carries an
  actual measured value, and citing an instrument reading with no number — or inventing
  one — either hands an adjuster an unanswerable "what was the reading?" or puts a
  fabricated figure in a report that has to hold up under scrutiny. If a real reading is
  ever captured, it must ship with its baseline (e.g. "32% WME at the wall base vs. 9% on
  unaffected wall in the same room") — a number with nothing to compare it to isn't
  meaningful either. Nothing inside the wall: naming or characterizing insulation, framing,
  or studs requires opening the wall, which is a technician action and belongs in Work
  Performed.
- One plain mention, exactly once, that the homeowner reported no signs of leakage before
  this event — worded so it clearly refers to the time before the problem appeared (e.g.
  "The homeowner reported no signs of leakage before the ceiling stain appeared"), never
  as a finding about the conditions found on site.
- **Other areas the water reached — follow "Other areas the water reached" in JOB
  DETAILS exactly.**
  - If it lists areas, name every one of them, and qualify each as active, fresh, or wet
    and tied to this incident — e.g. "active water staining was visible on the 1st-floor
    kitchen ceiling below," or "fresh staining consistent with the leak was noted on the
    basement ceiling." When water traveled through more than one level (e.g. a 2nd-floor
    leak that reached both the 1st floor and the basement), describe each level, top to
    bottom, so the full path of this incident is on record. Bare "staining" with no
    qualifier reads as an old, unrelated mark and gives an adjuster room to argue the
    damage is pre-existing rather than new. ("Active" and "fresh" here describe the mark
    as new and wet — they are not a claim that water is still flowing, which stays
    off-limits.) Surface indicators only, as above — nothing inside those ceilings or
    walls.
  - If it says "none reported," do not mention water reaching any other floor, room, or
    unit at all — not even when the location is on an upper floor.

OPENING SENTENCE — open on what led to the call (or, if that is not specified, on the
observed condition), and vary it; do not always start with "Upon arrival":
- "The homeowner called after noticing..."
- "Service was requested after..."
- "Technician responded to a report of..."
- Or, only when JOB DETAILS or a photo establishes the condition, lead straight into it:
  "Water staining was visible on the ceiling below..."
Whichever you choose, do not characterize the leak as either still discharging or already
stopped on arrival — neither is knowable. "Water was present at
the base of the wall" is safe; "water was actively discharging" and "the leak had since
stopped" are both not.

NEVER in Site Findings: valve position or pressure on arrival; any suggestion the supply
was "still running" or left unattended; estimated leak duration or water volume; age, wear,
deterioration, or maintenance history; homeowner fault or delayed response; any technician
action; any statement that moisture, staining, or signs of leakage were absent.

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
- not specified (pipe_material is "") -> do not name a pipe material anywhere in the
  report; describe the repair as cutting out the failure point and replacing it with
  code-compliant pipe and fittings matching the existing line.

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
- 2-3 sentences max. Every statement must agree with Site Findings and Work Performed —
  Notes add no condition that those sections do not record.
- Drying advisory, matched to what was recorded: if Site Findings or Work Performed
  records water, wetness, or staining, advise that the affected materials be dried and
  confirmed dry before restoration. If neither records any, do not say anything is wet or
  needs to dry — recommend instead that the opened cavity be checked for moisture before
  it is closed up.
- A monitoring recommendation, and that no other plumbing issues were found in the work
  area.
- If tile or drywall was removed, add that restoration is pending and the cavity has been
  temporarily sealed.
- If water reached other areas (per JOB DETAILS), add that those areas should also be
  evaluated for drying and restoration.

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
5. Every area listed under "Other areas the water reached" is named in Site Findings and
   described as active/fresh/wet and tied to this incident. If none were reported, no
   other floor, room, or unit is mentioned anywhere.
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
11. If pipe_material is "", no pipe material is named anywhere in the report.
12. Site Findings states what led to the call (or, if that is not specified, the
    established basis) and invents no symptom, and no staining, dampness, or water that
    JOB DETAILS or a photo does not establish. It contains no statement that moisture,
    staining, or signs of leakage were absent, and its "no signs of leakage" mention
    refers only to the time before this event.
13. Notes agree with Site Findings and Work Performed — nothing in Notes says a material
    is wet or must dry unless water, wetness, or staining is recorded there.
14. fixture_detached is a fixture, trim piece, or appliance — never tile, backer board,
    drywall, plaster, ceiling, flooring, or an access panel.

## OUTPUT FORMAT
Return ONLY a valid JSON object — no markdown, no code fences, no commentary before or
after it. All nine keys are required, and every value is a string:
- `failed_component` — the specific component that failed
- `hours_estimate` — a decimal number written as a string, e.g. "3.5"
- `protection_needed` — exactly "yes" or "no"
- `fixture_detached` — the fixture name, or "" if nothing was detached
- `pipe_material` — the pipe material the report names, or "" if none
- `site_findings`, `work_performed`, `warranty_info`, `notes` — the sections written above

{{
  "failed_component": "...",
  "hours_estimate": "...",
  "protection_needed": "...",
  "fixture_detached": "...",
  "pipe_material": "...",
  "site_findings": "...",
  "work_performed": "...",
  "warranty_info": "...",
  "notes": "..."
}}"""

NO_PHOTOS_SECTION = "## PHOTOS\nNo photos were attached — rely on JOB DETAILS only."

PHOTOS_SECTION_TEMPLATE = """## PHOTOS
{photo_count} photo(s) taken by the technician are attached, labeled in this order:
{photo_list}

How to use them:
- **BEFORE photos** show conditions at time of service, before the work. Use what they
  clearly show for Site Findings: water on the floor or baseboard, staining, soft or
  bulging drywall, the failed component and its failure mode when it is exposed in the
  photo. A BEFORE photo that already shows an opened wall or ceiling was taken during the
  access step — its failure mode belongs in Work Performed, not Site Findings.
- **AFTER photos** show the completed repair. Use what they clearly show for Work
  Performed: the replacement pipe and fittings, the repair method, the size of any opening
  (to estimate its dimensions), protection, and the temporary seal over the cavity.
- What a photo clearly shows counts as an established fact, the same as JOB DETAILS. What
  is unclear, partly hidden, or open to more than one reading does not — leave it out.
- JOB DETAILS take precedence wherever a photo seems to conflict with them; photos only
  fill in what JOB DETAILS leave open (e.g. a pipe material that was not specified).
- Another floor, room, or unit counts as reached by the water only when JOB DETAILS list
  it, or a photo caption names that area. Never infer it from an uncaptioned photo.
- Every ground rule above still applies. A photo cannot establish how long the leak ran,
  how much water escaped, or what anyone did before arrival. Even if a photo shows
  discoloration, corrosion, or mineral buildup on the pipe, do not describe it — the
  no-age/no-wear rule overrides what a photo shows.
- Write the report as the technician's own observations. Do not refer to the photos
  ("as shown in Photo 2") or describe them as photos."""

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
   detached for access" above names a real fixture (i.e. it is not empty and not "none",
   and not tile, backer board, drywall, or another surface opened for access — that is
   access labor) AND "Detached fixture reinstalled by this technician" is "yes". Name it for that
   fixture, e.g. "Labor - Toilet Detach & Reset" or "Labor - Vanity Detach & Reinstall".
   Typically 0.5-1.5 HR, kept separate from the other labor phases. If a fixture was
   detached but will NOT be reinstalled by this technician, instead use a "Labor -
   [Fixture] Detach" line (detach-only labor, no reset/reinstall wording) — still
   separate from the other labor phases.
4. **Materials** — exactly one line, quantity 1, unit LOT.

**Bill each task once.** Each task in WORK PERFORMED belongs to exactly one line. Opening
the wall, ceiling, or floor — protecting it, then cutting and removing tile, backer board,
or drywall — is access labor and stays inside the access phase. It never gets a line of
its own: no "Tile Detach," "Drywall Removal," or similar line may sit beside a phase that
already covers it. A detached fixture's detach and its reset both go in that fixture's
own line, never in the access phase. Before responding, read the names and descriptions
of all the labor lines together and make sure no two of them describe the same work.

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
the actual items with approximate quantities. If the pipe material is not specified, list
the pipe items generically (e.g. "replacement pipe section and fittings to match existing")
rather than naming a material, and price them at a mid-range of the anchors above.

**Quantities follow the opening.** Every quantity must fit the work in WORK PERFORMED:
- Pipe: the replaced section can be no longer than the pipe exposed in the opening — at
  most the opening's longest side as stated in WORK PERFORMED (e.g. a 1.5' x 2' opening
  means 1-2 ft of pipe, not 8 ft). Price the feet used, not a full stick. Where nothing
  was cut open (access panel, under-sink), price a short section or a single connector.
- Fittings: typically 2 couplings per replaced section; add elbows, tees, or valves only
  if WORK PERFORMED names them.
- Protection and seal-up supplies: sized to the area worked, not a whole room.

**The Materials total must not equal $185.00 or any other line's total** — a match reads
as an unpriced placeholder rather than a real estimate. If your first pass lands on a
round number or a coincidental match, recompute it from the components.

**Tax.** Do not calculate tax, do not add a tax or sales-tax line item, and do not adjust
any price for tax. It is computed automatically after generation.

**No target total.** Price every line independently at realistic market rates; the invoice
total is simply whatever they add up to. Before responding, multiply quantity × unit_cost
for each line and sanity-check both the individual line totals and their sum against the
scope of work, and check that every quantity in the Materials description fits the
opening.

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
    affected_areas: str = "",
    how_noticed: str = "",
    photos: Optional[list] = None,
) -> Optional[dict]:
    """
    2-step AI pipeline for plumber report generation.

    Step 1 (strong model): Scope & Assessment -> site_findings, work_performed,
            warranty, notes, plus AI-inferred failed_component, hours_estimate,
            protection_needed, fixture_detached, and pipe_material. pipe_material
            is optional: when the technician leaves it blank, the model uses one
            only if the incident text or a photo clearly shows it, otherwise
            the report stays material-neutral. affected_areas lists the other
            floors/rooms/units the water reached; blank on a 2nd-floor-or-
            higher leak means the ceiling directly below (see
            _resolve_affected_areas), "none" means none, and the model never
            adds areas of its own. how_noticed is what led to the
            call (ceiling stain below, low pressure, ...) — Site Findings
            opens on it as the basis for the repair; blank means the model
            builds that basis from the other inputs and never invents a
            symptom. photos ({url, category, caption}
            with category "before"/"after") are sent to the model as images —
            Step 1 only, since the invoice prices Step 1's work_performed.
            fixture_reinstalled is a given input (not inferred): whether
            the detached fixture was put back by this technician, or is being
            left detached (e.g. for replacement, or reinstall by another
            trade) — defaults to True to preserve prior behavior for callers
            that don't pass it.
    Step 2 (fast model): Invoice -> invoice_items priced at realistic DMV market
            rates from Step 1's inferred scope (no fixed target). It takes
            the detached fixture from Step 1, which drops a surface typed
            into that box ("shower tile") so the invoice doesn't bill tile
            removal twice — once in access labor and again as a detach line.

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

    images = _prepare_photos(photos)
    if images:
        photos_section = PHOTOS_SECTION_TEMPLATE.format(
            photo_count=len(images),
            photo_list="\n".join(f"- {img['label']}" for img in images),
        )
    else:
        photos_section = NO_PHOTOS_SECTION

    # ── Step 1: Scope & Assessment ──
    logger.info(f"AI Step 1/2: Generating scope & assessment ({len(images)} photo(s))...")
    scope_prompt = SCOPE_PROMPT_TEMPLATE.format(
        incident_type=incident_type,
        how_noticed=(how_noticed or "").strip() or "not specified",
        location=location,
        pipe_material=(pipe_material or "").strip() or "not specified",
        wall_access_type=wall_access_type,
        detached_fixture=detached_fixture or "none specified — infer from context if applicable",
        fixture_reinstalled="yes" if fixture_reinstalled else "no",
        affected_areas=_resolve_affected_areas(affected_areas, location),
        photos_section=photos_section,
    )

    scope_data = _call_ai_json(scope_prompt, "work_performed", strong=True, images=images)
    if scope_data is None:
        logger.error("Step 1 failed: all providers returned unusable output")
        return None

    logger.info("AI Step 1/2 complete.")

    # ── Step 2: Invoice from work performed ──
    logger.info("AI Step 2/2: Generating invoice from work performed...")
    invoice_prompt = INVOICE_PROMPT_TEMPLATE.format(
        work_performed=scope_data["work_performed"],
        incident_type=incident_type,
        pipe_material=(
            (pipe_material or "").strip()
            or scope_data.get("pipe_material")
            or "not specified"
        ),
        wall_access_type=wall_access_type,
        protection_installed=scope_data.get("protection_needed") or "yes",
        fixture_detached=scope_data.get("fixture_detached", detached_fixture) or "none",
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
# Areas the water reached
# ──────────────────────────────────────────────

_FLOOR_NUMBER_RE = re.compile(
    r"\b([2-9])(?:st|nd|rd|th)?[\s-]*(?:fl(?:oor)?|story|storey|level|f)\b", re.IGNORECASE
)
_FLOOR_WORD_RE = re.compile(
    r"\b(second|third|fourth|fifth)[\s-]+(?:floor|story|storey|level)\b", re.IGNORECASE
)
_UPSTAIRS_RE = re.compile(r"\b(?:upstairs|upper[\s-]+(?:floor|level))\b", re.IGNORECASE)
_FLOOR_WORDS = {"second": 2, "third": 3, "fourth": 4, "fifth": 5}
_ORDINAL_SUFFIXES = {1: "st", 2: "nd", 3: "rd"}
_NONE_ANSWERS = {"none", "no", "n/a", "na", "nothing", "none reported"}


def _ordinal(n: int) -> str:
    return f"{n}{_ORDINAL_SUFFIXES.get(n, 'th')}"


def _resolve_affected_areas(affected_areas: str, location: str) -> str:
    """
    The "Other areas the water reached" value the model sees. Left blank on a
    leak at the 2nd floor or above, it is the ceiling directly below — water
    from an upper floor almost always reaches the floor below, so the report
    records it by default (user's call, 2026-11-03). The technician types
    "none" when the water stayed on that floor.
    """
    areas = (affected_areas or "").strip()
    if areas.lower().strip(" .!") in _NONE_ANSWERS:
        return "none reported"
    if areas:
        return areas

    match = _FLOOR_NUMBER_RE.search(location or "")
    if match:
        return f"{_ordinal(int(match.group(1)) - 1)} floor ceiling directly below the source"
    match = _FLOOR_WORD_RE.search(location or "")
    if match:
        floor = _FLOOR_WORDS[match.group(1).lower()]
        return f"{_ordinal(floor - 1)} floor ceiling directly below the source"
    if _UPSTAIRS_RE.search(location or ""):
        return "ceiling of the floor directly below the source"
    return "none reported"


# ──────────────────────────────────────────────
# Photos
# ──────────────────────────────────────────────

_DATA_URL_RE = re.compile(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", re.DOTALL)
_SUPPORTED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


def _prepare_photos(photos: Optional[list]) -> list:
    """
    Turn {url, category, caption} photo records into image inputs the
    providers accept: a base64 data URL is split into media_type + data,
    an http(s) URL is passed through. BEFORE photos are ordered ahead of
    AFTER ones, and anything past MAX_AI_PHOTOS or in an unsupported format
    is skipped (logged) rather than failing the whole generation.
    """
    order = {"before": 0, "after": 1}
    sorted_photos = sorted(
        photos or [],
        key=lambda p: order.get((p.get("category") or "").lower(), 2),
    )

    images = []
    for photo in sorted_photos:
        if len(images) >= MAX_AI_PHOTOS:
            logger.warning(f"More than {MAX_AI_PHOTOS} photos attached — extra photos not sent to AI")
            break
        url = (photo.get("url") or "").strip()
        image = {}
        match = _DATA_URL_RE.match(url)
        if match:
            media_type = match.group(1).lower()
            if media_type not in _SUPPORTED_IMAGE_TYPES:
                logger.warning(f"Skipping photo with unsupported type {media_type}")
                continue
            image.update(media_type=media_type, data=match.group(2))
        elif url.startswith(("http://", "https://")):
            image["url"] = url
        else:
            logger.warning("Skipping photo with no usable image URL")
            continue

        category = (photo.get("category") or "").lower()
        stage = {"before": "BEFORE repair", "after": "AFTER repair"}.get(category, "photo")
        label = f"Photo {len(images) + 1} — {stage}"
        caption = (photo.get("caption") or "").strip()
        if caption:
            label += f": {caption}"
        image["label"] = label
        images.append(image)
    return images


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
    images: Optional[list] = None,
) -> Optional[dict]:
    """
    Call OpenAI (if enabled), then Anthropic, retrying across all enabled
    providers for up to `max_rounds` rounds, until one returns a parseable
    JSON object containing `required_key`. `images` (from _prepare_photos)
    are sent ahead of the prompt, each preceded by its label.

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
                raw = call(prompt, model, images or [])
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


def _call_openai(prompt: str, model: str, images: list) -> Optional[str]:
    """Call OpenAI API in JSON mode."""
    api_key = settings.OPENAI_API_KEY
    if not api_key:
        logger.warning("No OPENAI_API_KEY configured")
        return None

    if images:
        user_content = []
        for img in images:
            url = img.get("url") or f"data:{img['media_type']};base64,{img['data']}"
            user_content.append({"type": "text", "text": img["label"]})
            user_content.append({"type": "image_url", "image_url": {"url": url}})
        user_content.append({"type": "text", "text": prompt})
    else:
        user_content = prompt

    try:
        import openai
        client = openai.OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
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


def _call_anthropic(prompt: str, model: str, images: list) -> Optional[str]:
    """
    Call Anthropic API as fallback.

    Optionally uses `temperature` and an assistant-turn '{' prefill (to bias
    toward clean, code-fence-free JSON). Some models — e.g. claude-sonnet-5,
    a reasoning model — reject one or both with a 400 ("temperature is
    deprecated for this model" / "does not support assistant message
    prefill"); an older installed SDK can also reject `temperature` locally
    as a TypeError, before any request is sent. Rather than hardcode
    per-model capability, each is dropped on its own confirmed rejection and
    the call retried; this terminates in at most 3 attempts since each retry
    strictly removes one of the two. The
    resolved configuration is cached per-model so future calls skip straight
    to it (see _anthropic_model_capabilities).
    """
    api_key = settings.ANTHROPIC_API_KEY
    if not api_key:
        logger.warning("No ANTHROPIC_API_KEY configured")
        return None

    if images:
        user_content = []
        for img in images:
            if "url" in img:
                source = {"type": "url", "url": img["url"]}
            else:
                source = {"type": "base64", "media_type": img["media_type"], "data": img["data"]}
            user_content.append({"type": "text", "text": img["label"]})
            user_content.append({"type": "image", "source": source})
        user_content.append({"type": "text", "text": prompt})
    else:
        user_content = prompt

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)

        cached = _anthropic_model_capabilities.get(model, {})
        use_temperature = cached.get("temperature", True)
        use_prefill = cached.get("prefill", True)
        while True:
            messages = [{"role": "user", "content": user_content}]
            if use_prefill:
                messages.append({"role": "assistant", "content": "{"})
            kwargs = dict(model=model, max_tokens=ANTHROPIC_MAX_TOKENS, system=SYSTEM_PROMPT, messages=messages)
            if use_temperature:
                kwargs["temperature"] = AI_TEMPERATURE

            try:
                response = client.messages.create(**kwargs)
                break
            except (anthropic.BadRequestError, TypeError) as e:
                # TypeError: an older SDK whose Messages.create() signature has
                # no `temperature` parameter at all rejects it locally, before
                # any request is sent. Same remedy as the API's 400 — drop the
                # parameter and retry — so it is handled on the same path.
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
