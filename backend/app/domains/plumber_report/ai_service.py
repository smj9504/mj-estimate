"""
AI Report Generator for Plumber Reports.

The technician enters only what is known on site: the source of the leak
(floor, room, fixture, leaking part), the pipe material, and whether the water
reached the floor below. From that:

Step 1: Repair plan — the model lays out how this leak is repaired, start to
        finish, across every trade, and names the trade for each step. Code
        keeps only the plumber's steps: that is the technician's scope.
Step 2: Report — site_findings, work_performed, warranty, notes, written from
        the plumber's steps only.
        Invoice — line items priced from the same plumber's steps. It runs
        alongside the report, since both read the plan, not each other.

Pricing note: the labor hourly rate and sales tax are NOT left to the model.
They are deterministic functions of (state, materials cost) and are applied
in code after generation — see generate_plumber_report().
"""

import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional

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
# Step 1: Repair plan — every trade, then the plumber's part
# ──────────────────────────────────────────────

REPAIR_PLAN_PROMPT_TEMPLATE = """A water leak was reported in a home in the DMV area (DC, Maryland, Virginia). Work out
how it is repaired, from the plumber's first response through the finished
restoration, and assign every step to the trade that does it.

## THE LEAK
{source}
- **Pipe material:** {pipe_material}
- **Did the water reach the floor below?** {below}

{photos_section}

## DECIDE

**failed_component**: the specific line, valve, or connector at this source that the
repair replaces, named by what it is and where it runs (e.g. "hot-water supply line
feeding the shower mixing valve, inside the shower wall"; "cold-water angle stop valve
under the kitchen sink"). Name how it failed (split, pinhole, cracked fitting), or
whether it is the hot or the cold side, only if a photo clearly shows it.

**line_type**: "supply" for a pressurized water line, valve, or connector; "drain" for a
drain, waste, or vent line.

**access**: how the plumber reaches the failed component, by the route a DMV plumber
would normally take for this fixture and part, opening as little finished surface as
the repair allows.
- `surface`: exactly one of "tile", "drywall", "ceiling", "access panel",
  "under-sink cabinet", "exposed" (nothing in the way, e.g. an unfinished basement, or
  behind an appliance that is pulled out).
- `where`: where that is (e.g. "shower valve wall, around the valve trim";
  "1st-floor ceiling directly below the shower").
- `opening`: approximate size of the cut, e.g. "1.5' x 1.5'". A single supply line or
  valve needs about 1' x 1' to 1.5' x 1.5'; a drain, several fittings, or a search for
  the leak about 2' x 2' to 2' x 3'. Use "" when nothing is cut (access panel,
  under-sink cabinet, exposed).
- If an AFTER photo shows the opening, follow the photo.

**fixture_detached**: a fixture or appliance the plumber has to take out to reach the
work, and set back afterward (e.g. "toilet", "vanity", "dishwasher", "washing
machine"). Use "" when none. Never a surface that is cut (tile, backer board, drywall,
ceiling, flooring): cutting is the access step. Small trim taken off and put back as
part of the repair (a valve handle and escutcheon, a faucet handle) is not a detached
fixture.

**fixture_reset_by_plumber**: true if the plumber sets the detached fixture back after
the repair, which is the normal case; false only if it cannot go back until another
trade finishes (e.g. the vanity sits on flooring that has to be replaced). false when
no fixture is detached.

**protection_needed**: "yes" if finished surfaces or fixtures around the work area are
protected, which they are before cutting (tile, drywall, ceiling, finished floor,
cabinetry) and before a toilet or appliance is pulled across a finished floor;
otherwise "no".

**Keep it coherent**: failed_component, access, and fixture_detached all describe the
same spot. If the failed part is reached under the sink, the appliance is not also
pulled; if the appliance is pulled, the failed part is at the appliance end.

**steps**: the whole repair in order, one task per step, each with its trade.

**materials**: everything the plumber's steps use, as a list of items with quantities:
the replacement pipe, valve, or connector; the fittings at each end of it; and the
consumables those joints and steps need (solder and flux, primer and cement, crimp
rings, a wax ring for a reset toilet, protection sheeting and tape). Thread tape only
where a threaded joint is made. Pipe no longer than the opening's longest side. Exactly
what the repair needs; nothing "just in case".

**hours_estimate**: realistic total hours the plumber spends on site doing the plumber's
steps, as a decimal string (e.g. "3.5"). For one plumber on straightforward work:
- replacing an exposed connector (toilet, faucet, or appliance supply line): 0.5-1
- replacing an exposed stop valve or trap: 0.75-1.5
- pulling and resetting an appliance or toilet: add 0.5-1
- a supply line or valve behind tile or drywall (protect, open, repair, test, seal):
  2.5-3.5
- a drain line through a ceiling or wall opening: 2.5-3.5

## WHO DOES WHAT

The plumber's part ends when the line is repaired, tested, and the opening is
temporarily sealed. Use these trade names: "plumber", "water mitigation", "drywall",
"tile", "painter", "carpentry", "flooring".

**plumber**
- Isolate the supply serving the affected line (supply line): write it as "Isolate the
  water supply serving ...", never "shut off", since the water may already have been
  off when the plumber arrived. For a drain line there is no supply to isolate: "Take
  the [fixture] out of service."
- Protect finished surfaces and fixtures around the work area (see protection_needed).
- Take out the detached fixture, if any, and set it back after the repair. Turn off an
  appliance's power before pulling it, and secure it in place when it is set back.
- Cut the access opening to reach the failed component: the opening the repair needs,
  nothing beyond it.
- Repair or replace the failed section, valve, or connector (methods below).
- Restore service and check the repair for leaks: under normal line pressure (supply),
  or, once the solvent cement has cured, by filling and draining the fixture (drain).
  After an appliance is set back, run it through a fill-and-drain cycle and check its
  connections; after a toilet, flush it and check its connections.
- Temporarily seal the access opening with plastic sheeting and tape.

**Not the plumber**
- Evaluating and drying wet materials, drying equipment, moisture monitoring, and any
  removal of wet materials so they can dry, including on the floor below:
  "water mitigation".
- Rebuilding what was opened or removed: backer board, waterproofing, tile, and grout:
  "tile"; drywall patch, tape, and finish: "drywall"; prime and paint: "painter";
  vanity, cabinet, or trim: "carpentry"; floor covering: "flooring".
Write the other trades' steps as what they would evaluate or do ("Evaluate and dry the
1st-floor ceiling below"), without asserting a condition nobody recorded ("Remove the
saturated drywall").

If the water reached the floor below, add the mitigation and restoration steps for that
ceiling. The plumber does not open it unless it is the access route chosen above.

**Repair method by part**
- Flexible connector (toilet, faucet, dishwasher, washing machine, or ice maker supply
  line): replace the whole connector with a new one of the right length and end
  connections; nothing is cut out or coupled.
- Stop valve: replace the valve with one that fits the line's connection.
- Trap or joint closed up inside a wall or ceiling afterward: solvent-welded or soldered
  joints only, never slip-joint or compression fittings, which must stay accessible.

**Repair method by pipe material** (for a section of pipe; the existing pipe can't be
pulled apart to make room, so rigid pipe takes repair couplings, which have no stop and
slide fully onto the pipe)
- copper: cut out the failure point; replace with Type L copper and soldered repair
  couplings.
- PEX: cut out the failure point; replace with PEX and crimp couplings.
- CPVC: cut out the failure point; replace with CPVC and solvent-welded repair
  couplings.
- PVC (DWV): cut out the failure point; replace with PVC and solvent-welded repair
  couplings.
- cast iron: cut out the failed section; replace it with PVC joined to the cast iron with
  shielded no-hub couplings.
- braided stainless: replace the connector.
- not specified: replace the failed section with code-compliant pipe and fittings
  matching the existing line, and name no pipe material, joining method (solder, crimp,
  solvent weld), or material-specific supply anywhere, unless a photo clearly shows the
  material, in which case use that material's method. A new flexible connector, being a
  new part rather than the existing pipe, may still be named "braided stainless".

## HOW TO WRITE EACH TASK
- An action, specific to this job: "Cut and remove a 1.5' x 1.5' section of tile and
  backer board around the shower valve," not "Open the wall."
- One decided action per step. Never a conditional ("replace the P-trap if the failure
  is at the trap") and never alternatives ("crimp or expansion fittings", "main or
  branch shutoff"): each step becomes part of a finished report, so pick the one a
  plumber would do here.
- Plumbing work only: no incidental chores as steps (moving stored items, wiping down).
- No detail nothing establishes: not "hot" or "cold" (say "supply line", "stop valve")
  unless a photo shows which side.
- State no condition as fact: nothing about how long the leak ran, whether water was
  still running, what anyone did before the plumber arrived, or the age or condition of
  the plumbing.

## OUTPUT FORMAT
Return ONLY a valid JSON object: no markdown, no code fences, no commentary.
`pipe_material` is the material given above, or the one a photo clearly shows, or "".

{{
  "failed_component": "...",
  "line_type": "supply",
  "pipe_material": "...",
  "access": {{"surface": "...", "where": "...", "opening": "..."}},
  "fixture_detached": "",
  "fixture_reset_by_plumber": false,
  "protection_needed": "yes",
  "hours_estimate": "3.5",
  "steps": [
    {{"trade": "plumber", "task": "..."}},
    {{"trade": "water mitigation", "task": "..."}}
  ],
  "materials": [
    {{"item": "...", "quantity": "..."}}
  ]
}}"""

