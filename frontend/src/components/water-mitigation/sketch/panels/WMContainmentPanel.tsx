/**
 * WMContainmentPanel - Sidebar panel for managing containment zones.
 *
 * When a zone is selected: shows an editable form (type, width, height, sqft).
 * When nothing is selected: shows a summary list and total area.
 *
 * Usage:
 *   <WMContainmentPanel
 *     zones={overlayData.containmentZones}
 *     selectedZoneId={selection?.elementType === 'containment' ? selection.elementId : null}
 *     onUpdateZone={(id, updates) => handleUpdateContainment(id, updates)}
 *     onDeleteZone={(id) => handleDeleteContainment(id)}
 *     onSelectZone={(id) => handleSelect(id, 'containment')}
 *   />
 */
import React, { useMemo } from 'react';
import { Button, Select, Space, Typography, Divider, Popconfirm, Tooltip } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { WMContainmentZone } from '../../../../types/wmSketch';
import { calcContainmentSqft } from '../utils/wmCalculations';
import { CONTAINMENT_TYPE_PRESETS } from '../utils/wmDefaults';
import DimensionInput from './DimensionInput';

const { Text } = Typography;

export interface WMContainmentPanelProps {
  zones: WMContainmentZone[];
  selectedZoneId: string | null;
  onUpdateZone: (id: string, updates: Partial<WMContainmentZone>) => void;
  onDeleteZone: (id: string) => void;
  onSelectZone: (id: string) => void;
}

/** Color swatch for containment */
const ContainmentSwatch: React.FC<{ color: string }> = ({ color }) => (
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

const ZoneEditForm: React.FC<{
  zone: WMContainmentZone;
  onUpdate: (updates: Partial<WMContainmentZone>) => void;
  onDelete: () => void;
}> = ({ zone, onUpdate, onDelete }) => {
  const calculatedSqft = useMemo(
    () => calcContainmentSqft(zone.width_ft ?? 0, zone.height_ft ?? 0),
    [zone.width_ft, zone.height_ft]
  );

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      {/* Containment type */}
      <div>
        <Text style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
          Containment Type
        </Text>
        <Select
          size="small"
          value={zone.containment_type}
          onChange={(value) => onUpdate({ containment_type: value })}
          style={{ width: '100%' }}
          options={CONTAINMENT_TYPE_PRESETS.map((t) => ({ label: t, value: t }))}
          showSearch
          allowClear={false}
        />
      </div>

      {/* Width / Height */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <DimensionInput
          label="Width"
          value={zone.width_ft ?? 0}
          onChange={(ft) =>
            onUpdate({
              width_ft: ft,
              calculated_sqft: calcContainmentSqft(ft, zone.height_ft ?? 0),
            })
          }
        />
        <DimensionInput
          label="Height"
          value={zone.height_ft ?? 0}
          onChange={(ft) =>
            onUpdate({
              height_ft: ft,
              calculated_sqft: calcContainmentSqft(zone.width_ft ?? 0, ft),
            })
          }
        />
      </div>

      {/* Calculated sqft */}
      <div
        style={{
          backgroundColor: '#f5f5f5',
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
        title="Delete this containment zone?"
        onConfirm={onDelete}
        okText="Delete"
        okType="danger"
        cancelText="Cancel"
      >
        <Button type="default" danger size="small" icon={<DeleteOutlined />} block>
          Delete Zone
        </Button>
      </Popconfirm>
    </Space>
  );
};

const WMContainmentPanel: React.FC<WMContainmentPanelProps> = ({
  zones,
  selectedZoneId,
  onUpdateZone,
  onDeleteZone,
  onSelectZone,
}) => {
  const selectedZone = selectedZoneId ? zones.find((z) => z.id === selectedZoneId) : null;

  const totalSqft = useMemo(
    () => zones.reduce((sum, z) => sum + z.calculated_sqft, 0),
    [zones]
  );

  if (selectedZone) {
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
          <ContainmentSwatch color={selectedZone.color} />
          <Text style={{ fontSize: 12, fontWeight: 500, flex: 1 }}>
            {selectedZone.containment_type || 'Containment Zone'}
          </Text>
          <Tooltip title="Deselect (click empty canvas area)">
            <Text type="secondary" style={{ fontSize: 11 }}>
              editing
            </Text>
          </Tooltip>
        </div>
        <ZoneEditForm
          zone={selectedZone}
          onUpdate={(updates) => onUpdateZone(selectedZone.id, updates)}
          onDelete={() => onDeleteZone(selectedZone.id)}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 0' }}>
      {/* Total area header */}
      {zones.length > 0 && (
        <>
          <div
            style={{
              backgroundColor: '#f0f5ff',
              border: '1px solid #adc6ff',
              borderRadius: 4,
              padding: '6px 10px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <Text style={{ fontSize: 12 }}>
              Total Containment ({zones.length} zone{zones.length !== 1 ? 's' : ''})
            </Text>
            <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>
              {totalSqft.toFixed(2)} SF
            </Text>
          </div>
          <Divider style={{ margin: '0 0 8px 0' }} />
        </>
      )}

      {/* Zone list */}
      {zones.length === 0 ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          No containment zones added. Select the Containment tool and draw on the canvas.
        </Text>
      ) : (
        <Space direction="vertical" size={2} style={{ width: '100%' }}>
          {zones.map((zone, i) => (
            <div
              key={zone.id}
              onClick={() => onSelectZone(zone.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#e6f7ff')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <ContainmentSwatch color={zone.color} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 12 }}>
                  {zone.containment_type || `Zone ${i + 1}`}
                </Text>
                {zone.label && (
                  <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                    {zone.label}
                  </Text>
                )}
              </div>
              <Text
                type="secondary"
                style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
              >
                {zone.calculated_sqft.toFixed(2)} SF
              </Text>
            </div>
          ))}
        </Space>
      )}
    </div>
  );
};

export default WMContainmentPanel;
