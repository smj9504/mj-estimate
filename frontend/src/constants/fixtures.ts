/**
 * Fixture Constants and Definitions
 * Predefined fixture types, variants, and default configurations
 */

import {
  FixtureVariant,
  DoorType,
  WindowType,
  CabinetType,
  BathroomType,
  FixtureCategory,
  WallFixtureCategory,
  RoomFixtureCategory,
  Dimensions
} from '../types/sketch';

// Default dimensions in INCHES (converted to pixels with feetToPixels(inches/12))
export const DEFAULT_DOOR_DIMENSIONS: Dimensions = {
  width: 36, // 36 inches (3 feet)
  height: 84, // 84 inches (7 feet)
};

export const DEFAULT_WINDOW_DIMENSIONS: Dimensions = {
  width: 36, // 36 inches (3 feet)
  height: 48, // 48 inches (4 feet)
};

export const DEFAULT_CABINET_DIMENSIONS: Dimensions = {
  width: 36, // 36 inches (3 feet)
  height: 24, // 24 inches (2 feet)
};

export const DEFAULT_BATHROOM_VANITY_DIMENSIONS: Dimensions = {
  width: 48, // 48 inches (4 feet)
  height: 24, // 24 inches (2 feet)
};

export const DEFAULT_TOILET_DIMENSIONS: Dimensions = {
  width: 24, // 24 inches (2 feet)
  height: 30, // 30 inches (2.5 feet)
};

export const DEFAULT_BATHTUB_DIMENSIONS: Dimensions = {
  width: 60, // 60 inches (5 feet)
  height: 30, // 30 inches (2.5 feet)
};

export const DEFAULT_SHOWER_DIMENSIONS: Dimensions = {
  width: 36, // 36 inches (3 feet)
  height: 36, // 36 inches (3 feet)
};

// Door variants with specific dimensions (in INCHES)
export const DOOR_VARIANTS: FixtureVariant[] = [
  {
    id: 'single_door_standard',
    name: 'Single Door',
    category: 'door',
    type: 'single_door',
    defaultDimensions: { width: 36, height: 84 }, // 3' x 7'
    icon: '🚪'
  },
  {
    id: 'double_door_standard',
    name: 'Double Door',
    category: 'door',
    type: 'double_door',
    defaultDimensions: { width: 72, height: 84 }, // 6' x 7'
    icon: '🚪🚪'
  },
  {
    id: 'sliding_door_standard',
    name: 'Sliding Door',
    category: 'door',
    type: 'sliding_door',
    defaultDimensions: { width: 72, height: 84 }, // 6' x 7'
    icon: '🔄'
  },
  {
    id: 'french_door_standard',
    name: 'French Door',
    category: 'door',
    type: 'french_door',
    defaultDimensions: { width: 60, height: 84 }, // 5' x 7'
    icon: '🏛️'
  },
  {
    id: 'pocket_door_standard',
    name: 'Pocket Door',
    category: 'door',
    type: 'pocket_door',
    defaultDimensions: { width: 36, height: 84 }, // 3' x 7'
    icon: '↔️'
  },
  {
    id: 'bi_fold_door_standard',
    name: 'Bi-Fold Door',
    category: 'door',
    type: 'bi_fold_door',
    defaultDimensions: { width: 48, height: 84 }, // 4' x 7'
    icon: '🔄'
  }
];

// Window variants with specific dimensions (in INCHES)
export const WINDOW_VARIANTS: FixtureVariant[] = [
  {
    id: 'single_window_standard',
    name: 'Single Window',
    category: 'window',
    type: 'single_window',
    defaultDimensions: { width: 36, height: 48 }, // 3' x 4'
    icon: '🪟',
    svgPath: 'M2,2 L58,2 L58,58 L2,58 Z M2,2 L58,58 M58,2 L2,58'
  },
  {
    id: 'double_window_standard',
    name: 'Double Window',
    category: 'window',
    type: 'double_window',
    defaultDimensions: { width: 72, height: 48 }, // 6' x 4'
    icon: '🪟🪟',
    svgPath: 'M2,2 L58,2 L58,58 L2,58 Z M30,2 L30,58 M2,2 L58,58 M58,2 L2,58'
  },
  {
    id: 'triple_window_standard',
    name: 'Triple Window',
    category: 'window',
    type: 'triple_window',
    defaultDimensions: { width: 108, height: 48 }, // 9' x 4'
    icon: '🪟🪟🪟',
    svgPath: 'M2,2 L118,2 L118,58 L2,58 Z M42,2 L42,58 M82,2 L82,58 M2,2 L118,58 M118,2 L2,58'
  },
  {
    id: 'bay_window_standard',
    name: 'Bay Window',
    category: 'window',
    type: 'bay_window',
    defaultDimensions: { width: 96, height: 48 }, // 8' x 4'
    icon: '🏠',
    svgPath: 'M2,30 L20,2 L40,2 L60,2 L78,30 L78,58 L2,58 Z'
  },
  {
    id: 'casement_window_standard',
    name: 'Casement Window',
    category: 'window',
    type: 'casement_window',
    defaultDimensions: { width: 36, height: 60 }, // 3' x 5'
    icon: '📐',
    svgPath: 'M2,2 L58,2 L58,58 L2,58 Z M30,2 L30,58 M2,30 L58,30'
  },
  {
    id: 'sliding_window_standard',
    name: 'Sliding Window',
    category: 'window',
    type: 'sliding_window',
    defaultDimensions: { width: 48, height: 36 }, // 4' x 3'
    icon: '↔️',
    svgPath: 'M2,2 L78,2 L78,58 L2,58 Z M30,2 L30,58 M50,2 L50,58'
  }
];

