/**
 * WMWallLineRenderer
 * Renders a wall demolition or baseboard/quarter-round zone as a line
 * on the Konva canvas. Walls are thicker solid lines; baseboards are
 * thinner dashed lines. Both support drag and endpoint manipulation.
 *
 * - Wall (SF): drawn as a thick line; area = length_ft * height_ft
 * - Baseboard / Quarter Round (LF): drawn as a thinner dashed line; value = length in LF
 */

import React, { useCallback } from 'react';
import { Group, Line, Circle, Rect, Text } from 'react-konva';
import Konva from 'konva';
import { WMDemolitionZone, DemoMaterialType, DEFAULT_DEMO_MATERIAL_TYPES } from '../../../../types/wmSketch';

export interface WMWallLineRendererProps {
  zone: WMDemolitionZone;
  isSelected: boolean;
  scalePixelsPerFoot: number;
  materialTypes: DemoMaterialType[];
  onSelect: (id: string, ctrlKey?: boolean) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onTransformEnd?: (id: string, lengthFt: number, rotationDeg: number) => void;
}

function getMaterial(zone: WMDemolitionZone, materialTypes: DemoMaterialType[]) {
  return (
    materialTypes.find((m) => m.id === zone.material_type) ??
    DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === zone.material_type)
  );
}

const WMWallLineRenderer: React.FC<WMWallLineRendererProps> = ({
  zone,
  isSelected,
  scalePixelsPerFoot,
  materialTypes,
  onSelect,
  onDragEnd,
  onTransformEnd,
}) => {
  const mat = getMaterial(zone, materialTypes);
  const isLF = mat?.unit === 'LF';

  // dimension1_ft stores the line length
  const lengthPx = zone.dimension1_ft * scalePixelsPerFoot;
  const color = zone.color || mat?.color || '#FF5722';

  // Line styling
  const lineWidth = isLF ? 3 : 5;
  const dash = isLF ? [8, 4] : undefined;

  // Label
  let labelText = '';
  if (isLF) {
    labelText = `${zone.dimension1_ft.toFixed(2)} LF`;
  } else {
    const sqft = zone.calculated_sqft || 0;
    labelText = sqft > 0 ? `${sqft.toFixed(2)} SF` : `${zone.dimension1_ft.toFixed(2)}'`;
  }
  if (zone.label) labelText = zone.label;

  const pendingLabel = isLF ? 'Baseboard (set length)' : 'Wall (set length)';

  const handleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    onSelect(zone.id, e.evt.ctrlKey || e.evt.metaKey);
  }, [zone.id, onSelect]);

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      onDragEnd(zone.id, e.target.x(), e.target.y());
    },
    [zone.id, onDragEnd],
  );

  const handleEndpointDrag = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      if (!onTransformEnd) return;
      const handle = e.target;
      const stage = handle.getStage();
      if (!stage) return;

      const handleAbsPos = handle.getAbsolutePosition();
      const group = handle.getParent();
      if (!group) return;
      const startAbsPos = group.getAbsolutePosition();

      const stageTransform = stage.getAbsoluteTransform().copy().invert();
      const startCanvas = stageTransform.point(startAbsPos);
      const endCanvas = stageTransform.point(handleAbsPos);

      const dx = endCanvas.x - startCanvas.x;
      const dy = endCanvas.y - startCanvas.y;
      const newLengthPx = Math.sqrt(dx * dx + dy * dy);
      const newLengthFt = newLengthPx / scalePixelsPerFoot;
      const newAngleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

      handle.position({ x: newLengthFt * scalePixelsPerFoot, y: 0 });
      onTransformEnd(zone.id, Math.max(0.5, newLengthFt), newAngleDeg);
    },
    [zone.id, scalePixelsPerFoot, onTransformEnd],
  );

  // Zero-length: show a small placeholder so multiple list-only zones are
  // visible and selectable (they would otherwise stack invisibly at 0 LF).
  if (lengthPx <= 0) {
    return (
      <Group
        x={zone.x}
        y={zone.y}
        rotation={zone.rotation}
        draggable
        onClick={handleClick}
        onTap={handleClick}
        onDragEnd={handleDragEnd}
      >
        <Circle
          x={0}
          y={0}
          radius={14}
          fill="rgba(0,0,0,0.02)"
          stroke="transparent"
        />
        <Circle
          x={0}
          y={0}
          radius={6}
          stroke={color}
          strokeWidth={2}
          dash={isLF ? [3, 3] : undefined}
          listening={false}
        />
        <Text
          x={-70}
          y={-28}
          width={140}
          text={pendingLabel}
          fontSize={9}
          fontFamily="'Inter', 'Segoe UI', sans-serif"
          fill="#888"
          align="center"
          listening={false}
        />
        {isSelected && (
          <Circle
            x={0}
            y={0}
            radius={10}
            stroke="#1890ff"
            strokeWidth={2}
            dash={[4, 2]}
            listening={false}
          />
        )}
      </Group>
    );
  }

  return (
    <Group
      x={zone.x}
      y={zone.y}
      rotation={zone.rotation}
      draggable
      onClick={handleClick}
      onTap={handleClick}
      onDragEnd={handleDragEnd}
    >
      {/* Main line */}
      <Line
        points={[0, 0, lengthPx, 0]}
        stroke={color}
        strokeWidth={lineWidth}
        dash={dash}
        lineCap="round"
        opacity={0.8}
      />

      {/* Hit area */}
      <Line
        points={[0, 0, lengthPx, 0]}
        stroke="transparent"
        strokeWidth={16}
      />

      {/* Selection highlight */}
      {isSelected && (
        <Line
          points={[0, 0, lengthPx, 0]}
          stroke="#1890ff"
          strokeWidth={lineWidth + 4}
          dash={[4, 3]}
          lineCap="round"
          listening={false}
        />
      )}

      {/* Label */}
      {lengthPx > 40 && (
        <>
          <Rect
            x={lengthPx / 2 - 50}
            y={-22}
            width={100}
            height={16}
            fill="rgba(255,255,255,0.9)"
            cornerRadius={2}
            listening={false}
          />
          <Text
            x={lengthPx / 2 - 50}
            y={-21}
            width={100}
            text={labelText}
            fontSize={10}
            fontFamily="'Inter', 'Segoe UI', sans-serif"
            fill={color}
            fontStyle="bold"
            align="center"
            listening={false}
            wrap="none"
            ellipsis
          />
        </>
      )}

      {/* Insulation indicator badge */}
      {zone.include_insulation && lengthPx > 50 && (
        <>
          <Rect
            x={lengthPx / 2 + 54}
            y={-22}
            width={28}
            height={14}
            fill="#E91E63"
            cornerRadius={3}
            listening={false}
          />
          <Text
            x={lengthPx / 2 + 54}
            y={-21}
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

      {/* Endpoint handles (only when selected) */}
      {isSelected && (
        <>
          <Circle
            x={0}
            y={0}
            radius={5}
            fill="#ffffff"
            stroke={color}
            strokeWidth={2}
            listening={false}
          />
          <Circle
            x={lengthPx}
            y={0}
            radius={5}
            fill={color}
            stroke="#ffffff"
            strokeWidth={2}
            draggable
            onDragEnd={handleEndpointDrag}
            onMouseEnter={(e) => {
              const s = e.target.getStage();
              if (s) s.container().style.cursor = 'grab';
            }}
            onMouseLeave={(e) => {
              const s = e.target.getStage();
              if (s) s.container().style.cursor = '';
            }}
          />
        </>
      )}
    </Group>
  );
};

export default React.memo(WMWallLineRenderer);
