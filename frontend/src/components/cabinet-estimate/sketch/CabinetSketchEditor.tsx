/**
 * CabinetSketchEditor
 *
 * Layout drawing for a cabinet estimate, in two views of the same data:
 *
 * - Plan (top): draw walls (click-click, snap-to-endpoint, Shift = axis
 *   lock) and arrange cabinets. Dropped near a wall, a cabinet turns to
 *   back onto it; brought up to another cabinet, it lines its back up with
 *   that one and butts against its side — or, an upper over a base, lines
 *   its end up with the base's (see snapDroppedCabinet).
 * - Front (elevation): each run of cabinets drawn from the front, to
 *   scale, derived from the plan (see buildElevations).
 *
 * The Edit tab's box list decides which cabinets exist: every box × qty
 * has one shape here, kept in step by reconcileCabinets. Placing a cabinet
 * from the dropdown adds a box to the Edit tab; deleting one here takes it
 * off the Edit tab. The sketch itself only stores positions, and never
 * affects pricing on its own.
 *
 * Scoped-down analog of water-mitigation/sketch/WMFloorSketchEditor.tsx.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Line } from 'react-konva';
import Konva from 'konva';
import { Button, Segmented, Select, Space, Tag, Tooltip, message } from 'antd';
import {
  BorderOutlined,
  CompressOutlined,
  DeleteOutlined,
  RedoOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
  SaveOutlined,
  SelectOutlined,
  SwapOutlined,
  TableOutlined,
  UndoOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { cabinetSketchService } from '../../../services/cabinetSketchService';
import { useCabinetSketchState } from '../../../hooks/useCabinetSketchState';
import type {
  CabinetSketchCabinet,
  CabinetSketchOverlayData,
  CabinetSketchView,
  CabinetSketchWall,
} from '../../../types/cabinetSketch';
import { WALL_SNAP_THRESHOLD, DEFAULT_WALL_THICKNESS, DEFAULT_WALL_COLOR } from '../../../types/cabinetSketch';
import { CABINET_PRESETS, getOptionsForType } from '../CabinetBoxEditor';
import { WALL_HEIGHT_OPTIONS } from '../CabinetBoxEditor';
import type { SectionType, WallHeightFilter } from '../CabinetBoxEditor';
import type { CabType } from '../../../types/cabinetEstimate';
import CabinetWallRenderer, { CabinetWallPreview } from './CabinetWallRenderer';
import CabinetShapeRenderer from './CabinetShapeRenderer';
import CabinetElevationView from './CabinetElevationView';
import { pixelsToFeet, generateOverlayId, snapToWallEndpoint, constrainToAxis } from './cabinetSketchUtils';
import {
  buildElevations,
  cabinetKey,
  cornerFootprint,
  footprintDepthIn,
  inToPx,
  reconcileCabinets,
  snapCabinetToNeighbors,
  snapDroppedCabinet,
  turnCabinets,
  type SketchBoxSource,
} from './cabinetSketchLayout';

const CANVAS_HEIGHT = 560;
/** Quiet period after the last change before the sketch saves itself. */
const AUTOSAVE_DELAY_MS = 1500;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
/** An empty sketch opens at 2× so a 30" cabinet is ~100 px wide. */
const DEFAULT_VIEWPORT = { zoom: 2, x: 0, y: 0 };
/** One cabinet picker per Edit-tab section, so each list stays short. */
const PLACE_SECTIONS: { type: SectionType; label: string }[] = [
  { type: 'base', label: 'Base' },
  { type: 'wall', label: 'Wall' },
  { type: 'tall', label: 'Tall' },
];
/** The picker a cabinet belongs in; the legacy 'specialty' type is a base. */
const sectionOf = (cabinet: CabinetSketchCabinet): SectionType =>
  cabinet.cab_type === 'specialty' ? 'base' : cabinet.cab_type;

/**
 * View transform of the plan stage. Canvas coordinates are saved at the
 * sketch's px-per-foot; the view zooms and pans over them without
 * touching the saved data.
 */
interface Viewport {
  zoom: number;
  x: number;
  y: number;
}

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * 1-foot reference grid, drawn in its own non-listening Layer behind the
 * content so it never intercepts the stage clicks that drive wall drawing,
 * cabinet placement, and empty-canvas deselect.
 *
 * Mirrors WMFloorSketchEditor's GridLayer (same 1-ft step and hairline
 * color); the BE canvas's 3-tier minor/major grid exists to serve pan/zoom
 * and snap-to-grid, neither of which this canvas has.
 */
