/**
 * WMContentManipulationRenderer
 * Renders a content manipulation area as a dashed orange rectangle with arrow pattern.
 * Used when room contents need to be moved for demolition or equipment setup.
 * Supports drag and rotation.
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { Group, Rect, Shape, Text, Transformer } from 'react-konva';
import Konva from 'konva';
import { WMContentManipulation } from '../../../../types/wmSketch';

export interface WMContentManipulationRendererProps {
  manipulation: WMContentManipulation;
  isSelected: boolean;
  scalePixelsPerFoot: number;
  onSelect: (id: string, ctrlKey?: boolean) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onTransformEnd?: (id: string, widthFt: number, heightFt: number, rotation?: number) => void;
}

/** Spacing between arrow pattern lines in pixels */
const ARROW_SPACING = 18;

const WMContentManipulationRenderer: React.FC<WMContentManipulationRendererProps> = ({
  manipulation,
  isSelected,
  scalePixelsPerFoot,
  onSelect,
  onDragEnd,
  onTransformEnd,
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const rectRef = useRef<Konva.Rect>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  const widthPx = manipulation.width_ft * scalePixelsPerFoot;
  const lengthPx = manipulation.length_ft * scalePixelsPerFoot;

  const labelText = `${Math.round(manipulation.calculated_sqft)} SF`;

  // Reset Konva node transform state when dimensions change from props
  useEffect(() => {
    const node = rectRef.current;
    if (!node) return;
    node.scaleX(1);
    node.scaleY(1);
    node.x(0);
    node.y(0);
    node.rotation(0);
    node.width(widthPx);
    node.height(lengthPx);
    node.getLayer()?.batchDraw();
  }, [widthPx, lengthPx]);

  // Attach / detach transformer
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
    onSelect(manipulation.id, e.evt.ctrlKey || e.evt.metaKey);
  }, [manipulation.id, onSelect]);

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      onDragEnd(manipulation.id, e.target.x(), e.target.y());
    },
    [manipulation.id, onDragEnd],
  );

  // Shift-key snap: snap rotation to 15 deg increments during transform
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

    const newWidthPx = Math.max(10, node.width() * scaleX);
    const newHeightPx = Math.max(10, node.height() * scaleY);

    // Transfer Rect rotation -> Group
    const nodeRotation = node.rotation();
    if (nodeRotation !== 0) {
      group.rotation(group.rotation() + nodeRotation);
      node.rotation(0);
    }

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

    node.scaleX(1);
    node.scaleY(1);
    node.width(newWidthPx);
    node.height(newHeightPx);

    const newWidthFt = newWidthPx / scalePixelsPerFoot;
    const newHeightFt = newHeightPx / scalePixelsPerFoot;
    const newRotation = group.rotation();

    onDragEnd(manipulation.id, group.x(), group.y());
    onTransformEnd?.(manipulation.id, newWidthFt, newHeightFt, newRotation);
  }, [manipulation.id, scalePixelsPerFoot, onDragEnd, onTransformEnd]);

  const textPadX = 4;
  const fillColor = manipulation.color || '#F97316';

  return (
    <>
    <Group
      ref={groupRef}
      x={manipulation.x}
      y={manipulation.y}
      rotation={manipulation.rotation}
      draggable
      onClick={handleClick}
      onTap={handleClick}
      onDragEnd={handleDragEnd}
    >
      {/* Base fill */}
      <Rect
        ref={rectRef}
        width={widthPx}
        height={lengthPx}
        fill={fillColor}
        opacity={0.15}
        stroke={fillColor}
        strokeWidth={2}
        dash={[8, 4]}
        cornerRadius={2}
      />

      {/* Arrow pattern (→ arrows to indicate movement) */}
      <Shape
        width={widthPx}
        height={lengthPx}
        sceneFunc={(ctx, shape) => {
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, widthPx, lengthPx);
          ctx.clip();

          ctx.strokeStyle = fillColor;
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 1.5;

          // Draw right-pointing arrows in a grid
          const arrowLen = 10;
          const headLen = 4;
          for (let y = ARROW_SPACING / 2; y < lengthPx; y += ARROW_SPACING) {
            for (let x = ARROW_SPACING / 2; x < widthPx; x += ARROW_SPACING * 1.5) {
              ctx.beginPath();
              ctx.moveTo(x, y);
              ctx.lineTo(x + arrowLen, y);
              // arrow head
              ctx.moveTo(x + arrowLen - headLen, y - headLen / 1.5);
              ctx.lineTo(x + arrowLen, y);
              ctx.lineTo(x + arrowLen - headLen, y + headLen / 1.5);
              ctx.stroke();
            }
          }

          ctx.restore();
          ctx.fillStrokeShape(shape);
        }}
        fill="transparent"
        stroke="transparent"
        listening={false}
      />

      {/* Selection highlight */}
      {isSelected && (
        <Rect
          width={widthPx}
          height={lengthPx}
          fill="transparent"
          stroke="#1890ff"
          strokeWidth={2}
          dash={[6, 3]}
          listening={false}
        />
      )}

      {/* Label */}
      {widthPx > 30 && lengthPx > 20 && (
        <>
          <Rect
            x={textPadX}
            y={lengthPx / 2 - 9}
            width={widthPx - textPadX * 2}
            height={18}
            fill="rgba(255,255,255,0.85)"
            cornerRadius={2}
            listening={false}
          />
          <Text
            x={textPadX}
            y={lengthPx / 2 - 8}
            width={widthPx - textPadX * 2}
            text={labelText}
            fontSize={11}
            fontFamily="'Inter', 'Segoe UI', sans-serif"
            fill="#C2410C"
            align="center"
            listening={false}
            wrap="none"
            ellipsis
          />
        </>
      )}
    </Group>

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

export default React.memo(WMContentManipulationRenderer);
