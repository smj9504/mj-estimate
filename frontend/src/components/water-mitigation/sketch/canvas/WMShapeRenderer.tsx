/**
 * WMShapeRenderer
 * Renders a shape annotation (rectangle or ellipse) on the Konva canvas.
 * Used for doors, cabinets, fixtures, and other symbolic floor plan elements.
 * Supports drag, rotate, and resize via Transformer.
 *
 * "circle" shape_type renders as an Ellipse (supports independent width/height scaling).
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { Group, Rect, Ellipse, Text, Line, Arc, Transformer } from 'react-konva';
import Konva from 'konva';
import type { WMShapeAnnotation } from '../../../../types/wmSketch';

/** 15° snap angles for Shift+Rotate (0, 15, 30, …, 345) */
const ROTATION_SNAP_ANGLES = Array.from({ length: 24 }, (_, i) => i * 15);

export interface WMShapeRendererProps {
  shape: WMShapeAnnotation;
  isSelected: boolean;
  onSelect: (id: string, ctrlKey?: boolean) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onTransformEnd?: (id: string, width: number, height: number, rotation?: number) => void;
}

const WMShapeRenderer: React.FC<WMShapeRendererProps> = ({
  shape,
  isSelected,
  onSelect,
  onDragEnd,
  onTransformEnd,
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const shapeNodeRef = useRef<Konva.Rect | Konva.Ellipse>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  const { width, height } = shape;

  // Reset Konva node transform state when dimensions change from props
  useEffect(() => {
    const node = shapeNodeRef.current;
    if (!node) return;
    node.scaleX(1);
    node.scaleY(1);
    node.x(shape.shape_type === 'circle' ? width / 2 : 0);
    node.y(shape.shape_type === 'circle' ? height / 2 : 0);
    node.rotation(0);
    if (shape.shape_type === 'circle') {
      const ellipse = node as unknown as { radiusX(v: number): void; radiusY(v: number): void };
      ellipse.radiusX(width / 2);
      ellipse.radiusY(height / 2);
    } else {
      node.width(width);
      node.height(height);
    }
    node.getLayer()?.batchDraw();
  }, [width, height, shape.shape_type]);

  // Attach / detach transformer
  useEffect(() => {
    if (!transformerRef.current || !shapeNodeRef.current) return;
    if (isSelected) {
      transformerRef.current.nodes([shapeNodeRef.current]);
      transformerRef.current.getLayer()?.batchDraw();
    } else {
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  const handleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      onSelect(shape.id, e.evt.ctrlKey || e.evt.metaKey);
    },
    [shape.id, onSelect],
  );

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      onDragEnd(shape.id, e.target.x(), e.target.y());
    },
    [shape.id, onDragEnd],
  );

  // Shift-key snap: use Konva's native rotationSnaps for smooth 15° snapping.
  // We imperatively toggle rotationSnaps on the Transformer during transform
  // so that Konva handles the snap math internally (avoids handle/element desync).
  const handleTransform = useCallback((e: Konva.KonvaEventObject<Event>) => {
    const tr = transformerRef.current;
    if (!tr) return;
    const shiftHeld = !!(e.evt as MouseEvent)?.shiftKey;
    const currentSnaps = tr.rotationSnaps();
    if (shiftHeld && (!currentSnaps || currentSnaps.length === 0)) {
      tr.rotationSnaps(ROTATION_SNAP_ANGLES);
    } else if (!shiftHeld && currentSnaps && currentSnaps.length > 0) {
      tr.rotationSnaps([]);
    }
  }, []);

  const handleTransformEnd = useCallback(() => {
    if (!shapeNodeRef.current || !groupRef.current) return;
    // Clear rotation snaps so they don't persist into the next transform
    if (transformerRef.current) {
      transformerRef.current.rotationSnaps([]);
    }
    const node = shapeNodeRef.current;
    const group = groupRef.current;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    let newWidth: number;
    let newHeight: number;

    if (shape.shape_type === 'circle') {
      const rx = (node as unknown as { radiusX(): number }).radiusX() * scaleX;
      const ry = (node as unknown as { radiusY(): number }).radiusY() * scaleY;
      newWidth = Math.max(10, rx * 2);
      newHeight = Math.max(10, ry * 2);
    } else {
      newWidth = Math.max(10, node.width() * scaleX);
      newHeight = Math.max(10, node.height() * scaleY);
    }

    // === Center-stable transform transfer ===
    // Compute the visual center of the shape in parent coordinates BEFORE reset,
    // then reposition the group so the center stays at the same spot.
    const groupRot = group.rotation();
    const nodeRot = node.rotation();
    const nodeX = node.x();
    const nodeY = node.y();

    // Local center of the (scaled) shape within node-local coordinates
    let localCX: number, localCY: number;
    if (shape.shape_type === 'circle') {
      localCX = 0; // ellipse position IS the center
      localCY = 0;
    } else {
      localCX = (node.width() * scaleX) / 2;
      localCY = (node.height() * scaleY) / 2;
    }

    // Center in group-local coordinates (rotate local center by node rotation, add node offset)
    const nRad = (nodeRot * Math.PI) / 180;
    const centerInGroupX = nodeX + localCX * Math.cos(nRad) - localCY * Math.sin(nRad);
    const centerInGroupY = nodeY + localCX * Math.sin(nRad) + localCY * Math.cos(nRad);

    // Center in parent coordinates (rotate group-local center by group rotation, add group offset)
    const gRad = (groupRot * Math.PI) / 180;
    const centerParentX = group.x() + centerInGroupX * Math.cos(gRad) - centerInGroupY * Math.sin(gRad);
    const centerParentY = group.y() + centerInGroupX * Math.sin(gRad) + centerInGroupY * Math.cos(gRad);

    // Combined rotation
    const newRotation = groupRot + nodeRot;

    // Reset node transform to clean state
    node.rotation(0);
    node.scaleX(1);
    node.scaleY(1);
    if (shape.shape_type === 'circle') {
      const n = node as unknown as { radiusX(v: number): void; radiusY(v: number): void };
      n.radiusX(newWidth / 2);
      n.radiusY(newHeight / 2);
      node.x(newWidth / 2);
      node.y(newHeight / 2);
    } else {
      node.width(newWidth);
      node.height(newHeight);
      node.x(0);
      node.y(0);
    }

    // After reset, center in group-local is (newWidth/2, newHeight/2) for both types.
    // Position group so the center stays at the same parent-coordinate position.
    const newCX = newWidth / 2;
    const newCY = newHeight / 2;
    const newRad = (newRotation * Math.PI) / 180;
    group.x(centerParentX - (newCX * Math.cos(newRad) - newCY * Math.sin(newRad)));
    group.y(centerParentY - (newCX * Math.sin(newRad) + newCY * Math.cos(newRad)));
    group.rotation(newRotation);

    onDragEnd(shape.id, group.x(), group.y());
    onTransformEnd?.(shape.id, newWidth, newHeight, newRotation);
  }, [shape.id, shape.shape_type, onDragEnd, onTransformEnd]);

  const isDoor = shape.preset_id === 'door';
  const isStairs = shape.preset_id === 'stairs';

  // Generate stair tread lines: evenly spaced horizontal lines inside the rectangle
  const stairTreadLines = React.useMemo(() => {
    if (!isStairs) return null;
    // Standard tread depth ≈ 10 inches. Use height to calculate tread count.
    // Minimum 2 treads, use roughly 1/14th of height per tread (visually ~10" at 20px/ft scale).
    const treadCount = Math.max(2, Math.round(height / Math.max(width * 0.28, 8)));
    const step = height / treadCount;
    const lines: React.ReactNode[] = [];
    for (let i = 1; i < treadCount; i++) {
      const y = i * step;
      lines.push(
        <Line
          key={`tread-${i}`}
          points={[0, y, width, y]}
          stroke={shape.stroke_color}
          strokeWidth={1}
          opacity={0.6}
          listening={false}
        />,
      );
    }
    // Direction arrow: small triangle pointing "up" (toward the first tread)
    const arrowY = height * 0.5;
    const arrowSize = Math.min(width * 0.2, 8);
    lines.push(
      <Line
        key="arrow"
        points={[
          width / 2 - arrowSize, arrowY + arrowSize,
          width / 2,             arrowY - arrowSize,
          width / 2 + arrowSize, arrowY + arrowSize,
        ]}
        stroke={shape.stroke_color}
        strokeWidth={1.5}
        opacity={0.5}
        closed={false}
        listening={false}
      />,
    );
    return lines;
  }, [isStairs, width, height, shape.stroke_color]);

  const labelText = shape.label || '';
  const showLabel = labelText.length > 0 && width > 20 && height > 16;

  return (
    <>
      <Group
        ref={groupRef}
        x={shape.x}
        y={shape.y}
        rotation={shape.rotation}
        draggable
        onClick={handleClick}
        onTap={handleClick}
        onDragEnd={handleDragEnd}
      >
        {shape.shape_type === 'circle' ? (
          <>
            <Ellipse
              ref={shapeNodeRef as React.RefObject<Konva.Ellipse>}
              x={width / 2}
              y={height / 2}
              radiusX={width / 2}
              radiusY={height / 2}
              fill={shape.fill_color}
              opacity={shape.opacity}
              stroke={shape.stroke_color}
              strokeWidth={shape.stroke_width}
            />
            {/* Selection highlight */}
            {isSelected && (
              <Ellipse
                x={width / 2}
                y={height / 2}
                radiusX={width / 2 + 2}
                radiusY={height / 2 + 2}
                fill="transparent"
                stroke="#1890ff"
                strokeWidth={2}
                dash={[6, 3]}
                listening={false}
              />
            )}
            {/* Label */}
            {showLabel && (
              <Text
                x={0}
                y={height / 2 - 7}
                width={width}
                text={labelText}
                fontSize={11}
                fontStyle="bold"
                fontFamily="'Inter', 'Segoe UI', sans-serif"
                fill={shape.stroke_color}
                align="center"
                listening={false}
                wrap="none"
                ellipsis
              />
            )}
          </>
        ) : isDoor ? (
          (() => {
            const flipped = !!shape.flip_x;
            const r = Math.min(width, height);
            // Hinge position: left (default) or right (flipped)
            const hingeX = flipped ? width : 0;
            const tipX = flipped ? 0 : width;
            // Arc: pivots at hinge, sweeps 90° upward
            const arcRotation = flipped ? -180 : -90;
            return (
              <>
                {/* Invisible hit area for selection/drag */}
                <Rect
                  ref={shapeNodeRef as React.RefObject<Konva.Rect>}
                  width={width}
                  height={height}
                  fill="transparent"
                  opacity={0}
                  strokeWidth={0}
                />
                {/* Door panel line */}
                <Line
                  points={[hingeX, height, tipX, height]}
                  stroke={shape.stroke_color}
                  strokeWidth={Math.max(2, shape.stroke_width)}
                  listening={false}
                />
                {/* Quarter-circle arc (swing) */}
                <Arc
                  x={hingeX}
                  y={height}
                  innerRadius={0}
                  outerRadius={r}
                  angle={90}
                  rotation={arcRotation}
                  fill={shape.fill_color || 'transparent'}
                  opacity={shape.opacity * 0.3}
                  stroke={shape.stroke_color}
                  strokeWidth={Math.max(1, shape.stroke_width * 0.7)}
                  listening={false}
                />
                {/* Hinge dot */}
                <Line
                  points={[hingeX, height]}
                  stroke={shape.stroke_color}
                  strokeWidth={6}
                  lineCap="round"
                  listening={false}
                />
                {/* Selection highlight */}
                {isSelected && (
                  <Rect
                    width={width}
                    height={height}
                    fill="transparent"
                    stroke="#1890ff"
                    strokeWidth={2}
                    dash={[6, 3]}
                    listening={false}
                  />
                )}
              </>
            );
          })()
        ) : (
          <>
            <Rect
              ref={shapeNodeRef as React.RefObject<Konva.Rect>}
              width={width}
              height={height}
              fill={shape.fill_color}
              opacity={shape.opacity}
              stroke={shape.stroke_color}
              strokeWidth={shape.stroke_width}
              cornerRadius={2}
            />
            {/* Stair tread lines */}
            {stairTreadLines}
            {/* Selection highlight */}
            {isSelected && (
              <Rect
                width={width}
                height={height}
                fill="transparent"
                stroke="#1890ff"
                strokeWidth={2}
                dash={[6, 3]}
                listening={false}
              />
            )}
            {/* Label */}
            {showLabel && (
              <Text
                x={2}
                y={height / 2 - 7}
                width={width - 4}
                text={labelText}
                fontSize={11}
                fontStyle="bold"
                fontFamily="'Inter', 'Segoe UI', sans-serif"
                fill={shape.stroke_color}
                align="center"
                listening={false}
                wrap="none"
                ellipsis
              />
            )}
          </>
        )}
      </Group>

      <Transformer
        ref={transformerRef}
        rotateEnabled
        rotateAnchorOffset={20}
        borderStroke="#1890ff"
        borderDash={[3, 3]}
        anchorSize={8}
        anchorCornerRadius={2}
        anchorStroke="#1890ff"
        anchorFill="#ffffff"
        onTransform={handleTransform}
        onTransformEnd={handleTransformEnd}
        boundBoxFunc={(oldBox, newBox) => {
          if (newBox.width < 10 || newBox.height < 10) return oldBox;
          return newBox;
        }}
      />
    </>
  );
};

export default React.memo(WMShapeRenderer);
