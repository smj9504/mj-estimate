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
 * off the Edit tab. Likewise each unit of the Edit tab's Appliance Detach &
 * Reset list is drawn where it goes (reconcileAppliances), and a sink on
 * each sink base. The sketch itself only stores positions, and never
 * affects pricing on its own.
 *
 * Scoped-down analog of water-mitigation/sketch/WMFloorSketchEditor.tsx.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Line, Shape } from 'react-konva';
import Konva from 'konva';
import { Button, InputNumber, Segmented, Select, Space, Tag, Tooltip, message } from 'antd';
import {
  BorderOutlined,
  CameraOutlined,
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
  CabinetSketchAppliance,
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
import { ApplianceShape, DR_TAG_COLOR, SinkShape } from './CabinetApplianceRenderer';
import CabinetElevationView from './CabinetElevationView';
import KitchenFinishPicker from './KitchenFinishPicker';
import AiPhotoModal from './AiPhotoModal';
import { finishOf } from './kitchenFinish';
import { productWords } from './productLook';
import { useProductLook } from './useProductLook';
import type { ProductSnapshot } from '../../../types/productLibrary';
import type { Cabinet3DViewHandle } from './Cabinet3DView';
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
  countAngledJoints,
  islandJointFillers,
  islandTopAreaSf,
  islandTopPieces,
  polygonUnion,
  TOP_EDGE_OVERHANG_IN,
  cabinetSizeIn,
  type SketchBoxSource,
} from './cabinetSketchLayout';
import {
  SINK_SPECIALTIES,
  applianceNeighbors,
  applianceSpec,
  placeDroppedAppliance,
  reconcileAppliances,
} from './sketchAppliances';
import { lazyWithRetry } from '../../../utils/lazyWithRetry';

// three.js is big; it's only fetched once the 3D view is opened.
const Cabinet3DView = lazyWithRetry(() => import('./Cabinet3DView'));

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
const NO_APPLIANCES: CabinetSketchAppliance[] = [];
const NO_LIST: { type: string; qty: number }[] = [];

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
  /** "Use in estimate" on the plan's angled-joint count — set the Edit tab's Angled Joints to it. */
  onApplyAngledJoints?: (count: number) => void;
  /** The Edit tab's island seating overhang, inches (0 = edge overhang only), for the island top. */
  islandSeatingIn?: number;
  /** "Use in estimate" on the plan's island top — set the Edit tab's island countertop SF to it. */
  onApplyIslandTopSf?: (sf: number) => void;
  /** The Edit tab's Appliance Detach & Reset list (empty when that is off) — the appliances the sketch shows. */
  applianceList?: { type: string; qty: number }[];
  /** Bowls of the sink drawn on each sink base: the Edit tab's sink type. */
  sinkBowls?: 1 | 2;
  /**
   * An upgrade option's chosen products, by slot: the realistic 3D view
   * draws them over the finish, and the chosen sink's bowls everywhere.
   */
  products?: Record<string, ProductSnapshot> | null;
  /** The Edit tab's Crown Molding scope: the 3D and Front views top the uppers and talls with it. */
  crownMolding?: boolean;
}

