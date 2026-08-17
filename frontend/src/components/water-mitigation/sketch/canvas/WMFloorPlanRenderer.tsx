/**
 * WMFloorPlanRenderer
 *
 * Renders floor plan walls and rooms on the Konva canvas.
 * Walls are drawn as thick lines with endpoint circles (snap handles).
 * Rooms are drawn as filled polygons with a name label.
 *
 * Also renders the wall-drawing preview (ghost line from start to cursor).
 */

import React, { useCallback, useMemo, useRef } from 'react';
import { Group, Line, Circle, Text } from 'react-konva';
import type { WMWall, WMRoom } from '../../../../types/wmSketch';
import { DEFAULT_WALL_COLOR, DEFAULT_ROOM_COLOR } from '../../../../types/wmSketch';

import { useTouchTargetSizes } from '../hooks/useWMResponsive';
// ============================================================================
// Wall Renderer
// ============================================================================

interface WMWallRendererProps {
  wall: WMWall;
  isSelected: boolean;
  onSelect: (id: string, ctrlKey?: boolean) => void;
  onDragEndpoint: (wallId: string, endpoint: 'start' | 'end', x: number, y: number) => void;
  /** Drag the entire wall (both endpoints move together) */
  onWallDragEnd?: (wallId: string, dx: number, dy: number) => void;
}

const WMWallRendererInner: React.FC<WMWallRendererProps> = ({
  wall,
  isSelected,
  onSelect,
  onDragEndpoint,
  onWallDragEnd,
}) => {
  // Handles must be finger-sized on touch devices; `hitStrokeWidth`
  // widens the tap target without changing how the handle looks.
  const touchSizes = useTouchTargetSizes();
  const { id, start_x, start_y, end_x, end_y, thickness, color } = wall;

  const handleClick = useCallback(
    (e: any) => {
      e.cancelBubble = true;
      onSelect(id, e.evt?.ctrlKey || e.evt?.metaKey);
    },
    [id, onSelect]
  );

  // Drag entire wall — compute delta and reset group position
  const handleGroupDragEnd = useCallback(
    (e: any) => {
      const dx = e.target.x();
      const dy = e.target.y();
      // Reset group position (coordinates are stored on wall endpoints)
      e.target.position({ x: 0, y: 0 });
      if (dx !== 0 || dy !== 0) {
        onWallDragEnd?.(id, dx, dy);
      }
    },
    [id, onWallDragEnd]
  );

  const handleStartDragEnd = useCallback(
    (e: any) => {
      onDragEndpoint(id, 'start', e.target.x(), e.target.y());
    },
    [id, onDragEndpoint]
  );

  const handleEndDragEnd = useCallback(
    (e: any) => {
      onDragEndpoint(id, 'end', e.target.x(), e.target.y());
    },
    [id, onDragEndpoint]
  );

  const strokeWidth = thickness || 4;

  // Label positioning: offset perpendicular to the wall line
  const midX = (start_x + end_x) / 2;
  const midY = (start_y + end_y) / 2;
  const dx = end_x - start_x;
  const dy = end_y - start_y;
  const wallLen = Math.sqrt(dx * dx + dy * dy);
  // Unit normal perpendicular to wall (rotated 90 degrees)
  const nx = wallLen > 0 ? -dy / wallLen : 0;
  const ny = wallLen > 0 ? dx / wallLen : -1;
  const labelOffset = 14;
  const labelX = midX + nx * labelOffset;
  const labelY = midY + ny * labelOffset;
  // Rotation to align label with wall direction
  const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
  // Flip if upside down
  const labelRotation = (angleDeg > 90 || angleDeg < -90) ? angleDeg + 180 : angleDeg;

  const lengthLabel = wall.length_ft > 0
    ? `${wall.length_ft.toFixed(1)}'`
    : '';

  return (
    <Group
      draggable={isSelected}
      onDragEnd={handleGroupDragEnd}
    >
      {/* Wall line */}
      <Line
        points={[start_x, start_y, end_x, end_y]}
        stroke={isSelected ? '#1890ff' : (color || DEFAULT_WALL_COLOR)}
        strokeWidth={strokeWidth}
        lineCap="round"
        hitStrokeWidth={Math.max(strokeWidth + 10, 16, touchSizes.hitStrokeWidth)}
        onClick={handleClick}
        onTap={handleClick}
      />

      {/* Measurement label — always visible */}
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

      {/* Small endpoint dots — always visible for snap reference */}
      <Circle
        x={start_x}
        y={start_y}
        radius={3}
        fill={color || DEFAULT_WALL_COLOR}
        listening={false}
      />
      <Circle
        x={end_x}
        y={end_y}
        radius={3}
        fill={color || DEFAULT_WALL_COLOR}
        listening={false}
      />

      {/* Draggable endpoint handles (visible when selected) */}
      {isSelected && (
        <>
          <Circle
            x={start_x}
            y={start_y}
            radius={7}
            fill="#fff"
            stroke="#1890ff"
            strokeWidth={2}
            hitStrokeWidth={touchSizes.hitStrokeWidth}
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
            hitStrokeWidth={touchSizes.hitStrokeWidth}
            draggable
            onDragEnd={handleEndDragEnd}
          />
        </>
      )}
    </Group>
  );
};

