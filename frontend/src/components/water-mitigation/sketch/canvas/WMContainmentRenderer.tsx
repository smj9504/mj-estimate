/**
 * WMContainmentRenderer
 * Renders a containment zone as a dashed blue rectangle on a Konva layer.
 * Supports selection, drag, and transformer-based resize.
 *
 * Usage:
 *   <WMContainmentRenderer
 *     zone={zone}
 *     isSelected={selectedId === zone.id}
 *     scalePixelsPerFoot={20}
 *     onSelect={(id) => setSelectedId(id)}
 *     onDragEnd={(id, x, y) => updatePosition(id, x, y)}
 *   />
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { Group, Rect, Text, Transformer } from 'react-konva';
import Konva from 'konva';
import { WMContainmentZone } from '../../../../types/wmSketch';

export interface WMContainmentRendererProps {
  zone: WMContainmentZone;
  isSelected: boolean;
  scalePixelsPerFoot: number;
  onSelect: (id: string) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onTransformEnd?: (id: string, widthFt: number, heightFt: number) => void;
}

/** Containment zones use a fixed blue palette */
const CONTAINMENT_FILL = 'rgba(33, 150, 243, 0.08)';
const CONTAINMENT_STROKE = '#2196F3';
const CONTAINMENT_DASH: number[] = [8, 4];

const DEFAULT_SIZE_PX = 80;

const WMContainmentRenderer: React.FC<WMContainmentRendererProps> = ({
  zone,
  isSelected,
  scalePixelsPerFoot,
  onSelect,
  onDragEnd,
  onTransformEnd,
}) => {
  const rectRef = useRef<Konva.Rect>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  const widthPx =
    zone.width_ft !== undefined && zone.width_ft > 0
      ? zone.width_ft * scalePixelsPerFoot
      : DEFAULT_SIZE_PX;
  const heightPx =
    zone.height_ft !== undefined && zone.height_ft > 0
      ? zone.height_ft * scalePixelsPerFoot
      : DEFAULT_SIZE_PX;

  const labelText = zone.label
    ? zone.label
    : `${zone.containment_type}${zone.calculated_sqft > 0 ? ` - ${Math.round(zone.calculated_sqft)} SF` : ''}`;

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

  const handleClick = useCallback(() => {
    onSelect(zone.id);
  }, [zone.id, onSelect]);

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      onDragEnd(zone.id, e.target.x(), e.target.y());
    },
    [zone.id, onDragEnd],
  );

  const handleTransformEnd = useCallback(() => {
    if (!rectRef.current) return;
    const node = rectRef.current;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);

    const newWidthPx = Math.max(20, node.width() * scaleX);
    const newHeightPx = Math.max(20, node.height() * scaleY);

    onTransformEnd?.(
      zone.id,
      newWidthPx / scalePixelsPerFoot,
      newHeightPx / scalePixelsPerFoot,
    );
  }, [zone.id, scalePixelsPerFoot, onTransformEnd]);

  const textPadX = 6;

  return (
    <>
      <Group
        x={zone.x}
        y={zone.y}
        draggable
        onClick={handleClick}
        onTap={handleClick}
        onDragEnd={handleDragEnd}
      >
        {/* Containment zone fill */}
        <Rect
          ref={rectRef}
          width={widthPx}
          height={heightPx}
          fill={CONTAINMENT_FILL}
          stroke={CONTAINMENT_STROKE}
          strokeWidth={2}
          dash={CONTAINMENT_DASH}
          cornerRadius={2}
        />

        {/* Selection highlight */}
        {isSelected && (
          <Rect
            width={widthPx}
            height={heightPx}
            fill="transparent"
            stroke="#1890ff"
            strokeWidth={2}
            dash={[4, 3]}
            listening={false}
          />
        )}

        {/* Label */}
        {widthPx > 30 && heightPx > 20 && (
          <>
            <Rect
              x={textPadX}
              y={heightPx / 2 - 9}
              width={widthPx - textPadX * 2}
              height={18}
              fill="rgba(255,255,255,0.8)"
              cornerRadius={2}
              listening={false}
            />
            <Text
              x={textPadX}
              y={heightPx / 2 - 8}
              width={widthPx - textPadX * 2}
              text={labelText}
              fontSize={11}
              fontFamily="'Inter', 'Segoe UI', sans-serif"
              fill={CONTAINMENT_STROKE}
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
        rotateEnabled={false}
        borderStroke="#2196F3"
        borderDash={[3, 3]}
        anchorSize={8}
        anchorCornerRadius={2}
        anchorStroke="#2196F3"
        anchorFill="#ffffff"
        onTransformEnd={handleTransformEnd}
        boundBoxFunc={(oldBox, newBox) => {
          if (newBox.width < 20 || newBox.height < 20) return oldBox;
          return newBox;
        }}
      />
    </>
  );
};

export default React.memo(WMContainmentRenderer);
