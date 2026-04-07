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
import WMLegendRenderer from './WMLegendRenderer';

export interface WMOverlayLayerProps {
  overlayData: WMOverlayData;
  scalePixelsPerFoot: number;
  selectedId: string | null;
  activeTool: WMSketchTool;
  materialTypes: DemoMaterialType[];

  // Drawing state
  isDrawing: boolean;
  drawStart: { x: number; y: number } | null;
  drawCurrent: { x: number; y: number } | null;
  activeMaterialColor: string;

  // Callbacks
  onSelectElement: (id: string, type: string) => void;
  onDragEnd: (id: string, type: string, x: number, y: number) => void;
  onTransformEnd?: (id: string, type: string, widthFt: number, heightFt: number) => void;

  // Canvas dimensions used to position the legend
  canvasWidth: number;
  canvasHeight: number;
}

// Padding from the canvas edge for the legend box
const LEGEND_MARGIN = 10;
const LEGEND_WIDTH = 170;

/**
 * Returns true if a demolition zone should be rendered on the 2D canvas.
 * Wall zones (surface === 'wall') and linear-foot items (unit === 'LF',
 * i.e. baseboards) cannot be meaningfully represented as 2D rectangles on
 * a floor plan, so they are managed exclusively through the sidebar panel.
 */
function isCanvasRenderable(zone: WMDemolitionZone, materialTypes: DemoMaterialType[]): boolean {
  const mat =
    materialTypes.find((m) => m.id === zone.material_type) ??
    DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === zone.material_type);
  if (!mat) return true; // unknown material — show it rather than silently hide
  return mat.surface !== 'wall' && mat.unit !== 'LF';
}

const WMOverlayLayer: React.FC<WMOverlayLayerProps> = ({
  overlayData,
  scalePixelsPerFoot,
  selectedId,
  activeTool,
  materialTypes,
  isDrawing,
  drawStart,
  drawCurrent,
  activeMaterialColor,
  onSelectElement,
  onDragEnd,
  onTransformEnd,
  canvasWidth,
  canvasHeight,
}) => {
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
    (type: string) => (id: string, widthFt: number, heightFt: number) =>
      onTransformEnd?.(id, type, widthFt, heightFt),
    [onTransformEnd],
  );

  // Stable per-type handlers
  const selectDemoHandler = useCallback((id: string) => onSelectElement(id, 'demolition'), [onSelectElement]);
  const dragDemoHandler = useCallback((id: string, x: number, y: number) => onDragEnd(id, 'demolition', x, y), [onDragEnd]);
  const transformDemoHandler = useCallback((id: string, w: number, h: number) => onTransformEnd?.(id, 'demolition', w, h), [onTransformEnd]);

  const selectEquipHandler = useCallback((id: string) => onSelectElement(id, 'equipment'), [onSelectElement]);
  const dragEquipHandler = useCallback((id: string, x: number, y: number) => onDragEnd(id, 'equipment', x, y), [onDragEnd]);

  const selectContainHandler = useCallback((id: string) => onSelectElement(id, 'containment'), [onSelectElement]);
  const dragContainHandler = useCallback((id: string, x: number, y: number) => onDragEnd(id, 'containment', x, y), [onDragEnd]);
  const transformContainHandler = useCallback((id: string, lengthFt: number, rotation: number) => onTransformEnd?.(id, 'containment', lengthFt, rotation), [onTransformEnd]);

  const selectProtectHandler = useCallback((id: string) => onSelectElement(id, 'floor_protection'), [onSelectElement]);
  const dragProtectHandler = useCallback((id: string, x: number, y: number) => onDragEnd(id, 'floor_protection', x, y), [onDragEnd]);

  const selectContentProtHandler = useCallback((id: string) => onSelectElement(id, 'content_protection'), [onSelectElement]);
  const dragContentProtHandler = useCallback((id: string, x: number, y: number) => onDragEnd(id, 'content_protection', x, y), [onDragEnd]);

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
  // Legend position (bottom-right corner)
  // ---------------------------------------------------------------------------
  const legendX = canvasWidth - LEGEND_WIDTH - LEGEND_MARGIN;

  // Approximate legend height: we don't know it exactly until render, so
  // estimate based on row count to roughly position it.
  // Only count canvas-visible (non-wall, non-LF) zones for legend row estimation
  const usedMaterialIds = new Set(
    overlayData.demolition_zones
      .filter((z) => isCanvasRenderable(z, materialTypes))
      .map((z) => z.material_type),
  );
  const materialRowCount = materialTypes.filter((mt) => usedMaterialIds.has(mt.id)).length;
  const equipRowCount = Object.keys(overlayData.equipment_placements.reduce(
    (acc, p) => { acc[p.equipment_type] = true; return acc; },
    {} as Record<string, boolean>,
  )).length;
  const extraRows =
    (overlayData.containment_zones.length > 0 ? 1 : 0) +
    (overlayData.floor_protections.length > 0 ? 1 : 0) +
    ((overlayData.content_protections ?? []).length > 0 ? 1 : 0);
  const totalRows = materialRowCount + equipRowCount + extraRows;
  const estimatedLegendHeight = 10 + 20 + 6 + totalRows * 18 + 10;
  const legendY = canvasHeight - estimatedLegendHeight - LEGEND_MARGIN;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <Layer>
      {/* 1. Floor protections (bottom-most overlay) */}
      {overlayData.floor_protections.map((fp) => (
        <WMFloorProtectionRenderer
          key={fp.id}
          protection={fp}
          isSelected={selectedId === fp.id}
          scalePixelsPerFoot={scalePixelsPerFoot}
          onSelect={selectProtectHandler}
          onDragEnd={dragProtectHandler}
        />
      ))}

      {/* 2. Content protection areas */}
      {(overlayData.content_protections ?? []).map((cp) => (
        <WMContentProtectionRenderer
          key={cp.id}
          protection={cp}
          isSelected={selectedId === cp.id}
          scalePixelsPerFoot={scalePixelsPerFoot}
          onSelect={selectContentProtHandler}
          onDragEnd={dragContentProtHandler}
        />
      ))}

      {/* 3. Containment barriers (lines) */}
      {overlayData.containment_zones.map((zone) => (
        <WMContainmentRenderer
          key={zone.id}
          zone={zone}
          isSelected={selectedId === zone.id}
          scalePixelsPerFoot={scalePixelsPerFoot}
          onSelect={selectContainHandler}
          onDragEnd={dragContainHandler}
          onTransformEnd={transformContainHandler}
        />
      ))}

      {/* 4. Demolition zones — wall / baseboard types are excluded from canvas */}
      {overlayData.demolition_zones
        .filter((zone) => isCanvasRenderable(zone, materialTypes))
        .map((zone) => (
          <WMDemolitionRenderer
            key={zone.id}
            zone={zone}
            isSelected={selectedId === zone.id}
            scalePixelsPerFoot={scalePixelsPerFoot}
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
          isSelected={selectedId === placement.id}
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
      {isDrawing && drawStart && drawCurrent && activeTool !== 'containment' && rubberW > 2 && rubberH > 2 && (
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

      {/* 7. Legend (always rendered on top) */}
      {totalRows > 0 && (
        <WMLegendRenderer
          overlayData={overlayData}
          x={legendX}
          y={legendY}
          materialTypes={materialTypes}
        />
      )}
    </Layer>
  );
};

export default React.memo(WMOverlayLayer);
