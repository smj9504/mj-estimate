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

export const colors = {
  // Primary
  primary: '#1890ff',
  primaryHover: '#40a9ff',
  primaryDeep: '#096dd9',

  // Secondary
  purple: '#722ed1',

  // Status
  success: '#52c41a',
  successLight: '#f6ffed',
  warning: '#fa8c16',
  warningLight: '#fff7e6',
  error: '#ff4d4f',
  errorDeep: '#cf1322',
  errorLight: '#fff2f0',

  // Neutral
  neutral900: '#1f1f1f',  // Ink — page titles, primary data
  neutral800: '#262626',  // Charcoal — body text, table cells
  neutral700: '#595959',  // Steel — secondary text, metadata
  neutral600: '#8c8c8c',  // Ash — tertiary text, placeholders, disabled
  neutral400: '#d9d9d9',  // Silver — borders, dividers, input outlines
  neutral200: '#f0f0f0',  // Smoke — subtle dividers, table headers
  neutral100: '#f5f5f5',  // Mist — secondary surfaces, hover
  neutral50: '#fafafa',   // Frost — lightest surface, alternating rows
  surface: '#ffffff',     // White — primary card/content background

  // Sidebar
  sidebarStart: '#001529',
  sidebarEnd: '#1f1f1f',

  // Tag variants
  tagCyanBg: '#e6f4ff',
  tagCyanText: '#0958d9',
  tagCyanBorder: '#91caff',
  tagPurpleBg: '#f9f0ff',
  tagPurpleText: '#531dab',
  tagPurpleBorder: '#d3adf7',
  tagVolcanoBg: '#fff2e8',
  tagVolcanoText: '#d4380d',
  tagVolcanoBorder: '#ffbb96',
} as const;

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
  sm: 4,   // Small interactive elements
  md: 6,   // Buttons, inputs, tags — system default
  lg: 8,   // Cards, dialogs, content areas
  xl: 12,  // Pill shapes (status tags, badges)
} as const;

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export const fontFamily = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
  mono: "source-code-pro, Menlo, Monaco, Consolas, 'Courier New', monospace",
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

export const shadows = {
  ambient: '0 1px 3px rgba(0, 0, 0, 0.1)',
  header: '0 1px 4px rgba(0, 21, 41, 0.08)',
  hover: '0 2px 8px rgba(0, 0, 0, 0.15)',
  elevated: '0 4px 12px rgba(0, 0, 0, 0.15)',
  high: '0 8px 24px rgba(0, 0, 0, 0.12)',
  bottomBar: '0 -4px 12px rgba(0, 0, 0, 0.15)',
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
  expandedWidth: 280,
  collapsedWidth: 80,
} as const;
