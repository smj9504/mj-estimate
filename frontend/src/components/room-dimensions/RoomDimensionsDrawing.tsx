/**
 * The capture with its measured faces drawn on top. Each face label is a
 * button: picking one makes it the wall whose real length sets the scale.
 * When the capture shows more than one room, each of the others is a button
 * too: clicking inside it measures that room instead.
 */

import React, { useLayoutEffect, useRef, useState } from 'react';
import type { DetectedRoom, RoomDetection } from '../../utils/roomDimensions';
import ScaleLine, { type ScaleLineState } from './ScaleLine';
import {
  DRAWING_COLORS,
  LABEL_FONT,
  faceLabel,
  faceText,
  faceTicks,
  lengthText,
  openingLabel,
  type LabelBox,
} from './roomDrawing';

interface RoomDimensionsDrawingProps {
  imageUrl: string;
  /** The room being measured, with the capture's size */
  detection: RoomDetection;
  /** Every room in the capture, largest first, and which one `detection` is */
  rooms: DetectedRoom[];
  roomIndex: number;
  onRoomPick: (index: number) => void;
  pxPerFt: number | null;
  /** 1 fits the stage; above 1 the drawing grows (labels keep their size) and the stage scrolls */
  zoom: number;
  /** Face picked as the scale reference */
  selectedLabel: string | null;
  /** Face hovered here or in the list */
  hoveredLabel: string | null;
  onFaceClick: (label: string) => void;
  onFaceHover: (label: string | null) => void;
  /** The line drawn between two points, in the detection's pixels */
  scaleLine?: ScaleLineState;
}

const Label: React.FC<{ label: LabelBox; textColor: string; border: string; fill?: string; strokeWidth: number }> = ({
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

const RoomDimensionsDrawing: React.FC<RoomDimensionsDrawingProps> = ({
  imageUrl,
  detection,
  rooms,
  roomIndex,
  onRoomPick,
  pxPerFt,
  zoom,
  selectedLabel,
  hoveredLabel,
  onFaceClick,
  onFaceHover,
  scaleLine,
}) => {
  const { width, height } = detection;
  const svgRef = useRef<SVGSVGElement>(null);
  // Image pixels per screen pixel, so strokes and labels keep their size at any zoom
  const [unit, setUnit] = useState(1);

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

  const pointsOf = (room: DetectedRoom) => room.outline?.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <svg
      ref={svgRef}
      className="rd-drawing"
      viewBox={`0 0 ${width} ${height}`}
      style={
        zoom > 1
          ? { width: `${zoom * 100}%`, maxWidth: 'none', maxHeight: 'none' }
          : { maxWidth: width * 2 }
      }
      role="img"
      aria-label="Room capture with wall lengths"
    >
      <image href={imageUrl} x={0} y={0} width={width} height={height} />

      {/* Largest first, so a room drawn inside another stays clickable; the one measured takes its own clicks */}
      {rooms.map((room, i) => {
        const points = pointsOf(room);
        if (!points) return null;
        if (i === roomIndex) return <polygon key={`room-${i}`} points={points} fill={DRAWING_COLORS.room} />;
        return (
          <polygon
            key={`room-${i}`}
            className="rd-room-option"
            points={points}
            strokeWidth={1.5 * unit}
            strokeDasharray={`${4 * unit} ${3 * unit}`}
            role="button"
            tabIndex={0}
            aria-label={`Measure room ${i + 1}`}
            onClick={() => onRoomPick(i)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onRoomPick(i);
              }
            }}
          />
        );
      })}

      {detection.openings.map((opening, i) => (
        <polyline
          key={`opening-${i}`}
          points={opening.path.map(p => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={DRAWING_COLORS.opening}
          strokeWidth={1.5 * unit}
          strokeDasharray={`${4 * unit} ${3 * unit}`}
          pointerEvents="none"
        />
      ))}

      {detection.faces.map(face => {
        const active = face.label === hoveredLabel || face.label === selectedLabel;
        const color = active ? DRAWING_COLORS.faceActive : DRAWING_COLORS.face;
        return (
          <g key={`line-${face.label}`} pointerEvents="none">
            <line
              x1={face.start.x}
              y1={face.start.y}
              x2={face.end.x}
              y2={face.end.y}
              stroke={color}
              strokeWidth={(active ? 3.5 : 2) * unit}
              strokeLinecap="round"
            />
            {faceTicks(face, unit).map(([a, b], i) => (
              <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={1.5 * unit} strokeLinecap="round" />
            ))}
          </g>
        );
      })}

      {pxPerFt &&
        detection.openings.map((opening, i) => (
          <g key={`opening-label-${i}`} pointerEvents="none">
            <Label
              label={openingLabel(opening, lengthText(opening.lengthPx, pxPerFt)!, unit)}
              textColor="#73726e"
              border={DRAWING_COLORS.hairline}
              strokeWidth={unit}
            />
          </g>
        ))}

      {detection.faces.map(face => {
        const selected = face.label === selectedLabel;
        const hovered = face.label === hoveredLabel;
        const text = faceText(face, pxPerFt);
        const length = lengthText(face.lengthPx, pxPerFt);
        return (
          <g
            key={`label-${face.label}`}
            className="rd-face-label"
            role="button"
            tabIndex={0}
            aria-label={length ? `Wall ${face.label}, ${length}` : `Wall ${face.label}`}
            aria-pressed={selected}
            onClick={() => onFaceClick(face.label)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onFaceClick(face.label);
              }
            }}
            onMouseEnter={() => onFaceHover(face.label)}
            onMouseLeave={() => onFaceHover(null)}
          >
            <Label
              label={faceLabel(face, text, unit)}
              textColor={selected ? '#ffffff' : DRAWING_COLORS.ink}
              fill={selected ? DRAWING_COLORS.faceActive : DRAWING_COLORS.pill}
              border={selected || hovered ? DRAWING_COLORS.faceActive : DRAWING_COLORS.face}
              strokeWidth={(hovered ? 2 : 1) * unit}
            />
          </g>
        );
      })}

      {scaleLine && <ScaleLine {...scaleLine} width={width} height={height} unit={unit} />}
    </svg>
  );
};

export default RoomDimensionsDrawing;
