import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { message, Modal, Form, Input, AutoComplete, Button, Typography } from 'antd';
import { AppstoreOutlined, PlusOutlined } from '@ant-design/icons';
import GroupNavigationSidebar from './GroupNavigationSidebar';
import LineItemManager from './LineItemManager';
import { EstimateLineItem } from '../../services/EstimateService';


// 제안된 그룹명
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

interface GroupableLineItemsWithSidebarProps {
  items: EstimateLineItem[];
  onItemsChange: (items: EstimateLineItem[]) => void;
}

const GroupableLineItemsWithSidebar: React.FC<GroupableLineItemsWithSidebarProps> = ({
  items,
  onItemsChange,
}) => {
  // Log when items prop changes
  useEffect(() => {
    console.log('GroupableLineItemsWithSidebar: items prop updated:', {
      itemCount: items?.length || 0,
      items: items
    });
  }, [items]);
  const [selectedGroupKey, setSelectedGroupKey] = useState<string>('');
  const [emptyGroups, setEmptyGroups] = useState<Array<{ primary: string; secondary?: string; sort_order?: number }>>([]);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const [isHoveringHandle, setIsHoveringHandle] = useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [groupModalVisible, setGroupModalVisible] = useState(false);
  const [editingGroup, setEditingGroup] = useState<{ primary?: string; secondary?: string; isSubgroup?: boolean } | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);

  // 그룹 데이터 구조 생성
  const groupedData = useMemo(() => {
    const groups = new Map<string, GroupData>();
    const ungrouped: ExtendedLineItem[] = [];

    // 먼저 빈 그룹들을 추가
    emptyGroups.forEach(emptyGroup => {
      // Primary group이 없는 경우에만 생성
      if (!groups.has(emptyGroup.primary)) {
        groups.set(emptyGroup.primary, {
          name: emptyGroup.primary,
          items: [],
          subgroups: new Map(),
          expanded: true,
          subtotal: 0,
          itemCount: 0,
        });
      }

      // Subgroup 추가 (primary group이 이미 존재하거나 방금 생성됨)
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

      // Primary group이 없는 경우에만 생성 (아이템이 있는 그룹)
      if (!groups.has(item.primary_group)) {
        groups.set(item.primary_group, {
          name: item.primary_group,
          items: [],
          subgroups: new Map(),
          expanded: true,
          subtotal: 0,
          itemCount: 0,
        });
      }

      const group = groups.get(item.primary_group)!;
      group.subtotal += item.total || 0;
      group.itemCount += 1;

      if (item.secondary_group) {
        // Subgroup이 없는 경우에만 생성
        if (!group.subgroups.has(item.secondary_group)) {
          group.subgroups.set(item.secondary_group, []);
        }
        group.subgroups.get(item.secondary_group)!.push(itemWithIndex);
      } else {
        group.items.push(itemWithIndex);
      }
    });

    // 정렬
    Array.from(groups.values()).forEach((group) => {
      group.items.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

      // Subgroup 순서도 정렬 (sort_order 기준)
      const subgroupEntries = Array.from(group.subgroups.entries());
      subgroupEntries.sort(([keyA], [keyB]) => {
        // emptyGroups에서 sort_order 찾기
        let orderA = emptyGroups.find(g => g.primary === group.name && g.secondary === keyA)?.sort_order || 0;
        let orderB = emptyGroups.find(g => g.primary === group.name && g.secondary === keyB)?.sort_order || 0;

        // 만약 sort_order가 없으면 아이템의 첫 번째 sort_order에서 추출
        if (orderA === 0 && group.subgroups.get(keyA)!.length > 0) {
          const firstItemA = group.subgroups.get(keyA)![0];
          orderA = Math.floor((firstItemA.sort_order || 0) / 1000) * 1000;
        }
        if (orderB === 0 && group.subgroups.get(keyB)!.length > 0) {
          const firstItemB = group.subgroups.get(keyB)![0];
          orderB = Math.floor((firstItemB.sort_order || 0) / 1000) * 1000;
        }

        return orderA - orderB;
      });

      // 정렬된 순서로 subgroups 재구성
      const sortedSubgroups = new Map();
      subgroupEntries.forEach(([key, value]) => {
        value.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        sortedSubgroups.set(key, value);
      });
      group.subgroups = sortedSubgroups;
    });

    return { groups, ungrouped };
  }, [items, emptyGroups]);

  // 첫 번째 그룹 자동 선택 및 모든 그룹 확장
  useEffect(() => {
    // 모든 그룹을 확장 상태로 설정
    const allGroupKeys = Array.from(groupedData.groups.keys());
    if (expandedKeys.length === 0 && allGroupKeys.length > 0) {
      setExpandedKeys(allGroupKeys);
    }
    
    if (!selectedGroupKey) {
      if (groupedData.groups.size > 0) {
        const firstGroup = Array.from(groupedData.groups.entries())[0];
        const [groupName, group] = firstGroup;
        
        // 서브그룹이 있으면 첫 번째 서브그룹 선택
        if (group.subgroups.size > 0) {
          const firstSubgroup = Array.from(group.subgroups.keys())[0];
          setSelectedGroupKey(`${groupName}/${firstSubgroup}`);
        } else {
          setSelectedGroupKey(groupName);
        }
      } else {
        // 그룹이 없을 때는 아무것도 선택하지 않음 (빈 상태 허용)
        setSelectedGroupKey('');
      }
    }
  }, [groupedData, selectedGroupKey, expandedKeys.length]);

  // 필터링된 아이템들
  const filteredItems = useMemo(() => {
    console.log('GroupableLineItemsWithSidebar: Filtering items:', {
      selectedGroupKey,
      totalItems: items.length,
      items: items.map(item => ({
        id: item.id,
        item: item.item,
        primary_group: item.primary_group,
        secondary_group: item.secondary_group
      }))
    });

    if (!selectedGroupKey || selectedGroupKey === '') {
      // No group selected, show all items
      console.log('GroupableLineItemsWithSidebar: No group selected, showing all items');
      return items;
    } else if (selectedGroupKey === 'ungrouped') {
      const ungroupedItems = items.filter(item => !item.primary_group);
      console.log('GroupableLineItemsWithSidebar: Ungrouped filter result:', ungroupedItems.length);
      return ungroupedItems;
    } else if (selectedGroupKey.includes('/')) {
      // 서브그룹 선택
      const [primary, secondary] = selectedGroupKey.split('/');
      const subgroupItems = items.filter(item =>
        item.primary_group === primary && item.secondary_group === secondary
      );
      console.log('GroupableLineItemsWithSidebar: Subgroup filter result:', subgroupItems.length);
      return subgroupItems;
    } else {
      // Primary 그룹 선택 - 해당 그룹의 모든 아이템 (서브그룹 포함)
      const primaryGroupItems = items.filter(item =>
        item.primary_group === selectedGroupKey
      );
      console.log('GroupableLineItemsWithSidebar: Primary group filter result (including subgroups):', primaryGroupItems.length);
      return primaryGroupItems;
    }
  }, [items, selectedGroupKey]);

  // 선택된 그룹 정보
  const selectedGroupInfo = useMemo(() => {
    if (selectedGroupKey === 'ungrouped') {
      return { name: 'Ungrouped Items', count: groupedData.ungrouped.length };
    } else if (selectedGroupKey.includes('/')) {
      const [primary, secondary] = selectedGroupKey.split('/');
      const group = groupedData.groups.get(primary);
      const subItems = group?.subgroups.get(secondary) || [];
      return { name: `${primary} > ${secondary}`, count: subItems.length };
    } else {
      const group = groupedData.groups.get(selectedGroupKey);
      return { name: selectedGroupKey, count: group?.items.length || 0 };
    }
  }, [selectedGroupKey, groupedData]);

  const handleCreateGroup = () => {
    setEditingGroup(null);
    setGroupModalVisible(true);
  };

  const handleGroupSubmit = useCallback((values: { group_name: string }) => {
    const { group_name } = values;

      // Create mode only
      if (editingGroup?.primary) {
        // 서브그룹 생성
        console.log('Creating subgroup:', {
          parentGroup: editingGroup.primary,
          subgroupName: group_name,
          existingEmptyGroups: emptyGroups.map(g => `${g.primary}${g.secondary ? '/' + g.secondary : ''}`)
        });

        // Validate parent group name doesn't contain '/'
        if (editingGroup.primary.includes('/')) {
          console.error('Invalid parent group name contains slash:', editingGroup.primary);
          message.error('Cannot create subgroup under an invalid parent group');
          return;
        }

        // Check if the parent group already exists in emptyGroups or has items
        const parentGroupExists = emptyGroups.some(g => g.primary === editingGroup.primary && !g.secondary) ||
                                  items.some(item => item.primary_group === editingGroup.primary);

        // Only add the subgroup, don't create a new parent group entry
        const newSubgroup = { primary: editingGroup.primary, secondary: group_name };

        // If parent group doesn't exist in emptyGroups, add it first
        let updatedEmptyGroups = [...emptyGroups];
        if (!parentGroupExists && !emptyGroups.some(g => g.primary === editingGroup.primary)) {
          updatedEmptyGroups.push({ primary: editingGroup.primary });
        }

        // Add the subgroup
        updatedEmptyGroups.push(newSubgroup);
        console.log('Updated empty groups after subgroup creation:', updatedEmptyGroups.map(g => `${g.primary}${g.secondary ? '/' + g.secondary : ''}`));
        setEmptyGroups(updatedEmptyGroups);

        // 부모 그룹을 확장하여 새 서브그룹이 보이도록 함
        if (!expandedKeys.includes(editingGroup.primary)) {
          setExpandedKeys([...expandedKeys, editingGroup.primary]);
        }
        // 새로 생성한 서브그룹으로 포커싱
        setSelectedGroupKey(`${editingGroup.primary}/${group_name}`);
        message.success(`Subgroup '${group_name}' created under '${editingGroup.primary}'`);
      } else {
        // Primary 그룹 생성
        console.log('Creating primary group:', group_name);
        const newEmptyGroup = { primary: group_name };
        setEmptyGroups([...emptyGroups, newEmptyGroup]);
        // 새로 생성한 그룹으로 포커싱
        setSelectedGroupKey(group_name);
        message.success(`Group '${group_name}' created`);
      }

      setGroupModalVisible(false);
  }, [editingGroup, emptyGroups, items, onItemsChange, expandedKeys]);

  const handleGroupSelect = (groupKey: string) => {
    setSelectedGroupKey(groupKey);
  };
  
  const handleCreateSubgroup = (primaryGroup: string) => {
    setEditingGroup({ primary: primaryGroup });
    setGroupModalVisible(true);
  };
  

  const handleRenameGroup = (oldName: string, newName: string, isSubgroup: boolean, parentGroup?: string) => {
    if (!newName.trim() || newName === oldName) return;

    if (isSubgroup && parentGroup) {
      // Rename subgroup
      setEmptyGroups(emptyGroups.map(g => {
        if (g.primary === parentGroup && g.secondary === oldName) {
          return { ...g, secondary: newName };
        }
        return g;
      }));

      // Update items with this subgroup
      const newItems = items.map(item => {
        if (item.primary_group === parentGroup && item.secondary_group === oldName) {
          return { ...item, secondary_group: newName };
        }
        return item;
      });
      onItemsChange(newItems);

      // Update selected key if needed
      if (selectedGroupKey === `${parentGroup}/${oldName}`) {
        setSelectedGroupKey(`${parentGroup}/${newName}`);
      }

      message.success(`Subgroup renamed from '${oldName}' to '${newName}'`);
    } else {
      // Rename primary group
      setEmptyGroups(emptyGroups.map(g => {
        if (g.primary === oldName) {
          return { ...g, primary: newName };
        }
        return g;
      }));

      // Update items with this primary group
      const newItems = items.map(item => {
        if (item.primary_group === oldName) {
          return { ...item, primary_group: newName };
        }
        return item;
      });
      onItemsChange(newItems);

      // Update selected key if needed
      if (selectedGroupKey === oldName) {
        setSelectedGroupKey(newName);
      } else if (selectedGroupKey.startsWith(oldName + '/')) {
        const subgroup = selectedGroupKey.substring(oldName.length + 1);
        setSelectedGroupKey(`${newName}/${subgroup}`);
      }

      // Update expanded keys if needed
      if (expandedKeys.includes(oldName)) {
        setExpandedKeys(expandedKeys.map(key => key === oldName ? newName : key));
      }

      message.success(`Group renamed from '${oldName}' to '${newName}'`);
    }
  };
  
  const handleDeleteGroup = (primaryGroup: string, secondaryGroup?: string) => {
    // Check if this group has any items
    const groupItems = items.filter(item => {
      if (secondaryGroup) {
        return item.primary_group === primaryGroup && item.secondary_group === secondaryGroup;
      } else {
        return item.primary_group === primaryGroup;
      }
    });

    const hasItems = groupItems.length > 0;

    // Updated logic: Delete group and all items by default
    if (hasItems) {
      Modal.confirm({
        title: 'Delete Group',
        content: (
          <div>
            <p>
              {`Are you sure you want to delete ${secondaryGroup ? `subgroup '${secondaryGroup}'` : `group '${primaryGroup}'`}?
              This group contains ${groupItems.length} item(s).`}
            </p>
            <p style={{ color: '#ff4d4f', fontWeight: 'bold' }}>
              This will permanently delete the group and all items in it.
            </p>
          </div>
        ),
        okText: 'Delete Group & Items',
        okType: 'danger',
        cancelText: 'Cancel',
        onOk: () => {
          if (secondaryGroup) {
            // Delete subgroup and its items
            setEmptyGroups(emptyGroups.filter(g =>
              !(g.primary === primaryGroup && g.secondary === secondaryGroup)
            ));
            // Remove items in this subgroup
            const newItems = items.filter(item =>
              !(item.primary_group === primaryGroup && item.secondary_group === secondaryGroup)
            );
            onItemsChange(newItems);
            message.success(`Subgroup '${secondaryGroup}' and ${groupItems.length} item(s) deleted`);
          } else {
            // Delete primary group and all its items
            setEmptyGroups(emptyGroups.filter(g => g.primary !== primaryGroup));
            // Remove all items in this group
            const newItems = items.filter(item => item.primary_group !== primaryGroup);
            onItemsChange(newItems);
            // Clear selection if the deleted group was selected
            if (selectedGroupKey === primaryGroup || selectedGroupKey.startsWith(primaryGroup + '/')) {
              setSelectedGroupKey('');
            }
            message.success(`Group '${primaryGroup}' and ${groupItems.length} item(s) deleted`);
          }
        }
      });
    } else {
      // Empty group - just delete the group
      Modal.confirm({
        title: 'Delete Empty Group',
        content: `Are you sure you want to delete ${secondaryGroup ? `subgroup '${secondaryGroup}'` : `group '${primaryGroup}'`}? This group is empty.`,
        onOk: () => {
          if (secondaryGroup) {
            // Delete empty subgroup
            setEmptyGroups(emptyGroups.filter(g =>
              !(g.primary === primaryGroup && g.secondary === secondaryGroup)
            ));
            message.success(`Empty subgroup '${secondaryGroup}' deleted`);
          } else {
            // Delete empty primary group
            setEmptyGroups(emptyGroups.filter(g => g.primary !== primaryGroup));
            // Clear selection if the deleted group was selected
            if (selectedGroupKey === primaryGroup || selectedGroupKey.startsWith(primaryGroup + '/')) {
              setSelectedGroupKey('');
            }
            message.success(`Empty group '${primaryGroup}' deleted`);
          }
        }
      });
    }
  };

  const handleSubgroupMove = (subgroupKey: string, targetGroupKey: string, dropPosition?: 'before' | 'after', targetSubgroupKey?: string) => {
    const [sourceGroup, subgroupName] = subgroupKey.split('/');

    // Handle reordering within the same group
    if (sourceGroup === targetGroupKey && targetSubgroupKey && dropPosition) {
      handleSubgroupReorder(subgroupKey, targetSubgroupKey, dropPosition);
      return;
    }

    // Handle moving to different group (existing logic)
    // Check if target group already has a subgroup with the same name
    const targetGroup = groupedData.groups.get(targetGroupKey);
    if (targetGroup && targetGroup.subgroups.has(subgroupName)) {
      message.error(`Target group '${targetGroupKey}' already has a subgroup named '${subgroupName}'`);
      return;
    }

    // Find all items in the source subgroup
    const itemsToMove = items.filter(item =>
      item.primary_group === sourceGroup && item.secondary_group === subgroupName
    );

    // Update items to new primary group
    const updatedItems = items.map(item => {
      if (item.primary_group === sourceGroup && item.secondary_group === subgroupName) {
        return { ...item, primary_group: targetGroupKey };
      }
      return item;
    });

    // Update empty groups state
    const updatedEmptyGroups = emptyGroups.map(group => {
      if (group.primary === sourceGroup && group.secondary === subgroupName) {
        return { ...group, primary: targetGroupKey };
      }
      return group;
    });

    // If moving an empty subgroup that doesn't exist in emptyGroups, create it
    if (itemsToMove.length === 0) {
      const existsInEmptyGroups = emptyGroups.some(g =>
        g.primary === sourceGroup && g.secondary === subgroupName
      );
      if (!existsInEmptyGroups) {
        updatedEmptyGroups.push({ primary: targetGroupKey, secondary: subgroupName });
      }
    }

    // Apply updates
    onItemsChange(updatedItems);
    setEmptyGroups(updatedEmptyGroups);

    // Update selected group if currently viewing the moved subgroup
    if (selectedGroupKey === subgroupKey) {
      setSelectedGroupKey(`${targetGroupKey}/${subgroupName}`);
    }

    // Ensure target group is expanded to show the moved subgroup
    if (!expandedKeys.includes(targetGroupKey)) {
      setExpandedKeys([...expandedKeys, targetGroupKey]);
    }

    message.success(`Subgroup '${subgroupName}' moved from '${sourceGroup}' to '${targetGroupKey}' with ${itemsToMove.length} item(s)`);
  };

  const handleSubgroupReorder = (sourceSubgroupKey: string, targetSubgroupKey: string, position: 'before' | 'after') => {
    console.log('handleSubgroupReorder called:', {
      sourceSubgroupKey,
      targetSubgroupKey,
      position
    });

    const [sourceGroup, sourceSubgroupName] = sourceSubgroupKey.split('/');
    const [targetGroup, targetSubgroupName] = targetSubgroupKey.split('/');

    if (sourceGroup !== targetGroup) {
      console.log('Different groups, skipping reorder');
      return; // This should not happen for reordering
    }

    if (sourceSubgroupName === targetSubgroupName) {
      console.log('Same subgroup, no reordering needed');
      return; // Same subgroup, no reordering needed
    }

    // Get all subgroups in the group
    const group = groupedData.groups.get(sourceGroup);
    if (!group) {
      console.log('Group not found:', sourceGroup);
      return;
    }

    const subgroupNames = Array.from(group.subgroups.keys());
    console.log('Current subgroup order:', subgroupNames);

    const sourceIndex = subgroupNames.indexOf(sourceSubgroupName);
    const targetIndex = subgroupNames.indexOf(targetSubgroupName);

    if (sourceIndex === -1 || targetIndex === -1) {
      console.log('Subgroup not found in list:', { sourceIndex, targetIndex });
      return;
    }

    // Calculate new position
    let newIndex = targetIndex;
    if (position === 'after') {
      newIndex = targetIndex + 1;
    }
    if (sourceIndex < targetIndex && position === 'before') {
      newIndex = targetIndex - 1;
    }

    console.log('Index calculation:', {
      sourceIndex,
      targetIndex,
      newIndex,
      position
    });

    // Remove source and insert at new position
    const reorderedNames = [...subgroupNames];
    reorderedNames.splice(sourceIndex, 1);
    reorderedNames.splice(newIndex, 0, sourceSubgroupName);

    console.log('New subgroup order:', reorderedNames);

    // Update sort_order for all items in these subgroups
    const updatedItems = items.map(item => {
      if (item.primary_group === sourceGroup && item.secondary_group) {
        const subgroupIndex = reorderedNames.indexOf(item.secondary_group);
        if (subgroupIndex !== -1) {
          const newSortOrder = (subgroupIndex + 1) * 1000 + ((item.sort_order || 0) % 1000);
          console.log(`Updating item sort_order: ${item.secondary_group} -> ${newSortOrder}`);
          return {
            ...item,
            sort_order: newSortOrder
          };
        }
      }
      return item;
    });

    // Update empty groups order
    const updatedEmptyGroups = emptyGroups.map(group => {
      if (group.primary === sourceGroup && group.secondary) {
        const subgroupIndex = reorderedNames.indexOf(group.secondary);
        if (subgroupIndex !== -1) {
          const newSortOrder = (subgroupIndex + 1) * 1000;
          console.log(`Updating empty group sort_order: ${group.secondary} -> ${newSortOrder}`);
          return {
            ...group,
            sort_order: newSortOrder
          };
        }
      }
      return group;
    });

    console.log('Applying updates...');
    onItemsChange(updatedItems);
    setEmptyGroups(updatedEmptyGroups);

    message.success(`Subgroup '${sourceSubgroupName}' reordered ${position} '${targetSubgroupName}'`);
  };

  // Handle sidebar resize
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    // Prevent text selection during drag
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;
      
      // Calculate width relative to the container's left edge
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      
      // Constrain width between min and max
      const constrainedWidth = Math.min(Math.max(newWidth, 150), 400);
      setSidebarWidth(constrainedWidth);
    };

    const handleMouseUp = () => {
      if (isResizing) {
        setIsResizing(false);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      // Add mouse leave to handle mouse going outside window
      document.addEventListener('mouseleave', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mouseleave', handleMouseUp);
      // Clean up styles
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizing]);

  return (
    <div ref={containerRef} style={{ display: 'flex', height: '100%', position: 'relative' }}>
      {/* Custom Sidebar */}
      <div
        style={{
          width: `${sidebarWidth}px`,
          minWidth: `${sidebarWidth}px`,
          background: '#fff',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid #f0f0f0',
        }}
      >
        <GroupNavigationSidebar
          groupedData={groupedData}
          items={items}
          selectedGroupKey={selectedGroupKey}
          onGroupSelect={handleGroupSelect}
          onCreateGroup={handleCreateGroup}
          onCreateSubgroup={handleCreateSubgroup}
          onDeleteGroup={handleDeleteGroup}
          onRenameGroup={handleRenameGroup}
          onSubgroupMove={handleSubgroupMove}
          expandedKeys={expandedKeys}
          onExpandedKeysChange={setExpandedKeys}
          isNarrow={sidebarWidth < 250}
        />
        {/* Resize Handle */}
        <div
          onMouseDown={handleMouseDown}
          onMouseEnter={() => setIsHoveringHandle(true)}
          onMouseLeave={() => setIsHoveringHandle(false)}
          style={{
            position: 'absolute',
            right: -5,
            top: 0,
            bottom: 0,
            width: '10px',
            cursor: 'col-resize',
            zIndex: 999,  // Lower than modal z-index (typically 1000+)
            background: 'transparent',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: '4px',
              top: 0,
              bottom: 0,
              width: '2px',
              backgroundColor: isResizing ? '#1890ff' : (isHoveringHandle ? '#40a9ff' : '#d9d9d9'),
              transition: isResizing ? 'none' : 'background-color 0.2s',
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>
      
      {/* Content Area */}
      <div style={{ flex: 1, padding: '16px', overflow: 'auto', height: '100%' }}>
        {!selectedGroupKey ? (
          // Show empty state when no group is selected
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            textAlign: 'center',
            color: '#8c8c8c'
          }}>
            <AppstoreOutlined style={{ fontSize: 48, marginBottom: 24 }} />
            <Typography.Title level={4} type="secondary">
              No Group Selected
            </Typography.Title>
            <Typography.Text type="secondary" style={{ marginBottom: 24 }}>
              Select a group from the sidebar or create a new group to start adding line items.
            </Typography.Text>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreateGroup}
            >
              Create Group
            </Button>
          </div>
        ) : (
          <LineItemManager
            items={Array.isArray(filteredItems) ? filteredItems.filter(item => item != null) : []}
            selectedGroup={selectedGroupKey}
            onItemsChange={(newItems) => {
            console.log('GroupableLineItemsWithSidebar: onItemsChange called with:', newItems);
            console.log('GroupableLineItemsWithSidebar: Current filteredItems:', filteredItems);
            console.log('GroupableLineItemsWithSidebar: Current full items:', items);
            
            // Ensure newItems is always an array
            const safeNewItems = Array.isArray(newItems) ? newItems.filter(item => item != null) : [];
            const safeItems = Array.isArray(items) ? items.filter(item => item != null) : [];
            const safeFilteredItems = Array.isArray(filteredItems) ? filteredItems.filter(item => item != null) : [];
            
            console.log('GroupableLineItemsWithSidebar: Safe arrays:', {
              newItems: safeNewItems.length,
              items: safeItems.length,
              filteredItems: safeFilteredItems.length
            });

            // Simple approach: if we're adding new items (more items than before), just append them
            if (safeNewItems.length > safeFilteredItems.length) {
              const newAddedItems = safeNewItems.slice(safeFilteredItems.length);
              console.log('GroupableLineItemsWithSidebar: Adding new items:', newAddedItems);
              const updatedItems = [...safeItems, ...newAddedItems];
              console.log('GroupableLineItemsWithSidebar: Final updated items:', updatedItems);
              onItemsChange(updatedItems);
              return;
            }
            
            // For updates and deletions, use the existing complex logic
            const updatedItems = [...safeItems];
            
            // Find and update the filtered items in the full array
            safeFilteredItems.forEach((originalItem, filteredIndex) => {
              const actualIndex = safeItems.indexOf(originalItem);
              if (actualIndex !== -1 && safeNewItems[filteredIndex]) {
                updatedItems[actualIndex] = safeNewItems[filteredIndex];
              }
            });
            
            // Handle deleted items - if newItems is shorter, remove the deleted items
            if (safeNewItems.length < safeFilteredItems.length) {
              const deletedItems = safeFilteredItems.slice(safeNewItems.length);
              deletedItems.forEach(deletedItem => {
                const actualIndex = updatedItems.indexOf(deletedItem);
                if (actualIndex !== -1) {
                  updatedItems.splice(actualIndex, 1);
                }
              });
            }
            
            console.log('GroupableLineItemsWithSidebar: Final updated items (update/delete):', updatedItems);
            onItemsChange(updatedItems);
          }}
          />
        )}
      </div>
      
      {/* Group Creation Modal */}
      <Modal
        title={editingGroup?.primary ? 'Create Subgroup' : 'Create Group'}
        open={groupModalVisible}
        footer={null}
        onCancel={() => {
          setGroupModalVisible(false);
        }}
        destroyOnHidden
        width={500}
      >
        <Form 
          layout="vertical" 
          onFinish={handleGroupSubmit}
          initialValues={{
            group_name: ''
          }}
        >
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
                  placeholder="Enter subgroup name"
                  options={
                    (SUGGESTED_GROUPS.secondary[editingGroup.primary as keyof typeof SUGGESTED_GROUPS.secondary] ||
                    SUGGESTED_GROUPS.secondary.default).map(g => ({ value: g }))
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
                placeholder="Enter group name"
                options={SUGGESTED_GROUPS.primary.map(g => ({ value: g }))}
              />
            </Form.Item>
          )}
          
          <Form.Item style={{ marginBottom: 0, marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={() => setGroupModalVisible(false)}>
                Cancel
              </Button>
              <Button type="primary" htmlType="submit">
                Create
              </Button>
            </div>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default GroupableLineItemsWithSidebar;