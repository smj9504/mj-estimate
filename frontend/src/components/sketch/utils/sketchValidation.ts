/**
 * Validation utilities for sketch data
 */

import {
  SketchDocument,
  Wall,
  SketchRoom,
  WallFixture,
  Point
} from '../../../types/sketch';

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  type: 'error';
  code: string;
  message: string;
  elementId?: string;
  elementType?: string;
}

export interface ValidationWarning {
  type: 'warning';
  code: string;
  message: string;
  elementId?: string;
  elementType?: string;
}

/**
 * Validate a complete sketch document
 */
export const validateSketch = (sketch: SketchDocument): ValidationResult => {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Validate basic sketch properties
  if (!sketch.name || sketch.name.trim().length === 0) {
    errors.push({
      type: 'error',
      code: 'SKETCH_NO_NAME',
      message: 'Sketch must have a name'
    });
  }

  // Validate walls
  sketch.walls.forEach(wall => {
    const wallValidation = validateWall(wall);
    errors.push(...wallValidation.errors);
    warnings.push(...wallValidation.warnings);
  });

  // Validate rooms
  sketch.rooms.forEach(room => {
    const roomValidation = validateRoom(room, sketch.walls);
    errors.push(...roomValidation.errors);
    warnings.push(...roomValidation.warnings);
  });

  // Validate wall fixtures
  sketch.wallFixtures.forEach(fixture => {
    const fixtureValidation = validateFixture(fixture, sketch.walls);
    errors.push(...fixtureValidation.errors);
    warnings.push(...fixtureValidation.warnings);
  });

  // Check for disconnected walls
  const disconnectedWalls = findDisconnectedWalls(sketch.walls);
  disconnectedWalls.forEach(wallId => {
    warnings.push({
      type: 'warning',
      code: 'WALL_DISCONNECTED',
      message: 'Wall is not connected to other walls',
      elementId: wallId,
      elementType: 'wall'
    });
  });

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};

/**
 * Validate a single wall
 */
