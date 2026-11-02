/**
 * A floor's plan with what was torn out drawn on it and numbered like the list
 * beside it, so a number answers "where is that?". Read only, and plain SVG so
 * the supplement page doesn't load the sketch editor's canvas.
 */

import React, { useMemo } from 'react';
import type { WMShapeAnnotation } from '../../types/wmSketch';
import { doorSymbol, doorTypeOf, swingSectorPath } from '../water-mitigation/sketch/utils/doorSymbols';
import {
  geometryPoints,
  spreadNumbers,
  type DemoFloorTakeoff,
  type DemoRow,
} from '../water-mitigation/sketch/utils/demoTakeoff';
import { boundsOf, type Point } from '../water-mitigation/sketch/utils/sketchGeometry';
import wmSketchService from '../../services/wmSketchService';

const INK = '#37352f';
const QUIET = '#a5a29a';
const ROOM_FILL = '#f7f7f5';
const WARNING = '#d9730d';

/** The plan is drawn roughly this wide; sizes below are given as if at this width */
const NOMINAL_WIDTH_PX = 430;
const NUMBER_RADIUS_PX = 9;
const PADDING_FT = 2;
const DEFAULT_SCALE = 20;

const hairline = { vectorEffect: 'non-scaling-stroke' as const };

const ShapeOutline: React.FC<{ shape: WMShapeAnnotation }> = ({ shape }) => {
  const rotate = shape.rotation ? ` rotate(${shape.rotation})` : '';
  if (shape.shape_type === 'circle') {
    return (
      <ellipse
        cx={shape.x}
        cy={shape.y}
        rx={shape.width / 2}
        ry={shape.height / 2}
        fill="none"
        stroke={QUIET}
        strokeWidth={1}
        {...hairline}
      />
    );
  }
  if (shape.preset_id === 'door') {
    return (
      <g transform={`translate(${shape.x},${shape.y})${rotate}`}>
        {doorSymbol(doorTypeOf(shape), shape.width, shape.height, !!shape.flip_x).map((p, i) => {
          switch (p.kind) {
            case 'line': {
              const pts: string[] = [];
              for (let j = 0; j < p.points.length; j += 2) pts.push(`${p.points[j]},${p.points[j + 1]}`);
              return <polyline key={i} points={pts.join(' ')} fill="none" stroke={QUIET} strokeWidth={1} {...hairline} />;
            }
            case 'rect':
              return <rect key={i} x={p.x} y={p.y} width={p.width} height={p.height} fill="none" stroke={QUIET} strokeWidth={1} {...hairline} />;
            case 'swing':
              return <path key={i} d={swingSectorPath(p)} fill="none" stroke={QUIET} strokeWidth={1} {...hairline} />;
            default:
              return null;
          }
        })}
      </g>
    );
  }
  return (
    <rect
      transform={`translate(${shape.x},${shape.y})${rotate}`}
      width={shape.width}
      height={shape.height}
      fill="none"
      stroke={QUIET}
      strokeWidth={1}
      {...hairline}
    />
  );
};

const ZoneMark: React.FC<{ row: DemoRow; emphasis: 'active' | 'dim' | 'normal' }> = ({ row, emphasis }) => {
  const { geometry, color, unit, unmeasured } = row;
  const opacity = emphasis === 'dim' ? 0.25 : 1;
  const stroke = unmeasured ? WARNING : color;
  const fillOpacity = emphasis === 'active' ? 0.45 : 0.25;
  const outline = emphasis === 'active' ? 2.5 : 1.5;
  const dash = unmeasured ? '5 4' : undefined;

  if (geometry.kind === 'line') {
    const { from, to } = geometry;
    return (
      <g opacity={opacity}>
        <line
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke={color}
          strokeWidth={emphasis === 'active' ? 6 : 4}
          strokeLinecap="round"
          strokeDasharray={unit === 'LF' ? '8 4' : undefined}
          {...hairline}
        />
        {/* A line is too thin to hover or tap on its own */}
        <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="transparent" strokeWidth={16} {...hairline} />
      </g>
    );
  }
  if (geometry.kind === 'polygon') {
    return (
      <polygon
        points={geometry.points.map((p) => `${p.x},${p.y}`).join(' ')}
        fill={color}
        fillOpacity={fillOpacity}
        stroke={stroke}
        strokeWidth={outline}
        strokeDasharray={dash}
        opacity={opacity}
        {...hairline}
      />
    );
  }
  return (
    <rect
      transform={`translate(${geometry.x},${geometry.y}) rotate(${geometry.rotation})`}
      width={geometry.width}
      height={geometry.height}
      fill={color}
      fillOpacity={fillOpacity}
      stroke={stroke}
      strokeWidth={outline}
      strokeDasharray={dash}
      opacity={opacity}
      {...hairline}
    />
  );
};

interface WMDemoPlanProps {
  takeoff: DemoFloorTakeoff;
  activeId: string | null;
  onHover: (id: string | null) => void;
  onPick: (id: string) => void;
}

