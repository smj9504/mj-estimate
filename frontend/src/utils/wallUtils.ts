/**
 * Wall Utilities for Fixture Integration
 * Functions for wall splitting, segment calculation, and fixture positioning
 */

import {
  Wall,
  WallFixture,
  WallSegment,
  Point,
  Measurement,
  Dimensions
} from '../types/sketch';

// Helper function to calculate distance between two points
export const calculateDistance = (point1: Point, point2: Point): number => {
  const dx = point2.x - point1.x;
  const dy = point2.y - point1.y;
  return Math.sqrt(dx * dx + dy * dy);
};

// Helper function to calculate angle of a wall
export const calculateWallAngle = (start: Point, end: Point): number => {
  return Math.atan2(end.y - start.y, end.x - start.x);
};

// Helper function to convert pixels to feet (50 pixels = 1 foot)
export const pixelsToFeet = (pixels: number): number => {
  return pixels / 50;
};

// Helper function to convert feet to pixels (50 pixels = 1 foot)
export const feetToPixels = (feet: number): number => {
  return feet * 50;
};

// Helper function to create Measurement object
export const createMeasurement = (feet: number): Measurement => {
  const totalInches = feet * 12;
  let wholeFeet = Math.floor(feet);
  let remainingInches = Math.round((feet - wholeFeet) * 12);

  // Handle case where rounding causes inches to be 12
  if (remainingInches >= 12) {
    wholeFeet += 1;
    remainingInches = 0;
  }

  return {
    feet: wholeFeet,
    inches: remainingInches,
    totalInches,
    display: remainingInches > 0 ? `${wholeFeet}' ${remainingInches}"` : `${wholeFeet}'`
  };
};

// Calculate point along wall at given distance from start
export const getPointAlongWall = (wall: Wall, distanceFromStart: number): Point => {
  const totalDistance = calculateDistance(wall.start, wall.end);
  if (totalDistance === 0) return wall.start;

  const ratio = distanceFromStart / totalDistance;
  return {
    x: wall.start.x + (wall.end.x - wall.start.x) * ratio,
    y: wall.start.y + (wall.end.y - wall.start.y) * ratio
  };
};

// Calculate wall segments when fixtures are present
export const calculateWallSegments = (wall: Wall, fixtures: WallFixture[]): WallSegment[] => {
  const segments: WallSegment[] = [];
  const wallLength = calculateDistance(wall.start, wall.end);

  // Get fixtures on this wall, sorted by position
  // Since wall splitting has been removed, we only accept exact wallId matches
  // (No segment logic - fixtures should reference the original wall ID only)
  const wallFixtures = fixtures
    .filter(fixture => fixture.wallId === wall.id)
    .sort((a, b) => a.position - b.position);

  if (wallFixtures.length === 0) {
    // No fixtures, wall is one segment
    segments.push({
      id: `${wall.id}_segment_0`,
      start: wall.start,
      end: wall.end,
      length: createMeasurement(pixelsToFeet(wallLength)),
      type: 'wall'
    });
    return segments;
  }

  let currentPosition = 0;

  wallFixtures.forEach((fixture, index) => {
    // fixture.dimensions.width is now in feet, convert to pixels
    const fixtureWidthPixels = feetToPixels(fixture.dimensions.width);

    // Add wall segment before fixture (if there's space)
    if (fixture.position > currentPosition) {
      const segmentStart = getPointAlongWall(wall, currentPosition);
      const segmentEnd = getPointAlongWall(wall, fixture.position);
      const segmentLength = fixture.position - currentPosition;

      segments.push({
        id: `${wall.id}_segment_${segments.length}`,
        start: segmentStart,
        end: segmentEnd,
        length: createMeasurement(pixelsToFeet(segmentLength)),
        type: 'wall'
      });
    }

    // Add fixture gap segment
    const fixtureStart = getPointAlongWall(wall, fixture.position);
    const fixtureEnd = getPointAlongWall(wall, fixture.position + fixtureWidthPixels);

    segments.push({
      id: `${wall.id}_fixture_${fixture.id}`,
      start: fixtureStart,
      end: fixtureEnd,
      length: createMeasurement(fixture.dimensions.width),
      type: 'fixture_gap',
      fixtureId: fixture.id
    });

    currentPosition = fixture.position + fixtureWidthPixels;
  });

  // Add final wall segment after last fixture (if there's space)
  if (currentPosition < wallLength) {
    const segmentStart = getPointAlongWall(wall, currentPosition);
    const segmentEnd = wall.end;
    const segmentLength = wallLength - currentPosition;

    segments.push({
      id: `${wall.id}_segment_${segments.length}`,
      start: segmentStart,
      end: segmentEnd,
      length: createMeasurement(pixelsToFeet(segmentLength)),
      type: 'wall'
    });
  }

  return segments;
};