const CabinetGridLayer: React.FC<{
  width: number;
  height: number;
  scalePixelsPerFoot: number;
  viewport: Viewport;
}> = React.memo(({ width, height, scalePixelsPerFoot, viewport }) => {
  const lines = useMemo(() => {
    const step = scalePixelsPerFoot;
    if (step * viewport.zoom < 8) return []; // grid too dense to be useful
    // The visible part of the canvas, in canvas coordinates.
    const x0 = Math.floor(-viewport.x / viewport.zoom / step) * step;
    const y0 = Math.floor(-viewport.y / viewport.zoom / step) * step;
    const x1 = (width - viewport.x) / viewport.zoom;
    const y1 = (height - viewport.y) / viewport.zoom;
    const hairline = 0.5 / viewport.zoom;
    const out: React.ReactNode[] = [];
    for (let x = x0; x <= x1; x += step) {
      out.push(
        <Line key={`v${x}`} points={[x, y0, x, y1]} stroke="#e8e8e8" strokeWidth={hairline} listening={false} />
      );
    }
    for (let y = y0; y <= y1; y += step) {
      out.push(
        <Line key={`h${y}`} points={[x0, y, x1, y]} stroke="#e8e8e8" strokeWidth={hairline} listening={false} />
      );
    }
    return out;
  }, [width, height, scalePixelsPerFoot, viewport]);

  if (lines.length === 0) return null;
  return <Layer listening={false}>{lines}</Layer>;
});

export interface CabinetSketchEditorProps {
  estimateId: string;
  /** The Edit tab's boxes (perimeter + island) — the cabinets the sketch shows. */
  boxes: SketchBoxSource[];
  /** The Edit tab's Upper height: the Wall picker lists only that height. */
  wallHeight?: WallHeightFilter;
  /** False while another tab is showing, so canvas shortcuts (Delete!) stay off. */
  active?: boolean;
  /** A cabinet was placed from the sketch's dropdown — add it to the Edit tab. */
  onCabinetPlaced?: (code: string, cabType: CabType) => void;
  /** Cabinets were deleted on the canvas — take one of each key (see boxKey) off the Edit tab. */
  onCabinetsRemoved?: (keys: string[]) => void;
  /** A cabinet was switched to another code from its picker — change one box of `key` to `code`. */
  onCabinetChanged?: (key: string, code: string) => void;
}

