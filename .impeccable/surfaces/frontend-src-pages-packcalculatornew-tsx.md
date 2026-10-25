---
version: 1
slug: "frontend-src-pages-packcalculatornew-tsx"
primary_target: "frontend/src/pages/PackCalculatorNew.tsx"
related_targets: ["frontend/src/pages/PackCalculatorNewList.tsx","frontend/src/pages/PackCalculatorNewDetail.tsx"]
---

Scope: Packing estimate calculator (/reconstruction-estimate/pack-calculator-new), plus its list (/list) and detail (/:id) pages. Mode: Operate.

Audience/job: office PM / estimator at a desk (desktop first, phone must still work). Build a pack-out estimate for a claim: pick company, client, claim, address; set crew, region, staging, storage, pack-back, O&P, contingency; add rooms (Quick: presets with floor/density/contamination; Photo AI: room photos, AI item detection, item edits); calculate; read line items and totals; open the saved estimate (detail has Export PDF, Recalculate, Edit).

Constraints: stay on the White Sheet system (DESIGN.md) inside Ant Design 5. Preserve behavior, data and copy. Each Calculate call saves a new estimate record, so calculation stays an explicit action, never live on every change. Shared vocabulary lives in components/packing-estimate/packingUi.tsx; styles are the pk-* block in components/packing-estimate/packing.css.

## Direction contract

THESIS: The estimate is the page. Inputs (job, rooms, settings) sit in a left column beside the line-item estimate on the right, so every input is read in dollars. Refuses the stock three-step wizard with boxed cards and a total hidden behind the last step.

OWN-WORLD: White Sheet only: white page, warm ink, hairline sections (16px/600 over #e9e9e7), grey label column beside controls, borderless pastel pills for state only (contamination, analysis, status), one Ledger Blue primary (Calculate / Recalculate), money in ink with tabular figures, figures as label over a 20px ink value.

STORY: The estimator fills the job, adds rooms, presses Calculate, and reads figures, sections and totals beside the inputs; changing anything afterwards marks the estimate out of date until recalculated; Open estimate goes to the saved record.

FIRST VIEWPORT: PageHeader (name or "New packing estimate", meta: mode · rooms · last calculated) with Quick / Photo AI segmented and the primary Calculate on the right. Below, a two-column grid: input column ~520-560px (Company & Client, Rooms, Estimation Settings as hairline sections) and the Estimate column (sticky on desktop): figures, then sections with line items, then totals. Before the first calculation the Estimate column is a quiet empty state naming what is missing. One column under 1200px with the estimate after the inputs.

FORM: Builder: inputs left, estimate right. Position 5 on the ordered list of seven grounded structures, dealt lead. Raise from the gate-board challenger: a changed input after a calculation keeps an orange "Inputs changed" line and dims the figures until recalculated. seed:086248b5c1dd8503

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
