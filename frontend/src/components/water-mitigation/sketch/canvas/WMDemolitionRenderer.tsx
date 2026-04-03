/**
 * WMDemolitionRenderer
 * Renders a single demolition zone rectangle on a Konva layer.
 * Supports selection highlight, drag-to-move, and transform (resize).
 *
 * Rendering size priority:
 *   1. dimension1_ft > 0  → use dimension * scalePixelsPerFoot (real measurement)
 *   2. pixel_width present → use raw pixel dimensions from initial drag
 *   3. fallback             → 60 × 40 px placeholder
 *
 * When dimensions are 0, a "?" prompt is shown instead of the dimension label
 * and the zone is outlined with a warning color to signal that the user should
 * enter real dimensions in the sidebar panel.
 *
 * Usage:
 *   <WMDemolitionRenderer
 *     zone={zone}
 *     isSelected={selectedId === zone.id}
 *     scalePixelsPerFoot={20}
 *     onSelect={(id) => setSelectedId(id)}
 *     onDragEnd={(id, x, y) => updateZonePosition(id, x, y)}
 *     onTransformEnd={(id, w, h) => updateZoneDimensions(id, w, h)}
 *   />
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { Group, Rect, Text, Transformer } from 'react-konva';
import Konva from 'konva';
import { WMDemolitionZone } from '../../../../types/wmSketch';
import { formatDimensionCompact } from '../utils/wmCalculations';

export interface WMDemolitionRendererProps {
  zone: WMDemolitionZone;
  isSelected: boolean;
  scalePixelsPerFoot: number;
  onSelect: (id: string) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onTransformEnd?: (id: string, width: number, height: number) => void;
}

/** Warning stroke color used when dimensions have not been entered yet */
const NEEDS_DIMS_COLOR = '#fa8c16';

/**
 * Build a compact dimension label string.
 * Example: 6.25 ft × 6.25 ft, 39.06 SF → "6'3\" × 6'3\" = 39.06 SF"
 */
function buildDimensionLabel(dim1_ft: number, dim2_ft: number, sqft: number): string {
  const d1 = formatDimensionCompact(dim1_ft);
  const d2 = formatDimensionCompact(dim2_ft);
  return `${d1} × ${d2} = ${sqft.toFixed(2)} SF`;
}

/**
 * Resolve the pixel dimensions used for canvas rendering.
 * Returns { widthPx, heightPx, hasDimensions }
 */
function resolveRenderSize(
  zone: WMDemolitionZone,
  scalePixelsPerFoot: number,
): { widthPx: number; heightPx: number; hasDimensions: boolean } {
  const hasDimensions = zone.dimension1_ft > 0 && zone.dimension2_ft > 0;

  if (hasDimensions) {
    return {
      widthPx: zone.dimension1_ft * scalePixelsPerFoot,
      heightPx: zone.dimension2_ft * scalePixelsPerFoot,
      hasDimensions: true,
    };
  }

  // Fall back to the pixel dimensions stored at drag-time
  if (zone.pixel_width && zone.pixel_height && zone.pixel_width > 0 && zone.pixel_height > 0) {
    return {
      widthPx: zone.pixel_width,
      heightPx: zone.pixel_height,
      hasDimensions: false,
    };
  }

  // Last-resort placeholder
  return { widthPx: 60, heightPx: 40, hasDimensions: false };
}

