/**
 * CabinetElevationView
 *
 * Front elevation of one cabinet run, drawn to scale from the floor plan
 * (see buildElevations in cabinetSketchLayout.ts). Read-only: cabinets are
 * moved in the plan and sized in the Edit tab; this view only shows how
 * the run reads from the front — door/drawer layout (glass doors from the
 * Edit tab's Glass box drawn as panes), upper mounting
 * height, countertop line and widths.
 *
 * Plain SVG rather than Konva: nothing here is interactive, and SVG scales
 * crisply and prints/exports as-is.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CabType, SpecialtyType } from '../../../types/cabinetEstimate';
import { blindLengthIn, cabinetDepthIn, cornerKind } from './cabinetSketchLayout';
import type { CornerKind, ElevationItem, ElevationRun, PresetCatalog } from './cabinetSketchLayout';

/** Reference ceiling drawn behind the run (8 ft). */
const CEILING_IN = 96;
const COUNTER_TOP_IN = 36;
const TOE_KICK_IN = 4;
/** Gap between doors/drawers and the box edge, inches. */
const REVEAL_IN = 0.75;

const INK = '#37352f';
const INK_SECONDARY = '#5f5e5b';
const HAIRLINE = '#dfdfdc';
const QUIET_FILL = '#f7f7f5';
const BOX_FILL = '#F3E8D8';
const BOX_STROKE = '#8B5E3C';
const FACE_STROKE = '#A87B54';
const FACE_FILL = '#FBF6EF';
const APPLIANCE_FILL = '#d9d9d6';
const COUNTER_FILL = '#8c8a85';
const GLASS_FILL = '#DCEAF3';
const GLASS_STROKE = '#7FA6C2';
const SELECTED = '#1f74c9';
/** Width of the door frame around a glass insert, inches. */
const GLASS_STILE_IN = 2.25;

const MARGIN_X = 40;
const MARGIN_TOP = 24;
const MARGIN_BOTTOM = 76;

type FaceKind = 'door' | 'drawer' | 'panel' | 'opening';

/** A door, drawer or appliance opening, in inches from the cabinet's bottom-left (y up). */
interface Face {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: FaceKind;
  label?: string;
}

/** n equal doors side by side across [x, x + w]. */
function doorRow(x: number, y: number, w: number, h: number, n: number, kind: FaceKind = 'door'): Face[] {
  const each = (w - REVEAL_IN * (n + 1)) / n;
  return Array.from({ length: n }, (_, i) => ({
    x: x + REVEAL_IN + i * (each + REVEAL_IN),
    y,
    w: each,
    h,
    kind,
  }));
}

const doorCount = (w: number) => (w >= 24 ? 2 : 1);

/**
 * Front of a corner unit. Its corner end shows no front of its own — an L
 * or diagonal's other leg comes toward the viewer, a blind corner's end
 * hides behind the other run — so doors go only on the open part.
 */
function cornerFaces(
  cabType: CabType,
  specialty: SpecialtyType,
  kind: CornerKind,
  side: 'left' | 'right',
  w: number,
  h: number
): Face[] {
  const r = REVEAL_IN;
  const bottom = cabType === 'wall' ? r : TOE_KICK_IN + r;
  const cornerLen =
    kind === 'blind' ? Math.min(blindLengthIn(cabType), w * 0.75) : cabinetDepthIn(cabType, specialty);
  const openW = w - cornerLen;
  const faces: Face[] =
    kind === 'blind'
      ? [
          { x: r, y: bottom, w: cornerLen - r, h: h - r - bottom, kind: 'panel', label: 'BLIND' },
          // The open part reads like a plain box of its width.
          ...facesFor(cabType, undefined, openW, h).map((f) => ({ ...f, x: f.x + cornerLen })),
        ]
      : // Lazy susan / easy-reach / diagonal: one full-height door on the open leaf.
        doorRow(cornerLen, bottom, openW, h - r - bottom, 1);
  return side === 'right' ? faces.map((f) => ({ ...f, x: w - f.x - f.w })) : faces;
}