export const WMWallRenderer = React.memo(WMWallRendererInner);

// ============================================================================
// Room Renderer
// ============================================================================

interface WMRoomRendererProps {
  room: WMRoom;
  isSelected: boolean;
  onSelect: (id: string, ctrlKey?: boolean) => void;
  /** Drag the entire room (all boundary points move together) */
  onRoomDragEnd?: (roomId: string, dx: number, dy: number) => void;
  /** Drag a single boundary vertex to reshape the room */
  onRoomVertexDrag?: (roomId: string, vertexIndex: number, x: number, y: number) => void;
}

const WMRoomRendererInner: React.FC<WMRoomRendererProps> = ({
  room,
  isSelected,
  onSelect,
  onRoomDragEnd,
  onRoomVertexDrag,
}) => {
  // Handles must be finger-sized on touch devices; `hitStrokeWidth`
  // widens the tap target without changing how the handle looks.
  const touchSizes = useTouchTargetSizes();
  const { id, boundary, name, color, area_sqft } = room;
  const isVertexDragging = useRef(false);

  const handleClick = useCallback(
    (e: any) => {
      e.cancelBubble = true;
      onSelect(id, e.evt?.ctrlKey || e.evt?.metaKey);
    },
    [id, onSelect]
  );

  // Drag entire room — compute delta and reset group position
  const handleGroupDragEnd = useCallback(
    (e: any) => {
      // Skip if a vertex/edge handle triggered this
      if (isVertexDragging.current) {
        e.target.position({ x: 0, y: 0 });
        return;
      }
      const dx = e.target.x();
      const dy = e.target.y();
      e.target.position({ x: 0, y: 0 });
      if (dx !== 0 || dy !== 0) {
        onRoomDragEnd?.(id, dx, dy);
      }
    },
    [id, onRoomDragEnd]
  );

  // Edge midpoints for side-resize handles (must be before early return)
  const edgeMidpoints = useMemo(() => {
    if (!boundary || boundary.length < 3) return [];
    return boundary.map((p, i) => {
      const next = boundary[(i + 1) % boundary.length];
      return { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2, i1: i, i2: (i + 1) % boundary.length };
    });
  }, [boundary]);

  if (!boundary || boundary.length < 3) return null;

  // Flatten boundary to [x1,y1,x2,y2,...] for Konva Line
  const flatPoints = boundary.flatMap((p) => [p.x, p.y]);

  // Calculate centroid for label
  const cx = boundary.reduce((s, p) => s + p.x, 0) / boundary.length;
  const cy = boundary.reduce((s, p) => s + p.y, 0) / boundary.length;

  // Measure rough bounding size for label fitting
  const minX = Math.min(...boundary.map((p) => p.x));
  const maxX = Math.max(...boundary.map((p) => p.x));
  const roomWidth = maxX - minX;

  return (
    <Group
      draggable={isSelected}
      onDragEnd={handleGroupDragEnd}
    >
      {/* Room fill */}
      <Line
        points={flatPoints}
        closed
        fill={color || DEFAULT_ROOM_COLOR}
        stroke={isSelected ? '#1890ff' : '#0066cc'}
        strokeWidth={isSelected ? 2 : 1}
        opacity={0.6}
        onClick={handleClick}
        onTap={handleClick}
      />

      {/* Room name label */}
      {roomWidth > 40 && (
        <Text
          x={cx}
          y={cy - 10}
          text={name}
          fontSize={13}
          fontStyle="bold"
          fill={isSelected ? '#1890ff' : '#333'}
          fontFamily="'Inter', 'Segoe UI', sans-serif"
          align="center"
          offsetX={name.length * 3.5}
          listening={false}
        />
      )}

      {/* Area label */}
      {area_sqft > 0 && roomWidth > 50 && (
        <Text
          x={cx}
          y={cy + 6}
          text={`${area_sqft.toFixed(0)} SF`}
          fontSize={11}
          fill={isSelected ? '#1890ff' : '#666'}
          fontFamily="'Inter', 'Segoe UI', sans-serif"
          align="center"
          offsetX={20}
          listening={false}
        />
      )}

      {/* Vertex handles (corner resize — shown when selected) */}
      {isSelected && boundary.map((pt, idx) => (
        <Circle
          key={`v-${idx}`}
          x={pt.x}
          y={pt.y}
          radius={6}
          fill="#fff"
          stroke="#1890ff"
          strokeWidth={2}
          hitStrokeWidth={touchSizes.hitStrokeWidth}
          draggable
          onDragStart={(e) => { e.cancelBubble = true; isVertexDragging.current = true; }}
          onDragEnd={(e) => {
            e.cancelBubble = true;
            const newX = e.target.x();
            const newY = e.target.y();
            e.target.position({ x: pt.x, y: pt.y });
            onRoomVertexDrag?.(id, idx, newX, newY);
            setTimeout(() => { isVertexDragging.current = false; }, 0);
          }}
          onMouseEnter={(e) => {
            const s = e.target.getStage();
            if (s) s.container().style.cursor = 'move';
          }}
          onMouseLeave={(e) => {
            const s = e.target.getStage();
            if (s) s.container().style.cursor = '';
          }}
        />
      ))}

      {/* Edge midpoint handles (side resize — shown when selected) */}
      {isSelected && edgeMidpoints.map((mp, idx) => (
        <Circle
          key={`e-${idx}`}
          x={mp.x}
          y={mp.y}
          radius={4}
          fill="#1890ff"
          stroke="#fff"
          strokeWidth={1.5}
          hitStrokeWidth={touchSizes.hitStrokeWidth}
          draggable
          onDragStart={(e) => { e.cancelBubble = true; isVertexDragging.current = true; }}
          onDragEnd={(e) => {
            e.cancelBubble = true;
            const newX = e.target.x();
            const newY = e.target.y();
            const dx = newX - mp.x;
            const dy = newY - mp.y;
            e.target.position({ x: mp.x, y: mp.y });
            // Move both vertices of this edge
            onRoomVertexDrag?.(id, mp.i1, boundary[mp.i1].x + dx, boundary[mp.i1].y + dy);
            onRoomVertexDrag?.(id, mp.i2, boundary[mp.i2].x + dx, boundary[mp.i2].y + dy);
            setTimeout(() => { isVertexDragging.current = false; }, 0);
          }}
          onMouseEnter={(e) => {
            const s = e.target.getStage();
            if (s) s.container().style.cursor = 'pointer';
          }}
          onMouseLeave={(e) => {
            const s = e.target.getStage();
            if (s) s.container().style.cursor = '';
          }}
        />
      ))}
    </Group>
  );
};

