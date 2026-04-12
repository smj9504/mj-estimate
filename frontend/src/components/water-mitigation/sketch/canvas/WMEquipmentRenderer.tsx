/**
 * WMEquipmentRenderer
 * Renders a single equipment placement icon on a Konva layer.
 *
 * Icon shapes:
 *   - air_mover    → filled circle (blue)  with "AM"
 *   - air_scrubber → filled triangle (dark blue) with "AS"
 *   - dehumidifier → filled rounded rect (green) with "DH"
 *
 * Usage:
 *   <WMEquipmentRenderer
 *     placement={placement}
 *     isSelected={selectedId === placement.id}
 *     onSelect={(id) => setSelectedId(id)}
 *     onDragEnd={(id, x, y) => updatePosition(id, x, y)}
 *   />
 */

import React, { useCallback } from 'react';
import { Group, Circle, Rect, Shape, Text } from 'react-konva';
import Konva from 'konva';
import { WMEquipmentPlacement, EQUIPMENT_CONFIG } from '../../../../types/wmSketch';

export interface WMEquipmentRendererProps {
  placement: WMEquipmentPlacement;
  isSelected: boolean;
  onSelect: (id: string, ctrlKey?: boolean) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}

/** Pixel radius / half-size for all equipment icons */
const ICON_RADIUS = 14;
/** Total hit area: selection ring is 4px outside the icon */
const SELECTION_RING_PADDING = 4;

// ---------------------------------------------------------------------------
// Sub-renderers
// ---------------------------------------------------------------------------

interface IconProps {
  color: string;
  abbreviation: string;
}

const AirMoverIcon: React.FC<IconProps> = ({ color, abbreviation }) => (
  <>
    <Circle
      radius={ICON_RADIUS}
      fill={color}
      stroke={color}
      strokeWidth={1.5}
    />
    <Text
      x={-ICON_RADIUS}
      y={-7}
      width={ICON_RADIUS * 2}
      text={abbreviation}
      fontSize={11}
      fontStyle="bold"
      fontFamily="'Inter', 'Segoe UI', sans-serif"
      fill="#ffffff"
      align="center"
      listening={false}
    />
  </>
);

const AirScrubberIcon: React.FC<IconProps> = ({ color, abbreviation }) => {
  const r = ICON_RADIUS;
  return (
    <>
      <Shape
        sceneFunc={(ctx, shape) => {
          ctx.beginPath();
          // Equilateral triangle centered at origin
          ctx.moveTo(0, -r);
          ctx.lineTo(r * 0.866, r * 0.5);
          ctx.lineTo(-r * 0.866, r * 0.5);
          ctx.closePath();
          ctx.fillStrokeShape(shape);
        }}
        fill={color}
        stroke={color}
        strokeWidth={1.5}
      />
      <Text
        x={-ICON_RADIUS}
        y={-3}
        width={ICON_RADIUS * 2}
        text={abbreviation}
        fontSize={11}
        fontStyle="bold"
        fontFamily="'Inter', 'Segoe UI', sans-serif"
        fill="#ffffff"
        align="center"
        listening={false}
      />
    </>
  );
};

const DehumidifierIcon: React.FC<IconProps> = ({ color, abbreviation }) => {
  const w = ICON_RADIUS * 2;
  const h = ICON_RADIUS * 2;
  return (
    <>
      <Rect
        x={-ICON_RADIUS}
        y={-ICON_RADIUS}
        width={w}
        height={h}
        cornerRadius={4}
        fill={color}
        stroke={color}
        strokeWidth={1.5}
      />
      <Text
        x={-ICON_RADIUS}
        y={-7}
        width={w}
        text={abbreviation}
        fontSize={11}
        fontStyle="bold"
        fontFamily="'Inter', 'Segoe UI', sans-serif"
        fill="#ffffff"
        align="center"
        listening={false}
      />
    </>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const WMEquipmentRenderer: React.FC<WMEquipmentRendererProps> = ({
  placement,
  isSelected,
  onSelect,
  onDragEnd,
}) => {
  const config = EQUIPMENT_CONFIG[placement.equipment_type];

  const handleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    onSelect(placement.id, e.evt.ctrlKey || e.evt.metaKey);
  }, [placement.id, onSelect]);

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      onDragEnd(placement.id, e.target.x(), e.target.y());
    },
    [placement.id, onDragEnd],
  );

  return (
    <Group
      x={placement.x}
      y={placement.y}
      draggable
      onClick={handleClick}
      onTap={handleClick}
      onDragEnd={handleDragEnd}
    >
      {/* Selection highlight ring */}
      {isSelected && (
        <Circle
          radius={ICON_RADIUS + SELECTION_RING_PADDING}
          fill="rgba(24,144,255,0.15)"
          stroke="#1890ff"
          strokeWidth={2}
          dash={[4, 3]}
          listening={false}
        />
      )}

      {/* Icon by shape type */}
      {config.shape === 'circle' && (
        <AirMoverIcon color={placement.color} abbreviation={config.abbreviation} />
      )}
      {config.shape === 'triangle' && (
        <AirScrubberIcon color={placement.color} abbreviation={config.abbreviation} />
      )}
      {config.shape === 'cylinder' && (
        <DehumidifierIcon color={placement.color} abbreviation={config.abbreviation} />
      )}

      {/* Optional custom label beneath icon */}
      {placement.label && (
        <Text
          x={-30}
          y={ICON_RADIUS + 3}
          width={60}
          text={placement.label}
          fontSize={9}
          fontFamily="'Inter', 'Segoe UI', sans-serif"
          fill="#333333"
          align="center"
          listening={false}
        />
      )}
    </Group>
  );
};

export default React.memo(WMEquipmentRenderer);
