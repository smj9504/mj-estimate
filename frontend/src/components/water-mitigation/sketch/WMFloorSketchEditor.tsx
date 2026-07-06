/**
 * WMFloorSketchEditor
 *
 * Core editor that composes all WM sketch UI for a single floor:
 *   - WMFloorPlanSource  (Draw / Import Image toggle)
 *   - WMSketchToolbar    (tools, undo/redo, save)
 *   - Konva Stage        (canvas with background + overlay layers)
 *   - WMSketchSidebar    (properties panel — collapsible Sider)
 *   - Status bar         (per-material-type square footage totals)
 *
 * Drawing interactions:
 *   demolition / containment / floor_protection — click-drag rectangle
 *   equipment — single click to place
 *   select    — click to select, Transformer for drag/resize
 *
 * Keyboard: Ctrl+Z (undo), Ctrl+Y / Ctrl+Shift+Z (redo), Ctrl+S (save),
 *           Delete / Backspace (remove selected element)
 *
 * Usage:
 *   <WMFloorSketchEditor
 *     floorSketch={floorSketch}
 *     materialTypes={materialTypes}
 *     onOverlayChanged={handleOverlayChanged}
 *     onSave={handleSave}
 *     onImageUploaded={handleImageUploaded}
 *     onImageRemoved={handleImageRemoved}
 *   />
 */

import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  useLayoutEffect,
} from 'react';
import {
  Typography,
  Tag,
  Space,
  Menu,
  theme,
  message,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  VerticalAlignTopOutlined,
  VerticalAlignBottomOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  DeleteOutlined,
  GroupOutlined,
  UngroupOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { Stage, Layer } from 'react-konva';
import type Konva from 'konva';
import type {
  WMFloorSketch,
  DemoMaterialType,
  WMOverlayData,
  WMDemolitionZone,
  WMEquipmentPlacement,
  WMContainmentZone,
  WMFloorProtection,
  WMContentProtection,
  WMContentManipulation,
  WMTextAnnotation,
  WMShapeAnnotation,
  WMWall,
  WMRoom,
  WMSketchSelection,
} from '../../../types/wmSketch';
import {
  EQUIPMENT_CONFIG,
  DEFAULT_DEMO_MATERIAL_TYPES,
  SHAPE_PRESETS,
  WALL_SNAP_THRESHOLD,
  DEFAULT_WALL_THICKNESS,
  DEFAULT_WALL_COLOR,
  DEFAULT_ROOM_COLOR,
  EA_ITEM_PIXEL_SIZES,
  getEffectiveRenderMode,
} from '../../../types/wmSketch';
import wmSketchService from '../../../services/wmSketchService';
import WMBackgroundImageLayer, { type ImageLoadStatus } from './canvas/WMBackgroundImageLayer';
import WMOverlayLayer from './canvas/WMOverlayLayer';
import { useWMSketchState } from './hooks/useWMSketchState';
import { useWMCalculations } from './hooks/useWMCalculations';
import { useWMSketchPersistence } from './hooks/useWMSketchPersistence';
import {
  generateOverlayId,
  pixelsToFeet,
  calcDemoZoneSqft,
  calcPolygonAreaSqft,
  calcContainmentSqft,
  calcFloorProtectionSqft,
  calcContentProtectionSqft,
} from './utils/wmCalculations';
import {
  DEFAULT_CONTAINMENT_COLOR,
  DEFAULT_CONTAINMENT_HEIGHT_FT,
  DEFAULT_FLOOR_PROTECTION_COLOR,
  DEFAULT_CONTENT_PROTECTION_COLOR,
  DEFAULT_CONTENT_MANIPULATION_COLOR,
  DEFAULT_PAPER_WIDTH_FT,
} from './utils/wmDefaults';
import WMFloorPlanSource from './WMFloorPlanSource';
import WMSketchToolbar from './WMSketchToolbar';
import WMSketchSidebar from './WMSketchSidebar';
import WMScaleCalibration from './canvas/WMScaleCalibration';
import WMLegendOverlay from './canvas/WMLegendOverlay';

const { Text } = Typography;

// ============================================================================
// Props
// ============================================================================

export interface WMFloorSketchEditorProps {
  floorSketch: WMFloorSketch;
  materialTypes: DemoMaterialType[];
  onOverlayChanged: (overlayData: WMOverlayData) => void;
  onSave: (overlayData: WMOverlayData, canvasSize?: { width: number; height: number }) => Promise<void>;
  onImageUploaded: (file: File) => Promise<void>;
  onImageRemoved: () => Promise<void>;
  onScaleChanged?: (scalePixelsPerFoot: number) => void;
  onImportFromMagicPlan?: () => void;
  isMagicPlanImporting?: boolean;
}

// ============================================================================
// Drawing state
// ============================================================================

interface DrawState {
  isDrawing: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

const INITIAL_DRAW_STATE: DrawState = {
  isDrawing: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
};

// ============================================================================
// Geometry helpers for room detection
// ============================================================================

/** Ray-casting point-in-polygon test */
function isPointInPolygon(point: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Signed area of a polygon (shoelace formula) */
function polygonArea(polygon: { x: number; y: number }[]): number {
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    area += (polygon[j].x + polygon[i].x) * (polygon[j].y - polygon[i].y);
  }
  return area / 2;
}

/**
 * Compute the convex hull of a set of 2D points using Andrew's monotone chain.
 * Returns vertices in counter-clockwise order.
 */
function convexHull(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  const sorted = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 2) return sorted;

  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  // Lower hull
  const lower: { x: number; y: number }[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  // Upper hull
  const upper: { x: number; y: number }[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  // Remove last point of each half because it's repeated
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Find the closest point on a line segment to a given point */
function closestPointOnSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): { x: number; y: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: ax, y: ay, t: 0 };
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + t * dx, y: ay + t * dy, t };
}

// ============================================================================
// Grid Layer (lightweight SVG-style Konva lines)
// ============================================================================

const GridLayer: React.FC<{
  width: number;
  height: number;
  scalePixelsPerFoot: number;
}> = React.memo(({ width, height, scalePixelsPerFoot }) => {
  const { Line } = require('react-konva');
  const step = scalePixelsPerFoot;
  if (step < 8) return null; // grid too dense to be useful

  const lines: React.ReactNode[] = [];
  // Vertical
  for (let x = 0; x <= width; x += step) {
    lines.push(
      <Line
        key={`v${x}`}
        points={[x, 0, x, height]}
        stroke="#e8e8e8"
        strokeWidth={0.5}
        listening={false}
      />
    );
  }
  // Horizontal
  for (let y = 0; y <= height; y += step) {
    lines.push(
      <Line
        key={`h${y}`}
        points={[0, y, width, y]}
        stroke="#e8e8e8"
        strokeWidth={0.5}
        listening={false}
      />
    );
  }
  return <Layer listening={false}>{lines}</Layer>;
});

// ============================================================================
// Status bar
// ============================================================================

const StatusBar: React.FC<{ overlayData: WMOverlayData; materialTypes: DemoMaterialType[] }> = ({
  overlayData,
  materialTypes,
}) => {
  const { token } = theme.useToken();

  // Inline summary to avoid extra hook nesting
  const byType = React.useMemo(() => {
    const map = new Map<string, { name: string; color: string; total: number; unit: 'SF' | 'LF' | 'EA' }>();
    for (const zone of overlayData.demolition_zones) {
      const existing = map.get(zone.material_type);
      const def =
        materialTypes.find((m) => m.id === zone.material_type) ??
        DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === zone.material_type);
      if (existing) {
        existing.total = Math.round((existing.total + zone.calculated_sqft) * 100) / 100;
      } else {
        map.set(zone.material_type, {
          name: def?.name ?? zone.material_type,
          color: zone.color,
          total: zone.calculated_sqft,
          unit: def?.unit ?? 'SF',
        });
      }
    }
    return Array.from(map.values());
  }, [overlayData.demolition_zones, materialTypes]);

  const { containment_zones, floor_protections, equipment_placements } = overlayData;
  const contentProtections = overlayData.content_protections ?? [];
  const contentManipulations = overlayData.content_manipulations ?? [];
  const containTotal = containment_zones.reduce((s, c) => s + c.calculated_sqft, 0);
  const protTotal = floor_protections.reduce((s, p) => s + p.calculated_sqft, 0);
  const contentProtTotal = contentProtections.reduce((s, cp) => s + cp.calculated_sqft, 0);
  const contentManipTotal = contentManipulations.reduce((s, cm) => s + (cm.hours ?? 0), 0);
  const eqCount = equipment_placements.length;

  if (byType.length === 0 && containment_zones.length === 0 && floor_protections.length === 0 && contentProtections.length === 0 && contentManipulations.length === 0 && eqCount === 0) {
    return (
      <div
        style={{
          padding: '4px 12px',
          background: '#fafafa',
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          alignItems: 'center',
          minHeight: 32,
        }}
      >
        <Text type="secondary" style={{ fontSize: 11 }}>
          No items on canvas — start drawing to see totals here.
        </Text>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '4px 12px',
        background: '#fafafa',
        borderTop: `1px solid ${token.colorBorderSecondary}`,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        minHeight: 32,
      }}
    >
      <Text type="secondary" style={{ fontSize: 11, marginRight: 4 }}>
        Totals:
      </Text>
      {byType.map((item) => (
        <Tag
          key={item.name}
          color={item.color}
          style={{ fontSize: 11, lineHeight: '18px', margin: 0 }}
        >
          {item.name}: {item.unit === 'EA' ? Math.round(item.total) : item.total.toFixed(1)} {item.unit}
        </Tag>
      ))}
      {containment_zones.length > 0 && (
        <Tag color="#0066FF" style={{ fontSize: 11, lineHeight: '18px', margin: 0 }}>
          Containment: {containTotal.toFixed(1)} SF
        </Tag>
      )}
      {floor_protections.length > 0 && (
        <Tag color="#FFD700" style={{ fontSize: 11, lineHeight: '18px', margin: 0 }}>
          Floor Prot: {protTotal.toFixed(1)} SF
        </Tag>
      )}
      {contentProtections.length > 0 && (
        <Tag color="#8B5CF6" style={{ fontSize: 11, lineHeight: '18px', margin: 0 }}>
          Content Prot: {contentProtTotal.toFixed(1)} SF
        </Tag>
      )}
      {contentManipulations.length > 0 && (
        <Tag color="#F97316" style={{ fontSize: 11, lineHeight: '18px', margin: 0 }}>
          Content Move: {contentManipTotal.toFixed(1)} hr
        </Tag>
      )}
      {eqCount > 0 && (
        <Tag style={{ fontSize: 11, lineHeight: '18px', margin: 0 }}>
          Equipment: {eqCount}
        </Tag>
      )}
    </div>
  );
};

// ============================================================================
// Spinner keyframes (injected once into <head>)
// ============================================================================
const SPINNER_STYLE_ID = 'wm-sketch-spinner';
if (typeof document !== 'undefined' && !document.getElementById(SPINNER_STYLE_ID)) {
  const style = document.createElement('style');
  style.id = SPINNER_STYLE_ID;
  style.textContent = '@keyframes wmSpinner{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
  document.head.appendChild(style);
}

// ============================================================================
// Wall ↔ Room sync helpers
// ============================================================================

const _ROOM_SYNC_EPS = 8;

/** When a wall is dragged (both endpoints move by dx,dy), update rooms that share those endpoints. */
function _syncRoomsFromWallMove(
  rooms: WMRoom[],
  wallEndpoints: { x: number; y: number }[],
  dx: number,
  dy: number,
  updateRoom: (patch: Partial<WMRoom> & { id: string }) => void,
  scale: number,
) {
  for (const room of rooms) {
    if (!room.boundary?.length) continue;
    let changed = false;
    const newBoundary = room.boundary.map((bp) => {
      const matches = wallEndpoints.some(
        (ep) => Math.abs(bp.x - ep.x) < _ROOM_SYNC_EPS && Math.abs(bp.y - ep.y) < _ROOM_SYNC_EPS
      );
      if (matches) { changed = true; return { x: bp.x + dx, y: bp.y + dy }; }
      return bp;
    });
    if (changed) {
      const area = Math.abs(_polyArea(newBoundary)) / (scale * scale);
      updateRoom({ id: room.id, boundary: newBoundary, area_sqft: area });
    }
  }
}

/** When a single wall endpoint moves from oldPt to newPt, update matching room boundary points. */
function _syncRoomsFromPointMove(
  rooms: WMRoom[],
  oldPt: { x: number; y: number },
  newPt: { x: number; y: number },
  updateRoom: (patch: Partial<WMRoom> & { id: string }) => void,
  scale: number,
) {
  for (const room of rooms) {
    if (!room.boundary?.length) continue;
    let changed = false;
    const newBoundary = room.boundary.map((bp) => {
      if (Math.abs(bp.x - oldPt.x) < _ROOM_SYNC_EPS && Math.abs(bp.y - oldPt.y) < _ROOM_SYNC_EPS) {
        changed = true;
        return { x: newPt.x, y: newPt.y };
      }
      return bp;
    });
    if (changed) {
      const area = Math.abs(_polyArea(newBoundary)) / (scale * scale);
      updateRoom({ id: room.id, boundary: newBoundary, area_sqft: area });
    }
  }
}

