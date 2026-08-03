---
name: MJ Estimate
description: Insurance restoration claim lifecycle management
colors:
  primary: "#1890ff"
  primary-hover: "#40a9ff"
  primary-deep: "#096dd9"
  success: "#52c41a"
  success-light: "#f6ffed"
  warning: "#fa8c16"
  warning-light: "#fff7e6"
  error: "#ff4d4f"
  error-deep: "#cf1322"
  purple: "#722ed1"
  neutral-900: "#1f1f1f"
  neutral-800: "#262626"
  neutral-700: "#595959"
  neutral-600: "#8c8c8c"
  neutral-400: "#d9d9d9"
  neutral-200: "#f0f0f0"
  neutral-100: "#f5f5f5"
  neutral-50: "#fafafa"
  surface: "#ffffff"
  sidebar-start: "#001529"
  sidebar-end: "#1f1f1f"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.3
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.4
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5714
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.3
  mono:
    fontFamily: "source-code-pro, Menlo, Monaco, Consolas, 'Courier New', monospace"
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
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "4px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.surface}"
  button-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.neutral-800}"
    rounded: "{rounded.md}"
    padding: "4px 16px"
  card-standard:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "16px"
  card-compact:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "12px"
  input-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.neutral-800}"
    rounded: "{rounded.md}"
    padding: "4px 11px"
  input-focus:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.neutral-800}"
  tag-cyan:
    backgroundColor: "#e6f4ff"
    textColor: "#0958d9"
    rounded: "{rounded.xl}"
    padding: "2px 8px"
  tag-purple:
    backgroundColor: "#f9f0ff"
    textColor: "#531dab"
    rounded: "{rounded.xl}"
    padding: "2px 8px"
  tag-volcano:
    backgroundColor: "#fff2e8"
    textColor: "#d4380d"
    rounded: "{rounded.xl}"
    padding: "2px 8px"
  sidebar-nav:
    backgroundColor: "{colors.sidebar-start}"
    textColor: "{colors.surface}"
---

# Design System: MJ Estimate

## Overview

**Creative North Star: "The Claim Command Center"**

A calm, structured operations hub where restoration professionals manage complex insurance claims without the interface competing for attention. The system communicates through clarity, not decoration: clean data surfaces, predictable component behavior, and deliberate use of color only where it earns its place. Every screen should feel like an instrument panel — dense with useful information, yet quiet until something demands action.

The design language inherits from Ant Design 5.x and extends it conservatively. System fonts keep the interface fast and platform-native. The 8px spacing grid creates consistent rhythm without visible rigidity. Color enters the UI through semantic meaning (status, priority, category) rather than brand expression — the product's identity lives in its information architecture, not its palette.

The interface serves two contexts simultaneously: a desktop command center for office-based claim management, and a stripped-down field mode for tablet use on construction sites. Both share the same component vocabulary but differ in density and touch accommodation.

**Key Characteristics:**
- Information-dense without feeling crowded — tight spacing, small type, maximum data per viewport
- Color is semantic, not decorative — blue for primary actions, green/orange/red for status
- Flat surfaces with minimal elevation — shadows appear only on hover and modals
- System fonts for speed and platform familiarity
- Sidebar navigation with dark background provides spatial grounding

## Colors

A functional palette built on Ant Design defaults with semantic color assignments. Color communicates state and priority; neutrals do the structural work.

