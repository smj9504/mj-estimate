---
version: 1
slug: "frontend-src-components-common-layout-tsx"
primary_target: "frontend/src/components/common/Layout.tsx"
related_targets: ["frontend/src/pages/WaterMitigationList.tsx","frontend/src/pages/WaterMitigationDetail.tsx","frontend/src/pages/EstimateCreation.tsx","frontend/src/pages/RepairEstimateWizard.tsx"]
---

Scope: app shell (Layout) + global theme, then Water Mitigation list/detail, Claim Follow-up dashboard/detail, EstimateCreation, RepairEstimateWizard. Mode: Operate.

Audience/job: office PM, claim staff, field crew, often on a phone. Scan status/payments in lists, edit notes/status in detail, upload/view photos and docs, send follow-up emails.

Scope note: Claim Follow-up pages are owned by a concurrent session and are out of scope for this pass.

Constraints: stay within Ant Design 5 (theme tokens + overrides). Preserve all behavior, data and copy. Company badges keep per-company colour (commit 3e68b5e) but move to pastel tone.

## Direction contract

THESIS: A Notion-calm workspace: the page is a white sheet, not a card on a grey board. Refuses the stock AntD admin look (navy rail, boxed cards inside boxed cards, outlined rainbow tags, ALL-CAPS statuses).

OWN-WORLD: Warm neutrals: ink #37352F, secondary #787774, tertiary #A5A29A, divider #E9E9E7, sidebar #F7F7F5, hover rgba(55,53,47,.06). One accent, blue #1F74C9 (Notion's #2383E2 darkened: white text 4.77:1 vs 3.88:1), for primary actions, links and selection only; totals and amounts stay ink. Notion's nine pastel tag pairs (gray, brown, orange, yellow, green, blue, purple, pink, red), borderless, 4px radius, sentence case. Company identity is a square pastel monogram tile (20px, 11px/600), never a pill, so it does not read as another status. System sans, 14px body, tight 1.2 scale. Hairline borders, near-zero shadow, 4-6px radius.

STORY: Staff open a list and read status, company and money per row without noise; open a job and see its facts as quiet property rows; act with one thumb.

FIRST VIEWPORT: Light sidebar (desktop) / slim 52px top bar (mobile); page title in 24px semibold on white; one row of filters; list rows with pastel status pill first. Primary action top-right in accent blue.

FORM: Pinned by user ("Notion-like"); no concept-seed roll. Signature move: Notion property rows (gray label column, value column, no table borders) for detail facts.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
