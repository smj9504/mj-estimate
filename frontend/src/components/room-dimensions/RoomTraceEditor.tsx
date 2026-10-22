/**
 * Trace walls mode: the capture with a polyline the user draws over it.
 *
 * Click the stage to drop a corner, drag a corner to nudge it, and click the
 * first corner (or Close loop) to join the outline. Each wall run carries its
 * length once a scale is set, and each corner carries its angle — square ones
 * quietly, the rest in warning colour so an angled wall stands out.
 */

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Point } from '../../utils/roomDimensions';
import { angleText, type TraceMetrics } from '../../utils/roomTrace';
import {
  DRAWING_COLORS,
  LABEL_FONT,
  centroid,
  lengthText,
  traceAngleLabel,
  traceLengthLabel,
  type LabelBox,
} from './roomDrawing';

interface RoomTraceEditorProps {
  imageUrl: string;
  width: number;
  height: number;
  points: Point[];
  metrics: TraceMetrics;
  closed: boolean;
  pxPerFt: number | null;
  zoom: number;
  selectedLabel: string | null;
  hoveredLabel: string | null;
  onAddPoint: (p: Point) => void;
  onMoveVertex: (index: number, p: Point) => void;
  onCloseLoop: () => void;
  onSelectSegment: (label: string) => void;
  onHoverSegment: (label: string | null) => void;
}

const Pill: React.FC<{ label: LabelBox; textColor: string; border: string; fill?: string; strokeWidth: number }> = ({
  label,
  textColor,
  border,
  fill = DRAWING_COLORS.pill,
  strokeWidth,
}) => (
  <g transform={`translate(${label.cx} ${label.cy}) rotate(${label.angle})`}>
    <rect
      x={-label.width / 2}
      y={-label.height / 2}
      width={label.width}
      height={label.height}
      rx={label.height * 0.22}
      fill={fill}
      stroke={border}
      strokeWidth={strokeWidth}
    />
    <text
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={label.fontSize}
      fontFamily={LABEL_FONT}
      fontWeight={500}
      fill={textColor}
    >
      {label.text}
    </text>
  </g>
);

/** Movement under this many screen pixels counts as a click, not a drag */
const CLICK_SLOP = 4;

