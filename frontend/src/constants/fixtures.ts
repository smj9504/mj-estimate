/**
 * Fixture Constants and Definitions
 * Predefined fixture types, variants, and default configurations
 */

import {
  FixtureVariant,
  DoorType,
  WindowType,
  CabinetType,
  VanityType,
  ApplianceType,
  FixtureCategory,
  WallFixtureCategory,
  RoomFixtureCategory,
  Dimensions
} from '../types/sketch';

// Default dimensions in feet
export const DEFAULT_DOOR_DIMENSIONS: Dimensions = {
  width: 3, // 3 feet
  height: 7, // 7 feet
};

export const DEFAULT_WINDOW_DIMENSIONS: Dimensions = {
  width: 3, // 3 feet
  height: 4, // 4 feet
};

export const DEFAULT_CABINET_DIMENSIONS: Dimensions = {
  width: 3, // 3 feet
  height: 2, // 2 feet depth
};

export const DEFAULT_VANITY_DIMENSIONS: Dimensions = {
  width: 4, // 4 feet
  height: 2, // 2 feet depth
};

export const DEFAULT_APPLIANCE_DIMENSIONS: Dimensions = {
  width: 3, // 3 feet
  height: 3, // 3 feet depth
};

// Door variants with specific dimensions
export const DOOR_VARIANTS: FixtureVariant[] = [
  {
    id: 'single_door_standard',
    name: 'Single Door',
    category: 'door',
    type: 'single_door',
    defaultDimensions: { width: 3, height: 7 },
    icon: '🚪'
  },
  {
    id: 'double_door_standard',
    name: 'Double Door',
    category: 'door',
    type: 'double_door',
    defaultDimensions: { width: 6, height: 7 },
    icon: '🚪🚪'
  },
  {
    id: 'sliding_door_standard',
    name: 'Sliding Door',
    category: 'door',
    type: 'sliding_door',
    defaultDimensions: { width: 6, height: 7 },
    icon: '🔄'
  },
  {
    id: 'french_door_standard',
    name: 'French Door',
    category: 'door',
    type: 'french_door',
    defaultDimensions: { width: 5, height: 7 },
    icon: '🏛️'
  },
  {
    id: 'pocket_door_standard',
    name: 'Pocket Door',
    category: 'door',
    type: 'pocket_door',
    defaultDimensions: { width: 3, height: 7 },
    icon: '↔️'
  },
  {
    id: 'bi_fold_door_standard',
    name: 'Bi-Fold Door',
    category: 'door',
    type: 'bi_fold_door',
    defaultDimensions: { width: 4, height: 7 },
    icon: '🔄'
  }
];

// Window variants with specific dimensions
export const WINDOW_VARIANTS: FixtureVariant[] = [
  {
    id: 'single_window_standard',
    name: 'Single Window',
    category: 'window',
    type: 'single_window',
    defaultDimensions: { width: 3, height: 4 },
    icon: '🪟',
    svgPath: 'M2,2 L58,2 L58,58 L2,58 Z M2,2 L58,58 M58,2 L2,58'
  },
  {
    id: 'double_window_standard',
    name: 'Double Window',
    category: 'window',
    type: 'double_window',
    defaultDimensions: { width: 6, height: 4 },
    icon: '🪟🪟',
    svgPath: 'M2,2 L58,2 L58,58 L2,58 Z M30,2 L30,58 M2,2 L58,58 M58,2 L2,58'
  },
  {
    id: 'triple_window_standard',
    name: 'Triple Window',
    category: 'window',
    type: 'triple_window',
    defaultDimensions: { width: 9, height: 4 },
    icon: '🪟🪟🪟',
    svgPath: 'M2,2 L118,2 L118,58 L2,58 Z M42,2 L42,58 M82,2 L82,58 M2,2 L118,58 M118,2 L2,58'
  },
  {
    id: 'bay_window_standard',
    name: 'Bay Window',
    category: 'window',
    type: 'bay_window',
    defaultDimensions: { width: 8, height: 4 },
    icon: '🏠',
    svgPath: 'M2,30 L20,2 L40,2 L60,2 L78,30 L78,58 L2,58 Z'
  },
  {
    id: 'casement_window_standard',
    name: 'Casement Window',
    category: 'window',
    type: 'casement_window',
    defaultDimensions: { width: 3, height: 5 },
    icon: '📐',
    svgPath: 'M2,2 L58,2 L58,58 L2,58 Z M30,2 L30,58 M2,30 L58,30'
  },
  {
    id: 'sliding_window_standard',
    name: 'Sliding Window',
    category: 'window',
    type: 'sliding_window',
    defaultDimensions: { width: 4, height: 3 },
    icon: '↔️',
    svgPath: 'M2,2 L78,2 L78,58 L2,58 Z M30,2 L30,58 M50,2 L50,58'
  }
];