# ──────────────────────────────────────────────
# Step 2a: Report from the plumber's steps
# ──────────────────────────────────────────────

REPORT_PROMPT_TEMPLATE = """Write the field report sections for this plumbing service call.

## JOB DETAILS
{source}
- **Pipe material:** {pipe_material}
- **Other areas the water reached (floors below):** {affected_areas}

## THE TECHNICIAN'S WORK

The plumber's part of the repair plan for this leak: what the technician did on this
call. The report covers this work and nothing else.

- **Failed component:** {failed_component}
- **Line type:** {line_type}
- **Access:** {access}
- **Finished surfaces protected before cutting:** {protection}
- **Fixture detached for access:** {fixture}
- **Steps, in order:**
{plumber_steps}

## LEFT FOR OTHER TRADES (not done by the technician)
{other_trades}

The report never describes any of this as the technician's work.

## GROUND RULES — WHAT YOU CAN AND CANNOT KNOW

This report goes to an insurance adjuster and to the property owner, so every sentence
must stay true no matter which plausible real-world scenario actually occurred. The
sections above, plus what any attached photos clearly show (see PHOTOS below), are the
only facts you have. Never state or imply anything they do not establish.

You do NOT know:
- **How the component failed** (split, pinhole, separated fitting, cracked valve body).
  THE TECHNICIAN'S WORK names which component failed, not how. Name a failure mode only
  if an attached photo clearly shows it; otherwise say where the leak was found (e.g.
  "the leak was at the supply line feeding the shower valve").
- **Whether it was the hot or the cold side**, unless a photo clearly shows it. Write
  "supply line" or "stop valve", even if the steps above say "hot" or "cold".
- **How long the leak ran, when it started, or how much water escaped.** A leak inside a
  wall can go unnoticed for an unknown length of time.
- **Whether the homeowner did anything at all before the technician arrived.** Many
  homeowners do not know where the main shutoff or an isolation valve is.
- **Whether water was still discharging when the technician arrived, or had stopped.**
- **Whether the water reached any other floor, room, or unit, beyond what JOB DETAILS
  lists.** A leak on an upper floor may or may not have reached the floors below; never
  infer it from the location alone.
- **The pipe material, if JOB DETAILS says it was not specified**, unless an attached
  photo clearly shows it.
- **The position of any valve, or the system pressure, on arrival.**
- **The condition of anything not visible without opening a wall, ceiling, or fixture**:
  insulation, framing, studs, subfloor. Not every wall even contains insulation;
  interior partition walls, bathroom walls especially, often do not.
- **The age, wear, deterioration, or maintenance history of the plumbing.** Nothing may
  suggest homeowner fault or a delayed response.

You DO know, and should write about: the leak reported at the source, the physical
conditions at the surface that JOB DETAILS or a photo establishes, and the work the
technician performed.

{photos_section}

## INSTRUCTIONS

### SITE FINDINGS (-> site_findings)

Purpose: why the technician was called and what was observed on site, before any work.
No technician action of any kind (isolation, protection, cutting, repair, testing)
belongs here.

REQUIRED:
- **What led to the call: the basis for this repair.** The report has to show why an
  emergency visit and an opened wall were warranted:
  - The reported leak at the source, named by floor, room, and fixture, e.g.
    "Technician responded to a reported leak at the shower in the 2nd-floor master
    bathroom."
  - Then the evidence of it that was visible on site: the areas the water reached (see
    below) and what photos clearly show.
  - Never invent a symptom or a condition: no "sound of running water," "drop in
    pressure," "staining," or "dampness" unless JOB DETAILS or a photo gives it. When
    nothing beyond the reported leak is established, the report of the leak is the
    basis; say no more than that.
- **Record what was present, never what was absent.** Do not write "no moisture," "no
  staining," "no visible signs of leakage," "no water damage was observed," or any other
  negative finding about the source area or the areas the water reached. A report that
  records no evidence of a leak and then bills an emergency call and an opened wall
  contradicts itself. Say less rather than state that something was not there.
- **The component believed to have failed, and where the leak was, as precisely as is
  knowable without opening anything.** That depends on Access:
  - Exposed component (access panel, under-sink cabinet, or "exposed"): state where the
    leak was on it (e.g. "The leak was at the stop valve under the sink"), and its
    failure mode only if a photo clearly shows it. Write "was at" or "was located at",
    not "was traced to": tracing is a technician action.
  - Enclosed behind tile, drywall, or a ceiling: describe only the general suspected
    area (e.g. "a leak believed to be at the supply line running through this section of
    wall"). Work Performed confirms where the leak was once access was made. Do NOT
    write "once exposed..." or "upon opening..." here; that describes a cutting action.
  Either way, never write "compromised," "failed section," or "damaged section": vague
  terms read as implying wear or age even when that is not intended.
- **Never draw a conclusion about whether the failure was sudden or gradual**, e.g.
  never write "this appears to have been a sudden failure rather than a gradual leak."
  That is an argued conclusion aimed at an insurance objection, not an observation, and
  it can conflict with staining language a sentence away.
- **Surface-level moisture indicators only**: staining or discoloration on drywall or
  paint, drywall soft to the touch, visible water on the floor or baseboard, and only
  the ones "Other areas the water reached" or a photo establishes. Do NOT mention a
  moisture-meter reading: no input carries a measured value, and citing an instrument
  reading with no number, or inventing one, hands an adjuster an unanswerable "what was
  the reading?" Nothing inside the wall: naming or characterizing insulation, framing,
  or studs requires opening the wall, which belongs in Work Performed.
- One plain mention, exactly once, that the homeowner reported no signs of leakage
  before this event, worded so it clearly refers to the time before the problem
  appeared (e.g. "The homeowner reported no signs of leakage at the shower before this
  event"), never as a finding about the conditions found on site.
- **Other areas the water reached: follow JOB DETAILS exactly.**
  - If it lists areas, name every one of them, and qualify each as active, fresh, or wet
    and tied to this incident, e.g. "active water staining was visible on the 1st-floor
    kitchen ceiling below." Bare "staining" with no qualifier reads as an old, unrelated
    mark and gives an adjuster room to argue the damage is pre-existing. ("Active" and
    "fresh" describe the mark as new and wet; they are not a claim that water is still
    flowing, which stays off-limits.) Surface indicators only, nothing inside those
    ceilings or walls.
  - If it says "none reported," do not mention water reaching any other floor, room, or
    unit at all, not even when the source is on an upper floor.

OPENING SENTENCE: open on the reported leak (or, only when JOB DETAILS or a photo
establishes a visible condition, on that condition), and vary it; do not always start
with "Upon arrival":
- "Service was requested for a leak at..."
- "Technician responded to a reported leak at..."
- "Water staining was visible on the 1st-floor ceiling below..." (only when established)
Whichever you choose, do not characterize the leak as either still discharging or
already stopped on arrival; neither is knowable.

NEVER in Site Findings: valve position or pressure on arrival; any suggestion the supply
was "still running" or left unattended; estimated leak duration or water volume; age,
wear, deterioration, or maintenance history; homeowner fault or delayed response; any
technician action; any statement that moisture, staining, or signs of leakage were
absent.

### WORK PERFORMED (-> work_performed)

Purpose: what the technician did, which is THE TECHNICIAN'S WORK steps written as a
field narrative. 3-4 sentences maximum: group related steps into single sentences;
never list every micro-step separately.

- **Every step appears, in order.** Add no step that is not listed, and never describe
  anything under LEFT FOR OTHER TRADES as the technician's work.
- **Opening step: supply isolation, phrased neutrally.** Lead with the action itself
  (never "Upon arrival"). The sentence has to hold true whether the water was already
  off when the technician arrived or the technician had to close a still-open valve, so
  state the isolation as a completed step, without attributing it to anyone and without
  dating it.
  - Use: "Water supply to the affected line was isolated before any work began."
  - Use: "With the supply to the affected line isolated, ..."
  - For a drain line, the equivalent is: "The affected fixture was taken out of service
    before work began."
  - NEVER: "confirmed the supply was already isolated," "found the water already shut
    off," "shut off the actively running water," "emergency shutoff," or how long the
    supply had been off or who turned it off.
  - You MAY add that the line was verified depressurized before cutting.
- **Access**: state the opening dimensions given under Access whenever tile, drywall,
  or a ceiling was cut; they are the evidentiary basis for the restoration that
  follows. Access panel, under-sink cabinet, or exposed: nothing was cut, so no
  dimensions. If Site Findings could only describe a general suspected area, confirm
  here where the leak was once access was made, e.g. "once exposed, the leak was traced
  to the hot-water supply line at the valve inlet," naming a failure mode only if a
  photo clearly shows it.
- **Fixture detach & reset**: if a fixture was detached, state that it was detached
  before the work area was accessed. If none was, say nothing about detaching.
  - If it was reset by the technician, also state that it was reset near the end (new
    wax ring, supply reconnection, or re-caulking, as applicable).
  - If it was NOT reset by the technician, say it remains detached, pending
    reinstallation by others, and describe no reset, reinstall, new wax ring, or
    re-caulking of it anywhere in the report.
- **Repair**: as the step states it. If the pipe material is not specified, name no pipe
  material anywhere in the report.
- **Test and seal**: the leak check as the steps describe it (a check under normal line
  pressure, not a "pressure test"; a fill-and-drain check for a drain or appliance),
  that the repair held with no leaks, then the temporary seal over the opening, before
  leaving.

### WARRANTY (-> warranty_info)
- One sentence: 30-day workmanship warranty from date of service.

### NOTES (-> notes)
- 2-3 sentences max. Every statement must agree with Site Findings and Work Performed;
  Notes add no condition those sections do not record.
- Drying advisory, matched to what was recorded: if Site Findings or Work Performed
  records water, wetness, or staining, advise that the affected materials be dried and
  confirmed dry before restoration. If neither records any, do not say anything is wet
  or needs to dry; recommend instead that the opened cavity be checked for moisture
  before it is closed up, or, when nothing was cut open, that the area around the repair
  be watched for moisture (no "closed up": a cabinet door is not an opening).
- A monitoring recommendation, and that no other plumbing issues were found in the work
  area.
- If anything was cut open, add that the opening has been temporarily sealed, pending
  restoration by others. If that opening is in a shower or tub wall, add that the
  shower or tub should stay out of use until the wall is restored.
- If water reached other areas (per JOB DETAILS), add that those areas should also be
  evaluated for drying and any needed restoration.
- Mention other trades only that way, in a clause: never list their tasks, never say a
  material must be removed or replaced, and never promise that anyone "will" do the
  work.

## TONE
A professional field report written by a licensed technician: clear, factual, plain.
Not legal writing, not defensive, not formal for its own sake. Never describe the pipe
or the damage as "compromised," a "failed section," or a "damaged section." Avoid
entirely: wear and tear, deterioration, age-related, neglect, deferred maintenance.

## FINAL CHECK: verify every item before you output
1. Site Findings contains no technician action at all (isolation, protection, cutting,
   repair, testing), including no "once exposed," "on opening," or similar phrasing.
2. Site Findings names nothing inside the wall (no insulation, framing, studs, or
   subfloor). If the component was enclosed, Site Findings names only a general
   suspected area.
3. No failure mode (split, pinhole, separated fitting, cracked body), and no "hot" or
   "cold" side, appears anywhere unless a photo clearly shows it.
4. Nothing anywhere states or implies valve position or pressure on arrival, leak
   duration, water volume, age or wear, or homeowner fault.
5. The Work Performed opening does not say who isolated the supply or when, and does not
   imply the water was either still running or already off.
6. Every step under THE TECHNICIAN'S WORK appears in Work Performed, and nothing under
   LEFT FOR OTHER TRADES is described as the technician's work.
7. Every area listed under "Other areas the water reached" is named in Site Findings and
   described as active/fresh/wet and tied to this incident. If none were reported, no
   other floor, room, or unit is mentioned anywhere.
8. If a fixture was detached and reset, Work Performed describes both. If it was not
   reset, Work Performed says it remains detached, and nothing describes a reset.
9. If anything was cut open, Work Performed states its approximate dimensions.
10. work_performed is 3-4 sentences, not a list of micro-steps.
11. Site Findings contains no sudden-vs-gradual conclusion and no moisture-meter reading.
12. If the pipe material is not specified, no pipe material is named anywhere.
13. Site Findings invents no symptom, and no staining, dampness, or water that JOB
    DETAILS or a photo does not establish. It contains no statement that moisture,
    staining, or signs of leakage were absent, and its "no signs of leakage" mention
    refers only to the time before this event.
14. Notes agree with Site Findings and Work Performed: nothing in Notes says a material
    is wet or must dry unless water, wetness, or staining is recorded there.

## OUTPUT FORMAT
Return ONLY a valid JSON object: no markdown, no code fences, no commentary before or
after it. All four keys are required, and every value is a string.

{{
  "site_findings": "...",
  "work_performed": "...",
  "warranty_info": "...",
  "notes": "..."
}}"""

