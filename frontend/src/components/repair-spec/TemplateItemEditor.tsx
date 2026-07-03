import React from 'react';
import {
  Button, Card, Input, Select, Space, Table, Tag, Typography, Grid, List,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { RepairCondition, RepairTemplateItemCreate } from '../../types/repairSpec';

const { Text } = Typography;
const { useBreakpoint } = Grid;

interface TemplateItemEditorProps {
  conditions: RepairCondition[];
  items: RepairTemplateItemCreate[];
  onChange: (items: RepairTemplateItemCreate[]) => void;
}

const TemplateItemEditor: React.FC<TemplateItemEditorProps> = ({
  conditions,
  items,
  onChange,
}) => {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const conditionMap = new Map(conditions.map((c) => [c.id, c]));

  // Group items by condition
  const grouped = new Map<string, RepairTemplateItemCreate[]>();
  for (const item of items) {
    const key = item.condition_id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

  const addItem = (conditionId: string) => {
    onChange([
      ...items,
      {
        condition_id: conditionId,
        xactimate_item_code: '',
        description_override: '',
        default_unit: '',
        sort_order: items.length,
      },
    ]);
  };

  const updateItem = (index: number, field: string, value: unknown) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  // Find global index for an item
  const getGlobalIndex = (conditionId: string, localIndex: number): number => {
    let count = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].condition_id === conditionId) {
        if (count === localIndex) return i;
        count++;
      }
    }
    return -1;
  };

  return (
    <div>
      {conditions.map((condition) => {
        const condItems = grouped.get(condition.id) || [];
        const scopeColor = condition.scope === 'affected' ? 'blue' : 'red';

        return (
          <Card
            key={condition.id}
            size="small"
            title={
              <Space>
                <Text strong>{condition.name}</Text>
                <Tag color={scopeColor}>{condition.scope}</Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {condItems.length} item{condItems.length !== 1 ? 's' : ''}
                </Text>
              </Space>
            }
            style={{ marginBottom: 12 }}
          >
            {condItems.length > 0 && (
              isMobile ? (
                <List
                  size="small"
                  dataSource={condItems}
                  renderItem={(item, localIdx) => {
                    const globalIdx = getGlobalIndex(condition.id, localIdx);
                    return (
                      <div style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                        <Input
                          size="small"
                          placeholder="Xactimate code"
                          value={item.xactimate_item_code}
                          onChange={(e) => updateItem(globalIdx, 'xactimate_item_code', e.target.value)}
                          style={{ width: '100%', marginBottom: 4 }}
                        />
                        <Input
                          size="small"
                          placeholder="Description override"
                          value={item.description_override || ''}
                          onChange={(e) => updateItem(globalIdx, 'description_override', e.target.value)}
                          style={{ width: '100%', marginBottom: 4 }}
                        />
                        <Space>
                          <Input
                            size="small"
                            placeholder="Unit"
                            value={item.default_unit || ''}
                            onChange={(e) => updateItem(globalIdx, 'default_unit', e.target.value)}
                            style={{ width: 80 }}
                          />
                          <Button
                            type="text"
                            danger
                            size="small"
                            icon={<DeleteOutlined />}
                            onClick={() => removeItem(globalIdx)}
                          />
                        </Space>
                      </div>
                    );
                  }}
                />
              ) : (
                <Table
                  size="small"
                  rowKey={(_, idx) => `${condition.id}-${idx}`}
                  pagination={false}
                  dataSource={condItems}
                  columns={[
                    {
                      title: 'Xactimate Code',
                      key: 'code',
                      width: 130,
                      render: (_, item, localIdx) => {
                        const globalIdx = getGlobalIndex(condition.id, localIdx);
                        return (
                          <Input
                            size="small"
                            value={item.xactimate_item_code}
                            onChange={(e) => updateItem(globalIdx, 'xactimate_item_code', e.target.value)}
                          />
                        );
                      },
                    },
                    {
                      title: 'Description',
                      key: 'desc',
                      render: (_, item, localIdx) => {
                        const globalIdx = getGlobalIndex(condition.id, localIdx);
                        return (
                          <Input
                            size="small"
                            placeholder="Override description"
                            value={item.description_override || ''}
                            onChange={(e) => updateItem(globalIdx, 'description_override', e.target.value)}
                          />
                        );
                      },
                    },
                    {
                      title: 'Unit',
                      key: 'unit',
                      width: 90,
                      render: (_, item, localIdx) => {
                        const globalIdx = getGlobalIndex(condition.id, localIdx);
                        return (
                          <Input
                            size="small"
                            value={item.default_unit || ''}
                            onChange={(e) => updateItem(globalIdx, 'default_unit', e.target.value)}
                          />
                        );
                      },
                    },
                    {
                      title: '',
                      key: 'actions',
                      width: 40,
                      render: (_, __, localIdx) => {
                        const globalIdx = getGlobalIndex(condition.id, localIdx);
                        return (
                          <Button
                            type="text"
                            danger
                            size="small"
                            icon={<DeleteOutlined />}
                            onClick={() => removeItem(globalIdx)}
                          />
                        );
                      },
                    },
                  ]}
                />
              )
            )}
            <Button
              type="dashed"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => addItem(condition.id)}
              style={{ marginTop: 8 }}
            >
              Add Item
            </Button>
          </Card>
        );
      })}

      {conditions.length === 0 && (
        <Text type="secondary">Add conditions first, then add line items under each condition.</Text>
      )}
    </div>
  );
};

export default TemplateItemEditor;
