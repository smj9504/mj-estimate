import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Stage, Layer, Rect, Line, Circle, Text, Shape } from 'react-konva';
import { Modal, Input, InputNumber, Form, Button } from 'antd';
import Konva from 'konva';
import { useSketchContext } from '../context/SketchProvider';
import { FixtureLayer } from '../rendering/FixtureRenderer';
import { Wall as SketchWall, SketchRoom, WallFixture } from '../../../types/sketch';
import { DOOR_VARIANTS, WINDOW_VARIANTS, CABINET_VARIANTS, BATHROOM_VARIANTS } from '../../../constants/fixtures';
import { WallSegmentEditor } from '../ui/WallSegmentEditor';
import { RoomFixtureEditor } from '../ui/RoomFixtureEditor';

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
  vertices?: Point[]; // Vertices of the room polygon (corners) - deprecated, use boundary
  boundary?: Point[]; // Room boundary points for point-in-polygon testing
  holes?: Point[][]; // Interior holes (walls that create interior spaces)
}

interface DragInfo {
  wallId: string;
  endpoint: 'start' | 'end';
  offset: Point;
  connectedEndpoints?: Array<{ wallId: string; endpoint: 'start' | 'end' }>; // Track all connected endpoints
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
      fixturePositions?: { [fixtureId: string]: Point };
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

interface FixtureEditModal {
  visible: boolean;
  fixtureId: string | null;
  isWallFixture: boolean;
}

interface ContextMenu {
  visible: boolean;
  x: number;
  y: number;
  roomId: string | null;
  wallId: string | null;
  fixtureId: string | null;
  type: 'room' | 'wall' | 'fixture' | null;
}

interface SubContextMenu {
  visible: boolean;
  x: number;
  y: number;
  parentId: string; // To identify which menu item opened this submenu
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

// Type converter functions
const convertToSketchWalls = (localWalls: Wall[]): SketchWall[] => {
  return localWalls.map(wall => ({
    id: wall.id,
    originalStart: wall.start,
    originalEnd: wall.end,
    start: wall.start,
    end: wall.end,
    thickness: 4, // Default thickness in inches
    height: { feet: 8, inches: 0, totalInches: 96, display: '8\'' }, // Default 8 foot walls
    originalLength: { feet: 0, inches: 0, totalInches: 0, display: '0\'' }, // Calculate if needed
    length: { feet: 0, inches: 0, totalInches: 0, display: '0\'' }, // Calculate if needed
    segments: [], // Empty for now
    type: 'interior' as const,
    fixtures: [],
    roomId: '', // Empty for now
    connectedWalls: [],
    style: {
      strokeColor: '#333333',
      strokeWidth: 3,
      fillColor: '#f0f0f0',
      opacity: 1
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));
};

const convertToSketchRooms = (localRooms: Room[]): SketchRoom[] => {
  return localRooms.map(room => ({
    id: room.id,
    name: room.name,
    type: 'other' as const,
    wallIds: room.wallIds || [],
    boundary: room.vertices || [],
    dimensions: {
      width: room.bounds.width / 20, // Convert pixels to feet (20 pixels = 1 foot)
      height: room.bounds.height / 20
    },
    areas: {
      floorArea: room.area,
      ceilingArea: room.area,
      wallArea: 0,
      netWallArea: 0,
      volume: room.area * room.height,
      perimeter: 0
    },
    properties: {},
    style: {
      fillColor: '#e6f3ff',
      strokeColor: '#0066cc',
      strokeWidth: 1,
      opacity: 0.3
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));
};

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
  const {
    sketch,
    updateSketch,
    currentTool,
    setCurrentTool,
    selectedFixture,
    fixtureDimensions,
    placementMode,
    setFixturePlacement,
    addWallFixture,
    addRoomFixture,
    removeWallFixture,
    removeRoomFixture,
    moveWallFixture,
    changeWallFixtureWall,
    rotateWallFixture,
    moveRoomFixture,
    rotateRoomFixture,
    updateRoomFixtureDimensions,
    updateRoomFixture,
    adjustWallFixtureSegmentLength
  } = useSketchContext();
  const [isDrawing, setIsDrawing] = useState(false);
  const [walls, setWalls] = useState<Wall[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomCounter, setRoomCounter] = useState(0);
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);
  const [selectedFixtureIds, setSelectedFixtureIds] = useState<string[]>([]);
  const [isDrawingRoom, setIsDrawingRoom] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<{ start: Point; end: Point } | null>(null);

  // Wall segment editor state
  const [segmentEditorFixtureId, setSegmentEditorFixtureId] = useState<string | null>(null);

  // Room fixture editor state
  const [roomFixtureEditorId, setRoomFixtureEditorId] = useState<string | null>(null);

  // Zoom and Pan states
  const [zoom, setZoom] = useState(initialZoom);
  const [pan, setPan] = useState(initialPan);
  const [isPanning, setIsPanning] = useState(false);
  const [lastRawPointerPosition, setLastRawPointerPosition] = useState<Point | null>(null);
  const [isPanModeActive, setIsPanModeActive] = useState(false);
  const [roomEditModal, setRoomEditModal] = useState<RoomEditModal>({ visible: false, roomId: null });
  const [fixtureEditModal, setFixtureEditModal] = useState<FixtureEditModal>({ visible: false, fixtureId: null, isWallFixture: false });
  const [fixtureEditForm] = Form.useForm();
  const [subContextMenu, setSubContextMenu] = useState<SubContextMenu>({ visible: false, x: 0, y: 0, parentId: '' });

  // Synchronize local walls with sketch state
  const syncWallsToSketch = useCallback((updatedWalls: Wall[], immediate: boolean = false) => {
    if (updateSketch) {
      const sketchWalls = convertToSketchWalls(updatedWalls);

      if (immediate) {
        // Immediate update during drag operations to prevent visual lag
        // Use microtask queue to avoid "Cannot update during render" warning
        Promise.resolve().then(() => {
          updateSketch({ walls: sketchWalls });
        });
      } else {
        // Deferred update for non-drag operations
        requestAnimationFrame(() => {
          updateSketch({ walls: sketchWalls });
        });
      }
    }
  }, [updateSketch]);

  // Custom setWalls that also syncs to sketch
  const setWallsAndSync = useCallback((
    wallsOrUpdater: Wall[] | ((prev: Wall[]) => Wall[]),
    immediate: boolean = false
  ) => {
    setWalls(prevWalls => {
      const newWalls = typeof wallsOrUpdater === 'function' ? wallsOrUpdater(prevWalls) : wallsOrUpdater;
      syncWallsToSketch(newWalls, immediate);
      return newWalls;
    });
  }, [syncWallsToSketch]);

  // Sync walls from sketch state
  useEffect(() => {
    if (sketch?.walls && sketch.walls.length > 0) {
      const localWalls: Wall[] = sketch.walls.map(wall => ({
        id: wall.id,
        start: wall.start,
        end: wall.end
      }));

      // Remove duplicates by ID (keep the last occurrence in case of updates)
      const uniqueWalls = Array.from(
        new Map(localWalls.map(wall => [wall.id, wall])).values()
      );

      // Check if walls have actually changed to avoid unnecessary re-renders
      const wallsChanged = JSON.stringify(uniqueWalls) !== JSON.stringify(walls);
      if (wallsChanged) {
        setWalls(uniqueWalls);
      }
    }
  }, [sketch?.walls]);

  // Migration: Add boundary to existing rooms that don't have it (runs once on mount)
  useEffect(() => {
    setRooms(prevRooms => {
      let needsUpdate = false;
      const updatedRooms = prevRooms.map(room => {
        // If room has vertices but no boundary, migrate it
        if (room.vertices && room.vertices.length > 0 && !room.boundary) {
          needsUpdate = true;
          return {
            ...room,
            boundary: room.vertices
          };
        }
        return room;
      });

      // Note: Context sync removed to prevent infinite loop
      // Migration happens locally only

      return needsUpdate ? updatedRooms : prevRooms;
    });
  }, []); // Empty dependency - run only once on mount

  const [roomEditForm] = Form.useForm(); // Add form instance
  const [contextMenu, setContextMenu] = useState<ContextMenu>({ visible: false, x: 0, y: 0, roomId: null, wallId: null, fixtureId: null, type: null });
  const [currentWall, setCurrentWall] = useState<{ start: Point; end: Point } | null>(null);
  const [mousePos, setMousePos] = useState<Point>({ x: 0, y: 0 });
  const [selectedWallIds, setSelectedWallIds] = useState<string[]>([]);
  const [hoveredEndpoint, setHoveredEndpoint] = useState<{wallId: string; endpoint: 'start' | 'end'} | null>(null);
  const [hoveredRoomVertex, setHoveredRoomVertex] = useState<{roomId: string; vertexIndex: number} | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);
  const [snapIndicator, setSnapIndicator] = useState<Point | null>(null);
  const [splitIndicator, setSplitIndicator] = useState<Point | null>(null); // For showing wall split preview
  const [wallDragInfo, setWallDragInfo] = useState<WallDragInfo | null>(null);
  const [roomDragInfo, setRoomDragInfo] = useState<RoomDragInfo | null>(null);
  const [dragSelection, setDragSelection] = useState<DragSelection>({ isActive: false, start: { x: 0, y: 0 }, current: { x: 0, y: 0 } });
  const [isDraggingFixture, setIsDraggingFixture] = useState(false);
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const [isMovingWalls, setIsMovingWalls] = useState(false);
  const [isMovingRooms, setIsMovingRooms] = useState(false);
  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [actualSize, setActualSize] = useState({ width, height });

  // Wall length editing states
  const [editingWallId, setEditingWallId] = useState<string | null>(null);
  const [wallLengthInput, setWallLengthInput] = useState<{ feet: number; inches: number }>({ feet: 0, inches: 0 });
  const [wallEditPosition, setWallEditPosition] = useState<{ x: number; y: number } | null>(null);

  // Update actual size based on props (SketchCanvas handles container sizing)
  useEffect(() => {
    // Trust the parent SketchCanvas for size calculations
    // Just apply minimum constraints for safety
    const newWidth = Math.max(300, Math.min(width, 2000)); // Max reasonable width
    const newHeight = Math.max(200, Math.min(height, 1500)); // Max reasonable height

    setActualSize({
      width: newWidth,
      height: newHeight
    });
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
    e.evt.stopPropagation();

    const wall = walls.find(w => w.id === wallId);
    if (!wall) {
      return;
    }

    // Calculate current length and convert to feet/inches
    const currentLengthPixels = calculateWallLength(wall);
    const { feet, inches } = pixelsToFeetInches(currentLengthPixels);

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

      setWallEditPosition(editPosition);
    }
  }, [walls]);

  // Update wall length based on input
  const updateWallLength = useCallback((wallId: string, newFeet: number, newInches: number) => {
    // Validate input values first
    if (newFeet < 0 || newInches < 0 || newInches >= 12) {
      return;
    }

    const newLengthPixels = feetInchesToPixels(newFeet, newInches);

    if (newLengthPixels <= 0) {
      return;
    }

    let wall = walls.find(w => w.id === wallId);

    if (!wall) {
      // Check if wall might be stored in rooms and try to reconstruct it
      const roomsWithWalls = rooms.filter(room => room.wallIds?.includes(wallId));

      if (roomsWithWalls.length > 0) {
        // Try to reconstruct wall from room data
        const room = roomsWithWalls[0];
        if (wallId.includes('-wall-right')) {
          wall = {
            id: wallId,
            start: { x: room.bounds.x + room.bounds.width, y: room.bounds.y },
            end: { x: room.bounds.x + room.bounds.width, y: room.bounds.y + room.bounds.height }
          };
        } else if (wallId.includes('-wall-left')) {
          wall = {
            id: wallId,
            start: { x: room.bounds.x, y: room.bounds.y },
            end: { x: room.bounds.x, y: room.bounds.y + room.bounds.height }
          };
        } else if (wallId.includes('-wall-top')) {
          wall = {
            id: wallId,
            start: { x: room.bounds.x, y: room.bounds.y },
            end: { x: room.bounds.x + room.bounds.width, y: room.bounds.y }
          };
        } else if (wallId.includes('-wall-bottom')) {
          wall = {
            id: wallId,
            start: { x: room.bounds.x + room.bounds.width, y: room.bounds.y + room.bounds.height },
            end: { x: room.bounds.x, y: room.bounds.y + room.bounds.height }
          };
        }
      }

      if (!wall) {
        return;
      }
    }

    const currentLengthPixels = calculateWallLength(wall);

    if (Math.abs(newLengthPixels - currentLengthPixels) < 1) {
      // Clear editing state even if no change
      setEditingWallId(null);
      setWallEditPosition(null);
      return;
    }

    // IRREGULAR SHAPE SUPPORT: Update only the specific wall instead of regenerating all room walls
    // This allows rooms to have irregular/non-rectangular shapes for property blueprints
    const roomsWithWalls = rooms.filter(room => room.wallIds?.includes(wallId));
    if (roomsWithWalls.length > 0) {
      const room = roomsWithWalls[0];

      // Calculate new wall endpoints based on the wall direction and new length
      const dx = wall.end.x - wall.start.x;
      const dy = wall.end.y - wall.start.y;
      const currentLength = Math.sqrt(dx * dx + dy * dy);

      if (currentLength === 0) {
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

      // Update the specific wall and handle connectivity in a single update
      setWallsAndSync(prevWalls => {
        const updatedWalls = prevWalls.map(w => {
          if (w.id === wallId) {
            return {
              ...w,
              end: newEnd
            };
          }
          return w;
        });

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
              return { ...w, start: newEnd };
            }

            // If wall end point is close to our new endpoint, connect it
            if (distanceToNewEndFromEnd <= tolerance) {
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


      // Update standalone wall
      setWallsAndSync(prevWalls => {
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
    // Delegate to the version that accepts wallsArray parameter
    return getOrderedRoomVerticesWithWalls(wallIds, walls);
  };

  // Helper function to find a connected path through walls
  const findConnectedPath = (pointSet: Map<string, Point>, adjacencyList: Map<string, Set<string>>): Point[] => {
    const vertices: Point[] = [];
    const visited = new Set<string>();

    // Find the leftmost-topmost point as starting point (most stable for ordering)
    let startKey = '';
    let leftmostX = Infinity;
    let topmostY = Infinity;

    Array.from(pointSet.entries()).forEach(([key, point]) => {
      if (point.x < leftmostX || (point.x === leftmostX && point.y < topmostY)) {
        leftmostX = point.x;
        topmostY = point.y;
        startKey = key;
      }
    });

    if (!startKey) return [];

    let currentKey = startKey;
    let prevKey: string | null = null;

    console.log(`🔍 Starting path traversal from (${leftmostX.toFixed(0)}, ${topmostY.toFixed(0)}) with ${pointSet.size} total points`);

    // Traverse the connected path
    while (vertices.length < pointSet.size) {
      // Check if we've revisited the start (closing the loop)
      if (visited.has(currentKey) && currentKey !== startKey) {
        console.warn(`⚠️ Revisited point before completing loop at vertex ${vertices.length}`);
        break;
      }

      // Special case: if we're back at start and have visited all points, we're done
      if (currentKey === startKey && vertices.length > 0) {
        if (visited.size === pointSet.size) {
          console.log(`✅ Completed closed loop with all ${vertices.length} vertices`);
          break;
        }
      }

      visited.add(currentKey);
      vertices.push(pointSet.get(currentKey)!);

      const neighbors = adjacencyList.get(currentKey);
      if (!neighbors || neighbors.size === 0) {
        console.warn(`⚠️ Dead end at vertex ${vertices.length}, no neighbors`);
        break;
      }

      // Find the next unvisited neighbor, or close the loop if possible
      let nextKey: string | null = null;

      // If we have visited all points and can return to start, do so
      if (vertices.length >= 3 && neighbors.has(startKey) && visited.size === pointSet.size) {
        console.log(`✅ Closing loop back to start`);
        break;
      }

      // Find unvisited neighbor, preferring the one that maintains good geometry
      const unvisitedNeighbors = Array.from(neighbors).filter(key =>
        !visited.has(key) || (key === startKey && vertices.length >= 3)
      );

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

      if (!nextKey) {
        console.warn(`⚠️ No next neighbor found at vertex ${vertices.length}/${pointSet.size}`);
        break;
      }

      prevKey = currentKey;
      currentKey = nextKey;
    }

    console.log(`📊 Path completed: ${vertices.length} vertices out of ${pointSet.size} points`);

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

  // Get ordered vertices with provided walls array - proper boundary tracing
  const getOrderedRoomVerticesWithWalls = (wallIds: string[], wallsArray: Wall[]): Point[] => {

    const roomWalls = wallsArray.filter(wall => wallIds.includes(wall.id));

    if (roomWalls.length === 0) {
      return [];
    }

    // Build adjacency map for wall connectivity
    const adjacency = new Map<string, Point[]>();
    const pointMap = new Map<string, Point>();

    roomWalls.forEach(wall => {
      const startKey = `${wall.start.x},${wall.start.y}`;
      const endKey = `${wall.end.x},${wall.end.y}`;

      pointMap.set(startKey, wall.start);
      pointMap.set(endKey, wall.end);

      if (!adjacency.has(startKey)) adjacency.set(startKey, []);
      if (!adjacency.has(endKey)) adjacency.set(endKey, []);

      adjacency.get(startKey)!.push(wall.end);
      adjacency.get(endKey)!.push(wall.start);
    });

    const allPoints = Array.from(pointMap.values());

    if (allPoints.length < 3) {
      return [];
    }

    // Find leftmost point (guaranteed to be on outer boundary)
    let startPoint = allPoints[0];
    for (const point of allPoints) {
      if (point.x < startPoint.x || (point.x === startPoint.x && point.y < startPoint.y)) {
        startPoint = point;
      }
    }

    // Trace boundary using "rightmost turn" rule
    const vertices: Point[] = [];
    let current = startPoint;
    let prevPoint: Point | null = null;

    const maxIterations = allPoints.length * 2;
    let iterations = 0;

    while (iterations < maxIterations) {
      vertices.push(current);

      // Check if we've completed the loop
      if (iterations > 0 &&
          Math.abs(current.x - startPoint.x) < 0.1 &&
          Math.abs(current.y - startPoint.y) < 0.1) {
        break;
      }

      const currentKey = `${current.x},${current.y}`;
      const neighbors = adjacency.get(currentKey) || [];

      if (neighbors.length === 0) break;

      // Filter out previous point
      const validNeighbors = prevPoint
        ? neighbors.filter(n => {
            const prev = prevPoint!; // TypeScript: we're inside the truthy branch
            return !(Math.abs(n.x - prev.x) < 0.1 && Math.abs(n.y - prev.y) < 0.1);
          })
        : neighbors;

      if (validNeighbors.length === 0) break;

      let nextPoint: Point;

      if (validNeighbors.length === 1) {
        nextPoint = validNeighbors[0];
      } else {
        // Multiple neighbors - pick rightmost turn for outer boundary
        // Calculate angle for each neighbor relative to incoming direction

        const baseAngle = prevPoint
          ? Math.atan2(current.y - prevPoint.y, current.x - prevPoint.x)
          : -Math.PI / 2; // Start going downward from leftmost point

        let bestAngle = Infinity;
        let bestNeighbor = validNeighbors[0];

        for (const neighbor of validNeighbors) {
          const neighborAngle = Math.atan2(neighbor.y - current.y, neighbor.x - current.x);

          // Calculate the turn angle (normalized to [0, 2π])
          let turnAngle = neighborAngle - baseAngle;
          while (turnAngle < 0) turnAngle += 2 * Math.PI;
          while (turnAngle >= 2 * Math.PI) turnAngle -= 2 * Math.PI;

          // We want the smallest turn angle (rightmost turn)
          if (turnAngle < bestAngle) {
            bestAngle = turnAngle;
            bestNeighbor = neighbor;
          }
        }

        nextPoint = bestNeighbor;
      }

      prevPoint = current;
      current = nextPoint;
      iterations++;
    }

    if (vertices.length < 3) {
      // Fallback to centroid-based sorting
      const centroid = {
        x: allPoints.reduce((sum, p) => sum + p.x, 0) / allPoints.length,
        y: allPoints.reduce((sum, p) => sum + p.y, 0) / allPoints.length
      };

      return [...allPoints].sort((a, b) => {
        const angleA = Math.atan2(a.y - centroid.y, a.x - centroid.x);
        const angleB = Math.atan2(b.y - centroid.y, b.x - centroid.x);
        return angleA - angleB;
      });
    }

    return ensureProperWindingOrder(vertices);
  };

  // Update room bounds and area when walls change
  const updateRoomDimensions = useCallback(() => {

    // Get the most current walls state
    setWalls(currentWalls => {

      setRooms(prevRooms => {
        const updatedRooms = prevRooms.map(room => {
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
              boundary: vertices, // Update boundary for fixture placement
              area: newArea
            };
          }
          return room;
        });

        // Note: Sketch context sync removed from here to prevent infinite loop
        // Context will be synced through other state update mechanisms

        return updatedRooms;
      });

      // Return the same walls array (no modification needed)
      return currentWalls;
    });
  }, []); // Empty dependency - no need to re-create this function

  // Calculate distance between two points
  const getDistance = (p1: Point, p2: Point): number => {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  };

  // Find closest point to snap to - either wall endpoint or point on wall segment
  const findClosestSnapPoint = useCallback((pos: Point, excludeWallId?: string): {
    point: Point;
    wallId: string;
    endpoint?: 'start' | 'end';
    splitWall?: boolean;
    distance: number;
  } | null => {
    interface SnapPoint {
      point: Point;
      wallId: string;
      endpoint?: 'start' | 'end';
      splitWall?: boolean;
      distance: number;
    }

    let closestPoint: SnapPoint | undefined;

    for (const wall of walls) {
      if (wall.id === excludeWallId) continue;

      // Check wall endpoints
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

      // Check if point is close to wall segment (not just endpoints)
      const A = wall.start;
      const B = wall.end;
      const P = pos;

      const lengthSquared = Math.pow(B.x - A.x, 2) + Math.pow(B.y - A.y, 2);

      if (lengthSquared > 0) {
        // Calculate the t parameter for the closest point on the line segment
        const t = Math.max(0, Math.min(1,
          ((P.x - A.x) * (B.x - A.x) + (P.y - A.y) * (B.y - A.y)) / lengthSquared
        ));

        // Calculate the closest point on the line segment
        const closestPointOnWall = {
          x: A.x + t * (B.x - A.x),
          y: A.y + t * (B.y - A.y)
        };

        // Calculate distance from pos to closest point on wall
        const distanceToWall = getDistance(P, closestPointOnWall);

        // If close to wall segment (but not too close to endpoints to avoid duplicate snapping)
        const MIN_ENDPOINT_DISTANCE = 10; // Minimum pixels from endpoint to consider as wall segment
        const distFromStart = getDistance(closestPointOnWall, A);
        const distFromEnd = getDistance(closestPointOnWall, B);

        if (distanceToWall < SNAP_THRESHOLD &&
            distFromStart > MIN_ENDPOINT_DISTANCE &&
            distFromEnd > MIN_ENDPOINT_DISTANCE) {
          if (!closestPoint || distanceToWall < closestPoint.distance) {
            closestPoint = {
              point: closestPointOnWall,
              wallId: wall.id,
              splitWall: true, // This indicates we need to split the wall
              distance: distanceToWall
            };
          }
        }
      }
    }

    return closestPoint || null;
  }, [walls]);

  // Keep the old function for backward compatibility where needed
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
          setWallsAndSync(prevWalls => prevWalls.filter(wall => !selectedWallIds.includes(wall.id)));
          setSelectedWallIds([]);
        }
        if (selectedRoomIds.length > 0) {
          // Also delete walls and fixtures that belong to the selected rooms
          const roomsToDelete = rooms.filter(room => selectedRoomIds.includes(room.id));
          const wallIdsToDelete = roomsToDelete.flatMap(room => room.wallIds || []);

          // Delete room fixtures that belong to the selected rooms
          const roomFixturesToDelete = sketch?.roomFixtures?.filter(f => selectedRoomIds.includes(f.roomId)) || [];
          roomFixturesToDelete.forEach(fixture => {
            if (removeRoomFixture) {
              removeRoomFixture(fixture.id);
            }
          });

          setWallsAndSync(prevWalls => prevWalls.filter(wall => !wallIdsToDelete.includes(wall.id)));
          setRooms(prevRooms => prevRooms.filter(room => !selectedRoomIds.includes(room.id)));
          setSelectedRoomIds([]);
        }
        if (selectedFixtureIds.length > 0) {
          // Delete selected fixtures
          selectedFixtureIds.forEach(fixtureId => {
            // Check if it's a wall fixture or room fixture and call appropriate delete function
            const wallFixture = sketch?.wallFixtures?.find((f: any) => f.id === fixtureId);
            const roomFixture = sketch?.roomFixtures?.find((f: any) => f.id === fixtureId);

            if (wallFixture && removeWallFixture) {
              removeWallFixture(fixtureId);
            } else if (roomFixture && removeRoomFixture) {
              removeRoomFixture(fixtureId);
            }
          });
          setSelectedFixtureIds([]);
        }
      }

      if (e.key === 'Escape') {
        setSelectedWallIds([]);
        setSelectedRoomIds([]);
        setSelectedFixtureIds([]);
        setDragSelection({ isActive: false, start: { x: 0, y: 0 }, current: { x: 0, y: 0 } });
        setIsDragSelecting(false);
        setContextMenu({ visible: false, x: 0, y: 0, roomId: null, wallId: null, fixtureId: null, type: null });
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

  // Helper function to find all walls connected at a specific point
  const getWallsConnectedAtPoint = useCallback((point: Point, excludeWallId?: string): Wall[] => {
    const connectedWalls: Wall[] = [];
    const threshold = 2; // Pixel threshold for considering points as connected

    walls.forEach(wall => {
      if (excludeWallId && wall.id === excludeWallId) return;

      const startDist = Math.sqrt(Math.pow(wall.start.x - point.x, 2) + Math.pow(wall.start.y - point.y, 2));
      const endDist = Math.sqrt(Math.pow(wall.end.x - point.x, 2) + Math.pow(wall.end.y - point.y, 2));

      if (startDist <= threshold || endDist <= threshold) {
        connectedWalls.push(wall);
      }
    });

    return connectedWalls;
  }, [walls]);

  // Helper function to split a wall at a specific point
  const splitWallAtPoint = useCallback((wallId: string, splitPoint: Point) => {
    const wall = walls.find(w => w.id === wallId);
    if (!wall) return;

    // Find the room that contains this wall
    const containingRoom = rooms.find(room => room.wallIds?.includes(wallId));

    // Create two new walls from the split
    const wall1: Wall = {
      id: `${wallId}-split1-${Date.now()}`,
      start: wall.start,
      end: splitPoint
    };

    const wall2: Wall = {
      id: `${wallId}-split2-${Date.now()}`,
      start: splitPoint,
      end: wall.end
    };

    // Update walls array: remove original wall and add the two new ones
    setWallsAndSync(prevWalls => {
      const filteredWalls = prevWalls.filter(w => w.id !== wallId);
      return [...filteredWalls, wall1, wall2];
    });

    // Update room's wall IDs and vertices if it exists
    if (containingRoom) {
      setRooms(prevRooms => prevRooms.map(room => {
        if (room.id === containingRoom.id) {
          // Replace the old wall ID with the two new ones
          const newWallIds = room.wallIds?.filter(id => id !== wallId) || [];
          newWallIds.push(wall1.id, wall2.id);

          // Add the split point to the vertices if not already present
          const updatedVertices = room.vertices ? [...room.vertices] : [];
          const pointExists = updatedVertices.some(v =>
            Math.abs(v.x - splitPoint.x) < 2 && Math.abs(v.y - splitPoint.y) < 2
          );

          if (!pointExists) {
            // Find the best position to insert the new vertex
            // This maintains the polygon ordering
            let insertIndex = 0;
            let minDistance = Infinity;

            for (let i = 0; i < updatedVertices.length; i++) {
              const next = (i + 1) % updatedVertices.length;
              const edgeStart = updatedVertices[i];
              const edgeEnd = updatedVertices[next];

              // Check if split point lies between these two vertices
              const dist1 = Math.sqrt(Math.pow(edgeStart.x - splitPoint.x, 2) + Math.pow(edgeStart.y - splitPoint.y, 2));
              const dist2 = Math.sqrt(Math.pow(edgeEnd.x - splitPoint.x, 2) + Math.pow(edgeEnd.y - splitPoint.y, 2));
              const edgeDist = Math.sqrt(Math.pow(edgeEnd.x - edgeStart.x, 2) + Math.pow(edgeEnd.y - edgeStart.y, 2));

              const totalDist = dist1 + dist2;

              if (Math.abs(totalDist - edgeDist) < 5 && totalDist < minDistance) {
                minDistance = totalDist;
                insertIndex = next;
              }
            }

            updatedVertices.splice(insertIndex, 0, splitPoint);
          }

          return {
            ...room,
            wallIds: newWallIds,
            vertices: updatedVertices
          };
        }
        return room;
      }));
    }
  }, [walls, rooms]);

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
      setContextMenu({ visible: false, x: 0, y: 0, roomId: null, wallId: null, fixtureId: null, type: null });
    }

    // Handle wall split mode
    if (currentTool === 'wall_split') {
      const wallResult = getWallAtPosition(pos);
      if (wallResult) {
        // Find the closest point on the wall to where the user clicked
        const wall = walls.find(w => w.id === wallResult.wallId);
        if (wall) {
          // Project the click position onto the wall line to get the split point
          const wallVector = {
            x: wall.end.x - wall.start.x,
            y: wall.end.y - wall.start.y
          };
          const wallLength = Math.sqrt(wallVector.x * wallVector.x + wallVector.y * wallVector.y);
          const normalizedWallVector = {
            x: wallVector.x / wallLength,
            y: wallVector.y / wallLength
          };

          const toClick = {
            x: pos.x - wall.start.x,
            y: pos.y - wall.start.y
          };

          // Calculate projection length
          const projectionLength = Math.max(0, Math.min(wallLength,
            toClick.x * normalizedWallVector.x + toClick.y * normalizedWallVector.y
          ));

          // Calculate the split point
          const splitPoint = {
            x: wall.start.x + normalizedWallVector.x * projectionLength,
            y: wall.start.y + normalizedWallVector.y * projectionLength
          };

          // Don't split too close to the endpoints
          const minSplitDistance = 10; // Minimum distance from endpoints
          const distToStart = Math.sqrt(Math.pow(splitPoint.x - wall.start.x, 2) + Math.pow(splitPoint.y - wall.start.y, 2));
          const distToEnd = Math.sqrt(Math.pow(splitPoint.x - wall.end.x, 2) + Math.pow(splitPoint.y - wall.end.y, 2));

          if (distToStart > minSplitDistance && distToEnd > minSplitDistance) {
            splitWallAtPoint(wallResult.wallId, splitPoint);
          }
        }
      }
      return;
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

      // If not clicking on any element and Shift is pressed, start panning
      if (!clickedOnElement && e.evt.button === 0 && e.evt.shiftKey) {
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
      if (endpoint && !isDraggingFixture) {
        // Find all walls connected at this endpoint
        const wall = walls.find(w => w.id === endpoint.wallId);
        if (wall) {
          const endpointPosition = endpoint.endpoint === 'start' ? wall.start : wall.end;
          const connectedWalls = getWallsConnectedAtPoint(endpointPosition);

          // Store information about all connected walls and their endpoints
          const connectedEndpoints: Array<{ wallId: string; endpoint: 'start' | 'end' }> = [];

          // Always include the clicked wall endpoint
          connectedEndpoints.push({
            wallId: endpoint.wallId,
            endpoint: endpoint.endpoint
          });

          // Find which endpoint of each connected wall is at this position
          connectedWalls.forEach(connectedWall => {
            if (connectedWall.id === endpoint.wallId) return; // Skip the wall we clicked on

            const startDist = Math.sqrt(
              Math.pow(connectedWall.start.x - endpointPosition.x, 2) +
              Math.pow(connectedWall.start.y - endpointPosition.y, 2)
            );
            const endDist = Math.sqrt(
              Math.pow(connectedWall.end.x - endpointPosition.x, 2) +
              Math.pow(connectedWall.end.y - endpointPosition.y, 2)
            );

            if (startDist < 2) {
              connectedEndpoints.push({
                wallId: connectedWall.id,
                endpoint: 'start'
              });
            } else if (endDist < 2) {
              connectedEndpoints.push({
                wallId: connectedWall.id,
                endpoint: 'end'
              });
            }
          });

          // Store all connected endpoints for dragging
          setIsDragging(true);
          setDragInfo({
            wallId: endpoint.wallId,
            endpoint: endpoint.endpoint,
            offset: { x: 0, y: 0 },
            connectedEndpoints // Store all connected endpoints
          });
        } else {
          // Fallback to original behavior if wall not found
          setIsDragging(true);
          setDragInfo({
            wallId: endpoint.wallId,
            endpoint: endpoint.endpoint,
            offset: { x: 0, y: 0 }
          });
        }

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

      // Check if clicking on a fixture first (fixtures have priority over walls)
      // Use Konva's event target to detect if we clicked on a fixture
      const target = e.target;
      const clickedOnFixture = target && target.parent && target.parent.attrs &&
                                (target.parent.attrs.name === 'fixture-group' ||
                                 target.attrs.name === 'fixture-group');

      // If clicking on a fixture, don't select walls
      if (clickedOnFixture) {
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

        // Start wall moving if wall is selected (but not if a fixture is being dragged)
        if (!isDraggingFixture && (selectedWallIds.includes(wallId) || !isCtrlPressed)) {
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
  }, [currentTool, walls, rooms, selectedWallIds, selectedRoomIds, getWallsConnectedAtPoint, splitWallAtPoint]);

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
        setWallsAndSync(prev => [...prev, ...roomWalls]);

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
          vertices: roomVertices, // Store the vertices for polygon rendering (legacy)
          boundary: roomVertices // Store the boundary for point-in-polygon testing (used for fixture placement)
        };

        setRooms(prev => {
          const updatedRooms = [...prev, newRoom];
          // Sync to sketch context
          if (updateSketch) {
            const sketchRooms = convertToSketchRooms(updatedRooms);
            updateSketch({ rooms: sketchRooms });
          }
          return updatedRooms;
        });
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

      // Update all connected wall endpoints
      if (dragInfo.connectedEndpoints && dragInfo.connectedEndpoints.length > 0) {
        setWallsAndSync(prevWalls => prevWalls.map(wall => {
          // Check if this wall has a connected endpoint that needs updating
          const connectedEndpoint = dragInfo.connectedEndpoints?.find(ce => ce.wallId === wall.id);
          if (connectedEndpoint) {
            return {
              ...wall,
              [connectedEndpoint.endpoint]: finalPos
            };
          }
          return wall;
        }));
      } else {
        // Fallback to original behavior if no connected endpoints
        setWallsAndSync(prevWalls => prevWalls.map(wall => {
          if (wall.id === dragInfo.wallId) {
            return {
              ...wall,
              [dragInfo.endpoint]: finalPos
            };
          }
          return wall;
        }));
      }

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
  }, [isDragging, dragInfo, walls, findClosestEndpoint, isMovingWalls, wallDragInfo, isDragSelecting, dragSelection, isDrawingRoom, currentRoom, roomCounter, isDraggingFixture]);

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

  // Handle stage click for drawing and fixture placement
  const handleStageClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const pos = getRelativePointerPosition();
    if (!pos) return;

    // Close segment editor when clicking on stage
    setSegmentEditorFixtureId(null);

    // Check if click is on empty area (not on fixture, wall, or room)
    // If currentTool is 'select' and not placing fixtures, clear selections
    if (currentTool === 'select' && !selectedFixture) {
      // Only clear selections if clicking on empty area (Stage background)
      const clickedOnEmptyArea = e.target === e.target.getStage();

      if (clickedOnEmptyArea && !(e.evt.ctrlKey || e.evt.metaKey)) {
        // Clear all selections when clicking on empty area without Ctrl
        setSelectedFixtureIds([]);
        setSelectedRoomIds([]);
        setSelectedWallIds([]);
      }
    }

    // Handle fixture placement
    console.log('🔍 Stage click - Current state:', {
      currentTool,
      hasSelectedFixture: !!selectedFixture,
      selectedFixtureName: selectedFixture?.name,
      selectedFixtureCategory: selectedFixture?.category,
      hasFixtureDimensions: !!fixtureDimensions,
      placementMode
    });

    if (currentTool === 'fixture' && selectedFixture && fixtureDimensions && placementMode) {
      console.log('🔧 Fixture placement mode active:', { currentTool, selectedFixture: selectedFixture?.name, placementMode });

      if (placementMode === 'wall') {
        console.log('🎯 Looking for wall at position:', pos, 'Available walls:', walls.length);

        // Find the wall that was clicked
        const clickedWall = walls.find(wall => {
          // Simple distance calculation to wall line
          const A = wall.start;
          const B = wall.end;
          const P = pos;

          // Calculate distance from point to line segment
          const lengthSquared = Math.pow(B.x - A.x, 2) + Math.pow(B.y - A.y, 2);

          // If the wall has zero length, calculate distance to point
          if (lengthSquared === 0) {
            return Math.sqrt(Math.pow(P.x - A.x, 2) + Math.pow(P.y - A.y, 2)) < 20;
          }

          // Calculate the t parameter for the closest point on the line segment
          const t = Math.max(0, Math.min(1,
            ((P.x - A.x) * (B.x - A.x) + (P.y - A.y) * (B.y - A.y)) / lengthSquared
          ));

          // Calculate the closest point on the line segment
          const closestPoint = {
            x: A.x + t * (B.x - A.x),
            y: A.y + t * (B.y - A.y)
          };

          // Calculate distance from click point to closest point on line segment
          const distanceToWall = Math.sqrt(
            Math.pow(P.x - closestPoint.x, 2) + Math.pow(P.y - closestPoint.y, 2)
          );

          return distanceToWall < 30; // Increased tolerance to 30 pixels for easier clicking
        });

        if (clickedWall) {
          console.log('✅ Wall found:', clickedWall.id);

          // Calculate position along wall in pixels using projection
          const A = clickedWall.start;
          const B = clickedWall.end;
          const P = pos;

          const wallLength = Math.sqrt(
            Math.pow(B.x - A.x, 2) + Math.pow(B.y - A.y, 2)
          );

          // Calculate the t parameter (0 to 1) representing position along wall
          const lengthSquared = wallLength * wallLength;
          const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
            ((P.x - A.x) * (B.x - A.x) + (P.y - A.y) * (B.y - A.y)) / lengthSquared
          ));

          // Position in pixels from start of wall (projection-based)
          const position = t * wallLength;

          console.log('📍 Placing fixture at position:', position, 'on wall:', clickedWall.id.slice(0, 20));

          // Add wall fixture
          const result = addWallFixture(
            clickedWall.id,
            selectedFixture.category as any,
            selectedFixture.type as any,
            { width: fixtureDimensions.width * 12, height: fixtureDimensions.height * 12 }, // Convert feet to inches
            position
          );

          console.log('🔧 addWallFixture result:', result);

          if (result.success) {
            console.log('✅ Fixture placed successfully, resetting state');
            // Reset fixture placement state
            setFixturePlacement(null, null, null);
            setCurrentTool('select');
          } else {
            console.error('❌ Failed to place fixture:', result.error);
          }
          return;
        } else {
          console.warn('No wall found at click position:', pos, 'Available walls:', walls.length);

          // Debug: show distances to all walls
          const wallDistances = walls.map(wall => {
            const A = wall.start;
            const B = wall.end;
            const P = pos;

            const lengthSquared = Math.pow(B.x - A.x, 2) + Math.pow(B.y - A.y, 2);
            let distance: number;

            if (lengthSquared === 0) {
              distance = Math.sqrt(Math.pow(P.x - A.x, 2) + Math.pow(P.y - A.y, 2));
            } else {
              const t = Math.max(0, Math.min(1,
                ((P.x - A.x) * (B.x - A.x) + (P.y - A.y) * (B.y - A.y)) / lengthSquared
              ));

              const closestPoint = {
                x: A.x + t * (B.x - A.x),
                y: A.y + t * (B.y - A.y)
              };

              distance = Math.sqrt(
                Math.pow(P.x - closestPoint.x, 2) + Math.pow(P.y - closestPoint.y, 2)
              );
            }

            return { wallId: wall.id, distance: distance.toFixed(2) };
          }).sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));

        }
      } else if (placementMode === 'room') {
        console.log('🔍 Room placement mode active. Available rooms:', rooms.length);
        console.log('   Rooms data:', rooms.map(r => ({ id: r.id, name: r.name, hasBoundary: !!r.boundary, boundaryPoints: r.boundary?.length || 0 })));

        // Find the room that contains the click point
        const clickedRoom = rooms.find(room => {
          // Simple point-in-polygon test for room boundary
          const vertices = room.boundary || [];
          console.log(`   Checking room ${room.name}: boundary=${vertices.length} points`);
          if (vertices.length < 3) {
            console.log(`   ❌ Room ${room.name} has insufficient boundary points (${vertices.length})`);
            return false;
          }

          let inside = false;
          for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
            if (
              vertices[i].y > pos.y !== vertices[j].y > pos.y &&
              pos.x < ((vertices[j].x - vertices[i].x) * (pos.y - vertices[i].y)) / (vertices[j].y - vertices[i].y) + vertices[i].x
            ) {
              inside = !inside;
            }
          }
          console.log(`   Room ${room.name} point-in-polygon test: ${inside ? '✅ INSIDE' : '❌ outside'}`);
          return inside;
        });

        console.log(`🎯 Click at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}): ${clickedRoom ? `Found room ${clickedRoom.name}` : 'No room found'}`);

        if (clickedRoom) {
          // Add room fixture
          const result = addRoomFixture(
            clickedRoom.id,
            selectedFixture.category as any,
            selectedFixture.type as any,
            { width: fixtureDimensions.width * 12, height: fixtureDimensions.height * 12 }, // Convert feet to inches
            pos
          );

          if (result.success) {
            // Reset fixture placement state
            setFixturePlacement(null, null, null);
            setCurrentTool('select');
          } else {
            console.error('Failed to place fixture:', result.error);
          }
          return;
        }
      }
      return; // Don't proceed with wall drawing if in fixture mode
    }

