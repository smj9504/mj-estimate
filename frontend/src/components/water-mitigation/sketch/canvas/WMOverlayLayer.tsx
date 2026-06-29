/**
 * WMOverlayLayer
 * Orchestrates all WM canvas overlay renderers within a single Konva <Layer>.
 * Renders elements in z-order: floor protection → containment → demolition →
 * equipment → legend (always on top).
 * Also renders a rubber-band preview rect while the user is drawing.
 *
 * Usage:
 *   <Stage width={canvasWidth} height={canvasHeight}>
 *     <Layer>
 *       <WMBackgroundImageLayer imageUrl={...} canvasWidth={...} canvasHeight={...} />
 *     </Layer>
 *     <WMOverlayLayer
 *       overlayData={overlayData}
 *       scalePixelsPerFoot={20}
 *       selectedId={selectedId}
 *       activeTool="demolition"
 *       materialTypes={DEFAULT_DEMO_MATERIAL_TYPES}
 *       isDrawing={false}
 *       drawStart={null}
 *       drawCurrent={null}
 *       activeMaterialColor="#B8860B"
 *       onSelectElement={(id, type) => setSelected({ elementId: id, elementType: type })}
 *       onDragEnd={(id, type, x, y) => updatePosition(id, type, x, y)}
 *       canvasWidth={1200}
 *       canvasHeight={900}
 *     />
 *   </Stage>
 */

import React, { useCallback, useMemo } from 'react';
import { Layer, Line, Rect, Group, Text as TextNode } from 'react-konva';
import {
  WMOverlayData,
  WMSketchTool,
  DemoMaterialType,
  DemoRenderMode,
  WMDemolitionZone,
  WMTextAnnotation,
  WMShapeAnnotation,
  WMWall,
  WMContentManipulation,
} from '../../../../types/wmSketch';
import { DEFAULT_DEMO_MATERIAL_TYPES, getEffectiveRenderMode } from '../../../../types/wmSketch';
import WMDemolitionRenderer from './WMDemolitionRenderer';
import WMGroupOverlay from './WMGroupOverlay';
import WMDemolitionPolygonRenderer from './WMDemolitionPolygonRenderer';
import WMEquipmentRenderer from './WMEquipmentRenderer';
import WMContainmentRenderer from './WMContainmentRenderer';
import WMFloorProtectionRenderer from './WMFloorProtectionRenderer';
import WMContentProtectionRenderer from './WMContentProtectionRenderer';
import WMContentManipulationRenderer from './WMContentManipulationRenderer';
import WMWallLineRenderer from './WMWallLineRenderer';
import WMTextRenderer from './WMTextRenderer';
import WMShapeRenderer from './WMShapeRenderer';
import { WMWallRenderer, WMRoomRenderer, WMWallPreview } from './WMFloorPlanRenderer';

export interface WMOverlayLayerProps {
  overlayData: WMOverlayData;
  scalePixelsPerFoot: number;
  /** Set of currently selected element IDs (supports multi-select) */
  selectedIds: Set<string>;
  activeTool: WMSketchTool;
  materialTypes: DemoMaterialType[];

  // Drawing state
  isDrawing: boolean;
  drawStart: { x: number; y: number } | null;
  drawCurrent: { x: number; y: number } | null;
  activeMaterialColor: string;

  // Callbacks
  onSelectElement: (id: string, type: string, ctrlKey?: boolean) => void;
  onDragEnd: (id: string, type: string, x: number, y: number) => void;
  onTransformEnd?: (id: string, type: string, widthFt: number, heightFt: number, rotation?: number) => void;
  onUpdateTextAnnotation?: (id: string, patch: Partial<WMTextAnnotation>) => void;
  onPolygonPointsChanged?: (id: string, points: { x: number; y: number }[]) => void;
  onMoveGroup?: (groupId: string, dx: number, dy: number) => void;
  onRotateGroup?: (groupId: string, pivotX: number, pivotY: number, deltaDeg: number) => void;
  onWallDragEndpoint?: (wallId: string, endpoint: 'start' | 'end', x: number, y: number) => void;
  onWallDragEnd?: (wallId: string, dx: number, dy: number) => void;
  onRoomDragEnd?: (roomId: string, dx: number, dy: number) => void;
  onRoomVertexDrag?: (roomId: string, vertexIndex: number, x: number, y: number) => void;
  /** Hide all overlay elements except walls and rooms (floor plan edit mode) */
  hideOverlays?: boolean;

