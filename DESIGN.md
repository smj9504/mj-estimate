---
name: MJ Estimate
description: A calm, Notion-like back office for insurance restoration work, where the page is a white sheet and status is the only colour.
colors:
  accent-blue: "#1f74c9"
  accent-blue-hover: "#1a64ae"
  accent-blue-deep: "#155594"
  row-selected: "#eef5fc"
  ink: "#37352f"
  ink-secondary: "#5f5e5b"
  ink-tertiary: "#73726e"
  faint-glyph: "#a5a29a"
  border-strong: "#dfdfdc"
  hairline: "#e9e9e7"
  quiet-fill: "#f1f1ef"
  sidebar-paper: "#f7f7f5"
  page-white: "#ffffff"
  ink-hover: "rgba(55, 53, 47, 0.06)"
  ink-selected: "rgba(55, 53, 47, 0.08)"
  success: "#448361"
  warning: "#d9730d"
  error: "#d44c47"
  error-deep: "#b5403b"
  tag-gray-bg: "#f1f1ef"
  tag-gray-text: "#6f6e69"
  tag-brown-bg: "#f4eeee"
  tag-brown-text: "#8a5a45"
  tag-orange-bg: "#fbecdd"
  tag-orange-text: "#a65208"
  tag-yellow-bg: "#fbf3db"
  tag-yellow-text: "#8f6714"
  tag-green-bg: "#edf3ec"
  tag-green-text: "#3f7a5a"
  tag-blue-bg: "#e7f3f8"
  tag-blue-text: "#2f74a0"
  tag-purple-bg: "#f6f3f9"
  tag-purple-text: "#8459a5"
  tag-pink-bg: "#faf1f5"
  tag-pink-text: "#b5427f"
  tag-red-bg: "#fdebec"
  tag-red-text: "#b93a35"
typography:
  display:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', Helvetica, 'Apple Color Emoji', Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', Helvetica, 'Apple Color Emoji', Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  title:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', Helvetica, 'Apple Color Emoji', Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
  row-title:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', Helvetica, 'Apple Color Emoji', Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.35
  body:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', Helvetica, 'Apple Color Emoji', Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5714
  meta:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', Helvetica, 'Apple Color Emoji', Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', Helvetica, 'Apple Color Emoji', Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "20px"
  mono:
    fontFamily: "SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  xs: "3px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent-blue}"
    textColor: "{colors.page-white}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.accent-blue-hover}"
  button-primary-active:
    backgroundColor: "{colors.accent-blue-deep}"
  button-default:
    backgroundColor: "{colors.page-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-default-hover:
    backgroundColor: "{colors.sidebar-paper}"
  button-text-hover:
    backgroundColor: "{colors.ink-hover}"
  input:
    backgroundColor: "{colors.page-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "32px"
  pill:
    backgroundColor: "{colors.tag-gray-bg}"
    textColor: "{colors.tag-gray-text}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 6px"
    height: "20px"
  company-monogram:
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 4px"
    height: "20px"
    width: "20px"
  property-label:
    textColor: "{colors.ink-tertiary}"
    typography: "{typography.body}"
    width: "160px"
  property-value:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
  page-title:
    textColor: "{colors.ink}"
    typography: "{typography.display}"
  section-heading:
    textColor: "{colors.ink}"
    typography: "{typography.title}"
  sidebar:
    backgroundColor: "{colors.sidebar-paper}"
    width: "240px"
  sidebar-item-selected:
    backgroundColor: "{colors.ink-selected}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "30px"
  top-bar:
    backgroundColor: "{colors.page-white}"
    height: "52px"
    padding: "0 16px"
  mobile-row:
    backgroundColor: "{colors.page-white}"
    padding: "12px 16px"
  table-row-selected:
    backgroundColor: "{colors.row-selected}"
---

# Design System: MJ Estimate

## Overview

**Creative North Star: "The White Sheet"**

