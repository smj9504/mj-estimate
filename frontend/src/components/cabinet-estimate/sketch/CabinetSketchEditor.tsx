/**
 * CabinetSketchEditor
 *
 * Layout drawing for a cabinet estimate, in two views of the same data:
 *
 * - Plan (top): draw walls (click-click, snapping to a wall's end or
 *   partway along it, Shift = axis lock) and arrange cabinets. Dropped near a wall, a cabinet turns to
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
import { Stage, Layer, Line, Rect, Shape, Transformer } from 'react-konva';
import Konva from 'konva';
import { Button, InputNumber, Popover, Segmented, Select, Space, Tag, Tooltip, message } from 'antd';
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
import CabinetWallRenderer, { CabinetWallPreview, CabinetWallSnapMark } from './CabinetWallRenderer';
import CabinetShapeRenderer, { ANCHOR_SIZE, ROTATE_ANCHOR_OFFSET, ROTATION_SNAP_ANGLES } from './CabinetShapeRenderer';
import CabinetEditPanel, { EDIT_PANEL_WIDTH } from './CabinetEditPanel';
import { changedBox, type BoxChange, type BoxFields } from '../cabinetBoxChoices';
import { pickInBox, turnGroup, withIslandGroup, type Box } from './sketchGroupEdit';
import { keepWallsJoined, moveWallEndJoined, moveWallsJoined, wallsMeetingEnd } from './sketchWallJoints';
import { BEHIND_REACH_FT, nearerWallPoint, snapBehindCabinets, wallLinesBehind } from './wallBehindCabinets';
import { ApplianceShape, DR_TAG_COLOR, SinkShape } from './CabinetApplianceRenderer';
import CabinetElevationView from './CabinetElevationView';
import KitchenFinishPicker from './KitchenFinishPicker';
import AiPhotoModal from './AiPhotoModal';
import { finishOf } from './kitchenFinish';
import { productWords } from './productLook';
import { useProductLook } from './useProductLook';
import type { ProductSnapshot } from '../../../types/productLibrary';
import type { Cabinet3DViewHandle } from './Cabinet3DView';
import { pixelsToFeet, generateOverlayId, snapToWall, constrainToAxis } from './cabinetSketchUtils';
import {
  boxKey,
  buildElevations,
  cabinetKey,
  cornerFootprint,
  footprintDepthIn,
  inToPx,
  reconcileCabinets,
  snapCabinetToNeighbors,
  snapDroppedCabinet,
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
import { TRIM_FIELDS, TRIM_FIELD_LABELS, takeoffTrim, type TrimCounts } from './cabinetTrimTakeoff';
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
  /**
   * The Edit tab's boxes (perimeter + island) — the cabinets the sketch shows.
   * A slide-in range's panel count is only read by the right-click panel.
   */
  boxes: (SketchBoxSource & { range_panel_count?: number | null })[];
  /** The Edit tab's Upper height: the Wall picker lists only that height. */
  wallHeight?: WallHeightFilter;
  /** False while another tab is showing, so canvas shortcuts (Delete!) stay off. */
  active?: boolean;
  /** A cabinet was placed from the sketch's dropdown — add it to the Edit tab. */
  onCabinetPlaced?: (code: string, cabType: CabType) => void;
  /** Cabinets were deleted on the canvas — take one of each key (see boxKey) off the Edit tab. */
  onCabinetsRemoved?: (keys: string[]) => void;
  /**
   * A cabinet was changed from its picker or its right-click panel (another
   * code, a custom size, glass, a door pattern) — make one box of `key` into
   * `box`, splitting it off its row when the row is for several.
   */
  onCabinetEdited?: (key: string, box: BoxFields) => void;
  /** "Use in estimate" on the plan's angled-joint count — set the Edit tab's Angled Joints to it. */
  onApplyAngledJoints?: (count: number) => void;
  /** The Edit tab's island seating overhang, inches (0 = edge overhang only), for the island top. */
  islandSeatingIn?: number;
  /** "Use in estimate" on the plan's island top — set the Edit tab's island countertop SF to it. */
  onApplyIslandTopSf?: (sf: number) => void;
  /** "Use in estimate" on the plan's trim count — set the Edit tab's Trim & Finished Panels to it. */
  onApplyTrim?: (counts: TrimCounts) => void;
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
  /** The Edit tab's door style is arched: every view draws the doors so. */
  archedDoors?: boolean;
}