function _polyArea(pts: { x: number; y: number }[]): number {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return area / 2;
}

// ============================================================================
// Main Component
// ============================================================================

const WMFloorSketchEditor: React.FC<WMFloorSketchEditorProps> = ({
  floorSketch,
  materialTypes,
  onOverlayChanged,
  onSave,
  onImageUploaded,
  onImageRemoved,
  onScaleChanged,
  onImportFromMagicPlan,
  isMagicPlanImporting,
}) => {
  const { token } = theme.useToken();

  // ------------------------------------------------------------------
  // Scale calibration state
  // ------------------------------------------------------------------
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [activeShapePresetId, setActiveShapePresetId] = useState<string | null>(null);

  // ------------------------------------------------------------------
  // State management
  // ------------------------------------------------------------------
  const {
    state,
    setTool,
    selectElement,
    toggleSelectElement,
    deselect,
    selectedIds,
    batchMoveSelected,
    setActiveMaterialType,
    setActiveEquipmentType,
    addDemolitionZone,
    updateDemolitionZone,
    combineDemolitionZones,
    ungroupDemolitionZone,
    groupDemolitionZones,
    clearDemolitionGroup,
    rotateDemolitionGroup,
    moveDemolitionGroup,
    addEquipment,
    updateEquipment,
    addContainment,
    updateContainment,
    addFloorProtection,
    updateFloorProtection,
    addContentProtection,
    updateContentProtection,
    removeContentProtection,
    addContentManipulation,
    updateContentManipulation,
    removeContentManipulation,
    addTextAnnotation,
    updateTextAnnotation,
    removeTextAnnotation,
    removeDemolitionZone,
    removeEquipment,
    removeContainment,
    removeFloorProtection,
    addShape,
    updateShape,
    removeShape,
    addWall,
    updateWall,
    removeWall,
    addRoom,
    updateRoom,
    removeRoom,
    bringToFront,
    sendToBack,
    bringForward,
    sendBackward,
    loadOverlayData,
    mergeAiWallsRooms,
    markSaved,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useWMSketchState(floorSketch.overlay_data);

  // Remove room and its associated walls
  const removeRoomWithWalls = useCallback(
    (roomId: string) => {
      const room = (state.overlayData.rooms ?? []).find((r) => r.id === roomId);
      if (room?.boundary?.length) {
        const walls = state.overlayData.walls ?? [];
        const EPS = 10;
        const onBoundary = (px: number, py: number) =>
          room.boundary.some((bp) => Math.abs(bp.x - px) < EPS && Math.abs(bp.y - py) < EPS);
        for (const w of walls) {
          if (onBoundary(w.start_x, w.start_y) && onBoundary(w.end_x, w.end_y)) {
            removeWall(w.id);
          }
        }
      }
      removeRoom(roomId);
    },
    [state.overlayData.rooms, state.overlayData.walls, removeWall, removeRoom]
  );

  // Floor summary (for sidebar)
  const floorSummary = useWMCalculations(state.overlayData);

  // Notify parent on change
  useEffect(() => {
    onOverlayChanged(state.overlayData);
  }, [state.overlayData, onOverlayChanged]);

  // ------------------------------------------------------------------
  // Fixed canvas size (logical coordinate system — never changes with viewport)
  // ------------------------------------------------------------------
  const canvasWidth = floorSketch.canvas_width || 1200;
  const canvasHeight = floorSketch.canvas_height || 900;

  // ------------------------------------------------------------------
  // Viewport sizing via ResizeObserver (only affects the Stage DOM element)
  // ------------------------------------------------------------------
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });

  // ------------------------------------------------------------------
  // Persistence
  // ------------------------------------------------------------------
  const { save, isSaving } = useWMSketchPersistence({
    floorSketchId: floorSketch.id,
    overlayData: state.overlayData,
    isDirty: state.isDirty,
    onSaved: markSaved,
    autoSaveInterval: 30_000, // auto-save every 30s when dirty
  });

  const handleSave = useCallback(async () => {
    try {
      // Do NOT pass viewport stageSize as canvasSize — the logical canvas
      // dimensions are fixed and must not change with the browser window.
      await onSave(state.overlayData);
      markSaved();
      message.success('Floor sketch saved.');
    } catch {
      // onSave is responsible for error display
    }
  }, [onSave, state.overlayData, markSaved]);

  // Use the persistence hook save for Ctrl+S (already wired to service)
  const handleSaveShortcut = useCallback(async () => {
    try {
      await save();
    } catch {
      // error handled inside hook
    }
  }, [save]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setStageSize({
        width: Math.max(300, Math.floor(rect.width)),
        height: Math.max(200, Math.floor(rect.height)),
      });
    });
    observer.observe(el);
    // Initial measurement
    const rect = el.getBoundingClientRect();
    setStageSize({
      width: Math.max(300, Math.floor(rect.width)),
      height: Math.max(200, Math.floor(rect.height)),
    });
    return () => observer.disconnect();
  }, []);

  // ------------------------------------------------------------------
  // Stage zoom / pan
  // ------------------------------------------------------------------
  const stageRef = useRef<Konva.Stage>(null);
  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

  // ------------------------------------------------------------------
  // Fit-to-view: compute scale to fit logical canvas into viewport
  // ------------------------------------------------------------------
  const fitScale = Math.min(
    stageSize.width / canvasWidth,
    stageSize.height / canvasHeight,
  );

  // Load overlay & reset view when switching floors (no remount needed)
  // ------------------------------------------------------------------
  const prevFloorIdRef = useRef(floorSketch.id);
  useEffect(() => {
    if (prevFloorIdRef.current !== floorSketch.id) {
      prevFloorIdRef.current = floorSketch.id;
      setStageScale(fitScale);
      setStagePos({ x: 0, y: 0 });
    }
    loadOverlayData(floorSketch.overlay_data);
  }, [floorSketch.id, loadOverlayData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fit-to-view on initial load so the logical canvas fills the viewport
  // regardless of whether the viewport is smaller or larger than 1200×900.
  const initialFitDoneRef = useRef(false);
  useEffect(() => {
    if (!initialFitDoneRef.current && fitScale > 0) {
      initialFitDoneRef.current = true;
      setStageScale(fitScale);
    }
  }, [fitScale]);
  const isPanningRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });

  // Clipboard for copy/paste
  const clipboardRef = useRef<Array<{ type: string; data: Record<string, unknown> }>>([]);

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const scaleBy = 1.08;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const newScale =
      e.evt.deltaY < 0
        ? Math.min(oldScale * scaleBy, 8)
        : Math.max(oldScale / scaleBy, 0.2);

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };

    setStageScale(newScale);
    setStagePos(newPos);
  }, []);

  // ------------------------------------------------------------------
  // Drawing state
  // ------------------------------------------------------------------
  const [drawState, setDrawState] = useState<DrawState>(INITIAL_DRAW_STATE);
  // Refs to avoid stale closures in Konva event handlers.
  // Updated every render so event callbacks always see latest values.
  const drawStateRef = useRef(drawState);
  drawStateRef.current = drawState;
  const stateRef = useRef(state);
  stateRef.current = state;
  const materialTypesRef = useRef(materialTypes);
  materialTypesRef.current = materialTypes;
  // These refs are initialised with null and assigned later,
  // after the variables they track are declared further down.
  const wallDrawStartRef = useRef<{ x: number; y: number } | null>(null);
  const spaceDownRef = useRef(false);
  const activeShapePresetIdRef = useRef<string | null>(null);
  activeShapePresetIdRef.current = activeShapePresetId;
  const floorSketchRef = useRef(floorSketch);
  floorSketchRef.current = floorSketch;

  // Wrapper to update both state and ref synchronously
  const setDrawStateSync = useCallback((next: DrawState) => {
    drawStateRef.current = next;
    setDrawState(next);
  }, []);
  // Space key for pan mode
  const [spaceDown, setSpaceDown] = useState(false);
  spaceDownRef.current = spaceDown;

  // ------------------------------------------------------------------
  // Wall drawing state (click-click paradigm)
  // ------------------------------------------------------------------
  const [wallDrawStart, setWallDrawStart] = useState<{ x: number; y: number } | null>(null);
  wallDrawStartRef.current = wallDrawStart;
  const [wallDrawCursor, setWallDrawCursor] = useState<{ x: number; y: number } | null>(null);
  const [wallSnapEnd, setWallSnapEnd] = useState<{ x: number; y: number } | null>(null);

  // ------------------------------------------------------------------
  // Polygon drawing state (click-to-place vertices, double-click or close to finish)
  // ------------------------------------------------------------------
  const [polygonDrawPoints, setPolygonDrawPoints] = useState<{ x: number; y: number }[]>([]);
  const polygonDrawPointsRef = useRef<{ x: number; y: number }[]>([]);
  polygonDrawPointsRef.current = polygonDrawPoints;
  const [polygonDrawCursor, setPolygonDrawCursor] = useState<{ x: number; y: number } | null>(null);
  const POLYGON_CLOSE_THRESHOLD = 15; // px distance to first vertex to close

  /**
   * Find the nearest existing wall endpoint within snap threshold.
   * Returns the snapped point or the original point if no snap.
   */
  const snapToWallEndpoint = useCallback(
    (pos: { x: number; y: number }): { point: { x: number; y: number }; snapped: boolean } => {
      const walls = state.overlayData.walls ?? [];
      let closestDist = WALL_SNAP_THRESHOLD;
      let closestPt: { x: number; y: number } | null = null;

      for (const w of walls) {
        for (const ep of [{ x: w.start_x, y: w.start_y }, { x: w.end_x, y: w.end_y }]) {
          const d = Math.hypot(ep.x - pos.x, ep.y - pos.y);
          if (d < closestDist) {
            closestDist = d;
            closestPt = ep;
          }
        }
      }

      if (closestPt) return { point: closestPt, snapped: true };
      return { point: pos, snapped: false };
    },
    [state.overlayData.walls]
  );

  /**
   * Constrain a point to horizontal or vertical relative to start
   * when Shift is held.
   */
  const constrainToAxis = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }): { x: number; y: number } => {
      const dx = Math.abs(end.x - start.x);
      const dy = Math.abs(end.y - start.y);
      if (dx > dy) return { x: end.x, y: start.y }; // horizontal
      return { x: start.x, y: end.y }; // vertical
    },
    []
  );

  /**
   * Detect rooms: find the smallest closed polygon formed by walls that
   * contains the given point. Simplified flood-fill approach using
   * connected wall endpoints.
   */
  const detectRoomAtPoint = useCallback(
    (clickPos: { x: number; y: number }): { x: number; y: number }[] | null => {
      const walls = state.overlayData.walls ?? [];
      if (walls.length < 3) return null;

      // Build adjacency graph: endpoint → list of connected endpoints
      const EPS = 5; // tolerance for endpoint grouping
      const pointKey = (p: { x: number; y: number }) =>
        `${Math.round(p.x / EPS) * EPS},${Math.round(p.y / EPS) * EPS}`;

      // Use string[] arrays instead of Set to avoid downlevelIteration issues
      const adj = new Map<string, string[]>();
      const keyToPoint = new Map<string, { x: number; y: number }>();

      for (const w of walls) {
        const sk = pointKey({ x: w.start_x, y: w.start_y });
        const ek = pointKey({ x: w.end_x, y: w.end_y });
        keyToPoint.set(sk, { x: w.start_x, y: w.start_y });
        keyToPoint.set(ek, { x: w.end_x, y: w.end_y });

        if (!adj.has(sk)) adj.set(sk, []);
        if (!adj.has(ek)) adj.set(ek, []);
        const skArr = adj.get(sk)!;
        const ekArr = adj.get(ek)!;
        if (skArr.indexOf(ek) === -1) skArr.push(ek);
        if (ekArr.indexOf(sk) === -1) ekArr.push(sk);
      }

      // Find the smallest closed polygon that contains the click point using BFS
      const allNodes = Array.from(adj.keys());
      let bestCycle: string[] | null = null;
      let bestArea = Infinity;

      for (const startNode of allNodes) {
        const neighbors = adj.get(startNode);
        if (!neighbors || neighbors.length < 2) continue;

        // BFS to find short cycles from startNode
        const queue: { path: string[]; visitedSet: string[] }[] = [];
        for (let ni = 0; ni < neighbors.length; ni++) {
          queue.push({ path: [startNode, neighbors[ni]], visitedSet: [startNode, neighbors[ni]] });
        }

        while (queue.length > 0) {
          const { path, visitedSet } = queue.shift()!;
          const current = path[path.length - 1];
          const currentNeighbors = adj.get(current);
          if (!currentNeighbors) continue;

          for (let ni = 0; ni < currentNeighbors.length; ni++) {
            const next = currentNeighbors[ni];
            if (next === startNode && path.length >= 3) {
              // Found a cycle!
              const polygon = path.map((k) => keyToPoint.get(k)!);
              if (isPointInPolygon(clickPos, polygon)) {
                const area = Math.abs(polygonArea(polygon));
                if (area < bestArea && area > 100) {
                  bestArea = area;
                  bestCycle = path;
                }
              }
              continue;
            }
            if (visitedSet.indexOf(next) !== -1 || path.length >= 8) continue;
            queue.push({ path: [...path, next], visitedSet: [...visitedSet, next] });
          }
        }
      }

      if (bestCycle) {
        return bestCycle.map((k) => keyToPoint.get(k)!);
      }

      return null;
    },
    [state.overlayData.walls]
  );

  /**
   * Auto-detect and create rooms from closed wall polygons.
   * Called after a wall is placed or a wall endpoint is dragged.
   * Checks each vertex to find new closed polygons not already covered by an existing room.
   *
   * @param wallsOverride optional walls array (for checking just-added walls not yet in state)
   */
  const autoDetectRooms = useCallback(
    (wallsOverride?: WMWall[]) => {
      const walls = wallsOverride ?? (state.overlayData.walls ?? []);
      if (walls.length < 3) return;

      const existingRooms = state.overlayData.rooms ?? [];

      // Build adjacency graph (EPS=10 to handle AI-generated slight misalignment)
      const EPS = 10;
      const pointKey = (p: { x: number; y: number }) =>
        `${Math.round(p.x / EPS) * EPS},${Math.round(p.y / EPS) * EPS}`;

      const adj = new Map<string, string[]>();
      const keyToPoint = new Map<string, { x: number; y: number }>();

      for (const w of walls) {
        const sk = pointKey({ x: w.start_x, y: w.start_y });
        const ek = pointKey({ x: w.end_x, y: w.end_y });
        keyToPoint.set(sk, { x: w.start_x, y: w.start_y });
        keyToPoint.set(ek, { x: w.end_x, y: w.end_y });
        if (!adj.has(sk)) adj.set(sk, []);
        if (!adj.has(ek)) adj.set(ek, []);
        const skArr = adj.get(sk)!;
        const ekArr = adj.get(ek)!;
        if (skArr.indexOf(ek) === -1) skArr.push(ek);
        if (ekArr.indexOf(sk) === -1) ekArr.push(sk);
      }

      // Find all minimal cycles
      const allNodes = Array.from(adj.keys());
      const foundCycles: { x: number; y: number }[][] = [];
      const cycleSignatures = new Set<string>();

      for (const startNode of allNodes) {
        const neighbors = adj.get(startNode);
        if (!neighbors || neighbors.length < 2) continue;

        const queue: { path: string[]; visited: string[] }[] = [];
        for (const n of neighbors) {
          queue.push({ path: [startNode, n], visited: [startNode, n] });
        }

        while (queue.length > 0) {
          const { path, visited } = queue.shift()!;
          const current = path[path.length - 1];
          const currentNeighbors = adj.get(current);
          if (!currentNeighbors) continue;

          for (const next of currentNeighbors) {
            if (next === startNode && path.length >= 3) {
              const polygon = path.map((k) => keyToPoint.get(k)!);
              const area = Math.abs(polygonArea(polygon));
              if (area > 100) {
                // Create a canonical signature (sorted keys) to avoid duplicate cycles
                const sig = [...path].sort().join('|');
                if (!cycleSignatures.has(sig)) {
                  cycleSignatures.add(sig);
                  foundCycles.push(polygon);
                }
              }
              continue;
            }
            if (visited.indexOf(next) !== -1 || path.length >= 8) continue;
            queue.push({ path: [...path, next], visited: [...visited, next] });
          }
        }
      }

      // For each found cycle, check if a room with similar boundary already exists
      for (const polygon of foundCycles) {
        const centroid = {
          x: polygon.reduce((s, p) => s + p.x, 0) / polygon.length,
          y: polygon.reduce((s, p) => s + p.y, 0) / polygon.length,
        };

        // Check if any existing room centroid is close to this polygon's centroid
        const alreadyExists = existingRooms.some((room) => {
          if (!room.boundary || room.boundary.length < 3) return false;
          const rc = {
            x: room.boundary.reduce((s, p) => s + p.x, 0) / room.boundary.length,
            y: room.boundary.reduce((s, p) => s + p.y, 0) / room.boundary.length,
          };
          return Math.hypot(rc.x - centroid.x, rc.y - centroid.y) < 30;
        });

        if (!alreadyExists) {
          const scale = floorSketch.scale_pixels_per_foot;
          const areaPixels = Math.abs(polygonArea(polygon));
          const areaSqft = areaPixels / (scale * scale);
          const roomNum = existingRooms.length + foundCycles.indexOf(polygon) + 1;
          const newId = generateOverlayId();
          const room: WMRoom = {
            id: newId,
            floor_sketch_id: floorSketch.id,
            name: `Room ${roomNum}`,
            boundary: polygon,
            color: DEFAULT_ROOM_COLOR,
            height_ft: 8,
            area_sqft: areaSqft,
            wall_ids: [],
          };
          addRoom(room);
          message.success(`Room auto-detected (${areaSqft.toFixed(0)} SF)`);
        }
      }
    },
    [state.overlayData.walls, state.overlayData.rooms, floorSketch.scale_pixels_per_foot, floorSketch.id, addRoom]
  );

  // Helper: get canvas-space coordinates from a Konva event
  const getCanvasPos = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>): { x: number; y: number } => {
      const stage = stageRef.current;
      if (!stage) return { x: 0, y: 0 };
      const ptr = stage.getPointerPosition();
      if (!ptr) return { x: 0, y: 0 };
      return {
        x: (ptr.x - stage.x()) / stage.scaleX(),
        y: (ptr.y - stage.y()) / stage.scaleY(),
      };
    },
    []
  );

  /** Select a newly placed element, bring it to front, and switch to select tool */
  const selectNewElement = useCallback(
    (id: string, type: string) => {
      selectElement({ element_id: id, element_type: type as import('../../../types/wmSketch').WMSketchSelection['element_type'] });
      bringToFront(id);
      setTool('select');
    },
    [selectElement, bringToFront, setTool]
  );

  /** Finalize a polygon demolition zone from accumulated polygon drawing points */
  const finalizePolygon = useCallback(
    (points: { x: number; y: number }[]) => {
      if (points.length < 3) {
        setPolygonDrawPoints([]);
        setPolygonDrawCursor(null);
        return;
      }

      const st = stateRef.current;
      const fs = floorSketchRef.current;
      const mats = materialTypesRef.current;

      const matId = st.activeMaterialTypeId ?? mats[0]?.id ?? 'ceiling';
      const matDef =
        mats.find((m) => m.id === matId) ??
        DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === matId);

      // Compute bounding box origin
      let minX = Infinity, minY = Infinity;
      for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
      }

      // Store points relative to the zone's (x, y) = (minX, minY)
      const relativePoints = points.map((p) => ({
        x: p.x - minX,
        y: p.y - minY,
      }));

      const areaSqft = calcPolygonAreaSqft(points, fs.scale_pixels_per_foot);

      const newId = generateOverlayId();
      const zone: WMDemolitionZone = {
        id: newId,
        floor_sketch_id: fs.id,
        material_type: matId,
        surface: matDef?.surface ?? 'ceiling',
        color: matDef?.color ?? '#228B22',
        x: minX,
        y: minY,
        dimension1_ft: 0,
        dimension2_ft: 0,
        rotation: 0,
        calculated_sqft: areaSqft,
        display_order: st.overlayData.demolition_zones.length,
        render_mode: matDef?.render_mode,
        stroke_style: matDef?.stroke_style,
        fill_opacity: matDef?.fill_opacity,
        polygon_points: relativePoints,
      };

      addDemolitionZone(zone);
      selectNewElement(newId, 'demolition');
      setPolygonDrawPoints([]);
      setPolygonDrawCursor(null);
    },
    [addDemolitionZone, selectNewElement],
  );

  // ------------------------------------------------------------------
  // Combine / Ungroup demolition zones
  // ------------------------------------------------------------------

  /**
   * Convert a rect zone to absolute polygon points (canvas coords).
   * Returns 4 corners of the rectangle, accounting for rotation.
   */
  const rectToAbsolutePolygon = useCallback(
    (zone: WMDemolitionZone): { x: number; y: number }[] => {
      const scale = floorSketch.scale_pixels_per_foot;
      let w: number, h: number;
      if (zone.dimension1_ft > 0 && zone.dimension2_ft > 0) {
        w = zone.dimension1_ft * scale;
        h = zone.dimension2_ft * scale;
      } else {
        w = zone.pixel_width || 60;
        h = zone.pixel_height || 40;
      }
      // Rectangle corners in local coords
      const corners = [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];
      // Apply rotation around (0,0) then translate
      const rad = (zone.rotation || 0) * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      return corners.map((c) => ({
        x: zone.x + c.x * cos - c.y * sin,
        y: zone.y + c.x * sin + c.y * cos,
      }));
    },
    [floorSketch.scale_pixels_per_foot],
  );

  /**
   * Get absolute polygon points for any demolition zone (rect or polygon).
   */
  const getAbsolutePoints = useCallback(
    (zone: WMDemolitionZone): { x: number; y: number }[] => {
      if (zone.polygon_points && zone.polygon_points.length >= 3) {
        return zone.polygon_points.map((p) => ({ x: p.x + zone.x, y: p.y + zone.y }));
      }
      return rectToAbsolutePolygon(zone);
    },
    [rectToAbsolutePolygon],
  );

  /**
   * Combine selected demolition zones into a single polygon zone.
   * All zones must be the same material type.
   * The combined zone stores original zones in `combined_from` for ungroup.
   */
  const combineSelectedZones = useCallback(() => {
    const st = stateRef.current;
    const demoSelections = st.selections.filter((s) => s.element_type === 'demolition');
    if (demoSelections.length < 2) {
      message.warning('Combine하려면 2개 이상의 demolition 요소를 선택하세요.');
      return;
    }

    const zones = demoSelections
      .map((s) => st.overlayData.demolition_zones.find((z) => z.id === s.element_id))
      .filter((z): z is WMDemolitionZone => z != null);

    if (zones.length < 2) return;

    // All zones must have the same material type
    const materialType = zones[0].material_type;
    const mixedMaterials = zones.some((z) => z.material_type !== materialType);
    if (mixedMaterials) {
      message.warning('같은 Material Type의 요소만 Combine할 수 있습니다.');
      return;
    }

    const fs = floorSketchRef.current;
    const mats = materialTypesRef.current;
    const matDef = mats.find((m) => m.id === materialType) ??
      DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === materialType);

    // Save clean copies of original zones (without nested combined_from to avoid bloat)
    const originalZones: WMDemolitionZone[] = zones.map((z) => {
      const { combined_from, ...rest } = z;
      return rest;
    });

    const isLF = matDef?.unit === 'LF';
    const isLine = isLF || (matDef?.surface === 'wall' && matDef?.unit === 'SF');
    const renderMode = matDef ? getEffectiveRenderMode(matDef) : 'area';
    const isLineRender = renderMode === 'line' || isLine;

    if (isLineRender) {
      // ---- LF / Line zones: logical grouping only (no merge) ----
      // Each line stays in its original position. Just assign a shared group_id.
      const groupId = generateOverlayId();
      groupDemolitionZones(zones.map((z) => z.id), groupId);
      const totalLF = zones.reduce((sum, z) => sum + z.dimension1_ft, 0);
      message.success(`${zones.length}개 요소가 그룹되었습니다. (${totalLF.toFixed(1)} ${matDef?.unit || 'LF'})`);
    } else {
      // ---- Area (SF) zones: merge into convex hull polygon ----
      const allPolygons = zones.map((z) => getAbsolutePoints(z));
      const allPts: { x: number; y: number }[] = [];
      for (const poly of allPolygons) {
        for (const p of poly) allPts.push(p);
      }

      const hull = convexHull(allPts);
      if (hull.length < 3) return;

      let minX = Infinity, minY = Infinity;
      for (const p of hull) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
      }
      const relativePoints = hull.map((p) => ({ x: p.x - minX, y: p.y - minY }));

      const totalSqft = zones.reduce((sum, z) => sum + z.calculated_sqft, 0);
      const newId = generateOverlayId();
      const combinedZone: WMDemolitionZone = {
        id: newId,
        floor_sketch_id: fs.id,
        material_type: materialType,
        sub_type: zones[0].sub_type,
        surface: zones[0].surface,
        color: zones[0].color,
        x: minX,
        y: minY,
        dimension1_ft: 0,
        dimension2_ft: 0,
        rotation: 0,
        calculated_sqft: Math.round(totalSqft * 100) / 100,
        display_order: st.overlayData.demolition_zones.length,
        render_mode: matDef?.render_mode,
        stroke_style: matDef?.stroke_style,
        fill_opacity: matDef?.fill_opacity,
        polygon_points: relativePoints,
        combined_from: originalZones,
        label: `Combined (${zones.length})`,
      };

      combineDemolitionZones(zones.map((z) => z.id), combinedZone);
      selectElement({ element_id: newId, element_type: 'demolition' });
      message.success(`${zones.length}개 요소가 Combine 되었습니다.`);
    }
  }, [getAbsolutePoints, combineDemolitionZones, groupDemolitionZones, selectElement]);

  /**
   * Ungroup a combined zone back into its original individual zones.
   */
  /**
   * Ungroup: handles both combined_from (area merge) and group_id (line grouping).
   */
  const ungroupZone = useCallback((zoneId: string) => {
    const st = stateRef.current;
    const zone = st.overlayData.demolition_zones.find((z) => z.id === zoneId);
    if (!zone) return;

    // Case 1: Area polygon combine (combined_from) — restore originals
    if (zone.combined_from && zone.combined_from.length > 0) {
      const fs = floorSketchRef.current;
      const restoredZones: WMDemolitionZone[] = [];
      for (const original of zone.combined_from) {
        const newId = generateOverlayId();
        restoredZones.push({ ...original, id: newId, floor_sketch_id: fs.id });
      }
      ungroupDemolitionZone(zoneId, restoredZones);
      if (restoredZones.length > 0) {
        selectElement({ element_id: restoredZones[0].id, element_type: 'demolition' });
        for (let i = 1; i < restoredZones.length; i++) {
          toggleSelectElement({ element_id: restoredZones[i].id, element_type: 'demolition' });
        }
      }
      message.success(`${restoredZones.length}개 요소로 Ungroup 되었습니다.`);
      return;
    }

    // Case 2: Line group_id grouping — just clear the group_id
    if (zone.group_id) {
      const groupId = zone.group_id;
      const groupZones = st.overlayData.demolition_zones.filter((z) => z.group_id === groupId);
      clearDemolitionGroup(groupId);
      message.success(`${groupZones.length}개 요소의 그룹이 해제되었습니다.`);
      return;
    }

    message.warning('이 요소는 Ungroup할 수 없습니다.');
  }, [ungroupDemolitionZone, clearDemolitionGroup, selectElement, toggleSelectElement]);

  // ------------------------------------------------------------------
  // Right-click context menu
  // ------------------------------------------------------------------
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Attach native contextmenu listener on the canvas container div
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      // Always show context menu on canvas — even without selection
      // (the menu will show available actions based on current state)
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY });
    };
    el.addEventListener('contextmenu', handler);
    return () => el.removeEventListener('contextmenu', handler);
  }, []);

  // Close context menu on any click or scroll
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('wheel', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('wheel', close);
    };
  }, [contextMenu]);

  const contextMenuItems: MenuProps['items'] = React.useMemo(() => {
    const sel = state.selections;
    const items: MenuProps['items'] = [];

    // --- Combine / Ungroup (always shown for demolition zones) ---
    const demoSels = sel.filter((s) => s.element_type === 'demolition');
    const demoZones = demoSels
      .map((s) => state.overlayData.demolition_zones.find((z) => z.id === s.element_id))
      .filter((z): z is WMDemolitionZone => z != null);

    const canCombine = demoZones.length >= 2 &&
      demoZones.every((z) => z.material_type === demoZones[0].material_type);

    // Zones with combined_from (area merge)
    const combinedFromZones = demoZones.filter(
      (z) => z.combined_from && z.combined_from.length > 0
    );
    // Zones with group_id (line grouping)
    const groupedZones = demoZones.filter((z) => !!z.group_id);
    const hasUngroupable = combinedFromZones.length > 0 || groupedZones.length > 0;

    // Always show Combine/Ungroup when at least 1 demolition zone is selected
    if (demoZones.length > 0) {
      // Combine — enabled when 2+ same-material demo zones selected
      const combineDisabledReason =
        demoZones.length < 2
          ? 'Ctrl+Click으로 2개 이상 선택'
          : !demoZones.every((z) => z.material_type === demoZones[0].material_type)
            ? '같은 Material만 가능'
            : '';
      items.push({
        key: 'combine',
        icon: <GroupOutlined />,
        label: canCombine
          ? `Combine ${demoZones.length}개 요소`
          : `Combine${combineDisabledReason ? ` (${combineDisabledReason})` : ''}`,
        disabled: !canCombine,
        onClick: canCombine ? () => combineSelectedZones() : undefined,
      });

      // Ungroup
      if (combinedFromZones.length > 0) {
        for (const uz of combinedFromZones) {
          items.push({
            key: `ungroup-${uz.id}`,
            icon: <UngroupOutlined />,
            label: `Ungroup → ${uz.combined_from!.length}개로 분리`,
            onClick: () => ungroupZone(uz.id),
          });
        }
      } else if (groupedZones.length > 0) {
        // Find unique group_ids among selected zones
        const seen: Record<string, boolean> = {};
        const groupIds: string[] = [];
        for (const gz of groupedZones) {
          if (gz.group_id && !seen[gz.group_id]) {
            seen[gz.group_id] = true;
            groupIds.push(gz.group_id);
          }
        }
        for (const gid of groupIds) {
          const groupCount = state.overlayData.demolition_zones.filter((z) => z.group_id === gid).length;
          items.push({
            key: `ungroup-grp-${gid}`,
            icon: <UngroupOutlined />,
            label: `Ungroup (${groupCount}개 그룹 해제)`,
            onClick: () => ungroupZone(groupedZones.find((z) => z.group_id === gid)!.id),
          });
        }
      } else {
        items.push({
          key: 'ungroup',
          icon: <UngroupOutlined />,
          label: 'Ungroup (그룹된 요소만 가능)',
          disabled: true,
        });
      }

      items.push({ type: 'divider' as const, key: 'div-combine' });
    }

    // --- Flip (for door shapes) ---
    if (sel.length === 1 && sel[0].element_type === 'shape') {
      const shapeEl = (state.overlayData.shapes ?? []).find((s) => s.id === sel[0].element_id);
      if (shapeEl?.preset_id === 'door') {
        items.push({
          key: 'flip-door',
          icon: <SwapOutlined />,
          label: `Flip Door (${shapeEl.flip_x ? '← Left' : 'Right →'})`,
          onClick: () => updateShape({ id: shapeEl.id, flip_x: !shapeEl.flip_x }),
        });
        items.push({ type: 'divider' as const, key: 'div-flip' });
      }
    }

    // --- Z-order (only when something is selected) ---
    if (sel.length > 0) {
      const id = sel[0].element_id;
      items.push(
        {
          key: 'bring-front',
          icon: <VerticalAlignTopOutlined />,
          label: 'Bring to Front',
          onClick: () => bringToFront(id),
        },
        {
          key: 'bring-forward',
          icon: <ArrowUpOutlined />,
          label: 'Bring Forward',
          onClick: () => bringForward(id),
        },
        {
          key: 'send-backward',
          icon: <ArrowDownOutlined />,
          label: 'Send Backward',
          onClick: () => sendBackward(id),
        },
        {
          key: 'send-back',
          icon: <VerticalAlignBottomOutlined />,
          label: 'Send to Back',
          onClick: () => sendToBack(id),
        },
        { type: 'divider' as const, key: 'div-1' },
        {
          key: 'delete',
          icon: <DeleteOutlined />,
          label: sel.length > 1 ? `Delete ${sel.length}개 요소` : 'Delete',
          danger: true,
          onClick: () => {
            for (const s of sel) {
              const { element_id, element_type } = s;
              if (element_type === 'demolition') removeDemolitionZone(element_id);
              else if (element_type === 'equipment') removeEquipment(element_id);
              else if (element_type === 'containment') removeContainment(element_id);
              else if (element_type === 'floor_protection') removeFloorProtection(element_id);
              else if (element_type === 'content_protection') removeContentProtection(element_id);
              else if (element_type === 'content_manipulation') removeContentManipulation(element_id);
              else if (element_type === 'text') removeTextAnnotation(element_id);
              else if (element_type === 'shape') removeShape(element_id);
              else if (element_type === 'wall') removeWall(element_id);
              else if (element_type === 'room') removeRoomWithWalls(element_id);
            }
          },
        },
      );
    }

    return items;
  }, [state.selections, state.overlayData.demolition_zones, state.overlayData.shapes, bringToFront, bringForward, sendBackward, sendToBack, removeDemolitionZone, removeEquipment, removeContainment, removeFloorProtection, removeContentProtection, removeTextAnnotation, removeShape, removeWall, removeRoomWithWalls, combineSelectedZones, ungroupZone, updateShape]);

  // ------------------------------------------------------------------
  // Mouse event handlers on Stage
  // ------------------------------------------------------------------
  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      setContextMenu(null);
      const st = stateRef.current;
      const mats = materialTypesRef.current;
      const fs = floorSketchRef.current;
      // Middle mouse or space+left or pan tool = pan
      if (e.evt.button === 1 || spaceDownRef.current || st.activeTool === 'pan') {
        isPanningRef.current = true;
        lastPointerRef.current = { x: e.evt.clientX, y: e.evt.clientY };
        return;
      }
      if (e.evt.button !== 0) return;

      const pos = getCanvasPos(e);
      const { activeTool } = st;

      if (activeTool === 'select') {
        // Deselect when clicking on empty stage
        if (e.target === e.target.getStage()) {
          deselect();
        }
        return;
      }

      if (
        activeTool === 'demolition' ||
        activeTool === 'demolition_line' ||
        activeTool === 'containment' ||
        activeTool === 'floor_protection' ||
        activeTool === 'content_protection' ||
        activeTool === 'content_manipulation'
      ) {
        // Wall and baseboard (LF-unit) demo types cannot be drawn on the 2D canvas.
        // They are added via the sidebar "Add" button only.
        if (activeTool === 'demolition') {
          const matId = st.activeMaterialTypeId ?? mats[0]?.id ?? 'wood_floor';
          const matDef =
            mats.find((m) => m.id === matId) ??
            DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === matId);
          const effectiveRenderMode = matDef ? getEffectiveRenderMode(matDef) : 'area';

          // Text mode: click-to-place a text label
          if (effectiveRenderMode === 'text') {
            const newId = generateOverlayId();
            const zone: WMDemolitionZone = {
              id: newId,
              floor_sketch_id: fs.id,
              material_type: matId,
              surface: matDef?.surface ?? 'floor',
              color: matDef?.color ?? '#333333',
              x: pos.x,
              y: pos.y,
              dimension1_ft: 0,
              dimension2_ft: 0,
              rotation: 0,
              calculated_sqft: 0,
              display_order: st.overlayData.demolition_zones.length,
              render_mode: 'text',
              stroke_style: matDef?.stroke_style,
              fill_opacity: matDef?.fill_opacity,
            };
            addDemolitionZone(zone);
            selectNewElement(newId, 'demolition');
            return;
          }

          // EA items or shape mode: click-to-place like equipment
          if (matDef?.unit === 'EA' || effectiveRenderMode === 'shape') {
            const sizeMap = EA_ITEM_PIXEL_SIZES[matId] ?? {};
            const defaultSize = sizeMap[''] ?? { w: 36, h: 36 };
            const isStair = matId === 'stair_demo';
            const newId = generateOverlayId();
            const zone: WMDemolitionZone = {
              id: newId,
              floor_sketch_id: fs.id,
              material_type: matId,
              surface: matDef?.surface ?? 'wall',
              color: matDef?.color ?? '#5B9BD5',
              x: pos.x - defaultSize.w / 2,
              y: pos.y - defaultSize.h / 2,
              dimension1_ft: isStair ? 0 : 1,
              dimension2_ft: 0,
              rotation: 0,
              calculated_sqft: isStair ? 0 : 1,
              display_order: st.overlayData.demolition_zones.length,
              pixel_width: defaultSize.w,
              pixel_height: defaultSize.h,
              render_mode: effectiveRenderMode,
              stroke_style: matDef?.stroke_style,
              fill_opacity: matDef?.fill_opacity,
            };
            addDemolitionZone(zone);
            selectNewElement(newId, 'demolition');
            return;
          }
          // Line render mode: handled by demolition_line tool activation in toolbar
          if (effectiveRenderMode === 'line') {
            return;
          }
          // Wall and baseboard (LF-unit) types: sidebar only, no canvas drawing
          if (matDef?.surface === 'wall' || matDef?.unit === 'LF') {
            return;
          }
        }

        setDrawStateSync({
          isDrawing: true,
          startX: pos.x,
          startY: pos.y,
          currentX: pos.x,
          currentY: pos.y,
        });
        return;
      }

      if (activeTool === 'equipment') {
        const equipType = st.activeEquipmentType ?? 'air_mover';
        const cfg = EQUIPMENT_CONFIG[equipType];
        const newId = generateOverlayId();
        const placement: WMEquipmentPlacement = {
          id: newId,
          floor_sketch_id: fs.id,
          equipment_type: equipType,
          x: pos.x,
          y: pos.y,
          icon_shape: cfg.shape,
          color: cfg.color,
        };
        addEquipment(placement);
        selectNewElement(newId, 'equipment');
      }

      if (activeTool === 'shape') {
        const presetId = activeShapePresetIdRef.current ?? SHAPE_PRESETS[0].id;
        const preset = SHAPE_PRESETS.find((p) => p.id === presetId) ?? SHAPE_PRESETS[0];
        const newId = generateOverlayId();
        // Compute pixel size from real-world feet × scale_pixels_per_foot
        const scale = fs.scale_pixels_per_foot;
        const pixelW = Math.round(preset.real_width_ft * scale);
        const pixelH = Math.round(preset.real_height_ft * scale);
        // Use scale-calibrated size, fallback to default if scale is unset (default 20 px/ft)
        const shapeW = pixelW > 0 ? pixelW : preset.default_width;
        const shapeH = pixelH > 0 ? pixelH : preset.default_height;
        const shape: WMShapeAnnotation = {
          id: newId,
          floor_sketch_id: fs.id,
          preset_id: preset.id,
          shape_type: preset.shape_type,
          x: pos.x - shapeW / 2,
          y: pos.y - shapeH / 2,
          width: shapeW,
          height: shapeH,
          rotation: 0,
          fill_color: preset.fill_color,
          stroke_color: preset.stroke_color,
          stroke_width: 2,
          opacity: 0.7,
          label: preset.abbreviation,
        };
        addShape(shape);
        selectNewElement(newId, 'shape');
      }

      if (activeTool === 'text') {
        const newId = generateOverlayId();
        const annotation: WMTextAnnotation = {
          id: newId,
          floor_sketch_id: fs.id,
          x: pos.x,
          y: pos.y,
          text: 'Text',
          font_size: 16,
          color: '#333333',
          bold: false,
        };
        addTextAnnotation(annotation);
        selectNewElement(newId, 'text');
      }

      // ---- Polygon demolition tool: click-to-place vertices ----
      if (activeTool === 'demolition_polygon') {
        const pts = polygonDrawPointsRef.current;
        // Close polygon if clicking near the first vertex (and >=3 points exist)
        if (pts.length >= 3) {
          const first = pts[0];
          const dist = Math.hypot(pos.x - first.x, pos.y - first.y);
          if (dist < POLYGON_CLOSE_THRESHOLD) {
            finalizePolygon(pts);
            return;
          }
        }
        // Add vertex
        const newPts = [...pts, pos];
        setPolygonDrawPoints(newPts);
        setPolygonDrawCursor(pos);
        return;
      }

      // ---- Wall tool: click-click paradigm ----
      if (activeTool === 'wall') {
        const snapped = snapToWallEndpoint(pos);
        const wds = wallDrawStartRef.current;
        if (!wds) {
          // First click — set start point
          setWallDrawStart(snapped.point);
          setWallDrawCursor(snapped.point);
        } else {
          // Second click — finalize wall
          let endPoint = snapped.point;
          if (e.evt.shiftKey) endPoint = constrainToAxis(wds, endPoint);
          else if (snapped.snapped) endPoint = snapped.point;

          const dx = endPoint.x - wds.x;
          const dy = endPoint.y - wds.y;
          const lengthPx = Math.sqrt(dx * dx + dy * dy);
          if (lengthPx > 5) {
            const lengthFt = pixelsToFeet(lengthPx, fs.scale_pixels_per_foot);
            const newId = generateOverlayId();
            const wall: WMWall = {
              id: newId,
              floor_sketch_id: fs.id,
              start_x: wds.x,
              start_y: wds.y,
              end_x: endPoint.x,
              end_y: endPoint.y,
              thickness: DEFAULT_WALL_THICKNESS,
              color: DEFAULT_WALL_COLOR,
              length_ft: lengthFt,
            };
            addWall(wall);

            // Auto-detect rooms from closed wall polygons
            // Pass the updated walls list (state hasn't flushed yet)
            const updatedWalls = [...(st.overlayData.walls ?? []), wall];
            autoDetectRooms(updatedWalls);

            // Continue drawing from end point (chain walls)
            setWallDrawStart(endPoint);
            setWallDrawCursor(endPoint);
          }
        }
        return;
      }

      // ---- Room tool: detect room from enclosed walls ----
      if (activeTool === 'room') {
        const boundary = detectRoomAtPoint(pos);
        if (boundary) {
          const existingRooms = st.overlayData.rooms ?? [];
          const roomNum = existingRooms.length + 1;
          const areaPixels = Math.abs(polygonArea(boundary));
          const scale = fs.scale_pixels_per_foot;
          const areaSqft = areaPixels / (scale * scale);
          const newId = generateOverlayId();
          const room: WMRoom = {
            id: newId,
            floor_sketch_id: fs.id,
            name: `Room ${roomNum}`,
            boundary,
            color: DEFAULT_ROOM_COLOR,
            height_ft: 8,
            area_sqft: areaSqft,
            wall_ids: [],
          };
          addRoom(room);
          selectElement({ element_id: newId, element_type: 'room' });
          message.success(`Room ${roomNum} detected (${areaSqft.toFixed(0)} SF)`);
        } else {
          message.info('No enclosed area found. Draw walls that form a closed shape first.');
        }
        return;
      }

      // ---- Wall Split tool ----
      if (activeTool === 'wall_split') {
        const walls = st.overlayData.walls ?? [];
        let closestWall: WMWall | null = null;
        let closestDist = 10; // max distance threshold
        let splitPoint = { x: 0, y: 0 };

        for (const w of walls) {
          const cp = closestPointOnSegment(pos.x, pos.y, w.start_x, w.start_y, w.end_x, w.end_y);
          const dist = Math.hypot(cp.x - pos.x, cp.y - pos.y);
          if (dist < closestDist && cp.t > 0.05 && cp.t < 0.95) {
            closestDist = dist;
            closestWall = w;
            splitPoint = { x: cp.x, y: cp.y };
          }
        }

        if (closestWall) {
          const scale = fs.scale_pixels_per_foot;
          // Create two new walls from the split
          const wall1: WMWall = {
            id: generateOverlayId(),
            floor_sketch_id: fs.id,
            start_x: closestWall.start_x,
            start_y: closestWall.start_y,
            end_x: splitPoint.x,
            end_y: splitPoint.y,
            thickness: closestWall.thickness,
            color: closestWall.color,
            length_ft: pixelsToFeet(
              Math.hypot(splitPoint.x - closestWall.start_x, splitPoint.y - closestWall.start_y),
              scale
            ),
          };
          const wall2: WMWall = {
            id: generateOverlayId(),
            floor_sketch_id: fs.id,
            start_x: splitPoint.x,
            start_y: splitPoint.y,
            end_x: closestWall.end_x,
            end_y: closestWall.end_y,
            thickness: closestWall.thickness,
            color: closestWall.color,
            length_ft: pixelsToFeet(
              Math.hypot(closestWall.end_x - splitPoint.x, closestWall.end_y - splitPoint.y),
              scale
            ),
          };
          removeWall(closestWall.id);
          addWall(wall1);
          addWall(wall2);
          message.success('Wall split into two segments.');
        } else {
          message.info('Click closer to a wall to split it.');
        }
        return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getCanvasPos, deselect, addEquipment, addDemolitionZone, addShape, addTextAnnotation, selectNewElement, selectElement, snapToWallEndpoint, constrainToAxis, addWall, detectRoomAtPoint, addRoom, removeWall, autoDetectRooms, setDrawStateSync, finalizePolygon]
  );

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Pan
      if (isPanningRef.current) {
        const dx = e.evt.clientX - lastPointerRef.current.x;
        const dy = e.evt.clientY - lastPointerRef.current.y;
        lastPointerRef.current = { x: e.evt.clientX, y: e.evt.clientY };
        setStagePos((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
        return;
      }

      // Polygon drawing preview
      if (stateRef.current.activeTool === 'demolition_polygon' && polygonDrawPointsRef.current.length > 0) {
        const pos = getCanvasPos(e);
        setPolygonDrawCursor(pos);
        return;
      }

      // Wall drawing preview (tracks cursor while first click is placed)
      const wds = wallDrawStartRef.current;
      if (stateRef.current.activeTool === 'wall' && wds) {
        const pos = getCanvasPos(e);
        let endPos = pos;
        if (e.evt.shiftKey) endPos = constrainToAxis(wds, pos);
        const snap = snapToWallEndpoint(endPos);
        setWallDrawCursor(snap.snapped ? snap.point : endPos);
        setWallSnapEnd(snap.snapped ? snap.point : null);
        return;
      }

      const ds = drawStateRef.current;
      if (!ds.isDrawing) return;

      const pos = getCanvasPos(e);

      // Shift constraint for line tools (containment, demolition_line)
      if (
        e.evt.shiftKey &&
        (stateRef.current.activeTool === 'containment' || stateRef.current.activeTool === 'demolition_line')
      ) {
        const start = { x: ds.startX, y: ds.startY };
        const constrained = constrainToAxis(start, pos);
        const prev = drawStateRef.current;
        setDrawStateSync({ ...prev, currentX: constrained.x, currentY: constrained.y });
        return;
      }

      const prev = drawStateRef.current;
      setDrawStateSync({ ...prev, currentX: pos.x, currentY: pos.y });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getCanvasPos, snapToWallEndpoint, constrainToAxis, setDrawStateSync]
  );

  const handleMouseUp = useCallback(
    (_e: Konva.KonvaEventObject<MouseEvent>) => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        return;
      }

      const ds = drawStateRef.current;
      if (!ds.isDrawing) return;

      const { startX, startY, currentX, currentY } = ds;
      const minPx = 5; // ignore tiny accidental drags
      const wPx = Math.abs(currentX - startX);
      const hPx = Math.abs(currentY - startY);

      const st = stateRef.current;
      const fs = floorSketchRef.current;
      // Line tools (containment, demolition_line) use distance; others use rect
      if (st.activeTool === 'containment' || st.activeTool === 'demolition_line') {
        const lineLenPx = Math.sqrt(wPx * wPx + hPx * hPx);
        if (lineLenPx < minPx) {
          setDrawStateSync(INITIAL_DRAW_STATE);
          return;
        }
      } else if (wPx < minPx || hPx < minPx) {
        setDrawStateSync(INITIAL_DRAW_STATE);
        return;
      }

      const x = Math.min(startX, currentX);
      const y = Math.min(startY, currentY);
      const scale = fs.scale_pixels_per_foot;
      const dim1Ft = pixelsToFeet(wPx, scale);
      const dim2Ft = pixelsToFeet(hPx, scale);

      const { activeTool, activeMaterialTypeId } = st;

      const mats = materialTypesRef.current;
      if (activeTool === 'demolition') {
        const matId = activeMaterialTypeId ?? mats[0]?.id ?? 'wood_floor';
        const matDef =
          mats.find((m) => m.id === matId) ??
          DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === matId);

        // Wall, baseboard, and EA types must not be placed via canvas drag.
        if (matDef?.surface === 'wall' || matDef?.unit === 'LF' || matDef?.unit === 'EA') {
          setDrawStateSync(INITIAL_DRAW_STATE);
          return;
        }

        const newId = generateOverlayId();
        // Dimensions start at 0 — user must enter real measurements in the sidebar.
        // The raw pixel size from the drag is stored for visual rendering only.
        const zone: WMDemolitionZone = {
          id: newId,
          floor_sketch_id: fs.id,
          material_type: matId,
          surface: matDef?.surface ?? 'floor',
          color: matDef?.color ?? '#B8860B',
          x,
          y,
          dimension1_ft: 0,
          dimension2_ft: 0,
          rotation: 0,
          calculated_sqft: 0,
          display_order: stateRef.current.overlayData.demolition_zones.length,
          pixel_width: wPx,
          pixel_height: hPx,
          render_mode: matDef?.render_mode,
          stroke_style: matDef?.stroke_style,
          fill_opacity: matDef?.fill_opacity,
        };
        addDemolitionZone(zone);
        selectNewElement(newId, 'demolition');
      } else if (activeTool === 'demolition_line') {
        // Wall / baseboard line — drag determines length and angle
        const dx = currentX - startX;
        const dy = currentY - startY;
        const lengthPx = Math.sqrt(dx * dx + dy * dy);
        const lengthFt = pixelsToFeet(lengthPx, scale);
        const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

        const matId = st.activeMaterialTypeId ?? 'wall_drywall';
        const matDef =
          mats.find((m) => m.id === matId) ??
          DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === matId);
        const isLF = matDef?.unit === 'LF';
        // Default height: 2ft/4ft for specific drywall types, 8ft otherwise
        const defaultHeight =
          matId === 'wall_drywall_2ft' ? 2 :
          matId === 'wall_drywall_4ft' ? 4 :
          8;
        const newId = generateOverlayId();

        const zone: WMDemolitionZone = {
          id: newId,
          floor_sketch_id: fs.id,
          material_type: matId,
          surface: matDef?.surface ?? 'wall',
          color: matDef?.color ?? '#FFB6C1',
          x: startX,
          y: startY,
          dimension1_ft: lengthFt,
          dimension2_ft: isLF ? 0 : 0, // user enters width for wall SF in panel
          height_ft: isLF ? undefined : defaultHeight,
          rotation: angleDeg,
          calculated_sqft: isLF ? lengthFt : lengthFt * defaultHeight,
          display_order: stateRef.current.overlayData.demolition_zones.length,
          render_mode: matDef?.render_mode || 'line',
          stroke_style: matDef?.stroke_style,
          fill_opacity: matDef?.fill_opacity,
        };
        addDemolitionZone(zone);
        selectNewElement(newId, 'demolition');
      } else if (activeTool === 'containment') {
        // Containment is a line — drag determines length and angle
        const dx = currentX - startX;
        const dy = currentY - startY;
        const lengthPx = Math.sqrt(dx * dx + dy * dy);
        const lengthFt = pixelsToFeet(lengthPx, scale);
        const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
        const heightFt = DEFAULT_CONTAINMENT_HEIGHT_FT;
        const containId = generateOverlayId();
        const zone: WMContainmentZone = {
          id: containId,
          floor_sketch_id: fs.id,
          containment_type: 'Containment',
          x: startX,
          y: startY,
          length_ft: lengthFt,
          height_ft: heightFt,
          rotation: angleDeg,
          calculated_sqft: calcContainmentSqft(lengthFt, heightFt),
          color: DEFAULT_CONTAINMENT_COLOR,
          zipper_count: 0,
        };
        addContainment(zone);
        selectNewElement(containId, 'containment');
      } else if (activeTool === 'floor_protection') {
        const paperWidth = DEFAULT_PAPER_WIDTH_FT;
        const lengthFt = pixelsToFeet(Math.max(wPx, hPx), scale);
        // Renderer draws width=paperWidth (narrow), height=length (long),
        // so rotation=0 is vertical. For horizontal drag, rotate -90.
        const rotation = wPx >= hPx ? -90 : 0;
        const protId = generateOverlayId();
        const prot: WMFloorProtection = {
          id: protId,
          floor_sketch_id: fs.id,
          protection_type: 'Heavy duty paper & tape',
          paper_width_ft: paperWidth,
          x,
          y,
          length_ft: lengthFt,
          rotation,
          calculated_sqft: calcFloorProtectionSqft(paperWidth, lengthFt),
          color: DEFAULT_FLOOR_PROTECTION_COLOR,
        };
        addFloorProtection(prot);
        selectNewElement(protId, 'floor_protection');
      } else if (activeTool === 'content_protection') {
        const cpId = generateOverlayId();
        const contentProt: WMContentProtection = {
          id: cpId,
          floor_sketch_id: fs.id,
          protection_type: 'Plastic sheeting',
          width_ft: dim1Ft,
          length_ft: dim2Ft,
          x,
          y,
          rotation: 0,
          calculated_sqft: calcContentProtectionSqft(dim1Ft, dim2Ft),
          color: DEFAULT_CONTENT_PROTECTION_COLOR,
        };
        addContentProtection(contentProt);
        selectNewElement(cpId, 'content_protection');
      } else if (activeTool === 'content_manipulation') {
        const cmId = generateOverlayId();
        const contentManip: WMContentManipulation = {
          id: cmId,
          floor_sketch_id: fs.id,
          manipulation_type: 'Move out',
          width_ft: dim1Ft,
          length_ft: dim2Ft,
          x,
          y,
          rotation: 0,
          hours: 1.0,
          color: DEFAULT_CONTENT_MANIPULATION_COLOR,
        };
        addContentManipulation(contentManip);
        selectNewElement(cmId, 'content_manipulation');
      }

      setDrawStateSync(INITIAL_DRAW_STATE);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addDemolitionZone, addContainment, addFloorProtection, addContentProtection, addContentManipulation, selectNewElement, setDrawStateSync]
  );

  // ------------------------------------------------------------------
  // Canvas drag-end (element position update)
  // When multiple elements are selected and the dragged element is one
  // of them, all selected elements move together by the same delta.
  // ------------------------------------------------------------------
  const handleDragEnd = useCallback(
    (id: string, type: string, x: number, y: number) => {
      // Multi-select batch move: if 2+ elements selected and dragged element is one of them
      if (selectedIds.size > 1 && selectedIds.has(id)) {
        batchMoveSelected(id, x, y);
        return;
      }

      // Single element move
      if (type === 'demolition') updateDemolitionZone({ id, x, y });
      else if (type === 'equipment') updateEquipment({ id, x, y });
      else if (type === 'containment') updateContainment({ id, x, y });
      else if (type === 'floor_protection') updateFloorProtection({ id, x, y });
      else if (type === 'content_protection') updateContentProtection({ id, x, y });
      else if (type === 'content_manipulation') updateContentManipulation({ id, x, y });
      else if (type === 'text') updateTextAnnotation({ id, x, y });
      else if (type === 'shape') updateShape({ id, x, y });
    },
    [selectedIds, batchMoveSelected, updateDemolitionZone, updateEquipment, updateContainment, updateFloorProtection, updateContentProtection, updateTextAnnotation, updateShape]
  );

  // Transform end (resize + rotation)
  const handleTransformEnd = useCallback(
    (id: string, type: string, widthFt: number, heightFt: number, rotation?: number) => {
      if (type === 'demolition') {
        // Check if this is a wall/baseboard line zone
        const zone = state.overlayData.demolition_zones.find((z) => z.id === id);
        const mat = zone
          ? materialTypes.find((m) => m.id === zone.material_type) ??
            DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === zone.material_type)
          : null;
        const isWallLine = mat && (mat.surface === 'wall' || mat.unit === 'LF');

        if (isWallLine && zone) {
          // widthFt = new length, heightFt = new rotation (legacy line transform)
          const lengthFt = widthFt;
          const rot = heightFt;
          const isLF = mat.unit === 'LF';
          const wallHeight = zone.height_ft ?? 8;

          // If this zone is part of a group, rotate the entire group
          if (zone.group_id) {
            const deltaAngle = rot - (zone.rotation || 0);
            if (Math.abs(deltaAngle) > 0.01) {
              // Compute group centroid as pivot
              const groupZones = state.overlayData.demolition_zones.filter(
                (z) => z.group_id === zone.group_id
              );
              let cx = 0, cy = 0;
              for (const gz of groupZones) {
                cx += gz.x;
                cy += gz.y;
              }
              cx /= groupZones.length;
              cy /= groupZones.length;
              rotateDemolitionGroup(zone.group_id, cx, cy, deltaAngle);
            }
            return; // group rotation handles all zones at once
          }

          updateDemolitionZone({
            id,
            dimension1_ft: lengthFt,
            rotation: rot,
            calculated_sqft: isLF ? lengthFt : lengthFt * wallHeight,
          });
        } else if (mat?.unit === 'EA') {
          // EA items have fixed sizes — don't update dimensions from transform
          if (rotation !== undefined) {
            updateDemolitionZone({ id, rotation });
          }
        } else {
          updateDemolitionZone({
            id,
            dimension1_ft: widthFt,
            dimension2_ft: heightFt,
            rotation: rotation ?? zone?.rotation ?? 0,
            calculated_sqft: calcDemoZoneSqft(widthFt, heightFt),
          });
        }
      } else if (type === 'containment') {
        // For containment: widthFt = new length_ft, heightFt = new rotation
        const lengthFt = widthFt;
        const rot = heightFt;
        const existingZone = state.overlayData.containment_zones.find((z) => z.id === id);
        const polyHeight = existingZone?.height_ft ?? 8;
        updateContainment({
          id,
          length_ft: lengthFt,
          rotation: rot,
          calculated_sqft: calcContainmentSqft(lengthFt, polyHeight),
        });
      } else if (type === 'floor_protection') {
        updateFloorProtection({
          id,
          paper_width_ft: widthFt,
          length_ft: heightFt,
          rotation: rotation ?? 0,
          calculated_sqft: calcFloorProtectionSqft(widthFt, heightFt),
        });
      } else if (type === 'content_protection') {
        updateContentProtection({
          id,
          width_ft: widthFt,
          length_ft: heightFt,
          rotation: rotation ?? 0,
          calculated_sqft: calcContentProtectionSqft(widthFt, heightFt),
        });
      } else if (type === 'content_manipulation') {
        updateContentManipulation({
          id,
          width_ft: widthFt,
          length_ft: heightFt,
          rotation: rotation ?? 0,
        });
      } else if (type === 'shape') {
        // widthFt/heightFt are actually pixel dimensions for shapes
        updateShape({
          id,
          width: widthFt,
          height: heightFt,
          rotation: rotation ?? 0,
        });
      }
    },
    [updateDemolitionZone, updateContainment, updateFloorProtection, updateContentProtection, updateShape, rotateDemolitionGroup, state.overlayData.containment_zones, state.overlayData.demolition_zones, materialTypes]
  );

  // ------------------------------------------------------------------
  // Select handler (Ctrl+click = toggle multi-select)
  // ------------------------------------------------------------------
  const handleSelectElement = useCallback(
    (id: string, type: string, ctrlKey?: boolean) => {
      const sel: import('../../../types/wmSketch').WMSketchSelection = {
        element_id: id,
        element_type: type as 'demolition' | 'equipment' | 'containment' | 'floor_protection' | 'content_protection' | 'content_manipulation' | 'text' | 'shape',
      };
      if (ctrlKey) {
        toggleSelectElement(sel);
      } else {
        // If this element is already part of the current multi-selection,
        // don't reduce to single-select (preserves multi-select on right-click)
        const current = stateRef.current.selections;
        if (current.length > 1 && current.some((s) => s.element_id === id)) {
          return; // keep existing multi-selection
        }
        selectElement(sel);
      }
    },
    [selectElement, toggleSelectElement]
  );

  // ------------------------------------------------------------------
  // Keyboard shortcuts
  // ------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(true);

      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      // Don't steal keystrokes from inputs
      if (tag === 'input' || tag === 'textarea') return;

      const cmd = e.ctrlKey || e.metaKey;

      if (cmd && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      if (cmd && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault();
        redo();
        return;
      }
      if (cmd && e.key === 's') {
        e.preventDefault();
        handleSaveShortcut();
        return;
      }

      // Copy (Ctrl+C)
      if (cmd && e.key === 'c' && state.selections.length > 0) {
        e.preventDefault();
        const items: Array<{ type: string; data: Record<string, unknown> }> = [];
        for (const sel of state.selections) {
          const { element_id, element_type } = sel;
          let found: Record<string, unknown> | undefined;
          if (element_type === 'demolition') found = state.overlayData.demolition_zones.find((z) => z.id === element_id) as unknown as Record<string, unknown>;
          else if (element_type === 'equipment') found = state.overlayData.equipment_placements.find((e) => e.id === element_id) as unknown as Record<string, unknown>;
          else if (element_type === 'containment') found = state.overlayData.containment_zones.find((c) => c.id === element_id) as unknown as Record<string, unknown>;
          else if (element_type === 'floor_protection') found = state.overlayData.floor_protections.find((fp) => fp.id === element_id) as unknown as Record<string, unknown>;
          else if (element_type === 'content_protection') found = (state.overlayData.content_protections ?? []).find((cp) => cp.id === element_id) as unknown as Record<string, unknown>;
          else if (element_type === 'content_manipulation') found = (state.overlayData.content_manipulations ?? []).find((cm) => cm.id === element_id) as unknown as Record<string, unknown>;
          else if (element_type === 'text') found = (state.overlayData.text_annotations ?? []).find((t) => t.id === element_id) as unknown as Record<string, unknown>;
          else if (element_type === 'shape') found = (state.overlayData.shapes ?? []).find((s) => s.id === element_id) as unknown as Record<string, unknown>;
          if (found) items.push({ type: element_type, data: { ...found } });
        }
        if (items.length > 0) {
          clipboardRef.current = items;
          message.info(`${items.length}개 요소 복사됨`);
        }
        return;
      }

      // Paste (Ctrl+V)
      if (cmd && e.key === 'v' && clipboardRef.current.length > 0) {
        e.preventDefault();
        const PASTE_OFFSET = 20;
        const newSelections: import('../../../types/wmSketch').WMSketchSelection[] = [];
        for (const item of clipboardRef.current) {
          const newId = generateOverlayId();
          const cloned = { ...item.data, id: newId, x: (item.data.x as number) + PASTE_OFFSET, y: (item.data.y as number) + PASTE_OFFSET };
          if (item.type === 'demolition') addDemolitionZone(cloned as unknown as WMDemolitionZone);
          else if (item.type === 'equipment') addEquipment(cloned as unknown as WMEquipmentPlacement);
          else if (item.type === 'containment') addContainment(cloned as unknown as WMContainmentZone);
          else if (item.type === 'floor_protection') addFloorProtection(cloned as unknown as WMFloorProtection);
          else if (item.type === 'content_protection') addContentProtection(cloned as unknown as WMContentProtection);
          else if (item.type === 'content_manipulation') addContentManipulation(cloned as unknown as WMContentManipulation);
          else if (item.type === 'text') addTextAnnotation(cloned as unknown as WMTextAnnotation);
          else if (item.type === 'shape') addShape(cloned as unknown as WMShapeAnnotation);
          newSelections.push({ element_id: newId, element_type: item.type as WMSketchSelection['element_type'] });
        }
        // Update clipboard positions so repeated paste cascades
        clipboardRef.current = clipboardRef.current.map((item) => ({
          ...item,
          data: { ...item.data, x: (item.data.x as number) + PASTE_OFFSET, y: (item.data.y as number) + PASTE_OFFSET },
        }));
        // Select pasted elements
        if (newSelections.length > 0) {
          selectElement(newSelections[0]);
          for (let i = 1; i < newSelections.length; i++) {
            toggleSelectElement(newSelections[i]);
          }
        }
        message.info(`${newSelections.length}개 요소 붙여넣기 완료`);
        return;
      }

      // Combine (Ctrl+Shift+K)
      if (cmd && e.shiftKey && (e.key === 'K' || e.key === 'k')) {
        e.preventDefault();
        combineSelectedZones();
        return;
      }
      // Ungroup (Ctrl+Shift+U)
      if (cmd && e.shiftKey && (e.key === 'U' || e.key === 'u')) {
        e.preventDefault();
        if (state.selections.length === 1 && state.selections[0].element_type === 'demolition') {
          ungroupZone(state.selections[0].element_id);
        }
        return;
      }

      // Cancel wall/polygon drawing on Escape
      if (e.key === 'Escape') {
        if (polygonDrawPointsRef.current.length > 0) {
          setPolygonDrawPoints([]);
          setPolygonDrawCursor(null);
        }
        if (wallDrawStart) {
          setWallDrawStart(null);
          setWallDrawCursor(null);
          setWallSnapEnd(null);
        }
        return;
      }

      // Tool shortcuts (only without Ctrl/Cmd to avoid conflict with copy/paste)
      if (!cmd) {
        if (e.key === 'v' || e.key === 'V') { setTool('select'); setWallDrawStart(null); setPolygonDrawPoints([]); setPolygonDrawCursor(null); return; }
        if (e.key === 'h' || e.key === 'H') { setTool('pan'); setWallDrawStart(null); setPolygonDrawPoints([]); setPolygonDrawCursor(null); return; }
        if (e.key === 't' || e.key === 'T') { setTool('text'); setWallDrawStart(null); setPolygonDrawPoints([]); setPolygonDrawCursor(null); return; }
        if (e.key === 'w' || e.key === 'W') { setTool('wall'); return; }
        if (e.key === 'r' || e.key === 'R') { setTool('room'); return; }
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selections.length > 0) {
        for (const sel of state.selections) {
          const { element_id, element_type } = sel;
          if (element_type === 'demolition') removeDemolitionZone(element_id);
          else if (element_type === 'equipment') removeEquipment(element_id);
          else if (element_type === 'containment') removeContainment(element_id);
          else if (element_type === 'floor_protection') removeFloorProtection(element_id);
          else if (element_type === 'content_protection') removeContentProtection(element_id);
          else if (element_type === 'content_manipulation') removeContentManipulation(element_id);
          else if (element_type === 'text') removeTextAnnotation(element_id);
          else if (element_type === 'shape') removeShape(element_id);
          else if (element_type === 'wall') removeWall(element_id);
          else if (element_type === 'room') removeRoomWithWalls(element_id);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    undo,
    redo,
    handleSaveShortcut,
    setTool,
    state.selections,
    removeDemolitionZone,
    removeEquipment,
    removeContainment,
    removeFloorProtection,
    removeContentProtection,
    removeContentManipulation,
    removeTextAnnotation,
    removeShape,
    removeWall,
    removeRoomWithWalls,
    wallDrawStart,
    state.overlayData,
    addDemolitionZone,
    addEquipment,
    addContainment,
    addFloorProtection,
    addContentProtection,
    addContentManipulation,
    addTextAnnotation,
    addShape,
    selectElement,
    toggleSelectElement,
    combineSelectedZones,
    ungroupZone,
  ]);

  // ------------------------------------------------------------------
  // Image import / removal
  // ------------------------------------------------------------------
  const [imageSourceType, setImageSourceType] = useState(floorSketch.source_type);
  // Reference image: show imported background as semi-transparent trace layer in sketch mode
  const [showReferenceImage, setShowReferenceImage] = useState(false);
  const [referenceOpacity, setReferenceOpacity] = useState(0.3);
  /**
   * Resolve the background image URL.
   * Cloud-stored images (e.g. Google Drive viewer URLs) cannot be
   * loaded directly by <img>; use the backend proxy endpoint instead.
   *
   * In production the frontend (Vercel) and backend (Render) are on
   * different origins, so relative paths like "/api/..." would resolve
   * against the Vercel domain — which cannot serve images. We must
   * prepend the backend origin for Image() loads (which bypass axios).
   */
  const resolveImageUrl = (url: string | undefined | null): string | null => {
    if (!url) return null;
    // blob: URLs are local object URLs — use as-is
    if (url.startsWith('blob:')) return url;

    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const backendOrigin = isLocal ? '' : (process.env.REACT_APP_API_URL || 'https://mjestimate-backend.onrender.com');
    const proxyPath = `/api/water-mitigation/sketch/floors/${floorSketch.id}/background-image/preview`;

    // Relative path starting with / (e.g. "/api/.../preview" or "/uploads/...")
    if (url.startsWith('/')) {
      return `${backendOrigin}${url}`;
    }
    // Google Drive viewer URL → proxy
    if (url.includes('drive.google.com/file/d/')) {
      return `${backendOrigin}${proxyPath}`;
    }
    // Other absolute URLs that aren't directly loadable
    if (url.startsWith('http')) {
      return `${backendOrigin}${proxyPath}`;
    }
    return url;
  };

  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(
    resolveImageUrl(floorSketch.background_image_url)
  );
  const [bgImageStatus, setBgImageStatus] = useState<ImageLoadStatus>('idle');

  useEffect(() => {
    setImageSourceType(floorSketch.source_type);
    setBackgroundImageUrl(resolveImageUrl(floorSketch.background_image_url));
  }, [floorSketch.id, floorSketch.source_type, floorSketch.background_image_url]);

  const handleImageImported = useCallback(
    async (file: File, objectUrl: string) => {
      setBackgroundImageUrl(objectUrl);
      try {
        await onImageUploaded(file);
        // Auto-open calibration after successful upload
        setIsCalibrating(true);
      } catch {
        message.error('Failed to upload floor plan image.');
      }
    },
    [onImageUploaded]
  );

  const handleCalibrated = useCallback(
    (newScale: number) => {
      setIsCalibrating(false);
      onScaleChanged?.(newScale);
      message.success(`Scale calibrated: ${newScale.toFixed(1)} px/ft`);
    },
    [onScaleChanged]
  );

  const handleImageRemoved = useCallback(async () => {
    setBackgroundImageUrl(null);
    try {
      await onImageRemoved();
    } catch {
      message.error('Failed to remove floor plan image.');
    }
  }, [onImageRemoved]);

  // ------------------------------------------------------------------
  // AI image → drawing conversion
  // ------------------------------------------------------------------
  const [isConverting, setIsConverting] = useState(false);
  const [hideOverlays, setHideOverlays] = useState(false);

  const handleConvertToDrawing = useCallback(async () => {
    setIsConverting(true);
    try {
      const result = await wmSketchService.analyzeFloorPlanImage(floorSketch.id);
      if (result.success && result.walls.length > 0) {
        // Only merge walls — rooms are auto-detected from connected walls
        mergeAiWallsRooms(result.walls as any, []);
        // Auto-detect rooms from the new walls
        setTimeout(() => autoDetectRooms(result.walls as any), 100);
        // Switch to sketch mode with reference image visible
        setImageSourceType('sketch');
        setShowReferenceImage(true);
        setReferenceOpacity(0.3);
        setHideOverlays(true);
        message.success(`Detected ${result.walls.length} walls. Rooms auto-detected from connected walls.`);
      } else {
        message.warning('AI could not detect walls from the image. Try a clearer floor plan.');
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || 'Unknown error';
      message.error(`Conversion failed: ${detail}`);
    } finally {
      setIsConverting(false);
    }
  }, [floorSketch.id, mergeAiWallsRooms, autoDetectRooms]);

  // ------------------------------------------------------------------
  // Active material color for rubber-band preview
  // ------------------------------------------------------------------
  const activeMaterialColor = React.useMemo(() => {
    if (state.activeTool === 'containment') return DEFAULT_CONTAINMENT_COLOR;
    if (state.activeTool === 'floor_protection') return DEFAULT_FLOOR_PROTECTION_COLOR;
    if (state.activeTool === 'content_protection') return DEFAULT_CONTENT_PROTECTION_COLOR;
    if (state.activeTool === 'content_manipulation') return DEFAULT_CONTENT_MANIPULATION_COLOR;
    const mat =
      materialTypes.find((m) => m.id === state.activeMaterialTypeId) ??
      DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === state.activeMaterialTypeId);
    return mat?.color ?? '#B8860B';
  }, [state.activeTool, state.activeMaterialTypeId, materialTypes]);

  // ------------------------------------------------------------------
  // Cursor style
  // ------------------------------------------------------------------
  const getCursor = () => {
    if (isPanningRef.current) return 'grabbing';
    if (spaceDown || state.activeTool === 'pan') return 'grab';
    if (state.activeTool === 'select') return 'default';
    if (state.activeTool === 'equipment') return 'crosshair';
    if (state.activeTool === 'text') return 'text';
    if (state.activeTool === 'wall' || state.activeTool === 'wall_split') return 'crosshair';
    if (state.activeTool === 'room') return 'pointer';
    return 'crosshair';
  };

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 340px)',
        minHeight: 500,
        background: '#fff',
        overflow: 'hidden',
      }}
    >
      {/* Floor plan source toggle + image upload */}
      <WMFloorPlanSource
        key={floorSketch.id}
        sourceType={imageSourceType}
        backgroundImageUrl={backgroundImageUrl}
        onSourceTypeChange={setImageSourceType}
        onImageImported={handleImageImported}
        onImageRemoved={handleImageRemoved}
        onCalibrateScale={() => setIsCalibrating(true)}
        isCalibrated={floorSketch.scale_pixels_per_foot !== 20}
        scalePixelsPerFoot={floorSketch.scale_pixels_per_foot}
        hasBackgroundImage={!!backgroundImageUrl}
        showReferenceImage={showReferenceImage}
        onShowReferenceImageChange={setShowReferenceImage}
        referenceOpacity={referenceOpacity}
        onReferenceOpacityChange={setReferenceOpacity}
        onConvertToDrawing={backgroundImageUrl ? handleConvertToDrawing : undefined}
        isConverting={isConverting}
        hideOverlays={hideOverlays}
        onHideOverlaysChange={setHideOverlays}
        onClearFloorPlan={() => {
          mergeAiWallsRooms([], []);
          message.success('Floor plan cleared.');
        }}
        onImportFromMagicPlan={onImportFromMagicPlan}
        isMagicPlanImporting={isMagicPlanImporting}
      />

      {/* Toolbar */}
      <WMSketchToolbar
        activeTool={state.activeTool}
        activeMaterialTypeId={state.activeMaterialTypeId}
        activeEquipmentType={state.activeEquipmentType}
        activeShapePresetId={activeShapePresetId}
        materialTypes={materialTypes}
        onToolChange={setTool}
        onMaterialTypeChange={(id) => {
          setActiveMaterialType(id);
          setTool('demolition');
        }}
        onEquipmentTypeChange={(type) => {
          setActiveEquipmentType(type);
          setTool('equipment');
        }}
        onShapePresetChange={(presetId) => {
          setActiveShapePresetId(presetId);
          setTool('shape');
        }}
        onSave={handleSave}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        isSaving={isSaving}
        isDirty={state.isDirty}
      />

      {/* Main content: canvas + sidebar */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* Canvas area */}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            overflow: 'hidden',
            cursor: getCursor(),
            background: '#f5f5f5',
            position: 'relative',
          }}
        >
          {/* Address + floor label overlay */}
          <div
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              zIndex: 10,
              pointerEvents: 'none',
            }}
          >
            <Space direction="vertical" size={2}>
              {floorSketch.address_display && (
                <div
                  style={{
                    background: 'rgba(255,255,255,0.85)',
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontSize: 11,
                    color: '#595959',
                    backdropFilter: 'blur(2px)',
                  }}
                >
                  {floorSketch.address_display}
                </div>
              )}
              <div
                style={{
                  background: 'rgba(255,255,255,0.85)',
                  padding: '2px 6px',
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#262626',
                  backdropFilter: 'blur(2px)',
                }}
              >
                {floorSketch.floor_label}
              </div>
            </Space>
          </div>

          <Stage
            ref={stageRef}
            width={stageSize.width}
            height={stageSize.height}
            scaleX={stageScale}
            scaleY={stageScale}
            x={stagePos.x}
            y={stagePos.y}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onDblClick={() => {
              // Double-click to finalize polygon drawing
              if (stateRef.current.activeTool === 'demolition_polygon' && polygonDrawPointsRef.current.length >= 3) {
                finalizePolygon(polygonDrawPointsRef.current);
              }
            }}
            onMouseLeave={() => {
              isPanningRef.current = false;
              if (drawStateRef.current.isDrawing) setDrawStateSync(INITIAL_DRAW_STATE);
            }}
            style={{ display: 'block' }}
          >
            {/* Layer 1a — Background image (full opacity in image mode) */}
            {imageSourceType === 'image' && (
              <Layer listening={false}>
                <WMBackgroundImageLayer
                  imageUrl={backgroundImageUrl}
                  canvasWidth={canvasWidth}
                  canvasHeight={canvasHeight}
                  onStatusChange={setBgImageStatus}
                />
              </Layer>
            )}

            {/* Layer 1b — Reference image (semi-transparent in sketch mode for tracing) */}
            {imageSourceType === 'sketch' && showReferenceImage && backgroundImageUrl && (
              <Layer listening={false}>
                <WMBackgroundImageLayer
                  imageUrl={backgroundImageUrl}
                  canvasWidth={canvasWidth}
                  canvasHeight={canvasHeight}
                  opacity={referenceOpacity}
                />
              </Layer>
            )}

            {/* Layer 2 — Reference grid (sized to fixed canvas) */}
            {imageSourceType === 'sketch' && (
              <GridLayer
                width={canvasWidth}
                height={canvasHeight}
                scalePixelsPerFoot={floorSketch.scale_pixels_per_foot}
              />
            )}

            {/* Layer 3 — Overlay elements (hidden while background image is loading) */}
            {!(imageSourceType === 'image' && bgImageStatus === 'loading') && (
              <WMOverlayLayer
                overlayData={state.overlayData}
                scalePixelsPerFoot={floorSketch.scale_pixels_per_foot}
                selectedIds={selectedIds}
                activeTool={state.activeTool}
                materialTypes={materialTypes}
                isDrawing={drawState.isDrawing}
                drawStart={
                  drawState.isDrawing
                    ? { x: drawState.startX, y: drawState.startY }
                    : null
                }
                drawCurrent={
                  drawState.isDrawing
                    ? { x: drawState.currentX, y: drawState.currentY }
                    : null
                }
                activeMaterialColor={activeMaterialColor}
                onSelectElement={handleSelectElement}
                onDragEnd={handleDragEnd}
                onTransformEnd={handleTransformEnd}
                onUpdateTextAnnotation={(id, patch) => updateTextAnnotation({ id, ...patch })}
                onPolygonPointsChanged={(id, pts) => {
                  // Recalculate area when polygon vertices are dragged
                  const zone = state.overlayData.demolition_zones.find((z) => z.id === id);
                  if (!zone) return;
                  const areaSqft = calcPolygonAreaSqft(pts, floorSketch.scale_pixels_per_foot);
                  updateDemolitionZone({ id, polygon_points: pts, calculated_sqft: areaSqft });
                }}
                onWallDragEndpoint={(wallId, endpoint, x, y) => {
                  const snap = snapToWallEndpoint({ x, y });
                  const pt = snap.point;
                  const wall = (state.overlayData.walls ?? []).find((w) => w.id === wallId);
                  if (!wall) return;
                  const oldPt = endpoint === 'start'
                    ? { x: wall.start_x, y: wall.start_y }
                    : { x: wall.end_x, y: wall.end_y };
                  const otherX = endpoint === 'start' ? wall.end_x : wall.start_x;
                  const otherY = endpoint === 'start' ? wall.end_y : wall.start_y;
                  const newLength = pixelsToFeet(
                    Math.hypot(pt.x - otherX, pt.y - otherY),
                    floorSketch.scale_pixels_per_foot
                  );
                  updateWall({
                    id: wallId,
                    ...(endpoint === 'start'
                      ? { start_x: pt.x, start_y: pt.y }
                      : { end_x: pt.x, end_y: pt.y }),
                    length_ft: newLength,
                  });

                  // Sync room boundary points that match the moved endpoint
                  _syncRoomsFromPointMove(
                    state.overlayData.rooms ?? [],
                    oldPt, pt, updateRoom, floorSketch.scale_pixels_per_foot,
                  );

                  // Auto-detect new rooms after wall endpoint is moved
                  const updatedWalls = (state.overlayData.walls ?? []).map((w) =>
                    w.id === wallId
                      ? {
                          ...w,
                          ...(endpoint === 'start'
                            ? { start_x: pt.x, start_y: pt.y }
                            : { end_x: pt.x, end_y: pt.y }),
                          length_ft: newLength,
                        }
                      : w
                  );
                  autoDetectRooms(updatedWalls);
                }}
                onWallDragEnd={(wallId, dx, dy) => {
                  const wall = (state.overlayData.walls ?? []).find((w) => w.id === wallId);
                  if (!wall) return;
                  const EPS = 8;
                  const endpoints = [
                    { x: wall.start_x, y: wall.start_y },
                    { x: wall.end_x, y: wall.end_y },
                  ];
                  // Move this wall
                  updateWall({
                    id: wallId,
                    start_x: wall.start_x + dx, start_y: wall.start_y + dy,
                    end_x: wall.end_x + dx, end_y: wall.end_y + dy,
                  });
                  // Move connected walls (share an endpoint)
                  const walls = state.overlayData.walls ?? [];
                  for (const w of walls) {
                    if (w.id === wallId) continue;
                    const startMatch = endpoints.some(
                      (ep) => Math.abs(w.start_x - ep.x) < EPS && Math.abs(w.start_y - ep.y) < EPS
                    );
                    const endMatch = endpoints.some(
                      (ep) => Math.abs(w.end_x - ep.x) < EPS && Math.abs(w.end_y - ep.y) < EPS
                    );
                    if (startMatch || endMatch) {
                      updateWall({
                        id: w.id,
                        ...(startMatch ? { start_x: w.start_x + dx, start_y: w.start_y + dy } : {}),
                        ...(endMatch ? { end_x: w.end_x + dx, end_y: w.end_y + dy } : {}),
                      });
                    }
                  }
                  // Sync rooms
                  _syncRoomsFromWallMove(
                    state.overlayData.rooms ?? [],
                    endpoints, dx, dy, updateRoom, floorSketch.scale_pixels_per_foot,
                  );
                }}
                onRoomDragEnd={(roomId, dx, dy) => {
                  const room = (state.overlayData.rooms ?? []).find((r) => r.id === roomId);
                  if (!room) return;
                  // Move room boundary
                  const newBoundary = room.boundary.map((p) => ({ x: p.x + dx, y: p.y + dy }));
                  const area = Math.abs(_polyArea(newBoundary)) / (floorSketch.scale_pixels_per_foot ** 2);
                  updateRoom({ id: roomId, boundary: newBoundary, area_sqft: area });
                  // Move walls that have BOTH endpoints on this room's boundary
                  const walls = state.overlayData.walls ?? [];
                  const EPS = 8;
                  const onBoundary = (px: number, py: number) =>
                    room.boundary.some((bp) => Math.abs(bp.x - px) < EPS && Math.abs(bp.y - py) < EPS);
                  for (const w of walls) {
                    const startOn = onBoundary(w.start_x, w.start_y);
                    const endOn = onBoundary(w.end_x, w.end_y);
                    if (startOn && endOn) {
                      // Both endpoints on this room — move entire wall
                      updateWall({
                        id: w.id,
                        start_x: w.start_x + dx, start_y: w.start_y + dy,
                        end_x: w.end_x + dx, end_y: w.end_y + dy,
                      });
                    } else if (startOn || endOn) {
                      // Shared wall — duplicate it: original stays, copy moves with room
                      const newWall: WMWall = {
                        ...w,
                        id: generateOverlayId(),
                        start_x: w.start_x + dx,
                        start_y: w.start_y + dy,
                        end_x: w.end_x + dx,
                        end_y: w.end_y + dy,
                      };
                      addWall(newWall);
                    }
                  }
                }}
                onRoomVertexDrag={(roomId, vertexIndex, x, y) => {
                  const room = (state.overlayData.rooms ?? []).find((r) => r.id === roomId);
                  if (!room) return;
                  const oldPt = room.boundary[vertexIndex];
                  if (!oldPt) return;
                  const newBoundary = room.boundary.map((p, i) =>
                    i === vertexIndex ? { x, y } : p
                  );
                  const scale = floorSketch.scale_pixels_per_foot;
                  const area = Math.abs(_polyArea(newBoundary)) / (scale * scale);
                  updateRoom({ id: roomId, boundary: newBoundary, area_sqft: area });
                  // Move wall endpoints matching the old vertex position
                  const walls = state.overlayData.walls ?? [];
                  const EPS = 10;
                  for (const w of walls) {
                    const startMatch = Math.abs(w.start_x - oldPt.x) < EPS && Math.abs(w.start_y - oldPt.y) < EPS;
                    const endMatch = Math.abs(w.end_x - oldPt.x) < EPS && Math.abs(w.end_y - oldPt.y) < EPS;
                    if (startMatch || endMatch) {
                      updateWall({
                        id: w.id,
                        ...(startMatch ? { start_x: x, start_y: y } : {}),
                        ...(endMatch ? { end_x: x, end_y: y } : {}),
                      });
                    }
                  }
                  // Update other rooms that share this vertex
                  _syncRoomsFromPointMove(
                    (state.overlayData.rooms ?? []).filter((r) => r.id !== roomId),
                    oldPt, { x, y }, updateRoom, scale,
                  );
                }}
                onMoveGroup={moveDemolitionGroup}
                onRotateGroup={rotateDemolitionGroup}
                hideOverlays={hideOverlays}
                polygonPreviewPoints={polygonDrawPoints.length > 0 ? polygonDrawPoints : undefined}
                polygonPreviewCursor={polygonDrawCursor}
                wallPreview={
                  wallDrawStart && wallDrawCursor
                    ? {
                        startX: wallDrawStart.x,
                        startY: wallDrawStart.y,
                        endX: wallDrawCursor.x,
                        endY: wallDrawCursor.y,
                        snappedEnd: wallSnapEnd,
                      }
                    : null
                }
                canvasWidth={canvasWidth}
                canvasHeight={canvasHeight}
              />
            )}
          </Stage>

          {/* Legend overlay — HTML-based, fixed to bottom-right, unaffected by zoom/pan */}
          <WMLegendOverlay
            overlayData={state.overlayData}
            materialTypes={materialTypes}
          />

          {/* Right-click context menu */}
          {contextMenu && contextMenuItems && contextMenuItems.length > 0 && (
            <div
              style={{
                position: 'fixed',
                left: contextMenu.x,
                top: contextMenu.y,
                zIndex: 1050,
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Menu
                items={contextMenuItems}
                style={{
                  borderRadius: 8,
                  boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
                  minWidth: 180,
                }}
                onClick={() => setContextMenu(null)}
              />
            </div>
          )}

          {/* Loading overlay while background image is loading */}
          {imageSourceType === 'image' && bgImageStatus === 'loading' && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(250,250,250,0.85)',
                zIndex: 10,
                pointerEvents: 'none',
              }}
            >
              <div style={{ textAlign: 'center' }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    border: '3px solid #e0e0e0',
                    borderTop: '3px solid #1890ff',
                    borderRadius: '50%',
                    animation: 'wmSpinner 0.8s linear infinite',
                    margin: '0 auto 8px',
                  }}
                />
                <div style={{ fontSize: 12, color: '#888' }}>Loading floor plan...</div>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <WMSketchSidebar
          overlayData={state.overlayData}
          selection={state.selection}
          materialTypes={materialTypes}
          summary={floorSummary}
          floorSketchId={floorSketch.id}
          onUpdateDemolitionZone={(id, updates) => {
            // Sync pixel dimensions when real dimensions change
            // so the visual rect resizes smoothly instead of jumping
            const scale = floorSketch.scale_pixels_per_foot;
            const patch: Partial<WMDemolitionZone> & { id: string } = { id, ...updates };
            if (updates.dimension1_ft != null) {
              patch.pixel_width = updates.dimension1_ft * scale;
            }
            if (updates.dimension2_ft != null) {
              patch.pixel_height = updates.dimension2_ft * scale;
            }
            updateDemolitionZone(patch);
          }}
          onDeleteDemolitionZone={removeDemolitionZone}
          onAddDemolitionZone={addDemolitionZone}
          onUpdateEquipment={(id, updates) => updateEquipment({ id, ...updates })}
          onDeleteEquipment={removeEquipment}
          onUpdateContainment={(id, updates) => updateContainment({ id, ...updates })}
          onDeleteContainment={removeContainment}
          onUpdateProtection={(id, updates) => updateFloorProtection({ id, ...updates })}
          onDeleteProtection={removeFloorProtection}
          onUpdateContentProtection={(id, updates) => updateContentProtection({ id, ...updates })}
          onDeleteContentProtection={removeContentProtection}
          onUpdateContentManipulation={(id, updates) => updateContentManipulation({ id, ...updates })}
          onDeleteContentManipulation={removeContentManipulation}
          onUpdateWall={(id, updates) => updateWall({ id, ...updates })}
          onDeleteWall={removeWall}
          onUpdateRoom={(id, updates) => updateRoom({ id, ...updates })}
          onDeleteRoom={removeRoom}
          scalePixelsPerFoot={floorSketch.scale_pixels_per_foot}
          onSelectElement={handleSelectElement}
          onMaterialTypesChange={() => {/* material types are fixed for now */}}
          width={280}
        />
      </div>

      {/* Status bar */}
      <StatusBar overlayData={state.overlayData} materialTypes={materialTypes} />

      {/* Scale calibration overlay */}
      {isCalibrating && backgroundImageUrl && (
        <WMScaleCalibration
          imageUrl={backgroundImageUrl}
          logicalCanvasWidth={canvasWidth}
          logicalCanvasHeight={canvasHeight}
          currentScale={floorSketch.scale_pixels_per_foot}
          onCalibrated={handleCalibrated}
          onCancel={() => setIsCalibrating(false)}
        />
      )}
    </div>
  );
};

export default WMFloorSketchEditor;
