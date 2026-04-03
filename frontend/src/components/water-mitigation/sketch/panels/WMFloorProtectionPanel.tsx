/**
 * WMFloorProtectionPanel - Sidebar panel for managing floor protection strips.
 *
 * Total protection area is prominently displayed at the top.
 * Lists each strip showing length and sqft.
 * Width is fixed at paperWidthFt (typically 3 ft) — shown as info, not editable inline.
 * Click a strip to select it on the canvas.
 *
 * Usage:
 *   <WMFloorProtectionPanel
 *     protections={overlayData.floorProtections}
 *     selectedProtectionId={selection?.elementType === 'floor_protection' ? selection.elementId : null}
 *     onUpdateProtection={(id, updates) => handleUpdateProtection(id, updates)}
 *     onDeleteProtection={(id) => handleDeleteProtection(id)}
 *     onSelectProtection={(id) => handleSelect(id, 'floor_protection')}
 *   />
 */
import React, { useMemo } from 'react';
import { Button, Space, Typography, Divider, Popconfirm, Tooltip, Tag } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { WMFloorProtection } from '../../../../types/wmSketch';
import { formatDimension } from '../utils/wmCalculations';

const { Text } = Typography;

export interface WMFloorProtectionPanelProps {
  protections: WMFloorProtection[];
  selectedProtectionId: string | null;
  onUpdateProtection: (id: string, updates: Partial<WMFloorProtection>) => void;
  onDeleteProtection: (id: string) => void;
  onSelectProtection: (id: string) => void;
}

const ProtectionSwatch: React.FC<{ color: string }> = ({ color }) => (
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

const WMFloorProtectionPanel: React.FC<WMFloorProtectionPanelProps> = ({
  protections,
  selectedProtectionId,
  onUpdateProtection: _onUpdateProtection, // reserved for future inline edits
  onDeleteProtection,
  onSelectProtection,
}) => {
  const totalSqft = useMemo(
    () => protections.reduce((sum, p) => sum + p.calculated_sqft, 0),
    [protections]
  );

  // Group by protection type to show a clean summary per type
  const grouped = useMemo(() => {
    const map = new Map<string, WMFloorProtection[]>();
    for (const p of protections) {
      const existing = map.get(p.protection_type);
      if (existing) {
        existing.push(p);
      } else {
        map.set(p.protection_type, [p]);
      }
    }
    return Array.from(map.entries());
  }, [protections]);

  if (protections.length === 0) {
    return (
      <div style={{ padding: '8px 0' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          No floor protection strips added. Select the Floor Protection tool and draw on the
          canvas.
        </Text>
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 0' }}>
      {/* Prominent total area */}
      <div
        style={{
          backgroundColor: '#fffbe6',
          border: '1px solid #ffe58f',
          borderRadius: 6,
          padding: '8px 12px',
          marginBottom: 10,
          textAlign: 'center',
        }}
      >
        <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
          Total Floor Protection
        </Text>
        <Text
          strong
          style={{ fontSize: 20, fontVariantNumeric: 'tabular-nums', lineHeight: 1.3 }}
        >
          {Math.round(totalSqft)} SF
        </Text>
        <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>
          {totalSqft.toFixed(2)} exact — {protections.length} strip
          {protections.length !== 1 ? 's' : ''}
        </Text>
      </div>

      <Divider style={{ margin: '0 0 8px 0' }} />

      {/* Grouped strip list */}
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        {grouped.map(([protectionType, items]) => {
          const widthLabel = items[0]
            ? `${formatDimension(items[0].paper_width_ft)} width`
            : '';
          const groupSqft = items.reduce((s, p) => s + p.calculated_sqft, 0);

          return (
            <div key={protectionType}>
              {/* Group header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 4px 4px 4px',
                }}
              >
                <ProtectionSwatch color={items[0]?.color ?? '#FFD700'} />
                <Text style={{ fontSize: 12, fontWeight: 500, flex: 1 }}>
                  {protectionType}
                </Text>
                {widthLabel && (
                  <Tag color="default" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                    {widthLabel}
                  </Tag>
                )}
                <Text
                  type="secondary"
                  style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
                >
                  {groupSqft.toFixed(1)} SF
                </Text>
              </div>

              {/* Individual strips */}
              {items.map((protection, i) => {
                const isSelected = protection.id === selectedProtectionId;
                return (
                  <div
                    key={protection.id}
                    onClick={() => onSelectProtection(protection.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 8px',
                      borderRadius: 4,
                      cursor: 'pointer',
                      marginBottom: 2,
                      backgroundColor: isSelected ? '#fffbe6' : 'transparent',
                      border: isSelected ? '1px solid #ffe58f' : '1px solid transparent',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.backgroundColor = '#fafafa';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <Text type="secondary" style={{ fontSize: 11, minWidth: 16 }}>
                      {i + 1}.
                    </Text>
                    <div style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11 }}>
                        {formatDimension(protection.length_ft)} long
                      </Text>
                      <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>
                        {formatDimension(protection.paper_width_ft)} wide
                      </Text>
                    </div>
                    <Tooltip
                      title={`${protection.calculated_sqft.toFixed(2)} SF`}
                      placement="left"
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          fontVariantNumeric: 'tabular-nums',
                          color: '#595959',
                        }}
                      >
                        {protection.calculated_sqft.toFixed(1)} SF
                      </Text>
                    </Tooltip>
                    <Popconfirm
                      title="Remove this protection strip?"
                      onConfirm={(e) => {
                        e?.stopPropagation();
                        onDeleteProtection(protection.id);
                      }}
                      onCancel={(e) => e?.stopPropagation()}
                      okText="Remove"
                      okType="danger"
                      cancelText="Cancel"
                    >
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined style={{ fontSize: 11 }} />}
                        onClick={(e) => e.stopPropagation()}
                        style={{ padding: '0 4px', height: 20 }}
                      />
                    </Popconfirm>
                  </div>
                );
              })}
            </div>
          );
        })}
      </Space>
    </div>
  );
};

export default WMFloorProtectionPanel;