// Check if a fixture can be placed at a specific position on a wall
export const canPlaceFixtureAt = (
  wall: Wall,
  fixtures: WallFixture[],
  fixtureWidth: number,
  position: number,
  isDragging: boolean = false
): { canPlace: boolean; reason?: string; clampedPosition?: number } => {
  const wallLength = calculateDistance(wall.start, wall.end);
  const fixtureWidthPixels = feetToPixels(fixtureWidth);

  // During drag, allow positions slightly outside bounds for smooth movement
  // On drag end, clamp to valid range
  let clampedPosition = position;

  if (isDragging) {
    // Allow some tolerance during drag to prevent bouncing
    const tolerance = 5; // pixels
    if (position + fixtureWidthPixels > wallLength + tolerance) {
      clampedPosition = wallLength - fixtureWidthPixels;
    } else if (position < -tolerance) {
      clampedPosition = 0;
    }
  } else {
    // Strict bounds checking when not dragging
    if (position + fixtureWidthPixels > wallLength) {
      return { canPlace: false, reason: 'Fixture extends beyond wall end', clampedPosition: wallLength - fixtureWidthPixels };
    }
    if (position < 0) {
      return { canPlace: false, reason: 'Fixture extends beyond wall start', clampedPosition: 0 };
    }
  }

  // Check for overlaps with existing fixtures
  const wallFixtures = fixtures.filter(fixture => fixture.wallId === wall.id);

  for (const existingFixture of wallFixtures) {
    const existingStart = existingFixture.position;
    const existingEnd = existingFixture.position + feetToPixels(existingFixture.dimensions.width);
    const newStart = clampedPosition;
    const newEnd = clampedPosition + fixtureWidthPixels;

    // Check for overlap (with small tolerance during drag)
    const overlapTolerance = isDragging ? 2 : 0;
    if (!(newEnd <= existingStart + overlapTolerance || newStart >= existingEnd - overlapTolerance)) {
      return { canPlace: false, reason: 'Overlaps with existing fixture', clampedPosition };
    }
  }

  return { canPlace: true, clampedPosition };
};

// Find the best position for a fixture on a wall
export const findBestPositionForFixture = (
  wall: Wall,
  fixtures: WallFixture[],
  fixtureWidth: number,
  preferredPosition?: number
): number => {
  const wallLength = calculateDistance(wall.start, wall.end);
  const fixtureWidthPixels = feetToPixels(fixtureWidth);

  // If preferred position is given and valid, use it
  if (preferredPosition !== undefined) {
    const check = canPlaceFixtureAt(wall, fixtures, fixtureWidth, preferredPosition);
    if (check.canPlace) {
      return preferredPosition;
    }
  }

  // Try center of wall
  const centerPosition = (wallLength - fixtureWidthPixels) / 2;
  if (centerPosition >= 0) {
    const check = canPlaceFixtureAt(wall, fixtures, fixtureWidth, centerPosition);
    if (check.canPlace) {
      return centerPosition;
    }
  }

  // Try start of wall
  const startCheck = canPlaceFixtureAt(wall, fixtures, fixtureWidth, 0);
  if (startCheck.canPlace) {
    return 0;
  }

  // Try end of wall (if fixture is too big, place at end)
  const endPosition = Math.max(0, wallLength - fixtureWidthPixels);
  return endPosition;
};

// Adjust wall lengths when fixture size changes
export const adjustWallForFixtureSizeChange = (
  wall: Wall,
  fixture: WallFixture,
  newDimensions: Dimensions,
  fixtures: WallFixture[]
): { updatedWall: Wall; updatedFixture: WallFixture } => {
  // Both fixture.dimensions and newDimensions are in feet, convert to pixels
  const oldWidthPixels = feetToPixels(fixture.dimensions.width);
  const newWidthPixels = feetToPixels(newDimensions.width);
  const sizeDifference = newWidthPixels - oldWidthPixels;

  // Update fixture dimensions
  const updatedFixture: WallFixture = {
    ...fixture,
    dimensions: newDimensions,
    updatedAt: new Date().toISOString()
  };

  // Calculate new wall length (original length + size difference)
  const originalWallLength = calculateDistance(wall.originalStart, wall.originalEnd);
  const currentWallLength = calculateDistance(wall.start, wall.end);
  const newWallLength = currentWallLength + sizeDifference;

  // Update wall end point to reflect new length
  const wallAngle = calculateWallAngle(wall.start, wall.end);
  const newEndPoint: Point = {
    x: wall.start.x + Math.cos(wallAngle) * newWallLength,
    y: wall.start.y + Math.sin(wallAngle) * newWallLength
  };

  const updatedWall: Wall = {
    ...wall,
    end: newEndPoint,
    length: createMeasurement(pixelsToFeet(newWallLength)),
    segments: calculateWallSegments({ ...wall, end: newEndPoint }, [
      updatedFixture,
      ...fixtures.filter(f => f.wallId === wall.id && f.id !== fixture.id)
    ]),
    updatedAt: new Date().toISOString()
  };

  return { updatedWall, updatedFixture };
};