const CabinetSketchEditor: React.FC<CabinetSketchEditorProps> = ({
  estimateId,
  boxes,
  wallHeight = 'all',
  active = true,
  onCabinetPlaced,
  onCabinetsRemoved,
  onCabinetChanged,
  onApplyAngledJoints,
  islandSeatingIn = 0,
  onApplyIslandTopSf,
  applianceList = NO_LIST,
  sinkBowls: scopeSinkBowls = 1,
  products = null,
  crownMolding = false,
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
    updateAppliances,
    syncAppliances,
    setFinish,
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
  const finish = useMemo(() => finishOf(state.overlayData.finish), [state.overlayData.finish]);
  // An option's products over the finish; a chosen sink's own bowls over the Edit tab's sink type
  const look = useProductLook(finish, products);
  const sinkBowls = look.sinkBowls ?? scopeSinkBowls;
  // The 3D view's look: the outlined drawing, or the kitchen in its finish.
  const [realistic, setRealistic] = useState(false);
  const view3dRef = useRef<Cabinet3DViewHandle>(null);
  // The realistic view as it was framed when AI photo was clicked; the AI photo dialog is open while set.
  const [aiPhotoRender, setAiPhotoRender] = useState<string | null>(null);
  // The 3D view, once opened, stays mounted (hidden) so it needn't start over.
  const [opened3d, setOpened3d] = useState(false);
  if (view === '3d' && !opened3d) setOpened3d(true);
  const appliances = state.overlayData.appliances ?? NO_APPLIANCES;

  // Keep the shapes in step with the Edit tab. Also re-runs after undo/redo,
  // which can bring back a shape whose box is gone (or drop one that has a box).
  // The appliances follow once the cabinets have settled, so a new range finds
  // the range base that came with it, and those in a cabinet move with it.
  useEffect(() => {
    if (!loaded) return;
    const next = reconcileCabinets(cabinets, boxes, walls, CABINET_PRESETS, scalePixelsPerFoot);
    if (next) {
      syncCabinets(next);
      return;
    }
    const nextAppliances = reconcileAppliances(appliances, applianceList, cabinets, walls, CABINET_PRESETS, scalePixelsPerFoot);
    if (nextAppliances) syncAppliances(nextAppliances);
  }, [loaded, boxes, cabinets, walls, appliances, applianceList, scalePixelsPerFoot, syncCabinets, syncAppliances]);

  // What a dropped cabinet lines up with: the other cabinets, and free-standing appliances.
  const neighbors = useMemo(() => [...cabinets, ...applianceNeighbors(appliances)], [cabinets, appliances]);

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
          const placed = snapDroppedCabinet(dropped, neighbors, walls, scalePixelsPerFoot);
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
      neighbors,
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

  // Appliances come and go with the Edit tab's list, so Delete leaves them.
  const deletableIds = useMemo(
    () => state.selections.filter((s) => s.element_type !== 'appliance').map((s) => s.element_id),
    [state.selections]
  );
  const deleteSelected = useCallback(() => {
    const removedKeys = cabinets
      .filter((c) => deletableIds.includes(c.id))
      .map((c) => cabinetKey(c, CABINET_PRESETS, scalePixelsPerFoot));
    deletableIds.forEach((id) => {
      removeWall(id);
      removeCabinet(id);
    });
    if (removedKeys.length > 0) onCabinetsRemoved?.(removedKeys);
  }, [cabinets, deletableIds, scalePixelsPerFoot, removeWall, removeCabinet, onCabinetsRemoved]);

  // Turn the selected cabinets (and free-standing appliances) as one piece —
  // a quarter turn for the ends of a three-sided island, 45° (or any angle)
  // for a side of an angled one.
  const pickedAppliances = appliances.filter((a) => selectedIds.has(a.id) && !a.host_id);
  const hasSelectedCabinet = cabinets.some((c) => selectedIds.has(c.id)) || pickedAppliances.length > 0;
  const turnSelected = useCallback(
    (degrees: number) => {
      const picked = cabinets.filter((c) => selectedIds.has(c.id));
      const pickedApps = appliances.filter((a) => selectedIds.has(a.id) && !a.host_id);
      if (picked.length + pickedApps.length === 0 || degrees === 0) return;
      const turned = turnCabinets([...picked, ...pickedApps], degrees);
      const isApp = new Set(pickedApps.map((a) => a.id));
      if (picked.length > 0) updateCabinets(turned.filter((t) => !isApp.has(t.id)));
      if (pickedApps.length > 0) updateAppliances(turned.filter((t) => isApp.has(t.id)));
    },
    [cabinets, appliances, selectedIds, updateCabinets, updateAppliances]
  );
  // The selection's angle, -180..180 (0 = backed to the top of the screen),
  // or null when the selected cabinets and free-standing appliances are turned different ways.
  const selectedAngle = useMemo(() => {
    const picked = [
      ...cabinets.filter((c) => selectedIds.has(c.id)),
      ...appliances.filter((a) => selectedIds.has(a.id) && !a.host_id),
    ];
    if (picked.length === 0) return null;
    const first = picked[0].rotation;
    if (picked.some((c) => Math.abs(((((c.rotation - first) % 360) + 540) % 360) - 180) > 0.5)) return null;
    return Math.round((((((first % 360) + 540) % 360) - 180) * 10)) / 10;
  }, [cabinets, appliances, selectedIds]);
  // What is being typed into the angle box, applied on Enter / leaving it.
  const [angleDraft, setAngleDraft] = useState<number | null>(null);
  const applyAngle = useCallback(
    (angle: number | null) => {
      setAngleDraft(null);
      if (angle !== null && selectedAngle !== null) turnSelected(angle - selectedAngle);
    },
    [selectedAngle, turnSelected]
  );
  // Floor cabinets joined at an angle in the plan — what the Edit tab's Angled Joints should count.
  const angledJoints = useMemo(() => countAngledJoints(cabinets, scalePixelsPerFoot), [cabinets, scalePixelsPerFoot]);
  // The island countertop as the plan has it — any shape, angled or not — its outline and area,
  // and the fillers that close the wedges between the boxes of its angled joints.
  const islandTop = useMemo(() => {
    const pieces = islandTopPieces(cabinets, scalePixelsPerFoot, islandSeatingIn);
    return {
      outline: polygonUnion(pieces),
      sf: islandTopAreaSf(pieces, scalePixelsPerFoot),
      fillers: islandJointFillers(cabinets, scalePixelsPerFoot).map((f) => f.wedge),
    };
  }, [cabinets, scalePixelsPerFoot, islandSeatingIn]);

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
      if ((e.key === 'Delete' || e.key === 'Backspace') && deletableIds.length > 0) {
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
  }, [active, view, undo, redo, deletableIds.length, deleteSelected, stopWallChain, deselect, turnSelected]);

  const handleSelect = useCallback(
    (elementType: 'wall' | 'cabinet' | 'appliance') => (id: string, ctrlKey?: boolean) => {
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
      const snapped = cabinet ? snapDroppedCabinet({ ...cabinet, x, y }, neighbors, walls, scalePixelsPerFoot) : null;
      updateCabinet(snapped ? { id, ...snapped } : { id, x, y });
    },
    [selectedIds, cabinets, neighbors, walls, scalePixelsPerFoot, batchMoveSelected, updateCabinet]
  );

  // A free-standing appliance dropped into the cabinet that holds it goes in it; else it lines up like a cabinet.
  const handleApplianceDragEnd = useCallback(
    (id: string, x: number, y: number) => {
      const appliance = appliances.find((a) => a.id === id);
      if (!appliance) return;
      const placed = placeDroppedAppliance({ ...appliance, x, y }, appliances, cabinets, walls, CABINET_PRESETS, scalePixelsPerFoot);
      updateAppliances([{ id, ...placed }]);
    },
    [appliances, cabinets, walls, scalePixelsPerFoot, updateAppliances]
  );

  const handleApplianceTransformEnd = useCallback(
    (id: string, x: number, y: number, rotation: number) => updateAppliances([{ id, x, y, rotation }]),
    [updateAppliances]
  );

  // Show a lone dragged cabinet lined up with the neighbour it will snap
  // to. Wall snapping waits for the drop: turning mid-drag would swing the
  // shape out from under the pointer.
  const handleCabinetDragSnap = useCallback(
    (id: string, x: number, y: number) => {
      if (selectedIds.size > 1 && selectedIds.has(id)) return null;
      const cabinet = cabinets.find((c) => c.id === id);
      return cabinet ? snapCabinetToNeighbors({ ...cabinet, x, y }, neighbors, scalePixelsPerFoot) : null;
    },
    [selectedIds, cabinets, neighbors, scalePixelsPerFoot]
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
    for (const c of [...cabinets, ...appliances]) {
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
  }, [walls, cabinets, appliances, scalePixelsPerFoot, stageWidth]);

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

  // A sink on each sink base, sized from the cabinet.
  const sinks = cabinets.flatMap((c) => {
    const specialty = CABINET_PRESETS[c.preset_code]?.specialty;
    if (c.cab_type === 'wall' || !specialty || !SINK_SPECIALTIES.includes(specialty)) return [];
    const { width, depth } = cabinetSizeIn(c, CABINET_PRESETS, scalePixelsPerFoot);
    return [{ cabinet: c, widthIn: width, depthIn: depth, apron: specialty === 'farmhouse_sink_base' }];
  });
  // Hung appliances draw over the uppers; the rest over the bases, under the uppers.
  const isHung = (a: CabinetSketchAppliance) => applianceSpec(a.type).mount === 'hung';
  const applianceShape = (a: CabinetSketchAppliance) => (
    <ApplianceShape
      key={a.id}
      appliance={a}
      isSelected={selectedIds.has(a.id)}
      zoom={viewport.zoom}
      onSelect={handleSelect('appliance')}
      onDragEnd={handleApplianceDragEnd}
      onTransformEnd={handleApplianceTransformEnd}
    />
  );

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

  // Cabinet pickers, in the Top and 3D toolbars.
  const cabinetPickers = (
    <>
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
                // Placing needs the plan, so the 3D view hands over to it.
                setView('plan');
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
    </>
  );

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
            { label: <Tooltip title="The kitchen in 3D — drag to look around">3D</Tooltip>, value: '3d' },
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

            {cabinetPickers}

            <Button icon={<UndoOutlined />} disabled={!canUndo} onClick={undo} />
            <Button icon={<RedoOutlined />} disabled={!canRedo} onClick={redo} />
            <Tooltip title="Also removes the cabinet from the Edit tab list">
              <Button icon={<DeleteOutlined />} danger disabled={deletableIds.length === 0} onClick={deleteSelected}>
                Delete
              </Button>
            </Tooltip>
            <Space.Compact>
              <Tooltip title="Turn 90° counter-clockwise (Shift+R). Several selected turn together.">
                <Button icon={<RotateLeftOutlined />} disabled={!hasSelectedCabinet} onClick={() => turnSelected(-90)} />
              </Tooltip>
              <Tooltip title="Turn 15° counter-clockwise">
                <Button disabled={!hasSelectedCabinet} onClick={() => turnSelected(-15)}>
                  −15°
                </Button>
              </Tooltip>
              <Tooltip title="Angle of the selected cabinets or appliances (0° = backed to the top of the screen). Type an angle such as 45 and press Enter to set one side of an angled island; several selected turn together. An appliance in a cabinet turns with the cabinet.">
                <InputNumber
                  style={{ width: 76 }}
                  min={-180}
                  max={180}
                  step={15}
                  precision={1}
                  disabled={selectedAngle === null}
                  placeholder="Angle"
                  formatter={(v) => (v === undefined || v === null ? '' : `${v}°`)}
                  parser={(v) => Number((v ?? '').replace('°', ''))}
                  value={angleDraft ?? selectedAngle ?? undefined}
                  onChange={(v) => setAngleDraft(typeof v === 'number' ? v : null)}
                  onStep={(v) => applyAngle(v)}
                  onPressEnter={() => applyAngle(angleDraft)}
                  onBlur={() => applyAngle(angleDraft)}
                />
              </Tooltip>
              <Tooltip title="Turn 15° clockwise">
                <Button disabled={!hasSelectedCabinet} onClick={() => turnSelected(15)}>
                  +15°
                </Button>
              </Tooltip>
              <Tooltip title="Turn 90° clockwise (R). Several selected turn together.">
                <Button icon={<RotateRightOutlined />} disabled={!hasSelectedCabinet} onClick={() => turnSelected(90)} />
              </Tooltip>
            </Space.Compact>
            {angledJoints > 0 && (
              <Tooltip title="Floor cabinets joined at an angle other than 90° in this plan. Each needs an angled filler and fitting, and an angled countertop cut — the Edit tab's Angled Joints bills them.">
                <Tag color="orange" style={{ marginInlineEnd: 0 }}>
                  Angled joints: {angledJoints}
                  {onApplyAngledJoints && (
                    <Button
                      type="link"
                      size="small"
                      style={{ paddingInline: 4, height: 'auto' }}
                      onClick={() => onApplyAngledJoints(angledJoints)}
                    >
                      Use in estimate
                    </Button>
                  )}
                </Tag>
              </Tooltip>
            )}
            {islandTop.sf > 0 && (
              <Tooltip
                title={`The island countertop as drawn (shaded under the island): ${TOP_EDGE_OVERHANG_IN}" past every front, end and back${
                  islandSeatingIn > 0 ? `, ${islandSeatingIn}" behind the backs for seating` : ''
                }, with the wedges of angled joints filled. Set the seating overhang in the Edit tab's Island Countertop.`}
              >
                <Tag color="gold" style={{ marginInlineEnd: 0 }}>
                  Island top: {islandTop.sf} SF
                  {onApplyIslandTopSf && (
                    <Button
                      type="link"
                      size="small"
                      style={{ paddingInline: 4, height: 'auto' }}
                      onClick={() => onApplyIslandTopSf(islandTop.sf)}
                    >
                      Use in estimate
                    </Button>
                  )}
                </Tag>
              </Tooltip>
            )}
            {appliances.length > 0 && (
              <Tooltip
                title={`The Edit tab's Appliance Detach & Reset list: ${appliances
                  .map((a) => applianceSpec(a.type).label)
                  .join(', ')}. One that goes in a cabinet (range base, oven or refrigerator cabinet, OTR microwave cabinet, sink base) sits in it and moves with it; drag the rest into place.`}
              >
                <Tag color={DR_TAG_COLOR} style={{ marginInlineEnd: 0 }}>
                  D&R appliances: {appliances.length}
                </Tag>
              </Tooltip>
            )}
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
        ) : view === '3d' ? (
          <>
            {cabinetPickers}
            <Segmented<'drawing' | 'realistic'>
              value={realistic ? 'realistic' : 'drawing'}
              onChange={(v) => setRealistic(v === 'realistic')}
              options={[
                { label: <Tooltip title="Outlined, in the Front view's colours">Drawing</Tooltip>, value: 'drawing' },
                { label: <Tooltip title="In the kitchen's finishes, with light and shadow">Realistic</Tooltip>, value: 'realistic' },
              ]}
            />
            {realistic && <KitchenFinishPicker finish={finish} onChange={setFinish} setBy={look.setBy} drawn={look.finish} />}
            {realistic && (
              <Tooltip title="A photo-like picture of the finished kitchen, drawn by AI from the view as framed now">
                <Button
                  icon={<CameraOutlined />}
                  disabled={cabinets.length === 0}
                  onClick={() => {
                    const render = view3dRef.current?.capture();
                    if (render) setAiPhotoRender(render);
                    else message.warning('The 3D view is not ready yet');
                  }}
                >
                  AI photo
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

              {/* The island top, under its cabinets, as one outlined piece: shows the overhang and closes the wedges of angled joints. */}
              {islandTop.outline.length > 0 && (
                <Shape
                  sceneFunc={(ctx, shape) => {
                    // Holes wind the other way, so the nonzero fill leaves them open.
                    ctx.beginPath();
                    for (const loop of islandTop.outline) {
                      loop.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
                      ctx.closePath();
                    }
                    ctx.fillStrokeShape(shape);
                  }}
                  fill="#E4DED3"
                  stroke="#A89F8F"
                  strokeWidth={1}
                  strokeScaleEnabled={false}
                  listening={false}
                />
              )}
              {/* The tapered filler in each angled island joint, so the boxes read as one run. */}
              {islandTop.fillers.map((wedge, i) => (
                <Line
                  key={`filler-${i}`}
                  points={wedge.flatMap((p) => [p.x, p.y])}
                  closed
                  fill="#D2B48C"
                  opacity={0.85}
                  stroke="#8B5E3C"
                  strokeWidth={1.5}
                  strokeScaleEnabled={false}
                  listening={false}
                />
              ))}

              {/* Floor-standing cabinets first, so uppers draw (and pick) on top of the bases they hang over —
                  with the sinks and the appliances on the floor or counter between them, and hung appliances last. */}
              {cabinets
                .filter((c) => c.cab_type !== 'wall')
                .map((cabinet) => (
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
                ))}
              {sinks.map((sink) => (
                <SinkShape key={`sink-${sink.cabinet.id}`} bowls={sinkBowls} {...sink} />
              ))}
              {appliances.filter((a) => !isHung(a)).map(applianceShape)}
              {cabinets
                .filter((c) => c.cab_type === 'wall')
                .map((cabinet) => (
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
                ))}
              {appliances.filter(isHung).map(applianceShape)}
            </Layer>
          </Stage>
        </div>
      ) : view === '3d' ? null : (
        <div style={{ border: '1px solid #d9d9d9', borderRadius: 4, overflow: 'hidden', background: '#ffffff' }}>
          <CabinetElevationView
            run={currentRun}
            presets={CABINET_PRESETS}
            height={CANVAS_HEIGHT}
            selectedIds={selectedIds}
            crownMolding={crownMolding}
          />
        </div>
      )}
      {/* Kept mounted once opened, only hidden after: the ray tracer's shader takes about a minute to build. */}
      {opened3d && (
        <div
          style={{
            display: view === '3d' ? 'block' : 'none',
            border: '1px solid #d9d9d9',
            borderRadius: 4,
            overflow: 'hidden',
            background: '#f7f7f5',
          }}
        >
          <React.Suspense
            fallback={
              <div style={{ height: CANVAS_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
                Loading 3D view…
              </div>
            }
          >
            <Cabinet3DView
              ref={view3dRef}
              cabinets={cabinets}
              walls={walls}
              appliances={appliances}
              sinkBowls={sinkBowls}
              presets={CABINET_PRESETS}
              scalePixelsPerFoot={scalePixelsPerFoot}
              height={CANVAS_HEIGHT}
              islandSeatingIn={islandSeatingIn}
              finish={realistic ? look.finish : null}
              surfaces={realistic ? look.surfaces : null}
              crownMolding={crownMolding}
              active={view === '3d'}
              selectedIds={selectedIds}
              onSelect={handleSelect('cabinet')}
              onDeselect={deselect}
            />
          </React.Suspense>
          <AiPhotoModal
            estimateId={estimateId}
            render={aiPhotoRender}
            finish={productWords(look.finish, products)}
            onClose={() => setAiPhotoRender(null)}
          />
        </div>
      )}

      <div style={{ marginTop: 8, color: '#999', fontSize: 13 }}>
        {cabinets.length === 0
          ? 'Cabinets you add in the Edit tab appear here. You can also draw the walls first, then pick a cabinet from the dropdown and click the canvas to place it.'
          : view === 'plan'
            ? 'Drag cabinets into place — dropped near a wall, a cabinet turns to back onto it; brought up beside another cabinet, it lines up and butts against it; an upper over a base lines up with its ends. For an angled island, select the cabinets of one side, set their angle (e.g. 45) in the angle box and bring their end up to the other side — they join at the inside corner. Dashed shapes are uppers; a blue double-line front marks glass doors. Detach & reset appliances (D&R) come from the Edit tab: one that goes in a cabinet sits in it, the rest start in a row below the drawing — drag them into place (onto a range base, oven cabinet or sink base to put them in it), and turn a selected one by its handle, the angle box or R; the dark edge is its front. Sizes and glass come from the Edit tab; a selected cabinet shows in its list above, where picking another changes it (Esc or a click on empty canvas to add new ones instead).'
            : view === '3d'
              ? 'The plan in 3D, at real sizes, with the detach & reset appliances in place. Drag to look around, scroll to zoom, right-drag to pan. Click a cabinet to select it and change it from its list above; move cabinets and appliances in Top. Realistic draws the kitchen in the finishes picked beside it (saved with the sketch, not priced; None under Hardware for fronts with no knobs or pulls); walls between you and the room are left out. Crown molding tops the uppers and talls when Crown Molding is ticked in the Edit tab. With Ray-traced light on, the picture sharpens toward a photo a few seconds after the view stops moving (it needs about a minute to get ready when the 3D view first opens).'
              : 'Each run is drawn from the front, as laid out in the plan. Uppers hang at 54" above the floor; shorter ones line up with their tops.'}
      </div>
    </div>
  );
};

export default CabinetSketchEditor;