const CabinetSketchEditor: React.FC<CabinetSketchEditorProps> = ({
  estimateId,
  boxes,
  wallHeight = 'all',
  active = true,
  onCabinetPlaced,
  onCabinetsRemoved,
  onCabinetChanged,
}) => {
  const queryClient = useQueryClient();
  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(900);
  const [showGrid, setShowGrid] = useState(true);
  const [view, setView] = useState<CabinetSketchView>('plan');
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [runKey, setRunKey] = useState<string | undefined>(undefined);

  const { data: sketch, isLoading } = useQuery({
    queryKey: ['cabinet-sketch', estimateId],
    queryFn: () => cabinetSketchService.getSketch(estimateId),
    enabled: !!estimateId,
  });

  // The plan container only exists once loading is done and while the plan
  // view is up, so re-attach the observer whenever either changes.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setStageWidth(Math.max(400, Math.floor(width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [isLoading, view]);

  const {
    state,
    setTool,
    setActivePreset,
    selectElement,
    toggleSelectElement,
    deselect,
    selectedIds,
    batchMoveSelected,
    addWall,
    updateWall,
    removeWall,
    addCabinet,
    updateCabinet,
    updateCabinets,
    removeCabinet,
    syncCabinets,
    loadOverlayData,
    markSaved,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useCabinetSketchState();

  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (sketch && !loaded) {
      loadOverlayData(sketch.overlay_data);
      setLoaded(true);
    }
  }, [sketch, loaded, loadOverlayData]);

  const scalePixelsPerFoot = sketch?.scale_pixels_per_foot ?? 20;
  const { cabinets, walls } = state.overlayData;

  // Keep the shapes in step with the Edit tab. Also re-runs after undo/redo,
  // which can bring back a shape whose box is gone (or drop one that has a box).
  useEffect(() => {
    if (!loaded) return;
    const next = reconcileCabinets(cabinets, boxes, walls, CABINET_PRESETS, scalePixelsPerFoot);
    if (next) syncCabinets(next);
  }, [loaded, boxes, cabinets, walls, scalePixelsPerFoot, syncCabinets]);

  // ------------------------------------------------------------------
  // Saving: on demand, after a quiet period, and when leaving the page
  // ------------------------------------------------------------------
  const latestRef = useRef({ overlayData: state.overlayData, isDirty: state.isDirty });
  latestRef.current = { overlayData: state.overlayData, isDirty: state.isDirty };

  const saveMutation = useMutation({
    mutationFn: (data: CabinetSketchOverlayData) => cabinetSketchService.saveOverlay(estimateId, data),
    onSuccess: (_result, data) => {
      // Only clear the dirty flag if nothing changed while the request was out.
      if (latestRef.current.overlayData === data) markSaved();
    },
  });
  const { mutate: saveOverlay, isPending: isSaving } = saveMutation;

  const handleManualSave = useCallback(() => {
    saveOverlay(state.overlayData, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['cabinet-sketch', estimateId] });
        message.success('Sketch saved');
      },
      onError: () => message.error('Failed to save sketch'),
    });
  }, [saveOverlay, state.overlayData, queryClient, estimateId]);

  useEffect(() => {
    if (!loaded || !state.isDirty) return;
    const timer = window.setTimeout(() => {
      saveOverlay(latestRef.current.overlayData, {
        onError: () => message.error('Failed to save sketch'),
      });
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [loaded, state.isDirty, state.overlayData, saveOverlay]);

  useEffect(() => {
    return () => {
      const { isDirty, overlayData } = latestRef.current;
      if (isDirty) cabinetSketchService.saveOverlay(estimateId, overlayData).catch(() => {});
    };
  }, [estimateId]);

  // ------------------------------------------------------------------
  // Wall drawing state (click-click paradigm, chained)
  // ------------------------------------------------------------------
  const [wallDrawStart, setWallDrawStart] = useState<{ x: number; y: number } | null>(null);
  const wallDrawStartRef = useRef(wallDrawStart);
  wallDrawStartRef.current = wallDrawStart;
  const [wallDrawCursor, setWallDrawCursor] = useState<{ x: number; y: number } | null>(null);
  const [wallSnapEnd, setWallSnapEnd] = useState<{ x: number; y: number } | null>(null);

  const stopWallChain = useCallback(() => {
    setWallDrawStart(null);
    setWallDrawCursor(null);
    setWallSnapEnd(null);
  }, []);

  const getCanvasPos = useCallback((): { x: number; y: number } => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    // Undo the view zoom/pan, so positions are in saved canvas coordinates.
    const ptr = stage.getRelativePointerPosition();
    if (!ptr) return { x: 0, y: 0 };
    return { x: ptr.x, y: ptr.y };
  }, []);

  const handleStageMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const wds = wallDrawStartRef.current;
      if (state.activeTool !== 'wall' || !wds) return;
      const pos = getCanvasPos();
      let endPos = pos;
      if (e.evt.shiftKey) endPos = constrainToAxis(wds, pos);
      const snap = snapToWallEndpoint(endPos, walls, WALL_SNAP_THRESHOLD);
      setWallDrawCursor(snap.snapped ? snap.point : endPos);
      setWallSnapEnd(snap.snapped ? snap.point : null);
    },
    [state.activeTool, walls, getCanvasPos]
  );

  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Clicking empty canvas deselects, unless a tool is actively placing something.
      const clickedOnEmpty = e.target === e.target.getStage();
      const pos = getCanvasPos();

      if (state.activeTool === 'wall') {
        const snapped = snapToWallEndpoint(pos, walls, WALL_SNAP_THRESHOLD);
        const wds = wallDrawStartRef.current;
        if (!wds) {
          setWallDrawStart(snapped.point);
          setWallDrawCursor(snapped.point);
        } else {
          let endPoint = snapped.point;
          if (e.evt.shiftKey) endPoint = constrainToAxis(wds, endPoint);

          const dx = endPoint.x - wds.x;
          const dy = endPoint.y - wds.y;
          const lengthPx = Math.sqrt(dx * dx + dy * dy);
          if (lengthPx > 5) {
            const wall: CabinetSketchWall = {
              id: generateOverlayId(),
              start_x: wds.x,
              start_y: wds.y,
              end_x: endPoint.x,
              end_y: endPoint.y,
              thickness: DEFAULT_WALL_THICKNESS,
              color: DEFAULT_WALL_COLOR,
              length_ft: pixelsToFeet(lengthPx, scalePixelsPerFoot),
            };
            addWall(wall);
            // Chain: continue drawing from the endpoint just placed.
            setWallDrawStart(endPoint);
            setWallDrawCursor(endPoint);
          }
        }
        return;
      }

      if (state.activeTool === 'place_cabinet' && state.activePresetCode) {
        const code = state.activePresetCode;
        const preset = CABINET_PRESETS[code];
        if (preset) {
          const depthIn = footprintDepthIn(preset.cab_type, preset.specialty, preset.width);
          const width = inToPx(preset.width, scalePixelsPerFoot);
          const height = inToPx(depthIn, scalePixelsPerFoot);
          const id = generateOverlayId();
          const dropped = {
            id,
            cab_type: preset.cab_type,
            x: pos.x - width / 2,
            y: pos.y - height / 2,
            width,
            height,
            rotation: 0,
          };
          const placed = snapDroppedCabinet(dropped, cabinets, walls, scalePixelsPerFoot);
          const cabinet: CabinetSketchCabinet = {
            id,
            preset_code: code,
            cab_type: preset.cab_type,
            x: placed.x,
            y: placed.y,
            width,
            height,
            rotation: placed.rotation,
            label: code,
            location: 'perimeter',
            width_in: preset.width,
            depth_in: depthIn,
            height_in: preset.height,
          };
          // Same event, so React batches this with the parent's new box and
          // the sync never sees the shape without its box.
          addCabinet(cabinet);
          onCabinetPlaced?.(code, preset.cab_type);
        }
        setTool('select');
        setActivePreset(null);
        return;
      }

      if (clickedOnEmpty) deselect();
    },
    [
      state.activeTool,
      state.activePresetCode,
      cabinets,
      walls,
      scalePixelsPerFoot,
      getCanvasPos,
      addWall,
      addCabinet,
      onCabinetPlaced,
      setTool,
      setActivePreset,
      deselect,
    ]
  );

  const deleteSelected = useCallback(() => {
    const removedKeys = cabinets
      .filter((c) => selectedIds.has(c.id))
      .map((c) => cabinetKey(c, CABINET_PRESETS, scalePixelsPerFoot));
    selectedIds.forEach((id) => {
      removeWall(id);
      removeCabinet(id);
    });
    if (removedKeys.length > 0) onCabinetsRemoved?.(removedKeys);
  }, [cabinets, selectedIds, scalePixelsPerFoot, removeWall, removeCabinet, onCabinetsRemoved]);

  // A quarter turn of the selected cabinets, as one piece — e.g. to set
  // the end runs of a three-sided island across the main one.
  const hasSelectedCabinet = cabinets.some((c) => selectedIds.has(c.id));
  const turnSelected = useCallback(
    (degrees: 90 | -90) => {
      const picked = cabinets.filter((c) => selectedIds.has(c.id));
      if (picked.length > 0) updateCabinets(turnCabinets(picked, degrees));
    },
    [cabinets, selectedIds, updateCabinets]
  );

  // Cancel an in-progress wall chain, and undo/redo/delete shortcuts —
  // only while this tab is the one on screen.
  useEffect(() => {
    if (!active || view !== 'plan') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      if (e.key === 'Escape') {
        // Deselecting turns the pickers back to adding cabinets.
        if (wallDrawStartRef.current) stopWallChain();
        else deselect();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault();
        deleteSelected();
        return;
      }
      // R turns the selection a quarter turn clockwise, Shift+R back.
      if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        turnSelected(e.shiftKey ? -90 : 90);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, view, undo, redo, selectedIds, deleteSelected, stopWallChain, deselect, turnSelected]);

  const handleSelect = useCallback(
    (elementType: 'wall' | 'cabinet') => (id: string, ctrlKey?: boolean) => {
      if (ctrlKey) toggleSelectElement({ element_id: id, element_type: elementType });
      else selectElement({ element_id: id, element_type: elementType });
    },
    [selectElement, toggleSelectElement]
  );

  const handleCabinetDragEnd = useCallback(
    (id: string, x: number, y: number) => {
      if (selectedIds.size > 1 && selectedIds.has(id)) {
        batchMoveSelected(id, x, y);
        return;
      }
      const cabinet = cabinets.find((c) => c.id === id);
      const snapped = cabinet ? snapDroppedCabinet({ ...cabinet, x, y }, cabinets, walls, scalePixelsPerFoot) : null;
      updateCabinet(snapped ? { id, ...snapped } : { id, x, y });
    },
    [selectedIds, cabinets, walls, scalePixelsPerFoot, batchMoveSelected, updateCabinet]
  );

  // Show a lone dragged cabinet lined up with the neighbour it will snap
  // to. Wall snapping waits for the drop: turning mid-drag would swing the
  // shape out from under the pointer.
  const handleCabinetDragSnap = useCallback(
    (id: string, x: number, y: number) => {
      if (selectedIds.size > 1 && selectedIds.has(id)) return null;
      const cabinet = cabinets.find((c) => c.id === id);
      return cabinet ? snapCabinetToNeighbors({ ...cabinet, x, y }, cabinets, scalePixelsPerFoot) : null;
    },
    [selectedIds, cabinets, scalePixelsPerFoot]
  );

  const handleCabinetTransformEnd = useCallback(
    (id: string, x: number, y: number, rotation: number) => {
      updateCabinet({ id, x, y, rotation });
    },
    [updateCabinet]
  );

  const handleWallEndpointDrag = useCallback(
    (wallId: string, endpoint: 'start' | 'end', x: number, y: number) => {
      const snap = snapToWallEndpoint({ x, y }, walls, WALL_SNAP_THRESHOLD);
      const pt = snap.point;
      const wall = walls.find((w) => w.id === wallId);
      if (!wall) return;
      const otherX = endpoint === 'start' ? wall.end_x : wall.start_x;
      const otherY = endpoint === 'start' ? wall.end_y : wall.start_y;
      const newLength = pixelsToFeet(Math.hypot(pt.x - otherX, pt.y - otherY), scalePixelsPerFoot);
      updateWall({
        id: wallId,
        ...(endpoint === 'start' ? { start_x: pt.x, start_y: pt.y } : { end_x: pt.x, end_y: pt.y }),
        length_ft: newLength,
      });
    },
    [walls, scalePixelsPerFoot, updateWall]
  );

  const handleWallDragEnd = useCallback(
    (wallId: string, dx: number, dy: number) => {
      const wall = walls.find((w) => w.id === wallId);
      if (!wall) return;
      updateWall({
        id: wallId,
        start_x: wall.start_x + dx,
        start_y: wall.start_y + dy,
        end_x: wall.end_x + dx,
        end_y: wall.end_y + dy,
      });
    },
    [walls, updateWall]
  );

  // Cabinet catalog, one select per section with CabinetBoxEditor's groups
  // (Specialty, Oven, …) and its Upper height, listed by name only — the
  // code stays searchable. The "+ Custom Size..." entries are dropped: a
  // custom box needs its size typed in the Edit tab.
  const presetOptions = useMemo(() => {
    const out = {} as Record<SectionType, { label: string; options: { label: string; value: string }[] }[]>;
    for (const { type } of PLACE_SECTIONS) {
      out[type] = getOptionsForType(type, wallHeight)
        .map((group) => ({
          label: group.label,
          options: group.options
            .filter((o) => CABINET_PRESETS[o.value])
            .map((o) => ({ label: CABINET_PRESETS[o.value].label, value: o.value })),
        }))
        .filter((group) => group.options.length > 0);
    }
    return out;
  }, [wallHeight]);
  const wallHeightLabel = WALL_HEIGHT_OPTIONS.find((o) => o.value === wallHeight)?.label;

  // ------------------------------------------------------------------
  // Plan zoom / pan (view only)
  // ------------------------------------------------------------------
  const fitView = useCallback(() => {
    const pts: { x: number; y: number }[] = walls.flatMap((w) => [
      { x: w.start_x, y: w.start_y },
      { x: w.end_x, y: w.end_y },
    ]);
    for (const c of cabinets) {
      const r = (c.rotation * Math.PI) / 180;
      const across = { x: Math.cos(r) * c.width, y: Math.sin(r) * c.width };
      const deep = { x: -Math.sin(r) * c.height, y: Math.cos(r) * c.height };
      pts.push(
        { x: c.x, y: c.y },
        { x: c.x + across.x, y: c.y + across.y },
        { x: c.x + deep.x, y: c.y + deep.y },
        { x: c.x + across.x + deep.x, y: c.y + across.y + deep.y }
      );
    }
    if (pts.length === 0) {
      setViewport(DEFAULT_VIEWPORT);
      return;
    }
    const margin = 2 * scalePixelsPerFoot;
    const minX = Math.min(...pts.map((p) => p.x)) - margin;
    const maxX = Math.max(...pts.map((p) => p.x)) + margin;
    const minY = Math.min(...pts.map((p) => p.y)) - margin;
    const maxY = Math.max(...pts.map((p) => p.y)) + margin;
    const zoom = clampZoom(Math.min(stageWidth / (maxX - minX), CANVAS_HEIGHT / (maxY - minY)));
    setViewport({
      zoom,
      x: stageWidth / 2 - ((minX + maxX) / 2) * zoom,
      y: CANVAS_HEIGHT / 2 - ((minY + maxY) / 2) * zoom,
    });
  }, [walls, cabinets, scalePixelsPerFoot, stageWidth]);

  // Frame the drawing once, the first time it has something in it.
  const framedRef = useRef(false);
  useEffect(() => {
    if (!loaded || framedRef.current || (cabinets.length === 0 && walls.length === 0)) return;
    framedRef.current = true;
    fitView();
  }, [loaded, cabinets.length, walls.length, fitView]);

  const zoomAt = useCallback((factor: number, at: { x: number; y: number }) => {
    setViewport((v) => {
      const zoom = clampZoom(v.zoom * factor);
      const k = zoom / v.zoom;
      return { zoom, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k };
    });
  }, []);
  const zoomAtCenter = (factor: number) => zoomAt(factor, { x: stageWidth / 2, y: CANVAS_HEIGHT / 2 });

  // Ctrl/Cmd + wheel (a trackpad pinch arrives as ctrl + wheel too) zooms
  // at the pointer; a plain wheel keeps scrolling the page.
  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      if (!e.evt.ctrlKey && !e.evt.metaKey) return;
      e.evt.preventDefault();
      const ptr = stageRef.current?.getPointerPosition();
      if (ptr) zoomAt(e.evt.deltaY < 0 ? 1.1 : 1 / 1.1, ptr);
    },
    [zoomAt]
  );

  // Dragging empty canvas pans. Shape drags bubble up here too, so ignore those.
  const handleStageDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const stage = stageRef.current;
    if (!stage || e.target !== stage) return;
    setViewport((v) => ({ ...v, x: stage.x(), y: stage.y() }));
  }, []);

  const elevations = useMemo(
    () => buildElevations(cabinets, walls, CABINET_PRESETS, scalePixelsPerFoot),
    [cabinets, walls, scalePixelsPerFoot]
  );

  // Corner units (lazy susan, blind, diagonal, easy-reach) draw their own footprint.
  const cornerShapes = useMemo(() => {
    const out = new Map<string, NonNullable<ReturnType<typeof cornerFootprint>>>();
    for (const c of cabinets) {
      const shape = cornerFootprint(c, CABINET_PRESETS, scalePixelsPerFoot);
      if (shape) out.set(c.id, shape);
    }
    return out;
  }, [cabinets, scalePixelsPerFoot]);
  const selectedCabinet = selectedIds.size === 1 ? cabinets.find((c) => selectedIds.has(c.id)) : undefined;
  // The one selected cabinet, if it is a corner unit whose corner end can be flipped.
  const flipTarget = selectedCabinet && cornerShapes.has(selectedCabinet.id) ? selectedCabinet : undefined;
  const currentRun = elevations.find((r) => r.key === runKey) ?? elevations[0];

  // Switch a cabinet to another code from its picker. It keeps its place
  // (back-left corner, rotation, corner side, glass) and takes the new size.
  const changeCabinet = (cabinet: CabinetSketchCabinet, code: string) => {
    const preset = CABINET_PRESETS[code];
    if (!preset || code === cabinet.preset_code) return;
    const depthIn = footprintDepthIn(preset.cab_type, preset.specialty, preset.width);
    const key = cabinetKey(cabinet, CABINET_PRESETS, scalePixelsPerFoot);
    // Same event as the parent's box change, so the sync sees both together
    // and the shape stays matched to its (changed) box.
    updateCabinet({
      id: cabinet.id,
      preset_code: code,
      cab_type: preset.cab_type,
      label: code,
      width_in: preset.width,
      depth_in: depthIn,
      height_in: preset.height,
      width: inToPx(preset.width, scalePixelsPerFoot),
      height: inToPx(depthIn, scalePixelsPerFoot),
    });
    onCabinetChanged?.(key, code);
  };

  if (isLoading) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>Loading sketch…</div>;
  }

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Segmented<CabinetSketchView>
          value={view}
          onChange={(v) => {
            setView(v);
            stopWallChain();
            setTool('select');
            setActivePreset(null);
          }}
          options={[
            { label: <Tooltip title="Floor plan, seen from above">Top</Tooltip>, value: 'plan' },
            { label: <Tooltip title="Elevation of each run, seen from the front">Front</Tooltip>, value: 'elevation' },
          ]}
        />

        {view === 'plan' ? (
          <>
            <Tooltip title="Select / move / rotate">
              <Button
                type={state.activeTool === 'select' ? 'primary' : 'default'}
                icon={<SelectOutlined />}
                onClick={() => {
                  setTool('select');
                  stopWallChain();
                }}
              >
                Select
              </Button>
            </Tooltip>
            <Tooltip title="Draw walls — click to start, click again to place, Esc to stop, Shift to lock to horizontal/vertical">
              <Button
                type={state.activeTool === 'wall' ? 'primary' : 'default'}
                icon={<BorderOutlined />}
                onClick={() => setTool('wall')}
              >
                Draw Wall
              </Button>
            </Tooltip>
            <Tooltip title={`${showGrid ? 'Hide' : 'Show'} 1 ft reference grid`}>
              <Button
                type={showGrid ? 'primary' : 'default'}
                ghost={showGrid}
                icon={<TableOutlined />}
                onClick={() => setShowGrid((v) => !v)}
              />
            </Tooltip>
            <Space.Compact>
              <Tooltip title="Zoom out">
                <Button icon={<ZoomOutOutlined />} onClick={() => zoomAtCenter(1 / 1.25)} />
              </Tooltip>
              <Tooltip title="Fit the drawing to the view. Ctrl + scroll zooms; drag empty canvas to pan.">
                <Button icon={<CompressOutlined />} onClick={fitView}>
                  {Math.round(viewport.zoom * 100)}%
                </Button>
              </Tooltip>
              <Tooltip title="Zoom in">
                <Button icon={<ZoomInOutlined />} onClick={() => zoomAtCenter(1.25)} />
              </Tooltip>
            </Space.Compact>

            <Space.Compact>
              {PLACE_SECTIONS.map(({ type, label }) => {
                // Only the picker the pending placement came from shows it.
                // Otherwise the selected cabinet shows in its section's
                // picker, and picking there changes that cabinet.
                const placing = state.activeTool === 'place_cabinet' ? state.activePresetCode : null;
                const editing = !placing && selectedCabinet && sectionOf(selectedCabinet) === type ? selectedCabinet : undefined;
                const picked = placing && CABINET_PRESETS[placing]?.cab_type === type ? placing : editing?.preset_code;
                return (
                  <Select
                    // Remount when the pending placement clears or moves to another
                    // picker, so it falls back to the placeholder instead of keeping
                    // the last pick.
                    key={`${type}:${picked ?? 'idle'}`}
                    // The Wall picker says which height it's narrowed to, e.g. "+ Wall 36"…".
                    placeholder={`+ ${label}${type === 'wall' && wallHeight !== 'all' ? ` ${wallHeightLabel}` : ''}…`}
                    style={{ width: type === 'wall' && wallHeight !== 'all' ? 140 : 120 }}
                    popupMatchSelectWidth={300}
                    showSearch
                    value={picked}
                    // A custom box, or an upper outside the height filter, isn't in the list.
                    labelRender={(p) => p.label ?? CABINET_PRESETS[String(p.value)]?.label ?? editing?.label ?? p.value}
                    onChange={(value: string) => {
                      if (editing) {
                        changeCabinet(editing, value);
                        return;
                      }
                      setActivePreset(value);
                      setTool('place_cabinet');
                    }}
                    options={presetOptions[type]}
                    filterOption={(input, option: any) =>
                      `${option?.label ?? ''} ${option?.value ?? ''}`.toLowerCase().includes(input.toLowerCase())
                    }
                  />
                );
              })}
            </Space.Compact>
            {state.activeTool === 'place_cabinet' && state.activePresetCode ? (
              <Tag color="blue">
                Click canvas to place {CABINET_PRESETS[state.activePresetCode]?.label ?? state.activePresetCode}
              </Tag>
            ) : (
              selectedCabinet && (
                <Tag>
                  Pick another {PLACE_SECTIONS.find((s) => s.type === sectionOf(selectedCabinet))?.label} to replace{' '}
                  {selectedCabinet.label || selectedCabinet.preset_code}
                </Tag>
              )
            )}

            <Button icon={<UndoOutlined />} disabled={!canUndo} onClick={undo} />
            <Button icon={<RedoOutlined />} disabled={!canRedo} onClick={redo} />
            <Tooltip title="Also removes the cabinet from the Edit tab list">
              <Button icon={<DeleteOutlined />} danger disabled={selectedIds.size === 0} onClick={deleteSelected}>
                Delete
              </Button>
            </Tooltip>
            <Space.Compact>
              <Tooltip title="Turn 90° counter-clockwise (Shift+R). Several selected turn together.">
                <Button icon={<RotateLeftOutlined />} disabled={!hasSelectedCabinet} onClick={() => turnSelected(-90)} />
              </Tooltip>
              <Tooltip title="Turn 90° clockwise (R). Several selected turn together.">
                <Button icon={<RotateRightOutlined />} disabled={!hasSelectedCabinet} onClick={() => turnSelected(90)} />
              </Tooltip>
            </Space.Compact>
            {flipTarget && (
              <Tooltip title="Swap which end of the corner cabinet sits in the corner (for an angle end: which end is full depth)">
                <Button
                  icon={<SwapOutlined />}
                  onClick={() =>
                    updateCabinet({
                      id: flipTarget.id,
                      corner_side: flipTarget.corner_side === 'right' ? 'left' : 'right',
                    })
                  }
                >
                  Flip corner
                </Button>
              </Tooltip>
            )}
          </>
        ) : (
          elevations.length > 1 && (
            <Select
              style={{ width: 200 }}
              value={currentRun?.key}
              onChange={setRunKey}
              options={elevations.map((r) => ({ label: `${r.label} (${r.items.length})`, value: r.key }))}
            />
          )
        )}

        <Button type="primary" icon={<SaveOutlined />} loading={isSaving} onClick={handleManualSave}>
          Save Sketch{state.isDirty ? ' *' : ''}
        </Button>
      </Space>

      {view === 'plan' ? (
        <div
          ref={containerRef}
          style={{ border: '1px solid #d9d9d9', borderRadius: 4, overflow: 'hidden', background: '#fafafa' }}
        >
          <Stage
            ref={stageRef}
            width={stageWidth}
            height={CANVAS_HEIGHT}
            onClick={handleStageClick}
            onTap={handleStageClick}
            onMouseMove={handleStageMouseMove}
            onWheel={handleWheel}
            scaleX={viewport.zoom}
            scaleY={viewport.zoom}
            x={viewport.x}
            y={viewport.y}
            draggable={state.activeTool === 'select'}
            onDragEnd={handleStageDragEnd}
            style={{ cursor: state.activeTool === 'wall' || state.activeTool === 'place_cabinet' ? 'crosshair' : 'default' }}
          >
            {showGrid && (
              <CabinetGridLayer
                width={stageWidth}
                height={CANVAS_HEIGHT}
                scalePixelsPerFoot={scalePixelsPerFoot}
                viewport={viewport}
              />
            )}

            <Layer>
              {walls.map((wall) => (
                <CabinetWallRenderer
                  key={wall.id}
                  wall={wall}
                  isSelected={selectedIds.has(wall.id)}
                  onSelect={handleSelect('wall')}
                  onDragEndpoint={handleWallEndpointDrag}
                  onWallDragEnd={handleWallDragEnd}
                  zoom={viewport.zoom}
                />
              ))}

              {wallDrawStart && wallDrawCursor && (
                <CabinetWallPreview
                  startX={wallDrawStart.x}
                  startY={wallDrawStart.y}
                  endX={wallDrawCursor.x}
                  endY={wallDrawCursor.y}
                  snappedEnd={wallSnapEnd}
                />
              )}

              {/* Floor-standing cabinets first, so uppers draw (and pick) on top of the bases they hang over. */}
              {[...cabinets.filter((c) => c.cab_type !== 'wall'), ...cabinets.filter((c) => c.cab_type === 'wall')].map(
                (cabinet) => (
                  <CabinetShapeRenderer
                    key={cabinet.id}
                    cabinet={cabinet}
                    isSelected={selectedIds.has(cabinet.id)}
                    onSelect={handleSelect('cabinet')}
                    onDragEnd={handleCabinetDragEnd}
                    onDragSnap={handleCabinetDragSnap}
                    onTransformEnd={handleCabinetTransformEnd}
                    zoom={viewport.zoom}
                    corner={cornerShapes.get(cabinet.id)}
                  />
                )
              )}
            </Layer>
          </Stage>
        </div>
      ) : (
        <div style={{ border: '1px solid #d9d9d9', borderRadius: 4, overflow: 'hidden', background: '#ffffff' }}>
          <CabinetElevationView
            run={currentRun}
            presets={CABINET_PRESETS}
            height={CANVAS_HEIGHT}
            selectedIds={selectedIds}
          />
        </div>
      )}

      <div style={{ marginTop: 8, color: '#999', fontSize: 13 }}>
        {cabinets.length === 0
          ? 'Cabinets you add in the Edit tab appear here. You can also draw the walls first, then pick a cabinet from the dropdown and click the canvas to place it.'
          : view === 'plan'
            ? 'Drag cabinets into place — dropped near a wall, a cabinet turns to back onto it; brought up beside another cabinet, it lines up and butts against it; an upper over a base lines up with its ends. Dashed shapes are uppers; a blue double-line front marks glass doors. Sizes and glass come from the Edit tab; a selected cabinet shows in its list above, where picking another changes it (Esc or a click on empty canvas to add new ones instead).'
            : 'Each run is drawn from the front, as laid out in the plan. Uppers hang at 54" above the floor; shorter ones line up with their tops.'}
      </div>
    </div>
  );
};

export default CabinetSketchEditor;
