/**
 * WMWallLineRenderer
 * Renders a wall demolition or baseboard/quarter-round zone as a line
 * on the Konva canvas. Walls are thicker solid lines; baseboards are
 * thinner dashed lines. Both support drag, endpoint manipulation,
 * and independent rotation via a dedicated rotation handle.
 *
 * - Wall (SF): drawn as a thick line; area = length_ft * height_ft
 * - Baseboard / Quarter Round (LF): drawn as a thinner dashed line; value = length in LF
 */

import React, { useCallback, useState, useRef, useMemo } from 'react';
import { Group, Line, Circle, Rect, Text } from 'react-konva';
import Konva from 'konva';
import { WMDemolitionZone, DemoMaterialType, DEFAULT_DEMO_MATERIAL_TYPES } from '../../../../types/wmSketch';

import { useTouchTargetSizes } from '../hooks/useWMResponsive';

export interface WMWallLineRendererProps {
  zone: WMDemolitionZone;
  isSelected: boolean;
  scalePixelsPerFoot: number;
  materialTypes: DemoMaterialType[];
  /** 1-based zone number shown on the canvas label */
  zoneNumber?: number;
  onSelect: (id: string, ctrlKey?: boolean) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onTransformEnd?: (id: string, lengthFt: number, rotationDeg: number) => void;
}

function getMaterial(zone: WMDemolitionZone, materialTypes: DemoMaterialType[]) {
  return (
    materialTypes.find((m) => m.id === zone.material_type) ??
    DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === zone.material_type)
  );
}

/** Rotation anchor offset above the line midpoint */
const ROTATE_ANCHOR_OFFSET = 24;
/** Insulation line offset above the main drywall line (pixels) */
const INSULATION_OFFSET = -10;
/** Insulation indicator color */
const INSULATION_COLOR = '#E91E63';
/** Crown molding line offset above the main drywall line (pixels) */
const CROWN_MOLDING_OFFSET = -18;
/** Crown molding indicator color */
const CROWN_MOLDING_COLOR = '#9370DB';
/** Baseboard line offset below the main drywall line (pixels) — tight to drywall */
const BASEBOARD_OFFSET = 5;
/** Baseboard/trim color by type */
const BASEBOARD_COLORS: Record<string, string> = {
  baseboard: '#DEB887',
  quarter_round: '#C4A882',
  baseboard_quarter_round: '#D2B48C',
};
/** Baseboard/trim label by type */
const BASEBOARD_LABELS: Record<string, string> = {
  baseboard: 'BB',
  quarter_round: 'QR',
  baseboard_quarter_round: 'BB+QR',
};