The page is a sheet of white paper, not a card sitting on a grey board. Content sits directly on it: a semibold page title, a quiet meta line, one row of filters, then rows of records. Sections are a 16px heading over a single hairline, not boxed cards nested in boxed cards. Facts on a detail page read as Notion property rows: a grey label column, an ink value column, and no table borders. The sidebar is a slightly warmer paper (#f7f7f5) separated by a hairline, never a navy rail.

Colour is rationed. Everything is warm ink on white; the one accent blue is reserved for primary actions, links, focus and selection. State is carried by nine borderless pastel tones in sentence case, and company identity by a small square monogram tile in its own pastel tone, so a company never reads as one more status. Depth is near-zero: hairlines separate surfaces at rest, and only floating layers (menus, popovers, dialogs, the sticky phone nav) lift off the page.

The system is built inside Ant Design 5 through theme tokens (`antTheme.ts`), a global surface layer (`notion.css`) that reaches what tokens cannot, and three primitives (Pill, PageHeader, PropertyList). Density is a working back office: 14px body, 32px controls, 30px menu items, 34px property rows. It is used as often on a phone in the field as at a desk.

**Coverage boundary.** The system is fully applied only to the app shell, the global theme, Water Mitigation list and detail (including the Photos, Scope and Report tabs and the shared FileGallery), Estimate Creation, the Repair Estimate Wizard, and Supplements list and detail (`/supplements`). Supplement status tones live in one map (`components/supplement/supplementUi.tsx`: Identified orange, In progress blue, Submitted purple, Under review yellow, Approved green, Denied red, Withdrawn gray); supplement-only surface classes are the `sup-*` block at the end of `notion.css`. The WM Sketch tab inherits the theme only: its tool and legend colours mirror the canvas and the exported PDF, so they are deliberately left as they are. Claim Follow-up pages are owned by a concurrent session and are not yet on this system. About 80 other pages inherit only the theme tokens and the global tag, table and card overrides; they still contain hardcoded legacy antd hex colours and inline styles. Treat those pages as unmigrated, not as precedent.

**Key Characteristics:**
- White page, warm-grey sidebar, hairline (#e9e9e7) separation, no shadow at rest.
- One accent blue for actions, links, focus and selection; money and totals stay ink.
- Nine borderless pastel tag pairs, sentence case, 4px radius, 12px/500.
- Company identity as a square pastel monogram tile, never a pill.
- Property rows (grey label, ink value, no borders) for detail facts.
- System sans throughout, 14px body, 24px semibold page titles.
- Phone-first affordances: 52px top bar, 56px bottom nav, single-column row list.

## Colors

Warm, low-chroma neutrals carry nearly the whole interface; one darkened blue and nine pastel pairs carry everything that means something.

### Primary
- **Ledger Blue** (accent-blue): primary buttons, links, focus outline, switch, selected table rows and the active pagination item. Darkened from Notion's blue so white button text clears 4.5:1. Hover steps to accent-blue-hover, press to accent-blue-deep.
- **Selection Wash** (row-selected): the background of a checked table row; never a surface colour.

### Neutral
- **Warm Ink** (ink): page titles, body text, values, numbers and money, record-title links, the active sidebar item, the tab ink bar, the tooltip background.
- **Secondary Ink** (ink-secondary): unselected sidebar items and secondary text.
- **Label Grey** (ink-tertiary): property labels, table headers, meta lines, breadcrumbs, inactive tabs, input placeholders. 4.75:1 on white.
- **Faint Glyph** (faint-glyph): decorative, aria-hidden property icons only. It is below text contrast; do not set words in it.
- **Control Border** (border-strong): input and default-button outlines.
- **Hairline** (hairline): every divider, card border, table row rule, section underline and sidebar edge.
- **Quiet Fill** (quiet-fill): segmented-control track and secondary fills.
- **Sidebar Paper** (sidebar-paper): the sidebar and default-button hover.
- **Page White** (page-white): the page, the top bar, table headers, cards and modals. There is no grey layout background.
- **Ink Hover / Ink Selected** (ink-hover, ink-selected): translucent ink fills for hover and selection in menus, selects and text buttons, so they read the same on white and on the sidebar.

### Status
- **Success / Warning / Error** (success, warning, error): antd feedback colours (form validation, message toasts, danger buttons), pastel-family hues rather than antd's saturated defaults.

### Pastel tag tones
Nine background/text pairs: gray, brown, orange, yellow, green, blue, purple, pink, red (tag-*-bg / tag-*-text). Each text colour is darkened enough to read on its own pastel. Every antd preset tag colour (blue, geekblue, cyan, lime, volcano, gold, magenta, processing, success, warning, error) folds onto one of these nine globally.

Water Mitigation job status uses a fixed map: Lead gray, Doc prepping brown, Sent to adjuster blue, Follow up orange, Paperwork received purple, Estimate requested pink, Check received yellow, Complete green. Payment facts use the same tones: check to contractor blue, to customer orange, received green, pending gray.

### Named Rules
**The One Accent Rule.** Blue means "you can act here" or "this is selected". Totals, amounts and record titles stay ink, however important they are.

**The Same Key, Same Tone Rule.** A value that has a colour gets it from a fixed map (status) or from a stable hash of its id (companies, `toneFromKey`), so it reads the same colour on every page. The hash draws from seven tones and skips gray (reads as empty) and red (reads as an error).

## Typography

**Display Font:** system UI sans (ui-sans-serif, -apple-system, Segoe UI Variable Text, Segoe UI, Helvetica, Arial)
**Body Font:** the same system stack
**Label/Mono Font:** SFMono-Regular, Menlo, Consolas, Liberation Mono (code and identifiers only)

**Character:** One native sans at every size, as in Notion. Hierarchy comes from weight (600 headings, 500 emphasis, 400 text) and a tight scale, not from a second family.

### Hierarchy
- **Display** (600, 24px, 1.3, -0.015em; 22px under 768px): the page title, one per page, directly on the sheet.
- **Headline** (600, 20px, 1.4): antd h3 headings inside pages; rarely needed.
- **Title** (600, 16px, 1.5): section headings over a hairline, modal titles.
- **Row Title** (500, 15px, 1.35): the record title in a phone row list.
- **Body** (400, 14px, 1.5714): text, table cells, property labels and values, menu items, buttons (500 on buttons).
- **Meta** (400, 13px): page meta lines, row meta, table headers (500), breadcrumbs, statistic titles; property labels drop to 13px on phones.
- **Label** (500, 12px, 20px line): pills and tags. Company monograms use 600 at 11px with 0.02em tracking.

Money columns, statistics and description values use tabular numerals so figures line up.

### Named Rules
**The Sentence Case Rule.** Statuses and labels are humanized to sentence case ("Awaiting response", not "AWAITING_RESPONSE"); `humanize()` exists for raw enum values. Uppercase appears only where the data itself is a code, such as a company's short code in its monogram.

**The Grey Label Rule.** Labels are regular weight (400) in Label Grey; values are ink. Weight never distinguishes a label from its value.

## Layout

Desktop: a 240px sidebar (64px collapsed) in Sidebar Paper with a hairline right edge, a 52px white top bar (16px side padding) with search and the user, and the page on white. A breadcrumb in 13px grey sits above the page header. The page header is a flex row: title and meta on the left (basis 320px), actions on the right aligned to the title's baseline area, wrapping below when space runs out; 20px under it.

Lists: one toolbar row of filters (8px gaps, 12px below), the end group pushed right. Desktop lists are antd tables with 10px x 12px cells; phones switch to a full-bleed row list (one tappable block per record, 12px x 16px padding, hairline between rows): status pill first, then the record title, then a meta line of company monogram, homeowner, claim and counts.

Details: a main column of sections (property rows) beside a narrower column for history and integration facts on desktop; one column on phones. Sections are spaced 28px apart.

Property rows: a two-column grid, label 160px on desktop (`PropertyList` default) and 136px under 576px, 8px gap, 34px minimum row height, 6px padding.

Phones (under 768px): the sidebar becomes an overlay drawer; a 56px bottom nav (plus safe-area inset) carries Home, Claims, Create, Estimates, More; content gets matching bottom padding. Page actions, sheet-card titles and the toolbar wrap rather than truncate; the status filter goes full width. Coarse pointers get 40px menu items.

Spacing follows a 4/8 rhythm: 4, 8, 12, 16, 24, 32. Breakpoints: 576, 768, 992, 1200px.

## Elevation & Depth

Flat by default. Surfaces separate with hairlines and tonal steps (white page, warm-grey sidebar), not shadows. Cards and buttons carry no shadow. Only floating layers lift: dropdowns, select menus, date pickers, popovers and modals use a soft three-layer shadow; a hoverable card gets a 1px hint on hover. The phone bottom nav is a translucent white bar (94%) with a hairline top edge.

### Shadow Vocabulary
- **Hover hint** (`box-shadow: 0 1px 2px rgba(15, 15, 15, 0.06)`): hoverable cards on hover, with the border stepping to Control Border.
- **Elevated** (`box-shadow: rgba(15, 15, 15, 0.05) 0 0 0 1px, rgba(15, 15, 15, 0.1) 0 3px 6px, rgba(15, 15, 15, 0.2) 0 9px 24px`): menus, select dropdowns, pickers, popovers.
- **High** (`box-shadow: rgba(15, 15, 15, 0.05) 0 0 0 1px, rgba(15, 15, 15, 0.1) 0 5px 10px, rgba(15, 15, 15, 0.2) 0 15px 40px`): the highest floating layers.

### Named Rules
**The Only Floaters Cast Shadows Rule.** If it sits on the page, it is flat with a hairline. If it floats above the page, it gets the Elevated shadow. Nothing in between.

## Shapes

Small, quiet corners. Tags, pills, monograms, property-row hover fills and the scrollbar thumb use 4px or less; buttons, inputs, selects and menu items 6px; cards 8px; modals and drawers 12px. Section cards on migrated pages drop their box entirely (no border, no radius, transparent) and become a heading over a 1px hairline. Borders are always 1px; table headers have no column separators. The brand mark is a 22px ink square with 5px corners; the phone Create button is a 32x24px ink tile with 8px corners.

## Components

### Buttons
Restrained and compact.
- **Shape:** gently rounded (6px), 32px tall, 12px inline padding, weight 500, no shadow on any variant.
- **Primary:** Ledger Blue with white text; one per page header, top right.
- **Hover / Focus:** primary darkens to accent-blue-hover then accent-blue-deep on press; keyboard focus is a 2px outline in 55% Ledger Blue, 1px offset.
- **Default:** white, Control Border outline, ink text; hover fills Sidebar Paper without changing the border.
- **Text / icon:** no fill until hover (ink-hover).

### Pills (status and category)
Borderless pastel chips for values that carry state; plain facts stay plain text.
- **Style:** 20px tall, 6px inline padding, 4px radius, 12px/500, tone background with tone text, no border, single line with ellipsis. An optional 11px leading icon (direction arrow, check, clock).
- **Rule:** status goes first in a list row and next to the title in a page header.

### Company Monogram
A square pastel tile (minimum 20x20px, 4px radius, 11px/600, 0.02em tracking) showing the company's short code, toned by a hash of its id, with the full name in its title attribute. It is a different shape from a pill on purpose: it never reads as a second status.

### Property Rows (signature)
Facts on a detail page as Notion property rows: a grid of grey label (Label Grey, 14px/400; 13px on phones) and ink value (14px), 8px gap, no borders. Rows highlight on hover with a 3% ink wash and 4px radius. Missing values show the word "Empty" rather than a dash. Optional label icons are decorative and aria-hidden. The same layout is available for antd Descriptions (`bordered={false} column={1}`) so existing call sites convert without restructuring.

### Section Sheets
A Card that reads as a heading on the page: no box, a 16px/600 title over a 1px hairline with actions (often a text "Edit" button) on the right, body directly below. On phones the title wraps instead of ellipsizing next to its actions.

### Quiet Icon Buttons
Row and section actions (edit, delete) are text icon buttons in Label Grey that turn ink on hover; destructive ones turn red with a red wash only on hover (`.ui-icon-btn`, `.ui-icon-btn--danger`). Delete never sits at rest as a red outlined button. Only one primary button per tab or page.

### Collapsible Rows
Grouped records (scope locations, debris summary) use a ghost Collapse divided by hairlines (`.ui-collapse-rows`): a 15px/600 title with a grey meta line under it ("1st Floor · kitchen · 4 items"), and state as a pill beside the title. There are no tags for plain facts and no count badges.

### View Tabs and Filter Chips
- **View tabs** (`.ui-view-tab`): 26px text buttons in Label Grey; the selected one fills ink-selected with ink text. Use them to switch a source or view, never solid blue.
- **Filter chips** (`.ui-filter-chip`): 26px, 6px radius, hairline border, 13px Secondary Ink. A category keeps its colour as an 8px dot. Selected chips fill ink-selected with ink text and a check. Category colours come from one map (`FileGallery/categoryColors.ts`) shared by the chip dots and the thumbnail labels. Grey is only for Uncategorized; unknown categories hash to a stable pastel-family tone.
- **View switch** (Grid / List / Card): antd Segmented, not a solid radio group.

### Cards / Containers
- **Corner Style:** 8px.
- **Background:** white.
- **Shadow Strategy:** none at rest (see Elevation & Depth).
- **Border:** 1px hairline; header separated by a hairline, header title 600.
- **Internal Padding:** antd defaults; prefer Section Sheets on migrated pages.

### Inputs / Fields
- **Style:** white, 1px Control Border, 6px radius, 32px tall; hover border steps to #c8c7c3.
- **Focus:** a 2px Ledger Blue ring at 18% opacity.
- **Placeholder:** Label Grey (4.75:1), so it stays legible while remaining lighter than ink values.

### Tables
Quiet headers: white background, 13px/500 Label Grey text, no column separators, hairline row rules, a 3% ink wash on row hover, Selection Wash on checked rows. Record titles are ink links (500) whose underline grows in on hover, not blue links.

### Navigation
- **Sidebar:** Sidebar Paper, items 30px tall with 8px side margin and 6px radius, 14px Secondary Ink; hover fills ink-hover and turns ink; the selected item fills ink-selected, ink text, weight 500. No active bar, no accent colour. Group titles in Label Grey.
- **Tabs:** 14px Label Grey, ink on hover and when selected, a thin ink underline (not blue), 20px gutter.
- **Breadcrumb:** 13px Label Grey, last item ink.
- **Phone:** 52px top bar with a menu toggle, search and avatar (the avatar uses the brown tag tone); a 56px bottom nav with 20px icons over 11px/500 labels, grey to ink when active, and an ink Create tile in the centre.

## Do's and Don'ts

### Do:
- **Do** put content directly on the white page; use a 16px/600 heading over a 1px hairline (#e9e9e7) to start a section.
- **Do** show detail facts as property rows: grey 400 label column (160px desktop, 136px phone), ink value column, no borders, "Empty" for missing values.
- **Do** use the Pill primitive with one of the nine tones for any value that carries state, in sentence case, and take its tone from a fixed map or `toneFromKey`.
- **Do** show a company as its square monogram tile, toned by its id.
- **Do** reserve Ledger Blue (#1f74c9) for primary actions, links, focus and selection; keep amounts and totals in ink.
- **Do** use the PageHeader primitive: 24px/600 title (22px on phones), 13px grey meta line, actions on the right that wrap below on phones.
- **Do** give only floating layers (menus, popovers, pickers, modals) the Elevated shadow.
- **Do** take colours from `tokens.ts` / `tokens.css` variables instead of hex literals when migrating a page.

### Don't:
- **Don't** wrap page sections in bordered, shadowed cards, or nest cards inside cards.
- **Don't** use a dark or navy sidebar, or a blue active bar on navigation; selection is an ink wash.
- **Don't** give tags borders, saturated antd colours, or ALL-CAPS enum text.
- **Don't** render a company as a pill, or use gray or red for a company tone.
- **Don't** colour money, totals or record titles blue.
- **Don't** set readable text in Faint Glyph (#a5a29a); it is for decorative icons only.
- **Don't** treat unmigrated pages (Claim Follow-up and the roughly 80 legacy pages) as precedent for colour or spacing.