NO_PHOTOS_SECTION = "## PHOTOS\nNo photos were attached; rely on the details above only."

PHOTOS_SECTION_TEMPLATE = """## PHOTOS
{photo_count} photo(s) taken by the technician are attached, labeled in this order:
{photo_list}

How to use them:
- **BEFORE photos** show conditions at time of service, before the work: water on the
  floor or baseboard, staining, soft or bulging drywall, the failed component and its
  failure mode when it is exposed in the photo. A BEFORE photo that already shows an
  opened wall or ceiling was taken during the access step; its failure mode belongs to
  the repair, not to what was found on arrival.
- **AFTER photos** show the completed repair: the replacement pipe and fittings, the
  repair method, the size of any opening, protection, and the temporary seal over the
  cavity.
- What a photo clearly shows counts as an established fact, the same as the details
  above. What is unclear, partly hidden, or open to more than one reading does not;
  leave it out.
- The details above take precedence wherever a photo seems to conflict with them;
  photos only fill in what they leave open (e.g. a pipe material that was not
  specified).
- Another floor, room, or unit counts as reached by the water only when the details
  above list it, or a photo caption names that area. Never infer it from an uncaptioned
  photo.
- Every ground rule still applies. A photo cannot establish how long the leak ran, how
  much water escaped, or what anyone did before arrival. Even if a photo shows
  discoloration, corrosion, or mineral buildup on the pipe, do not describe it; the
  no-age/no-wear rule overrides what a photo shows.
- Write as the technician's own observations. Do not refer to the photos ("as shown in
  Photo 2") or describe them as photos."""

