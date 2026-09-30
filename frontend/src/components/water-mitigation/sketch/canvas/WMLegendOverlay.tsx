/**
 * WMLegendOverlay
 *
 * HTML-based legend overlay positioned at the bottom-right of the canvas
 * container. Independent of Konva zoom/pan so it stays at a fixed size
 * and position regardless of canvas transforms.
 *
 * Supports show/hide toggle via a small button.
 */

import React, { useMemo, useState } from 'react';
import {
  WMOverlayData,
  DemoMaterialType,
  EQUIPMENT_CONFIG,
  EquipmentType,
  WOOD_FLOOR_SUB_TYPES,
  WALL_MATERIAL_SUB_TYPES,
  WALL_MATERIAL_IDS,
} from '../../../../types/wmSketch';

export interface WMLegendOverlayProps {
  overlayData: WMOverlayData;
  materialTypes: DemoMaterialType[];
}

// ---------------------------------------------------------------------------
// Row data
// ---------------------------------------------------------------------------

interface LegendRow {
  kind: 'material' | 'equipment' | 'containment' | 'floor_protection' | 'content_protection';
  color: string;
  label: string;
}

function buildRows(
  overlayData: WMOverlayData,
  materialTypes: DemoMaterialType[],
): LegendRow[] {
  const rows: LegendRow[] = [];

  // Build unique (material_type, sub_type) pairs
  const usedPairs = new Set<string>();
  for (const z of overlayData.demolition_zones) {
    usedPairs.add(`${z.material_type}|${z.sub_type || ''}`);
  }
  for (const mt of materialTypes) {
    if (mt.id === 'wood_floor') {
      // Show each wood floor sub-type separately
      for (const st of WOOD_FLOOR_SUB_TYPES) {
        if (usedPairs.has(`wood_floor|${st.id}`)) {
          rows.push({ kind: 'material', color: st.color, label: `${mt.name} (${st.name})` });
        }
      }
      // Also show generic wood floor (no sub-type)
      if (usedPairs.has('wood_floor|')) {
        rows.push({ kind: 'material', color: mt.color, label: mt.name });
      }
    } else if (WALL_MATERIAL_IDS.has(mt.id)) {
      // Show each wall material sub-type separately
      for (const st of WALL_MATERIAL_SUB_TYPES) {
        if (usedPairs.has(`${mt.id}|${st.id}`)) {
          rows.push({ kind: 'material', color: st.color, label: `${mt.name} (${st.name})` });
        }
      }
      // Also show generic wall (no sub-type)
      if (usedPairs.has(`${mt.id}|`)) {
        rows.push({ kind: 'material', color: mt.color, label: mt.name });
      }
    } else {
      const hasAny = overlayData.demolition_zones.some((z) => z.material_type === mt.id);
      if (hasAny) {
        rows.push({ kind: 'material', color: mt.color, label: mt.name });
      }
    }
  }

  // Carpet Pad — show when any carpet zone has include_pad checked
  const hasCarpetPad = overlayData.demolition_zones.some(
    (z) => z.material_type === 'carpet' && z.include_pad
  );
  if (hasCarpetPad) {
    rows.push({ kind: 'material', color: '#52c41a', label: 'Carpet Pad' });
  }

  const equipmentKeys = Object.keys(EQUIPMENT_CONFIG) as EquipmentType[];
  for (const key of equipmentKeys) {
    const count = overlayData.equipment_placements.filter((p) => p.equipment_type === key).length;
    if (count > 0) {
      const cfg = EQUIPMENT_CONFIG[key];
      rows.push({ kind: 'equipment', color: cfg.color, label: `${cfg.name} (${count})` });
    }
  }

  if (overlayData.containment_zones.length > 0) {
    rows.push({
      kind: 'containment',
      color: '#2196F3',
      label: `Containment (${overlayData.containment_zones.length})`,
    });
  }

  const regularFP = overlayData.floor_protections.filter((fp) => !fp.is_stair);
  const stairFP = overlayData.floor_protections.filter((fp) => fp.is_stair);
  if (regularFP.length > 0) {
    rows.push({
      kind: 'floor_protection',
      color: '#FFD700',
      label: `Floor Protection (${regularFP.length})`,
    });
  }
  if (stairFP.length > 0) {
    rows.push({
      kind: 'floor_protection',
      color: '#FF8C00',
      label: `Floor Prot - Stairs (${stairFP.length})`,
    });
  }

  const contentProtections = overlayData.content_protections ?? [];
  if (contentProtections.length > 0) {
    rows.push({
      kind: 'content_protection',
      color: '#8B5CF6',
      label: `Content Protection (${contentProtections.length})`,
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Swatch component
// ---------------------------------------------------------------------------

const Swatch: React.FC<{ row: LegendRow }> = ({ row }) => {
  const base: React.CSSProperties = {
    width: 12,
    height: 12,
    flexShrink: 0,
    borderRadius: row.kind === 'equipment' ? 6 : 2,
  };

  if (row.kind === 'containment') {
    return (
      <div
        style={{
          ...base,
          borderRadius: 0,
          borderBottom: `3px dashed ${row.color}`,
          height: 0,
          marginTop: 6,
        }}
      />
    );
  }

  const opacity =
    row.kind === 'material' ? 0.7 :
    row.kind === 'floor_protection' ? 0.5 :
    row.kind === 'content_protection' ? 0.4 : 1;

  return (
    <div
      style={{
        ...base,
        background: row.color,
        opacity,
        border: (row.kind === 'floor_protection' || row.kind === 'content_protection')
          ? `1px solid ${row.color}`
          : undefined,
      }}
    />
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const WMLegendOverlay: React.FC<WMLegendOverlayProps> = ({
  overlayData,
  materialTypes,
}) => {
  const [visible, setVisible] = useState(true);

  const rows = useMemo(
    () => buildRows(overlayData, materialTypes),
    [overlayData, materialTypes],
  );

  if (rows.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        // Anchored between the top and bottom of the canvas container (not
        // just `bottom: 8`) so its own max-height below can be expressed as
        // a real available-space percentage instead of a guessed pixel cap
        // — on a short viewport (laptop chrome eating vertical space) the
        // legend now shrinks with the canvas instead of dominating it.
        top: 8,
        bottom: 8,
        right: 8,
        zIndex: 20,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        alignItems: 'flex-end',
        gap: 4,
        overflow: 'hidden',
      }}
    >
      {/* Toggle button */}
      <button
        onClick={() => setVisible((v) => !v)}
        style={{
          background: 'rgba(255,255,255,0.92)',
          border: '1px solid #d9d9d9',
          borderRadius: 4,
          padding: '2px 8px',
          fontSize: 11,
          cursor: 'pointer',
          color: '#595959',
          lineHeight: '18px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          pointerEvents: 'auto',
          flexShrink: 0,
        }}
        title={visible ? 'Hide legend' : 'Show legend'}
      >
        {visible ? 'Hide Legend' : 'Show Legend'}
      </button>

      {/* Legend box — capped to the remaining space in this wrapper (which
          spans the canvas container's full height) with its own scroll, so
          a long legend never grows taller than the canvas itself and
          dominates a short viewport (laptop browser chrome eating vertical
          space, in particular). */}
      {visible && (
        <div
          style={{
            background: 'rgba(255,255,255,0.95)',
            border: '1px solid #d9d9d9',
            borderRadius: 6,
            padding: '8px 12px',
            minWidth: 160,
            maxWidth: 220,
            flexShrink: 1,
            minHeight: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            backdropFilter: 'blur(4px)',
            pointerEvents: 'auto',
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#1a1a1a',
              marginBottom: 4,
              borderBottom: '1px solid #e8e8e8',
              paddingBottom: 4,
              fontFamily: "'Inter', 'Segoe UI', sans-serif",
              flexShrink: 0,
            }}
          >
            Legend
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'auto', minHeight: 0 }}>
            {rows.map((row, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Swatch row={row} />
                <span
                  style={{
                    fontSize: 11,
                    color: '#333',
                    fontFamily: "'Inter', 'Segoe UI', sans-serif",
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {row.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(WMLegendOverlay);
