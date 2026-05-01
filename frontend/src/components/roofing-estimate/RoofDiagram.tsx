/**
 * RoofDiagram - Interactive SVG roof plan from EagleView data.
 * Shows face polygons with labels, color-coded line types,
 * and click-to-select faces for partial roof estimates.
 */

import React, { useMemo } from 'react';
import { Card, Tag, Typography } from 'antd';
import type { EagleViewFace, EagleViewLine, Point2D } from '../../types/roofingEstimate';

const { Text } = Typography;

const LINE_COLORS: Record<string, string> = {
  RIDGE: '#ff4d4d',
  HIP: '#ff9900',
  VALLEY: '#4da6ff',
  RAKE: '#00cc66',
  EAVE: '#b0b0b0',
  FLASHING: '#cc66ff',
  STEPFLASH: '#ffee44',
  OTHER: '#aaaaaa',
};

const LINE_LABELS: Record<string, string> = {
  RIDGE: 'Ridge',
  HIP: 'Hip',
  VALLEY: 'Valley',
  RAKE: 'Rake',
  EAVE: 'Eave',
  FLASHING: 'Flashing',
  STEPFLASH: 'Step Flash',
};

interface RoofDiagramProps {
  faces: EagleViewFace[];
  lines: EagleViewLine[];
  selectedFaceIds: string[];
  onFaceToggle: (faceId: string) => void;
  height?: number;
}

const RoofDiagram: React.FC<RoofDiagramProps> = ({
  faces,
  lines,
  selectedFaceIds,
  onFaceToggle,
  height = 400,
}) => {
  // Compute SVG viewBox from all face vertices
  const { viewBox, scale } = useMemo(() => {
    const allPoints: Point2D[] = [];
    for (const face of faces) {
      if (face.vertices) allPoints.push(...face.vertices);
    }
    if (!allPoints.length) {
      return { viewBox: '0 0 100 100', scale: 1 };
    }

    const xs = allPoints.map(p => p.x);
    const ys = allPoints.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const padding = Math.max(maxX - minX, maxY - minY) * 0.08;
    const vbX = minX - padding;
    const vbY = minY - padding;
    const vbW = (maxX - minX) + padding * 2;
    const vbH = (maxY - minY) + padding * 2;

    return {
      viewBox: `${vbX} ${vbY} ${vbW} ${vbH}`,
      scale: vbW / 600, // approximate for font sizing
    };
  }, [faces]);

  // Separate main faces vs accessories
  const mainFaces = useMemo(
    () => faces.filter(f => !f.is_accessory && f.vertices && f.vertices.length >= 3),
    [faces],
  );

  const accessoryFaces = useMemo(
    () => faces.filter(f => f.is_accessory && f.vertices && f.vertices.length >= 3),
    [faces],
  );

  // Visible line types for legend (only types that exist in data)
  const lineTypes = useMemo(() => {
    const types = new Set<string>();
    for (const line of lines) {
      if (line.points && line.points.length >= 2) types.add(line.type);
    }
    return Array.from(types);
  }, [lines]);

  const selectedSet = useMemo(() => new Set(selectedFaceIds), [selectedFaceIds]);

  if (!mainFaces.length) {
    return null;
  }

  const fontSize = Math.max(scale * 9, 2);
  const smallFont = Math.max(scale * 6.5, 1.5);

  return (
    <Card
      size="small"
      title="Roof Diagram"
      extra={
        <Text type="secondary" style={{ fontSize: 12 }}>
          Click face to select/deselect
        </Text>
      }
      style={{ marginBottom: 16 }}
    >
      <svg
        viewBox={viewBox}
        width="100%"
        height={height}
        style={{ background: '#f5f5f5', borderRadius: 4, cursor: 'crosshair' }}
      >
        {/* Face polygons */}
        {mainFaces.map(face => {
          const isSelected = selectedSet.has(face.id);
          const pts = face.vertices!.map(v => `${v.x},${v.y}`).join(' ');
          return (
            <g key={face.id} onClick={() => onFaceToggle(face.id)} style={{ cursor: 'pointer' }}>
              <polygon
                points={pts}
                fill={isSelected ? 'rgba(24, 144, 255, 0.18)' : 'rgba(200, 200, 200, 0.15)'}
                stroke={isSelected ? '#1677ff' : '#999'}
                strokeWidth={scale * 1}
              />
              {/* Face label */}
              {face.centroid && (
                <>
                  <text
                    x={face.centroid.x}
                    y={face.centroid.y - fontSize * 0.3}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={fontSize}
                    fontWeight="bold"
                    fill={isSelected ? '#1677ff' : '#333'}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {face.designator}
                  </text>
                  <text
                    x={face.centroid.x}
                    y={face.centroid.y + fontSize * 0.7}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={smallFont}
                    fill="#888"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {face.area.toLocaleString()} SF
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* Accessory faces (penetrations) */}
        {accessoryFaces.map(face => {
          const pts = face.vertices!.map(v => `${v.x},${v.y}`).join(' ');
          return (
            <polygon
              key={face.id}
              points={pts}
              fill="rgba(100, 100, 100, 0.3)"
              stroke="#666"
              strokeWidth={scale * 0.5}
              strokeDasharray={`${scale * 2},${scale * 2}`}
            />
          );
        })}

        {/* Lines overlay */}
        {lines.map(line => {
          if (!line.points || line.points.length < 2) return null;
          const color = LINE_COLORS[line.type] || LINE_COLORS.OTHER;
          const pathData = line.points
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`)
            .join(' ');
          return (
            <path
              key={line.id}
              d={pathData}
              stroke={color}
              strokeWidth={scale * (line.type === 'RIDGE' || line.type === 'HIP' ? 1.5 : 0.8)}
              fill="none"
              style={{ pointerEvents: 'none' }}
            />
          );
        })}
      </svg>

      {/* Legend */}
      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {lineTypes.map(type => (
          <Tag
            key={type}
            color={LINE_COLORS[type] || '#aaa'}
            style={{ margin: 0, fontSize: 11 }}
          >
            {LINE_LABELS[type] || type}
          </Tag>
        ))}
        <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>
          Selected: {selectedFaceIds.length} / {mainFaces.length} faces
        </Tag>
      </div>
    </Card>
  );
};

export default RoofDiagram;
