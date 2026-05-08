/**
 * WMDemolitionPolygonRenderer
 * Renders a single polygon demolition zone on a Konva layer.
 * Used for irregular shapes (ceiling, floor) that cannot be represented as rectangles.
 *
 * The polygon is rendered as a closed Konva Line with vertex handles for editing.
 * Supports selection highlight, drag-to-move, and live vertex dragging with
 * real-time polygon shape update and area recalculation.
 */

import React, { useRef, useState, useCallback, useMemo } from 'react';
import { Group, Line, Circle, Text, Rect } from 'react-konva';
import Konva from 'konva';
import type { WMDemolitionZone, DemoStrokeStyle } from '../../../../types/wmSketch';

export interface WMDemolitionPolygonRendererProps {
  zone: WMDemolitionZone;
  isSelected: boolean;
  scalePixelsPerFoot: number;
  zoneNumber?: number;
  onSelect: (id: string, ctrlKey?: boolean) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onPolygonPointsChanged?: (id: string, points: { x: number; y: number }[]) => void;
}

const NEEDS_DIMS_COLOR = '#fa8c16';

/** Shoelace area in square feet (inline to avoid import for live preview) */
function polygonAreaSqft(pts: { x: number; y: number }[], scale: number): number {
  if (pts.length < 3 || scale <= 0) return 0;
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.round(Math.abs(area / 2) / (scale * scale) * 100) / 100;
}