# ──────────────────────────────────────────────
# Step 2b: Invoice from the plumber's steps
# ──────────────────────────────────────────────

INVOICE_PROMPT_TEMPLATE = """Price a realistic itemized invoice for the plumbing work described below, at DMV-area market rates.

## THE TECHNICIAN'S WORK (steps, in order)
{plumber_steps}

Bill only these steps. Drying, demolition for drying, and rebuilding the opening are
done by other trades and are never on this invoice.

## MATERIALS THE STEPS USE
{materials}

## JOB CONTEXT
- **Failed component:** {failed_component}
- **Pipe material:** {pipe_material}
- **Access:** {access}
- **Protection installed:** {protection_installed}
- **Fixture detached for access:** {fixture_detached}
- **Detached fixture reinstalled by this technician:** {fixture_reinstalled}
- **State:** {state} (regional pricing context only; see the tax rule below)
- **Estimated hours on site:** {hours_estimate}

## LINE ITEMS (3 to 6 total, in this order)
1. **Emergency Dispatch Fee**: exactly one line, quantity 1, unit EA, $125-$200
   depending on urgency. Describe it as "Emergency response and on-site assessment",
   optionally naming the fixture, but never call the leak active, ongoing, or stopped.
2. **Labor**: unit HR, 1 to 3 phase lines: one line when nothing was cut open (a short
   exposed repair split into phases looks padded), 2 or 3 when an opening was cut.
   Phase names and descriptions must reflect the ACTUAL steps above, e.g. "Labor -
   Isolation, Protection & Access" and "Labor - Repair, Testing & Seal-up". Name only
   work that is in the steps: no "Access" when nothing was opened, no "Seal-up" when no
   opening was sealed. The temporary seal is a few minutes of work: it goes in the last
   phase, never a line of its own. Describe isolation as the steps do ("isolate
   supply"; for a drain line, "take the fixture out of service"), never as shutting
   water off.
3. **Fixture detach & reset labor**: one additional HR line, required ONLY if "Fixture
   detached for access" above names a fixture (not "none") AND "Detached fixture
   reinstalled by this technician" is "yes". Name it for that fixture, e.g. "Labor -
   Toilet Detach & Reset". Typically 0.5-1.5 HR, kept separate from the other labor
   phases. If a fixture was detached but will NOT be reinstalled by this technician, use
   a "Labor - [Fixture] Detach" line instead (detach only, no reset wording).
4. **Materials**: exactly one line, quantity 1, unit LOT.

**Bill each task once.** Each step above belongs to exactly one line. Opening the wall,
ceiling, or floor (protecting it, then cutting and removing tile, backer board, or
drywall) is access labor and stays inside the access phase. It never gets a line of its
own: no "Tile Detach," "Drywall Removal," or similar line may sit beside a phase that
already covers it. A detached fixture's detach and reset both go in that fixture's own
line: no other labor line may mention taking out, pulling, disconnecting, or setting
back that fixture. Before responding, read the names and descriptions of all the labor
lines together and make sure no two of them describe the same work.

## PRICING

**Labor hours.** Every HR line's unit_cost is normalized to the standard $185/hr rate
automatically after generation, so output 185.00 for each of them and do not vary it.
Split exactly {hours_estimate} hours across the labor lines: their quantities must add
up to {hours_estimate}, in quarter hours, apportioned by how long each phase takes.

**Materials.** Price exactly the items under MATERIALS THE STEPS USE, at their
quantities: add nothing and drop nothing. Build the LOT price bottom-up from realistic
DMV-area retail/wholesale costs. Never pick a round or placeholder number. Reference
anchors, scaled to quantity:
- Copper pipe (Type L) ~$8-12/ft · CPVC ~$3-5/ft · PEX ~$1-2/ft
- Copper fittings (elbow/coupling) ~$3-8 each · CPVC/PVC fittings ~$1-3 each
- Primer & cement (shared from a can) ~$8-15 · Solder & flux (partial use) ~$5-10
- Wax ring ~$8-15 · Toilet/appliance supply line ~$8-15 · Braided connector ~$10-20
- Angle stop valve ~$12-25 · Shielded no-hub coupling ~$12-20 each
- Protection sheeting + tape: ~$6-12 for a small area (under a sink, around a toilet or
  appliance), ~$15-25 to protect around a cut opening and seal it afterward
The description lists every item with its quantity and cost, and those costs add up
exactly to the LOT price: no "miscellaneous" or unexplained remainder. If the list is
empty, build it from the steps instead. If the pipe material is not specified, list the pipe items
generically (e.g. "replacement pipe section and fittings to match existing") and name
no material, joining method, or material-specific supply (no copper, PEX, solder, flux,
crimp rings, or primer and cement); price them at a mid-range of the anchors above.

**Quantities follow the opening.** Every quantity must fit the steps above:
- Pipe: the replaced section can be no longer than the pipe exposed in the opening, at
  most the opening's longest side as given under Access (e.g. a 1.5' x 2' opening means
  1-2 ft of pipe, not 8 ft). Price the feet used, not a full stick. Where nothing was
  cut open (access panel, under-sink, exposed), price a short section or a single
  connector or valve.
- Fittings: typically 2 couplings per replaced section; add elbows, tees, or valves only
  if the steps name them.
- Protection and seal-up supplies: sized to the area worked, not a whole room.

**The Materials total must not equal $185.00 or any other line's total**; a match reads
as an unpriced placeholder. If your first pass lands on a round number or a
coincidental match, recompute it from the components.

**Tax.** Do not calculate tax, do not add a tax or sales-tax line item, and do not adjust
any price for tax. It is computed automatically after generation.

**No target total.** Price every line independently at realistic market rates; the
invoice total is whatever they add up to. Before responding, multiply quantity ×
unit_cost for each line and sanity-check the line totals and their sum against the
steps, and check that every quantity in the Materials description fits the opening.

## OUTPUT FORMAT
Return ONLY a valid JSON object: no markdown, no code fences, no commentary.

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

That skeleton shows shape only: the item count, the names, the descriptions, and every
dollar figure except the 185.00 labor rate must come from the rules above."""