// Cabinet variants with specific dimensions and industry standard SVG paths
export const CABINET_VARIANTS: FixtureVariant[] = [
  {
    id: 'base_cabinet_standard',
    name: 'Base Cabinet',
    category: 'cabinet',
    type: 'base_cabinet',
    defaultDimensions: { width: 3, height: 2 },
    icon: '🗄️',
    svgPath: 'M5,5 L55,5 L55,55 L5,55 Z M15,15 L45,15 M15,25 L45,25 M15,35 L45,35 M15,45 L45,45'
  },
  {
    id: 'wall_cabinet_standard',
    name: 'Wall Cabinet',
    category: 'cabinet',
    type: 'wall_cabinet',
    defaultDimensions: { width: 3, height: 1.5 },
    icon: '📦',
    svgPath: 'M5,5 L55,5 L55,35 L5,35 Z M15,10 L45,10 M15,20 L45,20 M15,30 L45,30'
  },
  {
    id: 'tall_cabinet_standard',
    name: 'Tall Cabinet',
    category: 'cabinet',
    type: 'tall_cabinet',
    defaultDimensions: { width: 2, height: 2 },
    icon: '🏢',
    svgPath: 'M5,5 L35,5 L35,55 L5,55 Z M10,10 L30,10 M10,15 L30,15 M10,25 L30,25 M10,35 L30,35 M10,45 L30,45'
  },
  {
    id: 'island_standard',
    name: 'Kitchen Island',
    category: 'cabinet',
    type: 'island',
    defaultDimensions: { width: 6, height: 4 },
    icon: '🏝️',
    svgPath: 'M10,10 L110,10 L110,70 L10,70 Z M20,20 L100,20 M20,30 L100,30 M20,50 L100,50 M20,60 L100,60'
  },
  {
    id: 'peninsula_standard',
    name: 'Peninsula',
    category: 'cabinet',
    type: 'peninsula',
    defaultDimensions: { width: 4, height: 3 },
    icon: '🌊',
    svgPath: 'M10,10 L70,10 L70,25 L55,25 L55,55 L10,55 Z M15,15 L65,15 M15,50 L50,50'
  }
];

// Vanity variants with specific dimensions and industry standard SVG paths
export const VANITY_VARIANTS: FixtureVariant[] = [
  {
    id: 'single_vanity_standard',
    name: 'Single Vanity',
    category: 'vanity',
    type: 'single_vanity',
    defaultDimensions: { width: 3, height: 2 },
    icon: '🚿',
    svgPath: 'M5,5 L55,5 L55,45 L5,45 Z M15,15 L45,15 L45,35 L15,35 Z M30,10 Q35,10 35,15 Q35,20 30,20 Q25,20 25,15 Q25,10 30,10'
  },
  {
    id: 'double_vanity_standard',
    name: 'Double Vanity',
    category: 'vanity',
    type: 'double_vanity',
    defaultDimensions: { width: 6, height: 2 },
    icon: '🚿🚿',
    svgPath: 'M5,5 L115,5 L115,45 L5,45 Z M15,15 L45,15 L45,35 L15,35 Z M75,15 L105,15 L105,35 L75,35 Z M30,10 Q35,10 35,15 Q35,20 30,20 Q25,20 25,15 Q25,10 30,10 M90,10 Q95,10 95,15 Q95,20 90,20 Q85,20 85,15 Q85,10 90,10'
  },
  {
    id: 'floating_vanity_standard',
    name: 'Floating Vanity',
    category: 'vanity',
    type: 'floating_vanity',
    defaultDimensions: { width: 4, height: 1.5 },
    icon: '🪄',
    svgPath: 'M10,15 L70,15 L70,40 L10,40 Z M20,20 L60,20 L60,35 L20,35 Z M40,12 Q45,12 45,17 Q45,22 40,22 Q35,22 35,17 Q35,12 40,12'
  }
];

