import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Modal,
  Select,
  Input,
  Button,
  Table,
  Row,
  Col,
  Empty,
  message,
  Space,
  Typography,
} from 'antd';
import { SearchOutlined, PushpinOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { LineItemModalItem, LineItem } from '../../types/lineItem';
import { useCategoryOptions } from '../../hooks/useCategoryCache';
import { useLineItemsCache } from '../../hooks/useLineItemsCache';

const { Option } = Select;
const { Text } = Typography;

export interface SelectionModalProps {
  open: boolean;
  onCancel: () => void;
  onSelect: (items: LineItemModalItem[]) => void;
  selectedCategory?: string;
}

const SelectionModal: React.FC<SelectionModalProps> = ({
  open,
  onCancel,
  onSelect,
  selectedCategory,
}) => {
  // Category data from React Query cache with 5-minute staleTime for efficiency
  const { categories, isLoading: categoriesLoading, isError: categoriesError } = useCategoryOptions();

  // Use shared line items cache (same cache as ItemCodeSelector)
  const { lineItems: cachedLineItems, isLoading: itemsLoading, error: itemsError, refetch } = useLineItemsCache();

  // State
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLineCategory, setSelectedLineCategory] = useState(selectedCategory || 'all');
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

  // Initialize modal when opened
  useEffect(() => {
    if (open) {
      // Reset selections
      setSelectedRowKeys([]);
      setSearchTerm('');
      // Set category from prop if provided
      if (selectedCategory && selectedCategory !== selectedLineCategory) {
        setSelectedLineCategory(selectedCategory);
      }
    }
  }, [open, selectedCategory]);

  // Transform LineItem to LineItemModalItem format for display
  const transformedLineItems = useMemo((): LineItemModalItem[] => {
    return cachedLineItems.map(item => ({
      id: item.id,
      component_code: item.item || '',
      item_code: item.item || '',
      description: item.description || 'No description',
      unit: item.unit || 'EA',
      act: item.type === 'XACTIMATE' ? '&' : '+',
      unit_price: item.untaxed_unit_price || 0,
      category: item.cat || '',
      type: item.type || 'CUSTOM',
      includes: item.includes || '',
    }));
  }, [cachedLineItems]);

  // Filter line items by category and search term (all client-side)
  const filteredLineItems = useMemo(() => {
    let filtered = transformedLineItems;

    // Filter by category
    if (selectedLineCategory && selectedLineCategory !== 'all') {
      const lowerCategory = selectedLineCategory.toLowerCase();
      filtered = filtered.filter(item =>
        (item.category || '').toLowerCase().includes(lowerCategory) ||
        (item.description || '').toLowerCase().includes(lowerCategory)
      );
    }

    // Filter by search term
    if (searchTerm && searchTerm.trim().length >= 2) {
      const lowerSearch = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(item =>
        (item.component_code || '').toLowerCase().includes(lowerSearch) ||
        (item.description || '').toLowerCase().includes(lowerSearch)
      );
    }

    return filtered;
  }, [transformedLineItems, selectedLineCategory, searchTerm]);

  // Clear selections when filtered data becomes empty
  useEffect(() => {
    if (filteredLineItems.length === 0 && selectedRowKeys.length > 0) {
      setSelectedRowKeys([]);
    }
  }, [filteredLineItems.length, selectedRowKeys.length]);

  // Handle search input change - now instant (no debounce needed)
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
  };

  // Handle category change
  const handleCategoryChange = (value: string) => {
    setSelectedLineCategory(value);
  };

  // Data transformation helper
  const getComponentCode = (item: LineItemModalItem): string => {
    return item.component_code || item.item_code || String(item.id) || 'N/A';
  };

  const getItemId = (item: LineItemModalItem): string => {
    return typeof item.id === 'number' ? item.id.toString() : (item.id || '');
  };

  // Handle row selection
  const handleRowSelection = useMemo(() => ({
    type: 'checkbox' as const,
    selectedRowKeys: selectedRowKeys || [],
    onChange: (newSelectedRowKeys: React.Key[]) => {
      if (Array.isArray(newSelectedRowKeys)) {
        setSelectedRowKeys(newSelectedRowKeys as string[]);
      }
    },
    onSelectAll: (selected: boolean, _selectedRows: LineItemModalItem[], changeRows: LineItemModalItem[]) => {
      const currentSelectedKeys = selectedRowKeys || [];
      if (selected) {
        const validChangeRows = (changeRows || []).filter(item => item && item.id);
        const newKeys = [...currentSelectedKeys, ...validChangeRows.map(item => getItemId(item))];
        setSelectedRowKeys(Array.from(new Set(newKeys)));
      } else {
        const validChangeRows = (changeRows || []).filter(item => item && item.id);
        const removeKeys = validChangeRows.map(item => getItemId(item));
        setSelectedRowKeys(currentSelectedKeys.filter(key => !removeKeys.includes(key)));
      }
    },
    onSelect: (record: LineItemModalItem, selected: boolean) => {
      if (!record || !record.id) return;
      const itemId = getItemId(record);
      const currentSelectedKeys = selectedRowKeys || [];
      if (selected) {
        setSelectedRowKeys([...currentSelectedKeys, itemId]);
      } else {
        setSelectedRowKeys(currentSelectedKeys.filter(key => key !== itemId));
      }
    },
    getCheckboxProps: (record: LineItemModalItem) => {
      if (!record || typeof record !== 'object') {
        return { disabled: true };
      }
      return {
        disabled: false,
        name: getComponentCode(record),
      };
    },
  }), [selectedRowKeys]);

  // Handle row click (toggle selection)
  const handleRowClick = (record: LineItemModalItem) => {
    const itemId = getItemId(record);
    const currentSelectedKeys = selectedRowKeys || [];
    if (currentSelectedKeys.includes(itemId)) {
      setSelectedRowKeys(currentSelectedKeys.filter(key => key !== itemId));
    } else {
      setSelectedRowKeys([...currentSelectedKeys, itemId]);
    }
  };

  // Handle row double click (add to selection and close)
  const handleRowDoubleClick = (record: LineItemModalItem) => {
    onSelect([record]);
  };

  // Handle OK button click
  const handleOk = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('Please select at least one item');
      return;
    }

    const selectedItems = filteredLineItems.filter(item =>
      selectedRowKeys.includes(getItemId(item))
    );

    if (selectedItems.length === 0) {
      message.warning('Selected items not found');
      return;
    }

    onSelect(selectedItems);
    setSelectedRowKeys([]);
  };

  // Handle keyboard navigation
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!filteredLineItems.length) return;

    const currentIndex = selectedRowKeys.length > 0
      ? filteredLineItems.findIndex(item => getItemId(item) === selectedRowKeys[selectedRowKeys.length - 1])
      : -1;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        const nextIndex = currentIndex < filteredLineItems.length - 1 ? currentIndex + 1 : 0;
        const nextItem = filteredLineItems[nextIndex];
        if (nextItem) {
          const nextItemId = getItemId(nextItem);
          if (!selectedRowKeys.includes(nextItemId)) {
            setSelectedRowKeys([...selectedRowKeys, nextItemId]);
          }
        }
        break;

      case 'ArrowUp':
        event.preventDefault();
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : filteredLineItems.length - 1;
        const prevItem = filteredLineItems[prevIndex];
        if (prevItem) {
          const prevItemId = getItemId(prevItem);
          if (!selectedRowKeys.includes(prevItemId)) {
            setSelectedRowKeys([...selectedRowKeys, prevItemId]);
          }
        }
        break;

      case ' ': // Space bar
        event.preventDefault();
        if (currentIndex >= 0) {
          const currentItem = filteredLineItems[currentIndex];
          const currentItemId = getItemId(currentItem);
          if (selectedRowKeys.includes(currentItemId)) {
            setSelectedRowKeys(selectedRowKeys.filter(key => key !== currentItemId));
          } else {
            setSelectedRowKeys([...selectedRowKeys, currentItemId]);
          }
        }
        break;

      case 'Enter':
        event.preventDefault();
        handleOk();
        break;

      case 'Escape':
        event.preventDefault();
        onCancel();
        break;
    }
  };

  // Clear all selections
  const handleClearSelection = () => {
    setSelectedRowKeys([]);
  };

  // Select all visible items
  const handleSelectAll = () => {
    const allKeys = filteredLineItems.map(item => getItemId(item));
    setSelectedRowKeys(allKeys);
  };

  // Table columns
  const columns: ColumnsType<LineItemModalItem> = [
    {
      title: 'Component Code',
      dataIndex: 'component_code',
      key: 'component_code',
      width: 120,
      sorter: (a, b) => getComponentCode(a).localeCompare(getComponentCode(b)),
      render: (_text: string, record: LineItemModalItem) => (
        <Text code style={{ fontSize: '12px' }}>{getComponentCode(record)}</Text>
      ),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (text: string) => (
        <div style={{ fontSize: '13px' }}>{text}</div>
      ),
    },
    {
      title: 'Unit',
      dataIndex: 'unit',
      key: 'unit',
      width: 60,
      align: 'center',
      render: (text: string) => (
        <Text style={{ fontSize: '12px' }}>{text}</Text>
      ),
    },
    {
      title: 'Act',
      dataIndex: 'act',
      key: 'act',
      width: 50,
      align: 'center',
      render: (text: string) => (
        <Text strong style={{ fontSize: '12px', color: text === '&' ? '#1890ff' : '#52c41a' }}>
          {text}
        </Text>
      ),
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      width: 80,
      align: 'center',
      render: (text: string) => (
        <Text code style={{ fontSize: '11px', backgroundColor: '#f0f0f0' }}>
          {text || '-'}
        </Text>
      ),
    },
    {
      title: 'Unit Price',
      dataIndex: 'unit_price',
      key: 'unit_price',
      width: 100,
      align: 'right',
      sorter: (a, b) => a.unit_price - b.unit_price,
      render: (value: number) => (
        <Text style={{ fontSize: '12px', fontFamily: 'monospace' }}>
          {value.toFixed(2)}
        </Text>
      ),
    },
  ];

  // Reset modal state on cancel
  const handleCancel = () => {
    setSearchTerm('');
    setSelectedLineCategory(selectedCategory || 'all');
    setSelectedRowKeys([]);
    onCancel();
  };

  return (
    <Modal
      title="Line Items Selection"
      open={open}
      onCancel={handleCancel}
      width={1000}
      footer={null}
      styles={{ body: { padding: '16px' } }}
    >
      <div
        style={{ height: '600px', display: 'flex', flexDirection: 'column' }}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        {/* Header Controls */}
        <Row gutter={[16, 16]} style={{ marginBottom: '16px' }}>
          {/* All Line Items Dropdown */}
          <Col span={6}>
            <Select
              value={selectedLineCategory}
              onChange={handleCategoryChange}
              style={{ width: '100%' }}
              placeholder="All Line Items"
              loading={categoriesLoading}
              notFoundContent={categoriesError ? 'Failed to load categories' : 'No categories found'}
            >
              {categories.map(cat => (
                <Option key={cat.value} value={cat.value}>
                  {cat.label}
                </Option>
              ))}
            </Select>
          </Col>

          {/* Search Input */}
          <Col span={18}>
            <Input
              placeholder="Search line items... (instant)"
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              prefix={<PushpinOutlined style={{ color: '#1890ff' }} />}
              suffix={<SearchOutlined />}
              allowClear
            />
          </Col>
        </Row>

        {/* Selection Summary */}
        <Row justify="space-between" align="middle" style={{ marginBottom: '16px' }}>
          <Col>
            <Space>
              <Text strong>
                {selectedRowKeys.length > 0
                  ? `${selectedRowKeys.length} item${selectedRowKeys.length > 1 ? 's' : ''} selected`
                  : 'No items selected'
                }
              </Text>
              {filteredLineItems.length > 0 && (
                <Text type="secondary">
                  ({filteredLineItems.length} total items)
                </Text>
              )}
            </Space>
          </Col>
          <Col>
            <Space>
              {selectedRowKeys.length > 0 && (
                <Button size="small" onClick={handleClearSelection}>
                  Clear Selection
                </Button>
              )}
              {filteredLineItems.length > 0 && (
                <Button size="small" onClick={handleSelectAll}>
                  Select All
                </Button>
              )}
            </Space>
          </Col>
        </Row>

        {/* Table */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Table
            columns={columns}
            dataSource={Array.isArray(filteredLineItems) ? filteredLineItems : []}
            rowKey={(record) => getItemId(record)}
            loading={itemsLoading}
            pagination={false}
            scroll={{ y: 400 }}
            size="small"
            rowSelection={Array.isArray(filteredLineItems) && filteredLineItems.length > 0 && !itemsLoading ? handleRowSelection : undefined}
            onRow={(record) => {
              if (!record || !record.id) {
                return {};
              }
              const itemId = getItemId(record);
              return {
                onClick: () => handleRowClick(record),
                onDoubleClick: () => handleRowDoubleClick(record),
                style: {
                  cursor: 'pointer',
                  backgroundColor: (selectedRowKeys || []).includes(itemId) ? '#e6f7ff' : undefined,
                },
              };
            }}
            locale={{
              emptyText: (
                <Empty
                  description={
                    itemsError
                      ? (
                        <Space direction="vertical">
                          <Text type="danger">Failed to load line items: {itemsError}</Text>
                          <Button size="small" onClick={() => refetch()}>Retry</Button>
                        </Space>
                      )
                      : searchTerm
                        ? 'No line items found for your search'
                        : 'No line items available'
                  }
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ),
            }}
          />
        </div>

        {/* Footer Buttons */}
        <Row
          justify="end"
          style={{
            marginTop: '16px',
            borderTop: '1px solid #f0f0f0',
            paddingTop: '16px'
          }}
        >
          <Col>
            <Space>
              <Button onClick={handleCancel}>
                Cancel
              </Button>
              <Button
                type="primary"
                onClick={handleOk}
                disabled={selectedRowKeys.length === 0}
              >
                OK ({selectedRowKeys.length})
              </Button>
              <Button disabled>
                View
              </Button>
              <Select disabled placeholder="Options" style={{ width: 100 }}>
                <Option value="options">Options</Option>
              </Select>
            </Space>
          </Col>
        </Row>
      </div>
    </Modal>
  );
};

export default SelectionModal;