const WMDemolitionRenderer: React.FC<WMDemolitionRendererProps> = ({
  zone,
  isSelected,
  scalePixelsPerFoot,
  onSelect,
  onDragEnd,
  onTransformEnd,
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const rectRef = useRef<Konva.Rect>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  const { widthPx, heightPx, hasDimensions } = resolveRenderSize(zone, scalePixelsPerFoot);

  // Attach / detach the transformer when selection changes
  useEffect(() => {
    if (!transformerRef.current || !rectRef.current) return;
    if (isSelected) {
      transformerRef.current.nodes([rectRef.current]);
      transformerRef.current.getLayer()?.batchDraw();
    } else {
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  const handleClick = useCallback(() => {
    onSelect(zone.id);
  }, [zone.id, onSelect]);

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      onDragEnd(zone.id, e.target.x(), e.target.y());
    },
    [zone.id, onDragEnd],
  );

  const handleTransformEnd = useCallback(() => {
    if (!rectRef.current) return;
    const node = rectRef.current;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    // Reset scale and bake into width/height
    node.scaleX(1);
    node.scaleY(1);

    const newWidthPx = Math.max(20, node.width() * scaleX);
    const newHeightPx = Math.max(20, node.height() * scaleY);

    const newWidthFt = newWidthPx / scalePixelsPerFoot;
    const newHeightFt = newHeightPx / scalePixelsPerFoot;

    onTransformEnd?.(zone.id, newWidthFt, newHeightFt);
  }, [zone.id, scalePixelsPerFoot, onTransformEnd]);

  const textPadX = 4;

  // Stroke color: orange when dimensions are missing, otherwise use zone color
  const strokeColor = hasDimensions ? zone.color : NEEDS_DIMS_COLOR;

  return (
    <>
      <Group
        ref={groupRef}
        x={zone.x}
        y={zone.y}
        rotation={zone.rotation}
        draggable
        onClick={handleClick}
        onTap={handleClick}
        onDragEnd={handleDragEnd}
      >
        {/* Zone fill */}
        <Rect
          ref={rectRef}
          width={widthPx}
          height={heightPx}
          fill={zone.color}
          opacity={hasDimensions ? 0.35 : 0.2}
          stroke={strokeColor}
          strokeWidth={hasDimensions ? 2 : 2}
          strokeScaleEnabled={false}
          dash={hasDimensions ? undefined : [6, 4]}
          cornerRadius={2}
        />

        {/* Selection stroke overlay */}
        {isSelected && (
          <Rect
            width={widthPx}
            height={heightPx}
            fill="transparent"
            stroke="#1890ff"
            strokeWidth={2}
            strokeScaleEnabled={false}
            dash={[6, 3]}
            listening={false}
          />
        )}

        {/* Dimension label — only when real dimensions have been entered */}
        {hasDimensions && widthPx > 40 && heightPx > 20 && (
          <>
            <Rect
              x={textPadX}
              y={heightPx / 2 - 9}
              width={widthPx - textPadX * 2}
              height={18}
              fill="rgba(255,255,255,0.75)"
              cornerRadius={2}
              listening={false}
            />
            <Text
              x={textPadX}
              y={heightPx / 2 - 8}
              width={widthPx - textPadX * 2}
              text={buildDimensionLabel(zone.dimension1_ft, zone.dimension2_ft, zone.calculated_sqft)}
              fontSize={11}
              fontFamily="'Inter', 'Segoe UI', sans-serif"
              fill="#1a1a1a"
              align="center"
              listening={false}
              wrap="none"
              ellipsis
            />
          </>
        )}

        {/* "Enter dimensions" prompt — shown when dimensions are missing */}
        {!hasDimensions && widthPx > 30 && heightPx > 16 && (
          <>
            <Rect
              x={textPadX}
              y={heightPx / 2 - 9}
              width={widthPx - textPadX * 2}
              height={18}
              fill="rgba(255,255,255,0.80)"
              cornerRadius={2}
              listening={false}
            />
            <Text
              x={textPadX}
              y={heightPx / 2 - 8}
              width={widthPx - textPadX * 2}
              text="Enter dimensions"
              fontSize={10}
              fontFamily="'Inter', 'Segoe UI', sans-serif"
              fill={NEEDS_DIMS_COLOR}
              fontStyle="bold"
              align="center"
              listening={false}
              wrap="none"
              ellipsis
            />
          </>
        )}

        {/* Optional custom label beneath dimension text */}
        {zone.label && widthPx > 40 && heightPx > 38 && (
          <Text
            x={textPadX}
            y={heightPx / 2 + 12}
            width={widthPx - textPadX * 2}
            text={zone.label}
            fontSize={10}
            fontFamily="'Inter', 'Segoe UI', sans-serif"
            fill="#333333"
            align="center"
            listening={false}
            wrap="none"
            ellipsis
          />
        )}
      </Group>

      {/* Transformer for resize handles — rendered outside Group so it sits on top */}
      <Transformer
        ref={transformerRef}
        rotateEnabled={false}
        borderStroke="#1890ff"
        borderDash={[3, 3]}
        anchorSize={8}
        anchorCornerRadius={2}
        anchorStroke="#1890ff"
        anchorFill="#ffffff"
        onTransformEnd={handleTransformEnd}
        boundBoxFunc={(oldBox, newBox) => {
          if (newBox.width < 20 || newBox.height < 20) return oldBox;
          return newBox;
        }}
      />
    </>
  );
};

export default React.memo(WMDemolitionRenderer);
