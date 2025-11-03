/**
 * Line Item Management Page
 * Full-featured line item library management with search, filters, and bulk operations
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Input,
  Select,
  Space,
  Typography,
  Tag,
  message,
  Popconfirm,
  Row,
  Col,
  Switch,
  Empty,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import lineItemService from '../services/lineItemService';
import LineItemFormModal from '../components/line-items/LineItemFormModal';
import { LineItem, LineItemType } from '../types/lineItem';
import { debounce } from 'lodash';

const { Title, Text } = Typography;
const { Search } = Input;

const LineItemManagement: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>(true);

  // Modal state
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingLineItemId, setEditingLineItemId] = useState<string | undefined>(undefined);

  // Categories for filter
  const [categories, setCategories] = useState<any[]>([]);

  // Load categories
  useEffect(() => {
    loadCategories();
  }, []);

  // Load line items when filters or pagination change
  useEffect(() => {
    loadLineItems();
  }, [searchTerm, categoryFilter, typeFilter, activeFilter, currentPage, pageSize]);

  const loadCategories = async () => {
    try {
      const data = await lineItemService.getCategories();
      console.log('Loaded categories:', data);
      setCategories(data);
    } catch (error: any) {
      console.error('Failed to load categories:', error);
      message.error('Failed to load categories');
    }
  };

  const loadLineItems = async () => {
    setLoading(true);
    try {
      const params: any = {
        page: currentPage,
        page_size: pageSize,
      };

      if (searchTerm) {
        params.search_term = searchTerm; // ✅ Changed from 'search'
      }
      if (categoryFilter) {
        params.cat = categoryFilter; // ✅ Changed from 'category'
      }
      if (typeFilter) {
        params.type = typeFilter;
      }
      if (activeFilter !== undefined) {
        params.is_active = activeFilter;
      }

      console.log('Loading line items with params:', params);
      const response = await lineItemService.getLineItems(params);
      console.log('Line Items Response:', response);
      console.log('Line Items:', response.items);
      
      // Set items directly - backend now properly serializes data
      const items = response.items || [];
      
      console.log('Loaded line items:', {
        count: items.length,
        total: response.total,
        firstItem: items[0]
      });
      
      setLineItems(items);
      setTotalItems(response.total || 0);
    } catch (error: any) {
      console.error('Failed to load line items:', error);
      console.error('Error details:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      });

      let errorMessage = 'Failed to load line items';
      if (error.response?.status === 403) {
        errorMessage = 'Access denied. Please check your authentication or login again.';
      } else if (error.response?.status === 401) {
        errorMessage = 'Authentication required. Please login.';
      } else if (error.message) {
        errorMessage = `Failed to load line items: ${error.message}`;
      }

      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Debounced search
  const debouncedSearch = useCallback(
    debounce((value: string) => {
      setSearchTerm(value);
      setCurrentPage(1); // Reset to first page on search
    }, 500),
    []
  );

  const handleSearch = (value: string) => {
    debouncedSearch(value);
  };

  const handleCreateNew = () => {
    setEditingLineItemId(undefined);
    setFormModalOpen(true);
  };

  const handleEdit = (record: LineItem) => {
    setEditingLineItemId(record.id);
    setFormModalOpen(true);
  };

  const handleFormSuccess = () => {
    loadLineItems();
    setSelectedRowKeys([]);
  };

  const handleBulkDelete = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('Please select items to delete');
      return;
    }

    // Filter out null/undefined values
    const validKeys = selectedRowKeys.filter(key => key != null) as string[];
    
    if (validKeys.length === 0) {
      message.warning('No valid items selected');
      return;
    }

    console.log('Deleting line items with IDs:', validKeys);

    try {
      await lineItemService.deleteLineItems(validKeys);
      message.success(`Deleted ${validKeys.length} item(s)`);
      setSelectedRowKeys([]);
      loadLineItems();
    } catch (error: any) {
      console.error('Failed to delete line items:', error);
      message.error('Failed to delete line items');
    }
  };

  const handleTableChange = (pagination: TablePaginationConfig) => {
    setCurrentPage(pagination.current || 1);
    setPageSize(pagination.pageSize || 10);
  };

  // Table columns
  const columns: ColumnsType<LineItem> = [
    {
      title: 'Code',
      dataIndex: 'item',
      key: 'item',
      width: 120,
      render: (text: string) => <Text strong>{text}</Text>,
    },
    {
      title: 'Category',
      dataIndex: 'cat',
      key: 'cat',
      width: 120,
      ellipsis: true,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (text: string, record: LineItem) => (
        <a onClick={() => handleEdit(record)}>
          {text}
        </a>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (type: string) => {
        // Use the actual type field from database
        const isXactimate = type === 'XACTIMATE';
        return (
          <Tag color={isXactimate ? 'blue' : 'green'}>
            {isXactimate ? 'Xactimate' : 'Custom'}
          </Tag>
        );
      },
    },
    {
      title: 'Unit',
      dataIndex: 'unit',
      key: 'unit',
      width: 80,
    },
    {
      title: 'Rate',
      dataIndex: 'rate',
      key: 'rate',
      width: 120,
      render: (_: any, record: LineItem) => {
        const isXactimate = record.type === 'XACTIMATE';
        let rate = 0;

        if (isXactimate) {
          // Calculate Xactimate total with parseFloat to handle string values
          const lab = parseFloat(String(record.lab || 0));
          const mat = parseFloat(String(record.mat || 0));
          const equ = parseFloat(String(record.equ || 0));
          const laborBurden = parseFloat(String(record.labor_burden || 0));
          const marketCondition = parseFloat(String(record.market_condition || 0));

          // Only calculate if we have valid numbers
          if (!isNaN(lab) && !isNaN(mat) && !isNaN(equ)) {
            rate = (lab + mat + equ) * (1 + laborBurden / 100) * (1 + marketCondition / 100);
          }
        } else {
          rate = parseFloat(String(record.untaxed_unit_price || 0));
        }

        // Handle NaN case
        if (isNaN(rate)) {
          rate = 0;
        }

        return <Text>${rate.toFixed(2)}</Text>;
      },
    },
    {
      title: 'Active',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      align: 'center' as const,
      render: (isActive: boolean) => (
        <Tag color={isActive ? 'success' : 'default'}>
          {isActive ? 'Active' : 'Inactive'}
        </Tag>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      align: 'center' as const,
      render: (_: any, record: LineItem) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title="Delete this line item?"
            onConfirm={async () => {
              try {
                await lineItemService.deleteLineItem(record.id);
                message.success('Line item deleted');
                loadLineItems();
              } catch (error) {
                message.error('Failed to delete line item');
              }
            }}
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const rowSelection = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[]) => {
      console.log('Selected row keys changed:', newSelectedRowKeys);
      // Filter out null/undefined values immediately
      const validKeys = newSelectedRowKeys.filter(key => key != null);
      setSelectedRowKeys(validKeys);
    },
  };

  return (
    <div style={{ padding: '24px' }}>
      <Card>
        {/* Header */}
        <Row justify="space-between" align="middle" style={{ marginBottom: 24 }}>
          <Col>
            <Title level={3} style={{ margin: 0 }}>Line Item Library</Title>
          </Col>
          <Col>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreateNew}
            >
              Create New Line Item
            </Button>
          </Col>
        </Row>

        {/* Filters */}
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={12} md={8}>
            <Search
              placeholder="Search by code or description"
              allowClear
              onSearch={handleSearch}
              onChange={(e) => handleSearch(e.target.value)}
              prefix={<SearchOutlined />}
            />
          </Col>
          <Col xs={24} sm={12} md={5}>
            <Select
              style={{ width: '100%' }}
              placeholder="Select Category"
              allowClear
              value={categoryFilter}
              onChange={(value) => {
                setCategoryFilter(value);
                setCurrentPage(1);
              }}
            >
              {categories.map(cat => (
                <Select.Option key={cat.code} value={cat.code}>
                  {cat.code} - {cat.name}
                </Select.Option>
              ))}
            </Select>
          </Col>
          <Col xs={24} sm={12} md={5}>
            <Select
              style={{ width: '100%' }}
              placeholder="Select Type"
              allowClear
              value={typeFilter}
              onChange={(value) => {
                console.log('Type filter changed to:', value);
                setTypeFilter(value);
                setCurrentPage(1);
              }}
            >
              <Select.Option value="XACTIMATE">Xactimate</Select.Option>
              <Select.Option value="CUSTOM">Custom</Select.Option>
            </Select>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Space>
              <Text>Show:</Text>
              <Switch
                checked={activeFilter === true}
                onChange={(checked) => {
                  setActiveFilter(checked ? true : undefined);
                  setCurrentPage(1);
                }}
                checkedChildren="Active Only"
                unCheckedChildren="All"
              />
              <Button
                icon={<ReloadOutlined />}
                onClick={loadLineItems}
              >
                Refresh
              </Button>
            </Space>
          </Col>
        </Row>

        {/* Bulk Actions */}
        {selectedRowKeys.length > 0 && (
          <Row style={{ marginBottom: 16 }}>
            <Col>
              <Space>
                <Text strong>{selectedRowKeys.length} item(s) selected</Text>
                <Popconfirm
                  title={`Delete ${selectedRowKeys.length} item(s)?`}
                  description="This action cannot be undone."
                  onConfirm={handleBulkDelete}
                  okText="Delete"
                  cancelText="Cancel"
                  okButtonProps={{ danger: true }}
                >
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                  >
                    Delete Selected
                  </Button>
                </Popconfirm>
              </Space>
            </Col>
          </Row>
        )}

        {/* Table */}
        <Table
          rowSelection={rowSelection}
          columns={columns}
          dataSource={lineItems}
          rowKey={(record) => record.id || `invalid-${Math.random()}`}
          loading={loading}
          onChange={handleTableChange}
          pagination={{
            current: currentPage,
            pageSize: pageSize,
            total: totalItems,
            showSizeChanger: true,
            showTotal: (total) => `Total ${total} items`,
            pageSizeOptions: ['10', '25', '50', '100'],
          }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span>
                    No line items found.
                    <br />
                    <Button
                      type="link"
                      onClick={handleCreateNew}
                      style={{ padding: 0 }}
                    >
                      Create your first line item
                    </Button>
                  </span>
                }
              />
            ),
          }}
        />
      </Card>

      {/* Form Modal */}
      <LineItemFormModal
        open={formModalOpen}
        onClose={() => setFormModalOpen(false)}
        onSuccess={handleFormSuccess}
        lineItemId={editingLineItemId}
      />
    </div>
  );
};

export default LineItemManagement;
