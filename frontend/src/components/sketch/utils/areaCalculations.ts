/**
 * Area Calculation Utilities
 * Calculate areas, volumes, and measurements for rooms and walls
 */

import {
  SketchDocument,
  SketchRoom,
  Wall,
  WallFixture,
  AreaCalculation,
  Measurement,
  Point
} from '../../../types/sketch';
import {
  polygonArea,
  calculatePolygonPerimeter,
  getBoundingBox,
  getWallGeometry
} from './geometryUtils';
import {
  pixelAreaToSquareFeet,
  pixelsToFeet,
  calculateCubicFeet,
  createMeasurement
} from './measurementUtils';

// =====================
// Room Area Calculations
// =====================

/**
 * Calculate comprehensive area measurements for a room
 */
export function calculateRoomAreas(
  room: SketchRoom,
  walls: Wall[],
  pixelsPerFoot: number,
  sketch: SketchDocument
): AreaCalculation {
  const roomWalls = walls.filter(wall => room.wallIds.includes(wall.id));
  const boundary = room.boundary;

  // Check if room has enough walls to form a closed area
  // A room needs at least 3 walls to form a closed polygon
  const hasValidArea = roomWalls.length >= 3 && boundary.length >= 3;

  // Basic measurements
  const pixelArea = hasValidArea ? polygonArea(boundary) : 0;
  const pixelPerimeter = calculatePolygonPerimeter(boundary);

  const floorArea = hasValidArea ? pixelAreaToSquareFeet(pixelArea, pixelsPerFoot) : 0;
  const ceilingArea = floorArea; // Usually same as floor
  const perimeter = pixelsToFeet(pixelPerimeter, pixelsPerFoot);

  // Calculate wall areas
  const wallAreaData = calculateWallAreas(roomWalls, pixelsPerFoot, sketch);
  const wallArea = wallAreaData.totalArea;
  const netWallArea = wallAreaData.netArea;

  // Calculate volume (only if room has valid area)
  const roomHeight = room.dimensions.depth ?
    createMeasurement(room.dimensions.depth * 12) :
    createMeasurement(96); // Default 8 feet

  const volume = hasValidArea ? calculateCubicFeet(floorArea, roomHeight) : 0;

  return {
    floorArea,
    ceilingArea,
    wallArea,
    netWallArea,
    volume,
    perimeter
  };
}

/**
 * Calculate wall areas for a set of walls
 */
export function calculateWallAreas(walls: Wall[], pixelsPerFoot: number, sketch: SketchDocument): {
  totalArea: number;
  netArea: number;
  wallDetails: Array<{
    wallId: string;
    area: number;
    netArea: number;
    length: number;
    height: number;
    openingArea: number;
  }>;
} {
  let totalArea = 0;
  let netArea = 0;
  const wallDetails: Array<{
    wallId: string;
    area: number;
    netArea: number;
    length: number;
    height: number;
    openingArea: number;
  }> = [];

  for (const wall of walls) {
    const length = pixelsToFeet(
      Math.sqrt(
        Math.pow(wall.end.x - wall.start.x, 2) +
        Math.pow(wall.end.y - wall.start.y, 2)
      ),
      pixelsPerFoot
    );

    const height = wall.height.totalInches / 12; // Convert to feet
    const wallArea = length * height;

    // Calculate opening areas - resolve fixture IDs to actual fixtures
    const wallFixtures = wall.fixtures.map(fixtureId =>
      sketch.wallFixtures.find(f => f.id === fixtureId)
    ).filter(f => f !== undefined) as WallFixture[];
    const openingArea = calculateOpeningAreas(wallFixtures);

    const wallNetArea = Math.max(0, wallArea - openingArea);

    totalArea += wallArea;
    netArea += wallNetArea;

    wallDetails.push({
      wallId: wall.id,
      area: wallArea,
      netArea: wallNetArea,
      length,
      height,
      openingArea
    });
  }

  return {
    totalArea,
    netArea,
    wallDetails
  };
}

/**
 * Calculate total area of openings (doors, windows) in fixtures
 */
export function calculateOpeningAreas(fixtures: WallFixture[]): number {
  return fixtures.reduce((total, fixture) => {
    if (!fixture.isOpening) return total;

    const dimensions = fixture.openingDimensions || fixture.dimensions;
    const width = dimensions.width / 12; // Convert inches to feet
    const height = dimensions.height / 12; // Convert inches to feet

    return total + (width * height);
  }, 0);
}

// =====================
// Sketch-wide Calculations
// =====================

/**
 * Calculate total areas for entire sketch
 */
