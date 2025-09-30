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

// Helper function to convert pixels to feet (20 pixels = 1 foot)
export const pixelsToFeet = (pixels: number): number => {
  return pixels / 20;
};

// Helper function to convert feet to pixels (20 pixels = 1 foot)
export const feetToPixels = (feet: number): number => {
  return feet * 20;
};

// Helper function to create Measurement object
export const createMeasurement = (feet: number): Measurement => {
  const totalInches = feet * 12;
  const wholeFeet = Math.floor(feet);
  const remainingInches = Math.round((feet - wholeFeet) * 12);

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
  // Handle both direct wall ID matches and segment matches
  const wallFixtures = fixtures
    .filter(fixture => {
      // Direct match
      if (fixture.wallId === wall.id) return true;

      // If fixture's wallId is a segment of this wall
      if (fixture.wallId.includes('_segment_') && fixture.wallId.startsWith(wall.id + '_segment_')) {
        return true;
      }

      // If wall.id is a segment and fixture belongs to the original wall
      if (wall.id.includes('_segment_')) {
        const originalWallId = wall.id.split('_segment_')[0];
        if (fixture.wallId === originalWallId) return true;
      }

      return false;
    })
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
  // The fixture rotation is always 0 for wall fixtures (parallel to wall)
  // The rendering system will add the wall angle to this
  const wallAngle = calculateWallAngle(wall.start, wall.end);
  const wallAngleDegrees = (wallAngle * 180) / Math.PI;

  console.log(`🔧 Auto-rotation for wall ${wall.id.slice(0,8)}: wall angle = ${wallAngleDegrees.toFixed(1)}°, fixture rotation = 0° (parallel to wall)`);

  // Always return 0 - doors and windows are always parallel to their wall
  // The actual visual rotation will be handled in the renderer
  return 0;
};

// Split wall at fixture positions
export const splitWallAtFixtures = (wall: Wall, fixtures: WallFixture[]): Wall[] => {
  // Get fixtures on this wall, sorted by position
  // Handle both direct wall ID matches and segment matches
  const wallFixtures = fixtures
    .filter(fixture => {
      // Direct match
      if (fixture.wallId === wall.id) return true;

      // If fixture's wallId is a segment of this wall
      if (fixture.wallId.includes('_segment_') && fixture.wallId.startsWith(wall.id + '_segment_')) {
        return true;
      }

      // If wall.id is a segment and fixture belongs to the original wall
      if (wall.id.includes('_segment_')) {
        const originalWallId = wall.id.split('_segment_')[0];
        if (fixture.wallId === originalWallId) return true;
      }

      return false;
    })
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

// Find wall by ID, handling both original walls and wall segments
export const findWallById = (walls: Wall[], wallId: string): Wall | undefined => {
  // First try direct ID match
  const directMatch = walls.find(w => w.id === wallId);
  if (directMatch) {
    return directMatch;
  }

  // If no direct match, look for segments that belong to this wall
  // Wall segments have IDs like "originalWallId_segment_0"
  const segmentMatch = walls.find(w =>
    w.id.includes('_segment_') && w.id.startsWith(wallId + '_segment_')
  );
  if (segmentMatch) {
    console.log(`📍 Found wall segment ${segmentMatch.id} for fixture wall ID ${wallId}`);
    return segmentMatch;
  }

  // If fixture's wallId is a segment ID, extract the original wall ID
  // Handle nested segments like "room-xxx-wall-right_segment_0_segment_0"
  if (wallId.includes('_segment_')) {
    // Extract base wall ID by removing all segment suffixes
    const originalWallId = wallId.split('_segment_')[0];

    // First try to find a matching segment (maybe with fewer nesting levels)
    const partialSegmentMatch = walls.find(w =>
      w.id.includes('_segment_') && w.id.startsWith(originalWallId)
    );
    if (partialSegmentMatch) {
      console.log(`📍 Found partial segment match ${partialSegmentMatch.id} for nested segment ID ${wallId}`);
      return partialSegmentMatch;
    }

    // Then try the original wall
    const originalWallMatch = walls.find(w => w.id === originalWallId);
    if (originalWallMatch) {
      console.log(`📍 Found original wall ${originalWallId} for segment ID ${wallId}`);
      return originalWallMatch;
    }
  }

  console.warn(`❌ Wall not found for ID: ${wallId}`);
  return undefined;
};

// Find the appropriate wall for a fixture, handling both original walls and segments
export const findWallForFixture = (walls: Wall[], fixture: WallFixture): Wall | undefined => {
  const wall = findWallById(walls, fixture.wallId);

  if (!wall) {
    console.warn(`❌ Wall not found for fixture ${fixture.id.slice(0,8)} with wallId: ${fixture.wallId}`);
    return undefined;
  }

  // If we found a segment, that's fine - fixtures can exist on segments
  // If we found the original wall, check if it has been split and find the appropriate segment
  if (!wall.id.includes('_segment_')) {
    // This is an original wall, check if it contains the fixture's position
    const wallLength = calculateDistance(wall.start, wall.end);
    const fixtureWidthPixels = feetToPixels(fixture.dimensions.width);

    // If fixture position + width is within wall bounds, use this wall
    if (fixture.position >= 0 && fixture.position + fixtureWidthPixels <= wallLength) {
      return wall;
    }

    // Otherwise, try to find the correct segment
    const segments = walls.filter(w =>
      w.id.includes('_segment_') && w.id.startsWith(fixture.wallId + '_segment_')
    );

    for (const segment of segments) {
      // Calculate segment position relative to original wall
      const segmentStartDistance = calculateDistance(wall.start, segment.start);
      const segmentEndDistance = calculateDistance(wall.start, segment.end);

      // Check if fixture overlaps with this segment
      if (fixture.position >= segmentStartDistance - fixtureWidthPixels &&
          fixture.position <= segmentEndDistance) {
        console.log(`📍 Found correct segment ${segment.id.slice(0,12)} for fixture ${fixture.id.slice(0,8)}`);
        return segment;
      }
    }
  }

  return wall;
};