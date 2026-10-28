/**
 * A line the user draws between two points of the capture: the ends of a
 * length they know when no single wall is one — across the gap between two
 * wall pieces, along a printed dimension, the width of a room. Its real
 * length sets the scale the way a wall's does, and once a scale is set it
 * reads off any distance.
 *
 * Two clicks place it, each end snapping to a nearby wall corner; the ends
 * can then be dragged. Drawn last, so while placing it sits over the labels
 * and takes every click. Points are in the drawing's own (viewBox) pixels.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { Point } from '../../utils/roomDimensions';
import {
  DRAWING_COLORS,
  LABEL_FONT,
  LINE_LABEL,
  lengthText,
  scaleLineLabel,
  scaleLineTicks,
} from './roomDrawing';

export interface ScaleLineState {
  /** Both ends, or none before a line is drawn */
  points: Point[];
  /** Waiting for two clicks; the old line stays until the second one */
  placing: boolean;
  pxPerFt: number | null;
  /** Picked as the scale reference */
  selected: boolean;
  /** Wall corners an end snaps to */
  snapPoints: Point[];
  onPlace: (a: Point, b: Point) => void;
  onMove: (index: number, p: Point) => void;
  onSelect: () => void;
}

interface ScaleLineProps extends ScaleLineState {
  width: number;
  height: number;
  /** Image pixels per screen pixel */
  unit: number;
}

/** An end lands on a corner within this many screen pixels of it */
const SNAP_RADIUS = 8;

const ScaleLine: React.FC<ScaleLineProps> = ({
  width,
  height,
  unit,
  points,
  placing,
  pxPerFt,
  selected,
  snapPoints,
  onPlace,
  onMove,
  onSelect,
}) => {
  const [start, setStart] = useState<Point | null>(null);
  const [cursor, setCursor] = useState<{ point: Point; snapped: boolean } | null>(null);
  const [hovered, setHovered] = useState(false);
  const dragRef = useRef<number | null>(null);

  useEffect(() => {
    if (!placing) {
      setStart(null);
      setCursor(null);
    }
  }, [placing]);

  const toDrawing = (e: React.PointerEvent | React.MouseEvent): Point => {
    const ctm = (e.currentTarget as SVGGraphicsElement).ownerSVGElement?.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const snap = (p: Point): { point: Point; snapped: boolean } => {
    let best: Point | null = null;
    let bestDist = SNAP_RADIUS * unit;
    for (const q of snapPoints) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= bestDist) {
        best = q;
        bestDist = d;
      }
    }
    return best ? { point: best, snapped: true } : { point: p, snapped: false };
  };

  const onStageClick = (e: React.MouseEvent) => {
    const { point } = snap(toDrawing(e));
    if (!start) {
      setStart(point);
      return;
    }
    // A second click on the first point is not a line
    if (Math.hypot(point.x - start.x, point.y - start.y) < 2 * unit) return;
    onPlace(start, point);
    setStart(null);
  };

  const startDrag = (index: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = index;
  };

  const onDrag = (e: React.PointerEvent) => {
    if (dragRef.current == null) return;
    e.stopPropagation();
    onMove(dragRef.current, snap(toDrawing(e)).point);
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const [a, b] = points;
  const length = a && b ? lengthText(Math.hypot(b.x - a.x, b.y - a.y), pxPerFt) : null;
  const label = a && b ? scaleLineLabel(a, b, length ?? LINE_LABEL, unit) : null;

  return (
    <g>
      {a && b && label && (
        <>
          <line
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={DRAWING_COLORS.line}
            strokeWidth={(selected || hovered ? 3 : 2) * unit}
            strokeLinecap="round"
            pointerEvents="none"
          />
          {scaleLineTicks(a, b, unit).map(([p, q], i) => (
            <line
              key={`tick-${i}`}
              x1={p.x}
              y1={p.y}
              x2={q.x}
              y2={q.y}
              stroke={DRAWING_COLORS.line}
              strokeWidth={1.5 * unit}
              strokeLinecap="round"
              pointerEvents="none"
            />
          ))}
          {[a, b].map((p, i) => (
            <circle
              key={`end-${i}`}
              className="rd-scale-line-end"
              cx={p.x}
              cy={p.y}
              r={4 * unit}
              fill={DRAWING_COLORS.pill}
              stroke={DRAWING_COLORS.line}
              strokeWidth={1.5 * unit}
              onPointerDown={startDrag(i)}
              onPointerMove={onDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onClick={e => e.stopPropagation()}
            />
          ))}
          <g
            className="rd-face-label"
            role="button"
            tabIndex={0}
            aria-label={length ? `Scale line, ${length}` : 'Scale line'}
            aria-pressed={selected}
            onClick={e => {
              e.stopPropagation();
              onSelect();
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect();
              }
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <g transform={`translate(${label.cx} ${label.cy}) rotate(${label.angle})`}>
              <rect
                x={-label.width / 2}
                y={-label.height / 2}
                width={label.width}
                height={label.height}
                rx={label.height * 0.22}
                fill={selected ? DRAWING_COLORS.line : DRAWING_COLORS.pill}
                stroke={DRAWING_COLORS.line}
                strokeWidth={(hovered ? 2 : 1) * unit}
              />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={label.fontSize}
                fontFamily={LABEL_FONT}
                fontWeight={500}
                fill={selected ? '#ffffff' : DRAWING_COLORS.line}
              >
                {label.text}
              </text>
            </g>
          </g>
        </>
      )}

      {placing && (
        <>
          {start && cursor && (
            <line
              x1={start.x}
              y1={start.y}
              x2={cursor.point.x}
              y2={cursor.point.y}
              stroke={DRAWING_COLORS.line}
              strokeWidth={1.5 * unit}
              strokeDasharray={`${4 * unit} ${3 * unit}`}
              pointerEvents="none"
            />
          )}
          {start && (
            <circle cx={start.x} cy={start.y} r={3 * unit} fill={DRAWING_COLORS.line} pointerEvents="none" />
          )}
          {/* Where the next click will land when it snaps to a corner */}
          {cursor?.snapped && (
            <circle
              cx={cursor.point.x}
              cy={cursor.point.y}
              r={6 * unit}
              fill="none"
              stroke={DRAWING_COLORS.line}
              strokeWidth={1.5 * unit}
              pointerEvents="none"
            />
          )}
          <rect
            className="rd-scale-line-capture"
            x={0}
            y={0}
            width={width}
            height={height}
            fill="transparent"
            onClick={onStageClick}
            onPointerMove={e => {
              e.stopPropagation();
              setCursor(snap(toDrawing(e)));
            }}
            onPointerLeave={() => setCursor(null)}
          />
        </>
      )}
    </g>
  );
};

export default ScaleLine;