    // Handle wall drawing
    if (currentTool !== 'wall') return;

    // pos is already declared above, no need to redeclare
    if (!pos) return;


    // Check for snap points (walls, wall segments, or room vertices)
    let snappedPos: Point;
    let connectedRoomId: string | null = null;
    let wallToSplit: { wallId: string; splitPoint: Point } | null = null;

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
        // Check for nearby wall endpoints or wall segments using findClosestSnapPoint
        const snapPoint = findClosestSnapPoint(pos);
        if (snapPoint) {
          snappedPos = snapPoint.point;
          if (snapPoint.splitWall) {
            // Mark wall for splitting
            wallToSplit = {
              wallId: snapPoint.wallId,
              splitPoint: snapPoint.point
            };
            // Find room that contains this wall
            const wall = walls.find(w => w.id === snapPoint.wallId);
            if (wall) {
              connectedRoomId = findRoomWithWallEndpoint(wall.start) || findRoomWithWallEndpoint(wall.end);
            }
          } else {
            connectedRoomId = findRoomWithWallEndpoint(snapPoint.point);
          }
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
        // Calculate wall length
        const wallLength = Math.sqrt(
          Math.pow(snappedPos.x - currentWall.start.x, 2) +
          Math.pow(snappedPos.y - currentWall.start.y, 2)
        );
        const lengthInFeet = wallLength / 20; // pixels to feet
        const wallLengthMeasurement = {
          feet: Math.floor(lengthInFeet),
          inches: Math.round((lengthInFeet % 1) * 12),
          totalInches: lengthInFeet * 12,
          display: `${Math.floor(lengthInFeet)}' ${Math.round((lengthInFeet % 1) * 12)}"`
        };

        const newWall: Wall = {
          id: `wall-${Date.now()}`,
          start: currentWall.start,
          end: snappedPos
        };

        // If we need to split an existing wall, do it now
        let updatedWalls = [...walls];
        let wallsToAdd = [newWall];

        if (wallToSplit) {
          const wallToSplitId = wallToSplit.wallId;
          const splitPoint = wallToSplit.splitPoint;
          const wallToSplitData = walls.find(w => w.id === wallToSplitId);

          if (wallToSplitData) {
            // Remove the original wall
            updatedWalls = updatedWalls.filter(w => w.id !== wallToSplitId);

            // Create two new walls from the split
            const wall1: Wall = {
              id: `${wallToSplitId}_split1_${Date.now()}`,
              start: wallToSplitData.start,
              end: splitPoint
            };
            const wall2: Wall = {
              id: `${wallToSplitId}_split2_${Date.now()}`,
              start: splitPoint,
              end: wallToSplitData.end
            };

            wallsToAdd.push(wall1, wall2);

            // Update rooms that referenced the old wall
            setRooms(prevRooms => prevRooms.map(room => {
              if (room.wallIds?.includes(wallToSplitId)) {
                const newWallIds = room.wallIds.filter(id => id !== wallToSplitId);
                newWallIds.push(wall1.id, wall2.id, newWall.id);

                // Add the split point to room vertices if not already there
                const vertices = room.vertices || [];
                const hasVertex = vertices.some(v =>
                  Math.abs(v.x - splitPoint.x) < 2 &&
                  Math.abs(v.y - splitPoint.y) < 2
                );
                if (!hasVertex) {
                  // Insert the new vertex in the correct position
                  const newVertices = [...vertices, splitPoint];
                  return {
                    ...room,
                    wallIds: newWallIds,
                    vertices: newVertices
                  };
                }

                return {
                  ...room,
                  wallIds: newWallIds
                };
              }
              return room;
            }));
          }
        }

        setWallsAndSync([...updatedWalls, ...wallsToAdd]);

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
  }, [currentTool, isDrawing, currentWall, walls, rooms, gridSize, onStageClick, findClosestSnapPoint, findClosestEndpoint, findRoomWithWallEndpoint, findRoomByVertex, updateRoomDimensions, selectedFixture, fixtureDimensions, placementMode, setFixturePlacement, addWallFixture, addRoomFixture, setCurrentTool, hoveredRoomVertex]);