const WMWallLineRenderer: React.FC<WMWallLineRendererProps> = ({
  zone,
  isSelected,
  scalePixelsPerFoot,
  materialTypes,
  zoneNumber,
  onSelect,
  onDragEnd,
  onTransformEnd,
}) => {
  // Handles must be finger-sized on touch devices; `hitStrokeWidth`
  // widens the tap target without changing how the handle looks.
  const touchSizes = useTouchTargetSizes();
  const mat = getMaterial(zone, materialTypes);
  const isLF = mat?.unit === 'LF';
  const isWallSF = mat?.surface === 'wall' && !isLF;
  const showInsulation = isWallSF && zone.include_insulation;
  const showCrownMolding = isWallSF && !!zone.include_crown_molding;
  const showBaseboard = isWallSF && !!zone.baseboard_type;
  const baseboardColor = zone.baseboard_type ? BASEBOARD_COLORS[zone.baseboard_type] ?? '#DEB887' : '#DEB887';
  const baseboardLabel = zone.baseboard_type ? BASEBOARD_LABELS[zone.baseboard_type] ?? 'BB' : 'BB';
  const groupRef = useRef<Konva.Group>(null);

  // dimension1_ft stores the line length
  const lengthPx = zone.dimension1_ft * scalePixelsPerFoot;
  const color = zone.color || mat?.color || '#FF5722';

  // Live rotation state for preview while dragging rotation handle
  const [liveRotation, setLiveRotation] = useState<number | null>(null);
  const isRotating = liveRotation !== null;
  const displayRotation = liveRotation ?? zone.rotation;

  // Line styling
  const lineWidth = isLF ? 3 : 5;
  const dash = isLF ? [8, 4] : undefined;

  // Label — zone number + measurement
  let measureText = '';
  if (isLF) {
    measureText = `${zone.dimension1_ft.toFixed(2)} LF`;
  } else {
    const sqft = zone.calculated_sqft || 0;
    measureText = sqft > 0 ? `${sqft.toFixed(2)} SF` : `${zone.dimension1_ft.toFixed(2)}'`;
  }
  let labelText = zoneNumber != null ? `#${zoneNumber}  (${measureText})` : measureText;
  if (zone.label) labelText = zone.label;

  const pendingLabel = isLF ? 'Baseboard (set length)' : 'Wall (set length)';

  const handleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    onSelect(zone.id, e.evt.ctrlKey || e.evt.metaKey);
  }, [zone.id, onSelect]);

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      onDragEnd(zone.id, e.target.x(), e.target.y());
    },
    [zone.id, onDragEnd],
  );

  // Endpoint drag — changes both length and angle
  const handleEndpointDrag = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      if (!onTransformEnd) return;
      const handle = e.target;
      const stage = handle.getStage();
      if (!stage) return;

      const handleAbsPos = handle.getAbsolutePosition();
      const group = handle.getParent();
      if (!group) return;
      const startAbsPos = group.getAbsolutePosition();

      const stageTransform = stage.getAbsoluteTransform().copy().invert();
      const startCanvas = stageTransform.point(startAbsPos);
      const endCanvas = stageTransform.point(handleAbsPos);

      const dx = endCanvas.x - startCanvas.x;
      const dy = endCanvas.y - startCanvas.y;
      const newLengthPx = Math.sqrt(dx * dx + dy * dy);
      const newLengthFt = newLengthPx / scalePixelsPerFoot;
      const newAngleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

      handle.position({ x: newLengthFt * scalePixelsPerFoot, y: 0 });
      onTransformEnd(zone.id, Math.max(0.5, newLengthFt), newAngleDeg);
    },
    [zone.id, scalePixelsPerFoot, onTransformEnd],
  );

  // Rotation handle — changes only rotation, keeps length fixed
  const handleRotateDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
      const handle = e.target;
      const stage = handle.getStage();
      if (!stage) return;

      const group = handle.getParent();
      if (!group) return;

      // Get the group's origin in stage (canvas) coords
      const groupAbsPos = group.getAbsolutePosition();
      const stageTransform = stage.getAbsoluteTransform().copy().invert();
      const groupCanvas = stageTransform.point(groupAbsPos);

      // Get the handle's current position in stage (canvas) coords
      const handleAbsPos = handle.getAbsolutePosition();
      const handleCanvas = stageTransform.point(handleAbsPos);

      // Calculate angle from group origin to handle position
      const dx = handleCanvas.x - groupCanvas.x;
      const dy = handleCanvas.y - groupCanvas.y;
      const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

      // Adjust: the handle sits at midpoint offset above the line,
      // so we need to subtract 90 degrees (anchor is perpendicular)
      const rotationDeg = angleDeg + 90;

      setLiveRotation(rotationDeg);

      // Reset handle to its nominal local position (midpoint above line)
      // so it doesn't fly away from the group
      handle.position({ x: lengthPx / 2, y: -ROTATE_ANCHOR_OFFSET });
    },
    [lengthPx],
  );

  const handleRotateDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
      if (!onTransformEnd || liveRotation === null) {
        setLiveRotation(null);
        return;
      }
      onTransformEnd(zone.id, zone.dimension1_ft, liveRotation);
      setLiveRotation(null);
    },
    [zone.id, zone.dimension1_ft, liveRotation, onTransformEnd],
  );

  // Zero-length: show a small placeholder so multiple list-only zones are
  // visible and selectable (they would otherwise stack invisibly at 0 LF).
  if (lengthPx <= 0) {
    return (
      <Group
        x={zone.x}
        y={zone.y}
        rotation={displayRotation}
        draggable
        onClick={handleClick}
        onTap={handleClick}
        onDragEnd={handleDragEnd}
      >
        <Circle
          x={0}
          y={0}
          radius={14}
          fill="rgba(0,0,0,0.02)"
          stroke="transparent"
        />
        <Circle
          x={0}
          y={0}
          radius={6}
          stroke={color}
          strokeWidth={2}
          dash={isLF ? [3, 3] : undefined}
          listening={false}
        />
        <Text
          x={-70}
          y={-28}
          width={140}
          text={pendingLabel}
          fontSize={9}
          fontFamily="'Inter', 'Segoe UI', sans-serif"
          fill="#888"
          align="center"
          listening={false}
        />
        {isSelected && (
          <Circle
            x={0}
            y={0}
            radius={10}
            stroke="#1890ff"
            strokeWidth={2}
            dash={[4, 2]}
            listening={false}
          />
        )}
      </Group>
    );
  }

  return (
    <Group
      ref={groupRef}
      x={zone.x}
      y={zone.y}
      rotation={displayRotation}
      draggable={!isRotating}
      onClick={handleClick}
      onTap={handleClick}
      onDragEnd={handleDragEnd}
    >
      {/* Main line */}
      <Line
        points={[0, 0, lengthPx, 0]}
        stroke={color}
        strokeWidth={lineWidth}
        dash={dash}
        lineCap="round"
        opacity={0.8}
      />

      {/* Insulation indicator line (offset above the drywall line) */}
      {showInsulation && (
        <>
          <Line
            points={[0, INSULATION_OFFSET, lengthPx, INSULATION_OFFSET]}
            stroke={INSULATION_COLOR}
            strokeWidth={3}
            dash={[4, 6]}
            lineCap="round"
            opacity={0.8}
            listening={false}
          />
          {/* Zigzag pattern to represent insulation */}
          {(() => {
            const zigzagPoints: number[] = [];
            const step = 8;
            const amp = 4;
            for (let px = 0; px <= lengthPx; px += step) {
              const yOff = (Math.floor(px / step) % 2 === 0) ? -amp : amp;
              zigzagPoints.push(px, INSULATION_OFFSET + yOff);
            }
            return (
              <Line
                points={zigzagPoints}
                stroke={INSULATION_COLOR}
                strokeWidth={1.5}
                opacity={0.5}
                listening={false}
              />
            );
          })()}
          {/* Insulation label */}
          {lengthPx > 80 && (() => {
            const insText = `INS ${(zone.dimension1_ft * (zone.height_ft ?? 8)).toFixed(1)} SF`;
            const insLabelW = insText.length * 6 + 8;
            return (
              <>
                <Rect
                  x={lengthPx / 2 - insLabelW / 2}
                  y={INSULATION_OFFSET - 16}
                  width={insLabelW}
                  height={14}
                  fill="rgba(255,255,255,0.85)"
                  cornerRadius={2}
                  listening={false}
                />
                <Text
                  x={lengthPx / 2 - insLabelW / 2}
                  y={INSULATION_OFFSET - 15}
                  width={insLabelW}
                  text={insText}
                  fontSize={8}
                  fontFamily="'Inter', 'Segoe UI', sans-serif"
                  fill={INSULATION_COLOR}
                  fontStyle="bold"
                  align="center"
                  listening={false}
                />
              </>
            );
          })()}
        </>
      )}

      {/* Crown Molding indicator line (offset above insulation line) */}
      {showCrownMolding && (
        <>
          <Line
            points={[0, CROWN_MOLDING_OFFSET, lengthPx, CROWN_MOLDING_OFFSET]}
            stroke={CROWN_MOLDING_COLOR}
            strokeWidth={3}
            dash={[8, 4]}
            lineCap="round"
            opacity={0.85}
            listening={false}
          />
          {/* Crown Molding label */}
          {lengthPx > 60 && (
            <Text
              x={lengthPx / 2 - 30}
              y={CROWN_MOLDING_OFFSET - 12}
              width={60}
              text={`CM ${zone.dimension1_ft.toFixed(1)} LF`}
              fontSize={8}
              fontFamily="'Inter', 'Segoe UI', sans-serif"
              fill={CROWN_MOLDING_COLOR}
              fontStyle="bold"
              align="center"
              listening={false}
            />
          )}
        </>
      )}

      {/* Baseboard indicator line (offset below the drywall line) */}
      {showBaseboard && (
        <>
          <Line
            points={[0, BASEBOARD_OFFSET, lengthPx, BASEBOARD_OFFSET]}
            stroke={baseboardColor}
            strokeWidth={3}
            dash={[6, 3]}
            lineCap="round"
            opacity={0.85}
            listening={false}
          />
          {/* Baseboard label */}
          {lengthPx > 60 && (
            <Text
              x={lengthPx / 2 - 30}
              y={BASEBOARD_OFFSET + 4}
              width={60}
              text={`${baseboardLabel} ${zone.dimension1_ft.toFixed(1)} LF`}
              fontSize={8}
              fontFamily="'Inter', 'Segoe UI', sans-serif"
              fill={baseboardColor}
              fontStyle="bold"
              align="center"
              listening={false}
            />
          )}
        </>
      )}

      {/* Hit area — widened on touch so a fingertip can grab the line */}
      <Line
        points={[0, 0, lengthPx, 0]}
        stroke="transparent"
        strokeWidth={Math.max(
          touchSizes.hitStrokeWidth,
          (showBaseboard || showInsulation || showCrownMolding) ? 28 : 16
        )}
      />

      {/* Selection highlight */}
      {isSelected && (
        <Line
          points={[0, 0, lengthPx, 0]}
          stroke="#1890ff"
          strokeWidth={lineWidth + 4}
          dash={[4, 3]}
          lineCap="round"
          listening={false}
        />
      )}

      {/* Label */}
      {lengthPx > 40 && (() => {
        const charW = 7;
        const labelW = labelText.length * charW + 8;
        return (
        <>
          <Rect
            x={lengthPx / 2 - labelW / 2}
            y={-22}
            width={labelW}
            height={16}
            fill="rgba(255,255,255,0.9)"
            cornerRadius={2}
            listening={false}
          />
          <Text
            x={lengthPx / 2 - labelW / 2}
            y={-21}
            width={labelW}
            text={labelText}
            fontSize={10}
            fontFamily="'Inter', 'Segoe UI', sans-serif"
            fill={color}
            fontStyle="bold"
            align="center"
            listening={false}
            wrap="none"
            ellipsis
          />
        </>
        );
      })()}

      {/* Insulation indicator badge */}
      {zone.include_insulation && lengthPx > 50 && (
        <>
          <Rect
            x={lengthPx / 2 + 54}
            y={-22}
            width={28}
            height={14}
            fill="#E91E63"
            cornerRadius={3}
            listening={false}
          />
          <Text
            x={lengthPx / 2 + 54}
            y={-21}
            width={28}
            text="INS"
            fontSize={9}
            fontFamily="'Inter', 'Segoe UI', sans-serif"
            fill="#ffffff"
            fontStyle="bold"
            align="center"
            listening={false}
          />
        </>
      )}

      {/* Crown Molding indicator badge */}
      {showCrownMolding && lengthPx > 50 && (() => {
        const cmBadgeW = 24;
        const cmBadgeX = lengthPx / 2 + (zone.include_insulation ? 86 : 54);
        return (
        <>
          <Rect
            x={cmBadgeX}
            y={-22}
            width={cmBadgeW}
            height={14}
            fill={CROWN_MOLDING_COLOR}
            cornerRadius={3}
            listening={false}
          />
          <Text
            x={cmBadgeX}
            y={-21}
            width={cmBadgeW}
            text="CM"
            fontSize={9}
            fontFamily="'Inter', 'Segoe UI', sans-serif"
            fill="#ffffff"
            fontStyle="bold"
            align="center"
            listening={false}
          />
        </>
        );
      })()}

      {/* Baseboard indicator badge */}
      {showBaseboard && lengthPx > 50 && (() => {
        const bbBadgeW = baseboardLabel.length * 7 + 6;
        const bbBadgeX = lengthPx / 2 + (zone.include_insulation ? 86 : 54) + (showCrownMolding ? 28 : 0);
        return (
        <>
          <Rect
            x={bbBadgeX}
            y={-22}
            width={bbBadgeW}
            height={14}
            fill={baseboardColor}
            cornerRadius={3}
            listening={false}
          />
          <Text
            x={bbBadgeX}
            y={-21}
            width={bbBadgeW}
            text={baseboardLabel}
            fontSize={9}
            fontFamily="'Inter', 'Segoe UI', sans-serif"
            fill="#ffffff"
            fontStyle="bold"
            align="center"
            listening={false}
          />
        </>
        );
      })()}

      {/* Endpoint handles + Rotation handle (only when selected) */}
      {isSelected && (
        <>
          {/* Start endpoint (fixed) */}
          <Circle
            x={0}
            y={0}
            radius={5}
            fill="#ffffff"
            stroke={color}
            strokeWidth={2}
            listening={false}
          />

          {/* End endpoint (draggable — changes length + angle) */}
          <Circle
            x={lengthPx}
            y={0}
            radius={5}
            fill={color}
            stroke="#ffffff"
            strokeWidth={2}
            hitStrokeWidth={touchSizes.hitStrokeWidth}
            draggable
            onDragEnd={handleEndpointDrag}
            onMouseEnter={(e) => {
              const s = e.target.getStage();
              if (s) s.container().style.cursor = 'grab';
            }}
            onMouseLeave={(e) => {
              const s = e.target.getStage();
              if (s) s.container().style.cursor = '';
            }}
          />

          {/* Rotation handle — above the midpoint */}
          <Line
            points={[lengthPx / 2, 0, lengthPx / 2, -ROTATE_ANCHOR_OFFSET]}
            stroke="#1890ff"
            strokeWidth={1}
            dash={[3, 2]}
            listening={false}
          />
          <Circle
            x={lengthPx / 2}
            y={-ROTATE_ANCHOR_OFFSET}
            radius={5}
            fill={isRotating ? '#1890ff' : '#ffffff'}
            stroke="#1890ff"
            strokeWidth={2}
            hitStrokeWidth={touchSizes.hitStrokeWidth}
            draggable
            onDragStart={(e) => {
              e.cancelBubble = true;
              setLiveRotation(zone.rotation);
            }}
            onDragMove={handleRotateDragMove}
            onDragEnd={handleRotateDragEnd}
            onMouseEnter={(e) => {
              const s = e.target.getStage();
              if (s) s.container().style.cursor = 'crosshair';
            }}
            onMouseLeave={(e) => {
              const s = e.target.getStage();
              if (s) s.container().style.cursor = '';
            }}
          />
          {/* Rotation icon (↻) on the handle */}
          <Text
            x={lengthPx / 2 - 4}
            y={-ROTATE_ANCHOR_OFFSET - 4}
            text="↻"
            fontSize={8}
            fill="#1890ff"
            listening={false}
          />
        </>
      )}
    </Group>
  );
};

export default React.memo(WMWallLineRenderer);
