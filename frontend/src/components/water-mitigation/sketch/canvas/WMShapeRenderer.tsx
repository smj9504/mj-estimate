/**
 * WMShapeRenderer
 * Renders a shape annotation (rectangle or ellipse) on the Konva canvas.
 * Used for doors, cabinets, fixtures, and other symbolic floor plan elements.
 * Supports drag, rotate, and resize via Transformer.
 *
 * "circle" shape_type renders as an Ellipse (supports independent width/height scaling).
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { Group, Rect, Ellipse, Text, Transformer } from 'react-konva';
import Konva from 'konva';
import type { WMShapeAnnotation } from '../../../../types/wmSketch';

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

  const handleTransformEnd = useCallback(() => {
    if (!shapeNodeRef.current || !groupRef.current) return;
    const node = shapeNodeRef.current;
    const group = groupRef.current;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    let newWidth: number;
    let newHeight: number;

    if (shape.shape_type === 'circle') {
      // Ellipse: compute new radii from scale
      const rx = (node as unknown as { radiusX(): number }).radiusX() * scaleX;
      const ry = (node as unknown as { radiusY(): number }).radiusY() * scaleY;
      newWidth = Math.max(10, rx * 2);
      newHeight = Math.max(10, ry * 2);
    } else {
      newWidth = Math.max(10, node.width() * scaleX);
      newHeight = Math.max(10, node.height() * scaleY);
    }

    // Transfer node rotation to group
    const nodeRotation = node.rotation();
    if (nodeRotation !== 0) {
      group.rotation(group.rotation() + nodeRotation);
      node.rotation(0);
    }

    // Transfer node position offset to group
    const nodeX = node.x();
    const nodeY = node.y();
    if (nodeX !== 0 || nodeY !== 0) {
      const rad = ((group.rotation() || 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      group.x(group.x() + nodeX * cos - nodeY * sin);
      group.y(group.y() + nodeX * sin + nodeY * cos);
      node.x(0);
      node.y(0);
    }

    node.scaleX(1);
    node.scaleY(1);

    if (shape.shape_type === 'circle') {
      const n = node as unknown as { radiusX(v: number): void; radiusY(v: number): void };
      n.radiusX(newWidth / 2);
      n.radiusY(newHeight / 2);
    } else {
      node.width(newWidth);
      node.height(newHeight);
    }

    const newRotation = group.rotation();
    onDragEnd(shape.id, group.x(), group.y());
    onTransformEnd?.(shape.id, newWidth, newHeight, newRotation);
  }, [shape.id, shape.shape_type, onDragEnd, onTransformEnd]);

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