# ──────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────

def generate_plumber_report(
    floor: str,
    room: str,
    fixture: str,
    component: str,
    state: str,
    pipe_material: str = "",
    reached_floor_below: bool = False,
    photos: Optional[list] = None,
) -> Optional[dict]:
    """
    Plumber report from the source of the leak.

    The technician gives the source (floor, room, fixture, leaking part — e.g.
    2nd floor / master bathroom / shower / water line), the pipe material
    (blank = not specified: the report names none unless a photo shows it),
    and whether the water reached the floor below. A "yes" puts the ceiling
    directly below the source on record as fresh staining; on a basement leak
    there is no floor below and it is ignored. photos ({url, category,
    caption}, category "before"/"after") go to the repair plan and the report
    as images.

    Step 1 (strong model): repair plan — every step of the repair, each tagged
    with its trade, plus the failed component, the access route and opening,
    any detached fixture, and the plumber's hours. Code keeps only the steps
    tagged plumber.
    Step 2 (in parallel, strong model): the report and the invoice, both
    written from the plumber's steps; the invoice splits exactly the plan's
    hours. The other trades' steps go to the report only as follow-up that is
    not the technician's work.

    The labor hourly rate and sales tax are deterministic — they are computed
    in code below, not trusted from the model's output.

    Raises ValueError if `state` is not one of VALID_STATES (MD/VA/DC) — this
    should be unreachable via the API, which validates state before calling
    in; it's an internal contract check for direct callers.

    Returns the report sections, invoice, totals, and the repair plan, or None
    if all AI providers fail.
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

    source = _source_lines(floor, room, fixture, component)
    given_material = (pipe_material or "").strip()
    affected_areas = _areas_below(floor, room, reached_floor_below)

    # ── Step 1: Repair plan across all trades ──
    logger.info(f"AI Step 1/2: Working out the repair plan ({len(images)} photo(s))...")
    plan_prompt = REPAIR_PLAN_PROMPT_TEMPLATE.format(
        source=source,
        pipe_material=given_material or "not specified",
        below=(
            f"Yes: it reached the {affected_areas}."
            if affected_areas != "none reported"
            else "No."
        ),
        photos_section=photos_section,
    )
    raw_plan = _call_ai_json(
        plan_prompt, "steps", strong=True, images=images, validate=_plan_has_plumber_steps
    )
    if raw_plan is None:
        logger.error("Step 1 failed: no usable repair plan from any provider")
        return None
    plan = _normalize_plan(raw_plan, given_material, photos_sent=bool(images))
    logger.info(
        f"AI Step 1/2 complete: {len(plan['plumber_steps'])} plumber step(s), "
        f"{len(plan['other_trades'])} for other trades."
    )

    # ── Step 2: Report and invoice from the plumber's steps ──
    plumber_steps = "\n".join(
        f"  {i}. {task}" for i, task in enumerate(plan["plumber_steps"], start=1)
    )
    access = _access_text(plan["access"])
    fixture_text = (
        f"{plan['fixture_detached']} (reset by the technician after the repair)"
        if plan["fixture_detached"] and plan["fixture_reset_by_plumber"]
        else f"{plan['fixture_detached']} (NOT reset by the technician; left for others)"
        if plan["fixture_detached"]
        else "none"
    )
    other_trades = "\n".join(
        f"- {step['trade']}: {step['task']}" for step in plan["other_trades"]
    ) or "- none"

    report_prompt = REPORT_PROMPT_TEMPLATE.format(
        source=source,
        pipe_material=plan["pipe_material"] or "not specified",
        affected_areas=affected_areas,
        failed_component=plan["failed_component"],
        line_type=plan["line_type"],
        access=access,
        protection=plan["protection_needed"],
        fixture=fixture_text,
        plumber_steps=plumber_steps,
        other_trades=other_trades,
        photos_section=photos_section,
    )
    invoice_prompt = INVOICE_PROMPT_TEMPLATE.format(
        plumber_steps=plumber_steps,
        materials="\n".join(f"- {line}" for line in plan["materials"]) or "- (none listed)",
        failed_component=plan["failed_component"],
        pipe_material=plan["pipe_material"] or "not specified",
        access=access,
        protection_installed=plan["protection_needed"],
        fixture_detached=plan["fixture_detached"] or "none",
        fixture_reinstalled="yes" if plan["fixture_reset_by_plumber"] else "no",
        state=state_normalized,
        hours_estimate=plan["hours_estimate"],
    )

    logger.info("AI Step 2/2: Writing the report and pricing the invoice...")
    with ThreadPoolExecutor(max_workers=2) as pool:
        report_future = pool.submit(
            _call_ai_json, report_prompt, "work_performed", strong=True, images=images
        )
        # The strong model: the fast one billed a pulled dishwasher twice and
        # named copper on a job with no pipe material. It runs alongside the
        # report, so it adds no wait.
        invoice_future = pool.submit(
            _call_ai_json, invoice_prompt, "invoice_items", strong=True
        )
        report_data = report_future.result()
        invoice_data = invoice_future.result()

    if report_data is None:
        logger.error("Step 2 failed: no usable report from any provider")
        return None
    if invoice_data is None:
        logger.error("Step 2 failed: no usable invoice from any provider")
        return None
    logger.info("AI Step 2/2 complete.")

    # ── Deterministic pricing — labor rate and tax are NOT trusted from the model ──
    items = invoice_data.get("invoice_items", [])
    for item in items:
        if (item.get("unit") or "").upper() == "HR":
            item["unit_cost"] = LABOR_RATE
    _fit_labor_hours(items, float(plan["hours_estimate"]))

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
        "site_findings": report_data.get("site_findings", ""),
        "work_performed": report_data.get("work_performed", ""),
        "warranty_info": report_data.get("warranty_info", ""),
        "notes": report_data.get("notes", ""),
        "invoice_items": items,
        "subtotal": subtotal,
        "tax_amount": tax,
        "total": total,
        "repair_plan": plan,
    }


# ──────────────────────────────────────────────
# Source of the leak and the floor below
# ──────────────────────────────────────────────

_FLOOR_NUMBER_RE = re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)?\b", re.IGNORECASE)
_FLOOR_WORDS = {
    "first": 1, "ground": 1, "main": 1,
    "second": 2, "third": 3, "fourth": 4, "fifth": 5,
}
_BASEMENT_RE = re.compile(r"\b(?:basement|cellar|lower[\s-]+level)\b", re.IGNORECASE)
_ORDINAL_SUFFIXES = {1: "st", 2: "nd", 3: "rd"}


def _ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        return f"{n}th"
    return f"{n}{_ORDINAL_SUFFIXES.get(n % 10, 'th')}"


def _floor_number(floor: str) -> Optional[int]:
    """0 for a basement, N for "Nth floor" / "second floor", None if unreadable."""
    text = (floor or "").strip()
    if _BASEMENT_RE.search(text):
        return 0
    match = _FLOOR_NUMBER_RE.search(text)
    if match:
        return int(match.group(1))
    for word, number in _FLOOR_WORDS.items():
        if re.search(rf"\b{word}\b", text, re.IGNORECASE):
            return number
    return None


def _source_lines(floor: str, room: str, fixture: str, component: str) -> str:
    """The source of the leak, one labeled line per part the technician gave."""
    parts = [
        ("Floor", floor), ("Room", room), ("Fixture", fixture), ("Leaking part", component),
    ]
    return "\n".join(
        f"- **{label}:** {value.strip()}"
        for label, value in parts
        if (value or "").strip()
    )


def _areas_below(floor: str, room: str, reached_floor_below: bool) -> str:
    """
    The "Other areas the water reached" value the report sees: the ceiling
    directly below the source when the technician says the water got there,
    otherwise "none reported". A basement has no floor below, so a yes there
    is ignored.
    """
    if not reached_floor_below:
        return "none reported"
    number = _floor_number(floor)
    under = f"directly below the {room.strip()}" if (room or "").strip() else "directly below the source"
    if number == 0:
        return "none reported"
    if number == 1:
        return f"basement ceiling {under}"
    if number is None:
        return f"ceiling of the level {under}"
    return f"{_ordinal(number - 1)} floor ceiling {under}"


# ──────────────────────────────────────────────
# Repair plan → the plumber's scope
# ──────────────────────────────────────────────

_ACCESS_SURFACES = {"tile", "drywall", "ceiling", "access panel", "under-sink cabinet", "exposed"}
_NOT_CUT = {"access panel", "under-sink cabinet", "exposed"}
# Surfaces cut for access are never a "detached fixture" — billing one would
# charge the tile removal twice, once in access labor and again as a detach line.
_SURFACE_WORDS_RE = re.compile(
    r"\b(?:tile|backer|drywall|plaster|ceiling|flooring|sheetrock|access panel)\b",
    re.IGNORECASE,
)


# Which side leaked is never an input, and both Claude and GPT named "cold"
# anyway. Without photos the side comes out of the plan before the report
# and invoice are written from it: "cold-water angle stop valve" -> "angle
# stop valve", "hot water line" -> "water line".
_SIDE = r"\b(?:hot|cold)(?:\s*(?:/|and|or|&)\s*(?:hot|cold))?"
_SIDE_BEFORE_PART_RE = re.compile(
    _SIDE + r"(?:[\s-]+water)?(?:[\s-]+side)?[\s-]+"
    r"(?=(?:supply|stop|angle|shutoff|shut-off|valve|connector)\b)",
    re.IGNORECASE,
)
_SIDE_BEFORE_WATER_LINE_RE = re.compile(_SIDE + r"[\s-]+water[\s-]+(?=(?:line|pipe)\b)", re.IGNORECASE)


def _drop_water_side(text: str) -> str:
    text = _SIDE_BEFORE_PART_RE.sub("", text)
    return _SIDE_BEFORE_WATER_LINE_RE.sub("water ", text)


def _is_plumber(trade) -> bool:
    return "plumb" in str(trade or "").lower()


def _plan_has_plumber_steps(data: dict) -> bool:
    steps = data.get("steps")
    return isinstance(steps, list) and any(
        isinstance(step, dict) and _is_plumber(step.get("trade")) and str(step.get("task") or "").strip()
        for step in steps
    )


def _normalize_plan(raw: dict, given_material: str, photos_sent: bool = False) -> dict:
    """
    The repair plan as the rest of the pipeline reads it: the plumber's steps
    split from the other trades', and every field present and typed. A pipe
    material the technician gave always wins over the model's; with none
    given, the model's counts only when it had photos to see it in (without
    them it named "braided stainless" for a toilet line nobody described).
    """
    plumber_steps, other_trades = [], []
    for step in raw.get("steps") or []:
        if not isinstance(step, dict):
            continue
        task = str(step.get("task") or "").strip()
        if not task:
            continue
        trade = str(step.get("trade") or "").strip() or "other"
        if _is_plumber(trade):
            plumber_steps.append(task)
        else:
            other_trades.append({"trade": trade, "task": task})

    access = raw.get("access") if isinstance(raw.get("access"), dict) else {}
    surface = str(access.get("surface") or "").strip().lower()
    if surface not in _ACCESS_SURFACES:
        surface = surface or "exposed"
    opening = "" if surface in _NOT_CUT else str(access.get("opening") or "").strip()

    fixture = str(raw.get("fixture_detached") or "").strip()
    if fixture.lower() in {"none", "n/a", "no"} or _SURFACE_WORDS_RE.search(fixture):
        fixture = ""
    reset = raw.get("fixture_reset_by_plumber")
    if isinstance(reset, str):
        reset = reset.strip().lower() in {"true", "yes"}
    reset = bool(fixture) and (True if reset is None else bool(reset))

    materials = []
    for entry in raw.get("materials") or []:
        if isinstance(entry, dict):
            item = str(entry.get("item") or "").strip()
            quantity = str(entry.get("quantity") or "").strip()
            if item:
                materials.append(f"{quantity} {item}".strip() if quantity else item)
        elif str(entry or "").strip():
            materials.append(str(entry).strip())

    line_type = str(raw.get("line_type") or "").strip().lower()
    protection = str(raw.get("protection_needed") or "").strip().lower()
    hours = str(raw.get("hours_estimate") or "").strip()
    try:
        hours = f"{float(hours):g}"
    except ValueError:
        hours = "3"

    failed_component = str(raw.get("failed_component") or "").strip()
    if not photos_sent:
        failed_component = _drop_water_side(failed_component)
        plumber_steps = [_drop_water_side(task) for task in plumber_steps]
        materials = [_drop_water_side(line) for line in materials]

    return {
        "failed_component": failed_component,
        "line_type": "drain" if line_type == "drain" else "supply",
        "pipe_material": given_material or (
            str(raw.get("pipe_material") or "").strip() if photos_sent else ""
        ),
        "access": {
            "surface": surface,
            "where": str(access.get("where") or "").strip(),
            "opening": opening,
        },
        "fixture_detached": fixture,
        "fixture_reset_by_plumber": reset,
        "protection_needed": "yes" if protection == "yes" else "no",
        "hours_estimate": hours,
        "plumber_steps": plumber_steps,
        "other_trades": other_trades,
        "materials": materials,
    }


def _fit_labor_hours(items: list, total_hours: float) -> None:
    """
    Make the HR lines add up to the plan's hours, in quarter hours: the report
    and the invoice come from one plan, so the invoice can't bill a different
    total. Lines are scaled in proportion; the rounding remainder goes on the
    longest one. Leaves the items alone when there are no HR lines.
    """
    labor = [item for item in items if (item.get("unit") or "").upper() == "HR"]
    if not labor or total_hours <= 0:
        return
    billed = sum(max(float(item.get("quantity") or 0), 0) for item in labor)
    for item in labor:
        share = max(float(item.get("quantity") or 0), 0) / billed if billed else 1 / len(labor)
        item["quantity"] = max(round(total_hours * share * 4) / 4, 0.25)
    remainder = round(total_hours - sum(item["quantity"] for item in labor), 2)
    longest = max(labor, key=lambda item: item["quantity"])
    if remainder and longest["quantity"] + remainder >= 0.25:
        longest["quantity"] = round(longest["quantity"] + remainder, 2)


def _access_text(access: dict) -> str:
    """One line for the prompts: surface, where, and the opening size or that nothing was cut."""
    text = access["surface"]
    if access["where"]:
        text += f", {access['where']}"
    if access["surface"] in _NOT_CUT:
        text += " (nothing cut open)"
    elif access["opening"]:
        text += f" (opening approx. {access['opening']})"
    return text


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
    validate: Optional[Callable[[dict], bool]] = None,
) -> Optional[dict]:
    """
    Call OpenAI (if enabled), then Anthropic, retrying across all enabled
    providers for up to `max_rounds` rounds, until one returns a parseable
    JSON object containing `required_key` (and passing `validate`, when
    given). `images` (from _prepare_photos) are sent ahead of the prompt,
    each preceded by its label.

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
            if data is not None and required_key in data and (validate is None or validate(data)):
                return data
            logger.warning(
                f"{call.__name__} ({model}) round {round_num}: response "
                f"missing '{required_key}', invalid, or unparseable, trying next"
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
        # The account's monthly spend cap: every call fails until it resets,
        # so retrying in a later round only repeats the refusal.
        if "usage limits" in str(e).lower():
            raise _PermanentProviderError(
                f"Anthropic account has reached its API usage limit: {e}"
            ) from e
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