  // Polygon drawing preview (click-to-place vertices)
  polygonPreviewPoints?: { x: number; y: number }[];
  polygonPreviewCursor?: { x: number; y: number } | null;

  // Wall drawing preview
  wallPreview?: { startX: number; startY: number; endX: number; endY: number; snappedEnd?: { x: number; y: number } | null } | null;

  // Canvas dimensions (kept for potential future use)
  canvasWidth: number;
  canvasHeight: number;
}


/**
 * Resolve the effective render mode for a demolition zone.
 * Priority: zone.render_mode > material type render_mode > inferred from unit/surface.
 */
function getZoneRenderMode(zone: WMDemolitionZone, materialTypes: DemoMaterialType[]): DemoRenderMode {
  if (zone.render_mode) return zone.render_mode;
  const mat =
    materialTypes.find((m) => m.id === zone.material_type) ??
    DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === zone.material_type);
  if (mat) return getEffectiveRenderMode(mat);
  return 'area';
}

/**
 * Returns true if a demolition zone has polygon points and should be rendered
 * as an irregular polygon via WMDemolitionPolygonRenderer.
 */
function isPolygonZone(zone: WMDemolitionZone): boolean {
  return (zone.polygon_points?.length ?? 0) >= 3;
}

/**
 * Returns true if a demolition zone should be rendered as a rectangle
 * (area or shape render modes) via WMDemolitionRenderer.
 */
function isRectZone(zone: WMDemolitionZone, materialTypes: DemoMaterialType[]): boolean {
  if (isPolygonZone(zone)) return false;
  const mode = getZoneRenderMode(zone, materialTypes);
  return mode === 'area' || mode === 'shape';
}

/**
 * Returns true if a demolition zone should be rendered as a line
 * via WMWallLineRenderer.
 */
function isLineZone(zone: WMDemolitionZone, materialTypes: DemoMaterialType[]): boolean {
  const mode = getZoneRenderMode(zone, materialTypes);
  return mode === 'line';
}

/**
 * Returns true if a demolition zone should be rendered as a text label.
 */
function isTextZone(zone: WMDemolitionZone, materialTypes: DemoMaterialType[]): boolean {
  const mode = getZoneRenderMode(zone, materialTypes);
  return mode === 'text';
}

