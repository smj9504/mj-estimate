/**
 * WMLegendRenderer
 * Renders a compact legend box on the canvas showing color codes for all
 * overlay element types present on the current floor.
 *
 * Usage:
 *   <WMLegendRenderer
 *     overlayData={overlayData}
 *     x={canvasWidth - 180}
 *     y={canvasHeight - legendHeight - 10}
 *     materialTypes={DEFAULT_DEMO_MATERIAL_TYPES}
 *   />
 */

import React, { useMemo } from 'react';
import { Group, Rect, Text, Line } from 'react-konva';
import {
  WMOverlayData,
  DemoMaterialType,
  DemoRenderMode,
  DemoStrokeStyle,
  EQUIPMENT_CONFIG,
  EquipmentType,
  WOOD_FLOOR_SUB_TYPES,
  WALL_MATERIAL_SUB_TYPES,
  WALL_MATERIAL_IDS,
  TRIM_SIZE_SUB_TYPES,
  TRIM_SIZE_MATERIAL_IDS,
  getEffectiveRenderMode,
} from '../../../../types/wmSketch';

export interface WMLegendRendererProps {
  overlayData: WMOverlayData;
  /** Canvas X position of the legend box */
  x: number;
  /** Canvas Y position of the legend box */
  y: number;
  materialTypes: DemoMaterialType[];
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------
const LEGEND_WIDTH = 170;
const PADDING = 10;
const ROW_HEIGHT = 18;
const SWATCH_SIZE = 12;
const FONT_SIZE = 11;
const TITLE_FONT_SIZE = 12;
const TITLE_ROW_HEIGHT = 20;
const SECTION_GAP = 6;
const SHADOW_BLUR = 6;
const SHADOW_OFFSET = 2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface LegendRow {
  kind: 'material' | 'equipment' | 'containment' | 'floor_protection' | 'content_protection' | 'content_manipulation';
  color: string;
  label: string;
  renderMode?: DemoRenderMode;
  strokeStyle?: DemoStrokeStyle;
}

function buildRows(
  overlayData: WMOverlayData,
  materialTypes: DemoMaterialType[],
): LegendRow[] {
  const rows: LegendRow[] = [];

  // Materials that actually appear in demolition zones (wood floor split by sub-type)
  const usedPairs = new Set<string>();
  for (const z of overlayData.demolition_zones) {
    usedPairs.add(`${z.material_type}|${z.sub_type || ''}`);
  }
  for (const mt of materialTypes) {
    if (mt.id === 'wood_floor') {
      for (const st of WOOD_FLOOR_SUB_TYPES) {
        if (usedPairs.has(`wood_floor|${st.id}`)) {
          rows.push({ kind: 'material', color: st.color, label: `${mt.name} (${st.name})` });
        }
      }
      if (usedPairs.has('wood_floor|')) {
        rows.push({ kind: 'material', color: mt.color, label: mt.name });
      }
    } else if (WALL_MATERIAL_IDS.has(mt.id)) {
      for (const st of WALL_MATERIAL_SUB_TYPES) {
        if (usedPairs.has(`${mt.id}|${st.id}`)) {
          rows.push({ kind: 'material', color: st.color, label: `${mt.name} (${st.name})` });
        }
      }
      if (usedPairs.has(`${mt.id}|`)) {
        rows.push({ kind: 'material', color: mt.color, label: mt.name });
      }
    } else if (TRIM_SIZE_MATERIAL_IDS.has(mt.id)) {
      // Trim / door / door demo: split legend by size sub-type
      for (const st of TRIM_SIZE_SUB_TYPES) {
        if (usedPairs.has(`${mt.id}|${st.id}`)) {
          rows.push({ kind: 'material', color: mt.color, label: `${mt.name} (${st.name})` });
        }
      }
      if (usedPairs.has(`${mt.id}|`)) {
        rows.push({ kind: 'material', color: mt.color, label: mt.name });
      }
    } else {
      const hasAny = overlayData.demolition_zones.some((z) => z.material_type === mt.id);
      if (hasAny) {
        rows.push({ kind: 'material', color: mt.color, label: mt.name, renderMode: getEffectiveRenderMode(mt), strokeStyle: mt.stroke_style });
      }
    }
  }

  // Equipment types that appear
  const equipmentKeys = Object.keys(EQUIPMENT_CONFIG) as EquipmentType[];
  for (const key of equipmentKeys) {
    const count = overlayData.equipment_placements.filter((p) => p.equipment_type === key).length;
    if (count > 0) {
      const cfg = EQUIPMENT_CONFIG[key];
      rows.push({ kind: 'equipment', color: cfg.color, label: `${cfg.name} (${count})` });
    }
  }

  // Containment
  if (overlayData.containment_zones.length > 0) {
    rows.push({
      kind: 'containment',
      color: '#2196F3',
      label: `Containment (${overlayData.containment_zones.length})`,
    });
  }

  // Floor protection
  if (overlayData.floor_protections.length > 0) {
    rows.push({
      kind: 'floor_protection',
      color: '#FFD700',
      label: `Floor Protection (${overlayData.floor_protections.length})`,
    });
  }

  // Content protection
  const contentProtections = overlayData.content_protections ?? [];
  if (contentProtections.length > 0) {
    rows.push({
      kind: 'content_protection',
      color: '#8B5CF6',
      label: `Content Protection (${contentProtections.length})`,
    });
  }

  // Content manipulation
  const contentManipulations = overlayData.content_manipulations ?? [];
  if (contentManipulations.length > 0) {
    rows.push({
      kind: 'content_manipulation',
      color: '#F97316',
      label: `Content Manipulation (${contentManipulations.length})`,
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const WMLegendRenderer: React.FC<WMLegendRendererProps> = ({
  overlayData,
  x,
  y,
  materialTypes,
}) => {
  const rows = useMemo(
    () => buildRows(overlayData, materialTypes),
    [overlayData, materialTypes],
  );

  if (rows.length === 0) return null;

  const boxHeight = PADDING + TITLE_ROW_HEIGHT + SECTION_GAP + rows.length * ROW_HEIGHT + PADDING;

  return (
    <Group x={x} y={y} listening={false}>
      {/* Background box with shadow simulation */}
      <Rect
        width={LEGEND_WIDTH}
        height={boxHeight}
        fill="#ffffff"
        stroke="#d9d9d9"
        strokeWidth={1}
        cornerRadius={4}
        shadowColor="rgba(0,0,0,0.18)"
        shadowBlur={SHADOW_BLUR}
        shadowOffsetX={SHADOW_OFFSET}
        shadowOffsetY={SHADOW_OFFSET}
      />

      {/* Title */}
      <Text
        x={PADDING}
        y={PADDING}
        text="Legend"
        fontSize={TITLE_FONT_SIZE}
        fontStyle="bold"
        fontFamily="'Inter', 'Segoe UI', sans-serif"
        fill="#1a1a1a"
        width={LEGEND_WIDTH - PADDING * 2}
      />

      {/* Divider */}
      <Line
        points={[PADDING, PADDING + TITLE_ROW_HEIGHT, LEGEND_WIDTH - PADDING, PADDING + TITLE_ROW_HEIGHT]}
        stroke="#e8e8e8"
        strokeWidth={1}
      />

      {/* Rows */}
      {rows.map((row, i) => {
        const rowY = PADDING + TITLE_ROW_HEIGHT + SECTION_GAP + i * ROW_HEIGHT;
        const swatchY = rowY + (ROW_HEIGHT - SWATCH_SIZE) / 2;

        return (
          <Group key={`legend-row-${i}`}>
            {row.kind === 'containment' ? (
              // Containment: dashed blue line swatch
              <Line
                points={[PADDING, swatchY + SWATCH_SIZE / 2, PADDING + SWATCH_SIZE, swatchY + SWATCH_SIZE / 2]}
                stroke={row.color}
                strokeWidth={3}
                dash={[4, 2]}
                lineCap="round"
              />
            ) : row.kind === 'content_protection' ? (
              // Content protection: purple cross-hatched rect swatch
              <Rect
                x={PADDING}
                y={swatchY}
                width={SWATCH_SIZE}
                height={SWATCH_SIZE}
                fill={row.color}
                opacity={0.4}
                stroke={row.color}
                strokeWidth={1}
                cornerRadius={1}
              />
            ) : row.kind === 'content_manipulation' ? (
              // Content manipulation: orange dashed rect swatch
              <Rect
                x={PADDING}
                y={swatchY}
                width={SWATCH_SIZE}
                height={SWATCH_SIZE}
                fill={row.color}
                opacity={0.15}
                stroke={row.color}
                strokeWidth={1.5}
                dash={[4, 2]}
                cornerRadius={1}
              />
            ) : row.kind === 'floor_protection' ? (
              // Floor protection: yellow filled rect
              <Rect
                x={PADDING}
                y={swatchY}
                width={SWATCH_SIZE}
                height={SWATCH_SIZE}
                fill={row.color}
                opacity={0.5}
                stroke={row.color}
                strokeWidth={1}
                cornerRadius={1}
              />
            ) : row.kind === 'material' && row.renderMode === 'line' ? (
              // Line render mode: horizontal line swatch
              <Line
                points={[PADDING, swatchY + SWATCH_SIZE / 2, PADDING + SWATCH_SIZE, swatchY + SWATCH_SIZE / 2]}
                stroke={row.color}
                strokeWidth={3}
                dash={row.strokeStyle === 'dashed' ? [4, 2] : row.strokeStyle === 'dotted' ? [2, 2] : undefined}
                lineCap="round"
              />
            ) : row.kind === 'material' && row.renderMode === 'text' ? (
              // Text render mode: "A" label swatch
              <Text
                x={PADDING}
                y={swatchY - 1}
                text="A"
                fontSize={SWATCH_SIZE}
                fontStyle="bold"
                fontFamily="Arial"
                fill={row.color}
              />
            ) : (
              // Material (area/shape) or equipment: solid colored square
              <Rect
                x={PADDING}
                y={swatchY}
                width={SWATCH_SIZE}
                height={SWATCH_SIZE}
                fill={row.color}
                opacity={row.kind === 'material' ? 0.7 : 1}
                cornerRadius={row.kind === 'equipment' ? 6 : row.renderMode === 'shape' ? 3 : 1}
                dash={row.kind === 'material' && row.strokeStyle === 'dashed' ? [3, 2] : row.strokeStyle === 'dotted' ? [2, 1] : undefined}
                stroke={row.kind === 'material' && row.strokeStyle ? row.color : undefined}
                strokeWidth={row.kind === 'material' && row.strokeStyle ? 1 : 0}
              />
            )}

            <Text
              x={PADDING + SWATCH_SIZE + 6}
              y={rowY + (ROW_HEIGHT - FONT_SIZE) / 2}
              text={row.label}
              fontSize={FONT_SIZE}
              fontFamily="'Inter', 'Segoe UI', sans-serif"
              fill="#333333"
              width={LEGEND_WIDTH - PADDING * 2 - SWATCH_SIZE - 6}
              wrap="none"
              ellipsis
            />
          </Group>
        );
      })}
    </Group>
  );
};

export default React.memo(WMLegendRenderer);
