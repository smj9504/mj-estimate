/**
 * Design Tokens — single source of truth for the visual system.
 * Derived from DESIGN.md. Import these instead of hardcoding hex values.
 *
 * Usage:
 *   import { colors, spacing, radius, typography, shadows } from '@/styles/tokens';
 *   // or: import { colors } from '../../styles/tokens';
 */

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

// Warm, Notion-like neutrals. Accent blue is reserved for primary actions,
// links and selection; everything else is ink on white.
export const colors = {
  // Primary
  primary: '#1f74c9',
  primaryHover: '#1a64ae',
  primaryDeep: '#155594',

  // Secondary
  purple: '#9065b0',

  // Status
  success: '#448361',
  successLight: '#edf3ec',
  warning: '#d9730d',
  warningLight: '#fbecdd',
  error: '#d44c47',
  errorDeep: '#b5403b',
  errorLight: '#fdebec',

  // Neutral
  neutral900: '#37352f',  // Ink — page titles, primary data, body text
  neutral800: '#37352f',  // Ink — body text, table cells
  neutral700: '#5f5e5b',  // Secondary text, metadata
  neutral600: '#73726e',  // Tertiary text, labels, placeholders
  neutral400: '#dfdfdc',  // Input outlines, strong dividers
  neutral200: '#e9e9e7',  // Hairline dividers
  neutral100: '#f1f1ef',  // Hover, secondary surfaces
  neutral50: '#f7f7f5',   // Sidebar, quiet panels
  surface: '#ffffff',     // Page

  // Sidebar
  sidebarStart: '#f7f7f5',
  sidebarEnd: '#f7f7f5',

  // Tag variants (kept for older call sites; map onto the pastel palette)
  tagCyanBg: '#e7f3f8',
  tagCyanText: '#337ea9',
  tagCyanBorder: '#e7f3f8',
  tagPurpleBg: '#f6f3f9',
  tagPurpleText: '#9065b0',
  tagPurpleBorder: '#f6f3f9',
  tagVolcanoBg: '#fbecdd',
  tagVolcanoText: '#d9730d',
  tagVolcanoBorder: '#fbecdd',
} as const;

// ---------------------------------------------------------------------------
// Pastel tag palette — borderless pills for status and category values
// ---------------------------------------------------------------------------

export type TagTone =
  | 'gray' | 'brown' | 'orange' | 'yellow' | 'green'
  | 'blue' | 'purple' | 'pink' | 'red';

export const tagTones: Record<TagTone, { bg: string; text: string }> = {
  gray: { bg: '#f1f1ef', text: '#6f6e69' },
  brown: { bg: '#f4eeee', text: '#8a5a45' },
  orange: { bg: '#fbecdd', text: '#a65208' },
  yellow: { bg: '#fbf3db', text: '#8f6714' },
  green: { bg: '#edf3ec', text: '#3f7a5a' },
  blue: { bg: '#e7f3f8', text: '#2f74a0' },
  purple: { bg: '#f6f3f9', text: '#8459a5' },
  pink: { bg: '#faf1f5', text: '#b5427f' },
  red: { bg: '#fdebec', text: '#b93a35' },
};

// ---------------------------------------------------------------------------
// Spacing (8px grid)
// ---------------------------------------------------------------------------

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

// ---------------------------------------------------------------------------
// Border Radius
// ---------------------------------------------------------------------------

export const radius = {
  xs: 3,   // Micro elements (scrollbar thumbs)
  sm: 4,   // Tags, small interactive elements
  md: 6,   // Buttons, inputs — system default
  lg: 8,   // Cards, dialogs, content areas
  xl: 12,  // Sheets, large panels
} as const;

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export const fontFamily = {
  system: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', Helvetica, 'Apple Color Emoji', Arial, sans-serif",
  mono: "SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
} as const;

export const typography = {
  display: { fontSize: 24, fontWeight: 600, lineHeight: 1.3 },
  headline: { fontSize: 20, fontWeight: 600, lineHeight: 1.4 },
  title: { fontSize: 16, fontWeight: 600, lineHeight: 1.5 },
  body: { fontSize: 14, fontWeight: 400, lineHeight: 1.5714 },
  label: { fontSize: 12, fontWeight: 400, lineHeight: 1.3 },
  mono: { fontSize: 13, fontWeight: 400, lineHeight: 1.5 },
} as const;

// ---------------------------------------------------------------------------
// Shadows (from DESIGN.md Elevation & Depth)
// ---------------------------------------------------------------------------

// Flat by default: surfaces separate with hairlines, only floating layers
// (menus, popovers, dialogs) cast a shadow.
export const shadows = {
  ambient: 'none',
  header: 'none',
  hover: '0 1px 2px rgba(15, 15, 15, 0.06)',
  elevated: 'rgba(15, 15, 15, 0.05) 0 0 0 1px, rgba(15, 15, 15, 0.1) 0 3px 6px, rgba(15, 15, 15, 0.2) 0 9px 24px',
  high: 'rgba(15, 15, 15, 0.05) 0 0 0 1px, rgba(15, 15, 15, 0.1) 0 5px 10px, rgba(15, 15, 15, 0.2) 0 15px 40px',
  bottomBar: '0 -1px 0 rgba(55, 53, 47, 0.09)',
} as const;

// ---------------------------------------------------------------------------
// Breakpoints
// ---------------------------------------------------------------------------

export const breakpoints = {
  xs: 576,
  sm: 768,
  md: 992,
  lg: 1200,
} as const;

// ---------------------------------------------------------------------------
// Z-Index Scale (centralized to prevent collisions)
// ---------------------------------------------------------------------------

export const zIndex = {
  bottomNav: 90,
  header: 100,
  actionBar: 900,
  mobileOverlay: 999,
  mobileSidebar: 1000,
  modal: 1050,
  tooltip: 1070,
  skipLink: 10000,
} as const;

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

export const sidebar = {
  expandedWidth: 240,
  collapsedWidth: 64,
} as const;
