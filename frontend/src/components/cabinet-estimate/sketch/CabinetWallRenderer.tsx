/**
 * CabinetWallRenderer
 *
 * Renders a cabinet-layout wall as a thick line with endpoint drag handles,
 * plus the ghost-line preview shown while a wall is being drawn.
 *
 * Ported from water-mitigation/sketch/canvas/WMFloorPlanRenderer.tsx's
 * WMWallRenderer/WMWallPreview — those are already domain-agnostic (no WM
 * material-type fields), so only the type import changes.
 */

import React, { useCallback } from 'react';
import { Group, Line, Circle, Text } from 'react-konva';
import type { CabinetSketchWall } from '../../../types/cabinetSketch';
import { DEFAULT_WALL_COLOR } from '../../../types/cabinetSketch';

interface CabinetWallRendererProps {
  wall: CabinetSketchWall;
  isSelected: boolean;
  onSelect: (id: string, ctrlKey?: boolean) => void;
  onDragEndpoint: (wallId: string, endpoint: 'start' | 'end', x: number, y: number) => void;
  /** Drag the entire wall (both endpoints move together) */
  onWallDragEnd?: (wallId: string, dx: number, dy: number) => void;
}

const CabinetWallRendererInner: React.FC<CabinetWallRendererProps> = ({
  wall,
  isSelected,
  onSelect,
  onDragEndpoint,
  onWallDragEnd,
}) => {
  const { id, start_x, start_y, end_x, end_y, thickness, color } = wall;

  const handleClick = useCallback(
    (e: any) => {
      e.cancelBubble = true;
      onSelect(id, e.evt?.ctrlKey || e.evt?.metaKey);
    },
    [id, onSelect]
  );

  const handleGroupDragEnd = useCallback(
    (e: any) => {
      const dx = e.target.x();
      const dy = e.target.y();
      e.target.position({ x: 0, y: 0 });
      if (dx !== 0 || dy !== 0) onWallDragEnd?.(id, dx, dy);
    },
    [id, onWallDragEnd]
  );

  const handleStartDragEnd = useCallback(
    (e: any) => onDragEndpoint(id, 'start', e.target.x(), e.target.y()),
    [id, onDragEndpoint]
  );

  const handleEndDragEnd = useCallback(
    (e: any) => onDragEndpoint(id, 'end', e.target.x(), e.target.y()),
    [id, onDragEndpoint]
  );

  const strokeWidth = thickness || 4;

  const midX = (start_x + end_x) / 2;
  const midY = (start_y + end_y) / 2;
  const dx = end_x - start_x;
  const dy = end_y - start_y;
  const wallLen = Math.sqrt(dx * dx + dy * dy);
  const nx = wallLen > 0 ? -dy / wallLen : 0;
  const ny = wallLen > 0 ? dx / wallLen : -1;
  const labelOffset = 14;
  const labelX = midX + nx * labelOffset;
  const labelY = midY + ny * labelOffset;
  const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
  const labelRotation = angleDeg > 90 || angleDeg < -90 ? angleDeg + 180 : angleDeg;

  const lengthLabel = wall.length_ft > 0 ? `${wall.length_ft.toFixed(1)}'` : '';

  return (
    <Group draggable={isSelected} onDragEnd={handleGroupDragEnd}>
      <Line
        points={[start_x, start_y, end_x, end_y]}
        stroke={isSelected ? '#1890ff' : color || DEFAULT_WALL_COLOR}
        strokeWidth={strokeWidth}
        lineCap="round"
        hitStrokeWidth={Math.max(strokeWidth + 10, 16)}
        onClick={handleClick}
        onTap={handleClick}
      />

      {lengthLabel && wallLen > 30 && (
        <Group x={labelX} y={labelY} rotation={labelRotation}>
          <Text
            text={lengthLabel}
            fontSize={11}
            fill={isSelected ? '#1890ff' : '#595959'}
            fontFamily="'Inter', 'Segoe UI', sans-serif"
            fontStyle={isSelected ? 'bold' : 'normal'}
            offsetX={lengthLabel.length * 3.2}
            offsetY={6}
            listening={false}
          />
        </Group>
      )}

      <Circle x={start_x} y={start_y} radius={3} fill={color || DEFAULT_WALL_COLOR} listening={false} />
      <Circle x={end_x} y={end_y} radius={3} fill={color || DEFAULT_WALL_COLOR} listening={false} />

      {isSelected && (
        <>
          <Circle
            x={start_x}
            y={start_y}
            radius={7}
            fill="#fff"
            stroke="#1890ff"
            strokeWidth={2}
            draggable
            onDragEnd={handleStartDragEnd}
          />
          <Circle
            x={end_x}
            y={end_y}
            radius={7}
            fill="#fff"
            stroke="#1890ff"
            strokeWidth={2}
            draggable
            onDragEnd={handleEndDragEnd}
          />
        </>
      )}
    </Group>
  );
};

export const CabinetWallRenderer = React.memo(CabinetWallRendererInner);

// ============================================================================
// Wall Drawing Preview (ghost line from start point to cursor)
// ============================================================================

interface CabinetWallPreviewProps {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  snappedEnd?: { x: number; y: number } | null;
}

export const CabinetWallPreview: React.FC<CabinetWallPreviewProps> = ({
  startX,
  startY,
  endX,
  endY,
  snappedEnd,
}) => {
  return (
    <Group listening={false}>
      <Line
        points={[startX, startY, endX, endY]}
        stroke="#1890ff"
        strokeWidth={3}
        dash={[8, 4]}
        opacity={0.7}
        lineCap="round"
      />
      <Circle x={startX} y={startY} radius={5} fill="#1890ff" opacity={0.8} />
      <Circle x={endX} y={endY} radius={4} fill="#1890ff" opacity={0.6} />
      {snappedEnd && (
        <Circle
          x={snappedEnd.x}
          y={snappedEnd.y}
          radius={8}
          fill="transparent"
          stroke="#52c41a"
          strokeWidth={2}
          opacity={0.9}
        />
      )}
    </Group>
  );
};

export default CabinetWallRenderer;
