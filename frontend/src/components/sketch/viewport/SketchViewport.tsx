import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Stage, Layer, Rect, Line, Circle, Text, Shape } from 'react-konva';
import { Modal, Input, InputNumber, Form, Button } from 'antd';
import Konva from 'konva';
import { useSketchContext } from '../context/SketchProvider';

interface Point {
  x: number;
  y: number;
}

interface Wall {
  id: string;
  start: Point;
  end: Point;
}

interface Room {
  id: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  name: string;
  height: number; // Height in feet
  area: number; // Area in square feet
  wallIds?: string[]; // IDs of walls that belong to this room
  vertices?: Point[]; // Vertices of the room polygon (corners)
}

interface DragInfo {
  wallId: string;
  endpoint: 'start' | 'end';
  offset: Point;
}

interface WallDragInfo {
  wallIds: string[];
  startPositions: { [wallId: string]: { start: Point; end: Point } };
  offset: Point;
  clickPosition?: Point; // Position where user clicked on the wall
}

interface RoomDragInfo {
  roomIds: string[];
  startPositions: {
    [roomId: string]: {
      x: number;
      y: number;
      width?: number;
      height?: number;
      wallPositions: { [wallId: string]: { start: Point; end: Point } };
    }
  };
  offset: Point;
}

interface DragSelection {
  isActive: boolean;
  start: Point;
  current: Point;
}

interface RoomEditModal {
  visible: boolean;
  roomId: string | null;
}

interface ContextMenu {
  visible: boolean;
  x: number;
  y: number;
  roomId: string | null;
  wallId: string | null;
  type: 'room' | 'wall' | null;
}

const SNAP_THRESHOLD = 15; // Distance threshold for snapping in pixels
const ENDPOINT_HOVER_RADIUS = 12; // Radius for endpoint detection (increased for easier clicking)

interface SketchViewportProps {
  width?: number;
  height?: number;
  zoom?: number;
  pan?: { x: number; y: number };
  showGrid?: boolean;
  gridSize?: number;
  onStageClick?: (e: any) => void;
  onStageMouseMove?: (e: any) => void;
}

