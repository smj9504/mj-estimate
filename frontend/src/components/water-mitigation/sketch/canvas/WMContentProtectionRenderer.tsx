/**
 * WMContentProtectionRenderer
 * Renders a content protection area as a hatched purple rectangle.
 * Used when contents (furniture, etc.) are covered with vinyl/plastic for protection.
 * Supports drag and rotation.
 */

import React, { useCallback } from 'react';
import { Group, Rect, Shape, Text } from 'react-konva';
import Konva from 'konva';
import { WMContentProtection } from '../../../../types/wmSketch';

export interface WMContentProtectionRendererProps {
  protection: WMContentProtection;
  isSelected: boolean;
  scalePixelsPerFoot: number;
  onSelect: (id: string) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}

/** Spacing between diagonal hatch lines in pixels */
const HATCH_SPACING = 12;

const WMContentProtectionRenderer: React.FC<WMContentProtectionRendererProps> = ({
  protection,
  isSelected,
  scalePixelsPerFoot,
  onSelect,
  onDragEnd,
}) => {
  const widthPx = protection.width_ft * scalePixelsPerFoot;
  const lengthPx = protection.length_ft * scalePixelsPerFoot;

  const labelText = `${Math.round(protection.calculated_sqft)} SF`;

  const handleClick = useCallback(() => {
    onSelect(protection.id);
  }, [protection.id, onSelect]);

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      onDragEnd(protection.id, e.target.x(), e.target.y());
    },
    [protection.id, onDragEnd],
  );

  const textPadX = 4;
  const fillColor = protection.color || '#8B5CF6';

  return (
    <Group
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
        width={widthPx}
        height={lengthPx}
        fill={fillColor}
        opacity={0.2}
        stroke={fillColor}
        strokeWidth={2}
        cornerRadius={2}
      />

      {/* Cross hatch pattern (X pattern for content protection) */}
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
          ctx.lineWidth = 1;

          // Diagonal lines (top-left to bottom-right)
          const totalDiag = widthPx + lengthPx;
          for (let d = -lengthPx; d < totalDiag; d += HATCH_SPACING) {
            ctx.beginPath();
            ctx.moveTo(d, 0);
            ctx.lineTo(d + lengthPx, lengthPx);
            ctx.stroke();
          }

          // Diagonal lines (top-right to bottom-left) for cross pattern
          for (let d = -lengthPx; d < totalDiag; d += HATCH_SPACING) {
            ctx.beginPath();
            ctx.moveTo(widthPx - d, 0);
            ctx.lineTo(widthPx - d - lengthPx, lengthPx);
            ctx.stroke();
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
            fill="#5B21B6"
            align="center"
            listening={false}
            wrap="none"
            ellipsis
          />
        </>
      )}
    </Group>
  );
};

export default React.memo(WMContentProtectionRenderer);
