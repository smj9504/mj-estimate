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
  theme,
  message,
} from 'antd';
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
} from '../../../types/wmSketch';
import {
  EQUIPMENT_CONFIG,
  DEFAULT_DEMO_MATERIAL_TYPES,
} from '../../../types/wmSketch';
import WMBackgroundImageLayer, { type ImageLoadStatus } from './canvas/WMBackgroundImageLayer';
import WMOverlayLayer from './canvas/WMOverlayLayer';
import { useWMSketchState } from './hooks/useWMSketchState';
import { useWMCalculations } from './hooks/useWMCalculations';
import { useWMSketchPersistence } from './hooks/useWMSketchPersistence';
import {
  generateOverlayId,
  pixelsToFeet,
  calcDemoZoneSqft,
  calcContainmentSqft,
  calcFloorProtectionSqft,
  calcContentProtectionSqft,
} from './utils/wmCalculations';
import {
  DEFAULT_CONTAINMENT_COLOR,
  DEFAULT_CONTAINMENT_HEIGHT_FT,
  DEFAULT_FLOOR_PROTECTION_COLOR,
  DEFAULT_CONTENT_PROTECTION_COLOR,
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
    const map = new Map<string, { name: string; color: string; total: number; unit: 'SF' | 'LF' }>();
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
  const containTotal = containment_zones.reduce((s, c) => s + c.calculated_sqft, 0);
  const protTotal = floor_protections.reduce((s, p) => s + p.calculated_sqft, 0);
  const contentProtTotal = contentProtections.reduce((s, cp) => s + cp.calculated_sqft, 0);
  const eqCount = equipment_placements.length;

  if (byType.length === 0 && containment_zones.length === 0 && floor_protections.length === 0 && contentProtections.length === 0 && eqCount === 0) {
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
          {item.name}: {item.total.toFixed(1)} {item.unit}
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
}) => {
  const { token } = theme.useToken();

  // ------------------------------------------------------------------
  // Scale calibration state
  // ------------------------------------------------------------------
  const [isCalibrating, setIsCalibrating] = useState(false);

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
    addEquipment,
    updateEquipment,
    addContainment,
    updateContainment,
    addFloorProtection,
    updateFloorProtection,
    addContentProtection,
    updateContentProtection,
    removeDemolitionZone,
    removeEquipment,
    removeContainment,
    removeFloorProtection,
    removeContentProtection,
    loadOverlayData,
    markSaved,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useWMSketchState(floorSketch.overlay_data);

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
  // Load overlay & reset view when switching floors (no remount needed)
  // ------------------------------------------------------------------
  const prevFloorIdRef = useRef(floorSketch.id);
  useEffect(() => {
    if (prevFloorIdRef.current !== floorSketch.id) {
      prevFloorIdRef.current = floorSketch.id;
      setStageScale(1);
      setStagePos({ x: 0, y: 0 });
    }
    loadOverlayData(floorSketch.overlay_data);
  }, [floorSketch.id, loadOverlayData]); // eslint-disable-line react-hooks/exhaustive-deps
  const isPanningRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });

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
  // Space key for pan mode
  const [spaceDown, setSpaceDown] = useState(false);

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

  // ------------------------------------------------------------------
  // Mouse event handlers on Stage
  // ------------------------------------------------------------------
  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Middle mouse or space+left or pan tool = pan
      if (e.evt.button === 1 || spaceDown || state.activeTool === 'pan') {
        isPanningRef.current = true;
        lastPointerRef.current = { x: e.evt.clientX, y: e.evt.clientY };
        return;
      }
      if (e.evt.button !== 0) return;

      const pos = getCanvasPos(e);
      const { activeTool } = state;

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
        activeTool === 'content_protection'
      ) {
        // Wall and baseboard (LF-unit) demo types cannot be drawn on the 2D canvas.
        // They are added via the sidebar "Add" button only.
        if (activeTool === 'demolition') {
          const matId = state.activeMaterialTypeId ?? materialTypes[0]?.id ?? 'wood_floor';
          const matDef =
            materialTypes.find((m) => m.id === matId) ??
            DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === matId);
          if (matDef?.surface === 'wall' || matDef?.unit === 'LF') {
            return; // block canvas drawing for wall / baseboard types
          }
        }

        setDrawState({
          isDrawing: true,
          startX: pos.x,
          startY: pos.y,
          currentX: pos.x,
          currentY: pos.y,
        });
        return;
      }

      if (activeTool === 'equipment') {
        const equipType = state.activeEquipmentType ?? 'air_mover';
        const cfg = EQUIPMENT_CONFIG[equipType];
        const placement: WMEquipmentPlacement = {
          id: generateOverlayId(),
          floor_sketch_id: floorSketch.id,
          equipment_type: equipType,
          x: pos.x,
          y: pos.y,
          icon_shape: cfg.shape,
          color: cfg.color,
        };
        addEquipment(placement);
      }
    },
    [state, spaceDown, getCanvasPos, deselect, addEquipment, floorSketch.id, materialTypes]
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

      if (!drawState.isDrawing) return;

      const pos = getCanvasPos(e);
      setDrawState((prev) => ({ ...prev, currentX: pos.x, currentY: pos.y }));
    },
    [drawState.isDrawing, getCanvasPos]
  );

  const handleMouseUp = useCallback(
    (_e: Konva.KonvaEventObject<MouseEvent>) => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        return;
      }

      if (!drawState.isDrawing) return;

      const { startX, startY, currentX, currentY } = drawState;
      const minPx = 5; // ignore tiny accidental drags
      const wPx = Math.abs(currentX - startX);
      const hPx = Math.abs(currentY - startY);

      // Line tools (containment, demolition_line) use distance; others use rect
      if (state.activeTool === 'containment' || state.activeTool === 'demolition_line') {
        const lineLenPx = Math.sqrt(wPx * wPx + hPx * hPx);
        if (lineLenPx < minPx) {
          setDrawState(INITIAL_DRAW_STATE);
          return;
        }
      } else if (wPx < minPx || hPx < minPx) {
        setDrawState(INITIAL_DRAW_STATE);
        return;
      }

      const x = Math.min(startX, currentX);
      const y = Math.min(startY, currentY);
      const scale = floorSketch.scale_pixels_per_foot;
      const dim1Ft = pixelsToFeet(wPx, scale);
      const dim2Ft = pixelsToFeet(hPx, scale);

      const { activeTool, activeMaterialTypeId } = state;

      if (activeTool === 'demolition') {
        const matId = activeMaterialTypeId ?? materialTypes[0]?.id ?? 'wood_floor';
        const matDef =
          materialTypes.find((m) => m.id === matId) ??
          DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === matId);

        // Wall and baseboard types must not be placed via canvas drag.
        if (matDef?.surface === 'wall' || matDef?.unit === 'LF') {
          setDrawState(INITIAL_DRAW_STATE);
          return;
        }

        const newId = generateOverlayId();
        // Dimensions start at 0 — user must enter real measurements in the sidebar.
        // The raw pixel size from the drag is stored for visual rendering only.
        const zone: WMDemolitionZone = {
          id: newId,
          floor_sketch_id: floorSketch.id,
          material_type: matId,
          surface: matDef?.surface ?? 'floor',
          color: matDef?.color ?? '#B8860B',
          x,
          y,
          dimension1_ft: 0,
          dimension2_ft: 0,
          rotation: 0,
          calculated_sqft: 0,
          display_order: state.overlayData.demolition_zones.length,
          pixel_width: wPx,
          pixel_height: hPx,
        };
        addDemolitionZone(zone);
        // Auto-select the new zone so the sidebar opens for dimension input
        selectElement({ element_id: newId, element_type: 'demolition' });
      } else if (activeTool === 'demolition_line') {
        // Wall / baseboard line — drag determines length and angle
        const dx = currentX - startX;
        const dy = currentY - startY;
        const lengthPx = Math.sqrt(dx * dx + dy * dy);
        const lengthFt = pixelsToFeet(lengthPx, scale);
        const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

        const matId = state.activeMaterialTypeId ?? 'wall_drywall';
        const matDef =
          materialTypes.find((m) => m.id === matId) ??
          DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === matId);
        const isLF = matDef?.unit === 'LF';
        const defaultHeight = 8; // default wall height in feet
        const newId = generateOverlayId();

        const zone: WMDemolitionZone = {
          id: newId,
          floor_sketch_id: floorSketch.id,
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
          display_order: state.overlayData.demolition_zones.length,
        };
        addDemolitionZone(zone);
        selectElement({ element_id: newId, element_type: 'demolition' });
      } else if (activeTool === 'containment') {
        // Containment is a line — drag determines length and angle
        const dx = currentX - startX;
        const dy = currentY - startY;
        const lengthPx = Math.sqrt(dx * dx + dy * dy);
        const lengthFt = pixelsToFeet(lengthPx, scale);
        const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
        const heightFt = DEFAULT_CONTAINMENT_HEIGHT_FT;
        const zone: WMContainmentZone = {
          id: generateOverlayId(),
          floor_sketch_id: floorSketch.id,
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
      } else if (activeTool === 'floor_protection') {
        const paperWidth = DEFAULT_PAPER_WIDTH_FT;
        const lengthFt = pixelsToFeet(Math.max(wPx, hPx), scale);
        // Renderer draws width=paperWidth (narrow), height=length (long),
        // so rotation=0 is vertical. For horizontal drag, rotate -90.
        const rotation = wPx >= hPx ? -90 : 0;
        const prot: WMFloorProtection = {
          id: generateOverlayId(),
          floor_sketch_id: floorSketch.id,
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
      } else if (activeTool === 'content_protection') {
        const contentProt: WMContentProtection = {
          id: generateOverlayId(),
          floor_sketch_id: floorSketch.id,
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
      }

      setDrawState(INITIAL_DRAW_STATE);
    },
    [
      drawState,
      state,
      floorSketch.id,
      floorSketch.scale_pixels_per_foot,
      materialTypes,
      addDemolitionZone,
      selectElement,
      addContainment,
      addFloorProtection,
      addContentProtection,
    ]
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
    },
    [selectedIds, batchMoveSelected, updateDemolitionZone, updateEquipment, updateContainment, updateFloorProtection, updateContentProtection]
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
          updateDemolitionZone({
            id,
            dimension1_ft: lengthFt,
            rotation: rot,
            calculated_sqft: isLF ? lengthFt : lengthFt * wallHeight,
          });
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
      }
    },
    [updateDemolitionZone, updateContainment, updateFloorProtection, updateContentProtection, state.overlayData.containment_zones, state.overlayData.demolition_zones, materialTypes]
  );

  // ------------------------------------------------------------------
  // Select handler (Ctrl+click = toggle multi-select)
  // ------------------------------------------------------------------
  const handleSelectElement = useCallback(
    (id: string, type: string, ctrlKey?: boolean) => {
      const sel: import('../../../types/wmSketch').WMSketchSelection = {
        element_id: id,
        element_type: type as 'demolition' | 'equipment' | 'containment' | 'floor_protection' | 'content_protection',
      };
      if (ctrlKey) {
        toggleSelectElement(sel);
      } else {
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

      // Tool shortcuts
      if (e.key === 'v' || e.key === 'V') { setTool('select'); return; }
      if (e.key === 'h' || e.key === 'H') { setTool('pan'); return; }

      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selections.length > 0) {
        for (const sel of state.selections) {
          const { element_id, element_type } = sel;
          if (element_type === 'demolition') removeDemolitionZone(element_id);
          else if (element_type === 'equipment') removeEquipment(element_id);
          else if (element_type === 'containment') removeContainment(element_id);
          else if (element_type === 'floor_protection') removeFloorProtection(element_id);
          else if (element_type === 'content_protection') removeContentProtection(element_id);
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
  ]);

  // ------------------------------------------------------------------
  // Image import / removal
  // ------------------------------------------------------------------
  const [imageSourceType, setImageSourceType] = useState(floorSketch.source_type);
  /**
   * Resolve the background image URL.
   * Cloud-stored images (e.g. Google Drive viewer URLs) cannot be
   * loaded directly by <img>; use the backend proxy endpoint instead.
   */
  const resolveImageUrl = (url: string | undefined | null): string | null => {
    if (!url) return null;
    // Already a proxy / local URL – use as-is
    if (url.startsWith('/') || url.startsWith('blob:')) return url;
    // Google Drive viewer URL → proxy
    if (url.includes('drive.google.com/file/d/')) {
      return `/api/water-mitigation/sketch/floors/${floorSketch.id}/background-image/preview`;
    }
    // Other absolute URLs that aren't directly loadable
    if (url.startsWith('http')) {
      return `/api/water-mitigation/sketch/floors/${floorSketch.id}/background-image/preview`;
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
  // Active material color for rubber-band preview
  // ------------------------------------------------------------------
  const activeMaterialColor = React.useMemo(() => {
    if (state.activeTool === 'containment') return DEFAULT_CONTAINMENT_COLOR;
    if (state.activeTool === 'floor_protection') return DEFAULT_FLOOR_PROTECTION_COLOR;
    if (state.activeTool === 'content_protection') return DEFAULT_CONTENT_PROTECTION_COLOR;
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
        sourceType={imageSourceType}
        backgroundImageUrl={backgroundImageUrl}
        onSourceTypeChange={setImageSourceType}
        onImageImported={handleImageImported}
        onImageRemoved={handleImageRemoved}
        onCalibrateScale={() => setIsCalibrating(true)}
        isCalibrated={floorSketch.scale_pixels_per_foot !== 20}
        scalePixelsPerFoot={floorSketch.scale_pixels_per_foot}
      />

      {/* Toolbar */}
      <WMSketchToolbar
        activeTool={state.activeTool}
        activeMaterialTypeId={state.activeMaterialTypeId}
        activeEquipmentType={state.activeEquipmentType}
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
            onMouseLeave={() => {
              isPanningRef.current = false;
              if (drawState.isDrawing) setDrawState(INITIAL_DRAW_STATE);
            }}
            style={{ display: 'block' }}
          >
            {/* Layer 1 — Background image (fitted to fixed canvas, not viewport) */}
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
          onUpdateDemolitionZone={(id, updates) => updateDemolitionZone({ id, ...updates })}
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
          canvasWidth={stageSize.width}
          canvasHeight={stageSize.height}
          currentScale={floorSketch.scale_pixels_per_foot}
          onCalibrated={handleCalibrated}
          onCancel={() => setIsCalibrating(false)}
        />
      )}
    </div>
  );
};

export default WMFloorSketchEditor;