const RoomTraceEditor: React.FC<RoomTraceEditorProps> = ({
  imageUrl,
  width,
  height,
  points,
  metrics,
  closed,
  pxPerFt,
  zoom,
  selectedLabel,
  hoveredLabel,
  onAddPoint,
  onMoveVertex,
  onCloseLoop,
  onSelectSegment,
  onHoverSegment,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  // Image pixels per screen pixel, so strokes and labels keep their size at any zoom
  const [unit, setUnit] = useState(1);
  const [cursor, setCursor] = useState<Point | null>(null);
  const dragRef = useRef<{ index: number; moved: boolean } | null>(null);
  // When a drag or loop-close just happened, ignore the click it leaves behind.
  // A timestamp (not a sticky flag) so it can never go stale and eat a later point.
  const suppressUntilRef = useRef(0);

  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setUnit(Math.max(width / rect.width, height / rect.height));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width, height]);

  const toImage = (e: React.PointerEvent | React.MouseEvent): Point => {
    const svg = svgRef.current!;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const inv = ctm.inverse();
    const sp = new DOMPoint(e.clientX, e.clientY).matrixTransform(inv);
    return { x: sp.x, y: sp.y };
  };

  const canClose = !closed && points.length >= 3;
  const inside = useMemo(() => centroid(points), [points]);
  const outlinePoints = points.map(p => `${p.x},${p.y}`).join(' ');

  const onBackgroundClick = (e: React.MouseEvent) => {
    if (Date.now() < suppressUntilRef.current) return;
    if (closed) return;
    onAddPoint(toImage(e));
  };

  const startDrag = (index: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { index, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag) {
      const p = toImage(e);
      if (!drag.moved) {
        const rect = svgRef.current!.getBoundingClientRect();
        const perScreen = Math.max(width / rect.width, height / rect.height);
        if (Math.hypot(p.x - points[drag.index].x, p.y - points[drag.index].y) > CLICK_SLOP * perScreen) {
          drag.moved = true;
        }
      }
      if (drag.moved) onMoveVertex(drag.index, p);
      return;
    }
    if (!closed && points.length > 0) setCursor(toImage(e));
  };

  const endDrag = (index: number) => (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    // A click (no real drag) on the first corner closes the loop
    if (!drag.moved && index === 0 && canClose) {
      onCloseLoop();
      suppressUntilRef.current = Date.now() + 400;
    } else if (drag.moved) {
      suppressUntilRef.current = Date.now() + 400;
    }
    void e;
  };

  return (
    <svg
      ref={svgRef}
      className={`rd-drawing rd-trace${closed ? '' : ' is-drawing'}`}
      viewBox={`0 0 ${width} ${height}`}
      style={zoom > 1 ? { width: `${zoom * 100}%`, maxWidth: 'none', maxHeight: 'none' } : { maxWidth: width * 2 }}
      role="img"
      aria-label="Room capture with traced walls"
      onPointerMove={onPointerMove}
      onPointerLeave={() => setCursor(null)}
    >
      <image href={imageUrl} x={0} y={0} width={width} height={height} />
      <rect x={0} y={0} width={width} height={height} fill="transparent" onClick={onBackgroundClick} />

      {closed && points.length >= 3 && <polygon points={outlinePoints} fill={DRAWING_COLORS.room} pointerEvents="none" />}

      {/* Rubber band from the last corner to the cursor while drawing */}
      {!closed && cursor && points.length > 0 && (
        <line
          x1={points[points.length - 1].x}
          y1={points[points.length - 1].y}
          x2={cursor.x}
          y2={cursor.y}
          stroke={DRAWING_COLORS.trace}
          strokeWidth={1.5 * unit}
          strokeDasharray={`${4 * unit} ${3 * unit}`}
          pointerEvents="none"
          opacity={0.6}
        />
      )}

      {metrics.segments.map(seg => {
        const active = seg.label === hoveredLabel || seg.label === selectedLabel;
        return (
          <line
            key={`seg-${seg.label}`}
            x1={seg.start.x}
            y1={seg.start.y}
            x2={seg.end.x}
            y2={seg.end.y}
            stroke={active ? DRAWING_COLORS.faceActive : DRAWING_COLORS.trace}
            strokeWidth={(active ? 3.5 : 2) * unit}
            strokeLinecap="round"
            pointerEvents="none"
          />
        );
      })}

      {points.map((p, i) => (
        <circle
          key={`vx-${i}`}
          className="rd-trace-vertex"
          cx={p.x}
          cy={p.y}
          r={(canClose && i === 0 ? 5 : 3.5) * unit}
          fill={DRAWING_COLORS.pill}
          stroke={canClose && i === 0 ? DRAWING_COLORS.faceActive : DRAWING_COLORS.traceVertex}
          strokeWidth={2 * unit}
          onPointerDown={startDrag(i)}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag(i)}
        />
      ))}

      {/* Angle at each corner */}
      {metrics.vertices.map(v => {
        const text = angleText(v.angleDeg);
        if (!text) return null;
        const color = v.isRightAngle ? DRAWING_COLORS.angle : DRAWING_COLORS.angleWarn;
        return (
          <g key={`ang-${v.index}`} pointerEvents="none">
            <Pill label={traceAngleLabel(v.point, inside, text, unit)} textColor={color} border={color} strokeWidth={unit} />
          </g>
        );
      })}

      {/* Length of each wall run, clickable to set the scale from it */}
      {metrics.segments.map(seg => {
        const selected = seg.label === selectedLabel;
        const hovered = seg.label === hoveredLabel;
        const text = lengthText(seg.lengthPx, pxPerFt) ?? seg.label;
        const length = lengthText(seg.lengthPx, pxPerFt);
        return (
          <g
            key={`len-${seg.label}`}
            className="rd-face-label"
            role="button"
            tabIndex={0}
            aria-label={length ? `Wall ${seg.label}, ${length}` : `Wall ${seg.label}`}
            aria-pressed={selected}
            onClick={e => {
              e.stopPropagation();
              onSelectSegment(seg.label);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectSegment(seg.label);
              }
            }}
            onMouseEnter={() => onHoverSegment(seg.label)}
            onMouseLeave={() => onHoverSegment(null)}
          >
            <Pill
              label={traceLengthLabel(seg, inside, text, unit)}
              textColor={selected ? '#ffffff' : DRAWING_COLORS.ink}
              fill={selected ? DRAWING_COLORS.faceActive : DRAWING_COLORS.pill}
              border={selected || hovered ? DRAWING_COLORS.faceActive : DRAWING_COLORS.trace}
              strokeWidth={(hovered ? 2 : 1) * unit}
            />
          </g>
        );
      })}
    </svg>
  );
};

export default RoomTraceEditor;
