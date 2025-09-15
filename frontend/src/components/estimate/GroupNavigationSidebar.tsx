import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Tree, Space, Typography, Badge, Button, Menu } from 'antd';
import {
  AppstoreOutlined,
  FileOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import type { DataNode, TreeProps } from 'antd/es/tree';
import { EstimateLineItem } from '../../services/EstimateService';

const { Text } = Typography;

// Utility function to format number with thousand separators
const formatNumber = (num: number | undefined | null): string => {
  if (num === undefined || num === null) return '0.00';
  return num.toLocaleString('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  });
};

interface GroupData {
  name: string;
  items: any[];
  subgroups: Map<string, any[]>;
  expanded: boolean;
  subtotal: number;
  itemCount: number;
}

interface GroupNavigationSidebarProps {
  groupedData: {
    groups: Map<string, GroupData>;
    ungrouped: any[];
  };
  items: EstimateLineItem[];
  selectedGroupKey: string;
  onGroupSelect: (groupKey: string) => void;
  onCreateGroup: () => void;
  onCreateSubgroup?: (primaryGroup: string) => void;
  onEditGroup?: (primaryGroup: string, secondaryGroup?: string) => void;
  onDeleteGroup?: (primaryGroup: string, secondaryGroup?: string) => void;
  expandedKeys?: React.Key[];
  onExpandedKeysChange?: (keys: React.Key[]) => void;
  isNarrow?: boolean;
}

const GroupNavigationSidebar: React.FC<GroupNavigationSidebarProps> = ({
  groupedData,
  items,
  selectedGroupKey,
  onGroupSelect,
  onCreateGroup,
  onCreateSubgroup,
  onEditGroup,
  onDeleteGroup,
  expandedKeys: controlledExpandedKeys,
  onExpandedKeysChange,
  isNarrow = false,
}) => {
  const [localExpandedKeys, setLocalExpandedKeys] = React.useState<React.Key[]>([]);
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    type: 'empty' | 'group' | 'subgroup';
    groupName?: string;
    subgroupName?: string;
  }>({ visible: false, x: 0, y: 0, type: 'empty' });
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Use controlled or local expanded keys
  const expandedKeys = controlledExpandedKeys !== undefined ? controlledExpandedKeys : localExpandedKeys;
  const setExpandedKeys = onExpandedKeysChange || setLocalExpandedKeys;

  // Calculate totals
  const grandTotal = useMemo(() => 
    items.reduce((sum, item) => sum + (item.total || 0), 0),
    [items]
  );

  const ungroupedTotal = useMemo(() =>
    groupedData.ungrouped.reduce((sum, item) => sum + (item.total || 0), 0),
    [groupedData.ungrouped]
  );

  // Context menu handlers
  const handleContextMenu = (e: React.MouseEvent, type: 'empty' | 'group' | 'subgroup', groupName?: string, subgroupName?: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    setContextMenu({
      visible: true,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      type,
      groupName,
      subgroupName,
    });
  };

  const handleContextMenuClick = ({ key }: { key: string }) => {
    const { type, groupName, subgroupName } = contextMenu;
    
    switch (key) {
      case 'create-group':
        onCreateGroup?.();
        break;
      case 'create-subgroup':
        if (groupName) onCreateSubgroup?.(groupName);
        break;
      case 'edit-group':
        if (groupName) onEditGroup?.(groupName, subgroupName);
        break;
      case 'delete-group':
        if (groupName) onDeleteGroup?.(groupName, subgroupName);
        break;
    }
    
    setContextMenu({ ...contextMenu, visible: false });
  };

  const handleContainerContextMenu = (e: React.MouseEvent) => {
    // Only show context menu if clicking on empty area (not on tree nodes)
    const target = e.target as HTMLElement;
    const isEmptyArea = target.closest('.ant-tree-treenode') === null;
    
    if (isEmptyArea) {
      handleContextMenu(e, 'empty');
    }
  };

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      setContextMenu(prev => ({ ...prev, visible: false }));
    };

    if (contextMenu.visible) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu.visible]);

  // Generate tree data
  const treeData = useMemo(() => {
    const nodes: DataNode[] = [];

    // Add ungrouped if exists
    if (groupedData.ungrouped.length > 0) {
      nodes.push({
        key: 'ungrouped',
        title: (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <Text>Ungrouped Items</Text>
            {!isNarrow && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                ${formatNumber(ungroupedTotal)}
              </Text>
            )}
          </div>
        ),
        icon: <FileOutlined />,
        selectable: true,
      });
    }

    // Add groups
    Array.from(groupedData.groups.entries()).forEach(([groupName, group]) => {
      const isEmpty = group.itemCount === 0;
      const children: DataNode[] = [];

      // Add subgroups
      Array.from(group.subgroups.entries()).forEach(([subName, subItems]) => {
        const subTotal = subItems.reduce((sum, item) => sum + (item.total || 0), 0);
        const isSubEmpty = subItems.length === 0;
        
        children.push({
          key: `${groupName}/${subName}`,
          title: (
            <div 
              style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                width: '100%',
                opacity: isSubEmpty ? 0.5 : 1,
              }}
              onContextMenu={(e) => handleContextMenu(e, 'subgroup', groupName, subName)}
            >
              <Text style={{ fontStyle: isSubEmpty ? 'italic' : 'normal' }}>
                {subName}
              </Text>
              {!isNarrow && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  ${subTotal.toFixed(2)}
                </Text>
              )}
            </div>
          ),
          icon: <FolderOutlined />,
          selectable: true,
        });
      });

      nodes.push({
        key: groupName,
        title: (
          <div 
            style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              width: '100%',
              opacity: isEmpty ? 0.5 : 1,
            }}
            onContextMenu={(e) => handleContextMenu(e, 'group', groupName)}
          >
            <Text strong={!isEmpty} style={{ fontStyle: isEmpty ? 'italic' : 'normal' }}>
              {groupName}
            </Text>
            {!isNarrow && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                ${formatNumber(group.subtotal)}
              </Text>
            )}
          </div>
        ),
        icon: group.expanded ? <FolderOpenOutlined /> : <FolderOutlined />,
        children: children.length > 0 ? children : undefined,
        selectable: true,
      });
    });

    return nodes;
  }, [groupedData, items, grandTotal, ungroupedTotal, isNarrow]);

  const handleSelect: TreeProps['onSelect'] = (selectedKeys, info) => {
    if (selectedKeys.length > 0) {
      onGroupSelect(selectedKeys[0] as string);
    }
  };

  const handleExpand: TreeProps['onExpand'] = (keys) => {
    setExpandedKeys(keys);
  };

  // Context menu items
  const getContextMenuItems = () => {
    const { type, groupName, subgroupName } = contextMenu;
    
    switch (type) {
      case 'empty':
        return [
          {
            key: 'create-group',
            icon: <PlusOutlined />,
            label: 'Create Group',
          },
        ];
      case 'group':
        return [
          {
            key: 'create-subgroup',
            icon: <PlusOutlined />,
            label: 'Add Subgroup',
          },
          {
            key: 'edit-group',
            icon: <EditOutlined />,
            label: 'Edit Group',
          },
          {
            key: 'delete-group',
            icon: <DeleteOutlined />,
            label: 'Delete Group',
          },
        ];
      case 'subgroup':
        return [
          {
            key: 'edit-group',
            icon: <EditOutlined />,
            label: 'Edit Subgroup',
          },
          {
            key: 'delete-group',
            icon: <DeleteOutlined />,
            label: 'Delete Subgroup',
          },
        ];
      default:
        return [];
    }
  };

  return (
    <div 
      ref={containerRef}
      style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}
      onContextMenu={handleContainerContextMenu}
    >

      {/* Tree */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
        <style>
          {`
            /* Force horizontal layout for tree nodes regardless of width */
            .sidebar-tree .ant-tree-treenode {
              display: flex !important;
              align-items: center !important;
            }
            .sidebar-tree .ant-tree-node-content-wrapper {
              display: inline-flex !important;
              align-items: center !important;
              width: 100% !important;
            }
            .sidebar-tree .ant-tree-iconEle {
              display: inline-flex !important;
              margin-right: 8px !important;
              flex-shrink: 0 !important;
            }
            .sidebar-tree .ant-tree-title {
              flex: 1 !important;
              display: inline-flex !important;
            }
            /* Prevent vertical stacking */
            .sidebar-tree .ant-tree-indent {
              display: inline-flex !important;
              align-items: center !important;
              vertical-align: middle !important;
            }
            .sidebar-tree .ant-tree-indent-unit {
              display: inline-flex !important;
              align-items: center !important;
            }
            .sidebar-tree .ant-tree-switcher {
              display: none !important;
            }
          `}
        </style>
        <Tree
          className="sidebar-tree"
          showIcon
          blockNode
          showLine={false}
          switcherIcon={null}
          selectedKeys={[selectedGroupKey]}
          expandedKeys={expandedKeys}
          onSelect={handleSelect}
          onExpand={handleExpand}
          treeData={treeData}
          style={{ fontSize: 13 }}
          autoExpandParent={false}
        />
      </div>

      {/* Footer */}
      <div style={{ padding: isNarrow ? '8px' : '12px', borderTop: '1px solid #f0f0f0' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <Text strong style={{ 
            color: '#52c41a', 
            fontSize: '16px',
            wordBreak: 'break-all'
          }}>
            ${formatNumber(grandTotal)}
          </Text>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu.visible && (
        <div
          style={{
            position: 'absolute',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 1000,
            background: '#fff',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            border: '1px solid #d9d9d9',
            padding: '4px 0',
            minWidth: '150px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Menu
            items={getContextMenuItems()}
            onClick={handleContextMenuClick}
            style={{
              border: 'none',
              background: 'transparent',
            }}
          />
        </div>
      )}
    </div>
  );
};

export default GroupNavigationSidebar;