export const WMRoomRenderer = React.memo(WMRoomRendererInner);

// ============================================================================
// Wall Drawing Preview (ghost line from start point to cursor)
// ============================================================================

interface WMWallPreviewProps {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** Snap point — highlight with a circle if snapped */
  snappedEnd?: { x: number; y: number } | null;
}

export const WMWallPreview: React.FC<WMWallPreviewProps> = ({
  startX,
  startY,
  endX,
  endY,
  snappedEnd,
}) => {
  // Show live length as the user draws
  const dx = endX - startX;
  const dy = endY - startY;
  const lenPx = Math.sqrt(dx * dx + dy * dy);

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
      {/* Start indicator */}
      <Circle
        x={startX}
        y={startY}
        radius={5}
        fill="#1890ff"
        opacity={0.8}
      />
      {/* End indicator */}
      <Circle
        x={endX}
        y={endY}
        radius={4}
        fill="#1890ff"
        opacity={0.6}
      />
      {/* Snap indicator at end */}
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
      {/* Length preview label */}
      {lenPx > 20 && (
        <Text
          x={(startX + endX) / 2}
          y={(startY + endY) / 2 - 16}
          text={`${lenPx.toFixed(0)}px`}
          fontSize={10}
          fill="#1890ff"
          fontFamily="monospace"
          offsetX={15}
        />
      )}
    </Group>
  );
};

export default WMWallRenderer;
