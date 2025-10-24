/**
 * Line Item Selector Modal
 * Allows users to search and select line items from the library
 * Used for adding items to templates
 */

import React, { useState, useEffect } from 'react';
import {
  Modal,
  Input,
  Table,
  Space,
  Button,
  Tag,
  Select,
  message,
  Empty,
} from 'antd';
import {
  SearchOutlined,
  PlusOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import lineItemService from '../../services/lineItemService';
import { LineItemModalItem } from '../../types/lineItem';

const { Search } = Input;

interface LineItemSelectorModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (items: LineItemModalItem[]) => void;
}

const LineItemSelectorModal: React.FC<LineItemSelectorModalProps> = ({
  open,
  onClose,
  onSelect,
}) => {
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>();
  const [lineItems, setLineItems] = useState<LineItemModalItem[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [categories, setCategories] = useState<Array<{ code: string; description: string }>>([]);

  // Load categories on mount
  useEffect(() => {
    if (open) {
      loadCategories();
      loadLineItems();
    }
  }, [open]);

  const loadCategories = async () => {
    try {
      const cats = await lineItemService.getCategoriesForModal();
      setCategories(cats);
    } catch (error) {
      console.error('Failed to load categories:', error);
    }
  };

  const loadLineItems = async (search?: string, category?: string) => {
    try {
      setLoading(true);
      let items: LineItemModalItem[];

      if (search) {
        items = await lineItemService.searchLineItemsForModal(search, category);
      } else {
        items = await lineItemService.getLineItemsForModal({
          category,
          page: 1,
          page_size: 100,
        });
      }

      setLineItems(items);
    } catch (error: any) {
      message.error('Failed to load line items');
      console.error('Failed to load line items:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (value: string) => {
    setSearchTerm(value);
    loadLineItems(value, selectedCategory);
  };

  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value);
    loadLineItems(searchTerm, value);
  };

  const handleAdd = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('Please select at least one line item');
      return;
    }

    const selectedItems = lineItems.filter(item =>
      selectedRowKeys.includes(item.id)
    );

    onSelect(selectedItems);
    handleClose();
  };

  const handleClose = () => {
    setSelectedRowKeys([]);
    setSearchTerm('');
    setSelectedCategory(undefined);
    setLineItems([]);
    onClose();
  };

  const columns: ColumnsType<LineItemModalItem> = [
    {
      title: 'Code',
      dataIndex: 'component_code',
      key: 'component_code',
      width: 120,
      render: (text, record) => (
        <Space>
          <Tag color={record.type === 'XACTIMATE' ? 'blue' : 'green'}>
            {record.act}
          </Tag>
          <span>{text || record.item_code}</span>
        </Space>
      ),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: 'Unit',
      dataIndex: 'unit',
      key: 'unit',
      width: 80,
    },
    {
      title: 'Price',
      dataIndex: 'unit_price',
      key: 'unit_price',
      width: 100,
      align: 'right',
      render: (price) => `$${Number(price || 0).toFixed(2)}`,
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      width: 100,
      ellipsis: true,
    },
  ];

  return (
    <Modal
      title={
        <Space>
          <SearchOutlined />
          <span>Select Line Items</span>
        </Space>
      }
      open={open}
      onCancel={handleClose}
      width={900}
      footer={[
        <Button key="cancel" onClick={handleClose} icon={<CloseOutlined />}>
          Cancel
        </Button>,
        <Button
          key="add"
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleAdd}
          disabled={selectedRowKeys.length === 0}
        >
          Add {selectedRowKeys.length > 0 ? `(${selectedRowKeys.length})` : ''}
        </Button>,
      ]}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space style={{ width: '100%' }}>
          <Search
            placeholder="Search by code or description..."
            allowClear
            onSearch={handleSearch}
            onChange={(e) => !e.target.value && handleSearch('')}
            style={{ width: 400 }}
          />
          <Select
            placeholder="Filter by category"
            allowClear
            style={{ width: 200 }}
            value={selectedCategory}
            onChange={handleCategoryChange}
            showSearch
            optionFilterProp="children"
          >
            {categories.map(cat => (
              <Select.Option key={cat.code} value={cat.code}>
                {cat.code} - {cat.description}
              </Select.Option>
            ))}
          </Select>
        </Space>

        <Table
          columns={columns}
          dataSource={lineItems}
          rowKey="id"
          loading={loading}
          pagination={{
            pageSize: 10,
            showSizeChanger: false,
            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} items`,
          }}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
          locale={{
            emptyText: (
              <Empty
                description={
                  searchTerm || selectedCategory
                    ? 'No matching line items found'
                    : 'Search for line items to add to template'
                }
              />
            ),
          }}
          scroll={{ y: 400 }}
          size="small"
        />
      </Space>
    </Modal>
  );
};

export default LineItemSelectorModal;
