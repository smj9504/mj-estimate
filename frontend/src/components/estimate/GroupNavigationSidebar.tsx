import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { Tree, Typography, Button, Menu, Input, Tooltip, message } from 'antd';
import type { InputRef } from 'antd';
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
import { EstimateLineItem } from '../../services/estimateService';
import { formatNumber, formatCurrency } from '../../utils/formatUtils';

const { Text } = Typography;


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
  onDeleteGroup?: (primaryGroup: string, secondaryGroup?: string) => void;
  onRenameGroup?: (oldName: string, newName: string, isSubgroup: boolean, parentGroup?: string) => void;
  onSubgroupMove?: (subgroupKey: string, targetGroupKey: string, dropPosition?: 'before' | 'after', targetSubgroupKey?: string) => void;
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
  onDeleteGroup,
  onRenameGroup,
  onSubgroupMove,
  expandedKeys: controlledExpandedKeys,
  onExpandedKeysChange,
  isNarrow = false,
}) => {
  const [localExpandedKeys, setLocalExpandedKeys] = React.useState<React.Key[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    type: 'empty' | 'group' | 'subgroup';
    groupName?: string;
    subgroupName?: string;
  }>({ visible: false, x: 0, y: 0, type: 'empty' });
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputRef>(null);
  
  // Use controlled or local expanded keys
  const expandedKeys = controlledExpandedKeys !== undefined ? controlledExpandedKeys : localExpandedKeys;
  const setExpandedKeys = onExpandedKeysChange || setLocalExpandedKeys;

  // Focus input when editing key changes
  useEffect(() => {
    if (editingKey) {
      console.log('EditingKey changed:', editingKey);
      // Small delay to ensure the input is rendered
      const timer = setTimeout(() => {
        if (inputRef.current) {
          console.log('Focusing input');
          inputRef.current.focus();
          inputRef.current.select();
        } else {
          console.log('Input ref not available');
        }
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [editingKey]);

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
      case 'rename-group':
        if (type === 'subgroup' && groupName && subgroupName) {
          setEditingKey(`${groupName}/${subgroupName}`);
          setEditValue(subgroupName);
        } else if (type === 'group' && groupName) {
          setEditingKey(groupName);
          setEditValue(groupName);
        }
        break;
      case 'delete-group':
        if (groupName) onDeleteGroup?.(groupName, subgroupName);
        break;
    }

    setContextMenu({ ...contextMenu, visible: false });
  };

  const handleRename = useCallback(() => {
    console.log('handleRename called:', { editingKey, editValue, hasOnRenameGroup: !!onRenameGroup });

    if (!editingKey || !editValue.trim()) {
      console.log('Cancelling rename - no key or value');
      setEditingKey(null);
      setEditValue('');
      return;
    }

    const isSubgroup = editingKey.includes('/');
    if (isSubgroup) {
      const [parentGroup, oldSubgroupName] = editingKey.split('/');
      // Check if the new name is different
      if (editValue.trim() !== oldSubgroupName && onRenameGroup) {
        console.log('Renaming subgroup:', oldSubgroupName, '->', editValue.trim());
        onRenameGroup(oldSubgroupName, editValue.trim(), true, parentGroup);
      }
    } else {
      // Check if the new name is different
      if (editValue.trim() !== editingKey && onRenameGroup) {
        console.log('Renaming group:', editingKey, '->', editValue.trim());
        onRenameGroup(editingKey, editValue.trim(), false);
      }
    }
    setEditingKey(null);
    setEditValue('');
  }, [editingKey, editValue, onRenameGroup]);


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
        selectable: true
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
        
        const subgroupKey = `${groupName}/${subName}`;
        children.push({
          key: subgroupKey,
          title: (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%',
                opacity: isSubEmpty ? 0.5 : 1,
                backgroundColor: dragOverKey === subgroupKey ? '#e6f7ff' : (dragOverKey === groupName ? '#f0f8ff' : 'transparent'),
                border: dragOverKey === subgroupKey ? '2px solid #1890ff' : (dragOverKey === groupName ? '1px dashed #1890ff' : '1px solid transparent'),
                borderRadius: '4px',
                padding: '2px 4px',
                transition: 'all 0.2s ease',
              }}
              onContextMenu={(e) => handleContextMenu(e, 'subgroup', groupName, subName)}
            >
              {editingKey === subgroupKey ? (
                <div style={{ flex: 1, marginRight: 8 }}>
                  <Input
                    ref={inputRef}
                    size="small"
                    value={editValue}
                    onChange={(e) => {
                      console.log('Input value changed:', e.target.value);
                      setEditValue(e.target.value);
                    }}
                    onPressEnter={() => {
                      console.log('Enter pressed via onPressEnter');
                      handleRename();
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Escape') {
                        console.log('Escape pressed');
                        setEditingKey(null);
                        setEditValue('');
                      }
                    }}
                    onBlur={() => {
                      console.log('Input blur');
                      setTimeout(() => {
                        if (editingKey) {
                          handleRename();
                        }
                      }, 100);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    autoFocus
                    style={{ width: '100%' }}
                  />
                </div>
              ) : (
                <>
                  <Tooltip title="Double-click to rename" mouseEnterDelay={1}>
                    <span
                      style={{ fontStyle: isSubEmpty ? 'italic' : 'normal', cursor: 'pointer', display: 'inline-block' }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (!editingKey) {  // Only allow editing one at a time
                          console.log('Starting edit for subgroup:', subgroupKey);
                          setEditingKey(subgroupKey);
                          setEditValue(subName);
                        }
                      }}
                    >
                      {subName}
                    </span>
                  </Tooltip>
                  {!isNarrow && (
                    <Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto' }}>
                      {formatCurrency(subTotal)}
                    </Text>
                  )}
                </>
              )}
            </div>
          ),
          icon: <FolderOutlined />,
          selectable: true
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
              backgroundColor: dragOverKey === groupName ? '#e6f7ff' : 'transparent',
              border: dragOverKey === groupName ? '2px dashed #1890ff' : '2px solid transparent',
              borderRadius: '6px',
              padding: '4px 8px',
              margin: '2px 0',
              transition: 'all 0.2s ease',
            }}
            onContextMenu={(e) => handleContextMenu(e, 'group', groupName)}
          >
            {editingKey === groupName ? (
              <div style={{ flex: 1, marginRight: 8 }}>
                <Input
                  ref={inputRef}
                  size="small"
                  value={editValue}
                  onChange={(e) => {
                    console.log('Input value changed:', e.target.value);
                    setEditValue(e.target.value);
                  }}
                  onPressEnter={() => {
                    console.log('Enter pressed via onPressEnter');
                    handleRename();
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Escape') {
                      console.log('Escape pressed');
                      setEditingKey(null);
                      setEditValue('');
                    }
                  }}
                  onBlur={() => {
                    console.log('Input blur');
                    setTimeout(() => {
                      if (editingKey) {
                        handleRename();
                      }
                    }, 100);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  autoFocus
                  style={{ width: '100%', fontWeight: isEmpty ? 'normal' : 'bold' }}
                />
              </div>
            ) : (
              <>
                <Tooltip title="Double-click to rename" mouseEnterDelay={1}>
                  <span
                    style={{
                      fontStyle: isEmpty ? 'italic' : 'normal',
                      cursor: 'pointer',
                      fontWeight: isEmpty ? 'normal' : 'bold',
                      display: 'inline-block'
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      if (!editingKey) {  // Only allow editing one at a time
                        console.log('Starting edit for group:', groupName);
                        setEditingKey(groupName);
                        setEditValue(groupName);
                      }
                    }}
                  >
                    {groupName}
                  </span>
                </Tooltip>
                {!isNarrow && (
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto' }}>
                    ${formatNumber(group.subtotal)}
                  </Text>
                )}
              </>
            )}
          </div>
        ),
        icon: group.expanded ? <FolderOpenOutlined /> : <FolderOutlined />,
        children: children.length > 0 ? children : undefined,
        selectable: true
      });
    });

    return nodes;
  }, [groupedData, ungroupedTotal, isNarrow, editingKey, editValue, handleRename]);

  const handleSelect: TreeProps['onSelect'] = useCallback((selectedKeys: React.Key[], info: any) => {
    // Prevent selection when editing
    if (editingKey) {
      console.log('Preventing selection during edit');
      return;
    }

    if (selectedKeys.length > 0) {
      onGroupSelect(selectedKeys[0] as string);
    }
  }, [editingKey, onGroupSelect]);

  const handleExpand: TreeProps['onExpand'] = (keys) => {
    setExpandedKeys(keys);
  };

  // Drag and drop handlers
  const handleDragStart = (info: any) => {
    const { node, event } = info;

    // Safety check for node and event
    if (!node || !event || !node.key) {
      console.warn('handleDragStart: Missing node or event data', { node, event });
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      return false;
    }

    // Only allow dragging subgroups (nodes with keys containing '/')
    // Prevent dragging parent groups or ungrouped
    if (!node.key.includes('/') || node.key === 'ungrouped') {
      console.log('handleDragStart: Preventing drag for non-subgroup:', node.key);
      event.preventDefault();
      event.stopPropagation();
      message.info('Only subgroups can be moved');
      return false;
    }

    // Add visual feedback for drag start
    const dragElement = event.target.closest('.ant-tree-node-content-wrapper');
    if (dragElement) {
      dragElement.classList.add('drag-source');
    }

    // Set drag effect
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', node.key);

    // Custom drag image (optional)
    const dragImage = document.createElement('div');
    dragImage.innerHTML = `Moving: ${node.key.split('/')[1]}`;
    dragImage.style.cssText = `
      background: #1890ff;
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
      position: absolute;
      top: -1000px;
      left: -1000px;
    `;
    document.body.appendChild(dragImage);
    event.dataTransfer.setDragImage(dragImage, 50, 20);
    setTimeout(() => document.body.removeChild(dragImage), 0);
  };

  const handleDragEnter = (info: any) => {
    const { node, event } = info;

    // Safety check for node and event
    if (!node || !event || !node.key) {
      console.warn('handleDragEnter: Missing node or event data', { node, event });
      return;
    }

    // Allow dropping on primary groups and subgroups (for reordering)
    if (node.key !== 'ungrouped') {
      setDragOverKey(node.key);
      event.dataTransfer.dropEffect = 'move';
    } else {
      event.dataTransfer.dropEffect = 'none';
    }
  };

  const handleDragLeave = (info: any) => {
    const { node } = info;

    // Safety check for node
    if (!node || !node.key) {
      console.warn('handleDragLeave: Missing node data', { node });
      return;
    }

    // Clear drag over state when leaving any valid drop target
    if (node.key !== 'ungrouped') {
      setDragOverKey(null);
    }
  };

  const handleDragOver = (info: any) => {
    const { node, event } = info;

    // Safety check for node and event
    if (!node || !event || !node.key) {
      console.warn('handleDragOver: Missing node or event data', { node, event });
      return;
    }

    event.preventDefault();

    // Allow dropping on primary groups and subgroups (for reordering)
    if (node.key !== 'ungrouped') {
      event.dataTransfer.dropEffect = 'move';
    } else {
      event.dataTransfer.dropEffect = 'none';
    }
  };

  const handleDragEnd = (info: any) => {
    // Clean up visual feedback
    setDragOverKey(null);
    const dragElements = document.querySelectorAll('.drag-source');
    dragElements.forEach(el => el.classList.remove('drag-source'));
  };

  const handleDrop = (info: any) => {
    const { dragNode, node, event, dropPosition } = info;
    setDragOverKey(null);

    // Clean up visual feedback
    const dragElements = document.querySelectorAll('.drag-source');
    dragElements.forEach(el => el.classList.remove('drag-source'));

    // Safety check for required data
    if (!dragNode || !node || !dragNode.key || !node.key) {
      console.warn('handleDrop: Missing drag or drop node data', { dragNode, node });
      message.warning('Invalid drag operation');
      return;
    }

    // Validate: only subgroups can be dragged
    if (!dragNode.key.includes('/')) {
      message.warning('Only subgroups can be moved');
      return;
    }

    const sourceSubgroupKey = dragNode.key;
    const [sourceGroup, subgroupName] = sourceSubgroupKey.split('/');

    // Handle dropping on another subgroup (reordering within same group)
    if (node.key.includes('/')) {
      const [targetGroup, targetSubgroupName] = node.key.split('/');

      console.log('Dropping on subgroup:', {
        sourceSubgroupKey,
        targetSubgroupKey: node.key,
        sourceGroup,
        targetGroup,
        dropPosition
      });

      // Only allow reordering within the same primary group
      if (sourceGroup !== targetGroup) {
        message.warning('Cannot reorder subgroups between different primary groups');
        return;
      }

      if (sourceSubgroupKey === node.key) {
        console.log('Same subgroup, skipping');
        return; // Same subgroup, no action needed
      }

      // Determine drop position based on dropPosition
      let position: 'before' | 'after' = 'after';
      if (dropPosition === -1) {
        position = 'before';
      } else if (dropPosition === 1) {
        position = 'after';
      }

      console.log('Drop position determined:', {
        dropPosition,
        calculatedPosition: position
      });

      // Call the move handler for reordering
      if (onSubgroupMove) {
        console.log('Calling onSubgroupMove for reordering');
        onSubgroupMove(sourceSubgroupKey, targetGroup, position, node.key);
      }
      return;
    }

    // Handle dropping on primary group (moving to different group)
    if (node.key === 'ungrouped') {
      message.warning('Subgroups cannot be moved to ungrouped area');
      return;
    }

    const targetGroupKey = node.key;

    // Don't move if dropping on the same group without specific position
    if (sourceGroup === targetGroupKey) {
      message.info(`Subgroup '${subgroupName}' is already in group '${targetGroupKey}'`);
      return;
    }

    // Call the move handler for moving to different group
    if (onSubgroupMove) {
      onSubgroupMove(sourceSubgroupKey, targetGroupKey);
    }
  };

  // Context menu items
  const getContextMenuItems = () => {
    const { type } = contextMenu;
    
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
            key: 'rename-group',
            icon: <EditOutlined />,
            label: 'Rename Group',
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
            key: 'rename-group',
            icon: <EditOutlined />,
            label: 'Rename Subgroup',
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
            /* Drag and drop styles */
            .sidebar-tree .ant-tree-node-content-wrapper[draggable="true"] {
              cursor: grab !important;
              position: relative;
            }
            .sidebar-tree .ant-tree-node-content-wrapper[draggable="true"]:hover {
              background-color: #f5f5f5 !important;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1) !important;
            }
            .sidebar-tree .ant-tree-node-content-wrapper[draggable="true"]:active {
              cursor: grabbing !important;
              opacity: 0.7 !important;
            }
            .sidebar-tree .ant-tree-treenode.drag-over > .ant-tree-node-content-wrapper {
              background-color: #e6f7ff !important;
              border: 2px solid #1890ff !important;
              border-radius: 6px !important;
            }
            .sidebar-tree .ant-tree-treenode.drop-indicator {
              border: 2px dashed #52c41a !important;
              background-color: #f6ffed !important;
            }
            /* Drag preview effects */
            .sidebar-tree .ant-tree-node-content-wrapper.drag-source {
              opacity: 0.5 !important;
              background-color: #fafafa !important;
            }
            /* Drop zone highlighting */
            .sidebar-tree .ant-tree-treenode[data-drop-target="true"] > .ant-tree-node-content-wrapper {
              animation: pulse 1s infinite !important;
            }
            @keyframes pulse {
              0% { background-color: #e6f7ff; }
              50% { background-color: #bae7ff; }
              100% { background-color: #e6f7ff; }
            }
          `}
        </style>

        {treeData.length === 0 ? (
          // Show empty state when no groups exist
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '200px',
            textAlign: 'center',
            color: '#8c8c8c'
          }}>
            <AppstoreOutlined style={{ fontSize: 24, marginBottom: 12 }} />
            <Text type="secondary" style={{ fontSize: 13, marginBottom: 16 }}>
              No groups created yet
            </Text>
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={onCreateGroup}
            >
              Create Group
            </Button>
          </div>
        ) : (
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
            onDragStart={handleDragStart}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDrop={handleDrop}
            draggable
            treeData={treeData}
            style={{ fontSize: 13 }}
            autoExpandParent={false}
          />
        )}
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