const WMOverlayLayer: React.FC<WMOverlayLayerProps> = ({
  overlayData,
  scalePixelsPerFoot,
  selectedIds,
  activeTool,
  materialTypes,
  isDrawing,
  drawStart,
  drawCurrent,
  activeMaterialColor,
  onSelectElement,
  onDragEnd,
  onTransformEnd,
  onUpdateTextAnnotation,
  onPolygonPointsChanged,
  onMoveGroup,
  onRotateGroup,
  onWallDragEndpoint,
  onWallDragEnd,
  onRoomDragEnd,
  onRoomVertexDrag,
  hideOverlays,
  polygonPreviewPoints,
  polygonPreviewCursor,
  wallPreview,
  canvasWidth: _canvasWidth,
  canvasHeight: _canvasHeight,
}) => {
  // Helper: check if an element is in the selection set
  const isSelected = (id: string) => selectedIds.has(id);
  // ---------------------------------------------------------------------------
  // Callback factories (stable references via useCallback)
  // ---------------------------------------------------------------------------

  const makeSelectHandler = useCallback(
    (type: string) => (id: string) => onSelectElement(id, type),
    [onSelectElement],
  );

  const makeDragEndHandler = useCallback(
    (type: string) => (id: string, x: number, y: number) => onDragEnd(id, type, x, y),
    [onDragEnd],
  );

  const makeTransformEndHandler = useCallback(
    (type: string) => (id: string, widthFt: number, heightFt: number, rotation?: number) =>
      onTransformEnd?.(id, type, widthFt, heightFt, rotation),
    [onTransformEnd],
  );

  // Stable per-type handlers (ctrlKey forwarded for multi-select)
  const selectDemoHandler = useCallback((id: string, ctrlKey?: boolean) => onSelectElement(id, 'demolition', ctrlKey), [onSelectElement]);
  const dragDemoHandler = useCallback((id: string, x: number, y: number) => onDragEnd(id, 'demolition', x, y), [onDragEnd]);
  const transformDemoHandler = useCallback((id: string, w: number, h: number, rotation?: number) => onTransformEnd?.(id, 'demolition', w, h, rotation), [onTransformEnd]);

  const selectEquipHandler = useCallback((id: string, ctrlKey?: boolean) => onSelectElement(id, 'equipment', ctrlKey), [onSelectElement]);
  const dragEquipHandler = useCallback((id: string, x: number, y: number) => onDragEnd(id, 'equipment', x, y), [onDragEnd]);

  const selectContainHandler = useCallback((id: string, ctrlKey?: boolean) => onSelectElement(id, 'containment', ctrlKey), [onSelectElement]);
  const dragContainHandler = useCallback((id: string, x: number, y: number) => onDragEnd(id, 'containment', x, y), [onDragEnd]);
  const transformContainHandler = useCallback((id: string, lengthFt: number, rotation: number) => onTransformEnd?.(id, 'containment', lengthFt, rotation), [onTransformEnd]);

  const selectProtectHandler = useCallback((id: string, ctrlKey?: boolean) => onSelectElement(id, 'floor_protection', ctrlKey), [onSelectElement]);
  const dragProtectHandler = useCallback((id: string, x: number, y: number) => onDragEnd(id, 'floor_protection', x, y), [onDragEnd]);
  const transformProtectHandler = useCallback((id: string, w: number, h: number, rotation?: number) => onTransformEnd?.(id, 'floor_protection', w, h, rotation), [onTransformEnd]);

  const selectContentProtHandler = useCallback((id: string, ctrlKey?: boolean) => onSelectElement(id, 'content_protection', ctrlKey), [onSelectElement]);
  const dragContentProtHandler = useCallback((id: string, x: number, y: number) => onDragEnd(id, 'content_protection', x, y), [onDragEnd]);
  const transformContentProtHandler = useCallback((id: string, w: number, h: number, rotation?: number) => onTransformEnd?.(id, 'content_protection', w, h, rotation), [onTransformEnd]);

  const selectContentManipHandler = useCallback((id: string, ctrlKey?: boolean) => onSelectElement(id, 'content_manipulation', ctrlKey), [onSelectElement]);
  const dragContentManipHandler = useCallback((id: string, x: number, y: number) => onDragEnd(id, 'content_manipulation', x, y), [onDragEnd]);
  const transformContentManipHandler = useCallback((id: string, w: number, h: number, rotation?: number) => onTransformEnd?.(id, 'content_manipulation', w, h, rotation), [onTransformEnd]);

  const selectTextHandler = useCallback((id: string, ctrlKey?: boolean) => onSelectElement(id, 'text', ctrlKey), [onSelectElement]);
  const dragTextHandler = useCallback((id: string, x: number, y: number) => onDragEnd(id, 'text', x, y), [onDragEnd]);
  const updateTextHandler = useCallback((id: string, patch: Partial<WMTextAnnotation>) => onUpdateTextAnnotation?.(id, patch), [onUpdateTextAnnotation]);

  const selectShapeHandler = useCallback((id: string, ctrlKey?: boolean) => onSelectElement(id, 'shape', ctrlKey), [onSelectElement]);
  const dragShapeHandler = useCallback((id: string, x: number, y: number) => onDragEnd(id, 'shape', x, y), [onDragEnd]);
  const transformShapeHandler = useCallback((id: string, w: number, h: number, rotation?: number) => onTransformEnd?.(id, 'shape', w, h, rotation), [onTransformEnd]);

  const polygonPointsHandler = useCallback(
    (id: string, points: { x: number; y: number }[]) => onPolygonPointsChanged?.(id, points),
    [onPolygonPointsChanged],
  );

  // ---------------------------------------------------------------------------
  // Compute zone numbers: 1-based index within each material_type group
  // ---------------------------------------------------------------------------
  const zoneNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    const groupCounters = new Map<string, number>();
    for (const zone of overlayData.demolition_zones) {
      const counter = (groupCounters.get(zone.material_type) ?? 0) + 1;
      groupCounters.set(zone.material_type, counter);
      map.set(zone.id, counter);
    }
    return map;
  }, [overlayData.demolition_zones]);

  // ---------------------------------------------------------------------------
  // Rubber-band preview rect dimensions
  // ---------------------------------------------------------------------------
  let rubberX = 0;
  let rubberY = 0;
  let rubberW = 0;
  let rubberH = 0;

  if (isDrawing && drawStart && drawCurrent) {
    rubberX = Math.min(drawStart.x, drawCurrent.x);
    rubberY = Math.min(drawStart.y, drawCurrent.y);
    rubberW = Math.abs(drawCurrent.x - drawStart.x);
    rubberH = Math.abs(drawCurrent.y - drawStart.y);
  }

  // ---------------------------------------------------------------------------
  // When the user is in a drawing tool, overlay elements should not capture
  // mouse events — otherwise draggable Groups and Transformers intercept
  // mouseDown/mouseMove/mouseUp, blocking consecutive drawing.
  // ---------------------------------------------------------------------------
  const isDrawingTool =
    activeTool === 'demolition' ||
    activeTool === 'demolition_line' ||
    activeTool === 'demolition_polygon' ||
    activeTool === 'containment' ||
    activeTool === 'floor_protection' ||
    activeTool === 'content_protection' ||
    activeTool === 'content_manipulation' ||
    activeTool === 'equipment' ||
    activeTool === 'text' ||
    activeTool === 'shape' ||
    activeTool === 'wall' ||
    activeTool === 'room' ||
    activeTool === 'wall_split';

  // Wall/room handlers
  const selectWallHandler = useCallback((id: string, ctrlKey?: boolean) => onSelectElement(id, 'wall', ctrlKey), [onSelectElement]);
  const wallDragEndpointHandler = useCallback(
    (wallId: string, endpoint: 'start' | 'end', x: number, y: number) => onWallDragEndpoint?.(wallId, endpoint, x, y),
    [onWallDragEndpoint]
  );
  const wallDragHandler = useCallback(
    (wallId: string, dx: number, dy: number) => onWallDragEnd?.(wallId, dx, dy),
    [onWallDragEnd]
  );
  const selectRoomHandler = useCallback((id: string, ctrlKey?: boolean) => onSelectElement(id, 'room', ctrlKey), [onSelectElement]);
  const roomDragHandler = useCallback(
    (roomId: string, dx: number, dy: number) => onRoomDragEnd?.(roomId, dx, dy),
    [onRoomDragEnd]
  );
  const roomVertexDragHandler = useCallback(
    (roomId: string, vertexIndex: number, x: number, y: number) =>
      onRoomVertexDrag?.(roomId, vertexIndex, x, y),
    [onRoomVertexDrag]
  );

  // ---------------------------------------------------------------------------
  // Build unified element list sorted by element_order (z-order)
  // ---------------------------------------------------------------------------
  type OverlayItem =
    | { kind: 'floor_protection'; id: string }
    | { kind: 'content_protection'; id: string }
    | { kind: 'content_manipulation'; id: string }
    | { kind: 'containment'; id: string }
    | { kind: 'demo_rect'; id: string }
    | { kind: 'demo_polygon'; id: string }
    | { kind: 'demo_line'; id: string }
    | { kind: 'demo_text'; id: string }
    | { kind: 'equipment'; id: string }
    | { kind: 'shape'; id: string }
    | { kind: 'text'; id: string };

  const sortedItems = useMemo<OverlayItem[]>(() => {
    // Build flat list of all overlay items with their kind
    const items: OverlayItem[] = [];
    for (const fp of overlayData.floor_protections) items.push({ kind: 'floor_protection', id: fp.id });
    for (const cp of overlayData.content_protections ?? []) items.push({ kind: 'content_protection', id: cp.id });
    for (const cm of overlayData.content_manipulations ?? []) items.push({ kind: 'content_manipulation', id: cm.id });
    for (const c of overlayData.containment_zones) items.push({ kind: 'containment', id: c.id });
    for (const z of overlayData.demolition_zones) {
      if (isPolygonZone(z)) items.push({ kind: 'demo_polygon', id: z.id });
      else if (isRectZone(z, materialTypes)) items.push({ kind: 'demo_rect', id: z.id });
      else if (isLineZone(z, materialTypes)) items.push({ kind: 'demo_line', id: z.id });
      else if (isTextZone(z, materialTypes)) items.push({ kind: 'demo_text', id: z.id });
    }
    for (const eq of overlayData.equipment_placements) items.push({ kind: 'equipment', id: eq.id });
    for (const s of overlayData.shapes ?? []) items.push({ kind: 'shape', id: s.id });
    for (const t of overlayData.text_annotations ?? []) items.push({ kind: 'text', id: t.id });

    const order = overlayData.element_order;
    if (!order || order.length === 0) return items; // default type-based order

    // Sort by position in element_order; items not in order go to end
    const orderMap = new Map(order.map((id, idx) => [id, idx]));
    items.sort((a, b) => {
      const ai = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const bi = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
    return items;
  }, [overlayData, materialTypes]);

  // Lookup maps for fast element access
  const demoMap = useMemo(() => new Map(overlayData.demolition_zones.map((z) => [z.id, z])), [overlayData.demolition_zones]);
  const equipMap = useMemo(() => new Map(overlayData.equipment_placements.map((e) => [e.id, e])), [overlayData.equipment_placements]);
  const containMap = useMemo(() => new Map(overlayData.containment_zones.map((c) => [c.id, c])), [overlayData.containment_zones]);
  const fpMap = useMemo(() => new Map(overlayData.floor_protections.map((f) => [f.id, f])), [overlayData.floor_protections]);
  const cpMap = useMemo(() => new Map((overlayData.content_protections ?? []).map((c) => [c.id, c])), [overlayData.content_protections]);
  const cmManipMap = useMemo(() => new Map((overlayData.content_manipulations ?? []).map((c) => [c.id, c])), [overlayData.content_manipulations]);
  const shapeMap = useMemo(() => new Map((overlayData.shapes ?? []).map((s) => [s.id, s])), [overlayData.shapes]);
  const textMap = useMemo(() => new Map((overlayData.text_annotations ?? []).map((t) => [t.id, t])), [overlayData.text_annotations]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <Layer listening={!isDrawingTool}>
      {/* 0a. Rooms (very bottom — floor fill) */}
      {(overlayData.rooms ?? []).map((room) => (
        <WMRoomRenderer
          key={room.id}
          room={room}
          isSelected={isSelected(room.id)}
          onSelect={selectRoomHandler}
          onRoomDragEnd={roomDragHandler}
          onRoomVertexDrag={roomVertexDragHandler}
        />
      ))}

      {/* 0b. Walls (above rooms, below overlays) */}
      {(overlayData.walls ?? []).map((wall) => (
        <WMWallRenderer
          key={wall.id}
          wall={wall}
          isSelected={isSelected(wall.id)}
          onSelect={selectWallHandler}
          onDragEndpoint={wallDragEndpointHandler}
          onWallDragEnd={wallDragHandler}
        />
      ))}

      {/* Overlay elements — rendered in element_order (z-order) */}
      {!hideOverlays && sortedItems.map((item) => {
        switch (item.kind) {
          case 'floor_protection': {
            const fp = fpMap.get(item.id);
            return fp ? (
              <WMFloorProtectionRenderer key={fp.id} protection={fp} isSelected={isSelected(fp.id)} scalePixelsPerFoot={scalePixelsPerFoot} onSelect={selectProtectHandler} onDragEnd={dragProtectHandler} onTransformEnd={transformProtectHandler} />
            ) : null;
          }
          case 'content_protection': {
            const cp = cpMap.get(item.id);
            return cp ? (
              <WMContentProtectionRenderer key={cp.id} protection={cp} isSelected={isSelected(cp.id)} scalePixelsPerFoot={scalePixelsPerFoot} onSelect={selectContentProtHandler} onDragEnd={dragContentProtHandler} onTransformEnd={transformContentProtHandler} />
            ) : null;
          }
          case 'content_manipulation': {
            const cm = cmManipMap.get(item.id);
            return cm ? (
              <WMContentManipulationRenderer key={cm.id} manipulation={cm} isSelected={isSelected(cm.id)} scalePixelsPerFoot={scalePixelsPerFoot} onSelect={selectContentManipHandler} onDragEnd={dragContentManipHandler} onTransformEnd={transformContentManipHandler} />
            ) : null;
          }
          case 'containment': {
            const zone = containMap.get(item.id);
            return zone ? (
              <WMContainmentRenderer key={zone.id} zone={zone} isSelected={isSelected(zone.id)} scalePixelsPerFoot={scalePixelsPerFoot} onSelect={selectContainHandler} onDragEnd={dragContainHandler} onTransformEnd={transformContainHandler} />
            ) : null;
          }
          case 'demo_polygon': {
            const zone = demoMap.get(item.id);
            return zone ? (
              <WMDemolitionPolygonRenderer key={zone.id} zone={zone} isSelected={isSelected(zone.id)} scalePixelsPerFoot={scalePixelsPerFoot} zoneNumber={zoneNumberMap.get(zone.id)} onSelect={selectDemoHandler} onDragEnd={dragDemoHandler} onPolygonPointsChanged={polygonPointsHandler} />
            ) : null;
          }
          case 'demo_rect': {
            const zone = demoMap.get(item.id);
            return zone ? (
              <WMDemolitionRenderer key={zone.id} zone={zone} isSelected={isSelected(zone.id)} scalePixelsPerFoot={scalePixelsPerFoot} zoneNumber={zoneNumberMap.get(zone.id)} onSelect={selectDemoHandler} onDragEnd={dragDemoHandler} onTransformEnd={transformDemoHandler} />
            ) : null;
          }
          case 'demo_line': {
            const zone = demoMap.get(item.id);
            return zone ? (
              <WMWallLineRenderer key={zone.id} zone={zone} isSelected={isSelected(zone.id)} scalePixelsPerFoot={scalePixelsPerFoot} materialTypes={materialTypes} zoneNumber={zoneNumberMap.get(zone.id)} onSelect={selectDemoHandler} onDragEnd={dragDemoHandler} onTransformEnd={transformDemoHandler} />
            ) : null;
          }
          case 'demo_text': {
            const zone = demoMap.get(item.id);
            if (!zone) return null;
            const mat = materialTypes.find((m) => m.id === zone.material_type) ?? DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === zone.material_type);
            const label = zone.label || mat?.name || zone.material_type;
            const qty = zone.calculated_sqft > 0 ? ` (${mat?.unit === 'EA' ? Math.round(zone.calculated_sqft) : zone.calculated_sqft.toFixed(1)} ${mat?.unit || 'SF'})` : '';
            return (
              <React.Fragment key={zone.id}>
                <Group x={zone.x} y={zone.y} draggable onClick={(e) => selectDemoHandler(zone.id, e.evt.ctrlKey || e.evt.metaKey)} onTap={() => selectDemoHandler(zone.id)} onDragEnd={(e) => dragDemoHandler(zone.id, e.target.x(), e.target.y())}>
                  <Rect x={-4} y={-2} width={Math.max(80, (label.length + qty.length) * 7 + 16)} height={22} fill={zone.color} fillEnabled opacity={zone.fill_opacity ?? 0.18} cornerRadius={4} stroke={isSelected(zone.id) ? '#1890ff' : zone.color} strokeWidth={isSelected(zone.id) ? 2 : 1} dash={isSelected(zone.id) ? [4, 2] : undefined} />
                  <TextNode x={0} y={2} text={`${label}${qty}`} fontSize={13} fontFamily="'Inter', 'Segoe UI', sans-serif" fontStyle="bold" fill={zone.color} />
                </Group>
              </React.Fragment>
            );
          }
          case 'equipment': {
            const p = equipMap.get(item.id);
            return p ? (
              <WMEquipmentRenderer key={p.id} placement={p} isSelected={isSelected(p.id)} onSelect={selectEquipHandler} onDragEnd={dragEquipHandler} />
            ) : null;
          }
          case 'shape': {
            const s = shapeMap.get(item.id);
            return s ? (
              <WMShapeRenderer key={s.id} shape={s} isSelected={isSelected(s.id)} onSelect={selectShapeHandler} onDragEnd={dragShapeHandler} onTransformEnd={transformShapeHandler} />
            ) : null;
          }
          case 'text': {
            const a = textMap.get(item.id);
            return a ? (
              <WMTextRenderer key={a.id} annotation={a} isSelected={isSelected(a.id)} onSelect={selectTextHandler} onDragEnd={dragTextHandler} onUpdate={updateTextHandler} />
            ) : null;
          }
          default:
            return null;
        }
      })}

      {/* 8. Rubber-band drawing preview */}
      {isDrawing && drawStart && drawCurrent && activeTool === 'containment' && (
        // Containment: line preview from start to current
        <Line
          points={[drawStart.x, drawStart.y, drawCurrent.x, drawCurrent.y]}
          stroke={activeMaterialColor}
          strokeWidth={4}
          dash={[10, 5]}
          lineCap="round"
          opacity={0.7}
          listening={false}
        />
      )}
      {isDrawing && drawStart && drawCurrent && activeTool === 'demolition_line' && (
        <Line
          points={[drawStart.x, drawStart.y, drawCurrent.x, drawCurrent.y]}
          stroke={activeMaterialColor}
          strokeWidth={4}
          dash={[8, 4]}
          lineCap="round"
          opacity={0.7}
          listening={false}
        />
      )}
      {isDrawing && drawStart && drawCurrent && activeTool !== 'containment' && activeTool !== 'demolition_line' && rubberW > 2 && rubberH > 2 && (
        // Other tools: rectangle preview
        <Rect
          x={rubberX}
          y={rubberY}
          width={rubberW}
          height={rubberH}
          fill={activeMaterialColor}
          opacity={0.25}
          stroke={activeMaterialColor}
          strokeWidth={2}
          dash={[6, 3]}
          listening={false}
        />
      )}

      {/* 7b. Group overlay (bounding box + rotation handle) */}
      {(() => {
        // Find group_id from selected zones
        const selectedDemoIds = Array.from(selectedIds);
        const selectedDemoZones = selectedDemoIds
          .map((id) => demoMap.get(id))
          .filter((z): z is WMDemolitionZone => z != null && !!z.group_id);
        if (selectedDemoZones.length === 0) return null;
        // Get the first group_id from selection
        const activeGroupId = selectedDemoZones[0].group_id!;
        const groupZones = overlayData.demolition_zones.filter((z) => z.group_id === activeGroupId);
        if (groupZones.length < 2) return null;
        return (
          <WMGroupOverlay
            groupId={activeGroupId}
            zones={groupZones}
            scalePixelsPerFoot={scalePixelsPerFoot}
            onMoveGroup={onMoveGroup ?? (() => {})}
            onRotateGroup={onRotateGroup ?? (() => {})}
          />
        );
      })()}

      {/* 8a. Polygon drawing preview */}
      {polygonPreviewPoints && polygonPreviewPoints.length > 0 && (() => {
        const previewFlat: number[] = [];
        for (const p of polygonPreviewPoints) {
          previewFlat.push(p.x, p.y);
        }
        if (polygonPreviewCursor) {
          previewFlat.push(polygonPreviewCursor.x, polygonPreviewCursor.y);
        }
        return (
          <>
            <Line
              points={previewFlat}
              stroke={activeMaterialColor}
              strokeWidth={2}
              dash={[6, 3]}
              opacity={0.7}
              listening={false}
              closed={false}
            />
            {/* Close line from cursor to first point */}
            {polygonPreviewCursor && polygonPreviewPoints.length >= 2 && (
              <Line
                points={[polygonPreviewCursor.x, polygonPreviewCursor.y, polygonPreviewPoints[0].x, polygonPreviewPoints[0].y]}
                stroke={activeMaterialColor}
                strokeWidth={1}
                dash={[4, 4]}
                opacity={0.4}
                listening={false}
              />
            )}
            {/* Placed vertices */}
            {polygonPreviewPoints.map((p, i) => (
              <React.Fragment key={`ppv-${i}`}>
                <Line
                  points={[p.x - 4, p.y - 4, p.x + 4, p.y + 4]}
                  stroke={activeMaterialColor}
                  strokeWidth={2}
                  listening={false}
                />
                <Line
                  points={[p.x + 4, p.y - 4, p.x - 4, p.y + 4]}
                  stroke={activeMaterialColor}
                  strokeWidth={2}
                  listening={false}
                />
              </React.Fragment>
            ))}
            {/* First vertex highlight (close target) */}
            {polygonPreviewPoints.length >= 3 && (
              <Line
                points={(() => {
                  const p = polygonPreviewPoints[0];
                  const r = 8;
                  const sides = 12;
                  const pts: number[] = [];
                  for (let i = 0; i <= sides; i++) {
                    const a = (2 * Math.PI * i) / sides;
                    pts.push(p.x + r * Math.cos(a), p.y + r * Math.sin(a));
                  }
                  return pts;
                })()}
                stroke={activeMaterialColor}
                strokeWidth={1.5}
                dash={[3, 3]}
                opacity={0.6}
                listening={false}
              />
            )}
          </>
        );
      })()}

      {/* 8b. Wall drawing preview */}
      {wallPreview && (
        <WMWallPreview
          startX={wallPreview.startX}
          startY={wallPreview.startY}
          endX={wallPreview.endX}
          endY={wallPreview.endY}
          snappedEnd={wallPreview.snappedEnd}
        />
      )}

    </Layer>
  );
};

export default React.memo(WMOverlayLayer);
