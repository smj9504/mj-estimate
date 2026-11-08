---
target: cabinet estimate page (side by side edit + sketch)
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\minje\\project_2026\\mj-estimate\\frontend\\src\\pages\\CabinetEstimateDetail.tsx"
target_fingerprint: "sha256:f440a4b12b699ef3a0598b945163336121e07bdbbb613b6f7656e0dde62b5582"
target_path: "C:\\Users\\minje\\project_2026\\mj-estimate\\frontend\\src\\pages\\CabinetEstimateDetail.tsx"
timestamp: 2026-11-07T06-24-55Z
slug: frontend-src-pages-cabinetestimatedetail-tsx
---
Method: dual-agent (A: design review sub-agent · B: detector + browser sub-agent)

User's ask: the UI feels too AI-generated; wants it to feel like a professional tool such as Figma.

## Design Health Score
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Sketch shows "Sketch saved"; the form has no unsaved marker; total buried and goes stale with no "inputs changed" line |
| 2 | Match with the real world | 3 | Strong trade vocabulary; Korean fragments in the English UI |
| 3 | User control and freedom | 2 | Sketch has undo, form doesn't; Back drops form edits with no warning |
| 4 | Consistency and standards | 1 | Breaks DESIGN.md almost everywhere; bathroom sketch editor pattern not reused |
| 5 | Error prevention | 2 | "Use in estimate" overwrites with no preview |
| 6 | Recognition rather than recall | 2 | Icon-only tools, editing behind right-click, shortcuts only in a paragraph |
| 7 | Flexibility and efficiency | 2 | No Ctrl+S or calculate shortcut; cabinets added one dropdown at a time |
| 8 | Aesthetic and minimalist design | 1 | 11 jump links, 6 header buttons, coloured chips, help walls, competing blues |
| 9 | Error recognition and recovery | 2 | "Please fill required fields" doesn't name the field |
| 10 | Help and documentation | 2 | One ~400-word help blob instead of an active-tool hint |
| Total | | 19/40 | Poor |

## Design Specificity Verdict
Canvas is trade-specific (real codes, uppers over bases, sinks, D&R, takeoffs measured from the drawing). The chrome is stock Ant Design admin: an icon on every button, colour on plain facts (Base/Wall/Tall tags, gold/geekblue/cyan/brown chips), 11 boxed cards, 11 pill jump links (added this round), ~400-word help and 40-70-word tooltips, info alerts, a generic "Cabinet Estimate" title with an ALL-CAPS status, a blue-tinted total card, a red trash on every row. The page is not migrated to DESIGN.md; the bathroom Sketch tab already shows a Figma-like editor pattern.

Deterministic scan: CLI 0 findings (regex-only on .tsx, an undercount). In-page overlay 27-30 per view: undersized 10px appliance cost labels x14 (CabinetEstimateDetail.tsx:118), ~30 hard-coded fontSize 11, #8c8c8c at 3.4:1 ("Sketch saved", hints; CabinetSketchEditor.tsx:2163, CabinetEstimateDetail.tsx:2160), advisory contrast on coloured chips. Overflow: at 1920 side by side the base table is 741px in a 677px pane, so Qty and delete are clipped. False positives: React Query devtools button, antd checkbox easing, em dashes in data labels, global search box. No user-visible overlay (headless).

## Overall Impression
Recommendation: re-lay the page as a Figma-like editor inside the existing White Sheet system: a 44px editor bar (address as file name, option switcher, save state, Calculate, Export menu); canvas at full height; a fixed ~320px context inspector on the right (selection -> its properties; nothing selected -> total, stale line, takeoff, key specs); cabinets as a layers panel by run; the scope form in an Estimate panel; the bathroom .bes-* toolbar; monochrome chrome, 13px UI text, mono codes, tabular numerals.

## What's Working
1. Two-way sketch <-> form linking (pick scrolls to the row, row hover outlines cabinets).
2. Takeoffs measured from the drawing with reasoning shown.
3. Split layout remembered, keyboard divider, precise confirm copy.

## Priority Issues
- [P1] No inspector; the right half is a long form, and the cabinet tables clip in the pane. Fix: context inspector, layers by run, Estimate panel, typed wall lengths. Command: /impeccable shape
- [P1] Generic tool chrome is the "AI" impression: wrapping toolbar, solid-blue active tool, red outlined Delete, coloured chips, six icon buttons. Fix: port .bes-* toolbar; header with Calculate as the one primary, Save with state, Export menu, overflow menu; counts as inspector rows. Command: /impeccable distill, /impeccable quieter
- [P1] Estimate state invisible, form edits can be lost. Fix: total + "Inputs changed - Recalculate" line (pk-stale), dirty marker, Ctrl+S, leave guard, calculate in place with the change shown. Command: /impeccable harden
- [P2] Off the design system: boxed cards, ALL-CAPS status, saturated tags, blue total card, red delete at rest, 10-11px text, hard-coded #8c8c8c/#1890ff/#d9d9d9. Fix: section sheets, Pill in sentence case, ui-icon-btn--danger, tokens. Command: /impeccable polish, /impeccable typeset
- [P2] Keyboard / screen reader: 24 unnamed icon buttons, unlabeled pickers, canvas not focusable. Fix: aria-label, aria-pressed, focusable canvas, aria-live results. Command: /impeccable audit

## Persona Red Flags
- Alex: no Ctrl+S / calculate shortcut; R and Del only with the pointer over the sketch; Save & Calculate jumps to Result; one dropdown per cabinet.
- Sam: 24 unnamed buttons; plan unreachable; confirmations are vanishing toasts; disabled PDF/Result with no reason.
- Office estimator: can't see what's filled or missing on arrival; can't type 16'2"; countertop and backsplash in two places each; Back loses form edits.

## Minor Observations
Korean fragments in English UI; "Insurance claim" tag acting as a dropdown; "Pick another Base to replace B33" tag shifts the toolbar; Pricing Basis and job type both say "Insurance claim"; O&P inputs ~680px wide.

## Questions to Consider
- Does the cabinet list need to be a form, or only the decisions a drawing can't make?
- Should the right panel answer "what is selected" or "what is this estimate worth and what's missing"?
- If the price recalculated live, would Save & Calculate need to exist?