/** Front layout of a cabinet by type, following the catalog's specialty. */
function facesFor(
  cabType: CabType,
  specialty: SpecialtyType | undefined,
  w: number,
  h: number,
  cornerSide: 'left' | 'right' = 'left'
): Face[] {
  const inner = w - REVEAL_IN * 2;
  const r = REVEAL_IN;

  const corner = cornerKind(specialty);
  if (corner && specialty) return cornerFaces(cabType, specialty, corner, cornerSide, w, h);

  if (cabType === 'wall') {
    return doorRow(0, r, w, h - r * 2, doorCount(w));
  }

  if (cabType === 'tall') {
    const bottom = TOE_KICK_IN + r;
    if (specialty === 'refrigerator_cabinet') {
      const upper = Math.min(24, h * 0.3);
      return [
        { x: r, y: 0, w: inner, h: h - upper - r, kind: 'opening', label: 'FRIDGE' },
        ...doorRow(0, h - upper, w, upper - r, doorCount(w)),
      ];
    }
    if (specialty === 'oven_cabinet' || specialty === 'double_oven_cabinet') {
      const ovenH = specialty === 'double_oven_cabinet' ? 52 : 30;
      const ovenBottom = specialty === 'double_oven_cabinet' ? 22 : 30;
      const upperY = ovenBottom + ovenH + r;
      return [
        ...doorRow(0, bottom, w, ovenBottom - bottom - r, 1, 'drawer'),
        { x: r, y: ovenBottom, w: inner, h: ovenH, kind: 'opening', label: specialty === 'double_oven_cabinet' ? 'OVEN ×2' : 'OVEN' },
        ...doorRow(0, upperY, w, h - upperY - r, doorCount(w)),
      ];
    }
    // Pantry: tall lower doors, shorter upper doors.
    const split = Math.max(bottom + 30, h * 0.6);
    return [
      ...doorRow(0, bottom, w, split - bottom - r / 2, doorCount(w)),
      ...doorRow(0, split + r / 2, w, h - split - r * 1.5, doorCount(w)),
    ];
  }

  // Base (and the legacy 'specialty' type).
  const bottom = TOE_KICK_IN + r;
  const top = h - r;
  const drawerH = 6;
  const below = top - drawerH - r - bottom;

  switch (specialty) {
    case 'range_base_slide_in':
    case 'range_base_drop_in':
      return [{ x: r, y: 0, w: inner, h: h + 1.5, kind: 'opening', label: 'RANGE' }];
    case 'drawer_base': {
      const rest = (top - drawerH - r - bottom - r) / 2;
      return [
        { x: r, y: bottom, w: inner, h: rest, kind: 'drawer' },
        { x: r, y: bottom + rest + r, w: inner, h: rest, kind: 'drawer' },
        { x: r, y: top - drawerH, w: inner, h: drawerH, kind: 'drawer' },
      ];
    }
    case 'trash_pullout':
      return [
        { x: r, y: bottom, w: inner, h: below, kind: 'drawer' },
        { x: r, y: top - drawerH, w: inner, h: drawerH, kind: 'drawer' },
      ];
    case 'microwave_drawer_base': {
      const mwH = 15;
      return [
        { x: r, y: bottom, w: inner, h: top - mwH - r - bottom, kind: 'drawer' },
        { x: r, y: top - mwH, w: inner, h: mwH, kind: 'opening', label: 'MW' },
      ];
    }
    case 'farmhouse_sink_base': {
      const apronH = 10;
      return [
        ...doorRow(0, bottom, w, top - apronH - r - bottom, doorCount(w)),
        { x: r, y: top - apronH, w: inner, h: apronH, kind: 'panel', label: 'APRON SINK' },
      ];
    }
    case 'sink_base':
      return [
        ...doorRow(0, bottom, w, below, doorCount(w)),
        { x: r, y: top - drawerH, w: inner, h: drawerH, kind: 'panel', label: 'SINK' },
      ];
    default:
      return [
        ...doorRow(0, bottom, w, below, doorCount(w)),
        ...doorRow(0, top - drawerH, w, drawerH, w >= 30 ? 2 : 1, 'drawer'),
      ];
  }
}

function formatFeetInches(totalIn: number): string {
  const rounded = Math.round(totalIn * 4) / 4;
  const ft = Math.floor(rounded / 12);
  const inch = Math.round((rounded - ft * 12) * 100) / 100;
  if (ft === 0) return `${inch}"`;
  return inch === 0 ? `${ft}'` : `${ft}' ${inch}"`;
}

export interface CabinetElevationViewProps {
  run: ElevationRun | undefined;
  presets: PresetCatalog;
  height: number;
  selectedIds?: Set<string>;
}

