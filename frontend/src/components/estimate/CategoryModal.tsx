import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Modal,
  Select,
  Input,
  Button,
  Table,
  Row,
  Col,
  Spin,
  Empty,
  message,
  Space,
} from 'antd';
import { SearchOutlined, PushpinOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { CategoryModalItem } from '../../types/lineItem';
import { useCategories } from '../../hooks/useCategories';
import debounce from 'lodash/debounce';

const { Option } = Select;

// Line Item Categories for filtering
const LINE_ITEM_CATEGORIES = [
  { value: 'all', label: 'All Categories' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'flooring', label: 'Flooring' },
  { value: 'roofing', label: 'Roofing' },
  { value: 'drywall', label: 'Drywall' },
  { value: 'painting', label: 'Painting' },
  { value: 'insulation', label: 'Insulation' },
  { value: 'windows', label: 'Windows & Doors' },
  { value: 'exterior', label: 'Exterior' },
];

export interface CategoryModalProps {
  open: boolean;
  onCancel: () => void;
  onSelect: (category: CategoryModalItem) => void;
  selectedValue?: string;
}

// Simple in-memory cache for categories
let cachedCategories: Array<{ value: string; label: string }> | null = null;

// Get categories from API with caching
const getCategories = async () => {
  if (cachedCategories) {
    console.log('Using cached categories');
    return cachedCategories;
  }
  
  console.log('Loading categories from API (first time)');
  try {
    const response = await fetch('/api/line-items/categories');
    const data = await response.json();
    cachedCategories = data.map((cat: any) => ({ value: cat.code, label: cat.name }));
    
    return cachedCategories;
  } catch (error) {
    console.error('Failed to load categories:', error);
    return [];
  }
};

const CategoryModal: React.FC<CategoryModalProps> = ({
  open,
  onCancel,
  onSelect,
  selectedValue,
}) => {
  // Use categories with React Query caching
  const { categories: cachedCategories, loading: categoriesLoading, refresh: refreshCategories } = useCategories();
  
  // State
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPlCategory, setSelectedPlCategory] = useState('all');
  const [selectedRowKey, setSelectedRowKey] = useState<string | undefined>(selectedValue);

  // Update selected row key when prop changes
  useEffect(() => {
    setSelectedRowKey(selectedValue);
  }, [selectedValue]);

  // No need for separate loadCategories - using React Query cache directly

  // Handle search input change - no debouncing needed since it's local filtering
  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
  }, []);

  // Filter and search categories
  const filteredCategories = useMemo(() => {
    let filtered = cachedCategories;
    
    // Apply category filter
    if (selectedPlCategory !== 'all') {
      const filterKeyword = selectedPlCategory.toLowerCase();
      filtered = filtered.filter(category => 
        category.description.toLowerCase().includes(filterKeyword) ||
        category.full_description.toLowerCase().includes(filterKeyword)
      );
    }
    
    // Apply search filter
    if (searchTerm.trim()) {
      const query = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(category =>
        category.code.toLowerCase().includes(query) ||
        category.description.toLowerCase().includes(query) ||
        category.full_description.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }, [cachedCategories, selectedPlCategory, searchTerm]);

  // Handle row selection
  const handleRowClick = (record: CategoryModalItem) => {
    setSelectedRowKey(record.code);
  };

  // Handle row double click (select)
  const handleRowDoubleClick = (record: CategoryModalItem) => {
    setSelectedRowKey(record.code);
    onSelect(record);
  };

  // Handle OK button click
  const handleOk = () => {
    if (selectedRowKey) {
      const selectedCategory = filteredCategories.find(cat => cat.code === selectedRowKey);
      if (selectedCategory) {
        onSelect(selectedCategory);
      } else {
        message.warning('Please select a category');
      }
    } else {
      message.warning('Please select a category');
    }
  };

  // Handle keyboard navigation
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!filteredCategories.length) return;

    const currentIndex = filteredCategories.findIndex(cat => cat.code === selectedRowKey);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        const nextIndex = currentIndex < filteredCategories.length - 1 ? currentIndex + 1 : 0;
        setSelectedRowKey(filteredCategories[nextIndex].code);
        break;
      
      case 'ArrowUp':
        event.preventDefault();
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : filteredCategories.length - 1;
        setSelectedRowKey(filteredCategories[prevIndex].code);
        break;
      
      case 'Enter':
        event.preventDefault();
        if (selectedRowKey) {
          const selectedCategory = filteredCategories.find(cat => cat.code === selectedRowKey);
          if (selectedCategory) {
            onSelect(selectedCategory);
          }
        }
        break;
      
      case 'Escape':
        event.preventDefault();
        onCancel();
        break;
    }
  };

  // Table columns
  const columns: ColumnsType<CategoryModalItem> = [
    {
      title: 'Code',
      dataIndex: 'code',
      key: 'code',
      width: 80,
      sorter: (a, b) => a.code.localeCompare(b.code),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (text: string, record: CategoryModalItem) => (
        <div>
          <div>{text}</div>
          {record.full_description !== text && (
            <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>
              {record.full_description}
            </div>
          )}
        </div>
      ),
    },
  ];

  // Reset modal state on cancel
  const handleCancel = () => {
    setSearchTerm('');
    setSelectedPlCategory('all');
    setSelectedRowKey(undefined);
    onCancel();
  };

  return (
    <Modal
      title="Line Item Categories"
      open={open}
      onCancel={handleCancel}
      width={800}
      footer={null}
      styles={{ body: { padding: '16px' } }}
    >
      <div 
        style={{ height: '500px', display: 'flex', flexDirection: 'column' }}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        {/* Header Controls */}
        <Row gutter={[16, 16]} style={{ marginBottom: '16px' }}>
          {/* Line Item Categories Dropdown */}
          <Col span={8}>
            <Select
              value={selectedPlCategory}
              onChange={setSelectedPlCategory}
              style={{ width: '100%' }}
              placeholder="Line Item Categories"
            >
              {LINE_ITEM_CATEGORIES.map(cat => (
                <Option key={cat.value} value={cat.value}>
                  {cat.label}
                </Option>
              ))}
            </Select>
          </Col>

          {/* Search Input */}
          <Col span={16}>
            <Input
              placeholder="Search categories..."
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              prefix={<PushpinOutlined style={{ color: '#1890ff' }} />}
              suffix={<SearchOutlined />}
              allowClear
            />
          </Col>
        </Row>

        {/* Table */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Table
            columns={columns}
            dataSource={filteredCategories}
            rowKey="code"
            loading={categoriesLoading}
            pagination={false}
            scroll={{ y: 350 }}
            size="small"
            rowSelection={Array.isArray(filteredCategories) && filteredCategories.length > 0 ? {
              type: 'radio',
              selectedRowKeys: selectedRowKey ? [selectedRowKey] : [],
              onSelect: (record) => {
                setSelectedRowKey(record.code);
              },
              hideSelectAll: true,
              getCheckboxProps: (record) => ({
                disabled: false,
                name: record.code || 'category',
              }),
            } : undefined}
            onRow={(record) => ({
              onClick: () => handleRowClick(record),
              onDoubleClick: () => handleRowDoubleClick(record),
              style: {
                cursor: 'pointer',
                backgroundColor: selectedRowKey === record.code ? '#e6f7ff' : undefined,
              },
            })}
            locale={{
              emptyText: (
                <Empty
                  description={searchTerm ? 'No categories found' : 'No categories available'}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ),
            }}
          />
        </div>

        {/* Footer Buttons */}
        <Row justify="end" style={{ marginTop: '16px', borderTop: '1px solid #f0f0f0', paddingTop: '16px' }}>
          <Col>
            <Space>
              <Button onClick={handleCancel}>
                Cancel
              </Button>
              <Button type="primary" onClick={handleOk} disabled={!selectedRowKey}>
                OK
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

export default CategoryModal;