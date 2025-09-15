/**
 * Line Item Selector Component
 * Modal for searching and selecting line items
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  Table,
  Input,
  Select,
  Button,
  Space,
  Tag,
  InputNumber,
  Tooltip,
  message,
  Row,
  Col,
  Divider
} from 'antd';
import {
  SearchOutlined,
  PlusOutlined,
  InfoCircleOutlined,
  FilterOutlined
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import lineItemService from '../../services/lineItemService';
import { LineItem, LineItemCategory, LineItemType, LineItemModalItem } from '../../types/lineItem';
import CustomLineItemForm from './CustomLineItemForm';

const { Search } = Input;
const { Option } = Select;

interface LineItemSelectorProps {
  visible: boolean;
  onClose: () => void;
  onAddItems: (items: Array<{ item: LineItem; quantity: number }>) => void;
  selectedItems?: string[]; // Already added items to disable
}

const LineItemSelector: React.FC<LineItemSelectorProps> = ({
  visible,
  onClose,
  onAddItems,
  selectedItems = []
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<'all' | LineItemType.XACTIMATE | LineItemType.CUSTOM>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [selectedRows, setSelectedRows] = useState<LineItem[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [showCustomForm, setShowCustomForm] = useState(false);

  // Fetch categories for filter dropdown
  const { data: categories = [] } = useQuery<LineItemCategory[]>({
    queryKey: ['lineItemCategories'],
    queryFn: () => lineItemService.getCategories(),
    staleTime: 5 * 60 * 1000 // Cache for 5 minutes
  });

  // Create category map for quick lookup
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach(cat => {
      map.set(cat.code, cat.name);
    });
    return map;
  }, [categories]);

  // Fetch line items using modal-specific API
  const { data: lineItemsData, isLoading } = useQuery<LineItemModalItem[]>({
    queryKey: ['lineItemsModal', searchTerm, selectedType, selectedCategory, page, pageSize],
    queryFn: () => lineItemService.getLineItemsForModal({
      search_term: searchTerm || undefined,
      category: selectedCategory === 'all' ? undefined : selectedCategory,
      page,
      page_size: pageSize
    }),
    placeholderData: (previousData) => previousData // React Query v5 replacement for keepPreviousData
  });

  // Table columns
  const columns = [
    {
      title: 'Item',
      key: 'item',
      render: (record: LineItem) => (
        <div>
          <div style={{ fontWeight: 500 }}>
            {record.description}
          </div>
          {record.includes && (
            <div style={{ fontSize: '12px', color: '#666', marginTop: 4 }}>
              📝 {record.includes}
            </div>
          )}
        </div>
      )
    },
    {
      title: 'Category',
      dataIndex: 'cat',
      key: 'cat',
      width: 150,
      render: (cat: string) => (
        <Tag color="blue">{categoryMap.get(cat) || cat}</Tag>
      )
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (type: string) => (
        <Tag color={type === LineItemType.XACTIMATE ? 'gold' : 'green'}>
          {type}
        </Tag>
      )
    },
    {
      title: 'Unit Price',
      key: 'price',
      width: 120,
      align: 'right' as const,
      render: (record: LineItem) => (
        <Space>
          <span>${record.untaxed_unit_price?.toFixed(2) || '0.00'}</span>
          {record.lab !== undefined && (
            <Tooltip
              title={
                <div>
                  <div>Labor: ${record.lab?.toFixed(2) || '0.00'}</div>
                  <div>Material: ${record.mat?.toFixed(2) || '0.00'}</div>
                  <div>Equipment: ${record.equ?.toFixed(2) || '0.00'}</div>
                  <div>Labor Burden: ${record.labor_burden?.toFixed(2) || '0.00'}</div>
                  <div>Market: ${record.market_condition?.toFixed(2) || '0.00'}</div>
                </div>
              }
            >
              <InfoCircleOutlined style={{ color: '#1890ff' }} />
            </Tooltip>
          )}
        </Space>
      )
    },
    {
      title: 'Quantity',
      key: 'quantity',
      width: 120,
      render: (record: LineItem) => {
        if (!record || !record.id) return null;
        return (
          <InputNumber
            min={0}
            defaultValue={1}
            value={quantities[record.id] || 1}
            onChange={(value) => setQuantities(prev => ({
              ...prev,
              [record.id]: value || 1
            }))}
            disabled={selectedItems.includes(record.id)}
          />
        );
      }
    },
    {
      title: 'Action',
      key: 'action',
      width: 100,
      align: 'center' as const,
      render: (record: LineItem) => {
        if (!record || !record.id) return null;
        return (
          <Button
            size="small"
            type="primary"
            onClick={() => handleAddSingle(record)}
            disabled={selectedItems.includes(record.id)}
          >
            Add
          </Button>
        );
      }
    }
  ];

  // Handle single item add
  const handleAddSingle = (item: LineItem) => {
    if (!item || !item.id) {
      message.error('Invalid item selected');
      return;
    }
    const quantity = quantities[item.id] || 1;
    onAddItems([{ item, quantity }]);
    message.success(`Added ${item.description} (x${quantity})`);
  };

  // Handle bulk add
  const handleAddSelected = () => {
    // Filter out invalid items
    const validSelectedRows = selectedRows.filter(item => item && item.id);
    
    if (validSelectedRows.length === 0) {
      message.warning('No valid items selected');
      return;
    }
    
    const itemsToAdd = validSelectedRows.map(item => ({
      item,
      quantity: quantities[item.id] || 1
    }));
    
    onAddItems(itemsToAdd);
    message.success(`Added ${itemsToAdd.length} items`);
    setSelectedRows([]);
  };

  // Convert modal API response to LineItem format and ensure data is valid
  const validDataSource = useMemo(() => {
    // Modal API returns array directly, not wrapped in items
    const modalItems = Array.isArray(lineItemsData) ? lineItemsData : [];
    
    // Convert modal format to LineItem format and apply type filter
    return modalItems
      .filter(item => item && item.id && item.component_code !== undefined)
      .filter(item => {
        // Apply type filter if selected
        if (selectedType !== 'all') {
          const itemType = item.type === 'xactimate' ? LineItemType.XACTIMATE : LineItemType.CUSTOM;
          return itemType === selectedType;
        }
        return true;
      })
      .map(modalItem => ({
        id: modalItem.id,
        type: modalItem.type === 'xactimate' ? LineItemType.XACTIMATE : LineItemType.CUSTOM,
        cat: modalItem.category || '',
        item: modalItem.component_code || '',
        description: modalItem.description || '',
        includes: '', // Modal format doesn't include this
        unit: modalItem.unit || 'EA',
        untaxed_unit_price: modalItem.unit_price || 0,
        is_active: true,
        version: 1,
        created_at: new Date().toISOString(),
        notes: []
      } as LineItem));
  }, [lineItemsData, selectedType]);

  // Row selection config
  const rowSelection = {
    selectedRowKeys: selectedRows.filter(r => r && r.id).map(r => r.id),
    onChange: (selectedRowKeys: React.Key[], selectedRows: LineItem[]) => {
      // Filter out undefined/null items and already selected items
      const validSelectedRows = (selectedRows || [])
        .filter(item => item && item.id && !selectedItems.includes(item.id));
      setSelectedRows(validSelectedRows);
    },
    getCheckboxProps: (record: LineItem) => {
      // Ensure record exists and has id property
      if (!record || !record.id) {
        return { disabled: true };
      }
      return {
        disabled: selectedItems.includes(record.id)
      };
    }
  };

  // Handle custom item creation
  const handleCustomItemCreated = (newItem: LineItem) => {
    setShowCustomForm(false);
    handleAddSingle(newItem);
  };

  return (
    <>
      <Modal
        title="Add Line Items"
        open={visible}
        onCancel={onClose}
        width={1200}
        footer={[
          <Button key="cancel" onClick={onClose}>
            Cancel
          </Button>,
          <Button
            key="add-selected"
            type="primary"
            onClick={handleAddSelected}
            disabled={selectedRows.length === 0}
          >
            Add Selected ({selectedRows.length} items)
          </Button>
        ]}
      >
        {/* Search and Filters */}
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={8}>
            <Search
              placeholder="Search items..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onSearch={() => setPage(1)}
              prefix={<SearchOutlined />}
              allowClear
            />
          </Col>
          <Col span={5}>
            <Select
              style={{ width: '100%' }}
              value={selectedType}
              onChange={setSelectedType}
              placeholder="Item Type"
            >
              <Option value="all">All Types</Option>
              <Option value={LineItemType.XACTIMATE}>
                <Tag color="gold">Xactimate</Tag>
              </Option>
              <Option value={LineItemType.CUSTOM}>
                <Tag color="green">Custom</Tag>
              </Option>
            </Select>
          </Col>
          <Col span={5}>
            <Select
              style={{ width: '100%' }}
              value={selectedCategory}
              onChange={setSelectedCategory}
              placeholder="Category"
              showSearch
              filterOption={(input, option) =>
                option?.children ? String(option.children).toLowerCase().includes(input.toLowerCase()) : false
              }
            >
              <Option value="all">All Categories</Option>
              {categories.map(cat => (
                <Option key={cat.code} value={cat.code}>
                  {cat.name}
                </Option>
              ))}
            </Select>
          </Col>
          <Col span={6} style={{ textAlign: 'right' }}>
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={() => setShowCustomForm(true)}
            >
              Create Custom Item
            </Button>
          </Col>
        </Row>

        <Divider style={{ margin: '12px 0' }} />

        {/* Line Items Table */}
        <Table
          rowSelection={rowSelection}
          columns={columns}
          dataSource={validDataSource}
          loading={isLoading}
          rowKey="id"
          pagination={{
            current: page,
            pageSize,
            total: validDataSource.length,
            onChange: (newPage) => setPage(newPage),
            showSizeChanger: false,
            showTotal: (total) => `Total ${total} items`
          }}
          scroll={{ y: 400 }}
        />
      </Modal>

      {/* Custom Item Creation Form */}
      {showCustomForm && (
        <CustomLineItemForm
          open={showCustomForm}
          onClose={() => setShowCustomForm(false)}
          onSuccess={handleCustomItemCreated}
          categories={categories}
        />
      )}
    </>
  );
};

export default LineItemSelector;