import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Card,
  Button,
  Space,
  Typography,
  Badge,
  Dropdown,
  Menu,
  Tooltip,
  Divider,
  InputNumber,
  Empty,
  Row,
  Col,
  Tag,
  Checkbox,
  message,
  Modal,
  Form,
  Input,
  Select,
  AutoComplete,
  Popconfirm,
} from 'antd';
import {
  PlusOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  MoreOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  DownOutlined,
  RightOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { EstimateLineItem } from '../../services/EstimateService';
import debounce from 'lodash/debounce';

const { Text, Title } = Typography;
const { Option } = Select;

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
  secondary: {
    'Interior': [
      'Living Room',
      'Kitchen',
      'Master Bedroom',
      'Bedroom',
      'Bathroom',
      'Master Bathroom',
      'Dining Room',
      'Family Room',
      'Office',
      'Laundry Room',
      'Hallway',
      'Closet',
      'Basement',
      'Attic'
    ],
    'Exterior': [
      'Front Yard',
      'Back Yard',
      'Driveway',
      'Garage',
      'Deck/Patio',
      'Fence',
      'Siding'
    ],
    'default': [
      'General',
      'Area 1',
      'Area 2',
      'Other'
    ]
  }
};

interface ExtendedLineItem extends EstimateLineItem {
  _index: number;
}

interface GroupData {
  name: string;
  items: ExtendedLineItem[];
  subgroups: Map<string, ExtendedLineItem[]>;
  expanded: boolean;
  subtotal: number;
  itemCount: number;
}

interface GroupableLineItemsProps {
  items: EstimateLineItem[];
  onItemsChange: (items: EstimateLineItem[]) => void;
  onAddItem: () => void;
  onEditItem: (item: EstimateLineItem, index: number) => void;
  onDeleteItem: (index: number) => void;
}

