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
  Grid,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { ColumnsType, TablePaginationConfig, SorterResult } from 'antd/es/table/interface';
import lineItemService from '../services/lineItemService';
import LineItemFormModal from '../components/line-items/LineItemFormModal';
import { LineItem } from '../types/lineItem';
import { debounce } from 'lodash';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;
const { Search } = Input;

const LineItemManagement: React.FC = () => {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
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
  
  // Sorting
  const [sortBy, setSortBy] = useState<string | undefined>(undefined);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | undefined>(undefined);

  // Modal state
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingLineItemId, setEditingLineItemId] = useState<string | undefined>(undefined);

  // Categories for filter
  const [categories, setCategories] = useState<any[]>([]);

  // Load categories
  useEffect(() => {
    loadCategories();
  }, []);

  // Load line items when filters, pagination, or sorting change
  useEffect(() => {
    loadLineItems();
  }, [searchTerm, categoryFilter, typeFilter, activeFilter, currentPage, pageSize, sortBy, sortOrder]);

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
      if (sortBy) {
        params.sort_by = sortBy;
      }
      if (sortOrder) {
        params.sort_order = sortOrder;
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
      
      // Remove deleted items from the current list immediately
      setLineItems(prevItems => prevItems.filter(item => !validKeys.includes(item.id)));
      setTotalItems(prevTotal => Math.max(0, prevTotal - validKeys.length));
      setSelectedRowKeys([]);
      
      // Check if current page will be empty after deletion
      const itemsOnCurrentPage = lineItems.length;
      const deletedCount = validKeys.length;
      
      if (itemsOnCurrentPage <= deletedCount && currentPage > 1) {
        // Move to previous page if all items on current page were deleted
        setCurrentPage(currentPage - 1);
      } else {
        // Reload to ensure consistency with server
        loadLineItems();
      }
    } catch (error: any) {
      console.error('Failed to delete line items:', error);
      message.error('Failed to delete line items');
    }
  };

  const handleTableChange = (
    pagination: TablePaginationConfig,
    filters: any,
    sorter: SorterResult<LineItem> | SorterResult<LineItem>[]
  ) => {
    setCurrentPage(pagination.current || 1);
    setPageSize(pagination.pageSize || 10);
    
    // Handle sorting
    if (sorter && !Array.isArray(sorter) && sorter.field) {
      const field = sorter.field as string;
      const order = sorter.order;
      
      // Map frontend field names to backend field names
      const fieldMap: Record<string, string> = {
        'item': 'item',
        'description': 'description',
        'cat': 'cat',
        'unit': 'unit',
        'rate': 'rate',
      };
      
      const backendField = fieldMap[field];
      if (backendField) {
        setSortBy(backendField);
        setSortOrder(order === 'ascend' ? 'asc' : order === 'descend' ? 'desc' : undefined);
      } else {
        setSortBy(undefined);
        setSortOrder(undefined);
      }
    } else {
      setSortBy(undefined);
      setSortOrder(undefined);
    }
  };

  // Table columns
  const columns: ColumnsType<LineItem> = [
    {
      title: 'Code',
      dataIndex: 'item',
      key: 'item',
      width: 120,
      sorter: true,
      sortOrder: sortBy === 'item' ? (sortOrder === 'asc' ? 'ascend' : sortOrder === 'desc' ? 'descend' : null) : null,
      render: (text: string) => <Text strong>{text}</Text>,
      responsive: ['md'] as any,
    },
    {
      title: 'Category',
      dataIndex: 'cat',
      key: 'cat',
      width: 120,
      ellipsis: true,
      responsive: ['lg'] as any,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      sorter: true,
      sortOrder: sortBy === 'description' ? (sortOrder === 'asc' ? 'ascend' : sortOrder === 'desc' ? 'descend' : null) : null,
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
      responsive: ['md'] as any,
      render: (type: string) => {
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
        const lab = parseFloat(String(record.lab || 0));
        const mat = parseFloat(String(record.mat || 0));
        const equ = parseFloat(String(record.equ || 0));
        const laborBurden = parseFloat(String(record.labor_burden || 0));
        const marketCondition = parseFloat(String(record.market_condition || 0));

        let rate = 0;
        const hasBreakdown = (lab > 0 || mat > 0 || equ > 0);

        if (hasBreakdown && !isNaN(lab) && !isNaN(mat) && !isNaN(equ)) {
          rate = (lab + mat + equ) * (1 + laborBurden / 100) * (1 + marketCondition / 100);
        } else {
          rate = parseFloat(String(record.untaxed_unit_price || 0));
        }

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
      responsive: ['md'] as any,
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

                // Calculate items remaining after deletion
                const itemsAfterDeletion = lineItems.length - 1;

                // Check if we need to go to previous page
                if (itemsAfterDeletion === 0 && currentPage > 1) {
                  // Move to previous page - this will trigger loadLineItems via useEffect
                  setCurrentPage(currentPage - 1);
                } else {
                  // Reload current page to get fresh data from server
                  loadLineItems();
                }
              } catch (error) {
                console.error('Failed to delete line item:', error);
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
    <div style={{ padding: isMobile ? '12px' : '24px' }}>
      <Card>
        {/* Header */}
        <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
          <Col>
            <Title level={isMobile ? 4 : 3} style={{ margin: 0 }}>Line Item Library</Title>
          </Col>
          <Col>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreateNew}
            >
              {isMobile ? 'New' : 'Create New Line Item'}
            </Button>
          </Col>
        </Row>

        {/* Filters */}
        <Row gutter={[16, 8]} style={{ marginBottom: 16 }}>
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
            <Space wrap>
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
          scroll={{ x: 500 }}
          pagination={{
            current: currentPage,
            pageSize: pageSize,
            total: totalItems,
            showSizeChanger: true,
            showTotal: (total) => isMobile ? `${total} items` : `Total ${total} items`,
            pageSizeOptions: ['10', '25', '50', '100'],
            simple: isMobile,
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
