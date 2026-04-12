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

import React, { useCallback } from 'react';
import { Layer, Line, Rect } from 'react-konva';
import {
  WMOverlayData,
  WMSketchTool,
  DemoMaterialType,
  WMDemolitionZone,
} from '../../../../types/wmSketch';
import { DEFAULT_DEMO_MATERIAL_TYPES } from '../../../../types/wmSketch';
import WMDemolitionRenderer from './WMDemolitionRenderer';
import WMEquipmentRenderer from './WMEquipmentRenderer';
import WMContainmentRenderer from './WMContainmentRenderer';
import WMFloorProtectionRenderer from './WMFloorProtectionRenderer';
import WMContentProtectionRenderer from './WMContentProtectionRenderer';
import WMWallLineRenderer from './WMWallLineRenderer';

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

  // Canvas dimensions (kept for potential future use)
  canvasWidth: number;
  canvasHeight: number;
}


/**
 * Returns true if a demolition zone is a rectangle (floor/ceiling) type
 * rendered via WMDemolitionRenderer.
 */
function isRectZone(zone: WMDemolitionZone, materialTypes: DemoMaterialType[]): boolean {
  const mat =
    materialTypes.find((m) => m.id === zone.material_type) ??
    DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === zone.material_type);
  if (!mat) return true;
  return mat.surface !== 'wall' && mat.unit !== 'LF';
}

/**
 * Returns true if a demolition zone is a wall/baseboard line type
 * rendered via WMWallLineRenderer.
 */
function isLineZone(zone: WMDemolitionZone, materialTypes: DemoMaterialType[]): boolean {
  const mat =
    materialTypes.find((m) => m.id === zone.material_type) ??
    DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === zone.material_type);
  if (!mat) return false;
  return mat.surface === 'wall' || mat.unit === 'LF';
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
    activeTool === 'equipment';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <Layer listening={!isDrawingTool}>
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
            onSelect={selectDemoHandler}
            onDragEnd={dragDemoHandler}
            onTransformEnd={transformDemoHandler}
          />
        ))}

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

      {/* 6. Rubber-band drawing preview */}
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

    </Layer>
  );
};

export default React.memo(WMOverlayLayer);
