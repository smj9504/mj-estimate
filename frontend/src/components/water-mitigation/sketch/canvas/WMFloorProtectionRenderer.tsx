/**
 * WMFloorProtectionRenderer
 * Renders a floor protection strip as a hatched yellow rectangle.
 * Width is fixed to paperWidthFt * scale; length is variable.
 * Supports drag and rotation.
 *
 * Usage:
 *   <WMFloorProtectionRenderer
 *     protection={protection}
 *     isSelected={selectedId === protection.id}
 *     scalePixelsPerFoot={20}
 *     onSelect={(id) => setSelectedId(id)}
 *     onDragEnd={(id, x, y) => updatePosition(id, x, y)}
 *   />
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { Group, Rect, Shape, Text, Transformer } from 'react-konva';
import Konva from 'konva';
import { WMFloorProtection } from '../../../../types/wmSketch';

export interface WMFloorProtectionRendererProps {
  protection: WMFloorProtection;
  isSelected: boolean;
  scalePixelsPerFoot: number;
  onSelect: (id: string, ctrlKey?: boolean) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onTransformEnd?: (id: string, widthFt: number, heightFt: number, rotation?: number) => void;
}

/** Spacing between diagonal hatch lines in pixels */
const HATCH_SPACING = 10;

/** Default color for stair floor protection (orange) */
const STAIR_FLOOR_PROTECTION_COLOR = '#FF8C00';

/** Spacing between stair-step lines in pixels */
const STAIR_STEP_SPACING = 12;

const WMFloorProtectionRenderer: React.FC<WMFloorProtectionRendererProps> = ({
  protection,
  isSelected,
  scalePixelsPerFoot,
  onSelect,
  onDragEnd,
  onTransformEnd,
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const rectRef = useRef<Konva.Rect>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  const widthPx = protection.paper_width_ft * scalePixelsPerFoot;
  const lengthPx = protection.length_ft * scalePixelsPerFoot;
  const isStair = protection.is_stair ?? false;
  const effectiveColor = isStair
    ? (protection.color !== '#FFD700' ? protection.color : STAIR_FLOOR_PROTECTION_COLOR)
    : (protection.color || '#FFD700');

  const labelText = isStair
    ? `STR ${protection.calculated_sqft > 0 ? `${protection.calculated_sqft.toFixed(2)} SF` : `${protection.length_ft.toFixed(2)}'`}`
    : `${protection.calculated_sqft > 0 ? `${protection.calculated_sqft.toFixed(2)} SF` : `${protection.length_ft.toFixed(2)}'`}`;

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
    onSelect(protection.id, e.evt.ctrlKey || e.evt.metaKey);
  }, [protection.id, onSelect]);

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      onDragEnd(protection.id, e.target.x(), e.target.y());
    },
    [protection.id, onDragEnd],
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

    const newWidthPx = Math.max(10, node.width() * scaleX);
    const newHeightPx = Math.max(10, node.height() * scaleY);

    // Transfer Rect rotation → Group (Transformer sets rotation on the Rect)
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

    onDragEnd(protection.id, group.x(), group.y());
    onTransformEnd?.(protection.id, newWidthFt, newHeightFt, newRotation);
  }, [protection.id, scalePixelsPerFoot, onDragEnd, onTransformEnd]);

  const textPadX = 4;

  return (
    <>
    <Group
      ref={groupRef}
      x={protection.x}
      y={protection.y}
      rotation={protection.rotation}
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
        fill={effectiveColor}
        opacity={0.3}
        stroke={effectiveColor}
        strokeWidth={isStair ? 2.5 : 2}
        cornerRadius={2}
      />

      {/* Hatch pattern: diagonal for regular, stair-step for stairs */}
      <Shape
        width={widthPx}
        height={lengthPx}
        sceneFunc={(ctx, shape) => {
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, widthPx, lengthPx);
          ctx.clip();

          ctx.strokeStyle = effectiveColor;
          ctx.globalAlpha = 0.45;
          ctx.lineWidth = 1;

          if (isStair) {
            // Stair-step pattern: horizontal lines with alternating indents
            const stepH = STAIR_STEP_SPACING;
            const indent = widthPx * 0.15;
            ctx.lineWidth = 1.5;
            for (let yPos = stepH; yPos < lengthPx; yPos += stepH) {
              const stepIndex = Math.floor(yPos / stepH);
              const xOffset = (stepIndex % 2 === 0) ? 0 : indent;
              ctx.beginPath();
              ctx.moveTo(xOffset, yPos);
              ctx.lineTo(widthPx - indent + xOffset, yPos);
              ctx.stroke();
              // Vertical risers
              if (yPos + stepH < lengthPx) {
                const nextOffset = ((stepIndex + 1) % 2 === 0) ? 0 : indent;
                ctx.beginPath();
                ctx.moveTo(widthPx - indent + xOffset, yPos);
                ctx.lineTo(widthPx - indent + nextOffset, yPos);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(xOffset, yPos);
                ctx.lineTo(nextOffset, yPos + stepH);
                ctx.stroke();
              }
            }
          } else {
            // Regular diagonal hatch
            const totalDiag = widthPx + lengthPx;
            for (let d = -lengthPx; d < totalDiag; d += HATCH_SPACING) {
              ctx.beginPath();
              ctx.moveTo(d, 0);
              ctx.lineTo(d + lengthPx, lengthPx);
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

      {/* Length label */}
      {widthPx > 24 && lengthPx > 18 && (
        <>
          <Rect
            x={textPadX}
            y={lengthPx / 2 - 9}
            width={widthPx - textPadX * 2}
            height={18}
            fill="rgba(255,255,255,0.8)"
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
            fill={isStair ? '#8B4500' : '#7a6000'}
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

export default React.memo(WMFloorProtectionRenderer);
