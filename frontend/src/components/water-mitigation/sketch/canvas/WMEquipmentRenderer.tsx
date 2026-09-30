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
import { DEFAULT_SCALE_PIXELS_PER_FOOT } from '../utils/wmDefaults';

export interface WMEquipmentRendererProps {
  placement: WMEquipmentPlacement;
  isSelected: boolean;
  onSelect: (id: string, ctrlKey?: boolean) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  /**
   * Sketch calibration (canvas pixels per real-world foot). Icons stay
   * symbolic — they are not drawn at the equipment's true footprint — but
   * they scale proportionally with it so they keep a constant apparent size
   * relative to the floor plan when the sketch is recalibrated.
   */
  scalePixelsPerFoot?: number;
}

/** Base pixel radius, calibrated against DEFAULT_SCALE_PIXELS_PER_FOOT */
const ICON_RADIUS = 14;
/** Total hit area: selection ring is 4px outside the icon */
const SELECTION_RING_PADDING = 4;

/**
 * Clamp the scale multiplier so icons stay legible at extreme calibrations:
 * never smaller than half nor larger than double the base size.
 */
const MIN_SCALE_FACTOR = 0.5;
const MAX_SCALE_FACTOR = 2;

function getScaleFactor(scalePixelsPerFoot?: number): number {
  if (!scalePixelsPerFoot || !Number.isFinite(scalePixelsPerFoot) || scalePixelsPerFoot <= 0) {
    return 1;
  }
  const raw = scalePixelsPerFoot / DEFAULT_SCALE_PIXELS_PER_FOOT;
  return Math.min(MAX_SCALE_FACTOR, Math.max(MIN_SCALE_FACTOR, raw));
}

// ---------------------------------------------------------------------------
// Sub-renderers
// ---------------------------------------------------------------------------

interface IconProps {
  color: string;
  abbreviation: string;
  /** Scaled half-size of the icon in canvas pixels */
  radius: number;
  /** Scaled label size in canvas pixels */
  fontSize: number;
}

const AirMoverIcon: React.FC<IconProps> = ({ color, abbreviation, radius, fontSize }) => (
  <>
    <Circle
      radius={radius}
      fill={color}
      stroke={color}
      strokeWidth={1.5}
    />
    <Text
      x={-radius}
      y={-fontSize / 2 - 1.5}
      width={radius * 2}
      text={abbreviation}
      fontSize={fontSize}
      fontStyle="bold"
      fontFamily="'Inter', 'Segoe UI', sans-serif"
      fill="#ffffff"
      align="center"
      listening={false}
    />
  </>
);

const AirScrubberIcon: React.FC<IconProps> = ({ color, abbreviation, radius, fontSize }) => {
  const r = radius;
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
        x={-r}
        y={-fontSize * 0.27}
        width={r * 2}
        text={abbreviation}
        fontSize={fontSize}
        fontStyle="bold"
        fontFamily="'Inter', 'Segoe UI', sans-serif"
        fill="#ffffff"
        align="center"
        listening={false}
      />
    </>
  );
};

const DehumidifierIcon: React.FC<IconProps> = ({ color, abbreviation, radius, fontSize }) => {
  const w = radius * 2;
  const h = radius * 2;
  return (
    <>
      <Rect
        x={-radius}
        y={-radius}
        width={w}
        height={h}
        cornerRadius={(4 * radius) / ICON_RADIUS}
        fill={color}
        stroke={color}
        strokeWidth={1.5}
      />
      <Text
        x={-radius}
        y={-fontSize / 2 - 1.5}
        width={w}
        text={abbreviation}
        fontSize={fontSize}
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
  scalePixelsPerFoot,
}) => {
  const config = EQUIPMENT_CONFIG[placement.equipment_type];

  const scaleFactor = getScaleFactor(scalePixelsPerFoot);
  const radius = ICON_RADIUS * scaleFactor;
  const iconFontSize = 11 * scaleFactor;
  const labelFontSize = 9 * scaleFactor;

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
          radius={radius + SELECTION_RING_PADDING * scaleFactor}
          fill="rgba(24,144,255,0.15)"
          stroke="#1890ff"
          strokeWidth={2}
          dash={[4, 3]}
          listening={false}
        />
      )}

      {/* Icon by shape type */}
      {config.shape === 'circle' && (
        <AirMoverIcon
          color={placement.color}
          abbreviation={config.abbreviation}
          radius={radius}
          fontSize={iconFontSize}
        />
      )}
      {config.shape === 'triangle' && (
        <AirScrubberIcon
          color={placement.color}
          abbreviation={config.abbreviation}
          radius={radius}
          fontSize={iconFontSize}
        />
      )}
      {config.shape === 'cylinder' && (
        <DehumidifierIcon
          color={placement.color}
          abbreviation={config.abbreviation}
          radius={radius}
          fontSize={iconFontSize}
        />
      )}

      {/* Optional custom label beneath icon */}
      {placement.label && (
        <Text
          x={-30 * scaleFactor}
          y={radius + 3 * scaleFactor}
          width={60 * scaleFactor}
          text={placement.label}
          fontSize={labelFontSize}
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