// Appliance variants with specific dimensions and industry standard SVG paths
export const APPLIANCE_VARIANTS: FixtureVariant[] = [
  {
    id: 'refrigerator_standard',
    name: 'Refrigerator',
    category: 'appliance',
    type: 'refrigerator',
    defaultDimensions: { width: 3, height: 3 },
    icon: '🧊',
    svgPath: 'M5,5 L55,5 L55,85 L5,85 Z M5,45 L55,45 M15,15 L45,15 M15,25 L45,25 M15,55 L45,55 M15,65 L45,65 M15,75 L45,75'
  },
  {
    id: 'stove_standard',
    name: 'Stove/Range',
    category: 'appliance',
    type: 'stove',
    defaultDimensions: { width: 3, height: 2.5 },
    icon: '🔥',
    svgPath: 'M5,5 L55,5 L55,55 L5,55 Z M15,15 Q20,15 20,20 Q20,25 15,25 Q10,25 10,20 Q10,15 15,15 M35,15 Q40,15 40,20 Q40,25 35,25 Q30,25 30,20 Q30,15 35,15 M15,35 Q20,35 20,40 Q20,45 15,45 Q10,45 10,40 Q10,35 15,35 M35,35 Q40,35 40,40 Q40,45 35,45 Q30,45 30,40 Q30,35 35,35'
  },
  {
    id: 'oven_standard',
    name: 'Wall Oven',
    category: 'appliance',
    type: 'oven',
    defaultDimensions: { width: 2.5, height: 2 },
    icon: '🔥',
    svgPath: 'M5,5 L45,5 L45,45 L5,45 Z M10,10 L40,10 L40,40 L10,40 Z M15,15 L35,15 M15,20 L35,20 M15,25 L35,25'
  },
  {
    id: 'dishwasher_standard',
    name: 'Dishwasher',
    category: 'appliance',
    type: 'dishwasher',
    defaultDimensions: { width: 2, height: 2 },
    icon: '🍽️',
    svgPath: 'M5,5 L35,5 L35,45 L5,45 Z M10,10 L30,10 M10,15 L30,15 M10,25 L30,25 M10,35 L30,35 M15,20 Q20,18 25,20'
  },
  {
    id: 'washer_standard',
    name: 'Washing Machine',
    category: 'appliance',
    type: 'washer',
    defaultDimensions: { width: 2.5, height: 2.5 },
    icon: '🌀',
    svgPath: 'M5,5 L45,5 L45,55 L5,55 Z M25,20 Q35,20 35,30 Q35,40 25,40 Q15,40 15,30 Q15,20 25,20 M25,25 Q30,25 30,30 Q30,35 25,35 Q20,35 20,30 Q20,25 25,25'
  },
  {
    id: 'dryer_standard',
    name: 'Dryer',
    category: 'appliance',
    type: 'dryer',
    defaultDimensions: { width: 2.5, height: 2.5 },
    icon: '💨',
    svgPath: 'M5,5 L45,5 L45,55 L5,55 Z M25,20 Q35,20 35,30 Q35,40 25,40 Q15,40 15,30 Q15,20 25,20 M20,25 L30,25 M20,30 L30,30 M20,35 L30,35'
  },
  {
    id: 'microwave_standard',
    name: 'Microwave',
    category: 'appliance',
    type: 'microwave',
    defaultDimensions: { width: 2, height: 1.5 },
    icon: '📡',
    svgPath: 'M5,5 L35,5 L35,25 L5,25 Z M10,10 L30,10 L30,20 L10,20 Z M12,12 L28,12 M12,15 L28,15 M12,18 L28,18'
  }
];

// All fixtures combined
export const ALL_FIXTURE_VARIANTS: FixtureVariant[] = [
  ...DOOR_VARIANTS,
  ...WINDOW_VARIANTS,
  ...CABINET_VARIANTS,
  ...VANITY_VARIANTS,
  ...APPLIANCE_VARIANTS
];

// Wall fixtures only (doors and windows)
export const WALL_FIXTURE_VARIANTS: FixtureVariant[] = [
  ...DOOR_VARIANTS,
  ...WINDOW_VARIANTS
];

// Room fixtures only (cabinets, vanities, appliances)
export const ROOM_FIXTURE_VARIANTS: FixtureVariant[] = [
  ...CABINET_VARIANTS,
  ...VANITY_VARIANTS,
  ...APPLIANCE_VARIANTS
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
    strokeWidth: 1,
    opacity: 0.8
  },
  vanity: {
    fillColor: '#E6E6FA', // Lavender
    strokeColor: '#9370DB',
    strokeWidth: 1,
    opacity: 0.8
  },
  appliance: {
    fillColor: '#C0C0C0', // Silver
    strokeColor: '#808080',
    strokeWidth: 1,
    opacity: 0.9
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