### Primary
- **Action Blue** (#1890ff): Primary buttons, active navigation items, links, focus rings. The single interactive accent across the system.
- **Action Blue Hover** (#40a9ff): Hover state for primary interactive elements.
- **Action Blue Deep** (#096dd9): Pressed state and high-emphasis text links.

### Secondary
- **Indicator Purple** (#722ed1): Secondary categorization, alternative status tags, and data visualization accents where blue is already in use.

### Neutral
- **Ink** (#1f1f1f): Heaviest text — page titles and primary data values.
- **Charcoal** (#262626): Standard body text and table cell content.
- **Steel** (#595959): Secondary text, descriptions, and metadata.
- **Ash** (#8c8c8c): Tertiary text, placeholders, and disabled states.
- **Silver** (#d9d9d9): Borders, dividers, and input outlines at rest.
- **Smoke** (#f0f0f0): Subtle dividers and table header backgrounds.
- **Mist** (#f5f5f5): Secondary surface backgrounds and hover states.
- **Frost** (#fafafa): Lightest surface — toolbar backgrounds and alternating rows.
- **White** (#ffffff): Primary surface background for cards and content areas.

### Status Colors
- **Success** (#52c41a) on light green (#f6ffed): Completed jobs, approved estimates, positive metrics.
- **Warning** (#fa8c16) on light orange (#fff7e6): Items needing attention, approaching deadlines, medium priority.
- **Error** (#ff4d4f) on light red: Failed operations, overdue items, critical alerts.

### Named Rules
**The Semantic-Only Rule.** Color is never used for decoration or brand expression in the application UI. Every colored element communicates a specific state, status, or interactive affordance. If removing the color would lose information, it belongs. If removing it would only lose aesthetics, it doesn't.

## Typography

**System Font:** -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif
**Monospace Font:** source-code-pro, Menlo, Monaco, Consolas, 'Courier New', monospace

**Character:** Platform-native system fonts chosen for rendering speed and familiarity. No custom font loading — the interface should feel like a professional tool installed on the user's machine, not a branded web experience. The monospace stack appears in code references, Xactimate line codes, and financial calculations.

### Hierarchy
- **Display** (600, 24px, 1.3): Page titles only — one per screen maximum.
- **Headline** (600, 20px, 1.4): Section headers within a page, sidebar logo text.
- **Title** (600, 16px, 1.5): Card headers, modal titles, group labels.
- **Body** (400, 14px, 1.5714): Standard content text, table cells, form labels. The workhorse size — Ant Design's baseline.
- **Label** (400, 12px, 1.3): Metadata, timestamps, secondary descriptions, mobile-compressed content.
- **Micro** (400, 10-11px, 1.2): Tag content, small badges, help text in dense views.

### Named Rules
**The 14px Floor Rule.** Interactive text (buttons, links, form labels) never drops below 14px. Smaller sizes are reserved for non-interactive metadata. On mobile (<576px), body text may compress to 12px for density, but touch targets remain at 14px minimum.

## Layout

The layout follows a fixed sidebar + fluid content pattern. The sidebar (280px expanded, 80px collapsed) provides persistent navigation with a dark gradient background. Content fills the remaining width with no maximum constraint — the system trusts Ant Design's grid and table components to handle wide viewports.

**Spacing rhythm:** 8px base unit. Common stops at 4, 8, 12, 16, 24, and 32px. Card padding steps down from 24px (spacious) through 16px (normal) to 12px (compact) and 8px (extra-compact) depending on information density.

**Responsive behavior:**
- **Desktop (>1024px):** Full sidebar, 24px content margins, standard density.
- **Tablet (577-768px):** Collapsed sidebar, 12px margins, compressed typography.
- **Mobile (<576px):** Hidden sidebar with overlay toggle, 8px margins, stacked layouts, reduced card padding.

**Content area:** White background card with 8px radius and minimal shadow, floating over a neutral page background. Minimum height fills the viewport minus header and margin.

**The No-Max-Width Rule.** Content areas never impose a `max-width`. Tables, dashboards, and forms stretch to use available screen real estate. Restoration professionals often work on wide monitors with multiple claims visible — artificial width constraints waste their primary resource: screen space.

## Elevation & Depth

The system is flat by default. Depth is communicated through tonal layering (white cards on gray backgrounds, dark sidebar against light content) rather than shadow. Shadows appear as responses to user interaction or to establish modal hierarchy.

### Shadow Vocabulary
- **Ambient** (`0 1px 3px rgba(0,0,0,0.1)`): Content cards at rest — barely perceptible, just enough to separate from the page background.
- **Header** (`0 1px 4px rgba(0,21,41,0.08)`): Sticky header shadow using the sidebar's dark hue for visual continuity.
- **Hover** (`0 2px 8px rgba(0,0,0,0.15)`): Interactive card hover states — subtle lift feedback.
- **Elevated** (`0 4px 12px rgba(0,0,0,0.15)`): Modals, dropdown menus, and floating action bars.
- **High** (`0 8px 24px rgba(0,0,0,0.12)`): Gallery lightbox overlays and full-screen modals.
- **Bottom bar** (`0 -4px 12px rgba(0,0,0,0.15)`): Upward-casting shadow for fixed bottom action bars.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadows appear only as a response to state (hover, focus, elevation change) or to establish overlay hierarchy (modals, drawers, dropdowns). A shadow on a static, non-interactive card means the elevation vocabulary is being diluted.

## Shapes

Gently rounded corners with an escalating scale. The system avoids sharp corners (which feel aggressive in a dense UI) and fully rounded shapes (which waste horizontal space in data-heavy layouts).

- **Micro elements** (scrollbar thumbs, tiny indicators): 3px radius
- **Standard interactive elements** (buttons, inputs, tags): 6px radius — the system default
- **Container elements** (cards, dialogs, content areas): 8px radius
- **Pill shapes** (status tags, category badges): 12px radius — reserved for small, glanceable labels
- **Borders:** 1px solid, using Silver (#d9d9d9) at rest. Focus shifts the border to Action Blue (#1890ff). No border-width changes on state transitions — color carries the signal.

## Components

### Buttons
Clean, compact buttons that prioritize label clarity over visual weight.
- **Shape:** Gently rounded (6px radius)
- **Primary:** Action Blue fill, white text, 4px 16px padding. No shadow at rest.
- **Hover:** Lighter blue (#40a9ff), no transform or shadow — color shift only.
- **Focus:** 2px solid Action Blue outline, 2px offset.
- **Default:** White fill, dark text, Silver border. Hover shifts background to Frost.
- **Ghost/Text:** No fill or border. Text-only with hover background.
- **Danger:** Error Red fill for destructive actions. Used sparingly.

### Cards / Containers
White surface containers that organize content into scannable regions.
- **Corner Style:** Rounded (8px radius)
- **Background:** White (#fff)
- **Shadow:** Ambient at rest (0 1px 3px rgba(0,0,0,0.1)). Hover adds Elevated shadow in interactive cards.
- **Border:** None by default — shadow provides separation. Optional 1px Silver border in zero-elevation contexts.
- **Internal Padding:** Three density tiers — 24px (spacious), 16px (standard), 12px (compact), 8px (extra-compact for mobile/dense views).

### Inputs / Fields
Minimal, clear form controls that stay out of the way until focused.
- **Style:** White fill, 1px Silver border, 6px radius, 4px 11px internal padding.
- **Focus:** Border shifts to Action Blue. Subtle blue glow outline (2px).
- **Error:** Border shifts to Error Red with error message below in 12px red text.
- **Disabled:** Frost background, Ash text, no border color change.

### Tags / Badges
Pill-shaped status indicators with tinted backgrounds and saturated text.
- **Shape:** Fully rounded (12px radius), compact padding (2px 8px).
- **Cyan variant:** Light blue (#e6f4ff) fill, deep blue (#0958d9) text, blue border (#91caff).
- **Purple variant:** Light purple (#f9f0ff) fill, deep purple (#531dab) text, purple border (#d3adf7).
- **Volcano variant:** Light orange (#fff2e8) fill, deep red-orange (#d4380d) text, orange border (#ffbb96).
- **Default variant:** Frost fill, Steel text, Silver border.

### Navigation (Sidebar)
Dark, full-height sidebar with gradient background providing spatial anchor.
- **Background:** Gradient from Navy (#001529) to Dark (#1f1f1f) at 135 degrees.
- **Text:** White at 85% opacity (default), full white (active/hover).
- **Active item:** Subtle highlight with Action Blue indicator or background tint.
- **Collapse transition:** 300ms with cubic-bezier(0.4, 0, 0.2, 1) — smooth, non-bouncy.
- **Expanded width:** 280px. Collapsed: 80px. Mobile: hidden with overlay.
- **Mobile overlay:** Black at 45% opacity behind the drawer.

### Tables
High-density data display optimized for scanning many records.
- **Header:** Smoke (#f0f0f0) background, bold labels.
- **Cell padding:** 8px 6px (normal), 6px 4px (compact/mobile).
- **Row hover:** Frost (#fafafa) background.
- **Horizontal scroll:** Enabled on mobile with momentum scrolling (-webkit-overflow-scrolling: touch).

## Do's and Don'ts

### Do:
- **Do** use the 8px spacing grid. All padding, margin, and gap values should be multiples of 4px (4, 8, 12, 16, 24, 32).
- **Do** use semantic color only — every colored element must communicate state, status, or interactive affordance.
- **Do** include focus ring styles (2px solid #1890ff, 2px offset) on every interactive element.
- **Do** provide `prefers-reduced-motion` overrides that disable transitions and animations.
- **Do** use compact card padding (12px) and small cell padding (6px 4px) on mobile viewports.
- **Do** keep interactive text at 14px minimum. Smaller sizes are for metadata only.

### Don't:
- **Don't** add shadows to static, non-interactive surfaces. Shadows are earned through interaction or overlay hierarchy.
- **Don't** impose max-width constraints on content areas. Let tables and dashboards use full viewport width.
- **Don't** use color for decoration. If removing the color doesn't remove information, the color doesn't belong.
- **Don't** use custom fonts. The system font stack is intentional — loading external fonts adds latency and breaks the native-tool feel.
- **Don't** scale elements on hover (transform: scale) in data-dense views. Reserve scale transforms for gallery thumbnails and icon buttons only.
- **Don't** mix border-radius values within a single component. Cards are 8px, buttons are 6px, pills are 12px — don't combine.