export const validateWall = (wall: Wall): ValidationResult => {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Check for valid coordinates
  if (!isValidPoint(wall.start)) {
    errors.push({
      type: 'error',
      code: 'WALL_INVALID_START_POINT',
      message: 'Wall start point has invalid coordinates',
      elementId: wall.id,
      elementType: 'wall'
    });
  }

  if (!isValidPoint(wall.end)) {
    errors.push({
      type: 'error',
      code: 'WALL_INVALID_END_POINT',
      message: 'Wall end point has invalid coordinates',
      elementId: wall.id,
      elementType: 'wall'
    });
  }

  // Check for zero-length walls
  if (isValidPoint(wall.start) && isValidPoint(wall.end)) {
    const distance = calculateDistance(wall.start, wall.end);
    if (distance < 0.1) { // Less than 0.1 feet (about 1 inch)
      errors.push({
        type: 'error',
        code: 'WALL_ZERO_LENGTH',
        message: 'Wall length is too small (minimum 1 inch)',
        elementId: wall.id,
        elementType: 'wall'
      });
    }
  }

  // Check for reasonable wall thickness
  if (wall.thickness <= 0 || wall.thickness > 24) { // 0 to 24 inches
    warnings.push({
      type: 'warning',
      code: 'WALL_UNUSUAL_THICKNESS',
      message: `Wall thickness ${wall.thickness}" is unusual (typical: 4"-6")`,
      elementId: wall.id,
      elementType: 'wall'
    });
  }

  // Check for reasonable wall height
  if (wall.height.feet <= 0 || wall.height.feet > 20) { // 0 to 20 feet
    warnings.push({
      type: 'warning',
      code: 'WALL_UNUSUAL_HEIGHT',
      message: `Wall height ${wall.height.feet}' is unusual (typical: 8'-10')`,
      elementId: wall.id,
      elementType: 'wall'
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};

/**
 * Validate a single room
 */
export const validateRoom = (room: SketchRoom, walls: Wall[]): ValidationResult => {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Check room name
  if (!room.name || room.name.trim().length === 0) {
    errors.push({
      type: 'error',
      code: 'ROOM_NO_NAME',
      message: 'Room must have a name',
      elementId: room.id,
      elementType: 'room'
    });
  }

  // Check if room has walls
  if (room.wallIds.length === 0) {
    errors.push({
      type: 'error',
      code: 'ROOM_NO_WALLS',
      message: 'Room must have at least 3 walls',
      elementId: room.id,
      elementType: 'room'
    });
  } else if (room.wallIds.length < 3) {
    errors.push({
      type: 'error',
      code: 'ROOM_INSUFFICIENT_WALLS',
      message: 'Room must have at least 3 walls to form an enclosed area',
      elementId: room.id,
      elementType: 'room'
    });
  }

  // Check if all referenced walls exist
  room.wallIds.forEach((wallId: string) => {
    const wallExists = walls.find(wall => wall.id === wallId);
    if (!wallExists) {
      errors.push({
        type: 'error',
        code: 'ROOM_INVALID_WALL_REFERENCE',
        message: `Room references non-existent wall: ${wallId}`,
        elementId: room.id,
        elementType: 'room'
      });
    }
  });

  // Check ceiling height
  if (room.properties.ceilingHeight) {
    const ceilingFeet = room.properties.ceilingHeight.feet;
    if (ceilingFeet <= 0 || ceilingFeet > 20) {
      warnings.push({
        type: 'warning',
        code: 'ROOM_UNUSUAL_CEILING_HEIGHT',
        message: `Ceiling height ${ceilingFeet}' is unusual (typical: 8'-10')`,
        elementId: room.id,
        elementType: 'room'
      });
    }
  }

  // Check area calculation
  if (room.areas.floorArea <= 0) {
    warnings.push({
      type: 'warning',
      code: 'ROOM_ZERO_AREA',
      message: 'Room area is zero or negative',
      elementId: room.id,
      elementType: 'room'
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};

/**
 * Validate a single fixture
 */
export const validateFixture = (fixture: WallFixture, walls: Wall[]): ValidationResult => {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Check position (fixture.position is a number representing position along wall)
  if (typeof fixture.position !== 'number' || fixture.position < 0 || fixture.position > 1) {
    errors.push({
      type: 'error',
      code: 'FIXTURE_INVALID_POSITION',
      message: 'Fixture position must be between 0 and 1 along the wall',
      elementId: fixture.id,
      elementType: 'fixture'
    });
  }

  // Check dimensions
  if (fixture.dimensions.width <= 0 || fixture.dimensions.height <= 0) {
    errors.push({
      type: 'error',
      code: 'FIXTURE_INVALID_DIMENSIONS',
      message: 'Fixture dimensions must be positive',
      elementId: fixture.id,
      elementType: 'fixture'
    });
  }

  // Note: Fixtures are attached to walls directly, so wall reference is implicit

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};

/**
 * Check if a point has valid coordinates
 */
const isValidPoint = (point: Point): boolean => {
  return (
    typeof point.x === 'number' &&
    typeof point.y === 'number' &&
    !isNaN(point.x) &&
    !isNaN(point.y) &&
    isFinite(point.x) &&
    isFinite(point.y)
  );
};

/**
 * Calculate distance between two points
 */
const calculateDistance = (point1: Point, point2: Point): number => {
  const dx = point2.x - point1.x;
  const dy = point2.y - point1.y;
  return Math.sqrt(dx * dx + dy * dy);
};

/**
 * Find walls that are not connected to other walls
 */
const findDisconnectedWalls = (walls: Wall[]): string[] => {
  const disconnected: string[] = [];

  walls.forEach(wall => {
    const totalConnections = wall.connectedWalls.length;
    if (totalConnections === 0) {
      disconnected.push(wall.id);
    }
  });

  return disconnected;
};