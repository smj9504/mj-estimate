/**
 * Default values and factory functions for sketch elements
 */

import {
  SketchDocument,
  SketchSettings,
  Wall,
  SketchRoom,
  WallFixture,
  RoomFixture,
  Point,
  SketchTool,
  InteractionMode,
  DoorType,
  WindowType,
  CabinetType,
  VanityType,
  ApplianceType
} from '../../../types/sketch';
import { generateId } from './idUtils';

/**
 * Create a new sketch document with default values
 */
export const createDefaultSketch = (name: string = 'Untitled Sketch'): SketchDocument => {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name,
    documentType: 'standalone',
    rooms: [],
    walls: [],
    wallFixtures: [],
    roomFixtures: [],
    metadata: {
      version: '1.0.0',
      project: {
        name: name,
        address: '',
        client: ''
      },
      scale: {
        pixelsPerFoot: 50,
        gridSize: 1
      },
      bounds: {
        minX: 0,
        minY: 0,
        maxX: 800,
        maxY: 600
      },
      totalAreas: {
        floorArea: 0,
        ceilingArea: 0,
        wallArea: 0,
        netWallArea: 0,
        volume: 0,
        perimeter: 0
      }
    },
    settings: createDefaultSketchSettings(),
    createdAt: now,
    updatedAt: now
  };
};

/**
 * Create default sketch settings
 */
export const createDefaultSketchSettings = (): SketchSettings => {
  return {
    display: {
      showGrid: true,
      showDimensions: true,
      showAreaLabels: true,
      showFixtures: true,
      snapToGrid: true,
      snapTolerance: 5
    },
    measurements: {
      unit: 'imperial',
      precision: 2,
      showInches: true
    },
    defaultStyles: {
      wall: {
        strokeColor: '#000000',
        strokeWidth: 2,
        fillColor: '#ffffff',
        opacity: 1
      },
      room: {
        fillColor: '#e6f3ff',
        strokeColor: '#1890ff',
        strokeWidth: 1,
        opacity: 0.3
      },
      fixtures: {
        door: {
          fillColor: '#8B4513',
          strokeColor: '#654321',
          strokeWidth: 1,
          opacity: 1
        },
        window: {
          fillColor: '#87CEEB',
          strokeColor: '#4682B4',
          strokeWidth: 1,
          opacity: 0.7
        },
        cabinet: {
          fillColor: '#DEB887',
          strokeColor: '#8B7355',
          strokeWidth: 1,
          opacity: 1
        },
        vanity: {
          fillColor: '#D2691E',
          strokeColor: '#8B4513',
          strokeWidth: 1,
          opacity: 1
        },
        appliance: {
          fillColor: '#C0C0C0',
          strokeColor: '#808080',
          strokeWidth: 1,
          opacity: 1
        },
        electrical: {
          fillColor: '#FFD700',
          strokeColor: '#B8860B',
          strokeWidth: 1,
          opacity: 1
        },
        plumbing: {
          fillColor: '#4682B4',
          strokeColor: '#191970',
          strokeWidth: 1,
          opacity: 1
        }
      }
    }
  };
};

/**
 * Create a default wall
 */
export const createDefaultWall = (start: Point, end: Point): Wall => {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    originalStart: start,
    originalEnd: end,
    start,
    end,
    thickness: 4, // inches
    height: {
      feet: 8,
      inches: 0,
      totalInches: 96,
      display: "8' 0\""
    },
    originalLength: {
      feet: 0,
      inches: 0,
      totalInches: 0,
      display: "0' 0\""
    },
    length: {
      feet: 0,
      inches: 0,
      totalInches: 0,
      display: "0' 0\""
    },
    segments: [],
    type: 'interior',
    fixtures: [],
    roomId: '',
    connectedWalls: [],
    style: {
      strokeColor: '#000000',
      strokeWidth: 2,
      fillColor: '#ffffff',
      opacity: 1
    },
    createdAt: now,
    updatedAt: now
  };
};

/**
 * Create a default room
 */
