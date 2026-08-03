---
target: Main Layout and Navigation Shell (re-run)
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-03T15-20-05Z
slug: frontend-src-components-common-layout-tsx
---
# Design Critique: Main Layout & Navigation Shell (Re-run)

Method: dual-agent (A: design review · B: detector + technical evidence)

## Design Health Score

| # | Heuristic | Score | Change | Key Issue |
|---|-----------|-------|--------|-----------|
| 1 | Visibility of System Status | 2 | -- | No breadcrumbs; no notification badges; sidebar highlights current page but content area has no wayfinding |
| 2 | Match System / Real World | 3 | +1 | Nav restructured to domain logic (Jobs & Claims, Estimates, Documents); "Tools & Data" still a catch-all |
| 3 | User Control and Freedom | 3 | -- | Logout confirmation added; Escape + focus trap on mobile; no undo or recent items |
| 4 | Consistency and Standards | 3 | -- | Token system (tokens.ts + tokens.css + antTheme.ts) wired into ConfigProvider; Layout fully migrated |
| 5 | Error Prevention | 2 | -- | Logout confirmation; lazyWithRetry; no unsaved-form guard |
| 6 | Recognition Rather Than Recall | 2 | -- | 5 groups better than 11; but Tools & Data (11 items) and Estimates (9 items) still heavy; no search |
| 7 | Flexibility and Efficiency | 1 | -- | Zero keyboard shortcuts; no command palette; no favorites/recent pages |
| 8 | Aesthetic and Minimalist Design | 3 | +1 | Token-driven consistency; low-contrast text fixed; but Estimates (9) and Tools (11) submenus are dense |
| 9 | Error Recovery | 2 | -- | ErrorBoundary + NotFound + Unauthorized pages exist; no contextual recovery in shell |
| 10 | Help and Documentation | 1 | +1 | Skip-to-content link and nav landmark added; but still no help button, docs, or onboarding |
| **Total** | | **22/40** | **+3** | **Acceptable — significant improvements, key gaps remain** |

## Design Specificity Verdict

**LLM assessment**: Improved from generic to semi-specialized. The navigation taxonomy now reflects insurance restoration domain concepts ("Jobs & Claims", "Estimates", "Documents") rather than developer modules. The token system provides visual consistency through three coordinated layers (TS constants, CSS custom properties, Ant Design theme). However, the shell chrome itself is still a standard Ant Design Sider+Header with no domain-specific affordances — no claim-context indicator, no quick-action bar, no operational status in the header.

**Deterministic scan**: 5 `layout-transition` findings (all acceptable — framework-constrained sidebar width/margin patterns). No new rule categories flagged. Color tokenization is ~86% in CSS (3 remaining hardcoded: scrollbar thumb colors + `white` on dark sidebar). Z-index fully centralized via token scale. All accessibility additions verified present (skip-link, nav landmark, focus-visible, focus trap, Escape handler, 44px touch targets).

## Overall Impression

The Layout shell has improved meaningfully across the session. The navigation restructuring (11 groups → 5) is the highest-impact change — users can now scan the top level within cognitive limits. The token system transforms maintainability from "hunt through 232 files" to "change one value." Mobile accessibility went from absent to solid. The remaining gaps are clear and well-scoped: command palette, breadcrumbs, and the "Tools & Data" catch-all.

## What's Working

1. **Token architecture is production-grade.** Three coordinated layers — `tokens.ts` (JS imports), `tokens.css` (CSS custom properties), `antTheme.ts` (Ant Design ConfigProvider theme) — with Layout fully migrated as the reference implementation. The system is coherent and immediately usable for other pages.

2. **Mobile accessibility is above-average.** Focus trap on sidebar overlay, Escape to dismiss, 44px touch targets, skip-to-content link, `<nav aria-label>`, `:focus-visible` styling, debounced resize handler. For a business app, this is genuinely strong.

3. **Navigation restructuring follows domain logic.** "Jobs & Claims", "Estimates", "Documents", "Tools & Data" map to how a restoration contractor thinks about their work, not how a developer organized modules. Auto-expanding parent menus maintain context.

## Priority Issues

### [P1] No command palette or search — Efficiency wall
**What**: 35+ destinations with no keyboard shortcut, no Ctrl+K, no favorites, no recent pages. Power users navigate entirely via mouse.
**Why it matters**: An owner-operator managing 20+ active claims pays a productivity tax on every page transition. The header has ~1400px of unused space on desktop.
**Fix**: Add Cmd+K/Ctrl+K command palette. Add "Quick Create" dropdown in header. Add pinned/favorite pages.
**Suggested command**: `/impeccable shape` (new feature design)

