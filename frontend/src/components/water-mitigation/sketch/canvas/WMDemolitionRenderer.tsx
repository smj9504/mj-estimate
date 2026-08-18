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
import { WMDemolitionZone, WOOD_FLOOR_SUB_TYPES, EA_MATERIAL_IDS, EA_ITEM_PIXEL_SIZES, TRIM_SIZE_SUB_TYPES, type DemoStrokeStyle } from '../../../../types/wmSketch';
import { formatDimensionCompact } from '../utils/wmCalculations';
import { useTouchTargetSizes } from '../hooks/useWMResponsive';

export interface WMDemolitionRendererProps {
  zone: WMDemolitionZone;
  isSelected: boolean;
  scalePixelsPerFoot: number;
  /** 1-based zone number shown on the canvas label */
  zoneNumber?: number;
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
/** Short abbreviation labels for EA material types */
const EA_ABBREVIATIONS: Record<string, string> = {
  window_trim_demo: 'WT',
  door_trim_demo: 'DT',
  door_demo: 'DR',
  stair_demo: 'STR',
};

function resolveRenderSize(
  zone: WMDemolitionZone,
  scalePixelsPerFoot: number,
): { widthPx: number; heightPx: number; hasDimensions: boolean; isEA: boolean } {
  // EA items use fixed pixel sizes based on sub-type
  if (EA_MATERIAL_IDS.has(zone.material_type)) {
    const sizeMap = EA_ITEM_PIXEL_SIZES[zone.material_type] ?? {};
    const sizeKey = zone.sub_type || '';
    const size = sizeMap[sizeKey] ?? sizeMap[''] ?? { w: 36, h: 36 };
    return {
      widthPx: size.w,
      heightPx: size.h,
      hasDimensions: true,
      isEA: true,
    };
  }

  const hasDimensions = zone.dimension1_ft > 0 && zone.dimension2_ft > 0;

  if (hasDimensions) {
    return {
      widthPx: zone.dimension1_ft * scalePixelsPerFoot,
      heightPx: zone.dimension2_ft * scalePixelsPerFoot,
      hasDimensions: true,
      isEA: false,
    };
  }

  // Fall back to the pixel dimensions stored at drag-time
  if (zone.pixel_width && zone.pixel_height && zone.pixel_width > 0 && zone.pixel_height > 0) {
    return {
      widthPx: zone.pixel_width,
      heightPx: zone.pixel_height,
      hasDimensions: false,
      isEA: false,
    };
  }

  // Last-resort placeholder
  return { widthPx: 60, heightPx: 40, hasDimensions: false, isEA: false };
}

const WMDemolitionRenderer: React.FC<WMDemolitionRendererProps> = ({
  zone,
  isSelected,
  scalePixelsPerFoot,
  zoneNumber,
  onSelect,
  onDragEnd,
  onTransformEnd,
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const rectRef = useRef<Konva.Rect>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  // Resize/rotate handles must be finger-sized on touch devices
  const touchSizes = useTouchTargetSizes();

  const { widthPx, heightPx, hasDimensions, isEA } = resolveRenderSize(zone, scalePixelsPerFoot);

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
  // EA items don't get resize handles — they use fixed sizes based on sub-type
  useEffect(() => {
    if (!transformerRef.current || !rectRef.current) return;
    if (isSelected && !isEA) {
      transformerRef.current.nodes([rectRef.current]);
      transformerRef.current.getLayer()?.batchDraw();
    } else {
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected, isEA]);

  const handleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    onSelect(zone.id, e.evt.ctrlKey || e.evt.metaKey);
  }, [zone.id, onSelect]);

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      onDragEnd(zone.id, e.target.x(), e.target.y());
    },
    [zone.id, onDragEnd],
  );

  // Shift-key snap: snap rotation to 15° increments during transform
  const handleTransform = useCallback((e: Konva.KonvaEventObject<Event>) => {
    if (!rectRef.current || !groupRef.current) return;
    if (!(e.evt as MouseEvent)?.shiftKey) return;

    const node = rectRef.current;
    const group = groupRef.current;
    const SNAP_ANGLE = 15;
    const totalRotation = group.rotation() + node.rotation();
    const snapped = Math.round(totalRotation / SNAP_ANGLE) * SNAP_ANGLE;
    node.rotation(snapped - group.rotation());
  }, []);

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

  // Custom visual properties from zone (inherited from material type)
  const customFillOpacity = zone.fill_opacity;
  const effectiveFillOpacity = isEA ? 0.85 : customFillOpacity != null ? customFillOpacity : (hasDimensions ? 0.35 : 0.2);

  const strokeStyleToDash = (style?: DemoStrokeStyle): number[] | undefined => {
    if (!hasDimensions) return [6, 4]; // always dashed when no dimensions
    if (isEA) return undefined;
    switch (style) {
      case 'dashed': return [8, 4];
      case 'dotted': return [3, 3];
      default: return undefined;
    }
  };
  const strokeDash = strokeStyleToDash(zone.stroke_style);

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
          opacity={effectiveFillOpacity}
          stroke={strokeColor}
          strokeWidth={isEA ? 2 : 2}
          strokeScaleEnabled={false}
          dash={strokeDash}
          cornerRadius={isEA ? widthPx / 6 : 2}
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

        {/* EA item: abbreviation label + size badge */}
        {isEA && (() => {
          const abbr = EA_ABBREVIATIONS[zone.material_type] ?? '?';
          const sizeCfg = zone.sub_type ? TRIM_SIZE_SUB_TYPES.find((s) => s.id === zone.sub_type) : null;
          const sizeLabel = sizeCfg?.name;
          return (
            <>
              <Text
                x={0}
                y={sizeLabel ? heightPx / 2 - 12 : heightPx / 2 - 7}
                width={widthPx}
                text={abbr}
                fontSize={13}
                fontFamily="'Inter', 'Segoe UI', sans-serif"
                fill="#ffffff"
                fontStyle="bold"
                align="center"
                listening={false}
              />
              {sizeLabel && (
                <Text
                  x={0}
                  y={heightPx / 2 + 2}
                  width={widthPx}
                  text={sizeLabel}
                  fontSize={8}
                  fontFamily="'Inter', 'Segoe UI', sans-serif"
                  fill="rgba(255,255,255,0.9)"
                  align="center"
                  listening={false}
                />
              )}
              {/* Stair tread count display */}
              {zone.material_type === 'stair_demo' && zone.dimension1_ft > 0 && (
                <Text
                  x={0}
                  y={heightPx / 2 + 2}
                  width={widthPx}
                  text={`×${Math.round(zone.dimension1_ft)}`}
                  fontSize={9}
                  fontFamily="'Inter', 'Segoe UI', sans-serif"
                  fill="rgba(255,255,255,0.9)"
                  fontStyle="bold"
                  align="center"
                  listening={false}
                />
              )}
            </>
          );
        })()}

        {/* Zone number + measurement label — only when real dimensions have been entered (non-EA) */}
        {!isEA && hasDimensions && widthPx > 20 && heightPx > 16 && (() => {
          const sqftText = `${zone.calculated_sqft.toFixed(2)} SF`;
          const labelText = zoneNumber != null ? `#${zoneNumber}  (${sqftText})` : sqftText;
          const charW = 7;
          const labelW = labelText.length * charW + 8;
          const labelX = (widthPx - labelW) / 2;
          return (
            <>
              <Rect
                x={labelX}
                y={heightPx / 2 - 9}
                width={labelW}
                height={18}
                fill="rgba(255,255,255,0.75)"
                cornerRadius={2}
                listening={false}
              />
              <Text
                x={labelX}
                y={heightPx / 2 - 8}
                width={labelW}
                text={labelText}
                fontSize={11}
                fontFamily="'Inter', 'Segoe UI', sans-serif"
                fill="#1a1a1a"
                fontStyle="bold"
                align="center"
                listening={false}
                wrap="none"
              />
            </>
          );
        })()}

        {/* Zone number or "?" prompt — shown when dimensions are missing (non-EA) */}
        {!isEA && !hasDimensions && widthPx > 20 && heightPx > 16 && (() => {
          const promptText = zoneNumber != null ? `#${zoneNumber} ?` : '?';
          const charW = 7;
          const promptW = promptText.length * charW + 8;
          const promptX = (widthPx - promptW) / 2;
          return (
            <>
              <Rect
                x={promptX}
                y={heightPx / 2 - 9}
                width={promptW}
                height={18}
                fill="rgba(255,255,255,0.80)"
                cornerRadius={2}
                listening={false}
              />
              <Text
                x={promptX}
                y={heightPx / 2 - 8}
                width={promptW}
                text={promptText}
                fontSize={10}
                fontFamily="'Inter', 'Segoe UI', sans-serif"
                fill={NEEDS_DIMS_COLOR}
                fontStyle="bold"
                align="center"
                listening={false}
                wrap="none"
              />
            </>
          );
        })()}

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

        {/* Wood floor sub-type badge (top-left) */}
        {zone.material_type === 'wood_floor' && zone.sub_type && widthPx > 40 && heightPx > 14 && (() => {
          const stCfg = WOOD_FLOOR_SUB_TYPES.find((s) => s.id === zone.sub_type);
          const stLabel = stCfg?.name ?? zone.sub_type;
          const badgeW = Math.min(stLabel.length * 6 + 8, widthPx - 4);
          return (
            <>
              <Rect
                x={2}
                y={2}
                width={badgeW}
                height={14}
                fill="#B8860B"
                cornerRadius={3}
                listening={false}
              />
              <Text
                x={2}
                y={3}
                width={badgeW}
                text={stLabel}
                fontSize={9}
                fontFamily="'Inter', 'Segoe UI', sans-serif"
                fill="#ffffff"
                fontStyle="bold"
                align="center"
                listening={false}
              />
            </>
          );
        })()}

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
        rotateAnchorOffset={touchSizes.rotateAnchorOffset}
        borderStroke="#1890ff"
        borderDash={[3, 3]}
        anchorSize={touchSizes.anchorSize}
        anchorCornerRadius={2}
        anchorStroke="#1890ff"
        anchorFill="#ffffff"
        onTransform={handleTransform}
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