export function calculateSketchAreas(sketch: SketchDocument): void {
  const { rooms, walls, metadata } = sketch;
  const pixelsPerFoot = metadata.scale.pixelsPerFoot;

  let totalFloorArea = 0;
  let totalCeilingArea = 0;
  let totalWallArea = 0;
  let totalNetWallArea = 0;
  let totalVolume = 0;
  let totalPerimeter = 0;

  // Update each room's areas
  rooms.forEach(room => {
    const roomWalls = walls.filter(wall => room.wallIds.includes(wall.id));
    const areas = calculateRoomAreas(room, roomWalls, pixelsPerFoot, sketch);

    // Update room object
    room.areas = areas;

    // Add to totals
    totalFloorArea += areas.floorArea;
    totalCeilingArea += areas.ceilingArea;
    totalWallArea += areas.wallArea;
    totalNetWallArea += areas.netWallArea;
    totalVolume += areas.volume;
    totalPerimeter += areas.perimeter;

    // Update room dimensions
    const boundary = room.boundary;
    if (boundary.length > 0) {
      const bbox = getBoundingBox(boundary);
      room.dimensions = {
        width: pixelsToFeet(bbox.maxX - bbox.minX, pixelsPerFoot),
        height: pixelsToFeet(bbox.maxY - bbox.minY, pixelsPerFoot),
        depth: room.dimensions.depth || 8 // Keep existing or default to 8 feet
      };
    }
  });

  // Update sketch metadata
  sketch.metadata.totalAreas = {
    floorArea: totalFloorArea,
    ceilingArea: totalCeilingArea,
    wallArea: totalWallArea,
    netWallArea: totalNetWallArea,
    volume: totalVolume,
    perimeter: totalPerimeter
  };

  // Update sketch bounds
  const allPoints: Point[] = [];
  walls.forEach(wall => {
    allPoints.push(wall.start, wall.end);
  });

  if (allPoints.length > 0) {
    const bbox = getBoundingBox(allPoints);
    sketch.metadata.bounds = bbox;
  }

  // Update timestamp
  sketch.updatedAt = new Date().toISOString();
}

// =====================
// Material Calculations
// =====================

/**
 * Calculate material quantities based on room areas
 */
export interface MaterialCalculation {
  // Flooring
  flooringSquareFeet: number;
  flooringWaste: number;
  flooringTotal: number;

  // Paint/Wall covering
  paintableArea: number;
  paintGallons: number;
  primerGallons: number;

  // Trim/Molding
  baseboardLinearFeet: number;
  crownMoldingLinearFeet: number;
  caseLinearFeet: number;

  // Ceiling
  ceilingSquareFeet: number;
  ceilingTiles?: number;
}

/**
 * Calculate material requirements for a room
 */
export function calculateMaterials(
  room: SketchRoom,
  walls: Wall[],
  sketch: SketchDocument,
  options: {
    flooringWastePercent?: number;
    paintCoverage?: number; // sq ft per gallon
    ceilingTileSize?: number; // inches
    includeTrim?: boolean;
  } = {}
): MaterialCalculation {
  const {
    flooringWastePercent = 10,
    paintCoverage = 350,
    ceilingTileSize = 24,
    includeTrim = true
  } = options;

  const areas = room.areas;
  const roomWalls = walls.filter(wall => room.wallIds.includes(wall.id));

  // Flooring calculations
  const flooringSquareFeet = areas.floorArea;
  const flooringWaste = flooringSquareFeet * (flooringWastePercent / 100);
  const flooringTotal = flooringSquareFeet + flooringWaste;

  // Paint calculations
  const paintableArea = areas.netWallArea;
  const paintGallons = Math.ceil(paintableArea / paintCoverage);
  const primerGallons = Math.ceil(paintGallons * 0.8); // Usually need less primer

  // Trim calculations
  let baseboardLinearFeet = 0;
  let crownMoldingLinearFeet = 0;
  let caseLinearFeet = 0;

  if (includeTrim) {
    baseboardLinearFeet = areas.perimeter;
    crownMoldingLinearFeet = areas.perimeter;

    // Calculate casing for openings
    roomWalls.forEach(wall => {
      wall.fixtures.forEach(fixtureId => {
        const fixture = sketch.wallFixtures.find(f => f.id === fixtureId);
        if (fixture && fixture.isOpening) {
          const width = fixture.dimensions.width / 12;
          const height = fixture.dimensions.height / 12;
          // Approximate casing: 2 sides + top
          caseLinearFeet += (height * 2) + width;
        }
      });
    });
  }

  // Ceiling calculations
  const ceilingSquareFeet = areas.ceilingArea;
  const ceilingTileAreaInches = ceilingTileSize * ceilingTileSize;
  const ceilingTileAreaFeet = ceilingTileAreaInches / 144;
  const ceilingTiles = Math.ceil(ceilingSquareFeet / ceilingTileAreaFeet);

  return {
    flooringSquareFeet,
    flooringWaste,
    flooringTotal,
    paintableArea,
    paintGallons,
    primerGallons,
    baseboardLinearFeet,
    crownMoldingLinearFeet,
    caseLinearFeet,
    ceilingSquareFeet,
    ceilingTiles
  };
}