const CabinetSketchEditor: React.FC<CabinetSketchEditorProps> = ({
  estimateId,
  boxes,
  wallHeight = 'all',
  active = true,
  onCabinetPlaced,
  onCabinetsRemoved,
  onCabinetEdited,
  onApplyAngledJoints,
  islandSeatingIn = 0,
  onApplyIslandTopSf,
  onApplyTrim,
  applianceList = NO_LIST,
  sinkBowls: scopeSinkBowls = 1,
  products = null,
  crownMolding = false,
  archedDoors = false,
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
    // Always opens on what's saved. Saving doesn't touch this cache, so a copy
    // kept from an earlier visit is the layout from back then — and the sync
    // and autosave below would write that back over the newer one.
    gcTime: 0,
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
    selectElements,
    deselect,
    selectedIds,
    addWall,
    removeWall,
    addCabinet,
    updateCabinet,
    removeCabinet,
    updateElements,
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
  // Arched doors are priced by the Edit tab's door style, so the drawing goes
  // by it over the picker; an option's cabinet product still says otherwise.
  const archedByStyle = archedDoors && !look.setBy.door_style;
  const drawnFinish = useMemo(
    () => (archedByStyle ? { ...look.finish, door_style: 'arched' } : look.finish),
    [archedByStyle, look.finish]
  );
  const drawnArched = drawnFinish.door_style === 'arched';
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

  // The lines a new wall runs along to stand behind the cabinets, its face on their backs.
  const wallBacks = useMemo(
    () =>
      cabinets.flatMap((c) =>
        wallLinesBehind(c, cornerFootprint(c, CABINET_PRESETS, scalePixelsPerFoot), DEFAULT_WALL_THICKNESS)
      ),
    [cabinets, scalePixelsPerFoot]
  );

  // Where the next wall point lands: on a wall end or anywhere along a wall
  // it comes near, so a new wall can join a wall partway along it; near a
  // cabinet's back (or on the cabinet), behind it, so the wall doesn't cover
  // the cabinet. Once a wall is started, Shift locks it level or plumb and it
  // runs on to the wall it meets.
  const wallDrawPoint = useCallback(
    (pos: { x: number; y: number }, start: { x: number; y: number } | null, shift: boolean) => {
      const locked = !!start && shift;
      const p = locked ? constrainToAxis(start!, pos) : pos;
      const opts = locked ? { along: start! } : {};
      const onWall = snapToWall(p, walls, WALL_SNAP_THRESHOLD, opts);
      const atWallEnd = walls.some(
        (w) =>
          (w.start_x === onWall.point.x && w.start_y === onWall.point.y) ||
          (w.end_x === onWall.point.x && w.end_y === onWall.point.y)
      );
      const behind = snapBehindCabinets(p, wallBacks, WALL_SNAP_THRESHOLD, {
        ...opts,
        reach: BEHIND_REACH_FT * scalePixelsPerFoot,
      });
      return nearerWallPoint(p, { ...onWall, end: onWall.snapped && atWallEnd }, behind);
    },
    [walls, wallBacks, scalePixelsPerFoot]
  );

  // ------------------------------------------------------------------
  // Drag-box selection and panning. Dragging empty canvas draws a box that
  // selects what it touches (Ctrl/Shift adds to the selection); the view
  // pans with Space held, or with the middle mouse button.
  // ------------------------------------------------------------------
  const [marquee, setMarquee] = useState<(Box & { add: boolean }) | null>(null);
  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;
  // A drag-box just ended: the click Konva fires on release must not deselect.
  const swallowClickRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const panRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // A fresh press: whatever click a finished drag-box left behind is spent.
      swallowClickRef.current = false;
      if (e.evt.button === 1) {
        e.evt.preventDefault();
        panRef.current = { x: e.evt.clientX, y: e.evt.clientY, vx: viewport.x, vy: viewport.y };
        return;
      }
      if (e.evt.button !== 0 || spaceHeld || state.activeTool !== 'select') return;
      if (e.target !== e.target.getStage()) return;
      const p = getCanvasPos();
      setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey });
    },
    [viewport.x, viewport.y, spaceHeld, state.activeTool, getCanvasPos]
  );

  const finishMarquee = useCallback(() => {
    const box = marqueeRef.current;
    if (!box) return;
    setMarquee(null);
    // Too small to be a box: it was a click, which deselects as before.
    if (Math.max(Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0)) * viewport.zoom < 4) return;
    swallowClickRef.current = true;
    const picked = pickInBox(box, cabinets, appliances, walls);
    selectElements(
      [
        ...picked.cabinets.map((id) => ({ element_id: id, element_type: 'cabinet' as const })),
        ...picked.appliances.map((id) => ({ element_id: id, element_type: 'appliance' as const })),
        ...picked.walls.map((id) => ({ element_id: id, element_type: 'wall' as const })),
      ],
      box.add
    );
  }, [viewport.zoom, cabinets, appliances, walls, selectElements]);

  // Released anywhere — even off the canvas — ends a box or a pan.
  useEffect(() => {
    const up = () => {
      panRef.current = null;
      if (marqueeRef.current) finishMarquee();
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [finishMarquee]);

  const handleStageMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const pan = panRef.current;
      if (pan) {
        setViewport((v) => ({ ...v, x: pan.vx + e.evt.clientX - pan.x, y: pan.vy + e.evt.clientY - pan.y }));
        return;
      }
      if (marqueeRef.current) {
        const p = getCanvasPos();
        setMarquee((m) => (m ? { ...m, x1: p.x, y1: p.y } : m));
        return;
      }
      if (state.activeTool !== 'wall') return;
      const wds = wallDrawStartRef.current;
      const snap = wallDrawPoint(getCanvasPos(), wds, e.evt.shiftKey);
      // Before the first click, the mark shows where the wall will start.
      if (wds) setWallDrawCursor(snap.point);
      setWallSnapEnd(snap.snapped ? snap.point : null);
    },
    [state.activeTool, wallDrawPoint, getCanvasPos]
  );

  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (swallowClickRef.current) {
        swallowClickRef.current = false;
        return;
      }
      // The right button opens a cabinet's panel; the middle one pans.
      if (e.evt.button !== undefined && e.evt.button !== 0) return;
      // Clicking empty canvas deselects, unless a tool is actively placing something.
      const clickedOnEmpty = e.target === e.target.getStage();
      const pos = getCanvasPos();

      if (state.activeTool === 'wall') {
        const wds = wallDrawStartRef.current;
        const snapped = wallDrawPoint(pos, wds, e.evt.shiftKey);
        if (!wds) {
          setWallDrawStart(snapped.point);
          setWallDrawCursor(snapped.point);
        } else {
          const endPoint = snapped.point;

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
      wallDrawPoint,
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
      const pickedWalls = walls.filter((w) => selectedIds.has(w.id));
      if (picked.length + pickedApps.length === 0 || degrees === 0) return;
      const turned = turnGroup([...picked, ...pickedApps], pickedWalls, degrees);
      const isApp = new Set(pickedApps.map((a) => a.id));
      const turnedWalls = new Map(turned.walls.map((w) => [w.id, w]));
      const after = walls.map((w) => turnedWalls.get(w.id) ?? w);
      const joined = keepWallsJoined(walls, after, new Set(turnedWalls.keys()), scalePixelsPerFoot);
      updateElements({
        cabinets: turned.placed.filter((t) => !isApp.has(t.id)),
        appliances: turned.placed.filter((t) => isApp.has(t.id)),
        walls: joined.filter((w, i) => w !== walls[i]),
      });
    },
    [cabinets, appliances, walls, selectedIds, scalePixelsPerFoot, updateElements]
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
  // The fillers and finished panels the plan calls for — what the Edit tab's Trim & Finished Panels should hold.
  const trim = useMemo(
    () => takeoffTrim(cabinets, appliances, walls, CABINET_PRESETS, scalePixelsPerFoot),
    [cabinets, appliances, walls, scalePixelsPerFoot]
  );
  const trimTotal = TRIM_FIELDS.reduce((sum, f) => sum + trim.counts[f], 0);
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

  // The right-click panel: the cabinet it edits, and where it opened in the plan's frame.
  const [editPanel, setEditPanel] = useState<{ id: string; left: number; top: number } | null>(null);
  const closeEditPanel = useCallback(() => setEditPanel(null), []);

  // Cancel an in-progress wall chain, and undo/redo/delete shortcuts —
  // only while this tab is the one on screen.
  useEffect(() => {
    if (!active || view !== 'plan') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      // Space held pans the view by dragging (and keeps the page from scrolling).
      if (e.key === ' ') {
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }
      if (e.key === 'Escape') {
        // Deselecting turns the pickers back to adding cabinets.
        if (editPanel) closeEditPanel();
        else if (wallDrawStartRef.current) stopWallChain();
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
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceHeld(false);
    };
    const release = () => setSpaceHeld(false);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', release);
    };
  }, [active, view, undo, redo, deletableIds.length, deleteSelected, stopWallChain, deselect, turnSelected, editPanel, closeEditPanel]);

  // Picking a cabinet of the island picks the whole island, which moves and
  // turns as one piece; `single` (double-click or Alt+click) picks just the one.
  const handleSelect = useCallback(
    (elementType: 'wall' | 'cabinet' | 'appliance') => (id: string, ctrlKey?: boolean, single?: boolean) => {
      const ids = elementType === 'cabinet' && !single ? withIslandGroup([id], cabinets) : [id];
      const as = (eid: string) => ({ element_id: eid, element_type: elementType });
      if (ids.length === 1) {
        if (ctrlKey) toggleSelectElement(as(id));
        else selectElement(as(id));
        return;
      }
      if (!ctrlKey) {
        selectElements(ids.map(as));
        return;
      }
      // Ctrl on a group already in the selection takes the group out, else adds it.
      if (ids.every((eid) => selectedIds.has(eid))) {
        selectElements(state.selections.filter((s) => !ids.includes(s.element_id)));
      } else {
        selectElements(ids.map(as), true);
      }
    },
    [cabinets, selectedIds, state.selections, selectElement, selectElements, toggleSelectElement]
  );

  // ------------------------------------------------------------------
  // Moving several at once. Dragging one of a selection — or any cabinet
  // of the island — carries the rest along live; on the drop they all
  // move by the same amount, and the walls joined to moved walls follow.
  // ------------------------------------------------------------------
  const dragGroupRef = useRef<{ leadId: string; ids: string[]; start: Map<string, { x: number; y: number }> } | null>(null);
  const movable = useCallback(
    (id: string) =>
      cabinets.some((c) => c.id === id) || walls.some((w) => w.id === id) || appliances.some((a) => a.id === id && !a.host_id),
    [cabinets, walls, appliances]
  );
  const sketchNodes = useCallback((ids: string[]) => {
    const stage = stageRef.current;
    const want = new Set(ids);
    return stage ? stage.find('.sketch-item').filter((n) => want.has(n.id())) : [];
  }, []);

  const handleStageDragStart = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      dragGroupRef.current = null;
      const node = e.target;
      const id = node.id();
      if (node === node.getStage() || !id) return;
      let ids: string[] = [];
      if (selectedIds.has(id) && selectedIds.size > 1) {
        ids = Array.from(selectedIds).filter(movable);
      } else if (!selectedIds.has(id)) {
        const island = withIslandGroup([id], cabinets);
        if (island.length > 1) {
          ids = island;
          selectElements(island.map((eid) => ({ element_id: eid, element_type: 'cabinet' as const })));
        }
      }
      if (ids.length < 2) return;
      setEditPanel(null);
      const start = new Map(sketchNodes(ids).map((n) => [n.id(), { x: n.x(), y: n.y() }]));
      dragGroupRef.current = { leadId: id, ids, start };
    },
    [selectedIds, movable, cabinets, selectElements, sketchNodes]
  );

  const handleStageDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const group = dragGroupRef.current;
      if (!group || e.target.id() !== group.leadId) return;
      const lead = group.start.get(group.leadId);
      if (!lead) return;
      const dx = e.target.x() - lead.x;
      const dy = e.target.y() - lead.y;
      for (const n of sketchNodes(group.ids)) {
        if (n.id() === group.leadId) continue;
        const s = group.start.get(n.id());
        if (s) n.position({ x: s.x + dx, y: s.y + dy });
      }
    },
    [sketchNodes]
  );

  /** Ends a group drag led by `id`, moved by (dx, dy); false when `id` wasn't leading one. */
  const finishGroupDrag = useCallback(
    (id: string, dx: number, dy: number): boolean => {
      const group = dragGroupRef.current;
      if (!group || group.leadId !== id) return false;
      dragGroupRef.current = null;
      const ids = new Set(group.ids);
      // Walls are drawn at their points; the shift Konva gave their nodes comes off.
      for (const n of sketchNodes(group.ids)) {
        if (walls.some((w) => w.id === n.id())) n.position({ x: 0, y: 0 });
      }
      const moved = moveWallsJoined(walls, new Set(walls.filter((w) => ids.has(w.id)).map((w) => w.id)), dx, dy, scalePixelsPerFoot);
      updateElements({
        cabinets: cabinets.filter((c) => ids.has(c.id)).map((c) => ({ id: c.id, x: c.x + dx, y: c.y + dy })),
        appliances: appliances
          .filter((a) => ids.has(a.id) && !a.host_id)
          .map((a) => ({ id: a.id, x: a.x + dx, y: a.y + dy })),
        walls: moved.filter((w, i) => w !== walls[i]),
      });
      return true;
    },
    [walls, cabinets, appliances, scalePixelsPerFoot, sketchNodes, updateElements]
  );

  const handleCabinetDragEnd = useCallback(
    (id: string, x: number, y: number) => {
      const cabinet = cabinets.find((c) => c.id === id);
      if (cabinet && finishGroupDrag(id, x - cabinet.x, y - cabinet.y)) return;
      const snapped = cabinet ? snapDroppedCabinet({ ...cabinet, x, y }, neighbors, walls, scalePixelsPerFoot) : null;
      updateCabinet(snapped ? { id, ...snapped } : { id, x, y });
    },
    [cabinets, neighbors, walls, scalePixelsPerFoot, finishGroupDrag, updateCabinet]
  );

  // A free-standing appliance dropped into the cabinet that holds it goes in it; else it lines up like a cabinet.
  const handleApplianceDragEnd = useCallback(
    (id: string, x: number, y: number) => {
      const appliance = appliances.find((a) => a.id === id);
      if (!appliance) return;
      if (finishGroupDrag(id, x - appliance.x, y - appliance.y)) return;
      const placed = placeDroppedAppliance({ ...appliance, x, y }, appliances, cabinets, walls, CABINET_PRESETS, scalePixelsPerFoot);
      updateAppliances([{ id, ...placed }]);
    },
    [appliances, cabinets, walls, scalePixelsPerFoot, finishGroupDrag, updateAppliances]
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
      if (dragGroupRef.current?.ids.includes(id)) return null;
      const cabinet = cabinets.find((c) => c.id === id);
      return cabinet ? snapCabinetToNeighbors({ ...cabinet, x, y }, neighbors, scalePixelsPerFoot) : null;
    },
    [cabinets, neighbors, scalePixelsPerFoot]
  );

  const handleCabinetTransformEnd = useCallback(
    (id: string, x: number, y: number, rotation: number) => {
      updateCabinet({ id, x, y, rotation });
    },
    [updateCabinet]
  );

  const handleWallEndpointDrag = useCallback(
    (wallId: string, endpoint: 'start' | 'end', x: number, y: number) => {
      // Dropped on another wall's end or anywhere along it, the end joins it there.
      // Walls already meeting this end move with it, so it can't snap back onto them.
      const meeting = new Set(wallsMeetingEnd(walls, wallId, endpoint));
      const others = walls.filter((w) => !meeting.has(w.id));
      const pt = snapToWall({ x, y }, others, WALL_SNAP_THRESHOLD, { excludeId: wallId }).point;
      const next = moveWallEndJoined(walls, wallId, endpoint, pt, scalePixelsPerFoot);
      updateElements({ walls: next.filter((w, i) => w !== walls[i]) });
    },
    [walls, scalePixelsPerFoot, updateElements]
  );

  // A wall dragged on its own takes the walls joined to it along; one of a selection moves the selection.
  const handleWallDragEnd = useCallback(
    (wallId: string, dx: number, dy: number) => {
      if (finishGroupDrag(wallId, dx, dy)) return;
      const next = moveWallsJoined(walls, new Set([wallId]), dx, dy, scalePixelsPerFoot);
      updateElements({ walls: next.filter((w, i) => w !== walls[i]) });
    },
    [walls, scalePixelsPerFoot, finishGroupDrag, updateElements]
  );

  // ------------------------------------------------------------------
  // Turning several at once by one handle round them all.
  // ------------------------------------------------------------------
  const groupTrRef = useRef<Konva.Transformer>(null);
  const groupIds = useMemo(() => Array.from(selectedIds).filter(movable), [selectedIds, movable]);
  const multi = groupIds.length > 1;
  useEffect(() => {
    const tr = groupTrRef.current;
    if (!tr) return;
    tr.nodes(multi && view === 'plan' ? sketchNodes(groupIds) : []);
    tr.getLayer()?.batchDraw();
  }, [multi, groupIds, view, sketchNodes, cabinets, walls, appliances]);

  const handleGroupTransform = useCallback((e: Konva.KonvaEventObject<Event>) => {
    const tr = groupTrRef.current;
    if (!tr) return;
    const shift = !!(e.evt as MouseEvent)?.shiftKey;
    if (shift !== tr.rotationSnaps().length > 0) tr.rotationSnaps(shift ? ROTATION_SNAP_ANGLES : []);
  }, []);

  const handleGroupTransformEnd = useCallback(() => {
    const tr = groupTrRef.current;
    if (!tr) return;
    tr.rotationSnaps([]);
    const tidy = (deg: number) => Math.round(((((deg % 360) + 360) % 360) * 100)) / 100;
    const cabPatches: { id: string; x: number; y: number; rotation: number }[] = [];
    const appPatches: { id: string; x: number; y: number; rotation: number }[] = [];
    const turnedWalls = new Map<string, CabinetSketchWall>();
    for (const n of tr.nodes()) {
      const id = n.id();
      const wall = walls.find((w) => w.id === id);
      if (wall) {
        // A wall node carries its points; fold the turn into them and set the node back.
        const t = n.getTransform();
        const s = t.point({ x: wall.start_x, y: wall.start_y });
        const e = t.point({ x: wall.end_x, y: wall.end_y });
        turnedWalls.set(id, { ...wall, start_x: s.x, start_y: s.y, end_x: e.x, end_y: e.y });
        n.position({ x: 0, y: 0 });
        n.rotation(0);
        continue;
      }
      const pose = { id, x: n.x(), y: n.y(), rotation: tidy(n.rotation()) };
      if (cabinets.some((c) => c.id === id)) cabPatches.push(pose);
      else appPatches.push(pose);
    }
    const after = walls.map((w) => turnedWalls.get(w.id) ?? w);
    const joined = keepWallsJoined(walls, after, new Set(turnedWalls.keys()), scalePixelsPerFoot);
    updateElements({ cabinets: cabPatches, appliances: appPatches, walls: joined.filter((w, i) => w !== walls[i]) });
  }, [walls, cabinets, scalePixelsPerFoot, updateElements]);

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
      handles={!multi}
      onSelect={handleSelect('appliance')}
      onDragEnd={handleApplianceDragEnd}
      onTransformEnd={handleApplianceTransformEnd}
    />
  );
  // Walls draw under the cabinets, except a selected one: it comes up over
  // them and the other walls, so its end handles can be grabbed where a
  // cabinet or a joined wall would cover them (a corner, a run's end).
  const wallShape = (wall: CabinetSketchWall) => (
    <CabinetWallRenderer
      key={wall.id}
      wall={wall}
      isSelected={selectedIds.has(wall.id)}
      onSelect={handleSelect('wall')}
      onDragEndpoint={handleWallEndpointDrag}
      onWallDragEnd={handleWallDragEnd}
      zoom={viewport.zoom}
    />
  );

  // The Edit tab's row a cabinet belongs to.
  const rowOf = (cabinet: CabinetSketchCabinet) =>
    boxes.find((b) => boxKey(b) === cabinetKey(cabinet, CABINET_PRESETS, scalePixelsPerFoot));

  // The Edit-tab box a cabinet stands for, as the sketch knows it — and the
  // range panels, which only its row has.
  const boxOf = (cabinet: CabinetSketchCabinet): BoxFields => {
    const preset = CABINET_PRESETS[cabinet.preset_code];
    const { width, height } = cabinetSizeIn(cabinet, CABINET_PRESETS, scalePixelsPerFoot);
    return {
      code: cabinet.preset_code,
      cab_type: cabinet.cab_type,
      width_inches: width,
      height_inches: height,
      is_specialty: !!preset?.specialty,
      specialty_type: preset?.specialty ?? null,
      has_glass_door: !!cabinet.has_glass_door,
      door_pattern: cabinet.door_pattern ?? null,
      range_panel_count: rowOf(cabinet)?.range_panel_count ?? null,
    };
  };

  // Change a cabinet — another code, a custom size, glass, a door pattern,
  // a slide-in range's panels — from its picker or its right-click panel. It
  // keeps its place (back-left corner, rotation, corner side) and takes the new size.
  const editCabinet = (cabinet: CabinetSketchCabinet, change: BoxChange) => {
    const before = boxOf(cabinet);
    const box = changedBox(before, change, CABINET_PRESETS);
    if (
      box.code === before.code &&
      box.width_inches === before.width_inches &&
      box.height_inches === before.height_inches &&
      box.has_glass_door === before.has_glass_door &&
      box.door_pattern === before.door_pattern &&
      box.range_panel_count === before.range_panel_count
    ) {
      return;
    }
    const depthIn = footprintDepthIn(box.cab_type, box.specialty_type, box.width_inches);
    const key = cabinetKey(cabinet, CABINET_PRESETS, scalePixelsPerFoot);
    // Same event as the parent's box change, so the sync sees both together
    // and the shape stays matched to its (changed) box. Glass and pattern are
    // left off a plain cabinet, as the sync leaves them.
    updateCabinet({
      id: cabinet.id,
      preset_code: box.code,
      cab_type: box.cab_type,
      label: box.code === 'CUSTOM' ? `${Math.round(box.width_inches * 100) / 100}"` : box.code,
      width_in: box.width_inches,
      depth_in: depthIn,
      height_in: box.height_inches,
      width: inToPx(box.width_inches, scalePixelsPerFoot),
      height: inToPx(depthIn, scalePixelsPerFoot),
      has_glass_door: box.has_glass_door ? true : undefined,
      door_pattern: box.door_pattern || undefined,
    });
    onCabinetEdited?.(key, box);
  };
  const changeCabinet = (cabinet: CabinetSketchCabinet, code: string) => editCabinet(cabinet, { code });

  // Right-click on a cabinet: pick just it and open its panel there, kept inside the plan.
  const handleCabinetContextMenu = useCallback(
    (id: string, clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      selectElement({ element_id: id, element_type: 'cabinet' });
      setEditPanel({
        id,
        left: Math.max(8, Math.min(clientX - r.left + 8, r.width - EDIT_PANEL_WIDTH - 8)),
        top: Math.max(8, Math.min(clientY - r.top + 8, CANVAS_HEIGHT - 230)),
      });
    },
    [selectElement]
  );
  const editedCabinet = editPanel ? cabinets.find((c) => c.id === editPanel.id) : undefined;
  // The panel goes with its cabinet: deleted, undone or the view changed, it closes.
  useEffect(() => {
    if (editPanel && (!editedCabinet || view !== 'plan')) setEditPanel(null);
  }, [editPanel, editedCabinet, view]);

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
            {cabinets.length > 0 && (
              <Popover
                title="Trim & Finished Panels in this plan"
                content={
                  <div style={{ maxWidth: 440, fontSize: 12 }}>
                    {walls.length === 0 && (
                      <div style={{ color: '#d46b08', marginBottom: 6 }}>
                        No walls drawn yet — every run end reads as open. Draw the walls first.
                      </div>
                    )}
                    {TRIM_FIELDS.map((f) => (
                      <div key={f} style={{ marginBottom: 4 }}>
                        <strong>
                          {TRIM_FIELD_LABELS[f]}: {trim.counts[f]}
                        </strong>
                        {trim.items
                          .filter((item) => item.field === f)
                          .map((item, k) => (
                            <div key={k} style={{ paddingLeft: 10, color: '#595959' }}>
                              {item.where} — {item.why}
                            </div>
                          ))}
                      </div>
                    ))}
                    <div style={{ marginTop: 6, color: '#8c8c8c' }}>
                      Counted from where each cabinet end stands: a wall within 12&quot; beside it (filler, never a
                      panel), at the doors of the run that turns the corner (filler), beside a cabinet or across an
                      appliance-wide gap in the run (nothing), or open (end panel). A tall beside a base shows above the counter. A Fridge Deep Upper marks the
                      refrigerator opening. A dishwasher counts only once the Appliance Detach &amp; Reset list puts it
                      on the plan. Island ends are priced by the island&apos;s End Panel SF, angled joints by Angled
                      Joints.
                    </div>
                  </div>
                }
              >
                <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>
                  Trim &amp; panels: {trimTotal}
                  {onApplyTrim && walls.length > 0 && (
                    <Button
                      type="link"
                      size="small"
                      style={{ paddingInline: 4, height: 'auto' }}
                      onClick={() => onApplyTrim(trim.counts)}
                    >
                      Use in estimate
                    </Button>
                  )}
                </Tag>
              </Popover>
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
              <Tooltip title="Swap which end of the corner cabinet sits in the corner (for an angle end: which end is full depth; for a three-door corner: which end its doors wrap)">
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
            {realistic && (
              <KitchenFinishPicker
                finish={finish}
                onChange={setFinish}
                setBy={archedByStyle ? { ...look.setBy, door_style: 'Arched raised panel (Edit tab)' } : look.setBy}
                drawn={drawnFinish}
              />
            )}
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
          style={{ position: 'relative', border: '1px solid #d9d9d9', borderRadius: 4, overflow: 'hidden', background: '#fafafa' }}
        >
          <Stage
            ref={stageRef}
            width={stageWidth}
            height={CANVAS_HEIGHT}
            onClick={handleStageClick}
            onTap={handleStageClick}
            onMouseDown={(e) => {
              // A click anywhere on the plan closes the right-click panel.
              if (e.evt.button !== 2) setEditPanel(null);
              handleStageMouseDown(e);
            }}
            onMouseMove={handleStageMouseMove}
            onContextMenu={(e) => e.evt.preventDefault()}
            onWheel={handleWheel}
            scaleX={viewport.zoom}
            scaleY={viewport.zoom}
            x={viewport.x}
            y={viewport.y}
            // Dragging empty canvas draws a selection box; Space + drag pans.
            draggable={state.activeTool === 'select' && spaceHeld}
            onDragStart={handleStageDragStart}
            onDragMove={handleStageDragMove}
            onDragEnd={handleStageDragEnd}
            style={{
              cursor:
                state.activeTool === 'wall' || state.activeTool === 'place_cabinet'
                  ? 'crosshair'
                  : spaceHeld
                    ? 'grab'
                    : 'default',
            }}
          >
            {showGrid && (
              <CabinetGridLayer
                width={stageWidth}
                height={CANVAS_HEIGHT}
                scalePixelsPerFoot={scalePixelsPerFoot}
                viewport={viewport}
              />
            )}

            {/* While drawing walls, a click on a wall or a cabinet places the next wall point there
                instead of picking it — that is how a new wall joins one already drawn. */}
            <Layer listening={state.activeTool !== 'wall'}>
              {walls.filter((wall) => !selectedIds.has(wall.id)).map(wallShape)}

              {wallDrawStart && wallDrawCursor && (
                <CabinetWallPreview
                  startX={wallDrawStart.x}
                  startY={wallDrawStart.y}
                  endX={wallDrawCursor.x}
                  endY={wallDrawCursor.y}
                  snappedEnd={wallSnapEnd}
                />
              )}
              {state.activeTool === 'wall' && !wallDrawStart && wallSnapEnd && (
                <CabinetWallSnapMark x={wallSnapEnd.x} y={wallSnapEnd.y} />
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
                    onContextMenu={handleCabinetContextMenu}
                    handles={!multi}
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
                    onContextMenu={handleCabinetContextMenu}
                    handles={!multi}
                    zoom={viewport.zoom}
                    corner={cornerShapes.get(cabinet.id)}
                  />
                ))}
              {appliances.filter(isHung).map(applianceShape)}
              {walls.filter((wall) => selectedIds.has(wall.id)).map(wallShape)}
              {/* Several selected turn together by one handle round them all. */}
              <Transformer
                ref={groupTrRef}
                rotateEnabled
                resizeEnabled={false}
                rotateAnchorOffset={ROTATE_ANCHOR_OFFSET}
                anchorSize={ANCHOR_SIZE}
                borderStroke="#1890ff"
                borderDash={[3, 3]}
                anchorStroke="#1890ff"
                onTransform={handleGroupTransform}
                onTransformEnd={handleGroupTransformEnd}
              />
              {marquee && (
                <Rect
                  x={Math.min(marquee.x0, marquee.x1)}
                  y={Math.min(marquee.y0, marquee.y1)}
                  width={Math.abs(marquee.x1 - marquee.x0)}
                  height={Math.abs(marquee.y1 - marquee.y0)}
                  fill="rgba(24, 144, 255, 0.08)"
                  stroke="#1890ff"
                  strokeWidth={1}
                  dash={[4, 3]}
                  strokeScaleEnabled={false}
                  listening={false}
                />
              )}
            </Layer>
          </Stage>
          {editPanel && editedCabinet && (
            <CabinetEditPanel
              box={boxOf(editedCabinet)}
              label={`${editedCabinet.label || editedCabinet.preset_code}${
                CABINET_PRESETS[editedCabinet.preset_code] ? ` — ${CABINET_PRESETS[editedCabinet.preset_code].label}` : ''
              }`}
              catalog={CABINET_PRESETS}
              cabinetOptions={presetOptions[sectionOf(editedCabinet)]}
              rowQty={rowOf(editedCabinet)?.qty ?? 1}
              onChange={(change) => editCabinet(editedCabinet, change)}
              onClose={closeEditPanel}
              style={{ left: editPanel.left, top: editPanel.top }}
            />
          )}
        </div>
      ) : view === '3d' ? null : (
        <div style={{ border: '1px solid #d9d9d9', borderRadius: 4, overflow: 'hidden', background: '#ffffff' }}>
          <CabinetElevationView
            run={currentRun}
            presets={CABINET_PRESETS}
            height={CANVAS_HEIGHT}
            selectedIds={selectedIds}
            crownMolding={crownMolding}
            archedDoors={drawnArched}
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
              finish={realistic ? drawnFinish : null}
              surfaces={realistic ? look.surfaces : null}
              crownMolding={crownMolding}
              archedDoors={drawnArched}
              active={view === '3d'}
              selectedIds={selectedIds}
              onSelect={handleSelect('cabinet')}
              onDeselect={deselect}
            />
          </React.Suspense>
          <AiPhotoModal
            estimateId={estimateId}
            render={aiPhotoRender}
            finish={productWords(drawnFinish, products)}
            onClose={() => setAiPhotoRender(null)}
          />
        </div>
      )}

      <div style={{ marginTop: 8, color: '#999', fontSize: 13 }}>
        {cabinets.length === 0
          ? 'Cabinets you add in the Edit tab appear here. You can also draw the walls first, then pick a cabinet from the dropdown and click the canvas to place it.'
          : view === 'plan'
            ? 'Drag cabinets into place — dropped near a wall, a cabinet turns to back onto it; brought up beside another cabinet, it lines up and butts against it; an upper over a base lines up with its ends. Drag across empty canvas to select everything the box touches, or Ctrl+click to add one; several selected move together and turn together by the handle round them, R or the angle box. The island moves as one piece: a click on any of its cabinets picks it all, a double-click or Alt+click just that cabinet, and Ctrl+Alt+click adds one more. Space + drag or the middle mouse button pans. Right-click a cabinet to change it there — cabinet, specialty, width, height, door and glass, a slide-in range\'s end panels — which changes its row on the Edit tab. Walls that meet stay joined: moving a wall or a wall end brings the walls joined to it along, keeping their angle (they turn only in 15° steps when they have to). A wall drawn against cabinets goes behind them, its face on their backs. For an angled island, pick the cabinets of one side that way, set their angle (e.g. 45) in the angle box and bring their end up to the other side — they join at the inside corner. Dashed shapes are uppers; a blue double-line front marks glass doors, a dotted rust one a pattern in the doors. Detach & reset appliances (D&R) come from the Edit tab: one that goes in a cabinet sits in it, the rest start in a row below the drawing — drag them into place (onto a range base, oven cabinet or sink base to put them in it); the dark edge is its front.'
            : view === '3d'
              ? 'The plan in 3D, at real sizes, with the detach & reset appliances in place. Drag to look around, scroll to zoom, right-drag to pan. Click a cabinet to select it and change it from its list above; move cabinets and appliances in Top. Realistic draws the kitchen in the finishes picked beside it (saved with the sketch, not priced; None under Hardware for fronts with no knobs or pulls); walls between you and the room are left out. Crown molding tops the uppers and talls when Crown Molding is ticked in the Edit tab. With Ray-traced light on, the picture sharpens toward a photo a few seconds after the view stops moving (it needs about a minute to get ready when the 3D view first opens).'
              : 'Each run is drawn from the front, as laid out in the plan. Uppers hang at 54" above the floor; shorter ones line up with their tops.'}
      </div>
    </div>
  );
};

export default CabinetSketchEditor;