const WMDemoPlan: React.FC<WMDemoPlanProps> = ({ takeoff, activeId, onHover, onPick }) => {
  const { floor, rows } = takeoff;
  const overlay = floor.overlay_data;
  const scale = Number(floor.scale_pixels_per_foot) || DEFAULT_SCALE;
  const showImage = floor.source_type === 'image' && !!floor.background_image_url;

  const view = useMemo(() => {
    const points: Point[] = rows.flatMap((row) => geometryPoints(row.geometry));
    (overlay.rooms ?? []).forEach((room) => points.push(...(room.boundary ?? [])));
    (overlay.walls ?? []).forEach((wall) => {
      points.push({ x: wall.start_x, y: wall.start_y }, { x: wall.end_x, y: wall.end_y });
    });
    // The plan image fills the canvas, so keep all of it in view
    if (showImage) points.push({ x: 0, y: 0 }, { x: floor.canvas_width, y: floor.canvas_height });
    const box = boundsOf(points) ?? { x1: 0, y1: 0, x2: floor.canvas_width, y2: floor.canvas_height };
    const pad = PADDING_FT * scale;
    return {
      x: box.x1 - pad,
      y: box.y1 - pad,
      width: box.x2 - box.x1 + pad * 2,
      height: box.y2 - box.y1 + pad * 2,
    };
  }, [rows, overlay, floor.canvas_width, floor.canvas_height, scale, showImage]);

  const unit = view.width / NOMINAL_WIDTH_PX;
  const radius = NUMBER_RADIUS_PX * unit;
  const spots = useMemo(() => spreadNumbers(rows, radius), [rows, radius]);
  // The one being read comes last, so nothing is drawn over it
  const drawOrder = useMemo(
    () => [...rows].sort((a, b) => Number(a.id === activeId) - Number(b.id === activeId)),
    [rows, activeId],
  );

  return (
    <svg
      className="wmd-plan-svg"
      viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      role="img"
      aria-label={`Plan of ${floor.floor_label} with ${rows.length} numbered demolition items`}
      onMouseLeave={() => onHover(null)}
    >
      {showImage && (
        <image
          href={wmSketchService.backgroundImagePreviewUrl(floor.id)}
          x={overlay.bg_offset_x ?? 0}
          y={overlay.bg_offset_y ?? 0}
          width={floor.canvas_width}
          height={floor.canvas_height}
          preserveAspectRatio="xMidYMid meet"
          opacity={0.75}
        />
      )}

      {(overlay.rooms ?? []).map((room) => (
        (room.boundary?.length ?? 0) >= 3 && (
          <polygon
            key={room.id}
            points={room.boundary.map((p) => `${p.x},${p.y}`).join(' ')}
            fill={showImage ? 'none' : ROOM_FILL}
            stroke={QUIET}
            strokeWidth={1}
            {...hairline}
          />
        )
      ))}
      {(overlay.walls ?? []).map((wall) => (
        <line
          key={wall.id}
          x1={wall.start_x}
          y1={wall.start_y}
          x2={wall.end_x}
          y2={wall.end_y}
          stroke={INK}
          strokeWidth={1.5}
          strokeLinecap="round"
          {...hairline}
        />
      ))}
      {(overlay.shapes ?? []).map((shape) => <ShapeOutline key={shape.id} shape={shape} />)}

      {drawOrder.map((row) => (
        <g
          key={row.id}
          className="wmd-plan-zone"
          onMouseEnter={() => onHover(row.id)}
          onClick={() => onPick(row.id)}
        >
          <ZoneMark row={row} emphasis={!activeId ? 'normal' : row.id === activeId ? 'active' : 'dim'} />
        </g>
      ))}

      {/* Over the demolition so it never hides a name */}
      {(overlay.rooms ?? []).map((room) => {
        const box = boundsOf(room.boundary ?? []);
        if (!box || !room.name?.trim()) return null;
        return (
          <text
            key={room.id}
            x={(box.x1 + box.x2) / 2}
            y={box.y1 + 16 * unit}
            textAnchor="middle"
            fontSize={11 * unit}
            fontWeight={600}
            fill={INK}
            className="wmd-plan-text wmd-plan-label"
          >
            {room.name}
          </text>
        );
      })}
      {(overlay.text_annotations ?? []).map((note) => (
        <text
          key={note.id}
          x={note.x}
          y={note.y}
          fontSize={Math.max(note.font_size || 0, 10 * unit)}
          fontWeight={note.bold ? 600 : 400}
          fill={INK}
          className="wmd-plan-text wmd-plan-label"
        >
          {note.text}
        </text>
      ))}

      {drawOrder.map((row) => {
        const spot = spots.get(row.id) ?? row.anchor;
        const isActive = row.id === activeId;
        return (
          <g
            key={row.id}
            className="wmd-plan-zone"
            opacity={activeId && !isActive ? 0.45 : 1}
            onMouseEnter={() => onHover(row.id)}
            onClick={() => onPick(row.id)}
          >
            <circle
              cx={spot.x}
              cy={spot.y}
              r={radius}
              fill={isActive ? INK : '#ffffff'}
              stroke={row.unmeasured ? WARNING : row.color}
              strokeWidth={2}
              {...hairline}
            />
            <text
              x={spot.x}
              y={spot.y}
              dy="0.35em"
              textAnchor="middle"
              fontSize={10.5 * unit}
              fontWeight={600}
              fill={isActive ? '#ffffff' : INK}
              className="wmd-plan-text"
            >
              {row.number}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

export default WMDemoPlan;
