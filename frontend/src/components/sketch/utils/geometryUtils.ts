/**
 * Geometry Utilities
 * Mathematical operations for 2D floor plan sketching
 */

import { Point, Rectangle, BoundingBox, Wall, SketchRoom } from '../../../types/sketch';

// =====================
// Point Operations
// =====================

/**
 * Calculate distance between two points
 */
export function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate squared distance (faster for comparisons)
 */
export function distanceSquared(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return dx * dx + dy * dy;
}

/**
 * Calculate midpoint between two points
 */
export function midpoint(p1: Point, p2: Point): Point {
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
  };
}

/**
 * Add two points (vector addition)
 */
export function addPoints(p1: Point, p2: Point): Point {
  return {
    x: p1.x + p2.x,
    y: p1.y + p2.y,
  };
}

/**
 * Subtract two points (vector subtraction)
 */
export function subtractPoints(p1: Point, p2: Point): Point {
  return {
    x: p1.x - p2.x,
    y: p1.y - p2.y,
  };
}

/**
 * Scale a point by a factor
 */
export function scalePoint(p: Point, scale: number): Point {
  return {
    x: p.x * scale,
    y: p.y * scale,
  };
}

/**
 * Rotate a point around another point
 */
export function rotatePoint(p: Point, center: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - center.x;
  const dy = p.y - center.y;

  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/**
 * Normalize a vector to unit length
 */
export function normalize(p: Point): Point {
  const len = Math.sqrt(p.x * p.x + p.y * p.y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: p.x / len, y: p.y / len };
}

/**
 * Calculate dot product of two vectors
 */
export function dotProduct(p1: Point, p2: Point): number {
  return p1.x * p2.x + p1.y * p2.y;
}

/**
 * Calculate cross product of two 2D vectors (returns scalar)
 */
export function crossProduct(p1: Point, p2: Point): number {
  return p1.x * p2.y - p1.y * p2.x;
}

// =====================
// Line Operations
// =====================

/**
 * Calculate angle of line from point A to point B (in radians)
 */
export function lineAngle(p1: Point, p2: Point): number {
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

/**
 * Calculate perpendicular vector to a line
 */
export function perpendicular(p1: Point, p2: Point): Point {
  const direction = normalize(subtractPoints(p2, p1));
  return { x: -direction.y, y: direction.x };
}

/**
 * Find point on line at given distance from start
 */
export function pointOnLine(p1: Point, p2: Point, distance: number): Point {
  const direction = normalize(subtractPoints(p2, p1));
  return addPoints(p1, scalePoint(direction, distance));
}

/**
 * Find closest point on line segment to given point
 */
export function closestPointOnSegment(point: Point, lineStart: Point, lineEnd: Point): Point {
  const lineVec = subtractPoints(lineEnd, lineStart);
  const pointVec = subtractPoints(point, lineStart);

  const lineLengthSquared = dotProduct(lineVec, lineVec);
  if (lineLengthSquared === 0) return lineStart;

  const t = Math.max(0, Math.min(1, dotProduct(pointVec, lineVec) / lineLengthSquared));
  return addPoints(lineStart, scalePoint(lineVec, t));
}

/**
 * Calculate distance from point to line segment
 */
export function distanceToSegment(point: Point, lineStart: Point, lineEnd: Point): number {
  const closest = closestPointOnSegment(point, lineStart, lineEnd);
  return distance(point, closest);
}

/**
 * Check if two line segments intersect
 */
export function segmentsIntersect(
  p1: Point, q1: Point,
  p2: Point, q2: Point
): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);

  // General case
  if (o1 !== o2 && o3 !== o4) return true;

  // Special cases (collinear points)
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;

  return false;
}

/**
 * Find intersection point of two lines (infinite lines, not segments)
 */
export function lineIntersection(
  p1: Point, p2: Point,
  p3: Point, p4: Point
): Point | null {
  const x1 = p1.x, y1 = p1.y;
  const x2 = p2.x, y2 = p2.y;
  const x3 = p3.x, y3 = p3.y;
  const x4 = p4.x, y4 = p4.y;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-10) return null; // Lines are parallel

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;

  return {
    x: x1 + t * (x2 - x1),
    y: y1 + t * (y2 - y1),
  };
}

// Helper functions for line intersection
function orientation(p: Point, q: Point, r: Point): number {
  const val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  if (Math.abs(val) < 1e-10) return 0; // Collinear
  return val > 0 ? 1 : 2; // Clockwise or counterclockwise
}

function onSegment(p: Point, q: Point, r: Point): boolean {
  return (
    q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) &&
    q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y)
  );
}

// =====================
// Polygon Operations
// =====================

/**
 * Calculate area of polygon using shoelace formula
 */