// Simplified Cabinet variant - single generic rectangle type (in INCHES)
export const CABINET_VARIANTS: FixtureVariant[] = [
  {
    id: 'generic_cabinet',
    name: 'Cabinet',
    category: 'cabinet',
    type: 'cabinet',
    defaultDimensions: { width: 36, height: 24 }, // 3' x 2'
    icon: '🗄️',
    svgPath: '' // No specific path - will render as customizable rectangle
  }
];

// Bathroom fixture variants - SVG files are now in frontend/src/assets/fixtures/
// Note: defaultDimensions are in INCHES (will be converted to feet for rendering)
export const BATHROOM_VARIANTS: FixtureVariant[] = [
  {
    id: 'bathroom_vanity',
    name: 'Bathroom Vanity',
    category: 'bathroom',
    type: 'vanity',
    defaultDimensions: { width: 30, height: 21 }, // inches
    icon: '🚰'
  },
  {
    id: 'toilet',
    name: 'Toilet',
    category: 'bathroom',
    type: 'toilet',
    defaultDimensions: { width: 20, height: 28 }, // inches
    icon: '🚽'
  },
  {
    id: 'bathtub',
    name: 'Bathtub',
    category: 'bathroom',
    type: 'bathtub',
    defaultDimensions: { width: 30, height: 60 }, // inches
    icon: '🛁'
  },
  {
    id: 'walk_in_shower',
    name: 'Walk-in Shower',
    category: 'bathroom',
    type: 'shower',
    defaultDimensions: { width: 36, height: 60 }, // inches
    icon: '🚿'
  }
];

// Removed - appliances are no longer separate fixtures, use generic cabinet instead

// All fixtures combined
export const ALL_FIXTURE_VARIANTS: FixtureVariant[] = [
  ...DOOR_VARIANTS,
  ...WINDOW_VARIANTS,
  ...CABINET_VARIANTS,
  ...BATHROOM_VARIANTS
];

// Wall fixtures only (doors and windows)
export const WALL_FIXTURE_VARIANTS: FixtureVariant[] = [
  ...DOOR_VARIANTS,
  ...WINDOW_VARIANTS
];

// Room fixtures only (cabinets and bathroom fixtures)
export const ROOM_FIXTURE_VARIANTS: FixtureVariant[] = [
  ...CABINET_VARIANTS,
  ...BATHROOM_VARIANTS
];

// Helper functions
export const getFixtureVariantsByCategory = (category: FixtureCategory): FixtureVariant[] => {
  return ALL_FIXTURE_VARIANTS.filter(variant => variant.category === category);
};

export const getFixtureVariantById = (id: string): FixtureVariant | undefined => {
  return ALL_FIXTURE_VARIANTS.find(variant => variant.id === id);
};

export const getFixtureVariantByType = (type: DoorType | WindowType): FixtureVariant | undefined => {
  return ALL_FIXTURE_VARIANTS.find(variant => variant.type === type);
};

// Default fixture styles by category
export const DEFAULT_FIXTURE_STYLES = {
  door: {
    fillColor: '#8B4513', // Brown
    strokeColor: '#654321',
    strokeWidth: 2,
    opacity: 0.8
  },
  window: {
    fillColor: '#87CEEB', // Sky blue
    strokeColor: '#4682B4',
    strokeWidth: 2,
    opacity: 0.7
  },
  cabinet: {
    fillColor: '#DEB887', // Burlywood
    strokeColor: '#CD853F',
    strokeWidth: 2,
    opacity: 0.8
  },
  bathroom: {
    fillColor: '#E0F7FA', // Light cyan
    strokeColor: '#00838F',
    strokeWidth: 2,
    opacity: 0.8
  },
  electrical: {
    fillColor: '#FFD700', // Gold
    strokeColor: '#B8860B',
    strokeWidth: 1,
    opacity: 1
  },
  plumbing: {
    fillColor: '#4682B4', // Steel blue
    strokeColor: '#191970',
    strokeWidth: 1,
    opacity: 1
  }
};

// Fixture size constraints
export const FIXTURE_CONSTRAINTS = {
  minWidth: 1, // 1 foot minimum
  maxWidth: 20, // 20 feet maximum
  minHeight: 1, // 1 foot minimum
  maxHeight: 12, // 12 feet maximum
  snapIncrement: 0.25 // 3 inches
};