export const createDefaultRoom = (name: string = 'Room'): SketchRoom => {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name,
    type: 'other',
    wallIds: [],
    boundary: [],
    dimensions: {
      width: 0,
      height: 0
    },
    areas: {
      floorArea: 0,
      ceilingArea: 0,
      wallArea: 0,
      netWallArea: 0,
      volume: 0,
      perimeter: 0
    },
    properties: {
      floorMaterial: '',
      ceilingHeight: {
        feet: 8,
        inches: 0,
        totalInches: 96,
        display: "8' 0\""
      },
      notes: ''
    },
    style: {
      fillColor: '#e6f3ff',
      strokeColor: '#1890ff',
      strokeWidth: 1,
      opacity: 0.3
    },
    createdAt: now,
    updatedAt: now
  };
};

/**
 * Create a default wall fixture (doors and windows only)
 */
export const createDefaultWallFixture = (
  fixtureType: 'door' | 'window',
  specificType: DoorType | WindowType,
  positionOnWall: number = 0.5
): WallFixture => {
  const dimensions = getDefaultFixtureDimensions(fixtureType);

  return {
    id: generateId(),
    category: fixtureType,
    type: specificType,
    position: positionOnWall,
    dimensions,
    rotation: 0,
    wallId: '',
    properties: {
      material: 'default',
      label: fixtureType.charAt(0).toUpperCase() + fixtureType.slice(1)
    },
    style: {
      fillColor: '#8c8c8c',
      strokeColor: '#666666',
      strokeWidth: 1,
      opacity: 1
    },
    isOpening: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
};

/**
 * Create a default room fixture
 */
export const createDefaultRoomFixture = (
  fixtureType: 'cabinet' | 'vanity' | 'appliance' | 'electrical' | 'plumbing',
  specificType: CabinetType | VanityType | ApplianceType | string
): RoomFixture => {
  const dimensions = getDefaultFixtureDimensions(fixtureType);

  return {
    id: generateId(),
    category: fixtureType,
    type: specificType,
    position: { x: 0, y: 0 },
    dimensions,
    rotation: 0,
    roomId: '',
    properties: {
      material: 'default',
      label: fixtureType.charAt(0).toUpperCase() + fixtureType.slice(1)
    },
    style: {
      fillColor: '#8c8c8c',
      strokeColor: '#666666',
      strokeWidth: 1,
      opacity: 1
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
};

/**
 * Get default dimensions for fixture types
 */
export const getDefaultFixtureDimensions = (type: string): { width: number; height: number; depth?: number } => {
  switch (type.toLowerCase()) {
    case 'door':
      return { width: 36, height: 84 }; // 3' wide, 7' tall (in inches)
    case 'window':
      return { width: 48, height: 48 }; // 4' x 4' (in inches)
    case 'cabinet':
      return { width: 24, height: 36, depth: 18 }; // 2' x 3' x 1.5' (in inches)
    case 'vanity':
      return { width: 48, height: 36, depth: 24 }; // 4' x 3' x 2' (in inches)
    case 'appliance':
      return { width: 36, height: 72, depth: 30 }; // 3' x 6' x 2.5' (in inches)
    case 'electrical':
      return { width: 4, height: 4 }; // 4" x 4" (in inches)
    case 'plumbing':
      return { width: 6, height: 6 }; // 6" x 6" (in inches)
    default:
      return { width: 24, height: 24 }; // Default 2' x 2' (in inches)
  }
};

/**
 * Default fixture types available for placement
 */
export const DEFAULT_FIXTURE_TYPES = [
  // Kitchen
  { key: 'refrigerator', label: 'Refrigerator', category: 'kitchen' },
  { key: 'stove', label: 'Stove/Range', category: 'kitchen' },
  { key: 'dishwasher', label: 'Dishwasher', category: 'kitchen' },
  { key: 'cabinet', label: 'Cabinet', category: 'kitchen' },
  { key: 'sink', label: 'Kitchen Sink', category: 'kitchen' },

  // Bathroom
  { key: 'toilet', label: 'Toilet', category: 'bathroom' },
  { key: 'vanity', label: 'Vanity', category: 'bathroom' },
  { key: 'bathtub', label: 'Bathtub', category: 'bathroom' },
  { key: 'shower', label: 'Shower', category: 'bathroom' },

  // Openings
  { key: 'door', label: 'Door', category: 'openings' },
  { key: 'window', label: 'Window', category: 'openings' },
  { key: 'archway', label: 'Archway', category: 'openings' }
] as const;