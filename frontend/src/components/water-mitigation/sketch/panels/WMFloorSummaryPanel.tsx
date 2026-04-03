/**
 * WMFloorSummaryPanel - Read-only summary card showing per-floor totals.
 *
 * Displays demolition by material type, containment area, floor protection area,
 * and equipment counts in a clean card layout.
 *
 * Usage:
 *   <WMFloorSummaryPanel summary={calcFloorTotals(overlayData)} />
 */
import React from 'react';
import { Divider, Space, Typography } from 'antd';
import type { WMFloorSummary, EquipmentType } from '../../../../types/wmSketch';
import { EQUIPMENT_CONFIG } from '../../../../types/wmSketch';

const { Text } = Typography;

export interface WMFloorSummaryProps {
  summary: WMFloorSummary;
}

const ColorSwatch: React.FC<{ color: string }> = ({ color }) => (
  <span
    style={{
      display: 'inline-block',
      width: 10,
      height: 10,
      borderRadius: 2,
      backgroundColor: color,
      border: '1px solid rgba(0,0,0,0.15)',
      flexShrink: 0,
      verticalAlign: 'middle',
    }}
  />
);

/** A single row in the summary table */
const SummaryRow: React.FC<{
  label: React.ReactNode;
  value: React.ReactNode;
  secondary?: React.ReactNode;
  indent?: boolean;
}> = ({ label, value, secondary, indent = false }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: `2px ${indent ? '0' : '0'}`,
      paddingLeft: indent ? 16 : 0,
    }}
  >
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
      {label}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
      <Text strong style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Text>
      {secondary && (
        <Text type="secondary" style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
          {secondary}
        </Text>
      )}
    </div>
  </div>
);

const WMFloorSummaryPanel: React.FC<WMFloorSummaryProps> = ({ summary }) => {
  const hasDemolition = summary.demolition_by_type.length > 0;
  const hasContainment = summary.containment.count > 0;
  const hasFloorProtection = summary.floor_protection.count > 0;
  const equipmentTypes = Object.entries(summary.equipment_counts) as [EquipmentType, number][];
  const hasEquipment = equipmentTypes.some(([, count]) => count > 0);

  const isEmpty = !hasDemolition && !hasContainment && !hasFloorProtection && !hasEquipment;

  if (isEmpty) {
    return (
      <div style={{ padding: '8px 0' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          No elements on this floor yet.
        </Text>
      </div>
    );
  }

  return (
    <div style={{ padding: '4px 0' }}>
      <Space direction="vertical" size={0} style={{ width: '100%' }}>

        {/* Tear Out section */}
        {hasDemolition && (
          <>
            <Text
              type="secondary"
              style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}
            >
              Tear Out
            </Text>
            {summary.demolition_by_type.map((item) => (
              <SummaryRow
                key={item.material_type}
                label={
                  <>
                    <ColorSwatch color={item.color} />
                    <Text style={{ fontSize: 12 }}>{item.material_name}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {item.count}x
                    </Text>
                  </>
                }
                value={`${item.total_sqft.toFixed(0)} ${item.unit}`}
                secondary={item.total_sqft.toFixed(2) !== item.total_sqft.toFixed(0) ? `${item.total_sqft.toFixed(2)} ${item.unit}` : undefined}
              />
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 2 }}>
              <Text
                type="secondary"
                style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
              >
                {summary.demolition_by_type.reduce((s, d) => s + d.total_sqft, 0).toFixed(2)} SF total
              </Text>
            </div>
          </>
        )}

        {/* Containment section */}
        {hasContainment && (
          <>
            {hasDemolition && <Divider style={{ margin: '6px 0' }} />}
            <SummaryRow
              label={
                <Text style={{ fontSize: 12 }}>
                  Containment
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                    {summary.containment.count}x
                  </Text>
                </Text>
              }
              value={`${summary.containment.total_sqft.toFixed(0)} SF`}
              secondary={`${summary.containment.total_sqft.toFixed(2)} SF`}
            />
          </>
        )}

        {/* Floor Protection section */}
        {hasFloorProtection && (
          <>
            {(hasDemolition || hasContainment) && <Divider style={{ margin: '6px 0' }} />}
            <SummaryRow
              label={
                <Text style={{ fontSize: 12 }}>
                  Floor Protection
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                    {summary.floor_protection.count}x
                  </Text>
                </Text>
              }
              value={`${summary.floor_protection.total_sqft.toFixed(0)} SF`}
              secondary={`${summary.floor_protection.total_sqft.toFixed(2)} SF`}
            />
          </>
        )}

        {/* Equipment section */}
        {hasEquipment && (
          <>
            {(hasDemolition || hasContainment || hasFloorProtection) && (
              <Divider style={{ margin: '6px 0' }} />
            )}
            <Text
              type="secondary"
              style={{
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                display: 'block',
                marginBottom: 4,
              }}
            >
              Equipment
            </Text>
            {equipmentTypes.map(([type, count]) => {
              if (count === 0) return null;
              const config = EQUIPMENT_CONFIG[type];
              return (
                <SummaryRow
                  key={type}
                  label={
                    <Text style={{ fontSize: 12 }}>{config.name}:</Text>
                  }
                  value={count}
                />
              );
            })}
          </>
        )}
      </Space>
    </div>
  );
};

export default WMFloorSummaryPanel;