// Move fixture along wall and adjust wall segments
export const moveFixtureAlongWall = (
  wall: Wall,
  fixture: WallFixture,
  newPosition: number,
  fixtures: WallFixture[],
  isDragging: boolean = false
): { updatedWall: Wall; updatedFixture: WallFixture; canMove: boolean; reason?: string } => {
  // Check if new position is valid
  const canPlace = canPlaceFixtureAt(
    wall,
    fixtures.filter(f => f.id !== fixture.id),
    fixture.dimensions.width / 12,
    newPosition,
    isDragging
  );

  if (!canPlace.canPlace) {
    // During drag, use clamped position if available
    if (isDragging && canPlace.clampedPosition !== undefined) {
      newPosition = canPlace.clampedPosition;
    } else {
      return {
        updatedWall: wall,
        updatedFixture: fixture,
        canMove: false,
        reason: canPlace.reason
      };
    }
  } else if (canPlace.clampedPosition !== undefined) {
    // Use clamped position if provided
    newPosition = canPlace.clampedPosition;
  }

  // Update fixture position
  const updatedFixture: WallFixture = {
    ...fixture,
    position: newPosition,
    updatedAt: new Date().toISOString()
  };

  // Recalculate wall segments
  const updatedWall: Wall = {
    ...wall,
    segments: calculateWallSegments(wall, [
      updatedFixture,
      ...fixtures.filter(f => f.wallId === wall.id && f.id !== fixture.id)
    ]),
    updatedAt: new Date().toISOString()
  };

  return { updatedWall, updatedFixture, canMove: true };
};

// Calculate fixture rotation to align with wall
export const calculateFixtureRotation = (wall: Wall, currentRelativeRotation: number = 0): number => {
  // Calculate the new wall angle
  const wallAngle = calculateWallAngle(wall.start, wall.end);
  const wallAngleDegrees = (wallAngle * 180) / Math.PI;

  // Preserve the relative rotation (0° = parallel to wall, 90° = perpendicular)
  // The currentRelativeRotation parameter allows preserving the fixture's orientation
  return currentRelativeRotation;
};

// Calculate automatic rotation for wall fixtures (doors/windows)
export const calculateAutoRotationForWallFixture = (wall: Wall): number => {
  // For wall fixtures (doors/windows), they should automatically align with the wall
  // Return the actual wall angle in degrees
  // The renderer will use this value directly as the absolute rotation
  const wallAngle = calculateWallAngle(wall.start, wall.end);
  const wallAngleDegrees = (wallAngle * 180) / Math.PI;

  // Normalize to 0-360 range
  let normalizedAngle = wallAngleDegrees % 360;
  if (normalizedAngle < 0) normalizedAngle += 360;

  // Removed debug logging for production
  return normalizedAngle;
};

