/**
 * WMContentManipulationPanel - Sidebar panel for managing content manipulation areas.
 *
 * Displays total coverage area prominently at the top.
 * Lists each manipulation area with type, dimensions, and sqft.
 * Click an item to select it on the canvas.
 */
import React, { useMemo } from 'react';
import { Button, Select, Space, Typography, Divider, Popconfirm, Tooltip } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { WMContentManipulation } from '../../../../types/wmSketch';
import DimensionInput from './DimensionInput';

const { Text } = Typography;

const MANIPULATION_TYPE_PRESETS = [
  'Move out',
  'Move within room',
  'Move back',
];

export interface WMContentManipulationPanelProps {
  manipulations: WMContentManipulation[];
  selectedManipulationId: string | null;
  onUpdateManipulation: (id: string, updates: Partial<WMContentManipulation>) => void;
  onDeleteManipulation: (id: string) => void;
  onSelectManipulation: (id: string) => void;
}

const ManipSwatch: React.FC<{ color: string }> = ({ color }) => (
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

const ManipEditForm: React.FC<{
  manipulation: WMContentManipulation;
  onUpdate: (updates: Partial<WMContentManipulation>) => void;
  onDelete: () => void;
}> = ({ manipulation, onUpdate, onDelete }) => {
  const calculatedSqft = useMemo(
    () => manipulation.width_ft * manipulation.length_ft,
    [manipulation.width_ft, manipulation.length_ft]
  );

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      {/* Manipulation type */}
      <div>
        <Text style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
          Manipulation Type
        </Text>
        <Select
          size="small"
          value={manipulation.manipulation_type}
          onChange={(value) => onUpdate({ manipulation_type: value })}
          style={{ width: '100%' }}
          options={MANIPULATION_TYPE_PRESETS.map((t) => ({ label: t, value: t }))}
          showSearch
          allowClear={false}
        />
      </div>

      {/* Width / Length */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <DimensionInput
          label="Width"
          value={manipulation.width_ft}
          onChange={(ft) =>
            onUpdate({
              width_ft: ft,
              calculated_sqft: ft * manipulation.length_ft,
            })
          }
        />
        <DimensionInput
          label="Length"
          value={manipulation.length_ft}
          onChange={(ft) =>
            onUpdate({
              length_ft: ft,
              calculated_sqft: manipulation.width_ft * ft,
            })
          }
        />
      </div>

      {/* Calculated sqft */}
      <div
        style={{
          backgroundColor: '#fff7ed',
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
        title="Delete this content manipulation area?"
        onConfirm={onDelete}
        okText="Delete"
        okType="danger"
        cancelText="Cancel"
      >
        <Button type="default" danger size="small" icon={<DeleteOutlined />} block>
          Delete Area
        </Button>
      </Popconfirm>
    </Space>
  );
};

const WMContentManipulationPanel: React.FC<WMContentManipulationPanelProps> = ({
  manipulations,
  selectedManipulationId,
  onUpdateManipulation,
  onDeleteManipulation,
  onSelectManipulation,
}) => {
  const selectedManipulation = selectedManipulationId
    ? manipulations.find((m) => m.id === selectedManipulationId)
    : null;

  const totalSqft = useMemo(
    () => manipulations.reduce((sum, m) => sum + m.calculated_sqft, 0),
    [manipulations]
  );

  if (selectedManipulation) {
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
          <ManipSwatch color={selectedManipulation.color} />
          <Text style={{ fontSize: 12, fontWeight: 500, flex: 1 }}>
            {selectedManipulation.manipulation_type || 'Content Manipulation'}
          </Text>
          <Tooltip title="Deselect (click empty canvas area)">
            <Text type="secondary" style={{ fontSize: 11 }}>
              editing
            </Text>
          </Tooltip>
        </div>
        <ManipEditForm
          manipulation={selectedManipulation}
          onUpdate={(updates) => onUpdateManipulation(selectedManipulation.id, updates)}
          onDelete={() => onDeleteManipulation(selectedManipulation.id)}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 0' }}>
      {/* Total area header */}
      {manipulations.length > 0 && (
        <>
          <div
            style={{
              backgroundColor: '#fff7ed',
              border: '1px solid #fed7aa',
              borderRadius: 6,
              padding: '8px 12px',
              marginBottom: 10,
              textAlign: 'center',
            }}
          >
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
              Total Content Manipulation
            </Text>
            <Text
              strong
              style={{ fontSize: 20, fontVariantNumeric: 'tabular-nums', lineHeight: 1.3 }}
            >
              {Math.round(totalSqft)} SF
            </Text>
            <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>
              {totalSqft.toFixed(2)} exact — {manipulations.length} area
              {manipulations.length !== 1 ? 's' : ''}
            </Text>
          </div>
          <Divider style={{ margin: '0 0 8px 0' }} />
        </>
      )}

      {/* Manipulation list */}
      {manipulations.length === 0 ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          No content manipulation added. Select the Content Move tool and draw on the canvas.
        </Text>
      ) : (
        <Space direction="vertical" size={2} style={{ width: '100%' }}>
          {manipulations.map((manip, i) => {
            const isSelected = manip.id === selectedManipulationId;
            return (
              <div
                key={manip.id}
                onClick={() => onSelectManipulation(manip.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 8px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  backgroundColor: isSelected ? '#fff7ed' : 'transparent',
                  border: isSelected ? '1px solid #fed7aa' : '1px solid transparent',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = '#fff7ed';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <ManipSwatch color={manip.color} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 12 }}>
                    {manip.manipulation_type || `Area ${i + 1}`}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>
                    {manip.width_ft.toFixed(1)}′ × {manip.length_ft.toFixed(1)}′
                  </Text>
                </div>
                <Text
                  type="secondary"
                  style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
                >
                  {manip.calculated_sqft.toFixed(1)} SF
                </Text>
              </div>
            );
          })}
        </Space>
      )}
    </div>
  );
};

export default WMContentManipulationPanel;
