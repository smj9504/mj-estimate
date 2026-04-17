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
} from '../../../../types/wmSketch';
import { DEFAULT_DEMO_MATERIAL_TYPES, getEffectiveRenderMode } from '../../../../types/wmSketch';
import WMDemolitionRenderer from './WMDemolitionRenderer';
import WMEquipmentRenderer from './WMEquipmentRenderer';
import WMContainmentRenderer from './WMContainmentRenderer';
import WMFloorProtectionRenderer from './WMFloorProtectionRenderer';
import WMContentProtectionRenderer from './WMContentProtectionRenderer';
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
  onWallDragEndpoint?: (wallId: string, endpoint: 'start' | 'end', x: number, y: number) => void;

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
 * Returns true if a demolition zone should be rendered as a rectangle
 * (area or shape render modes) via WMDemolitionRenderer.
 */
function isRectZone(zone: WMDemolitionZone, materialTypes: DemoMaterialType[]): boolean {
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
  onWallDragEndpoint,
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

  const selectTextHandler = useCallback((id: string, ctrlKey?: boolean) => onSelectElement(id, 'text', ctrlKey), [onSelectElement]);
  const dragTextHandler = useCallback((id: string, x: number, y: number) => onDragEnd(id, 'text', x, y), [onDragEnd]);
  const updateTextHandler = useCallback((id: string, patch: Partial<WMTextAnnotation>) => onUpdateTextAnnotation?.(id, patch), [onUpdateTextAnnotation]);

  const selectShapeHandler = useCallback((id: string, ctrlKey?: boolean) => onSelectElement(id, 'shape', ctrlKey), [onSelectElement]);
  const dragShapeHandler = useCallback((id: string, x: number, y: number) => onDragEnd(id, 'shape', x, y), [onDragEnd]);
  const transformShapeHandler = useCallback((id: string, w: number, h: number, rotation?: number) => onTransformEnd?.(id, 'shape', w, h, rotation), [onTransformEnd]);

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
    activeTool === 'containment' ||
    activeTool === 'floor_protection' ||
    activeTool === 'content_protection' ||
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
  const selectRoomHandler = useCallback((id: string, ctrlKey?: boolean) => onSelectElement(id, 'room', ctrlKey), [onSelectElement]);

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
        />
      ))}

      {/* 1. Floor protections (bottom-most overlay) */}
      {overlayData.floor_protections.map((fp) => (
        <WMFloorProtectionRenderer
          key={fp.id}
          protection={fp}
          isSelected={isSelected(fp.id)}
          scalePixelsPerFoot={scalePixelsPerFoot}
          onSelect={selectProtectHandler}
          onDragEnd={dragProtectHandler}
          onTransformEnd={transformProtectHandler}
        />
      ))}

      {/* 2. Content protection areas */}
      {(overlayData.content_protections ?? []).map((cp) => (
        <WMContentProtectionRenderer
          key={cp.id}
          protection={cp}
          isSelected={isSelected(cp.id)}
          scalePixelsPerFoot={scalePixelsPerFoot}
          onSelect={selectContentProtHandler}
          onDragEnd={dragContentProtHandler}
          onTransformEnd={transformContentProtHandler}
        />
      ))}

      {/* 3. Containment barriers (lines) */}
      {overlayData.containment_zones.map((zone) => (
        <WMContainmentRenderer
          key={zone.id}
          zone={zone}
          isSelected={isSelected(zone.id)}
          scalePixelsPerFoot={scalePixelsPerFoot}
          onSelect={selectContainHandler}
          onDragEnd={dragContainHandler}
          onTransformEnd={transformContainHandler}
        />
      ))}

      {/* 4a. Demolition zones — rectangle types (floor/ceiling) */}
      {overlayData.demolition_zones
        .filter((zone) => isRectZone(zone, materialTypes))
        .map((zone) => (
          <WMDemolitionRenderer
            key={zone.id}
            zone={zone}
            isSelected={isSelected(zone.id)}
            scalePixelsPerFoot={scalePixelsPerFoot}
            zoneNumber={zoneNumberMap.get(zone.id)}
            onSelect={selectDemoHandler}
            onDragEnd={dragDemoHandler}
            onTransformEnd={transformDemoHandler}
          />
        ))}

      {/* 4b. Demolition zones — wall / baseboard line types */}
      {overlayData.demolition_zones
        .filter((zone) => isLineZone(zone, materialTypes))
        .map((zone) => (
          <WMWallLineRenderer
            key={zone.id}
            zone={zone}
            isSelected={isSelected(zone.id)}
            scalePixelsPerFoot={scalePixelsPerFoot}
            materialTypes={materialTypes}
            zoneNumber={zoneNumberMap.get(zone.id)}
            onSelect={selectDemoHandler}
            onDragEnd={dragDemoHandler}
            onTransformEnd={transformDemoHandler}
          />
        ))}

      {/* 4c. Demolition zones — text label mode */}
      {overlayData.demolition_zones
        .filter((zone) => isTextZone(zone, materialTypes))
        .map((zone) => {
          const mat =
            materialTypes.find((m) => m.id === zone.material_type) ??
            DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === zone.material_type);
          const label = zone.label || mat?.name || zone.material_type;
          const qty = zone.calculated_sqft > 0
            ? ` (${mat?.unit === 'EA' ? Math.round(zone.calculated_sqft) : zone.calculated_sqft.toFixed(1)} ${mat?.unit || 'SF'})`
            : '';
          return (
            <React.Fragment key={zone.id}>
              <Group
                x={zone.x}
                y={zone.y}
                draggable
                onClick={(e) => selectDemoHandler(zone.id, e.evt.ctrlKey || e.evt.metaKey)}
                onTap={() => selectDemoHandler(zone.id)}
                onDragEnd={(e) => dragDemoHandler(zone.id, e.target.x(), e.target.y())}
              >
                {/* Background pill */}
                <Rect
                  x={-4}
                  y={-2}
                  width={Math.max(80, (label.length + qty.length) * 7 + 16)}
                  height={22}
                  fill={zone.color}
                  fillEnabled
                  opacity={zone.fill_opacity ?? 0.18}
                  cornerRadius={4}
                  stroke={isSelected(zone.id) ? '#1890ff' : zone.color}
                  strokeWidth={isSelected(zone.id) ? 2 : 1}
                  dash={isSelected(zone.id) ? [4, 2] : undefined}
                />
                {/* Label text */}
                <TextNode
                  x={0}
                  y={2}
                  text={`${label}${qty}`}
                  fontSize={13}
                  fontFamily="'Inter', 'Segoe UI', sans-serif"
                  fontStyle="bold"
                  fill={zone.color}
                />
              </Group>
            </React.Fragment>
          );
        })}

      {/* 5. Equipment placements (on top of zone fills) */}
      {overlayData.equipment_placements.map((placement) => (
        <WMEquipmentRenderer
          key={placement.id}
          placement={placement}
          isSelected={isSelected(placement.id)}
          onSelect={selectEquipHandler}
          onDragEnd={dragEquipHandler}
        />
      ))}

      {/* 6. Shape annotations (doors, cabinets, fixtures) */}
      {(overlayData.shapes ?? []).map((shape) => (
        <WMShapeRenderer
          key={shape.id}
          shape={shape}
          isSelected={isSelected(shape.id)}
          onSelect={selectShapeHandler}
          onDragEnd={dragShapeHandler}
          onTransformEnd={transformShapeHandler}
        />
      ))}

      {/* 7. Text annotations (on top of everything else) */}
      {(overlayData.text_annotations ?? []).map((annotation) => (
        <WMTextRenderer
          key={annotation.id}
          annotation={annotation}
          isSelected={isSelected(annotation.id)}
          onSelect={selectTextHandler}
          onDragEnd={dragTextHandler}
          onUpdate={updateTextHandler}
        />
      ))}

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

      {/* 8. Wall drawing preview */}
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
