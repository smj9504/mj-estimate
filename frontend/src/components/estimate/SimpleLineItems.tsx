import React, { useState } from 'react';
import {
  Card,
  Button,
  Space,
  Typography,
  Dropdown,
  Empty,
  Checkbox,
  message,
} from 'antd';
import {
  MoreOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  FileTextOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { EstimateLineItem } from '../../services/EstimateService';

const { Text } = Typography;

// 추천 그룹명
const SUGGESTED_GROUPS = {
  primary: [
    'Roofing',
    'Interior',
    'Exterior',
    'Plumbing',
    'Electrical',
    'HVAC',
    'Flooring',
    'Painting',
    'Landscaping',
    'Foundation',
    'Windows & Doors',
    'Kitchen',
    'Bathroom',
    'General',
    'Miscellaneous',
    'Other'
  ],
};

interface SimpleLineItemsProps {
  items: EstimateLineItem[];
  onItemsChange: (items: EstimateLineItem[]) => void;
  onAddItem: () => void;
  onEditItem: (item: EstimateLineItem, index: number) => void;
  onDeleteItem: (index: number) => void;
  groupTitle?: string;
}

const SimpleLineItems: React.FC<SimpleLineItemsProps> = ({
  items,
  onItemsChange,
  onAddItem,
  onEditItem,
  onDeleteItem,
  groupTitle = 'Items',
}) => {
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());

  // 아이템 이동 (그룹으로)
  const moveItemToGroup = (itemIndex: number, primaryGroup: string) => {
    const newItems = [...items];
    newItems[itemIndex] = {
      ...newItems[itemIndex],
      primary_group: primaryGroup,
      secondary_group: undefined,
    };
    onItemsChange(newItems);
    message.success(`Moved item to ${primaryGroup}`);
  };

  // 아이템 정렬 변경
  const moveItemOrder = (itemIndex: number, direction: 'up' | 'down') => {
    const newItems = [...items];
    
    if (direction === 'up' && itemIndex > 0) {
      [newItems[itemIndex], newItems[itemIndex - 1]] = [newItems[itemIndex - 1], newItems[itemIndex]];
    } else if (direction === 'down' && itemIndex < newItems.length - 1) {
      [newItems[itemIndex], newItems[itemIndex + 1]] = [newItems[itemIndex + 1], newItems[itemIndex]];
    }
    
    onItemsChange(newItems);
  };

  // 아이템 복사
  const duplicateItem = (item: EstimateLineItem) => {
    const { id, ...newItem } = item;
    const newItems = [...items, newItem];
    onItemsChange(newItems);
    message.success('Item duplicated');
  };

  // 아이템 렌더링
  const renderLineItem = (item: EstimateLineItem, index: number) => {
    const isSelected = selectedItems.has(index);
    
    return (
      <div
        key={index}
        className="line-item-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid #f0f0f0',
          backgroundColor: isSelected ? '#e6f7ff' : 'transparent',
          cursor: 'pointer',
          transition: 'background-color 0.2s',
        }}
        onClick={() => onEditItem(item, index)}
        onMouseEnter={(e) => {
          if (!isSelected) {
            e.currentTarget.style.backgroundColor = '#fafafa';
          }
        }}
        onMouseLeave={(e) => {
          if (!isSelected) {
            e.currentTarget.style.backgroundColor = 'transparent';
          }
        }}
      >
        <Checkbox
          checked={isSelected}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedItems((prev) => {
              const newSet = new Set(prev);
              if (newSet.has(index)) {
                newSet.delete(index);
              } else {
                newSet.add(index);
              }
              return newSet;
            });
          }}
          style={{ marginRight: 12 }}
        />
        
        <FileTextOutlined style={{ marginRight: 8, color: '#1890ff' }} />
        
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
            <Text strong style={{ marginRight: 8 }}>
              {item.item}
            </Text>
            {item.description && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                ({item.description})
              </Text>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Qty: {item.quantity} {item.unit}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Unit Price: ${item.unit_price?.toFixed(2) || '0.00'}
            </Text>
            <Text strong style={{ color: '#52c41a', fontSize: 14 }}>
              ${(item.total || 0).toFixed(2)}
            </Text>
          </div>
        </div>
        
        <Dropdown
          menu={{
            items: [
              {
                key: 'move',
                label: 'Move to Group',
                children: SUGGESTED_GROUPS.primary.map((group) => ({
                  key: group,
                  label: group,
                  onClick: () => moveItemToGroup(index, group),
                })),
              },
              { type: 'divider' },
              {
                key: 'up',
                icon: <ArrowUpOutlined />,
                label: 'Move Up',
                disabled: index === 0,
                onClick: () => moveItemOrder(index, 'up'),
              },
              {
                key: 'down',
                icon: <ArrowDownOutlined />,
                label: 'Move Down',
                disabled: index === items.length - 1,
                onClick: () => moveItemOrder(index, 'down'),
              },
              { type: 'divider' },
              {
                key: 'edit',
                icon: <EditOutlined />,
                label: 'Edit',
                onClick: () => onEditItem(item, index),
              },
              {
                key: 'copy',
                icon: <CopyOutlined />,
                label: 'Duplicate',
                onClick: () => duplicateItem(item),
              },
              {
                key: 'delete',
                icon: <DeleteOutlined />,
                label: 'Delete',
                danger: true,
                onClick: () => onDeleteItem(index),
              },
            ],
          }}
          trigger={['click']}
        >
          <Button
            type="text"
            icon={<MoreOutlined />}
            size="small"
            onClick={(e) => e.stopPropagation()}
            style={{ opacity: 0.6 }}
          />
        </Dropdown>
      </div>
    );
  };

  // 총합 계산
  const totalAmount = items.reduce((sum, item) => sum + (item.total || 0), 0);

  return (
    <Card
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Text strong style={{ fontSize: 16 }}>
              {groupTitle}
            </Text>
            <Text type="secondary" style={{ marginLeft: 8 }}>
              ({items.length} items)
            </Text>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Text strong style={{ color: '#52c41a', fontSize: 16 }}>
              Total: ${totalAmount.toFixed(2)}
            </Text>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={onAddItem}
              size="small"
            >
              Add Item
            </Button>
          </div>
        </div>
      }
      style={{ height: '100%' }}
      styles={{ body: { padding: 0, height: 'calc(100% - 57px)', overflow: 'auto' } }}
    >
      {items.length === 0 ? (
        <Empty
          description={`No items in ${groupTitle.toLowerCase()}`}
          style={{ padding: '60px 20px' }}
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={onAddItem}>
            Add First Item
          </Button>
        </Empty>
      ) : (
        <div>
          {items.map((item, index) => renderLineItem(item, index))}
        </div>
      )}
      
      {selectedItems.size > 0 && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            background: 'rgba(24, 144, 255, 0.1)',
            padding: '8px 16px',
            borderTop: '1px solid #1890ff',
          }}
        >
          <Text style={{ color: '#1890ff' }}>
            {selectedItems.size} item{selectedItems.size > 1 ? 's' : ''} selected
          </Text>
          <Button
            type="link"
            size="small"
            onClick={() => setSelectedItems(new Set())}
            style={{ marginLeft: 8, padding: 0 }}
          >
            Clear selection
          </Button>
        </div>
      )}
    </Card>
  );
};

export default SimpleLineItems;