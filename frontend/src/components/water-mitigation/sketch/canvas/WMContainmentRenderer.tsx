/**
 * WMContainmentRenderer
 * Renders a containment barrier as a thick dashed blue line on a Konva layer.
 * Represents a poly sheeting wall on the floor plan.
 *
 * When selected, shows draggable endpoint handles to adjust direction and length.
 * Supports selection, drag (whole line), and endpoint manipulation.
 */

import React, { useCallback } from 'react';
import { Group, Line, Circle, Rect, Text } from 'react-konva';
import Konva from 'konva';
import { WMContainmentZone } from '../../../../types/wmSketch';

export interface WMContainmentRendererProps {
  zone: WMContainmentZone;
  isSelected: boolean;
  scalePixelsPerFoot: number;
  onSelect: (id: string) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  /** Called when an endpoint handle is dragged — provides new length (ft) and rotation (deg) */
  onTransformEnd?: (id: string, lengthFt: number, rotationDeg: number) => void;
}

/** Containment lines use a blue palette */
const CONTAINMENT_STROKE = '#2196F3';
const CONTAINMENT_DASH: number[] = [10, 5];
const LINE_WIDTH = 4;
const HANDLE_RADIUS = 6;

const WMContainmentRenderer: React.FC<WMContainmentRendererProps> = ({
  zone,
  isSelected,
  scalePixelsPerFoot,
  onSelect,
  onDragEnd,
  onTransformEnd,
}) => {
  const lengthPx = zone.length_ft * scalePixelsPerFoot;

  const labelText = zone.label
    ? zone.label
    : `${zone.containment_type}${zone.calculated_sqft > 0 ? ` ${Math.round(zone.calculated_sqft)} SF` : ''}`;

  const handleClick = useCallback(() => {
    onSelect(zone.id);
  }, [zone.id, onSelect]);

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      onDragEnd(zone.id, e.target.x(), e.target.y());
    },
    [zone.id, onDragEnd],
  );

  // -----------------------------------------------------------------------
  // Endpoint handle drag — recalculates length and rotation from new endpoint
  // -----------------------------------------------------------------------
  const handleEndpointDrag = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      if (!onTransformEnd) return;

      const handle = e.target;
      // Handle position is in the Group's local coordinate space (rotated)
      // We need the stage-space position to recalculate angle
      const stage = handle.getStage();
      if (!stage) return;

      // Get the absolute position of the dragged handle
      const handleAbsPos = handle.getAbsolutePosition();
      // Get the start point (Group origin) absolute position
      const group = handle.getParent();
      if (!group) return;
      const startAbsPos = group.getAbsolutePosition();

      // Account for stage transform
      const stageTransform = stage.getAbsoluteTransform().copy().invert();
      const startCanvas = stageTransform.point(startAbsPos);
      const endCanvas = stageTransform.point(handleAbsPos);

      const dx = endCanvas.x - startCanvas.x;
      const dy = endCanvas.y - startCanvas.y;
      const newLengthPx = Math.sqrt(dx * dx + dy * dy);
      const newLengthFt = newLengthPx / scalePixelsPerFoot;
      const newAngleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

      // Reset handle position to the new calculated length along the line
      // (it will be re-rendered at the correct position)
      handle.position({ x: newLengthFt * scalePixelsPerFoot, y: 0 });

      onTransformEnd(zone.id, Math.max(0.5, newLengthFt), newAngleDeg);
    },
    [zone.id, scalePixelsPerFoot, onTransformEnd],
  );

  return (
    <Group
      x={zone.x}
      y={zone.y}
      rotation={zone.rotation}
      draggable
      onClick={handleClick}
      onTap={handleClick}
      onDragEnd={handleDragEnd}
    >
      {/* Containment barrier line */}
      <Line
        points={[0, 0, lengthPx, 0]}
        stroke={CONTAINMENT_STROKE}
        strokeWidth={LINE_WIDTH}
        dash={CONTAINMENT_DASH}
        lineCap="round"
      />

      {/* Hit area — wider invisible line for easier clicking */}
      <Line
        points={[0, 0, lengthPx, 0]}
        stroke="transparent"
        strokeWidth={16}
      />

      {/* Selection highlight */}
      {isSelected && (
        <Line
          points={[0, 0, lengthPx, 0]}
          stroke="#1890ff"
          strokeWidth={LINE_WIDTH + 4}
          dash={[4, 3]}
          lineCap="round"
          listening={false}
        />
      )}

      {/* Label (shown above the line) */}
      {lengthPx > 40 && (
        <>
          <Rect
            x={lengthPx / 2 - 50}
            y={-22}
            width={100}
            height={16}
            fill="rgba(255,255,255,0.9)"
            cornerRadius={2}
            listening={false}
          />
          <Text
            x={lengthPx / 2 - 50}
            y={-21}
            width={100}
            text={labelText}
            fontSize={10}
            fontFamily="'Inter', 'Segoe UI', sans-serif"
            fill={CONTAINMENT_STROKE}
            align="center"
            listening={false}
            wrap="none"
            ellipsis
          />
        </>
      )}

      {/* Endpoint handles (visible only when selected) */}
      {isSelected && (
        <>
          {/* Start point handle (fixed — moves the whole line via group drag) */}
          <Circle
            x={0}
            y={0}
            radius={HANDLE_RADIUS}
            fill="#ffffff"
            stroke={CONTAINMENT_STROKE}
            strokeWidth={2}
            listening={false}
          />

          {/* End point handle (draggable — adjusts length and direction) */}
          <Circle
            x={lengthPx}
            y={0}
            radius={HANDLE_RADIUS}
            fill={CONTAINMENT_STROKE}
            stroke="#ffffff"
            strokeWidth={2}
            draggable
            onDragEnd={handleEndpointDrag}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = 'grab';
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = '';
            }}
          />
        </>
      )}
    </Group>
  );
};

export default React.memo(WMContainmentRenderer);