// =====================
// Cost Estimation Helpers
// =====================

/**
 * Calculate estimated costs based on areas and unit prices
 */
export interface CostEstimation {
  flooring: {
    area: number;
    unitPrice: number;
    total: number;
  };
  paint: {
    area: number;
    unitPrice: number;
    total: number;
  };
  trim: {
    linearFeet: number;
    unitPrice: number;
    total: number;
  };
  labor: {
    hours: number;
    hourlyRate: number;
    total: number;
  };
  grandTotal: number;
}

/**
 * Calculate cost estimation for a room
 */
export function calculateCostEstimation(
  materials: MaterialCalculation,
  unitPrices: {
    flooringPerSqFt?: number;
    paintPerSqFt?: number;
    trimPerLinearFt?: number;
    laborPerSqFt?: number;
  } = {}
): CostEstimation {
  const {
    flooringPerSqFt = 5.0,
    paintPerSqFt = 2.0,
    trimPerLinearFt = 3.0,
    laborPerSqFt = 8.0
  } = unitPrices;

  const flooring = {
    area: materials.flooringTotal,
    unitPrice: flooringPerSqFt,
    total: materials.flooringTotal * flooringPerSqFt
  };

  const paint = {
    area: materials.paintableArea,
    unitPrice: paintPerSqFt,
    total: materials.paintableArea * paintPerSqFt
  };

  const totalTrimFeet = materials.baseboardLinearFeet +
                       materials.crownMoldingLinearFeet +
                       materials.caseLinearFeet;

  const trim = {
    linearFeet: totalTrimFeet,
    unitPrice: trimPerLinearFt,
    total: totalTrimFeet * trimPerLinearFt
  };

  // Estimate labor hours (rule of thumb: 1 hour per 10 sq ft floor area)
  const estimatedHours = Math.ceil(materials.flooringSquareFeet / 10);
  const hourlyRate = laborPerSqFt * 10; // Convert per sq ft to hourly

  const labor = {
    hours: estimatedHours,
    hourlyRate: hourlyRate,
    total: estimatedHours * hourlyRate
  };

  const grandTotal = flooring.total + paint.total + trim.total + labor.total;

  return {
    flooring,
    paint,
    trim,
    labor,
    grandTotal
  };
}

// =====================
// Export Summary
// =====================

/**
 * Generate comprehensive area summary for export
 */
export interface AreaSummary {
  sketch: {
    name: string;
    totalFloorArea: number;
    totalRooms: number;
    totalWalls: number;
  };
  rooms: Array<{
    name: string;
    type: string;
    floorArea: number;
    wallArea: number;
    volume: number;
    perimeter: number;
    materials?: MaterialCalculation;
    costs?: CostEstimation;
  }>;
  totals: {
    floorArea: number;
    wallArea: number;
    volume: number;
    perimeter: number;
    estimatedCost?: number;
  };
}

/**
 * Generate area summary for reporting
 */
export function generateAreaSummary(
  sketch: SketchDocument,
  includeEstimates: boolean = false,
  unitPrices?: Parameters<typeof calculateCostEstimation>[1]
): AreaSummary {
  const rooms = sketch.rooms.map(room => {
    const roomWalls = sketch.walls.filter(wall => room.wallIds.includes(wall.id));

    let materials: MaterialCalculation | undefined;
    let costs: CostEstimation | undefined;

    if (includeEstimates) {
      materials = calculateMaterials(room, roomWalls, sketch);
      if (unitPrices) {
        costs = calculateCostEstimation(materials, unitPrices);
      }
    }

    return {
      name: room.name,
      type: room.type,
      floorArea: room.areas.floorArea,
      wallArea: room.areas.wallArea,
      volume: room.areas.volume,
      perimeter: room.areas.perimeter,
      materials,
      costs
    };
  });

  const totalEstimatedCost = includeEstimates && unitPrices ?
    rooms.reduce((sum, room) => sum + (room.costs?.grandTotal || 0), 0) :
    undefined;

  return {
    sketch: {
      name: sketch.name,
      totalFloorArea: sketch.metadata.totalAreas.floorArea,
      totalRooms: sketch.rooms.length,
      totalWalls: sketch.walls.length
    },
    rooms,
    totals: {
      floorArea: sketch.metadata.totalAreas.floorArea,
      wallArea: sketch.metadata.totalAreas.wallArea,
      volume: sketch.metadata.totalAreas.volume,
      perimeter: sketch.metadata.totalAreas.perimeter,
      estimatedCost: totalEstimatedCost
    }
  };
}