const CabinetElevationView: React.FC<CabinetElevationViewProps> = ({ run, presets, height, selectedIds }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(320, Math.floor(w)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (!run || run.items.length === 0) return null;
    const lengthIn = Math.max(run.length_in, 24);
    const ppi = Math.min((width - MARGIN_X * 2) / lengthIn, (height - MARGIN_TOP - MARGIN_BOTTOM) / CEILING_IN);
    const x0 = (width - lengthIn * ppi) / 2;
    const floorY = MARGIN_TOP + CEILING_IN * ppi;
    return {
      lengthIn,
      ppi,
      x: (inches: number) => x0 + inches * ppi,
      y: (aff: number) => floorY - aff * ppi,
      floorY,
    };
  }, [run, width, height]);

  if (!run || !layout) {
    return (
      <div ref={containerRef} style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK_SECONDARY, fontSize: 13 }}>
        No cabinets to show yet. Add cabinets in the Edit tab and they appear here.
      </div>
    );
  }

  const { x, y, ppi, floorY, lengthIn } = layout;
  const wallLeft = run.wall ? run.wall.left_in : 0;
  const wallRight = run.wall ? run.wall.right_in : lengthIn;
  const lowers = run.items.filter((i) => i.bottom_in === 0);
  const uppers = run.items.filter((i) => i.bottom_in > 0);

  const renderItem = (item: ElevationItem) => {
    const c = item.cabinet;
    const specialty = presets[c.preset_code]?.specialty;
    const isRange = specialty === 'range_base_slide_in' || specialty === 'range_base_drop_in';
    const isLower = item.bottom_in === 0;
    const left = x(item.left_in);
    const top = y(item.bottom_in + item.height_in);
    const w = item.width_in * ppi;
    const h = item.height_in * ppi;
    const selected = selectedIds?.has(c.id);
    const faces = facesFor(c.cab_type, specialty, item.width_in, item.height_in, c.corner_side);
    const fx = (f: Face) => left + f.x * ppi;
    const fy = (f: Face) => y(item.bottom_in + f.y + f.h);

    return (
      <g key={c.id}>
        {!isRange && (
          <rect x={left} y={top} width={w} height={h} fill={BOX_FILL} stroke={selected ? SELECTED : BOX_STROKE} strokeWidth={selected ? 2 : 1.25} />
        )}
        {isLower && !isRange && c.cab_type !== 'tall' && (
          <rect x={left + ppi} y={y(TOE_KICK_IN)} width={w - 2 * ppi} height={TOE_KICK_IN * ppi} fill={HAIRLINE} />
        )}
        {faces.map((f, i) => {
          const fw = f.w * ppi;
          const fh = f.h * ppi;
          if (f.kind === 'opening') {
            return (
              <g key={i}>
                <rect x={fx(f)} y={fy(f)} width={fw} height={fh} fill={APPLIANCE_FILL} stroke={INK_SECONDARY} strokeWidth={1} />
                {f.label && fh > 14 && (
                  <text x={fx(f) + fw / 2} y={fy(f) + fh / 2 + 4} textAnchor="middle" fontSize={10} fill={INK_SECONDARY} letterSpacing={0.5}>
                    {f.label}
                  </text>
                )}
              </g>
            );
          }
          // Drawer pull: a short bar centred near the top of the drawer front.
          const handleLen = Math.min(fw * 0.4, 4 * ppi);
          const handleY = fy(f) + Math.min(fh / 2, 2 * ppi);
          // Glass insert: a pane inside the door frame, with the usual two reflection strokes.
          const stile = Math.min(GLASS_STILE_IN, f.w / 4, f.h / 4) * ppi;
          const pane =
            c.has_glass_door && f.kind === 'door'
              ? { x: fx(f) + stile, y: fy(f) + stile, w: fw - 2 * stile, h: fh - 2 * stile }
              : null;
          const m = pane ? Math.min(pane.w, pane.h) : 0;
          const sx = pane ? pane.x + pane.w * 0.22 : 0;
          const sy = pane ? pane.y + pane.h * 0.5 : 0;
          return (
            <g key={i}>
              <rect
                x={fx(f)}
                y={fy(f)}
                width={fw}
                height={fh}
                fill={FACE_FILL}
                stroke={FACE_STROKE}
                strokeWidth={0.75}
                strokeDasharray={f.kind === 'panel' ? '3 2' : undefined}
              />
              {pane && pane.w > 4 && pane.h > 4 && (
                <g stroke={GLASS_STROKE}>
                  <rect x={pane.x} y={pane.y} width={pane.w} height={pane.h} fill={GLASS_FILL} strokeWidth={0.75} />
                  <line x1={sx} y1={sy} x2={sx + m * 0.4} y2={sy - m * 0.4} strokeWidth={1} />
                  <line x1={sx + m * 0.1} y1={sy + m * 0.1} x2={sx + m * 0.38} y2={sy - m * 0.18} strokeWidth={1} />
                </g>
              )}
              {f.kind === 'drawer' && fh > 6 && (
                <line
                  x1={fx(f) + fw / 2 - handleLen / 2}
                  x2={fx(f) + fw / 2 + handleLen / 2}
                  y1={handleY}
                  y2={handleY}
                  stroke={INK_SECONDARY}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
              )}
            </g>
          );
        })}
      </g>
    );
  };

  // Countertop over every base cabinet; a range opening breaks it.
  const counters = lowers.filter((i) => {
    const sp = presets[i.cabinet.preset_code]?.specialty;
    return i.cabinet.cab_type !== 'tall' && sp !== 'range_base_slide_in' && sp !== 'range_base_drop_in';
  });

  // Under the floor: each lower's code over its width; then the run length.
  const codeY = floorY + 16;
  const dimY = floorY + 29;
  const totalY = floorY + 56;
  const widthLabel = (i: ElevationItem) => `${Math.round(i.width_in * 100) / 100}"`;
  // Narrow cabinets can't fit their code; their width still shows.
  const fitsCode = (i: ElevationItem) => i.width_in * ppi >= (i.cabinet.label || i.cabinet.preset_code).length * 6.5;

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Front elevation, ${run.label}`}
        style={{ display: 'block', fontFamily: "'Inter', 'Segoe UI', sans-serif" }}
      >
        {/* Wall and ceiling reference; an island stands free, so only the ceiling */}
        {run.island ? (
          <line x1={x(0)} x2={x(lengthIn)} y1={y(CEILING_IN)} y2={y(CEILING_IN)} stroke={HAIRLINE} strokeDasharray="4 3" />
        ) : (
          <rect x={x(wallLeft)} y={y(CEILING_IN)} width={(wallRight - wallLeft) * ppi} height={CEILING_IN * ppi} fill={QUIET_FILL} stroke={HAIRLINE} />
        )}
        <text x={x(wallLeft) + 4} y={y(CEILING_IN) + 12} fontSize={10} fill={INK_SECONDARY}>
          8' ceiling
        </text>

        {lowers.map(renderItem)}
        {counters.map((i) => (
          <rect
            key={`ct-${i.cabinet.id}`}
            x={x(i.left_in)}
            y={y(COUNTER_TOP_IN)}
            width={i.width_in * ppi}
            height={(COUNTER_TOP_IN - i.height_in) * ppi}
            fill={COUNTER_FILL}
          />
        ))}
        {uppers.map(renderItem)}

        {/* Floor */}
        <line x1={MARGIN_X / 2} x2={width - MARGIN_X / 2} y1={floorY} y2={floorY} stroke={INK} strokeWidth={2} />

        {/* Code and width: lowers under the floor line, uppers above their tops */}
        {lowers.map((i) => (
          <g key={`dl-${i.cabinet.id}`}>
            {fitsCode(i) && (
              <text x={x(i.left_in + i.width_in / 2)} y={codeY} textAnchor="middle" fontSize={10} fontWeight={600} fill={INK}>
                {i.cabinet.label || i.cabinet.preset_code}
              </text>
            )}
            <text x={x(i.left_in + i.width_in / 2)} y={dimY} textAnchor="middle" fontSize={10} fill={INK_SECONDARY}>
              {widthLabel(i)}
            </text>
          </g>
        ))}
        {uppers.map((i) => (
          <text
            key={`du-${i.cabinet.id}`}
            x={x(i.left_in + i.width_in / 2)}
            y={y(i.bottom_in + i.height_in) - 5}
            textAnchor="middle"
            fontSize={10}
            fill={INK_SECONDARY}
          >
            {fitsCode(i) ? (
              <>
                <tspan fontWeight={600} fill={INK}>{i.cabinet.label || i.cabinet.preset_code}</tspan>
                {`  ${widthLabel(i)}`}
              </>
            ) : (
              widthLabel(i)
            )}
          </text>
        ))}

        {/* Overall run length */}
        <g stroke={INK_SECONDARY} strokeWidth={1}>
          <line x1={x(0)} x2={x(lengthIn)} y1={totalY} y2={totalY} />
          <line x1={x(0)} x2={x(0)} y1={totalY - 5} y2={totalY + 5} />
          <line x1={x(lengthIn)} x2={x(lengthIn)} y1={totalY - 5} y2={totalY + 5} />
        </g>
        <rect x={x(lengthIn / 2) - 30} y={totalY - 8} width={60} height={16} fill="#ffffff" />
        <text x={x(lengthIn / 2)} y={totalY + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK}>
          {formatFeetInches(lengthIn)}
        </text>
      </svg>
    </div>
  );
};

export default CabinetElevationView;
