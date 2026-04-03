/**
 * Water Mitigation Sketch Default Configurations
 *
 * Constant values and preset lists used as initial state across
 * sketch canvas components, form fields, and tool configuration.
 */

// ============================================================================
// Canvas Defaults
// ============================================================================

/** Default canvas pixel width for a new floor sketch */
export const DEFAULT_CANVAS_WIDTH = 1200;

/** Default canvas pixel height for a new floor sketch */
export const DEFAULT_CANVAS_HEIGHT = 800;

/**
 * Default rendering scale: how many canvas pixels represent one real-world foot.
 * At 20 px/ft, a 20×20 ft room occupies 400×400 pixels on the canvas.
 */
export const DEFAULT_SCALE_PIXELS_PER_FOOT = 20;

// ============================================================================
// Floor Protection Defaults
// ============================================================================

/**
 * Default roll width for floor protection material in feet.
 * Standard heavy-duty paper / ram board rolls are typically 36" (3 ft) wide.
 */
export const DEFAULT_PAPER_WIDTH_FT = 3;

/** Default fill/stroke color for floor protection overlays */
export const DEFAULT_FLOOR_PROTECTION_COLOR = '#FFD700';

// ============================================================================
// Containment Defaults
// ============================================================================

/** Default fill/stroke color for containment zone overlays */
export const DEFAULT_CONTAINMENT_COLOR = '#0066FF';

// ============================================================================
// Preset Label Lists
// ============================================================================

/**
 * Common floor label options presented in the "Add Floor" dropdown.
 * Users are free to type a custom label if none of these apply.
 */
export const FLOOR_LABEL_PRESETS: string[] = [
  'Basement',
  '1st Floor',
  '2nd Floor',
  '3rd Floor',
  'Attic',
];

/**
 * Common containment configuration options.
 * Shown in the containment-zone form as quick-select values.
 */
export const CONTAINMENT_TYPE_PRESETS: string[] = [
  'No zipper',
  'With zipper',
  'Full enclosure',
];

/**
 * Common floor protection material options.
 * Shown in the floor-protection-strip form as quick-select values.
 */
export const PROTECTION_TYPE_PRESETS: string[] = [
  'Heavy duty paper & tape',
  'Plastic sheeting',
  'Ram board',
];