### [P1] No breadcrumbs — Spatial disorientation
**What**: Deep routes like `/reconstruction-estimate/pack-calculator-new/123` give zero location context in the content area. Sidebar highlights help but disappear when collapsed or on mobile.
**Why it matters**: Users must reopen the sidebar or rely on browser back to reorient. Especially costly on mobile where sidebar is hidden.
**Fix**: Add breadcrumb bar between header and content, auto-generated from route structure.
**Suggested command**: `/impeccable layout`

### [P2] "Tools & Data" is a dumping ground (11 items)
**What**: Mixes reference data (Clients, Line Items), AI tools (Material Detection), utilities (PDF Editor, Photo Metadata), templates (WM Templates), and workflows (Email Ingestion) in one group.
**Why it matters**: Partially negates the 11→5 restructuring. Users scanning "Tools & Data" face the same wall-of-options problem the old "Tools" menu had.
**Fix**: Split into "Reference Data" (Clients, Line Items, WM Templates, WM Scope Items) and "Utilities" (Insurance Extraction, AI Detection, Debris Calc, Photo Metadata, PDF Editor, Cheat Sheet, Email Ingestion).
**Suggested command**: Direct edit to Layout.tsx menuItems

### [P2] Estimates submenu has 9 children with repetitive icons
**What**: FileTextOutlined used for Estimates, Supplements, and Invoices (3 consecutive items). BuildOutlined appears in both Jobs & Claims and Estimates.
**Why it matters**: Icons lose differentiation value when repeated. Quick-scanning users can't distinguish items by icon alone.
**Fix**: Choose distinct icons per item — e.g., DollarOutlined for Invoices, PlusCircleOutlined for Supplements.
**Suggested command**: Direct edit to Layout.tsx menuItems

### [P3] No help/onboarding infrastructure
**What**: Domain terms like "Pack Calculator", "WM Scope Items", "Xactimate Cheat Sheet" are opaque to new users. No tooltips, no "?" icon, no first-run tour.
**Why it matters**: Affects onboarding time but not daily use for trained users.
**Suggested command**: `/impeccable onboard`

## Persona Red Flags

**Alex (Power User)**: Zero keyboard shortcuts. No Cmd+K, no favorites, no recent pages. Every navigation requires mouse interaction with the sidebar. The restructured groups help scanning, but without accelerators, Alex is still slower than necessary. The biggest single gap for daily power users.

**Casey (Mobile/Tablet)**: Mobile implementation is now solid — focus trap, Escape dismiss, 44px touch targets, backdrop blur, safe-area-inset-bottom. However, with 35+ items the mobile sidebar requires significant scrolling. No search means Casey scrolls the full menu to find "Photo Metadata" or "Debris Calculator". The header shows company name but not current job context.

**Miguel (Field Worker)**: The 5-group structure helps orientation. But "Tools & Data" with 11 opaque items is intimidating for a non-technical user. Terms like "WM Scope Items" and "Pack Calculator" need inline descriptions or tooltips. No help infrastructure means Miguel relies on tribal knowledge.

## Minor Observations

- 3 hardcoded colors remain in Layout.css (scrollbar thumb `#4a5568`/`#5a6578` and `white` for sidebar text) — could be tokenized for completeness
- Duplicate transition declarations: `siderStyle` and `contentAreaStyle` inline transitions overlap with Layout.css `.ant-layout-sider` and `.main-content` transitions
- `will-change: margin-left` on `.main-content` is good but the corresponding `will-change: width` on `.ant-layout-sider` is missing
- DnD drag overlay uses `z-index: 9999` in index.css — outside the centralized scale

## Questions to Consider

1. **What if the header showed the current job/claim context instead of just the company name?** "Smith Residence — Water Damage | 3 Follow-ups Due" makes the shell itself an operational dashboard.

2. **Could "Tools & Data" be split into "Data" (Clients, Line Items, Templates) and "Utilities" (PDF Editor, AI Detection, Insurance Extraction)?** This would bring every submenu under 7 items.

3. **Is a Ctrl+K command palette the single highest-ROI feature for daily power users?** It would instantly make every destination 1 keystroke away.