const GroupableLineItems: React.FC<GroupableLineItemsProps> = ({
  items,
  onItemsChange,
  onAddItem,
  onEditItem,
  onDeleteItem,
}) => {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [groupModalVisible, setGroupModalVisible] = useState(false);
  const [groupModalMode, setGroupModalMode] = useState<'create' | 'edit'>('create');
  const [editingGroup, setEditingGroup] = useState<{ primary?: string; secondary?: string; isSubgroup?: boolean } | null>(null);
  const [emptyGroups, setEmptyGroups] = useState<Array<{ primary: string; secondary?: string }>>([]); // 빈 그룹 관리
  const [form] = Form.useForm();

  // 그룹 데이터 구조 생성
  const groupedData = useMemo(() => {
    const groups = new Map<string, GroupData>();
    const ungrouped: ExtendedLineItem[] = [];

    // 먼저 빈 그룹들을 추가
    emptyGroups.forEach(emptyGroup => {
      if (!groups.has(emptyGroup.primary)) {
        groups.set(emptyGroup.primary, {
          name: emptyGroup.primary,
          items: [],
          subgroups: new Map(),
          expanded: expandedGroups.has(emptyGroup.primary),
          subtotal: 0,
          itemCount: 0,
        });
      }
      
      if (emptyGroup.secondary) {
        const group = groups.get(emptyGroup.primary)!;
        if (!group.subgroups.has(emptyGroup.secondary)) {
          group.subgroups.set(emptyGroup.secondary, []);
        }
      }
    });

    // 아이템들을 그룹에 추가
    items.forEach((item, index) => {
      const itemWithIndex: ExtendedLineItem = { ...item, _index: index };
      
      if (!item.primary_group) {
        ungrouped.push(itemWithIndex);
        return;
      }

      if (!groups.has(item.primary_group)) {
        groups.set(item.primary_group, {
          name: item.primary_group,
          items: [],
          subgroups: new Map(),
          expanded: expandedGroups.has(item.primary_group),
          subtotal: 0,
          itemCount: 0,
        });
      }

      const group = groups.get(item.primary_group)!;
      group.subtotal += item.total || 0;
      group.itemCount += 1;

      if (item.secondary_group) {
        if (!group.subgroups.has(item.secondary_group)) {
          group.subgroups.set(item.secondary_group, []);
        }
        group.subgroups.get(item.secondary_group)!.push(itemWithIndex);
      } else {
        group.items.push(itemWithIndex);
      }
    });

    // 정렬
    groups.forEach((group) => {
      group.items.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      group.subgroups.forEach((subgroupItems) => {
        subgroupItems.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      });
    });

    return { groups, ungrouped };
  }, [items, expandedGroups, emptyGroups]);

  // 그룹 토글
  const toggleGroup = useCallback((groupName: string) => {
    setExpandedGroups((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(groupName)) {
        newSet.delete(groupName);
      } else {
        newSet.add(groupName);
      }
      return newSet;
    });
  }, []);

  // 모두 펼치기/접기
  const expandAll = useCallback(() => {
    const allGroups = new Set(groupedData.groups.keys());
    setExpandedGroups(allGroups);
  }, [groupedData.groups]);

  const collapseAll = useCallback(() => {
    setExpandedGroups(new Set());
  }, []);

  // 아이템 이동
  const moveItemToGroup = useCallback((itemIndex: number, primaryGroup: string, secondaryGroup?: string) => {
    const newItems = [...items];
    newItems[itemIndex] = {
      ...newItems[itemIndex],
      primary_group: primaryGroup,
      secondary_group: secondaryGroup,
    };
    onItemsChange(newItems);
    
    // 빈 그룹에서 제거 (이제 아이템이 있으므로)
    setEmptyGroups(emptyGroups.filter(g => 
      !(g.primary === primaryGroup && g.secondary === secondaryGroup)
    ));
  }, [items, onItemsChange, emptyGroups]);

  // 선택된 아이템들을 그룹으로 이동
  const moveSelectedToGroup = useCallback((primaryGroup: string, secondaryGroup?: string) => {
    const newItems = [...items];
    selectedItems.forEach((index) => {
      newItems[index] = {
        ...newItems[index],
        primary_group: primaryGroup,
        secondary_group: secondaryGroup,
      };
    });
    onItemsChange(newItems);
    setSelectedItems(new Set());
    message.success(`Moved ${selectedItems.size} items to ${primaryGroup}${secondaryGroup ? ' > ' + secondaryGroup : ''}`);
  }, [items, selectedItems, onItemsChange]);

  // 그룹 생성/편집 모달 열기
  const openGroupModal = useCallback((mode: 'create' | 'edit', group?: { primary?: string; secondary?: string; isSubgroup?: boolean }) => {
    setGroupModalMode(mode);
    setEditingGroup(group || null);
    setGroupModalVisible(true);
    
    if (mode === 'edit' && group) {
      if (group.isSubgroup) {
        // 서브그룹 편집
        form.setFieldsValue({
          group_name: group.secondary,
        });
      } else {
        // Primary 그룹 편집
        form.setFieldsValue({
          group_name: group.primary,
        });
      }
    } else if (mode === 'create' && group?.primary) {
      // 서브그룹 생성 모드 - Primary 그룹이 이미 지정됨
      form.resetFields();
      form.setFieldsValue({
        parent_group: group.primary,
      });
    } else {
      form.resetFields();
    }
  }, [form]);

  // 그룹 생성/편집 처리
  const handleGroupSubmit = useCallback(() => {
    form.validateFields().then((values) => {
      const { group_name } = values;
      
      if (groupModalMode === 'create') {
        if (editingGroup?.primary) {
          // 서브그룹 생성
          const newEmptyGroup = { primary: editingGroup.primary, secondary: group_name };
          
          // 선택된 아이템이 있으면 해당 서브그룹으로 이동
          if (selectedItems.size > 0) {
            moveSelectedToGroup(editingGroup.primary, group_name);
          } else {
            setEmptyGroups([...emptyGroups, newEmptyGroup]);
          }
          message.success(`Created subgroup: ${editingGroup.primary} > ${group_name}`);
        } else {
          // Primary 그룹 생성
          if (selectedItems.size > 0) {
            moveSelectedToGroup(group_name, undefined);
          } else {
            const newEmptyGroup = { primary: group_name };
            setEmptyGroups([...emptyGroups, newEmptyGroup]);
          }
          message.success(`Created group: ${group_name}`);
        }
      } else if (groupModalMode === 'edit' && editingGroup) {
        // 그룹 이름 변경
        const newItems = [...items];
        if (editingGroup.isSubgroup) {
          // 서브그룹 이름 변경
          newItems.forEach((item, index) => {
            if (item.primary_group === editingGroup.primary && item.secondary_group === editingGroup.secondary) {
              newItems[index] = { ...item, secondary_group: group_name };
            }
          });
        } else {
          // Primary 그룹 이름 변경
          newItems.forEach((item, index) => {
            if (item.primary_group === editingGroup.primary) {
              newItems[index] = { ...item, primary_group: group_name };
            }
          });
          // 빈 그룹도 업데이트
          setEmptyGroups(emptyGroups.map(g => 
            g.primary === editingGroup.primary ? { ...g, primary: group_name } : g
          ));
        }
        onItemsChange(newItems);
        message.success('Group renamed successfully');
      }
      
      setGroupModalVisible(false);
      form.resetFields();
    });
  }, [form, groupModalMode, editingGroup, selectedItems, items, onItemsChange, moveSelectedToGroup, emptyGroups]);

  // 그룹 삭제
  const deleteGroup = useCallback((primaryGroup: string, secondaryGroup?: string) => {
    const newItems = [...items];
    newItems.forEach((item, index) => {
      if (item.primary_group === primaryGroup) {
        if (!secondaryGroup || item.secondary_group === secondaryGroup) {
          newItems[index] = {
            ...item,
            primary_group: undefined,
            secondary_group: undefined,
          };
        }
      }
    });
    onItemsChange(newItems);
    message.success('Group deleted and items ungrouped');
  }, [items, onItemsChange]);

  // 아이템 정렬 변경
  const moveItemOrder = useCallback((itemIndex: number, direction: 'up' | 'down') => {
    const newItems = [...items];
    const item = newItems[itemIndex];
    const currentOrder = item.sort_order || 0;
    
    // 같은 그룹 내 아이템들 찾기
    const sameGroupItems = newItems
      .map((it, idx) => ({ item: it, index: idx }))
      .filter((it) => 
        it.item.primary_group === item.primary_group && 
        it.item.secondary_group === item.secondary_group
      )
      .sort((a, b) => (a.item.sort_order || 0) - (b.item.sort_order || 0));
    
    const currentPos = sameGroupItems.findIndex((it) => it.index === itemIndex);
    
    if (direction === 'up' && currentPos > 0) {
      const prevItem = sameGroupItems[currentPos - 1];
      newItems[itemIndex].sort_order = prevItem.item.sort_order || 0;
      newItems[prevItem.index].sort_order = currentOrder;
    } else if (direction === 'down' && currentPos < sameGroupItems.length - 1) {
      const nextItem = sameGroupItems[currentPos + 1];
      newItems[itemIndex].sort_order = nextItem.item.sort_order || 0;
      newItems[nextItem.index].sort_order = currentOrder;
    }
    
    onItemsChange(newItems);
  }, [items, onItemsChange]);

  // 아이템 렌더링
  const renderLineItem = (item: ExtendedLineItem, level: number) => {
    const isSelected = selectedItems.has(item._index);
    
    return (
      <div
        key={item._index}
        className="line-item-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 16px',
          marginLeft: level * 20,
          borderBottom: '1px solid #f0f0f0',
          backgroundColor: isSelected ? '#e6f7ff' : 'transparent',
          cursor: 'pointer',
        }}
        onClick={() => onEditItem(item, item._index)}
      >
        <Checkbox
          checked={isSelected}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedItems((prev) => {
              const newSet = new Set(prev);
              if (newSet.has(item._index)) {
                newSet.delete(item._index);
              } else {
                newSet.add(item._index);
              }
              return newSet;
            });
          }}
          style={{ marginRight: 8 }}
        />
        
        <div style={{ flex: 1 }}>
          <Space>
            <FileTextOutlined />
            <Text strong>{item.item}</Text>
            {item.description && <Text type="secondary">({item.description})</Text>}
          </Space>
        </div>
        
        <Space>
          <Text>{item.quantity} {item.unit}</Text>
          <Text>@ ${item.unit_price}</Text>
          <Text strong>${item.total}</Text>
          
          <Dropdown
            menu={{
              items: [
                {
                  key: 'move',
                  label: 'Move to Group',
                  children: SUGGESTED_GROUPS.primary.map((group) => ({
                    key: group,
                    label: group,
                    onClick: () => moveItemToGroup(item._index, group),
                  })),
                },
                { type: 'divider' },
                {
                  key: 'up',
                  icon: <ArrowUpOutlined />,
                  label: 'Move Up',
                  onClick: () => moveItemOrder(item._index, 'up'),
                },
                {
                  key: 'down',
                  icon: <ArrowDownOutlined />,
                  label: 'Move Down',
                  onClick: () => moveItemOrder(item._index, 'down'),
                },
                { type: 'divider' },
                {
                  key: 'edit',
                  icon: <EditOutlined />,
                  label: 'Edit',
                  onClick: () => onEditItem(item, item._index),
                },
                {
                  key: 'copy',
                  icon: <CopyOutlined />,
                  label: 'Duplicate',
                  onClick: () => {
                    const { id, _index, ...newItem } = item;
                    const newItems = [...items, newItem];
                    onItemsChange(newItems);
                  },
                },
                {
                  key: 'delete',
                  icon: <DeleteOutlined />,
                  label: 'Delete',
                  danger: true,
                  onClick: () => onDeleteItem(item._index),
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
            />
          </Dropdown>
        </Space>
      </div>
    );
  };

  // 그룹 헤더 렌더링
  const renderGroupHeader = (
    group: GroupData,
    primaryGroup: string,
    secondaryGroup?: string
  ) => {
    const isExpanded = expandedGroups.has(secondaryGroup ? `${primaryGroup}/${secondaryGroup}` : primaryGroup);
    const level = secondaryGroup ? 1 : 0;
    
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: level === 0 ? '12px 16px' : '10px 16px',
          marginLeft: level * 20,
          backgroundColor: level === 0 ? '#fafafa' : '#f5f5f5',
          borderLeft: `4px solid ${level === 0 ? '#1890ff' : '#91d5ff'}`,
          cursor: 'pointer',
        }}
        onClick={() => toggleGroup(secondaryGroup ? `${primaryGroup}/${secondaryGroup}` : primaryGroup)}
      >
        <Space style={{ flex: 1 }}>
          {isExpanded ? <FolderOpenOutlined /> : <FolderOutlined />}
          <Text strong={level === 0} style={{ fontSize: level === 0 ? 16 : 14 }}>
            {secondaryGroup || primaryGroup}
          </Text>
          <Badge count={group.itemCount} style={{ backgroundColor: '#52c41a' }} />
          <Tag color="blue">${group.subtotal.toFixed(2)}</Tag>
        </Space>
        
        <Dropdown
          menu={{
            items: [
              {
                key: 'add',
                icon: <PlusOutlined />,
                label: 'Add Item Here',
                onClick: () => {
                  // 그룹이 미리 선택된 상태로 아이템 추가 모달 열기
                  const newItem: EstimateLineItem = {
                    item: '',
                    description: '',
                    quantity: 1,
                    unit: 'EA',
                    unit_price: 0,
                    total: 0,
                    primary_group: primaryGroup,
                    secondary_group: secondaryGroup,
                  };
                  // onAddItem에 그룹 정보 전달
                  onAddItem();
                  // Note: onAddItem should be modified to accept group parameters
                },
              },
              ...(!secondaryGroup ? [{
                key: 'add-subgroup',
                icon: <FolderOutlined />,
                label: 'Add Subgroup',
                onClick: () => openGroupModal('create', { primary: primaryGroup }),
              }] : []),
              { type: 'divider' as const },
              {
                key: 'rename',
                icon: <EditOutlined />,
                label: 'Rename Group',
                onClick: () => openGroupModal('edit', { 
                  primary: primaryGroup, 
                  secondary: secondaryGroup,
                  isSubgroup: !!secondaryGroup 
                }),
              },
              {
                key: 'delete',
                icon: <DeleteOutlined />,
                label: 'Delete Group',
                danger: true,
                onClick: () => {
                  Modal.confirm({
                    title: 'Delete Group',
                    content: 'Items in this group will be moved to ungrouped. Continue?',
                    onOk: () => deleteGroup(primaryGroup, secondaryGroup),
                  });
                },
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
          />
        </Dropdown>
      </div>
    );
  };

  return (
    <div>

      {/* 그룹된 아이템들 */}
      <Card>
        {groupedData.ungrouped.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                padding: '12px 16px',
                backgroundColor: '#f0f0f0',
                borderLeft: '4px solid #d9d9d9',
              }}
            >
              <Space>
                <Text strong>Ungrouped Items</Text>
                <Badge count={groupedData.ungrouped.length} />
                <Tag color="default">
                  ${groupedData.ungrouped.reduce((sum, item) => sum + (item.total || 0), 0).toFixed(2)}
                </Tag>
              </Space>
            </div>
            {groupedData.ungrouped.map((item) => renderLineItem(item, 0))}
          </div>
        )}
        
        {Array.from(groupedData.groups.entries()).map(([groupName, group]) => (
          <div key={groupName} style={{ marginBottom: 16 }}>
            {renderGroupHeader(group, groupName)}
            
            {expandedGroups.has(groupName) && (
              <div>
                {/* Show empty state if no items */}
                {group.items.length === 0 && group.subgroups.size === 0 && (
                  <div style={{ 
                    padding: '20px 40px', 
                    textAlign: 'center',
                    color: '#999',
                    borderBottom: '1px solid #f0f0f0'
                  }}>
                    <Empty 
                      description="No items in this group yet"
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                    >
                      <Button 
                        type="dashed" 
                        icon={<PlusOutlined />}
                        onClick={onAddItem}
                      >
                        Add Item to {groupName}
                      </Button>
                    </Empty>
                  </div>
                )}
                
                {/* Direct items under primary group */}
                {group.items.map((item) => renderLineItem(item, 1))}
                
                {/* Secondary groups */}
                {Array.from(group.subgroups.entries()).map(([subgroupName, subgroupItems]) => {
                  const subgroupData: GroupData = {
                    name: subgroupName,
                    items: subgroupItems,
                    subgroups: new Map(),
                    expanded: expandedGroups.has(`${groupName}/${subgroupName}`),
                    subtotal: subgroupItems.reduce((sum, item) => sum + (item.total || 0), 0),
                    itemCount: subgroupItems.length,
                  };
                  
                  return (
                    <div key={subgroupName}>
                      {renderGroupHeader(subgroupData, groupName, subgroupName)}
                      {expandedGroups.has(`${groupName}/${subgroupName}`) && 
                        subgroupItems.map((item) => renderLineItem(item, 2))
                      }
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        
        {items.length === 0 && (
          <Empty
            description="No items yet"
            style={{ padding: '40px 0' }}
          >
            <Button type="primary" onClick={onAddItem}>
              Add First Item
            </Button>
          </Empty>
        )}
      </Card>

      {/* 그룹 생성/편집 모달 */}
      <Modal
        title={(() => {
          if (groupModalMode === 'edit') {
            return editingGroup?.isSubgroup ? 'Edit Subgroup' : 'Edit Group';
          }
          return editingGroup?.primary ? 'Create Subgroup' : 'Create Group';
        })()}
        open={groupModalVisible}
        onOk={handleGroupSubmit}
        onCancel={() => setGroupModalVisible(false)}
        width={500}
      >
        <Form form={form} layout="vertical">
          {editingGroup?.primary ? (
            // 서브그룹 생성/편집 모드
            <>
              <Form.Item label="Parent Group">
                <Input value={editingGroup.primary} disabled />
              </Form.Item>
              <Form.Item
                name="group_name"
                label="Subgroup Name"
                rules={[{ required: true, message: 'Please enter subgroup name' }]}
              >
                <AutoComplete
                  options={(SUGGESTED_GROUPS.secondary[editingGroup.primary as keyof typeof SUGGESTED_GROUPS.secondary] || 
                           SUGGESTED_GROUPS.secondary.default).map((g: string) => ({ value: g }))}
                  placeholder="e.g., Living Room, Kitchen, Master Bedroom..."
                  filterOption={(inputValue, option) =>
                    option?.value?.toString().toUpperCase().indexOf(inputValue.toUpperCase()) !== -1
                  }
                />
              </Form.Item>
            </>
          ) : (
            // Primary 그룹 생성/편집 모드
            <Form.Item
              name="group_name"
              label="Group Name"
              rules={[{ required: true, message: 'Please enter group name' }]}
            >
              <AutoComplete
                options={SUGGESTED_GROUPS.primary.map((g) => ({ value: g }))}
                placeholder="e.g., Interior, Roofing, Plumbing..."
                filterOption={(inputValue, option) =>
                  option!.value.toUpperCase().indexOf(inputValue.toUpperCase()) !== -1
                }
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
};

export default GroupableLineItems;