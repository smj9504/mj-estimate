/**
 * WMEquipmentPanel - Sidebar panel for managing equipment placements.
 *
 * Shows a summary of equipment counts grouped by type.
 * Expand each group to see individual placements with position info.
 * Selected placement is highlighted; each has a delete button.
 *
 * Usage:
 *   <WMEquipmentPanel
 *     placements={overlayData.equipmentPlacements}
 *     selectedPlacementId={selection?.elementType === 'equipment' ? selection.elementId : null}
 *     onDeletePlacement={(id) => handleDeleteEquipment(id)}
 *     onSelectPlacement={(id) => handleSelect(id, 'equipment')}
 *   />
 */
import React, { useState, useMemo } from 'react';
import { Button, Popconfirm, Space, Typography, Divider } from 'antd';
import { DeleteOutlined, DownOutlined, RightOutlined } from '@ant-design/icons';
import type { WMEquipmentPlacement, EquipmentType } from '../../../../types/wmSketch';
import { EQUIPMENT_CONFIG } from '../../../../types/wmSketch';

const { Text } = Typography;

export interface WMEquipmentPanelProps {
  placements: WMEquipmentPlacement[];
  selectedPlacementId: string | null;
  onDeletePlacement: (id: string) => void;
  onSelectPlacement: (id: string) => void;
}

/** Renders the equipment icon shape in a small inline format */
const EquipmentIcon: React.FC<{ type: EquipmentType; size?: number }> = ({
  type,
  size = 16,
}) => {
  const config = EQUIPMENT_CONFIG[type];
  const half = size / 2;

  if (config.shape === 'triangle') {
    // SVG triangle
    return (
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ flexShrink: 0, verticalAlign: 'middle' }}
      >
        <polygon
          points={`${half},1 ${size - 1},${size - 1} 1,${size - 1}`}
          fill={config.color}
          stroke="rgba(0,0,0,0.2)"
          strokeWidth="1"
        />
      </svg>
    );
  }

  if (config.shape === 'cylinder') {
    // Simplified as a rounded rect to indicate cylinder
    return (
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ flexShrink: 0, verticalAlign: 'middle' }}
      >
        <rect
          x="2"
          y="1"
          width={size - 4}
          height={size - 2}
          rx="3"
          ry="3"
          fill={config.color}
          stroke="rgba(0,0,0,0.2)"
          strokeWidth="1"
        />
      </svg>
    );
  }

  // Default: circle
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ flexShrink: 0, verticalAlign: 'middle' }}
    >
      <circle
        cx={half}
        cy={half}
        r={half - 1}
        fill={config.color}
        stroke="rgba(0,0,0,0.2)"
        strokeWidth="1"
      />
    </svg>
  );
};

const WMEquipmentPanel: React.FC<WMEquipmentPanelProps> = ({
  placements,
  selectedPlacementId,
  onDeletePlacement,
  onSelectPlacement,
}) => {
  const [expandedTypes, setExpandedTypes] = useState<Record<string, boolean>>({});

  // Group by equipment type preserving EQUIPMENT_CONFIG order
  const groups = useMemo(() => {
    const typeOrder: EquipmentType[] = ['air_mover', 'air_scrubber', 'dehumidifier'];
    return typeOrder
      .map((type) => ({
        type,
        config: EQUIPMENT_CONFIG[type],
        items: placements.filter((p) => p.equipment_type === type),
      }))
      .filter((g) => g.items.length > 0);
  }, [placements]);

  const toggleType = (type: string) => {
    setExpandedTypes((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  if (placements.length === 0) {
    return (
      <div style={{ padding: '8px 0' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          No equipment placed. Select the Equipment tool and click on the canvas.
        </Text>
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 0' }}>
      <Space direction="vertical" size={2} style={{ width: '100%' }}>
        {groups.map(({ type, config, items }) => {
          const isExpanded = expandedTypes[type] ?? false;

          return (
            <div key={type}>
              {/* Group header */}
              <div
                onClick={() => toggleType(type)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 6px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  userSelect: 'none',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f0f0f0')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                {isExpanded ? (
                  <DownOutlined style={{ fontSize: 10, color: '#999' }} />
                ) : (
                  <RightOutlined style={{ fontSize: 10, color: '#999' }} />
                )}
                <EquipmentIcon type={type} size={14} />
                <Text style={{ fontSize: 12, flex: 1 }}>{config.name}</Text>
                <Text
                  strong
                  style={{
                    fontSize: 13,
                    minWidth: 24,
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {items.length}
                </Text>
              </div>

              {/* Expanded placement list */}
              {isExpanded && (
                <div style={{ paddingLeft: 22 }}>
                  {items.map((placement, i) => {
                    const isSelected = placement.id === selectedPlacementId;
                    return (
                      <div
                        key={placement.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '3px 6px',
                          borderRadius: 4,
                          cursor: 'pointer',
                          backgroundColor: isSelected ? '#e6f7ff' : 'transparent',
                          border: isSelected ? '1px solid #91d5ff' : '1px solid transparent',
                          transition: 'background 0.15s',
                        }}
                        onClick={() => onSelectPlacement(placement.id)}
                        onMouseEnter={(e) => {
                          if (!isSelected) e.currentTarget.style.backgroundColor = '#f5f5f5';
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
                            {placement.label || config.name}
                          </Text>
                          <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>
                            x: {Math.round(placement.x)}, y: {Math.round(placement.y)}
                          </Text>
                        </div>
                        <Popconfirm
                          title="Remove this equipment?"
                          onConfirm={(e) => {
                            e?.stopPropagation();
                            onDeletePlacement(placement.id);
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
              )}
            </div>
          );
        })}

        {/* Total */}
        <Divider style={{ margin: '4px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 6px' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Total equipment
          </Text>
          <Text strong style={{ fontSize: 12 }}>
            {placements.length}
          </Text>
        </div>
      </Space>
    </div>
  );
};

export default WMEquipmentPanel;