// Split wall at fixture positions
// NOTE: Wall splitting has been removed from the system, but this function is kept for legacy compatibility
export const splitWallAtFixtures = (wall: Wall, fixtures: WallFixture[]): Wall[] => {
  // Get fixtures on this wall, sorted by position
  // Since wall splitting has been removed, only exact wallId matches are accepted
  const wallFixtures = fixtures
    .filter(fixture => fixture.wallId === wall.id)
    .sort((a, b) => a.position - b.position);

  if (wallFixtures.length === 0) {
    return [wall]; // No fixtures, return original wall
  }

  const splitWalls: Wall[] = [];
  const wallLength = calculateDistance(wall.start, wall.end);
  let currentPosition = 0;

  // Get the base wall ID (remove any existing segment suffix)
  const baseWallId = wall.id.includes('_segment_')
    ? wall.id.split('_segment_')[0]
    : wall.id;

  wallFixtures.forEach((fixture, index) => {
    const fixtureWidthPixels = feetToPixels(fixture.dimensions.width);

    // Create wall segment before fixture (if there's space)
    if (fixture.position > currentPosition) {
      const segmentStart = getPointAlongWall(wall, currentPosition);
      const segmentEnd = getPointAlongWall(wall, fixture.position);
      const segmentLength = fixture.position - currentPosition;

      const wallSegment: Wall = {
        ...wall,
        id: `${baseWallId}_segment_${splitWalls.length}`,
        start: segmentStart,
        end: segmentEnd,
        originalStart: segmentStart,
        originalEnd: segmentEnd,
        length: createMeasurement(pixelsToFeet(segmentLength)),
        originalLength: createMeasurement(pixelsToFeet(segmentLength)),
        segments: [], // Will be recalculated
        fixtures: [], // No fixtures on this segment
        updatedAt: new Date().toISOString()
      };

      splitWalls.push(wallSegment);
    }

    currentPosition = fixture.position + fixtureWidthPixels;
  });

  // Add final wall segment after last fixture (if there's space)
  if (currentPosition < wallLength) {
    const segmentStart = getPointAlongWall(wall, currentPosition);
    const segmentEnd = wall.end;
    const segmentLength = wallLength - currentPosition;

    const wallSegment: Wall = {
      ...wall,
      id: `${baseWallId}_segment_${splitWalls.length}`,
      start: segmentStart,
      end: segmentEnd,
      originalStart: segmentStart,
      originalEnd: segmentEnd,
      length: createMeasurement(pixelsToFeet(segmentLength)),
      originalLength: createMeasurement(pixelsToFeet(segmentLength)),
      segments: [], // Will be recalculated
      fixtures: [], // No fixtures on this segment
      updatedAt: new Date().toISOString()
    };

    splitWalls.push(wallSegment);
  }

  return splitWalls;
};

// Merge wall segments back into a single wall when fixtures are removed
export const mergeWallSegments = (wallSegments: Wall[], originalWall: Wall): Wall => {
  if (wallSegments.length <= 1) {
    return wallSegments[0] || originalWall;
  }

  // Sort segments by start position along original wall
  const sortedSegments = [...wallSegments].sort((a, b) => {
    const aDistance = calculateDistance(originalWall.start, a.start);
    const bDistance = calculateDistance(originalWall.start, b.start);
    return aDistance - bDistance;
  });

  // Calculate total length of merged wall
  let totalLength = 0;
  sortedSegments.forEach(segment => {
    totalLength += pixelsToFeet(calculateDistance(segment.start, segment.end));
  });

  // Create merged wall
  const mergedWall: Wall = {
    ...originalWall,
    start: sortedSegments[0].start,
    end: sortedSegments[sortedSegments.length - 1].end,
    length: createMeasurement(totalLength),
    segments: [], // Will be recalculated based on remaining fixtures
    fixtures: [], // Will be recalculated
    updatedAt: new Date().toISOString()
  };

  return mergedWall;
};

// Check if fixture placement requires wall splitting
export const shouldSplitWall = (wall: Wall, fixture: WallFixture): boolean => {
  // Wall should be split if fixture creates an opening (doors, windows)
  return fixture.isOpening && (fixture.category === 'door' || fixture.category === 'window');
};

// Check if fixture removal requires wall merging
export const shouldMergeWall = (wall: Wall, removedFixture: WallFixture, remainingFixtures: WallFixture[]): boolean => {
  // Wall should be merged if there are no more opening fixtures on it
  const openingFixtures = remainingFixtures.filter(f =>
    f.wallId === wall.id && f.isOpening && (f.category === 'door' || f.category === 'window')
  );
  return openingFixtures.length === 0;
};

// Get fixture position in world coordinates
export const getFixtureWorldPosition = (wall: Wall, fixture: WallFixture): Point => {
  // fixture.dimensions.width is now in feet, convert to pixels
  const fixtureWidthPixels = feetToPixels(fixture.dimensions.width);
  return getPointAlongWall(wall, fixture.position + fixtureWidthPixels / 2);
};

// Find wall by ID
// Note: Wall splitting has been removed, so this now simply finds by exact ID match
// Legacy segment ID handling kept for backward compatibility with old data
export const findWallById = (walls: Wall[], wallId: string): Wall | undefined => {
  // Direct ID match
  const directMatch = walls.find(w => w.id === wallId);
  if (directMatch) {
    return directMatch;
  }

  // Backward compatibility: If wallId contains '_segment_', try to find the original wall
  if (wallId.includes('_segment_')) {
    const originalWallId = wallId.split('_segment_')[0];
    const originalWallMatch = walls.find(w => w.id === originalWallId);
    if (originalWallMatch) {
      return originalWallMatch;
    }
  }

  return undefined;
};

