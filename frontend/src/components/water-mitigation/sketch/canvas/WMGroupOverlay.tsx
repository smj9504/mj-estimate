/**
 * WMGroupOverlay
 * Renders a bounding box, drag handle, and rotation handle around a group
 * of demolition zones that share the same group_id.
 * - Draggable: moves all group members together
 * - Rotation handle: rotates all group members around centroid
 */

import React, { useRef, useState, useCallback, useMemo } from 'react';
import { Group, Rect, Line, Circle, Text } from 'react-konva';
import Konva from 'konva';
import type { WMDemolitionZone } from '../../../../types/wmSketch';

export interface WMGroupOverlayProps {
  groupId: string;
  zones: WMDemolitionZone[];
  scalePixelsPerFoot: number;
  onMoveGroup: (groupId: string, dx: number, dy: number) => void;
  onRotateGroup: (groupId: string, pivotX: number, pivotY: number, deltaDeg: number) => void;
}

const ROTATE_OFFSET = 30;
const BBOX_PADDING = 12;

const WMGroupOverlay: React.FC<WMGroupOverlayProps> = ({
  groupId,
  zones,
  scalePixelsPerFoot,
  onMoveGroup,
  onRotateGroup,
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const [isRotating, setIsRotating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // Compute bounding box of all group zones (including line endpoints)
  const { bbox, centroid, totalLF } = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let total = 0;

    for (const z of zones) {
      const lengthPx = z.dimension1_ft * scalePixelsPerFoot;
      const rad = ((z.rotation || 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      // Start point
      const sx = z.x;
      const sy = z.y;
      // End point
      const ex = z.x + lengthPx * cos;
      const ey = z.y + lengthPx * sin;

      minX = Math.min(minX, sx, ex);
      minY = Math.min(minY, sy, ey);
      maxX = Math.max(maxX, sx, ex);
      maxY = Math.max(maxY, sy, ey);

      total += z.dimension1_ft;
    }

    return {
      bbox: {
        x: minX - BBOX_PADDING,
        y: minY - BBOX_PADDING,
        width: maxX - minX + BBOX_PADDING * 2,
        height: maxY - minY + BBOX_PADDING * 2,
      },
      centroid: {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
      },
      totalLF: Math.round(total * 100) / 100,
    };
  }, [zones, scalePixelsPerFoot]);

  // --- Drag: move entire group ---
  const handleDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    setIsDragging(true);
    dragStartRef.current = { x: e.target.x(), y: e.target.y() };
  }, []);

  const handleDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const dx = e.target.x() - dragStartRef.current.x;
    const dy = e.target.y() - dragStartRef.current.y;
    // Reset group position (we apply delta to zones, not to the overlay)
    e.target.x(dragStartRef.current.x);
    e.target.y(dragStartRef.current.y);
    setIsDragging(false);
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      onMoveGroup(groupId, dx, dy);
    }
  }, [groupId, onMoveGroup]);

  // --- Rotation handle ---
  const handleRotateDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
  }, []);

  const handleRotateDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    const handle = e.target;
    const stage = handle.getStage();
    if (!stage) { setIsRotating(false); return; }

    // Get handle absolute position in canvas coords
    const handleAbs = handle.getAbsolutePosition();
    const stageTransform = stage.getAbsoluteTransform().copy().invert();
    const handleCanvas = stageTransform.point(handleAbs);

    // Compute angle from centroid to handle position
    const dx = handleCanvas.x - centroid.x;
    const dy = handleCanvas.y - centroid.y;
    const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
    // The handle sits at top (270° / -90°), so delta = angle - (-90) = angle + 90
    const deltaDeg = angleDeg + 90;

    // Reset handle position
    handle.position({ x: centroid.x, y: bbox.y - ROTATE_OFFSET });

    setIsRotating(false);
    if (Math.abs(deltaDeg) > 0.5) {
      onRotateGroup(groupId, centroid.x, centroid.y, deltaDeg);
    }
  }, [groupId, centroid, bbox.y, onRotateGroup]);

  // Label
  const unit = zones[0]?.surface === 'wall' && zones[0]?.height_ft ? 'SF' : 'LF';
  const totalValue = unit === 'SF'
    ? zones.reduce((s, z) => s + z.calculated_sqft, 0)
    : totalLF;
  const labelText = `Group ${zones.length}x (${totalValue.toFixed(1)} ${unit})`;
  const charW = 7;
  const labelW = labelText.length * charW + 12;

  return (
    <Group
      ref={groupRef}
      x={0}
      y={0}
      draggable={!isRotating}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {/* Bounding box */}
      <Rect
        x={bbox.x}
        y={bbox.y}
        width={bbox.width}
        height={bbox.height}
        stroke="#1890ff"
        strokeWidth={1.5}
        dash={[6, 4]}
        fill="rgba(24, 144, 255, 0.04)"
        cornerRadius={4}
      />

      {/* Group label at top */}
      <Rect
        x={centroid.x - labelW / 2}
        y={bbox.y - 20}
        width={labelW}
        height={16}
        fill="#1890ff"
        cornerRadius={3}
        listening={false}
      />
      <Text
        x={centroid.x - labelW / 2}
        y={bbox.y - 19}
        width={labelW}
        text={labelText}
        fontSize={10}
        fontFamily="'Inter', 'Segoe UI', sans-serif"
        fill="#ffffff"
        fontStyle="bold"
        align="center"
        listening={false}
      />

      {/* Rotation stem line (centroid to handle) */}
      <Line
        points={[centroid.x, bbox.y, centroid.x, bbox.y - ROTATE_OFFSET]}
        stroke="#1890ff"
        strokeWidth={1}
        dash={[3, 2]}
        listening={false}
      />

      {/* Rotation handle */}
      <Circle
        x={centroid.x}
        y={bbox.y - ROTATE_OFFSET}
        radius={7}
        fill={isRotating ? '#1890ff' : '#ffffff'}
        stroke="#1890ff"
        strokeWidth={2}
        draggable
        onDragStart={(e) => {
          e.cancelBubble = true;
          setIsRotating(true);
        }}
        onDragMove={handleRotateDragMove}
        onDragEnd={handleRotateDragEnd}
        onMouseEnter={(e) => {
          const s = e.target.getStage();
          if (s) s.container().style.cursor = 'crosshair';
        }}
        onMouseLeave={(e) => {
          const s = e.target.getStage();
          if (s) s.container().style.cursor = '';
        }}
      />
      {/* Rotation icon */}
      <Text
        x={centroid.x - 5}
        y={bbox.y - ROTATE_OFFSET - 5}
        text="↻"
        fontSize={10}
        fill="#1890ff"
        listening={false}
      />

      {/* Move cursor indicator for the bounding box */}
      <Rect
        x={bbox.x}
        y={bbox.y}
        width={bbox.width}
        height={bbox.height}
        fill="transparent"
        onMouseEnter={(e) => {
          const s = e.target.getStage();
          if (s) s.container().style.cursor = isDragging ? 'grabbing' : 'grab';
        }}
        onMouseLeave={(e) => {
          const s = e.target.getStage();
          if (s) s.container().style.cursor = '';
        }}
      />
    </Group>
  );
};

export default React.memo(WMGroupOverlay);
