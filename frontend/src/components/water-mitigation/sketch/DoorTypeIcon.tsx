/**
 * DoorTypeIcon
 * 14×14 menu glyph for a door style, drawn from the same primitives as the canvas.
 */

import React from 'react';
import type { DoorType } from '../../../types/wmSketch';
import { DOOR_TYPES, doorSymbol, swingSectorPath } from './utils/doorSymbols';

const ICON_W = 13;

const DoorTypeIcon: React.FC<{ type: DoorType; color: string }> = ({ type, color }) => {
  const cfg = DOOR_TYPES[type];
  // Doors that swing or fold get their real proportions; sliding styles a fixed thin band
  const h = 'ratio' in cfg.depth
    ? Math.max(5, (ICON_W * cfg.depth.ratio) / (cfg.parks_beside ? 2 : 1))
    : 5;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" style={{ flexShrink: 0, overflow: 'visible' }}>
      <g transform={`translate(0.5, ${(14 - h) / 2})`}>
        {doorSymbol(type, ICON_W, h, false).map((p, i) => {
          switch (p.kind) {
            case 'line': {
              const pts: string[] = [];
              for (let j = 0; j < p.points.length; j += 2) pts.push(`${p.points[j]},${p.points[j + 1]}`);
              return (
                <polyline
                  key={i}
                  points={pts.join(' ')}
                  fill="none"
                  stroke={color}
                  strokeWidth={p.weight === 'panel' ? 1.5 : 1}
                  strokeDasharray={p.dashed ? '2 1.5' : undefined}
                />
              );
            }
            case 'rect':
              return (
                <rect
                  key={i}
                  x={p.x}
                  y={p.y}
                  width={p.width}
                  height={p.height}
                  fill={p.dashed ? 'none' : '#ffffff'}
                  stroke={color}
                  strokeWidth={1}
                  strokeDasharray={p.dashed ? '1.5 1' : undefined}
                />
              );
            case 'swing':
              return <path key={i} d={swingSectorPath(p)} fill="none" stroke={color} strokeWidth={1} />;
            case 'hinge':
              return <circle key={i} cx={p.x} cy={p.y} r={1.5} fill={color} />;
            default:
              return null;
          }
        })}
      </g>
    </svg>
  );
};

export default DoorTypeIcon;