export function polygonArea(points: Point[]): number {
  if (points.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Calculate area of polygon with holes
 * @param outerBoundary - Outer boundary polygon (should be counter-clockwise)
 * @param holes - Array of hole polygons (should be clockwise)
 * @returns Net area (outer area minus holes)
 */
export function polygonAreaWithHoles(outerBoundary: Point[], holes: Point[][]): number {
  // Calculate outer boundary area
  const outerArea = polygonArea(outerBoundary);

  // Calculate total hole areas
  const holeArea = holes.reduce((total, hole) => {
    return total + polygonArea(hole);
  }, 0);

  // Return net area
  return Math.max(0, outerArea - holeArea);
}

/**
 * Check if a polygon is completely inside another polygon
 */
export function polygonInsidePolygon(inner: Point[], outer: Point[]): boolean {
  if (inner.length === 0 || outer.length < 3) return false;

  // Check if all vertices of inner polygon are inside outer polygon
  for (const point of inner) {
    if (!pointInPolygon(point, outer)) {
      return false;
    }
  }

  // Also check that inner polygon edges don't intersect outer polygon edges
  for (let i = 0; i < inner.length; i++) {
    const j = (i + 1) % inner.length;
    const innerEdge = { start: inner[i], end: inner[j] };

    for (let k = 0; k < outer.length; k++) {
      const l = (k + 1) % outer.length;
      if (segmentsIntersect(innerEdge.start, innerEdge.end, outer[k], outer[l])) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Calculate centroid of polygon
 */
export function polygonCentroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };

  let cx = 0, cy = 0, area = 0;

  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const cross = points[i].x * points[j].y - points[j].x * points[i].y;
    area += cross;
    cx += (points[i].x + points[j].x) * cross;
    cy += (points[i].y + points[j].y) * cross;
  }

  area /= 2;
  if (Math.abs(area) < 1e-10) {
    // Fallback to simple average for degenerate cases
    const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
  }

  cx /= (6 * area);
  cy /= (6 * area);
  return { x: cx, y: cy };
}

/**
 * Check if point is inside polygon using ray casting algorithm
 */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (((polygon[i].y > point.y) !== (polygon[j].y > point.y)) &&
        (point.x < (polygon[j].x - polygon[i].x) * (point.y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Check if polygon is clockwise
 */
export function isClockwise(points: Point[]): boolean {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    sum += (points[j].x - points[i].x) * (points[j].y + points[i].y);
  }
  return sum > 0;
}

/**
 * Reverse polygon winding order
 */
export function reversePolygon(points: Point[]): Point[] {
  return [...points].reverse();
}

/**
 * Simplify polygon by removing collinear points
 */
export function simplifyPolygon(points: Point[], tolerance: number = 1e-10): Point[] {
  if (points.length < 3) return points;

  const simplified: Point[] = [];

  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length];
    const current = points[i];
    const next = points[(i + 1) % points.length];

    // Calculate cross product to check if points are collinear
    const cross = crossProduct(
      subtractPoints(current, prev),
      subtractPoints(next, current)
    );

    // Keep point if not collinear or if it's a significant turn
    if (Math.abs(cross) > tolerance) {
      simplified.push(current);
    }
  }

  return simplified;
}

// =====================
// Rectangle Operations
// =====================

/**
 * Create bounding box from points
 */
export function getBoundingBox(points: Point[]): BoundingBox {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = points[0].x, maxX = points[0].x;
  let minY = points[0].y, maxY = points[0].y;

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Check if point is inside rectangle
 */
export function pointInRectangle(point: Point, rect: Rectangle): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * Check if two rectangles overlap
 */
export function rectanglesOverlap(r1: Rectangle, r2: Rectangle): boolean {
  return !(
    r1.x + r1.width < r2.x ||
    r2.x + r2.width < r1.x ||
    r1.y + r1.height < r2.y ||
    r2.y + r2.height < r1.y
  );
}

/**
 * Expand rectangle by margin
 */
export function expandRectangle(rect: Rectangle, margin: number): Rectangle {
  return {
    x: rect.x - margin,
    y: rect.y - margin,
    width: rect.width + 2 * margin,
    height: rect.height + 2 * margin,
  };
}

// =====================
// Snapping Utilities
// =====================

/**
 * Snap point to grid
 */
export function snapToGrid(point: Point, gridSize: number): Point {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}

/**
 * Snap point to nearest point in array
 */
export function snapToPoints(point: Point, snapPoints: Point[], tolerance: number): Point {
  let closest = point;
  let minDistance = tolerance;

  for (const snapPoint of snapPoints) {
    const dist = distance(point, snapPoint);
    if (dist < minDistance) {
      minDistance = dist;
      closest = snapPoint;
    }
  }

  return closest;
}

/**
 * Snap point to nearest line segment
 */
export function snapToLines(
  point: Point,
  lines: Array<{ start: Point; end: Point }>,
  tolerance: number
): Point {
  let closest = point;
  let minDistance = tolerance;

  for (const line of lines) {
    const snapPoint = closestPointOnSegment(point, line.start, line.end);
    const dist = distance(point, snapPoint);
    if (dist < minDistance) {
      minDistance = dist;
      closest = snapPoint;
    }
  }

  return closest;
}

// =====================
// Wall-specific Geometry
// =====================

/**
 * Calculate wall endpoints with thickness
 */
export function getWallGeometry(wall: Wall): {
  centerStart: Point;
  centerEnd: Point;
  leftStart: Point;
  leftEnd: Point;
  rightStart: Point;
  rightEnd: Point;
} {
  const { start, end, thickness } = wall;
  const halfThickness = thickness / 2;

  // Calculate perpendicular vector
  const direction = normalize(subtractPoints(end, start));
  const perp = { x: -direction.y, y: direction.x };

  // Calculate wall edges
  const offset = scalePoint(perp, halfThickness);

  return {
    centerStart: start,
    centerEnd: end,
    leftStart: addPoints(start, offset),
    leftEnd: addPoints(end, offset),
    rightStart: subtractPoints(start, offset),
    rightEnd: subtractPoints(end, offset),
  };
}

/**
 * Find wall connections/intersections
 */
export function findWallConnections(walls: Wall[]): Map<string, string[]> {
  const connections = new Map<string, string[]>();

  for (let i = 0; i < walls.length; i++) {
    const wallA = walls[i];
    const connectionsA: string[] = [];

    for (let j = i + 1; j < walls.length; j++) {
      const wallB = walls[j];

      // Check if walls share endpoints (within tolerance)
      const tolerance = 5; // pixels
      const startStartDist = distance(wallA.start, wallB.start);
      const startEndDist = distance(wallA.start, wallB.end);
      const endStartDist = distance(wallA.end, wallB.start);
      const endEndDist = distance(wallA.end, wallB.end);

      if (startStartDist < tolerance || startEndDist < tolerance ||
          endStartDist < tolerance || endEndDist < tolerance) {
        connectionsA.push(wallB.id);

        // Add reverse connection
        if (!connections.has(wallB.id)) {
          connections.set(wallB.id, []);
        }
        connections.get(wallB.id)!.push(wallA.id);
      }
    }

    connections.set(wallA.id, connectionsA);
  }

  return connections;
}

// =====================
// Room Boundary Calculation
// =====================

/**
 * Calculate polygon perimeter
 */
export function calculatePolygonPerimeter(points: Point[]): number {
  if (points.length < 2) return 0;

  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    perimeter += distance(points[i], points[j]);
  }
  return perimeter;
}

/**
 * Calculate room boundary from walls (simplified version)
 * In a real implementation, this would use more sophisticated algorithms
 */
export function calculateRoomBoundary(walls: Wall[]): Point[] {
  if (walls.length === 0) return [];
  if (walls.length === 1) {
    const wall = walls[0];
    return [wall.start, wall.end];
  }

  // Simple case: assume walls form a closed loop
  // Start with first wall
  const boundary: Point[] = [walls[0].start];
  let currentPoint = walls[0].end;
  const usedWalls = new Set([0]);

  while (usedWalls.size < walls.length) {
    let found = false;

    for (let i = 0; i < walls.length; i++) {
      if (usedWalls.has(i)) continue;

      const wall = walls[i];
      const tolerance = 5; // pixels

      if (distance(currentPoint, wall.start) < tolerance) {
        boundary.push(wall.start);
        currentPoint = wall.end;
        usedWalls.add(i);
        found = true;
        break;
      } else if (distance(currentPoint, wall.end) < tolerance) {
        boundary.push(wall.end);
        currentPoint = wall.start;
        usedWalls.add(i);
        found = true;
        break;
      }
    }

    if (!found) break;
  }

  // Close the boundary if needed
  if (boundary.length > 2 && distance(currentPoint, boundary[0]) < 5) {
    boundary.push(boundary[0]);
  }

  return boundary;
}

/**
 * Detect and separate outer boundary walls from interior walls
 * Uses a more sophisticated approach: trace the largest closed loop as the outer boundary
 * @param walls - All walls in the room
 * @returns Object containing outer walls and interior walls
 */
export function separateOuterAndInteriorWalls(walls: Wall[]): {
  outerWalls: Wall[];
  interiorWalls: Wall[];
} {
  if (walls.length === 0) {
    return { outerWalls: [], interiorWalls: [] };
  }

  // Strategy: Find all closed loops, the one with the largest area is the outer boundary
  const loops: Wall[][] = [];
  const visited = new Set<string>();

  const CONNECTION_TOLERANCE = 5; // pixels - standard connection tolerance

  // Find all closed loops
  for (const startWall of walls) {
    if (visited.has(startWall.id)) continue;

    const loop: Wall[] = [];
    let currentPoint = startWall.start;
    let currentWall = startWall;
    const loopVisited = new Set<string>();

    // Try to form a closed loop
    while (true) {
      if (loopVisited.has(currentWall.id)) break;

      loopVisited.add(currentWall.id);
      loop.push(currentWall);

      // Move to the next point
      currentPoint = currentPoint === currentWall.start ? currentWall.end : currentWall.start;

      // Find next connected wall
      let found = false;
      for (const nextWall of walls) {
        if (loopVisited.has(nextWall.id)) continue;

        const distToStart = distance(currentPoint, nextWall.start);
        const distToEnd = distance(currentPoint, nextWall.end);

        // Use larger tolerance to allow connecting across fixture gaps
        if (distToStart < CONNECTION_TOLERANCE || distToEnd < CONNECTION_TOLERANCE) {
          currentWall = nextWall;
          currentPoint = distToStart < CONNECTION_TOLERANCE ? nextWall.start : nextWall.end;
          found = true;
          break;
        }
      }

      if (!found) break;

      // Check if we've closed the loop (also use larger tolerance)
      if (loop.length > 2 && distance(currentPoint, loop[0].start) < CONNECTION_TOLERANCE) {
        // Mark all walls in this loop as visited
        loop.forEach(w => visited.add(w.id));
        loops.push(loop);
        break;
      }
    }
  }

  // Find the loop with the largest area (this is the outer boundary)
  let largestLoop: Wall[] = [];
  let largestArea = 0;

  for (const loop of loops) {
    const boundary = loop.map(w => w.start);
    if (boundary.length >= 3) {
      const area = Math.abs(polygonArea(boundary));
      if (area > largestArea) {
        largestArea = area;
        largestLoop = loop;
      }
    }
  }

  // Outer walls are the largest loop, all others are interior
  const outerWallIds = new Set(largestLoop.map(w => w.id));
  const outerWalls = walls.filter(w => outerWallIds.has(w.id));
  const interiorWalls = walls.filter(w => !outerWallIds.has(w.id));

  return { outerWalls, interiorWalls };
}

/**
 * Calculate room boundary with holes (interior walls)
 * @param walls - All walls in the room
 * @returns Object containing outer boundary and interior holes
 */
export function calculateRoomBoundaryWithHoles(walls: Wall[]): {
  outerBoundary: Point[];
  holes: Point[][];
} {
  if (walls.length === 0) {
    return { outerBoundary: [], holes: [] };
  }

  // Separate outer and interior walls
  const { outerWalls, interiorWalls } = separateOuterAndInteriorWalls(walls);

  // Calculate outer boundary
  const outerBoundary = outerWalls.length > 0
    ? calculateRoomBoundary(outerWalls)
    : calculateRoomBoundary(walls); // Fallback to all walls if no outer walls detected

  // Group interior walls into separate polygons (holes)
  const holes: Point[][] = [];

  if (interiorWalls.length > 0) {
    // Try to form closed loops from interior walls
    const visited = new Set<string>();

    for (const startWall of interiorWalls) {
      if (visited.has(startWall.id)) continue;

      const hole: Point[] = [];
      const wallsInHole: Wall[] = [];
      let currentPoint = startWall.start;
      let currentWall = startWall;

      // Try to form a closed loop
      while (true) {
        if (visited.has(currentWall.id)) break;

        visited.add(currentWall.id);
        wallsInHole.push(currentWall);
        hole.push(currentPoint);

        // Move to the next point
        currentPoint = currentPoint === currentWall.start ? currentWall.end : currentWall.start;

        // Find the next connected wall
        let found = false;
        for (const nextWall of interiorWalls) {
          if (visited.has(nextWall.id)) continue;

          const distToStart = distance(currentPoint, nextWall.start);
          const distToEnd = distance(currentPoint, nextWall.end);

          if (distToStart < 5 || distToEnd < 5) {
            currentWall = nextWall;
            currentPoint = distToStart < 5 ? nextWall.start : nextWall.end;
            found = true;
            break;
          }
        }

        if (!found) break;

        // Check if we've closed the loop
        if (hole.length > 2 && distance(currentPoint, hole[0]) < 5) {
          hole.push(hole[0]); // Close the loop
          break;
        }
      }

      // Only add hole if it forms a closed loop (at least 3 vertices)
      if (hole.length >= 3 && distance(hole[0], hole[hole.length - 1]) < 5) {
        holes.push(hole);
      }
    }
  }

  return { outerBoundary, holes };
}