// Find the appropriate wall for a fixture
// Note: Wall splitting has been removed, so this now simply finds the wall by ID
export const findWallForFixture = (walls: Wall[], fixture: WallFixture): Wall | undefined => {
  const wall = findWallById(walls, fixture.wallId);

  if (!wall) {
    console.error(`❌ Wall not found for fixture ${fixture.id.slice(0,8)}, wallId: ${fixture.wallId}`);
    return undefined;
  }

  return wall;
};

// Get segments before and after a specific fixture
export const getSegmentsForFixture = (
  wall: Wall,
  fixtureId: string
): { beforeSegment: WallSegment | null; afterSegment: WallSegment | null } => {
  const segments = wall.segments;
  let beforeSegment: WallSegment | null = null;
  let afterSegment: WallSegment | null = null;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    // Found the fixture gap segment
    if (segment.type === 'fixture_gap' && segment.fixtureId === fixtureId) {
      // Get segment before (if exists and is a wall segment)
      if (i > 0 && segments[i - 1].type === 'wall') {
        beforeSegment = segments[i - 1];
      }

      // Get segment after (if exists and is a wall segment)
      if (i < segments.length - 1 && segments[i + 1].type === 'wall') {
        afterSegment = segments[i + 1];
      }

      break;
    }
  }

  return { beforeSegment, afterSegment };
};

// Adjust wall segment length (before or after a fixture)
// This changes the wall length without moving the fixture
export const adjustWallSegmentLength = (
  wall: Wall,
  fixtureId: string,
  side: 'before' | 'after',
  newLengthPixels: number,
  fixtures: WallFixture[]
): { updatedWall: Wall; success: boolean; error?: string } => {
  // Find the fixture on this wall
  const fixture = fixtures.find(f => f.id === fixtureId && f.wallId === wall.id);
  if (!fixture) {
    return { updatedWall: wall, success: false, error: 'Fixture not found on wall' };
  }

  // Validate minimum length (0.5 feet = 10 pixels)
  const minLengthPixels = 10;
  if (newLengthPixels < minLengthPixels) {
    return { updatedWall: wall, success: false, error: 'Segment length too small (minimum 0.5 feet)' };
  }

  // Get current segments
  const { beforeSegment, afterSegment } = getSegmentsForFixture(wall, fixtureId);

  // Calculate wall angle
  const wallAngle = calculateWallAngle(wall.start, wall.end);
  const wallLength = calculateDistance(wall.start, wall.end);
  const fixtureWidthPixels = feetToPixels(fixture.dimensions.width);

  let updatedWall: Wall;

  if (side === 'before') {
    if (!beforeSegment) {
      return { updatedWall: wall, success: false, error: 'No segment before fixture' };
    }

    // Calculate current before segment length
    const currentBeforeLength = calculateDistance(beforeSegment.start, beforeSegment.end);
    const lengthDelta = newLengthPixels - currentBeforeLength;

    // Calculate new wall start point (move backward/forward along wall direction)
    // Moving start point opposite to wall direction
    const newStart: Point = {
      x: wall.start.x - Math.cos(wallAngle) * lengthDelta,
      y: wall.start.y - Math.sin(wallAngle) * lengthDelta
    };

    updatedWall = {
      ...wall,
      start: newStart,
      length: createMeasurement(pixelsToFeet(wallLength + lengthDelta)),
      updatedAt: new Date().toISOString()
    };

  } else { // side === 'after'
    if (!afterSegment) {
      return { updatedWall: wall, success: false, error: 'No segment after fixture' };
    }

    // Calculate current after segment length
    const currentAfterLength = calculateDistance(afterSegment.start, afterSegment.end);
    const lengthDelta = newLengthPixels - currentAfterLength;

    // Calculate new wall end point (move forward/backward along wall direction)
    const newEnd: Point = {
      x: wall.end.x + Math.cos(wallAngle) * lengthDelta,
      y: wall.end.y + Math.sin(wallAngle) * lengthDelta
    };

    updatedWall = {
      ...wall,
      end: newEnd,
      length: createMeasurement(pixelsToFeet(wallLength + lengthDelta)),
      updatedAt: new Date().toISOString()
    };
  }

  // Recalculate segments with new wall geometry
  updatedWall.segments = calculateWallSegments(updatedWall, fixtures);

  return { updatedWall, success: true };
};