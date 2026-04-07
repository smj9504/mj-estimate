/**
 * WMContentProtectionPanel - Sidebar panel for managing content protection areas.
 *
 * Displays total coverage area prominently at the top.
 * Lists each protection area with dimensions and sqft.
 * Click an item to select it on the canvas.
 */
import React, { useMemo } from 'react';
import { Button, Select, Space, Typography, Divider, Popconfirm, Tooltip } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { WMContentProtection } from '../../../../types/wmSketch';
import { calcContentProtectionSqft, formatDimension } from '../utils/wmCalculations';
import { CONTENT_PROTECTION_TYPE_PRESETS } from '../utils/wmDefaults';
import DimensionInput from './DimensionInput';

const { Text } = Typography;

export interface WMContentProtectionPanelProps {
  protections: WMContentProtection[];
  selectedProtectionId: string | null;
  onUpdateProtection: (id: string, updates: Partial<WMContentProtection>) => void;
  onDeleteProtection: (id: string) => void;
  onSelectProtection: (id: string) => void;
}

const ContentSwatch: React.FC<{ color: string }> = ({ color }) => (
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

const ProtectionEditForm: React.FC<{
  protection: WMContentProtection;
  onUpdate: (updates: Partial<WMContentProtection>) => void;
  onDelete: () => void;
}> = ({ protection, onUpdate, onDelete }) => {
  const calculatedSqft = useMemo(
    () => calcContentProtectionSqft(protection.width_ft, protection.length_ft),
    [protection.width_ft, protection.length_ft]
  );

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      {/* Protection type */}
      <div>
        <Text style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
          Protection Type
        </Text>
        <Select
          size="small"
          value={protection.protection_type}
          onChange={(value) => onUpdate({ protection_type: value })}
          style={{ width: '100%' }}
          options={CONTENT_PROTECTION_TYPE_PRESETS.map((t) => ({ label: t, value: t }))}
          showSearch
          allowClear={false}
        />
      </div>

      {/* Width / Length */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <DimensionInput
          label="Width"
          value={protection.width_ft}
          onChange={(ft) =>
            onUpdate({
              width_ft: ft,
              calculated_sqft: calcContentProtectionSqft(ft, protection.length_ft),
            })
          }
        />
        <DimensionInput
          label="Length"
          value={protection.length_ft}
          onChange={(ft) =>
            onUpdate({
              length_ft: ft,
              calculated_sqft: calcContentProtectionSqft(protection.width_ft, ft),
            })
          }
        />
      </div>

      {/* Calculated sqft */}
      <div
        style={{
          backgroundColor: '#f5f3ff',
          borderRadius: 4,
          padding: '4px 8px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Text style={{ fontSize: 12, color: '#666' }}>Area</Text>
        <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>
          {calculatedSqft.toFixed(2)} SF
        </Text>
      </div>

      {/* Delete */}
      <Popconfirm
        title="Delete this content protection?"
        onConfirm={onDelete}
        okText="Delete"
        okType="danger"
        cancelText="Cancel"
      >
        <Button type="default" danger size="small" icon={<DeleteOutlined />} block>
          Delete Protection
        </Button>
      </Popconfirm>
    </Space>
  );
};

const WMContentProtectionPanel: React.FC<WMContentProtectionPanelProps> = ({
  protections,
  selectedProtectionId,
  onUpdateProtection,
  onDeleteProtection,
  onSelectProtection,
}) => {
  const selectedProtection = selectedProtectionId
    ? protections.find((p) => p.id === selectedProtectionId)
    : null;

  const totalSqft = useMemo(
    () => protections.reduce((sum, p) => sum + p.calculated_sqft, 0),
    [protections]
  );

  if (selectedProtection) {
    return (
      <div style={{ padding: '8px 0' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 10,
            padding: '0 2px',
          }}
        >
          <ContentSwatch color={selectedProtection.color} />
          <Text style={{ fontSize: 12, fontWeight: 500, flex: 1 }}>
            {selectedProtection.protection_type || 'Content Protection'}
          </Text>
          <Tooltip title="Deselect (click empty canvas area)">
            <Text type="secondary" style={{ fontSize: 11 }}>
              editing
            </Text>
          </Tooltip>
        </div>
        <ProtectionEditForm
          protection={selectedProtection}
          onUpdate={(updates) => onUpdateProtection(selectedProtection.id, updates)}
          onDelete={() => onDeleteProtection(selectedProtection.id)}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 0' }}>
      {/* Total area header */}
      {protections.length > 0 && (
        <>
          <div
            style={{
              backgroundColor: '#f5f3ff',
              border: '1px solid #c4b5fd',
              borderRadius: 6,
              padding: '8px 12px',
              marginBottom: 10,
              textAlign: 'center',
            }}
          >
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
              Total Content Protection
            </Text>
            <Text
              strong
              style={{ fontSize: 20, fontVariantNumeric: 'tabular-nums', lineHeight: 1.3 }}
            >
              {Math.round(totalSqft)} SF
            </Text>
            <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>
              {totalSqft.toFixed(2)} exact — {protections.length} area
              {protections.length !== 1 ? 's' : ''}
            </Text>
          </div>
          <Divider style={{ margin: '0 0 8px 0' }} />
        </>
      )}

      {/* Protection list */}
      {protections.length === 0 ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          No content protection added. Select the Content Protection tool and draw on the canvas.
        </Text>
      ) : (
        <Space direction="vertical" size={2} style={{ width: '100%' }}>
          {protections.map((protection, i) => {
            const isSelected = protection.id === selectedProtectionId;
            return (
              <div
                key={protection.id}
                onClick={() => onSelectProtection(protection.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 8px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  backgroundColor: isSelected ? '#f5f3ff' : 'transparent',
                  border: isSelected ? '1px solid #c4b5fd' : '1px solid transparent',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = '#e6f7ff';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <ContentSwatch color={protection.color} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 12 }}>
                    {protection.protection_type || `Area ${i + 1}`}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>
                    {formatDimension(protection.width_ft)} x {formatDimension(protection.length_ft)}
                  </Text>
                </div>
                <Text
                  type="secondary"
                  style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
                >
                  {protection.calculated_sqft.toFixed(1)} SF
                </Text>
              </div>
            );
          })}
        </Space>
      )}
    </div>
  );
};

export default WMContentProtectionPanel;