  // Handle right-click context menu
  const handleContextMenu = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    const pos = getRelativePointerPosition();

    if (!pos) return;

    // Use absolute viewport coordinates (clientX, clientY) for position: fixed
    const menuPosition = {
      x: e.evt.clientX,
      y: e.evt.clientY
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
        fixtureId: null,
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
        fixtureId: null,
        type: 'room'
      });
    } else {
      setContextMenu({ visible: false, x: 0, y: 0, roomId: null, wallId: null, fixtureId: null, type: null });
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
    setContextMenu({ visible: false, x: 0, y: 0, roomId: null, wallId: null, fixtureId: null, type: null });
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

  // Handle fixture size save
  const handleSaveFixtureSize = (values: { width: number; height: number; sillHeight?: number }) => {
    if (!fixtureEditModal.fixtureId) return;

    const newDimensions = {
      width: values.width * 12, // Convert feet to inches
      height: values.height * 12
    };

    if (fixtureEditModal.isWallFixture) {
      const wallFixture = sketch?.wallFixtures?.find((f: any) => f.id === fixtureEditModal.fixtureId);
      if (wallFixture && removeWallFixture && addWallFixture) {
        // Prepare new properties with sill height for windows
        const newProperties = { ...wallFixture.properties };
        if (wallFixture.category === 'window' && values.sillHeight !== undefined) {
          const totalInches = values.sillHeight * 12;
          const feet = Math.floor(values.sillHeight);
          const inches = Math.round((values.sillHeight - feet) * 12);
          newProperties.sillHeight = {
            feet,
            inches,
            totalInches,
            display: `${feet}' ${inches}"`
          };
        }

        // Remove old fixture and add with new dimensions and properties
        removeWallFixture(wallFixture.id);
        const newFixture = addWallFixture(
          wallFixture.wallId,
          wallFixture.category,
          wallFixture.type,
          newDimensions,
          wallFixture.position
        );

        // Update properties if needed
        if (newFixture && Object.keys(newProperties).length > 0) {
          // Find the newly added fixture and update its properties
          const addedFixture = sketch?.wallFixtures?.find((f: any) =>
            f.wallId === wallFixture.wallId &&
            f.position === wallFixture.position &&
            f.id !== wallFixture.id
          );
          if (addedFixture) {
            addedFixture.properties = newProperties;
          }
        }
      }
    } else {
      const roomFixture = sketch?.roomFixtures?.find((f: any) => f.id === fixtureEditModal.fixtureId);
      if (roomFixture && updateRoomFixtureDimensions) {
        // Update room fixture dimensions
        const result = updateRoomFixtureDimensions(roomFixture.id, newDimensions);
        if (!result.success) {
          console.error('Failed to update fixture dimensions:', result.error);
        }
      }
    }

    // Reset form and close modal
    fixtureEditForm.resetFields();
    setFixtureEditModal({ visible: false, fixtureId: null, isWallFixture: false });
  };

  // Handle mouse move for preview and dragging
  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const pos = getRelativePointerPosition();
    if (!pos) return;

    setMousePos(pos);

    // If a fixture is being dragged, skip wall/room drag handling
    if (isDraggingFixture) {
      return;
    }

    // Show split indicator in wall split mode
    if (currentTool === 'wall_split' && !isDragging && !isDrawing) {
      const wallResult = getWallAtPosition(pos);
      if (wallResult) {
        const wall = walls.find(w => w.id === wallResult.wallId);
        if (wall) {
          // Project the mouse position onto the wall line
          const wallVector = {
            x: wall.end.x - wall.start.x,
            y: wall.end.y - wall.start.y
          };
          const wallLength = Math.sqrt(wallVector.x * wallVector.x + wallVector.y * wallVector.y);
          const normalizedWallVector = {
            x: wallVector.x / wallLength,
            y: wallVector.y / wallLength
          };

          const toMouse = {
            x: pos.x - wall.start.x,
            y: pos.y - wall.start.y
          };

          // Calculate projection length
          const projectionLength = Math.max(0, Math.min(wallLength,
            toMouse.x * normalizedWallVector.x + toMouse.y * normalizedWallVector.y
          ));

          // Calculate the split preview point
          const splitPoint = {
            x: wall.start.x + normalizedWallVector.x * projectionLength,
            y: wall.start.y + normalizedWallVector.y * projectionLength
          };

          // Only show indicator if not too close to endpoints
          const minSplitDistance = 10;
          const distToStart = Math.sqrt(Math.pow(splitPoint.x - wall.start.x, 2) + Math.pow(splitPoint.y - wall.start.y, 2));
          const distToEnd = Math.sqrt(Math.pow(splitPoint.x - wall.end.x, 2) + Math.pow(splitPoint.y - wall.end.y, 2));

          if (distToStart > minSplitDistance && distToEnd > minSplitDistance) {
            setSplitIndicator(splitPoint);
          } else {
            setSplitIndicator(null);
          }
        } else {
          setSplitIndicator(null);
        }
      } else {
        setSplitIndicator(null);
      }
    } else if (currentTool !== 'wall_split') {
      setSplitIndicator(null);
    }

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

      const targetPos = snapPoint ? snapPoint.point : {
        x: snapToGrid(pos.x),
        y: snapToGrid(pos.y)
      };

      if (snapPoint) {
        setSnapIndicator(snapPoint.point);
      } else {
        setSnapIndicator(null);
      }

      // Update all connected walls to move together
      if (dragInfo.connectedEndpoints && dragInfo.connectedEndpoints.length > 0) {
        // Update all connected endpoints to the same position
        setWallsAndSync(prevWalls => prevWalls.map(wall => {
          // Check if this wall has a connected endpoint that needs updating
          const connectedEndpoint = dragInfo.connectedEndpoints?.find(ce => ce.wallId === wall.id);
          if (connectedEndpoint) {
            return {
              ...wall,
              [connectedEndpoint.endpoint]: targetPos
            };
          }
          return wall;
        }), true); // immediate: true for synchronous fixture movement
      } else {
        // Fallback to original behavior if no connected endpoints
        setWallsAndSync(prevWalls => prevWalls.map(wall => {
          if (wall.id === dragInfo.wallId) {
            return {
              ...wall,
              [dragInfo.endpoint]: targetPos
            };
          }
          return wall;
        }), true); // immediate: true for synchronous fixture movement
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
      setWallsAndSync(prevWalls => prevWalls.map(wall => {
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
      }), true); // immediate: true for synchronous fixture movement
      // Note: updateRoomDimensions() NOT called during drag for performance
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
      setWallsAndSync(prevWalls => prevWalls.map(wall => {
        // Check if this wall belongs to any moving room using roomDragInfo (avoid rooms.find for infinite loop)
        const movingRoomId = roomDragInfo.roomIds.find(roomId =>
          roomDragInfo.startPositions[roomId]?.wallPositions?.[wall.id]
        );

        if (movingRoomId) {
          const originalWall = roomDragInfo.startPositions[movingRoomId].wallPositions[wall.id];
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
      }), true); // immediate: true for synchronous fixture movement

      // Move room fixtures that belong to the moving rooms
      roomDragInfo.roomIds.forEach(roomId => {
        const fixturePositions = roomDragInfo.startPositions[roomId]?.fixturePositions;
        if (fixturePositions) {
          Object.entries(fixturePositions).forEach(([fixtureId, originalPos]) => {
            moveRoomFixture(fixtureId, {
              x: snapToGrid(originalPos.x + dx),
              y: snapToGrid(originalPos.y + dy)
            });
          });
        }
      });

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
      // Check for snap points while drawing (walls, wall segments, or room vertices)
      let endPos: Point;
      let hasSnapPoint = false;

      // Use findClosestSnapPoint instead of findClosestEndpoint to include wall segments
      const snapPoint = findClosestSnapPoint(pos);
      if (snapPoint) {
        endPos = snapPoint.point;
        hasSnapPoint = true;
        // Show snap indicator for wall segment snapping
        if (snapPoint.splitWall) {
          setSnapIndicator(snapPoint.point);
        }
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
  }, [isDragging, dragInfo, isDrawing, currentWall, currentTool, gridSize, walls, onStageMouseMove, findClosestSnapPoint, findClosestEndpoint, isMovingWalls, wallDragInfo, isDragSelecting, isDrawingRoom, currentRoom, isMovingRooms, roomDragInfo, rooms, isPanning, lastRawPointerPosition, updateRoomDimensions, isDraggingFixture]);

  // Update room dimensions when walls change
  useEffect(() => {
    updateRoomDimensions();
  }, [walls.length, updateRoomDimensions]); // Use walls.length instead of walls array to prevent deep comparison issues

  // Handle keyboard events for zoom and pan
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Track pan mode activation (Shift only, Ctrl is for multi-select)
      if (e.key === 'Shift' && currentTool === 'select') {
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
      // Track pan mode deactivation (Shift only)
      if (e.key === 'Shift') {
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

            // If room has boundary, calculate the actual centroid
            if (room.boundary && room.boundary.length >= 3) {
              const sumX = room.boundary.reduce((sum, v) => sum + v.x, 0);
              const sumY = room.boundary.reduce((sum, v) => sum + v.y, 0);
              centerX = sumX / room.boundary.length;
              centerY = sumY / room.boundary.length;
            } else if (room.vertices && room.vertices.length >= 3) {
              // Fallback to vertices for old format
              const sumX = room.vertices.reduce((sum, v) => sum + v.x, 0);
              const sumY = room.vertices.reduce((sum, v) => sum + v.y, 0);
              centerX = sumX / room.vertices.length;
              centerY = sumY / room.vertices.length;
            }

            return (
              <React.Fragment key={room.id}>
                {/* Semi-transparent room area overlay - polygon with holes support */}
                {room.boundary && room.boundary.length >= 3 ? (
                  <Shape
                    sceneFunc={(context, shape) => {
                      // Draw outer boundary
                      context.beginPath();
                      context.moveTo(room.boundary![0].x, room.boundary![0].y);
                      for (let i = 1; i < room.boundary!.length; i++) {
                        context.lineTo(room.boundary![i].x, room.boundary![i].y);
                      }
                      context.closePath();

                      // Draw holes (interior walls) as cutouts
                      if (room.holes && room.holes.length > 0) {
                        for (const hole of room.holes) {
                          if (hole.length >= 3) {
                            context.moveTo(hole[0].x, hole[0].y);
                            // Draw holes in opposite direction for proper cutout
                            for (let i = hole.length - 1; i >= 0; i--) {
                              context.lineTo(hole[i].x, hole[i].y);
                            }
                            context.closePath();
                          }
                        }
                      }

                      context.fillStrokeShape(shape);
                    }}
                    fill={isSelected ? 'rgba(24, 144, 255, 0.1)' : 'rgba(135, 206, 250, 0.15)'}
                    stroke={isSelected ? 'rgba(24, 144, 255, 0.3)' : 'transparent'}
                    strokeWidth={1}
                    listening={!isDraggingFixture} // Disable room interaction during fixture drag
                  />
                ) : room.vertices && room.vertices.length >= 3 ? (
                  // Fallback for old format with vertices
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
                    listening={!isDraggingFixture} // Disable room interaction during fixture drag
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
                    listening={!isDraggingFixture} // Disable room interaction during fixture drag
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
                  listening={!isDraggingFixture} // Disable room text interaction during fixture drag
                  onMouseDown={(e) => {
                    // Don't start room drag if a fixture is being dragged
                    if (isDraggingFixture) {
                      return;
                    }

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

                      // Store initial positions of room fixtures
                      const roomFixtures = sketch?.roomFixtures.filter(f => f.roomId === room.id) || [];
                      const fixtureStartPositions: { [fixtureId: string]: Point } = {};
                      roomFixtures.forEach(fixture => {
                        fixtureStartPositions[fixture.id] = { ...fixture.position };
                      });

                      setRoomDragInfo({
                        roomIds: [room.id],
                        startPositions: {
                          [room.id]: {
                            x,  // Use the calculated x from bounds
                            y,  // Use the calculated y from bounds
                            width,
                            height,
                            wallPositions: wallStartPositions,
                            fixturePositions: fixtureStartPositions
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
          {(() => {
            // Check for duplicate wall IDs
            const wallIds = walls.map(w => w.id);
            const duplicates = wallIds.filter((id, index) => wallIds.indexOf(id) !== index);
            if (duplicates.length > 0) {
              console.warn('⚠️ Duplicate wall IDs found:', duplicates);
              console.log('All wall IDs:', wallIds);
            }
            return walls;
          })().map((wall) => {
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
                  stroke={isHighlighted ? '#1890ff' : '#999999'}
                  strokeWidth={isHighlighted ? 6 : 5}
                  lineCap="round"
                  lineJoin="round"
                  opacity={(isDragging && dragInfo?.wallId === wall.id) || (isMovingWalls && wallDragInfo?.wallIds.includes(wall.id)) ? 0.4 : 0.5}
                  listening={!isDraggingFixture} // Disable wall interaction during fixture drag
                  onClick={(e) => {
                    e.cancelBubble = true;
                    e.evt.stopPropagation();

                    // Ctrl/Cmd key for multi-select
                    const isMultiSelect = e.evt.ctrlKey || e.evt.metaKey;

                    if (isMultiSelect) {
                      // Toggle wall selection
                      if (selectedWallIds.includes(wall.id)) {
                        setSelectedWallIds(selectedWallIds.filter(id => id !== wall.id));
                      } else {
                        setSelectedWallIds([...selectedWallIds, wall.id]);
                      }
                    } else {
                      // Single select: clear others and select this wall
                      setSelectedWallIds([wall.id]);
                      setSelectedFixtureIds([]);
                      setSelectedRoomIds([]);
                    }
                  }}
                  onDblClick={(e) => handleWallDoubleClick(wall.id, e)}
                  style={{ cursor: 'pointer' }}
                />

                {/* Wall length label - hidden during fixture dragging for performance */}
                {!isDraggingFixture && (() => {
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
                      listening={true} // Enable interactions for editing
                      opacity={0.9}
                      onDblClick={(e) => {
                        e.cancelBubble = true;
                        handleWallDoubleClick(wall.id, e);
                      }}
                      style={{ cursor: 'pointer' }}
                    />
                  );
                })()}
              </React.Fragment>
            );
          })}

          {/* Wall segment lengths for fixtures */}
          {walls.map((wall) => {
            const sketchWall = sketch?.walls.find(w => w.id === wall.id);
            if (!sketchWall || !sketchWall.segments || sketchWall.segments.length <= 1) return null;

            // Only show segment lengths if wall has fixtures (more than 1 segment)
            return sketchWall.segments.map((segment, index) => {
              if (segment.type === 'fixture_gap') return null; // Skip fixture gaps

              // Calculate segment midpoint
              const midX = (segment.start.x + segment.end.x) / 2;
              const midY = (segment.start.y + segment.end.y) / 2;

              // Calculate perpendicular offset for text positioning
              const wallAngle = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
              const offsetDistance = 20; // Distance from wall
              const offsetX = Math.cos(wallAngle + Math.PI / 2) * offsetDistance;
              const offsetY = Math.sin(wallAngle + Math.PI / 2) * offsetDistance;

              return (
                <Text
                  key={`${wall.id}-segment-${index}`}
                  x={midX + offsetX}
                  y={midY + offsetY}
                  text={segment.length.display}
                  fontSize={12}
                  fontFamily="Arial"
                  fill="#666"
                  align="center"
                  verticalAlign="middle"
                  offsetX={segment.length.display.length * 3}
                  offsetY={6}
                  listening={false}
                  opacity={0.8}
                />
              );
            });
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

          {/* Draw wall split indicator */}
          {splitIndicator && (
            <>
              <Circle
                x={splitIndicator.x}
                y={splitIndicator.y}
                radius={8}
                stroke="#ff7875"
                strokeWidth={2}
                fill="transparent"
                dash={[2, 2]}
              />
              <Line
                points={[
                  splitIndicator.x - 10,
                  splitIndicator.y,
                  splitIndicator.x + 10,
                  splitIndicator.y
                ]}
                stroke="#ff7875"
                strokeWidth={2}
              />
              <Line
                points={[
                  splitIndicator.x,
                  splitIndicator.y - 10,
                  splitIndicator.x,
                  splitIndicator.y + 10
                ]}
                stroke="#ff7875"
                strokeWidth={2}
              />
              <Text
                x={splitIndicator.x + 15}
                y={splitIndicator.y - 15}
                text="Split"
                fontSize={11}
                fill="#ff7875"
                fontStyle="bold"
              />
            </>
          )}
        </Layer>

        {/* Fixtures Layer */}
        <Layer>
          {(() => {
            const sketchFixtures = sketch?.wallFixtures || [];
            const sketchWalls = sketch?.walls || [];

            // Debug: Check for mismatch details (updated to handle both original and segment IDs)
            const mismatchDetails = sketchFixtures.map(f => {
              const fixtureWallId = f.wallId;
              const originalWallId = fixtureWallId.includes('_segment_')
                ? fixtureWallId.split('_segment_')[0]
                : fixtureWallId;

              return {
                fixtureId: f.id.slice(0, 8),
                wallId: f.wallId,
                found: !!sketchWalls.find(w =>
                  w.id === fixtureWallId ||
                  w.id === originalWallId ||
                  w.id.startsWith(originalWallId + '_segment_')
                )
              };
            });

            if (mismatchDetails.some(d => !d.found)) {
              console.log('⚠️ Wall mismatch detected:', {
                sketchWallIds: sketchWalls.map(w => w.id),
                mismatchDetails: mismatchDetails.filter(d => !d.found)
              });
            }

            return (
              <FixtureLayer
                wallFixtures={sketchFixtures}
                roomFixtures={sketch?.roomFixtures || []}
                walls={sketchWalls} // Using sketch walls which include segments
                rooms={convertToSketchRooms(rooms)} // Convert local rooms to sketch rooms
            selectedFixtureIds={selectedFixtureIds}
            onDragStartFixture={() => setIsDraggingFixture(true)}
            onDragEndFixture={() => setIsDraggingFixture(false)}
            onSelectFixture={(fixtureId, ctrlKey) => {
              // Ctrl/Cmd key for multi-select
              if (ctrlKey) {
                // Toggle fixture selection
                if (selectedFixtureIds.includes(fixtureId)) {
                  setSelectedFixtureIds(selectedFixtureIds.filter(id => id !== fixtureId));
                  // Close segment editor if this fixture was being edited
                  if (segmentEditorFixtureId === fixtureId) {
                    setSegmentEditorFixtureId(null);
                  }
                } else {
                  setSelectedFixtureIds([...selectedFixtureIds, fixtureId]);
                }
              } else {
                // Single select: clear others and select this fixture
                setSelectedFixtureIds([fixtureId]);
                setSelectedWallIds([]);
                setSelectedRoomIds([]);

                // Open appropriate editor based on fixture type
                const wallFixture = sketch?.wallFixtures.find(f => f.id === fixtureId);
                const roomFixture = sketch?.roomFixtures.find(f => f.id === fixtureId);

                if (wallFixture) {
                  setSegmentEditorFixtureId(fixtureId);
                  setRoomFixtureEditorId(null);
                } else if (roomFixture) {
                  setRoomFixtureEditorId(fixtureId);
                  setSegmentEditorFixtureId(null);
                } else {
                  setSegmentEditorFixtureId(null);
                  setRoomFixtureEditorId(null);
                }
              }
            }}
            onContextMenu={(fixtureId, x, y) => {
              // Check if this is a signal to close the menu (x=-1, y=-1)
              if (x === -1 && y === -1) {
                setContextMenu({ visible: false, x: 0, y: 0, roomId: null, wallId: null, fixtureId: null, type: null });
                return;
              }
              // x, y are already in viewport coordinates (from containerRect)
              // Since context menu uses position: fixed, use them directly
              setContextMenu({
                visible: true,
                x: x,
                y: y,
                roomId: null,
                wallId: null,
                fixtureId,
                type: 'fixture'
              });
            }}
            onMoveWallFixture={(fixtureId, position) => {
              // Use the moveWallFixture function from context
              const result = moveWallFixture(fixtureId, position);
              if (!result.success) {
                console.error('Failed to move wall fixture:', result.error);
              }
            }}
            onMoveRoomFixture={(fixtureId, position) => {
              // Use the moveRoomFixture function from context
              const result = moveRoomFixture(fixtureId, position);
              if (!result.success) {
                console.error('Failed to move room fixture:', result.error);
              }
            }}
            onWallChange={(fixtureId, newWallId, position) => {
              // Use the changeWallFixtureWall function from context
              const result = changeWallFixtureWall(fixtureId, newWallId, position);
              if (!result.success) {
                console.error('Failed to change fixture wall:', result.error);
              }
            }}
            onRotateWallFixture={(fixtureId, rotation) => {
              // Use the rotateWallFixture function from context
              const result = rotateWallFixture(fixtureId, rotation);
              if (!result.success) {
                console.error('Failed to rotate wall fixture:', result.error);
              }
            }}
            onRotateRoomFixture={(fixtureId, rotation) => {
              // Use the rotateRoomFixture function from context
              const result = rotateRoomFixture(fixtureId, rotation);
              if (!result.success) {
                console.error('Failed to rotate room fixture:', result.error);
              }
            }}
            onResizeRoomFixture={(fixtureId, dimensions) => {
              // Use the updateRoomFixtureDimensions function from context
              const result = updateRoomFixtureDimensions(fixtureId, dimensions);
              if (!result.success) {
                console.error('Failed to resize room fixture:', result.error);
              }
            }}
          />
            );
          })()}
        </Layer>
      </Stage>

      {/* Context Menu - Use Portal to render directly in document.body to avoid parent transform issues */}
      {contextMenu.visible && createPortal(
        <div
          ref={contextMenuRef}
          style={{
            position: 'fixed',
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            zIndex: 200,
            backgroundColor: 'white',
            border: '1px solid #d9d9d9',
            borderRadius: '4px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            padding: '4px 0',
            minWidth: '150px',
            pointerEvents: 'auto'
          }}
          onMouseLeave={(e) => {
            // Check if mouse is moving to submenu
            const rect = e.currentTarget.getBoundingClientRect();
            const mouseX = e.clientX;
            const mouseY = e.clientY;

            // If submenu is visible and mouse is moving towards it, don't close
            if (subContextMenu.visible) {
              const subRect = document.querySelector('[data-submenu="true"]')?.getBoundingClientRect();
              if (subRect && mouseX >= rect.right - 5 && mouseX <= subRect.right + 5 &&
                  mouseY >= Math.min(rect.top, subRect.top) - 5 &&
                  mouseY <= Math.max(rect.bottom, subRect.bottom) + 5) {
                return;
              }
            }

            // Close both menus if mouse leaves and not moving to submenu
            setTimeout(() => {
              if (!subContextMenu.visible) {
                setContextMenu({ visible: false, x: 0, y: 0, roomId: null, wallId: null, fixtureId: null, type: null });
              }
            }, 100);
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
                        setContextMenu({ visible: false, x: 0, y: 0, roomId: null, wallId: null, fixtureId: null, type: null });
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
                  setWallsAndSync(prevWalls => prevWalls.filter(wall => wall.id !== contextMenu.wallId));

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
                  setContextMenu({ visible: false, x: 0, y: 0, roomId: null, wallId: null, fixtureId: null, type: null });
                }}
              >
                Delete Wall
              </div>
            </>
          )}

          {/* Fixture context menu */}
          {contextMenu.type === 'fixture' && contextMenu.fixtureId && (() => {
            const wallFixture = sketch?.wallFixtures?.find((f: any) => f.id === contextMenu.fixtureId);
            const roomFixture = sketch?.roomFixtures?.find((f: any) => f.id === contextMenu.fixtureId);
            const fixture = wallFixture || roomFixture;

            if (!fixture) return null;

            // Get available fixture variants based on category
            let availableVariants: any[] = [];
            if (fixture.category === 'door') {
              availableVariants = DOOR_VARIANTS;
            } else if (fixture.category === 'window') {
              availableVariants = WINDOW_VARIANTS;
            } else if (fixture.category === 'cabinet') {
              availableVariants = CABINET_VARIANTS;
            } else if (fixture.category === 'bathroom') {
              availableVariants = BATHROOM_VARIANTS;
            }

            return (
              <>
                {/* Change fixture type */}
                {availableVariants.length > 1 && (
                  <div
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#f5f5f5';
                        // Show submenu next to context menu
                        // Get actual context menu width and position from DOM
                        const contextMenuEl = contextMenuRef.current;
                        if (contextMenuEl) {
                          const contextMenuRect = contextMenuEl.getBoundingClientRect();
                          const menuItemRect = e.currentTarget.getBoundingClientRect();

                          // Calculate vertical offset relative to context menu's actual position
                          const verticalOffset = menuItemRect.top - contextMenuRect.top;

                          console.log('📍 Submenu positioning:');
                          console.log('  Context menu rect:', contextMenuRect);
                          console.log('  Menu item rect:', menuItemRect);
                          console.log('  Vertical offset:', verticalOffset);
                          console.log('  Submenu position:', {
                            x: contextMenuRect.right,
                            y: contextMenuRect.top + verticalOffset
                          });

                          setSubContextMenu({
                            visible: true,
                            x: contextMenuRect.right, // Position at right edge of context menu
                            y: contextMenuRect.top + verticalOffset,
                            parentId: 'changeType'
                          });
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'white';
                        // Close submenu when leaving the "Change Type" item
                        setSubContextMenu({ visible: false, x: 0, y: 0, parentId: '' });
                      }}
                    >
                      <span>Change Type</span>
                    </div>
                )}

                {/* Change size */}
                {availableVariants.length > 1 && (
                  <div style={{ borderBottom: '1px solid #f0f0f0', margin: '4px 0' }} />
                )}
                <div
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#f5f5f5';
                    // Close submenu when entering other menu items
                    setSubContextMenu({ visible: false, x: 0, y: 0, parentId: '' });
                  }}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
                  onClick={() => {
                    // Open fixture edit modal
                    const isWall = !!wallFixture;
                    setFixtureEditModal({
                      visible: true,
                      fixtureId: fixture.id,
                      isWallFixture: isWall
                    });

                    // Set initial form values (already in feet)
                    const formValues: any = {
                      width: fixture.dimensions.width,
                      height: fixture.dimensions.height
                    };

                    // Add sill height for windows if available
                    if (fixture.category === 'window' && fixture.properties?.sillHeight) {
                      formValues.sillHeight = fixture.properties.sillHeight.feet + (fixture.properties.sillHeight.inches / 12);
                    }

                    fixtureEditForm.setFieldsValue(formValues);

                    setContextMenu({ visible: false, x: 0, y: 0, roomId: null, wallId: null, fixtureId: null, type: null });
                  }}
                >
                  Change Size
                </div>

                {/* Delete fixture */}
                <div style={{ borderBottom: '1px solid #f0f0f0', margin: '4px 0' }} />
                <div
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    color: '#ff4d4f'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#fff1f0';
                    // Close submenu when entering other menu items
                    setSubContextMenu({ visible: false, x: 0, y: 0, parentId: '' });
                  }}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
                  onClick={() => {
                    if (wallFixture && removeWallFixture) {
                      removeWallFixture(wallFixture.id);
                    } else if (roomFixture && removeRoomFixture) {
                      removeRoomFixture(roomFixture.id);
                    }
                    setSelectedFixtureIds([]);
                    setContextMenu({ visible: false, x: 0, y: 0, roomId: null, wallId: null, fixtureId: null, type: null });
                  }}
                >
                  Delete Fixture
                </div>
              </>
            );
          })()}
        </div>,
        document.body
      )}

      {/* Sub Context Menu for Change Type */}
      {subContextMenu.visible && subContextMenu.parentId === 'changeType' && contextMenu.type === 'fixture' && contextMenu.fixtureId && (() => {
        const wallFixture = sketch?.wallFixtures?.find((f: any) => f.id === contextMenu.fixtureId);
        const roomFixture = sketch?.roomFixtures?.find((f: any) => f.id === contextMenu.fixtureId);
        const fixture = wallFixture || roomFixture;

        if (!fixture) {
          return null;
        }

        // Get available fixture variants based on category
        let availableVariants: any[] = [];
        if (fixture.category === 'door') {
          availableVariants = DOOR_VARIANTS;
        } else if (fixture.category === 'window') {
          availableVariants = WINDOW_VARIANTS;
        } else if (fixture.category === 'cabinet') {
          availableVariants = CABINET_VARIANTS;
        } else if (fixture.category === 'bathroom') {
          availableVariants = BATHROOM_VARIANTS;
        }

        console.log('🎨 Rendering submenu at:', { x: subContextMenu.x, y: subContextMenu.y });

        return createPortal(
          <div
            data-submenu="true"
            ref={(el) => {
              if (el) {
                const rect = el.getBoundingClientRect();
                console.log('📐 Submenu actual position:', rect);
              }
            }}
            style={{
              position: 'fixed',
              left: subContextMenu.x,
              top: subContextMenu.y,
              zIndex: 201,
              backgroundColor: 'white',
              border: '1px solid #d9d9d9',
              borderRadius: '4px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              padding: '4px 0',
              minWidth: '180px',
              pointerEvents: 'auto'
            }}
            onMouseEnter={() => {
              // Keep submenu open
              setSubContextMenu(prev => ({ ...prev, visible: true }));
            }}
            onMouseLeave={() => {
              // Close submenu and main menu when mouse leaves
              setSubContextMenu({ visible: false, x: 0, y: 0, parentId: '' });
              setContextMenu({ visible: false, x: 0, y: 0, roomId: null, wallId: null, fixtureId: null, type: null });
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {availableVariants.map(variant => (
              <div
                key={variant.id}
                style={{
                  padding: '8px 16px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  backgroundColor: variant.type === fixture.type ? '#e6f7ff' : 'white',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
                onMouseEnter={(e) => {
                  if (variant.type !== fixture.type) {
                    e.currentTarget.style.backgroundColor = '#f5f5f5';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = variant.type === fixture.type ? '#e6f7ff' : 'white';
                }}
                onClick={() => {
                  if (variant.type !== fixture.type) {
                    // Update fixture type
                    if (wallFixture && removeWallFixture && addWallFixture) {
                      const wall = walls.find(w => w.id === wallFixture.wallId);
                      if (wall) {
                        // Remove old fixture
                        removeWallFixture(wallFixture.id);
                        // Add new fixture with same position and dimensions from variant (already in inches)
                        addWallFixture(
                          wallFixture.wallId,
                          fixture.category as any,
                          variant.type as any,
                          variant.defaultDimensions,
                          wallFixture.position
                        );
                      }
                    } else if (roomFixture && removeRoomFixture && addRoomFixture) {
                      // Remove old fixture
                      removeRoomFixture(roomFixture.id);
                      // Add new fixture with same position and dimensions from variant (already in inches)
                      addRoomFixture(
                        roomFixture.roomId,
                        fixture.category as any,
                        variant.type as any,
                        variant.defaultDimensions,
                        roomFixture.position
                      );
                    }
                  }
                  setContextMenu({ visible: false, x: 0, y: 0, roomId: null, wallId: null, fixtureId: null, type: null });
                  setSubContextMenu({ visible: false, x: 0, y: 0, parentId: '' });
                }}
              >
                <span>{variant.name}</span>
                {variant.type === fixture.type && <span style={{ marginLeft: '8px', color: '#1890ff' }}>✓</span>}
              </div>
            ))}
          </div>,
          document.body
        );
      })()}

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

      {/* Fixture Edit Modal */}
      <Modal
        title="Edit Fixture Size"
        open={fixtureEditModal.visible}
        onCancel={() => {
          // Reset form and close modal
          fixtureEditForm.resetFields();
          setFixtureEditModal({ visible: false, fixtureId: null, isWallFixture: false });
        }}
        footer={null}
      >
        <Form
          form={fixtureEditForm}
          layout="vertical"
          onFinish={handleSaveFixtureSize}
          preserve={false}
        >
          <Form.Item
            label="Width (feet)"
            name="width"
            rules={[
              { required: true, message: 'Please enter fixture width!' },
              { type: 'number', min: 0.5, message: 'Width must be at least 0.5 feet!' }
            ]}
          >
            <InputNumber
              min={0.5}
              max={50}
              step={0.5}
              placeholder="Enter width in feet"
              style={{ width: '100%' }}
            />
          </Form.Item>

          <Form.Item
            label="Height (feet)"
            name="height"
            rules={[
              { required: true, message: 'Please enter fixture height!' },
              { type: 'number', min: 0.5, message: 'Height must be at least 0.5 feet!' }
            ]}
          >
            <InputNumber
              min={0.5}
              max={50}
              step={0.5}
              placeholder="Enter height in feet"
              style={{ width: '100%' }}
            />
          </Form.Item>

          {/* Window-specific: Sill Height (distance from floor to window bottom) */}
          {(() => {
            const fixture = fixtureEditModal.isWallFixture
              ? sketch?.wallFixtures?.find((f: any) => f.id === fixtureEditModal.fixtureId)
              : sketch?.roomFixtures?.find((f: any) => f.id === fixtureEditModal.fixtureId);
            return fixture?.category === 'window' ? (
              <Form.Item
                label="Sill Height (feet from floor)"
                name="sillHeight"
                tooltip="Distance from floor to bottom of window (for wall area calculation)"
                rules={[
                  { type: 'number', min: 0, message: 'Sill height must be at least 0 feet!' }
                ]}
              >
                <InputNumber
                  min={0}
                  max={10}
                  step={0.5}
                  placeholder="Enter sill height (e.g., 3.0 feet)"
                  style={{ width: '100%' }}
                />
              </Form.Item>
            ) : null;
          })()}

          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Button
              style={{ marginRight: 8 }}
              onClick={() => {
                // Reset form and close modal
                fixtureEditForm.resetFields();
                setFixtureEditModal({ visible: false, fixtureId: null, isWallFixture: false });
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
              updateWallLength(editingWallId, wallLengthInput.feet, wallLengthInput.inches);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
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
              updateWallLength(editingWallId, wallLengthInput.feet, wallLengthInput.inches);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
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

      {/* Wall Segment Editor - Render when a wall fixture is selected */}
      {segmentEditorFixtureId && sketch && (() => {
        const fixture = sketch.wallFixtures.find(f => f.id === segmentEditorFixtureId);
        if (!fixture) return null;

        const wall = sketch.walls.find(w => w.id === fixture.wallId);
        if (!wall) return null;

        // Calculate fixture position in world coordinates
        const wallAngle = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
        const fixtureWorldX = wall.start.x + Math.cos(wallAngle) * fixture.position;
        const fixtureWorldY = wall.start.y + Math.sin(wallAngle) * fixture.position;

        // Transform to screen coordinates (matching Konva's transformation)
        const stage = stageRef.current;
        const scale = stage ? stage.scaleX() : zoom;
        const stagePos = stage ? stage.position() : pan;

        const screenX = fixtureWorldX * scale + stagePos.x;
        const screenY = fixtureWorldY * scale + stagePos.y;

        // Position editor offset from fixture (adjust based on viewport)
        const editorX = screenX + 50 * scale;
        const editorY = screenY - 50 * scale;

        return (
          <WallSegmentEditor
            fixture={fixture}
            wall={wall}
            position={{ x: editorX, y: editorY }}
            onSegmentLengthChange={(side, lengthFeet) => {
              console.log(`🔧 Adjusting wall segment - fixture: ${segmentEditorFixtureId}, side: ${side}, length: ${lengthFeet} ft`);
              const result = adjustWallFixtureSegmentLength(segmentEditorFixtureId, side, lengthFeet);
              if (!result.success) {
                console.error('❌ Failed to adjust wall segment:', result.error);
              } else {
                console.log('✅ Wall segment adjusted successfully');
              }
            }}
          />
        );
      })()}

      {/* Room Fixture Editor - Render when a room fixture is selected */}
      {roomFixtureEditorId && sketch && (() => {
        const fixture = sketch.roomFixtures.find(f => f.id === roomFixtureEditorId);
        if (!fixture) return null;

        // Transform fixture position to screen coordinates
        const stage = stageRef.current;
        const scale = stage ? stage.scaleX() : zoom;
        const stagePos = stage ? stage.position() : pan;

        const screenX = fixture.position.x * scale + stagePos.x;
        const screenY = fixture.position.y * scale + stagePos.y;

        // Position editor offset from fixture
        const editorX = screenX + 50 * scale;
        const editorY = screenY - 30 * scale;

        return (
          <RoomFixtureEditor
            fixture={fixture}
            position={{ x: editorX, y: editorY }}
            onLabelChange={(label) => {
              updateRoomFixture(roomFixtureEditorId, { label });
            }}
            onColorChange={(fillColor, strokeColor) => {
              updateRoomFixture(roomFixtureEditorId, {
                style: {
                  ...fixture.style,
                  fillColor,
                  strokeColor
                }
              });
            }}
            onClose={() => setRoomFixtureEditorId(null)}
          />
        );
      })()}
    </div>
  );
};

export default SketchViewport;