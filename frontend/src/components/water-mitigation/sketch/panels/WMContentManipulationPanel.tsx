/**
 * WMContentManipulationPanel - Sidebar panel for managing content manipulation areas.
 *
 * Displays total coverage area prominently at the top.
 * Lists each manipulation area with type, dimensions, and sqft.
 * Click an item to select it on the canvas.
 */
import React, { useMemo } from 'react';
import { Button, Select, Space, Typography, Divider, Popconfirm, Tooltip, InputNumber } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { WMContentManipulation } from '../../../../types/wmSketch';

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

      {/* Hours input */}
      <div>
        <Text style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
          Labor Hours
        </Text>
        <InputNumber
          size="small"
          min={0}
          step={0.5}
          precision={1}
          value={manipulation.hours}
          onChange={(val) => onUpdate({ hours: val ?? 0 })}
          addonAfter="hr"
          style={{ width: '100%' }}
        />
      </div>

      {manipulation.manipulation_type === 'Move back' && (
        <div
          style={{
            backgroundColor: '#fff7ed',
            border: '1px solid #fed7aa',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 11,
            color: '#92400e',
          }}
        >
          "Move back" is not billed in scope — hours are recorded only.
        </div>
      )}

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

  const totalHours = useMemo(
    () => manipulations.reduce((sum, m) => sum + (m.hours ?? 0), 0),
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
              {totalHours.toFixed(1)} hr
            </Text>
            <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>
              {manipulations.length} area{manipulations.length !== 1 ? 's' : ''}
              {' · '}Move back excluded from scope
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
                  {manip.manipulation_type === 'Move back' && (
                    <Text type="secondary" style={{ fontSize: 10, display: 'block', color: '#d97706' }}>
                      not billed
                    </Text>
                  )}
                </div>
                <Text
                  type="secondary"
                  style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
                >
                  {(manip.hours ?? 0).toFixed(1)} hr
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