const WMDemolitionPolygonRenderer: React.FC<WMDemolitionPolygonRendererProps> = ({
  zone,
  isSelected,
  scalePixelsPerFoot,
  zoneNumber,
  onSelect,
  onDragEnd,
  onPolygonPointsChanged,
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const lineRef = useRef<Konva.Line>(null);
  const selLineRef = useRef<Konva.Line>(null);

  const basePoints = zone.polygon_points ?? [];

  // Local state for live dragging preview
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [livePoints, setLivePoints] = useState<{ x: number; y: number }[] | null>(null);

  // Use live points during drag, otherwise use zone data
  const points = livePoints ?? basePoints;

  // Flatten points for Konva Line: [x0, y0, x1, y1, ...]
  const flatPoints = useMemo(() => {
    const arr: number[] = [];
    for (const p of points) {
      arr.push(p.x, p.y);
    }
    return arr;
  }, [points]);

  // Bounding box for label positioning
  const bbox = useMemo(() => {
    if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, cx: 0, cy: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }, [points]);

  // Live area calculation during vertex drag
  const liveArea = useMemo(() => {
    if (livePoints) return polygonAreaSqft(livePoints, scalePixelsPerFoot);
    return zone.calculated_sqft;
  }, [livePoints, zone.calculated_sqft, scalePixelsPerFoot]);

  const hasDimensions = liveArea > 0;

  const handleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    onSelect(zone.id, e.evt.ctrlKey || e.evt.metaKey);
  }, [zone.id, onSelect]);

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      onDragEnd(zone.id, e.target.x(), e.target.y());
    },
    [zone.id, onDragEnd],
  );

  // Live vertex drag — update polygon shape in real-time
  const handleVertexDragMove = useCallback(
    (index: number, e: Konva.KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true; // prevent group drag
      const newPoints = basePoints.map((p, i) =>
        i === index ? { x: e.target.x(), y: e.target.y() } : p
      );
      setLivePoints(newPoints);
      setDraggingIndex(index);
    },
    [basePoints],
  );

  // Finalize vertex position — commit to state
  const handleVertexDragEnd = useCallback(
    (index: number, e: Konva.KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
      if (!onPolygonPointsChanged) return;
      const newPoints = basePoints.map((p, i) =>
        i === index ? { x: e.target.x(), y: e.target.y() } : p
      );
      setLivePoints(null);
      setDraggingIndex(null);
      onPolygonPointsChanged(zone.id, newPoints);
    },
    [zone.id, basePoints, onPolygonPointsChanged],
  );

  const customFillOpacity = zone.fill_opacity;
  const effectiveFillOpacity = customFillOpacity != null ? customFillOpacity : (hasDimensions ? 0.35 : 0.2);
  const strokeColor = hasDimensions ? zone.color : NEEDS_DIMS_COLOR;

  const strokeStyleToDash = (style?: DemoStrokeStyle): number[] | undefined => {
    if (!hasDimensions) return [6, 4];
    switch (style) {
      case 'dashed': return [8, 4];
      case 'dotted': return [3, 3];
      default: return undefined;
    }
  };
  const strokeDash = strokeStyleToDash(zone.stroke_style);

  if (basePoints.length < 3) return null;

  const displayArea = liveArea;
  const sqftText = displayArea > 0
    ? `${displayArea.toFixed(2)} SF`
    : '';
  const labelText = zoneNumber != null
    ? (displayArea > 0 ? `#${zoneNumber}  (${sqftText})` : `#${zoneNumber} ?`)
    : (displayArea > 0 ? sqftText : '?');
  const labelColor = displayArea > 0 ? '#1a1a1a' : NEEDS_DIMS_COLOR;

  const charW = 7;
  const labelW = labelText.length * charW + 12;

  return (
    <Group
      ref={groupRef}
      x={zone.x}
      y={zone.y}
      draggable={draggingIndex === null}
      onClick={handleClick}
      onTap={handleClick}
      onDragEnd={handleDragEnd}
    >
      {/* Polygon fill */}
      <Line
        ref={lineRef}
        points={flatPoints}
        closed
        fill={zone.color}
        opacity={effectiveFillOpacity}
        stroke={strokeColor}
        strokeWidth={2}
        strokeScaleEnabled={false}
        dash={strokeDash}
      />

      {/* Selection stroke overlay */}
      {isSelected && (
        <Line
          ref={selLineRef}
          points={flatPoints}
          closed
          fill="transparent"
          stroke="#1890ff"
          strokeWidth={2}
          strokeScaleEnabled={false}
          dash={[6, 3]}
          listening={false}
        />
      )}

      {/* Center label */}
      <Rect
        x={bbox.cx - labelW / 2}
        y={bbox.cy - 9}
        width={labelW}
        height={18}
        fill="rgba(255,255,255,0.80)"
        cornerRadius={2}
        listening={false}
      />
      <Text
        x={bbox.cx - labelW / 2}
        y={bbox.cy - 8}
        width={labelW}
        text={labelText}
        fontSize={11}
        fontFamily="'Inter', 'Segoe UI', sans-serif"
        fill={labelColor}
        fontStyle="bold"
        align="center"
        listening={false}
        wrap="none"
      />

      {/* Optional custom label */}
      {zone.label && (
        <Text
          x={bbox.cx - 40}
          y={bbox.cy + 12}
          width={80}
          text={zone.label}
          fontSize={10}
          fontFamily="'Inter', 'Segoe UI', sans-serif"
          fill="#333333"
          align="center"
          listening={false}
          wrap="none"
          ellipsis
        />
      )}

      {/* Vertex handles (only when selected) */}
      {isSelected && points.map((p, i) => (
        <Circle
          key={`vertex-${i}`}
          x={p.x}
          y={p.y}
          radius={6}
          fill={draggingIndex === i ? '#1890ff' : '#ffffff'}
          stroke="#1890ff"
          strokeWidth={2}
          draggable
          onMouseEnter={(e) => {
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = 'move';
          }}
          onMouseLeave={(e) => {
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = 'default';
          }}
          onDragStart={(e) => {
            e.cancelBubble = true;
            setDraggingIndex(i);
          }}
          onDragMove={(e) => handleVertexDragMove(i, e)}
          onDragEnd={(e) => handleVertexDragEnd(i, e)}
        />
      ))}

      {/* Combined group badge */}
      {zone.combined_from && zone.combined_from.length > 0 && (
        <>
          <Rect
            x={bbox.minX}
            y={bbox.minY + 2}
            width={50}
            height={14}
            fill="#1890ff"
            cornerRadius={3}
            listening={false}
          />
          <Text
            x={bbox.minX}
            y={bbox.minY + 3}
            width={50}
            text={`GRP ${zone.combined_from.length}`}
            fontSize={9}
            fontFamily="'Inter', 'Segoe UI', sans-serif"
            fill="#ffffff"
            fontStyle="bold"
            align="center"
            listening={false}
          />
        </>
      )}

      {/* Carpet pad indicator badge */}
      {zone.include_pad && (
        <>
          <Rect
            x={bbox.maxX - 30}
            y={bbox.minY + 2}
            width={28}
            height={14}
            fill="#52c41a"
            cornerRadius={3}
            listening={false}
          />
          <Text
            x={bbox.maxX - 30}
            y={bbox.minY + 3}
            width={28}
            text="PAD"
            fontSize={9}
            fontFamily="'Inter', 'Segoe UI', sans-serif"
            fill="#ffffff"
            fontStyle="bold"
            align="center"
            listening={false}
          />
        </>
      )}

      {/* Insulation indicator badge */}
      {zone.include_insulation && (
        <>
          <Rect
            x={bbox.maxX - (zone.include_pad ? 62 : 30)}
            y={bbox.minY + 2}
            width={28}
            height={14}
            fill="#E91E63"
            cornerRadius={3}
            listening={false}
          />
          <Text
            x={bbox.maxX - (zone.include_pad ? 62 : 30)}
            y={bbox.minY + 3}
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
    </Group>
  );
};

export default React.memo(WMDemolitionPolygonRenderer);
