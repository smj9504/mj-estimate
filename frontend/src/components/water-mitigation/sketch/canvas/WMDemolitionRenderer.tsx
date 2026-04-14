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
  onSelect: (id: string, ctrlKey?: boolean) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onTransformEnd?: (id: string, width: number, height: number, rotation?: number) => void;
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

  // When dimensions change externally (sidebar input), reset any lingering
  // Konva transform state so the Rect matches the new React-driven size.
  useEffect(() => {
    const node = rectRef.current;
    if (!node) return;
    node.scaleX(1);
    node.scaleY(1);
    node.x(0);
    node.y(0);
    node.rotation(0);
    node.width(widthPx);
    node.height(heightPx);
    node.getLayer()?.batchDraw();
  }, [widthPx, heightPx]);

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

  const handleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    onSelect(zone.id, e.evt.ctrlKey || e.evt.metaKey);
  }, [zone.id, onSelect]);

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      onDragEnd(zone.id, e.target.x(), e.target.y());
    },
    [zone.id, onDragEnd],
  );

  const handleTransformEnd = useCallback(() => {
    if (!rectRef.current || !groupRef.current) return;
    const node = rectRef.current;
    const group = groupRef.current;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    const newWidthPx = Math.max(20, node.width() * scaleX);
    const newHeightPx = Math.max(20, node.height() * scaleY);

    // Transfer the Rect's rotation into the Group so they don't compound.
    // The Transformer applies rotation to the Rect; we want it on the Group.
    const nodeRotation = node.rotation();
    if (nodeRotation !== 0) {
      group.rotation(group.rotation() + nodeRotation);
      node.rotation(0);
    }

    // The transformer may shift the Rect's local position (e.g. when
    // resizing from the left/top anchor). Fold that offset back into
    // the Group's position so the zone stays where the user placed it.
    const rectX = node.x();
    const rectY = node.y();
    if (rectX !== 0 || rectY !== 0) {
      const rad = ((group.rotation() || 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      group.x(group.x() + rectX * cos - rectY * sin);
      group.y(group.y() + rectX * sin + rectY * cos);
      node.x(0);
      node.y(0);
    }

    // Reset scale and bake into width/height
    node.scaleX(1);
    node.scaleY(1);
    node.width(newWidthPx);
    node.height(newHeightPx);

    const newWidthFt = newWidthPx / scalePixelsPerFoot;
    const newHeightFt = newHeightPx / scalePixelsPerFoot;
    const newRotation = group.rotation();

    // Report new position, dimensions, and rotation
    onDragEnd(zone.id, group.x(), group.y());
    onTransformEnd?.(zone.id, newWidthFt, newHeightFt, newRotation);
  }, [zone.id, scalePixelsPerFoot, onDragEnd, onTransformEnd]);

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

        {/* Carpet pad indicator badge */}
        {zone.include_pad && widthPx > 30 && heightPx > 14 && (
          <>
            <Rect
              x={widthPx - 30}
              y={2}
              width={28}
              height={14}
              fill="#52c41a"
              cornerRadius={3}
              listening={false}
            />
            <Text
              x={widthPx - 30}
              y={3}
              width={28}
              text="PAD"
              fontSize={9}
              fontFamily="'Inter', 'Segoe UI', sans-serif"
              fill="#ffffff"
              fontStyle="bold"
              align="center"
              listening={false}
            />
          </>
        )}

        {/* Insulation indicator badge */}
        {zone.include_insulation && widthPx > 30 && heightPx > 14 && (
          <>
            <Rect
              x={widthPx - (zone.include_pad ? 62 : 30)}
              y={2}
              width={28}
              height={14}
              fill="#E91E63"
              cornerRadius={3}
              listening={false}
            />
            <Text
              x={widthPx - (zone.include_pad ? 62 : 30)}
              y={3}
              width={28}
              text="INS"
              fontSize={9}
              fontFamily="'Inter', 'Segoe UI', sans-serif"
              fill="#ffffff"
              fontStyle="bold"
              align="center"
              listening={false}
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
        rotateEnabled={true}
        rotateAnchorOffset={20}
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