const SketchViewport: React.FC<SketchViewportProps> = ({
  width = 800,
  height = 600,
  zoom: initialZoom = 1,
  pan: initialPan = { x: 0, y: 0 },
  showGrid = true,
  gridSize = 20,
  onStageClick = () => {},
  onStageMouseMove = () => {},
}) => {
  const { currentTool, setCurrentTool } = useSketchContext();
  const [isDrawing, setIsDrawing] = useState(false);
  const [walls, setWalls] = useState<Wall[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomCounter, setRoomCounter] = useState(0);
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);
  const [isDrawingRoom, setIsDrawingRoom] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<{ start: Point; end: Point } | null>(null);

  // Zoom and Pan states
  const [zoom, setZoom] = useState(initialZoom);
  const [pan, setPan] = useState(initialPan);
  const [isPanning, setIsPanning] = useState(false);
  const [lastRawPointerPosition, setLastRawPointerPosition] = useState<Point | null>(null);
  const [isPanModeActive, setIsPanModeActive] = useState(false);
  const [roomEditModal, setRoomEditModal] = useState<RoomEditModal>({ visible: false, roomId: null });
  const [roomEditForm] = Form.useForm(); // Add form instance
  const [contextMenu, setContextMenu] = useState<ContextMenu>({ visible: false, x: 0, y: 0, roomId: null, wallId: null, type: null });
  const [currentWall, setCurrentWall] = useState<{ start: Point; end: Point } | null>(null);
  const [mousePos, setMousePos] = useState<Point>({ x: 0, y: 0 });
  const [selectedWallIds, setSelectedWallIds] = useState<string[]>([]);
  const [hoveredEndpoint, setHoveredEndpoint] = useState<{wallId: string; endpoint: 'start' | 'end'} | null>(null);
  const [hoveredRoomVertex, setHoveredRoomVertex] = useState<{roomId: string; vertexIndex: number} | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);
  const [snapIndicator, setSnapIndicator] = useState<Point | null>(null);
  const [wallDragInfo, setWallDragInfo] = useState<WallDragInfo | null>(null);
  const [roomDragInfo, setRoomDragInfo] = useState<RoomDragInfo | null>(null);
  const [dragSelection, setDragSelection] = useState<DragSelection>({ isActive: false, start: { x: 0, y: 0 }, current: { x: 0, y: 0 } });
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const [isMovingWalls, setIsMovingWalls] = useState(false);
  const [isMovingRooms, setIsMovingRooms] = useState(false);
  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [actualSize, setActualSize] = useState({ width, height });

  // Wall length editing states
  const [editingWallId, setEditingWallId] = useState<string | null>(null);
  const [wallLengthInput, setWallLengthInput] = useState<{ feet: number; inches: number }>({ feet: 0, inches: 0 });
  const [wallEditPosition, setWallEditPosition] = useState<{ x: number; y: number } | null>(null);

  // Update actual size based on props (SketchCanvas handles container sizing)
  useEffect(() => {
    const updateActualSize = () => {
      // Trust the parent SketchCanvas for size calculations
      // Just apply minimum constraints for safety
      const newWidth = Math.max(300, Math.min(width, 2000)); // Max reasonable width
      const newHeight = Math.max(200, Math.min(height, 1500)); // Max reasonable height

      // Debug logging to trace height calculation
      console.log('SketchViewport simplified size calculation:', {
        propsSize: { width, height },
        appliedSize: { width: newWidth, height: newHeight },
        containerElement: containerRef.current,
        parentRect: containerRef.current?.parentElement?.getBoundingClientRect()
      });

      setActualSize({
        width: newWidth,
        height: newHeight
      });
    };

    // Simple immediate update since parent handles the complex logic
    updateActualSize();

    // Optional resize handler for edge cases
    const handleResize = () => {
      setTimeout(updateActualSize, 50);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [width, height]);

  // Snap to grid helper
  const snapToGrid = (value: number): number => {
    return Math.round(value / gridSize) * gridSize;
  };

  // Calculate area of polygon in square feet (20 pixels = 1 foot)
  const calculatePolygonArea = (vertices: Point[]): number => {
    if (vertices.length < 3) return 0;

    // Shoelace formula for polygon area
    let area = 0;
    const n = vertices.length;

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += vertices[i].x * vertices[j].y;
      area -= vertices[j].x * vertices[i].y;
    }

    area = Math.abs(area / 2);

    // Convert to square feet (20 pixels = 1 foot)
    const feetArea = area / 400; // (20 * 20)
    return Math.round(feetArea);
  };

  // Calculate area in square feet (20 pixels = 1 foot) - for rectangles
  const calculateArea = (width: number, height: number): number => {
    const feetWidth = width / 20;
    const feetHeight = height / 20;
    return Math.round(feetWidth * feetHeight);
  };

  // Generate room name
  const generateRoomName = (): string => {
    if (roomCounter === 0) {
      return 'Room';
    }
    return `Room${roomCounter}`;
  };

  // Calculate distance from point to line segment
  const distanceToLineSegment = (point: Point, lineStart: Point, lineEnd: Point): number => {
    const A = point.x - lineStart.x;
    const B = point.y - lineStart.y;
    const C = lineEnd.x - lineStart.x;
    const D = lineEnd.y - lineStart.y;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;

    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;

    if (param < 0) {
      xx = lineStart.x;
      yy = lineStart.y;
    } else if (param > 1) {
      xx = lineEnd.x;
      yy = lineEnd.y;
    } else {
      xx = lineStart.x + param * C;
      yy = lineStart.y + param * D;
    }

    const dx = point.x - xx;
    const dy = point.y - yy;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Check if point is inside polygon
  const pointInPolygon = (point: Point, polygon: Point[]): boolean => {
    let inside = false;
    const x = point.x, y = point.y;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;

      const intersect = ((yi > y) !== (yj > y))
          && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }

    return inside;
  };

  // Calculate wall length in pixels
  const calculateWallLength = (wall: Wall): number => {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Convert pixels to feet and inches (assuming 1 foot = 20 pixels as base scale)
  const pixelsToFeetInches = (pixels: number): { feet: number; inches: number } => {
    const totalInches = (pixels / 20) * 12; // 20 pixels = 1 foot = 12 inches
    const feet = Math.floor(totalInches / 12);
    const inches = Math.round(totalInches % 12);
    return { feet, inches };
  };

  // Convert feet and inches to pixels
  const feetInchesToPixels = (feet: number, inches: number): number => {
    const totalInches = feet * 12 + inches;
    return (totalInches / 12) * 20; // 20 pixels = 1 foot
  };

  // Get wall midpoint for positioning the edit input
  const getWallMidpoint = (wall: Wall): Point => {
    return {
      x: (wall.start.x + wall.end.x) / 2,
      y: (wall.start.y + wall.end.y) / 2
    };
  };

  // Handle wall double-click for length editing
  const handleWallDoubleClick = useCallback((wallId: string, e: any) => {
    console.log('Wall double-clicked:', wallId);
    e.evt.stopPropagation();

    const wall = walls.find(w => w.id === wallId);
    if (!wall) {
      console.log('Wall not found for double click:', wallId);
      return;
    }

    // Calculate current length and convert to feet/inches
    const currentLengthPixels = calculateWallLength(wall);
    const { feet, inches } = pixelsToFeetInches(currentLengthPixels);

    console.log('Wall length info:', {
      wallId,
      currentLengthPixels,
      feet,
      inches,
      wall
    });

    // Set editing state
    setEditingWallId(wallId);
    setWallLengthInput({ feet, inches });

    // Calculate position for edit input (convert wall midpoint to screen coordinates)
    const midpoint = getWallMidpoint(wall);
    const stage = stageRef.current;
    const container = containerRef.current;

    if (stage && container) {
      // Get stage's transformation
      const stageBox = stage.getClientRect();
      const containerBox = container.getBoundingClientRect();

      // Apply zoom and pan transformations
      const scaledX = midpoint.x * zoom + pan.x;
      const scaledY = midpoint.y * zoom + pan.y;

      // Position relative to container
      const editPosition = {
        x: scaledX + containerBox.left - containerBox.left, // Relative to container
        y: scaledY + containerBox.top - containerBox.top - 40 // Position above the wall
      };

      console.log('Edit position calculated:', {
        midpoint,
        scaledX,
        scaledY,
        editPosition,
        zoom,
        pan
      });
      setWallEditPosition(editPosition);
    } else {
      console.log('Stage or container ref not available');
    }
  }, [walls]);

  // Update wall length based on input
  const updateWallLength = useCallback((wallId: string, newFeet: number, newInches: number) => {
    console.log('updateWallLength called:', { wallId, newFeet, newInches });
    console.log('Current walls array:', walls);

    // Validate input values first
    if (newFeet < 0 || newInches < 0 || newInches >= 12) {
      console.log('Invalid input values:', { newFeet, newInches });
      return;
    }

    const newLengthPixels = feetInchesToPixels(newFeet, newInches);

    if (newLengthPixels <= 0) {
      console.log('Invalid length: must be greater than 0');
      return;
    }

    let wall = walls.find(w => w.id === wallId);

    if (!wall) {
      console.log('Wall not found in walls array:', wallId);
      console.log('Available wall IDs:', walls.map(w => w.id));

      // Check if wall might be stored in rooms and try to reconstruct it
      const roomsWithWalls = rooms.filter(room => room.wallIds?.includes(wallId));
      console.log('Rooms containing this wall ID:', roomsWithWalls);

      if (roomsWithWalls.length > 0) {
        // Try to reconstruct wall from room data
        const room = roomsWithWalls[0];
        if (wallId.includes('-wall-right')) {
          wall = {
            id: wallId,
            start: { x: room.bounds.x + room.bounds.width, y: room.bounds.y },
            end: { x: room.bounds.x + room.bounds.width, y: room.bounds.y + room.bounds.height }
          };
          console.log('Reconstructed right wall:', wall);
        } else if (wallId.includes('-wall-left')) {
          wall = {
            id: wallId,
            start: { x: room.bounds.x, y: room.bounds.y },
            end: { x: room.bounds.x, y: room.bounds.y + room.bounds.height }
          };
          console.log('Reconstructed left wall:', wall);
        } else if (wallId.includes('-wall-top')) {
          wall = {
            id: wallId,
            start: { x: room.bounds.x, y: room.bounds.y },
            end: { x: room.bounds.x + room.bounds.width, y: room.bounds.y }
          };
          console.log('Reconstructed top wall:', wall);
        } else if (wallId.includes('-wall-bottom')) {
          wall = {
            id: wallId,
            start: { x: room.bounds.x + room.bounds.width, y: room.bounds.y + room.bounds.height },
            end: { x: room.bounds.x, y: room.bounds.y + room.bounds.height }
          };
          console.log('Reconstructed bottom wall:', wall);
        }
      }

      if (!wall) {
        console.log('Could not find or reconstruct wall');
        return;
      }
    }

    const currentLengthPixels = calculateWallLength(wall);

    console.log('Length calculation:', {
      newLengthPixels,
      currentLengthPixels,
      wall: wall
    });

    if (Math.abs(newLengthPixels - currentLengthPixels) < 1) {
      console.log('Length unchanged (difference < 1 pixel)');
      // Clear editing state even if no change
      setEditingWallId(null);
      setWallEditPosition(null);
      return;
    }

    // IRREGULAR SHAPE SUPPORT: Update only the specific wall instead of regenerating all room walls
    // This allows rooms to have irregular/non-rectangular shapes for property blueprints
    const roomsWithWalls = rooms.filter(room => room.wallIds?.includes(wallId));
    if (roomsWithWalls.length > 0) {
      console.log('Updating individual wall for irregular shape support');

      const room = roomsWithWalls[0];

      // Calculate new wall endpoints based on the wall direction and new length
      const dx = wall.end.x - wall.start.x;
      const dy = wall.end.y - wall.start.y;
      const currentLength = Math.sqrt(dx * dx + dy * dy);

      if (currentLength === 0) {
        console.log('Invalid wall: zero length');
        return;
      }

      // Calculate unit vector for wall direction
      const unitX = dx / currentLength;
      const unitY = dy / currentLength;

      // Calculate new end position based on start point and new length
      const newEnd: Point = {
        x: wall.start.x + unitX * newLengthPixels,
        y: wall.start.y + unitY * newLengthPixels
      };

      console.log('Individual wall update:', {
        wallId,
        currentLength,
        newLength: newLengthPixels,
        oldEnd: wall.end,
        newEnd
      });

      // Update the specific wall and handle connectivity in a single update
      setWalls(prevWalls => {
        const updatedWalls = prevWalls.map(w => {
          if (w.id === wallId) {
            return {
              ...w,
              end: newEnd
            };
          }
          return w;
        });

        console.log('Updated individual wall:', updatedWalls.find(w => w.id === wallId));

        // Optional: Update connected walls to maintain connectivity
        const shouldUpdateConnectedWalls = true; // Can be made configurable

        if (shouldUpdateConnectedWalls) {
          const tolerance = 10; // pixels - distance threshold for considering walls connected

          return updatedWalls.map(w => {
            // Skip the wall we just updated
            if (w.id === wallId) return w;

            // Check if this wall should connect to our updated wall's new endpoint
            const distanceToNewEnd = Math.sqrt(
              Math.pow(w.start.x - newEnd.x, 2) + Math.pow(w.start.y - newEnd.y, 2)
            );
            const distanceToNewEndFromEnd = Math.sqrt(
              Math.pow(w.end.x - newEnd.x, 2) + Math.pow(w.end.y - newEnd.y, 2)
            );

            // If wall start point is close to our new endpoint, connect it
            if (distanceToNewEnd <= tolerance) {
              console.log(`Connecting wall ${w.id} start to updated wall ${wallId} end`);
              return { ...w, start: newEnd };
            }

            // If wall end point is close to our new endpoint, connect it
            if (distanceToNewEndFromEnd <= tolerance) {
              console.log(`Connecting wall ${w.id} end to updated wall ${wallId} end`);
              return { ...w, end: newEnd };
            }

            return w;
          });
        }

        return updatedWalls;
      });

      // Update room bounds to encompass all walls (for rendering purposes)
      // Calculate bounding box from all room walls
      const roomWallIds = room.wallIds || [];
      const roomWalls = walls.filter(w => roomWallIds.includes(w.id));

      // Include the updated wall in calculations
      const updatedWall = { ...wall, end: newEnd };
      const allRoomWalls = roomWalls.map(w => w.id === wallId ? updatedWall : w);

      if (allRoomWalls.length > 0) {
        // Calculate bounding box from all wall points
        let minX = Number.MAX_VALUE;
        let minY = Number.MAX_VALUE;
        let maxX = Number.MIN_VALUE;
        let maxY = Number.MIN_VALUE;

        allRoomWalls.forEach(w => {
          minX = Math.min(minX, w.start.x, w.end.x);
          minY = Math.min(minY, w.start.y, w.end.y);
          maxX = Math.max(maxX, w.start.x, w.end.x);
          maxY = Math.max(maxY, w.start.y, w.end.y);
        });

        const newBounds = {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY
        };

        console.log('Updated room bounds from walls:', newBounds);

        // Update room bounds for layout purposes only
        setRooms(prevRooms => prevRooms.map(r =>
          r.id === room.id ? { ...r, bounds: newBounds } : r
        ));
      }
    } else {
      // For standalone walls (not part of a room), use the original logic
      const dx = wall.end.x - wall.start.x;
      const dy = wall.end.y - wall.start.y;
      const currentLength = Math.sqrt(dx * dx + dy * dy);

      if (currentLength === 0) {
        console.log('Invalid wall: zero length');
        return;
      }

      // Calculate unit vector
      const unitX = dx / currentLength;
      const unitY = dy / currentLength;

      // Calculate new end position
      const newEnd: Point = {
        x: wall.start.x + unitX * newLengthPixels,
        y: wall.start.y + unitY * newLengthPixels
      };

      console.log('New end position:', newEnd);

      // Update standalone wall
      setWalls(prevWalls => {
        const existingWallIndex = prevWalls.findIndex(w => w.id === wallId);
        if (existingWallIndex >= 0) {
          // Update existing wall
          return prevWalls.map(w =>
            w.id === wallId ? { ...w, end: newEnd } : w
          );
        } else {
          // Add wall if it doesn't exist (only if wall was found)
          if (wall) {
            const updatedWall: Wall = {
              id: wall.id,
              start: wall.start,
              end: newEnd
            };
            return [...prevWalls, updatedWall];
          }
          return prevWalls;
        }
      });
    }

    // Clear editing state
    setEditingWallId(null);
    setWallEditPosition(null);
  }, [walls]);

  // Cancel wall editing
  const cancelWallEdit = useCallback(() => {
    setEditingWallId(null);
    setWallEditPosition(null);
  }, []);

  // Convex Hull algorithm to find the outer boundary
  const getConvexHull = (points: Point[]): Point[] => {
    if (points.length <= 3) return points;

    // Sort points by x-coordinate (and by y if x is equal)
    const sortedPoints = [...points].sort((a, b) => {
      if (a.x === b.x) return a.y - b.y;
      return a.x - b.x;
    });

    // Cross product of vectors OA and OB
    const cross = (o: Point, a: Point, b: Point): number => {
      return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    };

    // Build lower hull
    const lower: Point[] = [];
    for (const p of sortedPoints) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.pop();
      }
      lower.push(p);
    }

    // Build upper hull
    const upper: Point[] = [];
    for (let i = sortedPoints.length - 1; i >= 0; i--) {
      const p = sortedPoints[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.pop();
      }
      upper.push(p);
    }

    // Remove last point of each half because it's repeated
    lower.pop();
    upper.pop();

    // Concatenate lower and upper hull
    return [...lower, ...upper];
  };

  // Get ordered vertices of a room polygon from its walls
  const getOrderedRoomVertices = (wallIds: string[]): Point[] => {

    const roomWalls = walls.filter(wall => wallIds.includes(wall.id));

    if (roomWalls.length === 0) {
      return [];
    }

    // Collect all unique points and build adjacency graph
    const pointSet = new Map<string, Point>();
    const adjacencyList = new Map<string, Set<string>>();

    roomWalls.forEach(wall => {
      const startKey = `${wall.start.x},${wall.start.y}`;
      const endKey = `${wall.end.x},${wall.end.y}`;

      pointSet.set(startKey, wall.start);
      pointSet.set(endKey, wall.end);

      // Build adjacency for connected points
      if (!adjacencyList.has(startKey)) {
        adjacencyList.set(startKey, new Set());
      }
      if (!adjacencyList.has(endKey)) {
        adjacencyList.set(endKey, new Set());
      }

      adjacencyList.get(startKey)!.add(endKey);
      adjacencyList.get(endKey)!.add(startKey);
    });

    const allPoints = Array.from(pointSet.values());

    // If we have fewer than 3 points, we can't form a polygon
    if (allPoints.length < 3) {
      return [];
    }

    // Try to find a connected path through the walls
    const orderedVertices = findConnectedPath(pointSet, adjacencyList);

    if (orderedVertices.length >= 3) {
      // Ensure proper winding order (counter-clockwise for positive area)
      const properlyOrdered = ensureProperWindingOrder(orderedVertices);

      // Validate that the polygon is not self-intersecting
      if (!isSelfIntersecting(properlyOrdered)) {
        return properlyOrdered;
      } else {
      }
    } else {
    }

    // If connected path failed or resulted in self-intersection, fall back to geometric sorting
    const geometricResult = sortPointsGeometrically(allPoints);

    // If we still have fewer than 3 points after geometric sorting,
    // try to create a bounding rectangle from available points
    if (geometricResult.length < 3 && allPoints.length >= 2) {
      const minX = Math.min(...allPoints.map(p => p.x));
      const maxX = Math.max(...allPoints.map(p => p.x));
      const minY = Math.min(...allPoints.map(p => p.y));
      const maxY = Math.max(...allPoints.map(p => p.y));

      // Create a rectangular boundary that includes all points
      return [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY }
      ];
    }

    return geometricResult;
  };

  // Helper function to find a connected path through walls
  const findConnectedPath = (pointSet: Map<string, Point>, adjacencyList: Map<string, Set<string>>): Point[] => {
    const vertices: Point[] = [];
    const visited = new Set<string>();

    // Find the leftmost point as starting point (most stable for ordering)
    let startKey = '';
    let leftmostX = Infinity;

    Array.from(pointSet.entries()).forEach(([key, point]) => {
      if (point.x < leftmostX || (point.x === leftmostX && point.y < pointSet.get(startKey)!?.y)) {
        leftmostX = point.x;
        startKey = key;
      }
    });

    if (!startKey) return [];

    let currentKey = startKey;
    let prevKey: string | null = null;

    // Traverse the connected path
    while (vertices.length < pointSet.size) {
      if (visited.has(currentKey)) break;

      visited.add(currentKey);
      vertices.push(pointSet.get(currentKey)!);

      const neighbors = adjacencyList.get(currentKey);
      if (!neighbors || neighbors.size === 0) break;

      // Find the next unvisited neighbor, or close the loop if possible
      let nextKey: string | null = null;

      // If we have more than 2 vertices and can close the loop, do so
      if (vertices.length >= 3 && neighbors.has(startKey) && visited.size === pointSet.size) {
        break; // Complete closed loop
      }

      // Find unvisited neighbor, preferring the one that maintains good geometry
      const unvisitedNeighbors = Array.from(neighbors).filter(key => !visited.has(key) && key !== prevKey);

      if (unvisitedNeighbors.length > 0) {
        if (unvisitedNeighbors.length === 1) {
          nextKey = unvisitedNeighbors[0];
        } else {
          // Choose the neighbor that creates the best angle (most "outward" turn)
          const currentPoint = pointSet.get(currentKey)!;
          const prevPoint = prevKey ? pointSet.get(prevKey)! : null;

          nextKey = chooseBestNeighbor(currentPoint, prevPoint, unvisitedNeighbors.map(k => pointSet.get(k)!), unvisitedNeighbors);
        }
      }

      if (!nextKey) break;

      prevKey = currentKey;
      currentKey = nextKey;
    }

    return vertices;
  };

  // Helper function to choose the best next neighbor based on geometry
  const chooseBestNeighbor = (current: Point, prev: Point | null, candidates: Point[], candidateKeys: string[]): string => {
    if (candidates.length === 1) return candidateKeys[0];

    // If no previous point, choose the one with smallest angle from horizontal
    if (!prev) {
      let bestIndex = 0;
      let bestAngle = Infinity;

      for (let i = 0; i < candidates.length; i++) {
        const angle = Math.abs(Math.atan2(candidates[i].y - current.y, candidates[i].x - current.x));
        if (angle < bestAngle) {
          bestAngle = angle;
          bestIndex = i;
        }
      }

      return candidateKeys[bestIndex];
    }

    // Choose the candidate that creates the largest left turn (for counter-clockwise traversal)
    let bestIndex = 0;
    let bestCrossProduct = -Infinity;

    const prevVector = { x: current.x - prev.x, y: current.y - prev.y };

    for (let i = 0; i < candidates.length; i++) {
      const nextVector = { x: candidates[i].x - current.x, y: candidates[i].y - current.y };
      const crossProduct = prevVector.x * nextVector.y - prevVector.y * nextVector.x;

      if (crossProduct > bestCrossProduct) {
        bestCrossProduct = crossProduct;
        bestIndex = i;
      }
    }

    return candidateKeys[bestIndex];
  };

  // Helper function to ensure proper winding order (counter-clockwise)
  const ensureProperWindingOrder = (vertices: Point[]): Point[] => {
    if (vertices.length < 3) return vertices;

    // Calculate signed area using shoelace formula
    let signedArea = 0;
    const n = vertices.length;

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      signedArea += (vertices[j].x - vertices[i].x) * (vertices[j].y + vertices[i].y);
    }

    // If signed area is positive, the vertices are in clockwise order, so reverse them
    if (signedArea > 0) {
      return [...vertices].reverse();
    }

    return vertices;
  };

  // Helper function to check if a polygon is self-intersecting
  const isSelfIntersecting = (vertices: Point[]): boolean => {
    if (vertices.length < 4) return false; // Triangle or less cannot self-intersect

    const n = vertices.length;

    // Check each edge against all non-adjacent edges
    for (let i = 0; i < n; i++) {
      const edge1Start = vertices[i];
      const edge1End = vertices[(i + 1) % n];

      for (let j = i + 2; j < n; j++) {
        // Skip adjacent edges and the closing edge
        if ((j + 1) % n === i) continue;

        const edge2Start = vertices[j];
        const edge2End = vertices[(j + 1) % n];

        if (doLinesIntersect(edge1Start, edge1End, edge2Start, edge2End)) {
          return true;
        }
      }
    }

    return false;
  };

  // Helper function to check if two line segments intersect
  const doLinesIntersect = (p1: Point, q1: Point, p2: Point, q2: Point): boolean => {
    const orientation = (p: Point, q: Point, r: Point): number => {
      const val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
      if (val === 0) return 0; // collinear
      return val > 0 ? 1 : 2; // clockwise or counterclockwise
    };

    const onSegment = (p: Point, q: Point, r: Point): boolean => {
      return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) &&
             q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
    };

    const o1 = orientation(p1, q1, p2);
    const o2 = orientation(p1, q1, q2);
    const o3 = orientation(p2, q2, p1);
    const o4 = orientation(p2, q2, q1);

    // General case - lines intersect if orientations are different
    if (o1 !== o2 && o3 !== o4) return true;

    // Special cases for collinear points
    if (o1 === 0 && onSegment(p1, p2, q1)) return true;
    if (o2 === 0 && onSegment(p1, q2, q1)) return true;
    if (o3 === 0 && onSegment(p2, p1, q2)) return true;
    if (o4 === 0 && onSegment(p2, q1, q2)) return true;

    return false;
  };

  // Helper function to sort points geometrically when wall connectivity fails
  const sortPointsGeometrically = (points: Point[]): Point[] => {
    if (points.length < 3) return points;


    // For incomplete rooms (missing walls), create a convex hull to ensure
    // we get the maximum possible area that could reasonably represent the room
    if (points.length <= 6) { // Likely an incomplete room
      const hull = getConvexHull(points);
      return hull;
    }

    // Calculate centroid for complete rooms
    const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;

    // Sort points by angle from centroid
    const sortedPoints = [...points].sort((a, b) => {
      const angleA = Math.atan2(a.y - centerY, a.x - centerX);
      const angleB = Math.atan2(b.y - centerY, b.x - centerX);
      return angleA - angleB;
    });


    // Ensure we get a reasonable polygon shape by checking for obvious issues
    if (isSelfIntersecting(sortedPoints)) {
      // If geometric sorting still creates self-intersection, use convex hull as last resort
      return getConvexHull(points);
    }

    return sortedPoints;
  };

  // Calculate room bounds from its walls
  const calculateRoomBounds = (wallIds: string[]): { x: number; y: number; width: number; height: number } => {
    const roomWalls = walls.filter(wall => wallIds.includes(wall.id));

    if (roomWalls.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    // Get all points from the walls
    const points: Point[] = [];
    roomWalls.forEach(wall => {
      points.push(wall.start, wall.end);
    });

    // Find min/max coordinates
    const minX = Math.min(...points.map(p => p.x));
    const maxX = Math.max(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y));
    const maxY = Math.max(...points.map(p => p.y));

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  };

  // Calculate room bounds with provided walls array
  const calculateRoomBoundsWithWalls = (wallIds: string[], wallsArray: Wall[]): { x: number; y: number; width: number; height: number } => {
    const roomWalls = wallsArray.filter(wall => wallIds.includes(wall.id));

    if (roomWalls.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    // Get all points from the walls
    const points: Point[] = [];
    roomWalls.forEach(wall => {
      points.push(wall.start, wall.end);
    });

    // Find min/max coordinates
    const minX = Math.min(...points.map(p => p.x));
    const maxX = Math.max(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y));
    const maxY = Math.max(...points.map(p => p.y));

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  };

  // Get ordered vertices with provided walls array
  const getOrderedRoomVerticesWithWalls = (wallIds: string[], wallsArray: Wall[]): Point[] => {

    const roomWalls = wallsArray.filter(wall => wallIds.includes(wall.id));

    if (roomWalls.length === 0) {
      return [];
    }

    // Collect all unique points and build adjacency graph
    const pointSet = new Map<string, Point>();
    const adjacencyList = new Map<string, Set<string>>();

    roomWalls.forEach(wall => {
      const startKey = `${wall.start.x},${wall.start.y}`;
      const endKey = `${wall.end.x},${wall.end.y}`;

      pointSet.set(startKey, wall.start);
      pointSet.set(endKey, wall.end);

      // Build adjacency for connected points
      if (!adjacencyList.has(startKey)) {
        adjacencyList.set(startKey, new Set());
      }
      if (!adjacencyList.has(endKey)) {
        adjacencyList.set(endKey, new Set());
      }

      adjacencyList.get(startKey)!.add(endKey);
      adjacencyList.get(endKey)!.add(startKey);
    });

    const allPoints = Array.from(pointSet.values());

    // If we have fewer than 3 points, we can't form a polygon
    if (allPoints.length < 3) {
      return [];
    }

    // Try to find a connected path through the walls
    const orderedVertices = findConnectedPath(pointSet, adjacencyList);

    if (orderedVertices.length >= 3) {
      // Ensure proper winding order (counter-clockwise for positive area)
      const properlyOrdered = ensureProperWindingOrder(orderedVertices);

      // Validate that the polygon is not self-intersecting
      if (!isSelfIntersecting(properlyOrdered)) {
        return properlyOrdered;
      } else {
      }
    } else {
    }

    // If connected path failed or resulted in self-intersection, fall back to geometric sorting
    const geometricResult = sortPointsGeometrically(allPoints);
    return geometricResult;
  };

  // Update room bounds and area when walls change
  const updateRoomDimensions = useCallback(() => {

    // Get the most current walls state
    setWalls(currentWalls => {

      setRooms(prevRooms =>
        prevRooms.map(room => {
          if (room.wallIds && room.wallIds.length > 0) {

            // Get current walls from the current walls state
            const roomWallsData = currentWalls.filter(wall => room.wallIds?.includes(wall.id));

            if (roomWallsData.length === 0) {
              return room;
            }

            const newBounds = calculateRoomBoundsWithWalls(room.wallIds, currentWalls);
            const vertices = getOrderedRoomVerticesWithWalls(room.wallIds, currentWalls);
            const newArea = vertices.length >= 3 ? calculatePolygonArea(vertices) : calculateArea(newBounds.width, newBounds.height);


            return {
              ...room,
              bounds: newBounds,
              vertices: vertices,
              area: newArea
            };
          }
          return room;
        })
      );

      // Return the same walls array (no modification needed)
      return currentWalls;
    });
  }, []); // Remove walls dependency to prevent infinite loop

  // Calculate distance between two points
  const getDistance = (p1: Point, p2: Point): number => {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  };

  // Find closest wall endpoint for snapping
  const findClosestEndpoint = useCallback((pos: Point, excludeWallId?: string): {point: Point, wallId: string, endpoint: 'start' | 'end'} | null => {
    interface ClosestPoint {
      point: Point;
      wallId: string;
      endpoint: 'start' | 'end';
      distance: number;
    }

    let closestPoint: ClosestPoint | undefined;

    for (const wall of walls) {
      if (wall.id === excludeWallId) continue;

      const startDist = getDistance(pos, wall.start);
      const endDist = getDistance(pos, wall.end);

      if (startDist < SNAP_THRESHOLD) {
        if (!closestPoint || startDist < closestPoint.distance) {
          closestPoint = {
            point: wall.start,
            wallId: wall.id,
            endpoint: 'start',
            distance: startDist
          };
        }
      }

      if (endDist < SNAP_THRESHOLD) {
        if (!closestPoint || endDist < closestPoint.distance) {
          closestPoint = {
            point: wall.end,
            wallId: wall.id,
            endpoint: 'end',
            distance: endDist
          };
        }
      }
    }

    if (!closestPoint) {
      return null;
    }

    return {
      point: closestPoint.point,
      wallId: closestPoint.wallId,
      endpoint: closestPoint.endpoint
    };
  }, [walls]);

  // Check if a point is near a wall endpoint
  const getEndpointAtPosition = (pos: Point): {wallId: string, endpoint: 'start' | 'end'} | null => {
    for (const wall of walls) {
      if (getDistance(pos, wall.start) <= ENDPOINT_HOVER_RADIUS) {
        return { wallId: wall.id, endpoint: 'start' };
      }
      if (getDistance(pos, wall.end) <= ENDPOINT_HOVER_RADIUS) {
        return { wallId: wall.id, endpoint: 'end' };
      }
    }
    return null;
  };

  // Check if a point is near a room vertex
  const getRoomVertexAtPosition = (pos: Point): {roomId: string, vertexIndex: number, point: Point} | null => {
    for (const room of rooms) {
      if (!room.vertices || room.vertices.length === 0) continue;

      for (let i = 0; i < room.vertices.length; i++) {
        const vertex = room.vertices[i];
        if (getDistance(pos, vertex) <= ENDPOINT_HOVER_RADIUS) {
          return { roomId: room.id, vertexIndex: i, point: vertex };
        }
      }
    }
    return null;
  };

  // Check if a point is on a wall line - returns wall info with click position
  const getWallAtPosition = (pos: Point): { wallId: string; clickPoint: Point } | null => {
    const WALL_CLICK_THRESHOLD = 8;

    for (const wall of walls) {
      // Calculate distance from point to line segment
      const A = pos.x - wall.start.x;
      const B = pos.y - wall.start.y;
      const C = wall.end.x - wall.start.x;
      const D = wall.end.y - wall.start.y;

      const dot = A * C + B * D;
      const lenSq = C * C + D * D;

      if (lenSq === 0) continue; // Wall has zero length

      let param = dot / lenSq;
      let xx, yy;

      if (param < 0) {
        xx = wall.start.x;
        yy = wall.start.y;
      } else if (param > 1) {
        xx = wall.end.x;
        yy = wall.end.y;
      } else {
        xx = wall.start.x + param * C;
        yy = wall.start.y + param * D;
      }

      const dx = pos.x - xx;
      const dy = pos.y - yy;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= WALL_CLICK_THRESHOLD) {
        return {
          wallId: wall.id,
          clickPoint: { x: xx, y: yy } // Return the closest point on the wall
        };
      }
    }
    return null;
  };

  // Legacy function for backward compatibility
  const getWallIdAtPosition = (pos: Point): string | null => {
    const result = getWallAtPosition(pos);
    return result ? result.wallId : null;
  };

  // Check if walls are inside selection rectangle
  const getWallsInSelection = (start: Point, end: Point): string[] => {
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);

    return walls.filter(wall => {
      // Check if both endpoints are within selection rectangle
      const startInside = wall.start.x >= minX && wall.start.x <= maxX &&
                          wall.start.y >= minY && wall.start.y <= maxY;
      const endInside = wall.end.x >= minX && wall.end.x <= maxX &&
                        wall.end.y >= minY && wall.end.y <= maxY;
      return startInside && endInside;
    }).map(wall => wall.id);
  };

  // Check if rooms are inside selection rectangle
  const getRoomsInSelection = (start: Point, end: Point): string[] => {
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);

    return rooms.filter(room => {
      const { x, y, width, height } = room.bounds;
      return x >= minX && y >= minY && (x + width) <= maxX && (y + height) <= maxY;
    }).map(room => room.id);
  };

  // Check if a point is inside a room
  const getRoomAtPosition = (pos: Point): string | null => {

    for (const room of rooms) {
      const { x, y, width, height } = room.bounds;

      const isInside = pos.x >= x && pos.x <= x + width && pos.y >= y && pos.y <= y + height;

      if (isInside) {
        return room.id;
      }
    }
    return null;
  };

  // Get mouse position relative to stage
  const getRelativePointerPosition = (): Point | null => {
    if (!stageRef.current) return null;
    const stage = stageRef.current;
    const pos = stage.getPointerPosition();
    if (!pos) return null;

    const scale = stage.scaleX();
    const stagePos = stage.position();

    return {
      x: (pos.x - stagePos.x) / scale,
      y: (pos.y - stagePos.y) / scale
    };
  };

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedWallIds.length > 0) {
          setWalls(prevWalls => prevWalls.filter(wall => !selectedWallIds.includes(wall.id)));
          setSelectedWallIds([]);
        }
        if (selectedRoomIds.length > 0) {
          // Also delete walls that belong to the selected rooms
          const roomsToDelete = rooms.filter(room => selectedRoomIds.includes(room.id));
          const wallIdsToDelete = roomsToDelete.flatMap(room => room.wallIds || []);

          setWalls(prevWalls => prevWalls.filter(wall => !wallIdsToDelete.includes(wall.id)));
          setRooms(prevRooms => prevRooms.filter(room => !selectedRoomIds.includes(room.id)));
          setSelectedRoomIds([]);
        }
      }

      if (e.key === 'Escape') {
        setSelectedWallIds([]);
        setSelectedRoomIds([]);
        setDragSelection({ isActive: false, start: { x: 0, y: 0 }, current: { x: 0, y: 0 } });
        setIsDragSelecting(false);
        setContextMenu({ visible: false, x: 0, y: 0, roomId: null, wallId: null, type: null });
        if (isDrawingRoom) {
          setIsDrawingRoom(false);
          setCurrentRoom(null);
        }
        if (isDrawing) {
          setIsDrawing(false);
          setCurrentWall(null);
        }
        // Switch to select mode
        setCurrentTool('select');
      }

      if (e.key === 'v' || e.key === 'V') {
        // Cancel any ongoing drawing operations
        if (isDrawingRoom) {
          setIsDrawingRoom(false);
          setCurrentRoom(null);
        }
        if (isDrawing) {
          setIsDrawing(false);
          setCurrentWall(null);
        }
        // Switch to select mode
        setCurrentTool('select');
      }

      if (e.key === 'w' || e.key === 'W') {
        // Cancel any ongoing operations
        if (isDrawingRoom) {
          setIsDrawingRoom(false);
          setCurrentRoom(null);
        }
        setSelectedWallIds([]);
        setSelectedRoomIds([]);
        // Switch to wall mode
        setCurrentTool('wall');
      }

      if (e.key === 'r' || e.key === 'R') {
        // Cancel any ongoing operations
        if (isDrawing) {
          setIsDrawing(false);
          setCurrentWall(null);
        }
        setSelectedWallIds([]);
        setSelectedRoomIds([]);
        // Switch to room mode
        setCurrentTool('room');
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Handle any key up events if needed
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedWallIds, selectedRoomIds, isDrawingRoom, isDrawing, setCurrentTool]);

  // Handle mouse down for selection and dragging
  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const pos = getRelativePointerPosition();
    if (!pos) return;

    // Check for middle mouse button (for panning)
    if (e.evt.button === 1) {
      e.evt.preventDefault();
      setIsPanning(true);
      const stage = stageRef.current;
      if (stage) {
        const rawPos = stage.getPointerPosition();
        if (rawPos) {
          setLastRawPointerPosition(rawPos);
        }
      }
      return;
    }

    const isCtrlPressed = e.evt.ctrlKey || e.evt.metaKey;

    // Close context menu if clicking elsewhere (but only if it's visible)
    if (contextMenu.visible) {
      setContextMenu({ visible: false, x: 0, y: 0, roomId: null, wallId: null, type: null });
    }

    // In select mode, check if clicking on empty space for panning
    if (currentTool === 'select') {
      // Check if clicking on a wall or room
      let clickedOnElement = false;

      // Check if clicking on a wall endpoint
      for (const wall of walls) {
        const startDist = Math.sqrt(Math.pow(pos.x - wall.start.x, 2) + Math.pow(pos.y - wall.start.y, 2));
        const endDist = Math.sqrt(Math.pow(pos.x - wall.end.x, 2) + Math.pow(pos.y - wall.end.y, 2));
        if (startDist <= ENDPOINT_HOVER_RADIUS || endDist <= ENDPOINT_HOVER_RADIUS) {
          clickedOnElement = true;
          break;
        }

        // Check if clicking on the wall line itself
        const distToLine = distanceToLineSegment(pos, wall.start, wall.end);
        if (distToLine <= 5) {
          clickedOnElement = true;
          break;
        }
      }

      // Check if clicking on a room
      if (!clickedOnElement) {
        for (const room of rooms) {
          const { x, y, width, height } = room.bounds;
          if (pos.x >= x && pos.x <= x + width && pos.y >= y && pos.y <= y + height) {
            // Check if actually inside the room polygon if it has vertices
            if (room.vertices && room.vertices.length >= 3) {
              if (pointInPolygon(pos, room.vertices)) {
                clickedOnElement = true;
                break;
              }
            } else {
              clickedOnElement = true;
              break;
            }
          }
        }
      }

      // If not clicking on any element and Ctrl/Shift is pressed, start panning
      if (!clickedOnElement && e.evt.button === 0 && (e.evt.ctrlKey || e.evt.shiftKey)) {
        setIsPanning(true);
        const stage = stageRef.current;
        if (stage) {
          const rawPos = stage.getPointerPosition();
          if (rawPos) {
            setLastRawPointerPosition(rawPos);
          }
        }
        return;
      }
    }

    if (currentTool === 'room') {
      // Start drawing a room
      setIsDrawingRoom(true);
      setCurrentRoom({
        start: pos,
        end: pos
      });
      return;
    }

    if (currentTool === 'select') {
      // Check if clicking on a wall endpoint
      const endpoint = getEndpointAtPosition(pos);
      if (endpoint) {
        setIsDragging(true);
        setDragInfo({
          wallId: endpoint.wallId,
          endpoint: endpoint.endpoint,
          offset: { x: 0, y: 0 }
        });

        // Handle selection with Ctrl key
        if (isCtrlPressed) {
          setSelectedWallIds(prev => {
            if (prev.includes(endpoint.wallId)) {
              return prev.filter(id => id !== endpoint.wallId);
            } else {
              return [...prev, endpoint.wallId];
            }
          });
        } else {
          setSelectedWallIds([endpoint.wallId]);
        }

        e.cancelBubble = true;
        return;
      }

      // Check if clicking on a wall line first (priority over rooms)
      const wallResult = getWallAtPosition(pos);
      const wallId = wallResult ? wallResult.wallId : null;

      // Check if clicking on a room (only if no wall was clicked)
      const roomId = getRoomAtPosition(pos);
      if (wallId) {
        // Handle wall selection with Ctrl key
        if (isCtrlPressed) {
          setSelectedWallIds(prev => {
            if (prev.includes(wallId)) {
              return prev.filter(id => id !== wallId);
            } else {
              return [...prev, wallId];
            }
          });
        } else {
          setSelectedWallIds([wallId]);
        }
        setSelectedRoomIds([]); // Clear room selection when selecting walls

        // Start wall moving if wall is selected
        if (selectedWallIds.includes(wallId) || !isCtrlPressed) {
          const selectedIds = isCtrlPressed ?
            (selectedWallIds.includes(wallId) ? selectedWallIds : [...selectedWallIds, wallId]) :
            [wallId];

          const startPositions: { [wallId: string]: { start: Point; end: Point } } = {};
          selectedIds.forEach(id => {
            const wall = walls.find(w => w.id === id);
            if (wall) {
              startPositions[id] = { start: wall.start, end: wall.end };
            }
          });

          // Calculate offset from the click position to maintain natural dragging
          // wallResult is guaranteed to be non-null here since we're inside the wallResult check
          const clickOffset = {
            x: pos.x - wallResult!.clickPoint.x,
            y: pos.y - wallResult!.clickPoint.y
          };

          setWallDragInfo({
            wallIds: selectedIds,
            startPositions,
            offset: clickOffset,
            clickPosition: wallResult!.clickPoint
          });
          setIsMovingWalls(true);
        }

        e.cancelBubble = true;
        return;
      }

      // Check if clicking on a room (only if no wall was clicked)
      if (roomId) {
        // Handle room selection with Ctrl key
        if (isCtrlPressed) {
          setSelectedRoomIds(prev => {
            if (prev.includes(roomId)) {
              return prev.filter(id => id !== roomId);
            } else {
              return [...prev, roomId];
            }
          });
        } else {
          setSelectedRoomIds([roomId]);
        }
        setSelectedWallIds([]); // Clear wall selection when selecting rooms
        e.cancelBubble = true;
        return;
      }

      // Start drag selection if clicking on empty space
      if (!isCtrlPressed) {
        setSelectedWallIds([]);
        setSelectedRoomIds([]);
      }

      setDragSelection({
        isActive: true,
        start: pos,
        current: pos
      });
      setIsDragSelecting(true);
    }
  }, [currentTool, walls, rooms, selectedWallIds, selectedRoomIds]);

  // Handle mouse up to finish dragging
  const handleMouseUp = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    // Stop panning if middle mouse button was released
    if (isPanning) {
      setIsPanning(false);
      setLastRawPointerPosition(null);
      return;
    }

    const pos = getRelativePointerPosition();
    if (!pos) return;

    const isCtrlPressed = e.evt.ctrlKey || e.evt.metaKey;

    // Handle room drawing
    if (isDrawingRoom && currentRoom) {
      const startX = Math.min(currentRoom.start.x, pos.x);
      const startY = Math.min(currentRoom.start.y, pos.y);
      const width = Math.abs(pos.x - currentRoom.start.x);
      const height = Math.abs(pos.y - currentRoom.start.y);

      // Only create room if it has meaningful size
      if (width > 10 && height > 10) {
        const snappedBounds = {
          x: snapToGrid(startX),
          y: snapToGrid(startY),
          width: snapToGrid(width),
          height: snapToGrid(height)
        };

        const area = calculateArea(snappedBounds.width, snappedBounds.height);
        const roomName = generateRoomName();

        // Create walls for the room boundaries
        const roomId = `room-${Date.now()}`;
        const roomWalls: Wall[] = [
          {
            id: `${roomId}-wall-top`,
            start: { x: snappedBounds.x, y: snappedBounds.y },
            end: { x: snappedBounds.x + snappedBounds.width, y: snappedBounds.y }
          },
          {
            id: `${roomId}-wall-right`,
            start: { x: snappedBounds.x + snappedBounds.width, y: snappedBounds.y },
            end: { x: snappedBounds.x + snappedBounds.width, y: snappedBounds.y + snappedBounds.height }
          },
          {
            id: `${roomId}-wall-bottom`,
            start: { x: snappedBounds.x + snappedBounds.width, y: snappedBounds.y + snappedBounds.height },
            end: { x: snappedBounds.x, y: snappedBounds.y + snappedBounds.height }
          },
          {
            id: `${roomId}-wall-left`,
            start: { x: snappedBounds.x, y: snappedBounds.y + snappedBounds.height },
            end: { x: snappedBounds.x, y: snappedBounds.y }
          }
        ];


        // Add walls to the walls array
        setWalls(prev => {
          const newWalls = [...prev, ...roomWalls];
          return newWalls;
        });

        // Create vertices for the room polygon
        const roomVertices: Point[] = [
          { x: snappedBounds.x, y: snappedBounds.y },
          { x: snappedBounds.x + snappedBounds.width, y: snappedBounds.y },
          { x: snappedBounds.x + snappedBounds.width, y: snappedBounds.y + snappedBounds.height },
          { x: snappedBounds.x, y: snappedBounds.y + snappedBounds.height }
        ];

        const newRoom: Room = {
          id: roomId,
          bounds: snappedBounds,
          name: roomName,
          height: 8, // Default 8 feet
          area,
          wallIds: roomWalls.map(w => w.id), // Track which walls belong to this room
          vertices: roomVertices // Store the vertices for polygon rendering
        };

        setRooms(prev => [...prev, newRoom]);
        setRoomCounter(prev => prev + 1);
      }

      setIsDrawingRoom(false);
      setCurrentRoom(null);
      return;
    }

    // Handle endpoint dragging
    if (isDragging && dragInfo) {
      // Check for snap point
      const snapPoint = findClosestEndpoint(pos, dragInfo.wallId);
      const finalPos = snapPoint ? snapPoint.point : {
        x: snapToGrid(pos.x),
        y: snapToGrid(pos.y)
      };

      // Update the wall endpoint
      setWalls(prevWalls => prevWalls.map(wall => {
        if (wall.id === dragInfo.wallId) {
          return {
            ...wall,
            [dragInfo.endpoint]: finalPos
          };
        }
        return wall;
      }));

      setIsDragging(false);

      // Update wall length input if editing the dragged wall
      if (editingWallId === dragInfo.wallId) {
        const updatedWall = walls.find(w => w.id === dragInfo.wallId);
        if (updatedWall) {
          const tempWall = {
            ...updatedWall,
            [dragInfo.endpoint]: finalPos
          };
          const newLengthPixels = calculateWallLength(tempWall);
          const { feet, inches } = pixelsToFeetInches(newLengthPixels);
          setWallLengthInput({ feet, inches });
        }
      }

      // Update room dimensions immediately after wall endpoint change
      updateRoomDimensions();
      setDragInfo(null);
      setSnapIndicator(null);
    }

    // Handle wall moving
    if (isMovingWalls && wallDragInfo) {
      setIsMovingWalls(false);

      // Update room dimensions immediately after wall movement
      updateRoomDimensions();
      setWallDragInfo(null);
    }

    // Handle room moving
    if (isMovingRooms && roomDragInfo) {
      setIsMovingRooms(false);

      // Update room dimensions after room movement
      updateRoomDimensions();
      setRoomDragInfo(null);
    }

    // Handle drag selection
    if (isDragSelecting) {
      const selectedWalls = getWallsInSelection(dragSelection.start, dragSelection.current);
      const selectedRooms = getRoomsInSelection(dragSelection.start, dragSelection.current);

      if (isCtrlPressed) {
        // Add to existing selection
        setSelectedWallIds(prev => {
          const newSelection = [...prev];
          selectedWalls.forEach(wallId => {
            if (!newSelection.includes(wallId)) {
              newSelection.push(wallId);
            }
          });
          return newSelection;
        });
        setSelectedRoomIds(prev => {
          const newSelection = [...prev];
          selectedRooms.forEach(roomId => {
            if (!newSelection.includes(roomId)) {
              newSelection.push(roomId);
            }
          });
          return newSelection;
        });
      } else {
        // Replace selection
        setSelectedWallIds(selectedWalls);
        setSelectedRoomIds(selectedRooms);
      }

      setDragSelection({ isActive: false, start: { x: 0, y: 0 }, current: { x: 0, y: 0 } });
      setIsDragSelecting(false);
    }
  }, [isDragging, dragInfo, walls, findClosestEndpoint, isMovingWalls, wallDragInfo, isDragSelecting, dragSelection, isDrawingRoom, currentRoom, roomCounter]);

  // Find room that contains a wall endpoint
  const findRoomWithWallEndpoint = useCallback((point: Point): string | null => {
    for (const room of rooms) {
      if (!room.wallIds) continue;

      const roomWalls = walls.filter(w => room.wallIds!.includes(w.id));
      for (const wall of roomWalls) {
        if ((wall.start.x === point.x && wall.start.y === point.y) ||
            (wall.end.x === point.x && wall.end.y === point.y)) {
          return room.id;
        }
      }
    }
    return null;
  }, [rooms, walls]);

  // Find room that contains a vertex
  const findRoomByVertex = useCallback((point: Point): string | null => {
    for (const room of rooms) {
      if (!room.vertices) continue;

      for (const vertex of room.vertices) {
        if (vertex.x === point.x && vertex.y === point.y) {
          return room.id;
        }
      }
    }
    return null;
  }, [rooms]);

  // Handle stage click for drawing
  const handleStageClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (currentTool !== 'wall') return;

    const pos = getRelativePointerPosition();
    if (!pos) return;


    // Check for snap points (walls or room vertices)
    let snappedPos: Point;
    let connectedRoomId: string | null = null;

    // First check for wall endpoints at the clicked position (prioritize exact positions)
    const endpointAtPosition = getEndpointAtPosition(pos);

    if (endpointAtPosition) {
      const wall = walls.find(w => w.id === endpointAtPosition.wallId);
      if (wall) {
        snappedPos = endpointAtPosition.endpoint === 'start' ? wall.start : wall.end;
        connectedRoomId = findRoomWithWallEndpoint(snappedPos);
      } else {
        snappedPos = { x: snapToGrid(pos.x), y: snapToGrid(pos.y) };
      }
    } else {
      // Check for room vertices at the clicked position
      let roomVertex = getRoomVertexAtPosition(pos);

      // If no exact room vertex found, but we have a hovered room vertex, use it if it's close enough
      if (!roomVertex && hoveredRoomVertex) {
        const room = rooms.find(r => r.id === hoveredRoomVertex.roomId);
        if (room && room.vertices && room.vertices[hoveredRoomVertex.vertexIndex]) {
          const vertex = room.vertices[hoveredRoomVertex.vertexIndex];
          // Check if the mouse is still close to this vertex
          if (getDistance(pos, vertex) <= ENDPOINT_HOVER_RADIUS) {
            roomVertex = {
              roomId: hoveredRoomVertex.roomId,
              vertexIndex: hoveredRoomVertex.vertexIndex,
              point: vertex
            };
          }
        }
      }

      if (roomVertex) {
        snappedPos = roomVertex.point;
        connectedRoomId = roomVertex.roomId;
      } else {
        // Check for nearby wall endpoints using findClosestEndpoint (for broader search)
        const snapPoint = findClosestEndpoint(pos);
        if (snapPoint) {
          snappedPos = snapPoint.point;
          connectedRoomId = findRoomWithWallEndpoint(snapPoint.point);
        } else {
          // Default to grid snap
          snappedPos = {
            x: snapToGrid(pos.x),
            y: snapToGrid(pos.y)
          };
        }
      }
    }

    if (!isDrawing) {
      // Start drawing a new wall
      setIsDrawing(true);
      setCurrentWall({
        start: snappedPos,
        end: snappedPos
      });
    } else {
      // Finish drawing the wall
      if (currentWall) {
        const newWall: Wall = {
          id: `wall-${Date.now()}`,
          start: currentWall.start,
          end: snappedPos
        };
        setWalls([...walls, newWall]);

        // Check if this wall connects to an existing room
        const startRoom = findRoomWithWallEndpoint(currentWall.start) || findRoomByVertex(currentWall.start);
        const endRoom = findRoomWithWallEndpoint(snappedPos) || connectedRoomId || findRoomByVertex(snappedPos);

        if (startRoom || endRoom) {

          // Add the new wall to the connected room(s), avoiding duplicates
          setRooms(prevRooms => prevRooms.map(room => {
            if (room.id === startRoom || room.id === endRoom) {
              const existingWallIds = room.wallIds || [];
              if (!existingWallIds.includes(newWall.id)) {
                return {
                  ...room,
                  wallIds: [...existingWallIds, newWall.id]
                };
              }
            }
            return room;
          }));

          // Update room dimensions after adding wall - use multiple strategies
          setTimeout(() => {
            updateRoomDimensions();
          }, 10);

          // Also trigger immediate update
          setTimeout(() => updateRoomDimensions(), 100);
        } else {
        }
      }
      setIsDrawing(false);
      setCurrentWall(null);
    }

    // Call the original handler if provided
    onStageClick(e);
  }, [currentTool, isDrawing, currentWall, walls, gridSize, onStageClick, findClosestEndpoint, findRoomWithWallEndpoint, findRoomByVertex, updateRoomDimensions]);

  // Handle right-click context menu
  const handleContextMenu = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    const pos = getRelativePointerPosition();

    if (!pos) return;

    const stage = stageRef.current;
    if (!stage) return;

    const containerRect = stage.container().getBoundingClientRect();
    const menuPosition = {
      x: e.evt.clientX - containerRect.left,
      y: e.evt.clientY - containerRect.top
    };

    // Check for wall first
    const wallResult = getWallAtPosition(pos);
    if (wallResult) {
      setContextMenu({
        visible: true,
        x: menuPosition.x,
        y: menuPosition.y,
        roomId: null,
        wallId: wallResult.wallId,
        type: 'wall'
      });
      return;
    }

    // Check for room
    const roomId = getRoomAtPosition(pos);

    if (roomId) {

      setContextMenu({
        visible: true,
        x: menuPosition.x,
        y: menuPosition.y,
        roomId,
        wallId: null,
        type: 'room'
      });
    } else {
      setContextMenu({ visible: false, x: 0, y: 0, roomId: null, wallId: null, type: null });
    }
  }, [rooms]);

  // Handle room property editing
  const handleEditRoom = (roomId: string) => {
    const room = rooms.find(r => r.id === roomId);
    if (room) {
      // Set the form fields with current room values
      roomEditForm.setFieldsValue({
        name: room.name,
        height: room.height
      });

      setRoomEditModal({
        visible: true,
        roomId
      });
    }
    setContextMenu({ visible: false, x: 0, y: 0, roomId: null, wallId: null, type: null });
  };

  // Handle room property save
  const handleSaveRoomProperties = (values: { name: string; height: number }) => {
    if (roomEditModal.roomId) {
      // Only update if values are valid
      if (values.name && values.name.trim() !== '') {
        setRooms(prev => prev.map(room => {
          if (room.id === roomEditModal.roomId) {
            return {
              ...room,
              name: values.name.trim(),
              height: values.height
            };
          }
          return room;
        }));
      }
    }

    // Reset form and close modal
    roomEditForm.resetFields();
    setRoomEditModal({ visible: false, roomId: null });
  };

  // Handle mouse move for preview and dragging
  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const pos = getRelativePointerPosition();
    if (!pos) return;

    setMousePos(pos);

    // Handle panning with middle mouse button or left click in select mode
    if (isPanning && lastRawPointerPosition) {
      const stage = stageRef.current;
      if (!stage) return;

      const currentRawPos = stage.getPointerPosition();
      if (!currentRawPos) return;

      const dx = currentRawPos.x - lastRawPointerPosition.x;
      const dy = currentRawPos.y - lastRawPointerPosition.y;

      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setLastRawPointerPosition(currentRawPos);
      return;
    }

    // Handle dragging wall endpoint
    if (isDragging && dragInfo) {
      // Check for snap points
      const snapPoint = findClosestEndpoint(pos, dragInfo.wallId);

      if (snapPoint) {
        setSnapIndicator(snapPoint.point);
        // Update wall preview position to snap point
        setWalls(prevWalls => prevWalls.map(wall => {
          if (wall.id === dragInfo.wallId) {
            return {
              ...wall,
              [dragInfo.endpoint]: snapPoint.point
            };
          }
          return wall;
        }));
      } else {
        setSnapIndicator(null);
        const snappedPos = {
          x: snapToGrid(pos.x),
          y: snapToGrid(pos.y)
        };
        // Update wall preview position
        setWalls(prevWalls => prevWalls.map(wall => {
          if (wall.id === dragInfo.wallId) {
            return {
              ...wall,
              [dragInfo.endpoint]: snappedPos
            };
          }
          return wall;
        }));
      }

      // Update wall length input in real-time if editing the dragged wall
      if (editingWallId === dragInfo.wallId) {
        const updatedWall = walls.find(w => w.id === dragInfo.wallId);
        if (updatedWall) {
          const newEndpoint = snapPoint ? snapPoint.point : {
            x: snapToGrid(pos.x),
            y: snapToGrid(pos.y)
          };
          const tempWall = {
            ...updatedWall,
            [dragInfo.endpoint]: newEndpoint
          };
          const newLengthPixels = calculateWallLength(tempWall);
          const { feet, inches } = pixelsToFeetInches(newLengthPixels);
          setWallLengthInput({ feet, inches });
        }
      }

      // Update room dimensions in real-time during dragging
      updateRoomDimensions();
    }
    // Handle moving multiple walls
    else if (isMovingWalls && wallDragInfo) {
      // Calculate movement delta from the click position, accounting for the click offset
      const targetPosition = {
        x: pos.x - wallDragInfo.offset.x,
        y: pos.y - wallDragInfo.offset.y
      };

      // Use click position as reference point for movement
      const referencePoint = wallDragInfo.clickPosition || wallDragInfo.startPositions[wallDragInfo.wallIds[0]].start;
      const dx = targetPosition.x - referencePoint.x;
      const dy = targetPosition.y - referencePoint.y;

      // Update all selected walls
      setWalls(prevWalls => prevWalls.map(wall => {
        if (wallDragInfo.wallIds.includes(wall.id)) {
          const originalWall = wallDragInfo.startPositions[wall.id];
          const snappedStart = {
            x: snapToGrid(originalWall.start.x + dx),
            y: snapToGrid(originalWall.start.y + dy)
          };
          const snappedEnd = {
            x: snapToGrid(originalWall.end.x + dx),
            y: snapToGrid(originalWall.end.y + dy)
          };

          return {
            ...wall,
            start: snappedStart,
            end: snappedEnd
          };
        }
        return wall;
      }));
      // Update room dimensions in real-time during wall movement
      updateRoomDimensions();
    }
    // Handle room movement
    else if (isMovingRooms && roomDragInfo) {
      const dx = pos.x - roomDragInfo.offset.x - roomDragInfo.startPositions[roomDragInfo.roomIds[0]].x;
      const dy = pos.y - roomDragInfo.offset.y - roomDragInfo.startPositions[roomDragInfo.roomIds[0]].y;

      // Move rooms - update bounds
      setRooms(prevRooms => prevRooms.map(room => {
        if (roomDragInfo.roomIds.includes(room.id)) {
          const originalPos = roomDragInfo.startPositions[room.id];
          return {
            ...room,
            bounds: {
              ...room.bounds,
              x: snapToGrid(originalPos.x + dx),
              y: snapToGrid(originalPos.y + dy)
            }
          };
        }
        return room;
      }));

      // Move walls that belong to the rooms
      setWalls(prevWalls => prevWalls.map(wall => {
        const movingRoom = roomDragInfo.roomIds.find(roomId => {
          const room = rooms.find(r => r.id === roomId);
          return room?.wallIds?.includes(wall.id);
        });

        if (movingRoom) {
          const originalWall = roomDragInfo.startPositions[movingRoom].wallPositions[wall.id];
          if (originalWall) {
            return {
              ...wall,
              start: {
                x: snapToGrid(originalWall.start.x + dx),
                y: snapToGrid(originalWall.start.y + dy)
              },
              end: {
                x: snapToGrid(originalWall.end.x + dx),
                y: snapToGrid(originalWall.end.y + dy)
              }
            };
          }
        }
        return wall;
      }));

      // Update room dimensions in real-time
      updateRoomDimensions();
    }
    // Handle drag selection
    else if (isDragSelecting) {
      setDragSelection(prev => ({
        ...prev,
        current: pos
      }));
    }
    // Handle hover states
    else if (currentTool === 'select' && !isDragging && !isMovingWalls) {
      // Check if hovering over an endpoint
      const endpoint = getEndpointAtPosition(pos);
      setHoveredEndpoint(endpoint);
    }
    // Handle wall drawing hover states
    else if (currentTool === 'wall') {
      // Check if hovering over wall endpoints first (this includes room wall endpoints)
      const endpoint = getEndpointAtPosition(pos);
      setHoveredEndpoint(endpoint);

      // Also check if hovering over a room vertex (calculated vertices)
      const roomVertex = getRoomVertexAtPosition(pos);
      setHoveredRoomVertex(roomVertex ? { roomId: roomVertex.roomId, vertexIndex: roomVertex.vertexIndex } : null);
    }
    // Handle room drawing preview
    else if (isDrawingRoom && currentRoom) {
      setCurrentRoom({
        ...currentRoom,
        end: pos
      });
    }
    // Handle wall drawing preview
    else if (isDrawing && currentWall) {
      // Check for snap points while drawing (walls or room vertices)
      let endPos: Point;
      let hasSnapPoint = false;

      // First check for wall endpoints
      const snapPoint = findClosestEndpoint(pos);
      if (snapPoint) {
        endPos = snapPoint.point;
        hasSnapPoint = true;
      } else {
        // Check for room vertices
        const roomVertex = getRoomVertexAtPosition(pos);
        if (roomVertex) {
          endPos = roomVertex.point;
          hasSnapPoint = true;
        } else {
          // Default to grid snap
          endPos = {
            x: snapToGrid(pos.x),
            y: snapToGrid(pos.y)
          };
        }
      }

      setCurrentWall({
        ...currentWall,
        end: endPos
      });

      if (hasSnapPoint) {
        setSnapIndicator(endPos);
      } else {
        setSnapIndicator(null);
      }
    }

    // Call the original handler if provided
    onStageMouseMove(e);
  }, [isDragging, dragInfo, isDrawing, currentWall, currentTool, gridSize, walls, onStageMouseMove, findClosestEndpoint, isMovingWalls, wallDragInfo, isDragSelecting, isDrawingRoom, currentRoom, isMovingRooms, roomDragInfo, rooms, isPanning, lastRawPointerPosition]);

  // Update room dimensions when walls change
  useEffect(() => {
    updateRoomDimensions();
  }, [walls.length, updateRoomDimensions]); // Use walls.length instead of walls array to prevent deep comparison issues

  // Handle keyboard events for zoom and pan
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Track pan mode activation (Ctrl or Shift)
      if ((e.key === 'Control' || e.key === 'Shift') && currentTool === 'select') {
        setIsPanModeActive(true);
      }

      // Zoom with + and - keys
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoom(prevZoom => Math.min(prevZoom * 1.2, 3)); // Max zoom 3x
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoom(prevZoom => Math.max(prevZoom * 0.8, 0.3)); // Min zoom 0.3x
      } else if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        // Reset zoom and pan
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
      // Pan with arrow keys
      else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setPan(prev => ({ ...prev, y: prev.y + 20 }));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setPan(prev => ({ ...prev, y: prev.y - 20 }));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPan(prev => ({ ...prev, x: prev.x + 20 }));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPan(prev => ({ ...prev, x: prev.x - 20 }));
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Track pan mode deactivation
      if ((e.key === 'Control' || e.key === 'Shift')) {
        setIsPanModeActive(false);
        // If currently panning, stop panning when key is released
        if (isPanning) {
          setIsPanning(false);
          setLastRawPointerPosition(null);
        }
      }
    };

    const handleWindowBlur = () => {
      // Reset pan mode when window loses focus (handles cases where keyup is missed)
      setIsPanModeActive(false);
      if (isPanning) {
        setIsPanning(false);
        setLastRawPointerPosition(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [currentTool, isPanning]);

  // Handle wheel events for zoom
  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();

    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = zoom;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - pan.x) / oldScale,
      y: (pointer.y - pan.y) / oldScale,
    };

    const scaleBy = 1.05;
    const newScale = e.evt.deltaY > 0
      ? Math.max(oldScale * (1 / scaleBy), 0.3)  // Zoom out (min 0.3x)
      : Math.min(oldScale * scaleBy, 3);  // Zoom in (max 3x)

    setZoom(newScale);

    // Adjust pan to keep the point under the mouse cursor stationary
    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };
    setPan(newPos);
  }, [zoom, pan, stageRef]);

  // Grid lines with extended area for zoom and pan
  const gridLines = [];
  if (showGrid) {
    // Calculate visible area in stage coordinates considering zoom and pan
    const visibleArea = {
      x: -pan.x / zoom,
      y: -pan.y / zoom,
      width: actualSize.width / zoom,
      height: actualSize.height / zoom
    };

    // Add padding to draw grid beyond visible area (for smooth panning)
    const padding = 500; // Extra grid area in pixels
    const gridStartX = Math.floor((visibleArea.x - padding) / gridSize) * gridSize;
    const gridEndX = Math.ceil((visibleArea.x + visibleArea.width + padding) / gridSize) * gridSize;
    const gridStartY = Math.floor((visibleArea.y - padding) / gridSize) * gridSize;
    const gridEndY = Math.ceil((visibleArea.y + visibleArea.height + padding) / gridSize) * gridSize;

    // Extend grid area significantly (3x the viewport size)
    const extendedWidth = actualSize.width * 3;
    const extendedHeight = actualSize.height * 3;
    const offsetX = -actualSize.width;
    const offsetY = -actualSize.height;

    // Vertical lines
    for (let x = gridStartX; x <= gridEndX; x += gridSize) {
      gridLines.push(
        <Line
          key={`v-${x}`}
          points={[x, gridStartY, x, gridEndY]}
          stroke="#e0e0e0"
          strokeWidth={1}
          listening={false}
        />
      );
    }

    // Horizontal lines
    for (let y = gridStartY; y <= gridEndY; y += gridSize) {
      gridLines.push(
        <Line
          key={`h-${y}`}
          points={[gridStartX, y, gridEndX, y]}
          stroke="#e0e0e0"
          strokeWidth={1}
          listening={false}
        />
      );
    }
  }

  return (
    <div
      ref={containerRef}
      style={{
        border: '1px solid #d9d9d9',
        backgroundColor: '#fff',
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '300px', // Ensure minimum height
        margin: 0,
        padding: 0,
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'block' // Change from flex to block
      }}>
      {/* Zoom indicator */}
      <div style={{ position: 'absolute', bottom: 10, right: 10, zIndex: 10, background: 'white', padding: '5px 10px', borderRadius: '4px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <span style={{ fontSize: '12px', color: '#666' }}>
          Zoom: {Math.round(zoom * 100)}%
        </span>
      </div>


      {/* Mouse position indicator */}
      <div style={{ position: 'absolute', bottom: 10, left: 10, zIndex: 5, background: 'white', padding: '5px', borderRadius: '4px', fontSize: '12px' }}>
        Position: ({Math.round(mousePos.x)}, {Math.round(mousePos.y)}) | Grid: ({Math.round(mousePos.x / gridSize)}, {Math.round(mousePos.y / gridSize)})
        {isDragging && ' | Dragging endpoint'}
        {isMovingWalls && ' | Moving walls'}
        {isMovingRooms && ' | Moving rooms'}
        {isDragSelecting && ' | Selecting'}
        {isDrawingRoom && ' | Drawing room'}
        {snapIndicator && ' | Snapping'}
        {selectedWallIds.length > 0 && ` | Walls: ${selectedWallIds.length}`}
        {selectedRoomIds.length > 0 && ` | Rooms: ${selectedRoomIds.length}`}
      </div>

      {/* Selection info - Removed */}

      <Stage
        ref={stageRef}
        width={actualSize.width}
        height={Math.max(actualSize.height, 300)} // Ensure minimum height for Stage
        scaleX={zoom}
        scaleY={zoom}
        x={pan.x}
        y={pan.y}
        onClick={handleStageClick}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onContextMenu={handleContextMenu}
        onWheel={handleWheel}
        tabIndex={0}
        style={{
          cursor: isPanning ? 'grabbing' :
                  currentTool === 'wall' ? 'crosshair' :
                  currentTool === 'room' ? 'crosshair' :
                  (hoveredEndpoint || isDragging || isMovingWalls || isMovingRooms) ? 'move' :
                  (isDragSelecting || isDrawingRoom) ? 'crosshair' :
                  (currentTool === 'select' && isPanModeActive) ? 'grab' :
                  currentTool === 'select' ? 'default' : 'default',
          outline: 'none'
        }}
      >
        {/* Grid Layer */}
        <Layer>
          {gridLines}
        </Layer>

        {/* Rooms Layer (for room info display) */}
        <Layer>
          {/* Draw room information overlay */}
          {rooms.map((room) => {
            const { x, y, width, height } = room.bounds;
            const isSelected = selectedRoomIds.includes(room.id);

            // Calculate center point for text positioning
            let centerX = x + width / 2;
            let centerY = y + height / 2;

            // If room has vertices, calculate the actual centroid
            if (room.vertices && room.vertices.length >= 3) {
              const sumX = room.vertices.reduce((sum, v) => sum + v.x, 0);
              const sumY = room.vertices.reduce((sum, v) => sum + v.y, 0);
              centerX = sumX / room.vertices.length;
              centerY = sumY / room.vertices.length;
            }

            return (
              <React.Fragment key={room.id}>
                {/* Semi-transparent room area overlay - polygon or rectangle based on vertices */}
                {room.vertices && room.vertices.length >= 3 ? (
                  <Shape
                    sceneFunc={(context, shape) => {
                      context.beginPath();
                      context.moveTo(room.vertices![0].x, room.vertices![0].y);
                      for (let i = 1; i < room.vertices!.length; i++) {
                        context.lineTo(room.vertices![i].x, room.vertices![i].y);
                      }
                      context.closePath();
                      context.fillStrokeShape(shape);
                    }}
                    fill={isSelected ? 'rgba(24, 144, 255, 0.1)' : 'rgba(135, 206, 250, 0.15)'}
                    stroke={isSelected ? 'rgba(24, 144, 255, 0.3)' : 'transparent'}
                    strokeWidth={1}
                  />
                ) : (
                  <Rect
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    fill={isSelected ? 'rgba(24, 144, 255, 0.1)' : 'rgba(135, 206, 250, 0.15)'}
                    stroke={isSelected ? 'rgba(24, 144, 255, 0.3)' : 'transparent'}
                    strokeWidth={1}
                  />
                )}
                {/* Room name - clickable for dragging */}
                <Text
                  x={centerX - 100}
                  y={centerY - 20}
                  text={room.name || 'Room'}
                  fontSize={16}
                  fill={isSelected ? '#1890ff' : '#333'}
                  fontStyle="bold"
                  align="center"
                  width={200}
                  listening={true}
                  onMouseDown={(e) => {
                    e.cancelBubble = true;

                    // Select this room
                    setSelectedRoomIds([room.id]);
                    setSelectedWallIds([]);

                    // Start room dragging
                    const pos = getRelativePointerPosition();
                    if (pos) {
                      // Store initial positions of room and its walls
                      const roomWalls = walls.filter(w => room.wallIds?.includes(w.id));
                      const wallStartPositions: { [wallId: string]: { start: Point; end: Point } } = {};
                      roomWalls.forEach(wall => {
                        wallStartPositions[wall.id] = {
                          start: { ...wall.start },
                          end: { ...wall.end }
                        };
                      });

                      setRoomDragInfo({
                        roomIds: [room.id],
                        startPositions: {
                          [room.id]: {
                            x,  // Use the calculated x from bounds
                            y,  // Use the calculated y from bounds
                            width,
                            height,
                            wallPositions: wallStartPositions
                          }
                        },
                        offset: {
                          x: pos.x - x,  // Use calculated x from bounds
                          y: pos.y - y   // Use calculated y from bounds
                        }
                      });
                      setIsMovingRooms(true);
                    }
                  }}
                  onMouseEnter={(e) => {
                    const container = e.target.getStage()?.container();
                    if (container) {
                      container.style.cursor = 'move';
                    }
                  }}
                  onMouseLeave={(e) => {
                    const container = e.target.getStage()?.container();
                    if (container && !isMovingRooms) {
                      container.style.cursor = currentTool === 'select' ? 'default' : 'crosshair';
                    }
                  }}
                />
                {/* Room area */}
                <Text
                  x={centerX - 100}
                  y={centerY - 2}
                  text={`${room.area} sq ft`}
                  fontSize={14}
                  fill={isSelected ? '#1890ff' : '#666'}
                  align="center"
                  width={200}
                  listening={false}
                />
                {/* Room height */}
                <Text
                  x={centerX - 100}
                  y={centerY + 16}
                  text={`Height: ${room.height || 8}'`}
                  fontSize={12}
                  fill={isSelected ? '#1890ff' : '#999'}
                  align="center"
                  width={200}
                  listening={false}
                />
              </React.Fragment>
            );
          })}

          {/* Draw room vertices when in wall drawing mode */}
          {currentTool === 'wall' && rooms.map((room) => {
            if (!room.vertices || room.vertices.length === 0) return null;

            return room.vertices.map((vertex, index) => {
              const isHovered = hoveredRoomVertex?.roomId === room.id && hoveredRoomVertex?.vertexIndex === index;

              return (
                <Circle
                  key={`${room.id}-vertex-${index}`}
                  x={vertex.x}
                  y={vertex.y}
                  radius={isHovered ? 10 : 8}
                  fill={isHovered ? '#ff4d4f' : '#52c41a'}
                  stroke="#fff"
                  strokeWidth={2}
                  opacity={0.9}
                />
              );
            });
          })}

          {/* Draw current room being drawn */}
          {isDrawingRoom && currentRoom && (
            <>
              <Rect
                x={Math.min(currentRoom.start.x, currentRoom.end.x)}
                y={Math.min(currentRoom.start.y, currentRoom.end.y)}
                width={Math.abs(currentRoom.end.x - currentRoom.start.x)}
                height={Math.abs(currentRoom.end.y - currentRoom.start.y)}
                fill="rgba(24, 144, 255, 0.2)"
                stroke="#1890ff"
                strokeWidth={2}
                dash={[5, 5]}
              />
              {/* Show room dimensions while drawing */}
              <Text
                x={(currentRoom.start.x + currentRoom.end.x) / 2}
                y={(currentRoom.start.y + currentRoom.end.y) / 2}
                text={`${calculateArea(
                  Math.abs(currentRoom.end.x - currentRoom.start.x),
                  Math.abs(currentRoom.end.y - currentRoom.start.y)
                )} sq ft`}
                fontSize={12}
                fill="#1890ff"
                align="center"
              />
            </>
          )}
        </Layer>

        {/* Walls Layer */}
        <Layer>
          {/* Draw existing walls */}
          {walls.map((wall) => {
            // Check if this wall belongs to a selected room
            const belongsToSelectedRoom = rooms.some(room =>
              selectedRoomIds.includes(room.id) && room.wallIds?.includes(wall.id)
            );
            const isWallSelected = selectedWallIds.includes(wall.id);
            const isHighlighted = isWallSelected || belongsToSelectedRoom;

            return (
              <React.Fragment key={wall.id}>
                <Line
                  points={[wall.start.x, wall.start.y, wall.end.x, wall.end.y]}
                  stroke={isHighlighted ? '#1890ff' : '#000'}
                  strokeWidth={isHighlighted ? 5 : 4}
                  lineCap="round"
                  lineJoin="round"
                  opacity={(isDragging && dragInfo?.wallId === wall.id) || (isMovingWalls && wallDragInfo?.wallIds.includes(wall.id)) ? 0.6 : 1}
                  onDblClick={(e) => handleWallDoubleClick(wall.id, e)}
                  style={{ cursor: 'pointer' }}
                />

                {/* Always-visible wall length label */}
                {(() => {
                  const midpoint = getWallMidpoint(wall);
                  const lengthPixels = calculateWallLength(wall);
                  const { feet, inches } = pixelsToFeetInches(lengthPixels);
                  const lengthText = inches > 0 ? `${feet}'${inches}"` : `${feet}'`;

                  // Calculate angle for label rotation
                  const dx = wall.end.x - wall.start.x;
                  const dy = wall.end.y - wall.start.y;
                  const angle = Math.atan2(dy, dx) * 180 / Math.PI;

                  // Normalize angle to prevent upside-down text
                  const normalizedAngle = angle > 90 ? angle - 180 : angle < -90 ? angle + 180 : angle;

                  // Calculate offset position for label (perpendicular to wall)
                  const perpAngle = (angle + 90) * Math.PI / 180;
                  const offset = 15; // Distance from wall
                  const labelX = midpoint.x + Math.cos(perpAngle) * offset;
                  const labelY = midpoint.y + Math.sin(perpAngle) * offset;

                  return (
                    <Text
                      x={labelX}
                      y={labelY}
                      text={lengthText}
                      fontSize={11}
                      fill={isHighlighted ? '#1890ff' : '#333'}
                      fontFamily="Arial, sans-serif"
                      fontStyle={isHighlighted ? 'bold' : 'normal'}
                      align="center"
                      verticalAlign="middle"
                      rotation={normalizedAngle}
                      offsetX={lengthText.length * 3} // Center the text horizontally
                      offsetY={6} // Center the text vertically
                      listening={false} // Don't interfere with wall interactions
                      opacity={0.9}
                    />
                  );
                })()}
              </React.Fragment>
            );
          })}

          {/* Draw current wall being drawn */}
          {isDrawing && currentWall && (
            <>
              {/* Wall preview line */}
              <Line
                points={[
                  currentWall.start.x,
                  currentWall.start.y,
                  currentWall.end.x,
                  currentWall.end.y
                ]}
                stroke="#1890ff"
                strokeWidth={4}
                lineCap="round"
                lineJoin="round"
                dash={[10, 5]}
                opacity={0.8}
              />
              {/* Starting point indicator */}
              <Circle
                x={currentWall.start.x}
                y={currentWall.start.y}
                radius={8}
                fill="#52c41a"
                stroke="#fff"
                strokeWidth={2}
                opacity={1}
              />
              {/* Ending point indicator (follows mouse) */}
              <Circle
                x={currentWall.end.x}
                y={currentWall.end.y}
                radius={6}
                fill="#1890ff"
                stroke="#fff"
                strokeWidth={2}
                opacity={0.7}
              />
              {/* Show wall length */}
              <Text
                x={(currentWall.start.x + currentWall.end.x) / 2}
                y={(currentWall.start.y + currentWall.end.y) / 2 - 15}
                text={`${Math.round(Math.sqrt(
                  Math.pow(currentWall.end.x - currentWall.start.x, 2) +
                  Math.pow(currentWall.end.y - currentWall.start.y, 2)
                ) / 20)}'`}
                fontSize={12}
                fill="#1890ff"
                fontStyle="bold"
                align="center"
              />
            </>
          )}

          {/* Draw wall endpoints */}
          {walls.map((wall) => {
            // Check if this wall belongs to a selected room
            const belongsToSelectedRoom = rooms.some(room =>
              selectedRoomIds.includes(room.id) && room.wallIds?.includes(wall.id)
            );
            const isWallSelected = selectedWallIds.includes(wall.id);
            const isHighlighted = isWallSelected || belongsToSelectedRoom;

            // Check if this wall belongs to any room (for Wall Tool highlighting)
            const belongsToAnyRoom = rooms.some(room => room.wallIds?.includes(wall.id));
            const shouldHighlightInWallTool = currentTool === 'wall' && belongsToAnyRoom;

            return (
              <React.Fragment key={`${wall.id}-points`}>
                <Circle
                  x={wall.start.x}
                  y={wall.start.y}
                  radius={
                    hoveredEndpoint?.wallId === wall.id && hoveredEndpoint?.endpoint === 'start' ? 6 :
                    isHighlighted ? 5 :
                    shouldHighlightInWallTool ? 5 : 4
                  }
                  fill={
                    hoveredEndpoint?.wallId === wall.id && hoveredEndpoint?.endpoint === 'start' ? '#ff4d4f' :
                    isHighlighted ? '#1890ff' :
                    shouldHighlightInWallTool ? '#52c41a' : '#666'
                  }
                  stroke="#fff"
                  strokeWidth={2}
                  opacity={shouldHighlightInWallTool ? 0.8 : 1}
                />
                <Circle
                  x={wall.end.x}
                  y={wall.end.y}
                  radius={
                    hoveredEndpoint?.wallId === wall.id && hoveredEndpoint?.endpoint === 'end' ? 6 :
                    isHighlighted ? 5 :
                    shouldHighlightInWallTool ? 5 : 4
                  }
                  fill={
                    hoveredEndpoint?.wallId === wall.id && hoveredEndpoint?.endpoint === 'end' ? '#ff4d4f' :
                    isHighlighted ? '#1890ff' :
                    shouldHighlightInWallTool ? '#52c41a' : '#666'
                  }
                  stroke="#fff"
                  strokeWidth={2}
                  opacity={shouldHighlightInWallTool ? 0.8 : 1}
                />
              </React.Fragment>
            );
          })}

          {/* Draw drag selection rectangle */}
          {isDragSelecting && dragSelection.isActive && (
            <Rect
              x={Math.min(dragSelection.start.x, dragSelection.current.x)}
              y={Math.min(dragSelection.start.y, dragSelection.current.y)}
              width={Math.abs(dragSelection.current.x - dragSelection.start.x)}
              height={Math.abs(dragSelection.current.y - dragSelection.start.y)}
              fill="rgba(24, 144, 255, 0.1)"
              stroke="#1890ff"
              strokeWidth={1}
              dash={[5, 5]}
            />
          )}

          {/* Draw snap indicator */}
          {snapIndicator && (
            <>
              <Circle
                x={snapIndicator.x}
                y={snapIndicator.y}
                radius={10}
                stroke="#52c41a"
                strokeWidth={2}
                fill="transparent"
              />
              <Circle
                x={snapIndicator.x}
                y={snapIndicator.y}
                radius={3}
                fill="#52c41a"
              />
            </>
          )}
        </Layer>
      </Stage>

      {/* Context Menu */}
      {contextMenu.visible && (
        <div
          style={{
            position: 'absolute',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 200,
            backgroundColor: 'white',
            border: '1px solid #d9d9d9',
            borderRadius: '4px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            padding: '4px 0',
            minWidth: '150px',
            pointerEvents: 'auto'
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {contextMenu.type === 'room' && contextMenu.roomId && (
            <div
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
              onClick={() => {
                if (contextMenu.roomId) {
                  handleEditRoom(contextMenu.roomId);
                }
              }}
            >
              Edit Room Properties
            </div>
          )}

          {contextMenu.type === 'wall' && contextMenu.wallId && (
            <>
              {/* Add wall to room option - only show if wall is not connected to any room AND a room is selected */}
              {(() => {
                const connectedRooms = rooms.filter(room =>
                  room.wallIds?.includes(contextMenu.wallId!)
                );

                // Only show "Add to room" option if wall is not connected and a room is selected
                if (connectedRooms.length === 0 && selectedRoomIds.length > 0) {
                  return (
                    <div
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontSize: '14px'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
                      onClick={() => {
                        // Add wall to selected room
                        setRooms(prevRooms => prevRooms.map(room => {
                          if (selectedRoomIds.includes(room.id)) {
                            return {
                              ...room,
                              wallIds: [...(room.wallIds || []), contextMenu.wallId!]
                            };
                          }
                          return room;
                        }));
                        updateRoomDimensions();
                        setContextMenu({ visible: false, x: 0, y: 0, roomId: null, wallId: null, type: null });
                      }}
                    >
                      {(() => {
                        const selectedRooms = rooms.filter(r => selectedRoomIds.includes(r.id));
                        return `Add to ${selectedRooms.map(r => r.name).join(', ')}`;
                      })()}
                    </div>
                  );
                }
                return null;
              })()}

              <div
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
                onClick={() => {
                  // Delete the wall and automatically remove it from any rooms
                  setWalls(prevWalls => prevWalls.filter(wall => wall.id !== contextMenu.wallId));

                  // Remove wall from any rooms that contain it
                  setRooms(prevRooms => prevRooms.map(room => {
                    if (room.wallIds?.includes(contextMenu.wallId!)) {
                      return {
                        ...room,
                        wallIds: room.wallIds.filter(id => id !== contextMenu.wallId)
                      };
                    }
                    return room;
                  }));

                  updateRoomDimensions();
                  setContextMenu({ visible: false, x: 0, y: 0, roomId: null, wallId: null, type: null });
                }}
              >
                Delete Wall
              </div>
            </>
          )}
        </div>
      )}

      {/* Room Edit Modal */}
      <Modal
        title="Edit Room Properties"
        open={roomEditModal.visible}
        onCancel={() => {
          // Reset form and close modal
          roomEditForm.resetFields();
          setRoomEditModal({ visible: false, roomId: null });
        }}
        footer={null}
      >
        <Form
          form={roomEditForm}
          layout="vertical"
          onFinish={handleSaveRoomProperties}
          preserve={false}
        >
          <Form.Item
            label="Room Name"
            name="name"
            rules={[
              { required: true, message: 'Please enter room name!' },
              { min: 1, message: 'Room name cannot be empty!' },
              { whitespace: true, message: 'Room name cannot be only whitespace!' }
            ]}
          >
            <Input
              placeholder="Enter room name"
              autoComplete="off"
            />
          </Form.Item>

          <Form.Item
            label="Height (feet)"
            name="height"
            rules={[{ required: true, message: 'Please enter room height!' }]}
          >
            <InputNumber
              min={1}
              max={50}
              step={0.5}
              placeholder="Enter height in feet"
              style={{ width: '100%' }}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Button
              style={{ marginRight: 8 }}
              onClick={() => {
                // Reset form and close modal
                roomEditForm.resetFields();
                setRoomEditModal({ visible: false, roomId: null });
              }}
            >
              Cancel
            </Button>
            <Button type="primary" htmlType="submit">
              Save
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      {/* Wall Length Edit Input */}
      {editingWallId && wallEditPosition && (
        <div
          style={{
            position: 'absolute',
            left: wallEditPosition.x - 60, // Center the input
            top: wallEditPosition.y,
            zIndex: 1000,
            background: 'white',
            border: '2px solid #1890ff',
            borderRadius: '4px',
            padding: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <InputNumber
            size="small"
            min={0}
            max={99}
            value={wallLengthInput.feet}
            onChange={(value) => {
              // Only update if value is valid, otherwise keep current value
              if (value !== null && value !== undefined && value >= 0) {
                setWallLengthInput(prev => ({ ...prev, feet: value }));
              }
            }}
            onPressEnter={(e) => {
              console.log('Feet input enter pressed');
              updateWallLength(editingWallId, wallLengthInput.feet, wallLengthInput.inches);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                console.log('Feet input enter key detected');
                updateWallLength(editingWallId, wallLengthInput.feet, wallLengthInput.inches);
              }
              if (e.key === 'Escape') {
                cancelWallEdit();
              }
            }}
            style={{ width: '50px' }}
            autoFocus
          />
          <span style={{ fontSize: '12px', color: '#666' }}>′</span>

          <InputNumber
            size="small"
            min={0}
            max={11}
            value={wallLengthInput.inches}
            onChange={(value) => {
              // Only update if value is valid, otherwise keep current value
              if (value !== null && value !== undefined && value >= 0 && value < 12) {
                setWallLengthInput(prev => ({ ...prev, inches: value }));
              }
            }}
            onPressEnter={(e) => {
              console.log('Inches input enter pressed');
              updateWallLength(editingWallId, wallLengthInput.feet, wallLengthInput.inches);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                console.log('Inches input enter key detected');
                updateWallLength(editingWallId, wallLengthInput.feet, wallLengthInput.inches);
              }
              if (e.key === 'Escape') {
                cancelWallEdit();
              }
            }}
            style={{ width: '50px' }}
          />
          <span style={{ fontSize: '12px', color: '#666' }}>″</span>

          <Button
            type="primary"
            size="small"
            onClick={() => {
              console.log('Confirm button clicked');
              updateWallLength(editingWallId, wallLengthInput.feet, wallLengthInput.inches);
            }}
            style={{ marginLeft: '4px' }}
          >
            ✓
          </Button>
          <Button
            size="small"
            onClick={cancelWallEdit}
            style={{ marginLeft: '2px' }}
          >
            ✕
          </Button>
        </div>
      )}
    </div>
  );
};

export default SketchViewport;