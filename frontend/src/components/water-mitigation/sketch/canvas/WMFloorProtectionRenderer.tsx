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

import React, { useCallback } from 'react';
import { Group, Rect, Shape, Text } from 'react-konva';
import Konva from 'konva';
import { WMFloorProtection } from '../../../../types/wmSketch';

export interface WMFloorProtectionRendererProps {
  protection: WMFloorProtection;
  isSelected: boolean;
  scalePixelsPerFoot: number;
  onSelect: (id: string) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}

/** Spacing between diagonal hatch lines in pixels */
const HATCH_SPACING = 10;

const WMFloorProtectionRenderer: React.FC<WMFloorProtectionRendererProps> = ({
  protection,
  isSelected,
  scalePixelsPerFoot,
  onSelect,
  onDragEnd,
}) => {
  const widthPx = protection.paper_width_ft * scalePixelsPerFoot;
  const lengthPx = protection.length_ft * scalePixelsPerFoot;

  const labelText = `${protection.length_ft}'${protection.calculated_sqft > 0 ? ` (${Math.round(protection.calculated_sqft)} SF)` : ''}`;

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
        fill={protection.color || '#FFD700'}
        opacity={0.3}
        stroke={protection.color || '#FFD700'}
        strokeWidth={2}
        cornerRadius={2}
      />

      {/* Diagonal hatch pattern */}
      <Shape
        width={widthPx}
        height={lengthPx}
        sceneFunc={(ctx, shape) => {
          ctx.save();
          // Clip to the rectangle bounds
          ctx.beginPath();
          ctx.rect(0, 0, widthPx, lengthPx);
          ctx.clip();

          ctx.strokeStyle = protection.color || '#FFD700';
          ctx.globalAlpha = 0.45;
          ctx.lineWidth = 1;

          // Draw diagonal lines from top-left to bottom-right
          const totalDiag = widthPx + lengthPx;
          for (let d = -lengthPx; d < totalDiag; d += HATCH_SPACING) {
            ctx.beginPath();
            ctx.moveTo(d, 0);
            ctx.lineTo(d + lengthPx, lengthPx);
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
            fill="#7a6000"
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

export default React.memo(WMFloorProtectionRenderer);
