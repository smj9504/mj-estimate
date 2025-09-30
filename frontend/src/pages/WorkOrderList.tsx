import React, { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  message,
  Popconfirm,
  Typography,
  Row,
  Col,
  Tooltip,
  Select,
  Dropdown,
  MenuProps,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  SendOutlined,
  ExportOutlined,
  FileTextOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { WorkOrder, DocumentType, PaginatedResponse } from '../types';
import { workOrderService } from '../services/workOrderService';
import { companyService } from '../services/companyService';
import WorkOrderFilters from '../components/work-order/WorkOrderFilters';
import WorkOrderStats from '../components/work-order/WorkOrderStats';
import type { ColumnsType } from 'antd/es/table';
import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx';

const { Title } = Typography;
const { confirm } = Modal;

// Status configuration
const statusConfig = {
  draft: { color: 'default', label: 'Draft' },
  pending: { color: 'warning', label: 'Pending Approval' },
  approved: { color: 'blue', label: 'Approved' },
  in_progress: { color: 'processing', label: 'In Progress' },
  completed: { color: 'success', label: 'Completed' },
  cancelled: { color: 'error', label: 'Cancelled' },
} as const;

// Document type labels - removed hardcoded mapping
// Now using document_type_name from backend

interface WorkOrderListFilters {
  search?: string;
  status?: WorkOrder['status'];
  company_id?: string;
  document_type?: DocumentType;
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
}

const WorkOrderList: React.FC = () => {
  const [filters, setFilters] = useState<WorkOrderListFilters>({
    page: 1,
    page_size: 10,
  });
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Fetch work orders with optimized caching
  const {
    data: workOrdersData,
    isLoading,
    error,
  } = useQuery<PaginatedResponse<WorkOrder>>({
    queryKey: ['work-orders', filters],
    queryFn: () => workOrderService.searchWorkOrders(filters),
    placeholderData: (previousData: PaginatedResponse<WorkOrder> | undefined) => previousData,
    staleTime: 30 * 1000, // 30 seconds for list data
    gcTime: 5 * 60 * 1000, // 5 minutes in cache
  });

  // Fetch companies for company names
  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => companyService.getCompanies(),
  });

  // Delete work order mutation with optimistic update
  const deleteMutation = useMutation({
    mutationFn: workOrderService.deleteWorkOrder,
    onMutate: async (id: string) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['work-orders'] });
      
      // Snapshot the previous value
      const previousWorkOrders = queryClient.getQueryData(['work-orders', filters]);
      
      // Optimistically remove from the cache
      queryClient.setQueryData(['work-orders', filters], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.filter((item: WorkOrder) => item.id !== id),
          total: old.total - 1,
        };
      });
      
      // Return a context with the previous value
      return { previousWorkOrders };
    },
    onError: (error: any, variables, context) => {
      // Rollback on error
      if (context?.previousWorkOrders) {
        queryClient.setQueryData(['work-orders', filters], context.previousWorkOrders);
      }
      message.error(error.message || 'Failed to delete.');
    },
    onSuccess: () => {
      message.success('Work order has been deleted.');
      setSelectedRowKeys([]);
      // Invalidate in background to sync with server
      queryClient.invalidateQueries({ 
        queryKey: ['work-orders'],
        refetchType: 'active'
      });
    },
  });

  // Update status mutation with optimistic update
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: WorkOrder['status'] }) =>
      workOrderService.updateWorkOrderStatus(id, status),
    onMutate: async ({ id, status }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['work-orders'] });
      
      // Snapshot the previous value
      const previousWorkOrders = queryClient.getQueryData(['work-orders', filters]);
      
      // Optimistically update the cache
      queryClient.setQueryData(['work-orders', filters], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((item: WorkOrder) =>
            item.id === id ? { ...item, status } : item
          ),
        };
      });
      
      // Return a context with the previous value
      return { previousWorkOrders };
    },
    onError: (error: any, variables, context) => {
      // Rollback on error
      if (context?.previousWorkOrders) {
        queryClient.setQueryData(['work-orders', filters], context.previousWorkOrders);
      }
      message.error(error.message || 'Failed to update status.');
    },
    onSuccess: () => {
      message.success('Status has been updated.');
      // Invalidate in background to sync with server
      queryClient.invalidateQueries({ 
        queryKey: ['work-orders'],
        refetchType: 'active' // Only refetch if the query is currently being used
      });
    },
  });

  const workOrders = useMemo(() => workOrdersData?.items || [], [workOrdersData?.items]);
  const total = workOrdersData?.total || 0;

  // Get company name by ID
  const getCompanyName = useCallback((companyId: string) => {
    const company = companies.find(c => c.id === companyId);
    return company?.name || 'Unknown Company';
  }, [companies]);

  // Handle filter changes
  const handleFilterChange = useCallback((newFilters: Partial<WorkOrderListFilters>) => {
    setFilters(prev => ({ ...prev, ...newFilters, page: 1 }));
  }, []);

  // Handle pagination
  const handleTableChange = useCallback((pagination: any) => {
    setFilters(prev => ({
      ...prev,
      page: pagination.current,
      page_size: pagination.pageSize,
    }));
  }, []);

  // Handle actions
  const handleView = useCallback((record: WorkOrder) => {
    navigate(`/work-order/${record.id}`);
  }, [navigate]);

  const handleEdit = useCallback((record: WorkOrder) => {
    navigate(`/work-order/${record.id}/edit`);
  }, [navigate]);

  const handleDelete = useCallback((id: string) => {
    confirm({
      title: 'Are you sure you want to delete this work order?',
      content: 'This action cannot be undone.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: () => deleteMutation.mutate(id),
    });
  }, [deleteMutation]);

  const handleStatusChange = useCallback((id: string, status: WorkOrder['status']) => {
    statusMutation.mutate({ id, status });
  }, [statusMutation]);

  // Export to Excel
  const handleExport = useCallback(() => {
    if (workOrders.length === 0) {
      message.warning('No data to export.');
      return;
    }

    const exportData = workOrders.map((order: WorkOrder) => ({
      'Work Order Number': order.work_order_number,
      'Company Name': getCompanyName(order.company_id),
      'Document Type': order.document_type_name || order.document_type,
      'Client Name': order.client_name,
      'Status': statusConfig[order.status as keyof typeof statusConfig].label,
      'Final Cost': order.final_cost,
      'Created Date': new Date(order.created_at).toLocaleDateString('en-US'),
      'Created By': order.created_by_staff_name || '-',
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Work Order List');
    
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `work_order_list_${new Date().toISOString().split('T')[0]}.xlsx`);
  }, [workOrders, getCompanyName]);

  // Status dropdown items
  const getStatusDropdownItems = useCallback((record: WorkOrder): MenuProps['items'] => {
    const statusOptions: WorkOrder['status'][] = ['draft', 'pending', 'approved', 'in_progress', 'completed', 'cancelled'];
    
    return statusOptions
      .filter(status => status !== record.status)
      .map(status => ({
        key: status,
        label: statusConfig[status].label,
        onClick: () => handleStatusChange(record.id, status),
      }));
  }, [handleStatusChange]);

  // Table columns
  const columns: ColumnsType<WorkOrder> = [
    {
      title: 'Work Order Number',
      dataIndex: 'work_order_number',
      key: 'work_order_number',
      fixed: 'left',
      width: 150,
      render: (text: string, record: WorkOrder) => (
        <Button
          type="link"
          onClick={() => handleView(record)}
          style={{ padding: 0, height: 'auto' }}
        >
          {text}
        </Button>
      ),
    },
    {
      title: 'Company Name',
      dataIndex: 'company_id',
      key: 'company_id',
      width: 150,
      render: (companyId: string) => getCompanyName(companyId),
    },
    {
      title: 'Document Type',
      dataIndex: 'document_type',
      key: 'document_type',
      width: 120,
      render: (type: DocumentType, record: WorkOrder) => (
        <Tag color="blue">
          {record.document_type_name || type}
        </Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: WorkOrder['status'], record: WorkOrder) => (
        <Dropdown
          menu={{ items: getStatusDropdownItems(record) }}
          trigger={['click']}
        >
          <Tag
            color={statusConfig[status].color}
            style={{ cursor: 'pointer' }}
          >
            {statusConfig[status].label}
          </Tag>
        </Dropdown>
      ),
    },
    {
      title: 'Final Cost',
      dataIndex: 'final_cost',
      key: 'final_cost',
      width: 120,
      align: 'right',
      render: (cost: string | number) => {
        const numCost = typeof cost === 'string' ? parseFloat(cost) || 0 : cost || 0;
        return `$${numCost.toLocaleString()}`;
      },
    },
    {
      title: 'Created Date',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 120,
      render: (date: string) => new Date(date).toLocaleDateString('en-US'),
    },
    {
      title: 'Created By',
      dataIndex: 'created_by_staff_name',
      key: 'created_by_staff_name',
      width: 100,
      render: (name: string) => name || '-',
    },
    {
      title: 'Actions',
      key: 'actions',
      fixed: 'right',
      width: 120,
      render: (_, record: WorkOrder) => (
        <Space size="small">
          <Tooltip title="View">
            <Button
              type="text"
              icon={<EyeOutlined />}
              onClick={() => handleView(record)}
            />
          </Tooltip>
          <Tooltip title="Edit">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          <Tooltip title="Delete">
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(record.id)}
            />
          </Tooltip>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'send',
                  icon: <SendOutlined />,
                  label: 'Send',
                  disabled: record.status === 'draft',
                },
                {
                  key: 'duplicate',
                  icon: <FileTextOutlined />,
                  label: 'Duplicate',
                },
              ],
            }}
          >
            <Button type="text" icon={<MoreOutlined />} />
          </Dropdown>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* Header */}
      <Card style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <FileTextOutlined style={{ fontSize: 24, marginRight: 12, color: '#1890ff' }} />
            <div>
              <Title level={2} style={{ margin: 0 }}>
                Work Order List
              </Title>
              <p style={{ margin: '4px 0 0 0', color: '#666' }}>
                Manage and track all work orders.
              </p>
            </div>
          </div>
          <Space>
            <Button
              icon={<ExportOutlined />}
              onClick={handleExport}
              disabled={workOrders.length === 0}
            >
              Export to Excel
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/work-orders/new')}
            >
              New Work Order
            </Button>
          </Space>
        </div>
      </Card>

      {/* Statistics Cards */}
      <WorkOrderStats workOrders={workOrders} />

      {/* Filters */}
      <WorkOrderFilters
        filters={filters}
        onFilterChange={handleFilterChange}
        companies={companies}
      />

      {/* Table */}
      <Card style={{ marginTop: 24 }}>
        <Table
          columns={columns}
          dataSource={workOrders}
          rowKey="id"
          loading={isLoading}
          pagination={{
            current: filters.page,
            pageSize: filters.page_size,
            total,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) =>
              `${range[0]}-${range[1]} of ${total} total`,
            pageSizeOptions: ['10', '20', '50', '100'],
          }}
          onChange={handleTableChange}
          scroll={{ x: 1200 }}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
            selections: [
              Table.SELECTION_ALL,
              Table.SELECTION_INVERT,
              Table.SELECTION_NONE,
            ],
          }}
          size="small"
        />
      </Card>

      {/* Bulk Actions */}
      {selectedRowKeys.length > 0 && (
        <Card
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          }}
        >
          <Space>
            <span>{selectedRowKeys.length} selected</span>
            <Button size="small" onClick={() => setSelectedRowKeys([])}>
              Clear Selection
            </Button>
            <Button
              size="small"
              danger
              onClick={() => {
                confirm({
                  title: `Are you sure you want to delete ${selectedRowKeys.length} work orders?`,
                  content: 'This action cannot be undone.',
                  okText: 'Delete',
                  okButtonProps: { danger: true },
                  cancelText: 'Cancel',
                  onOk: async () => {
                    for (const id of selectedRowKeys) {
                      await deleteMutation.mutateAsync(id as string);
                    }
                    setSelectedRowKeys([]);
                  },
                });
              }}
            >
              Delete Selected Items
            </Button>
          </Space>
        </Card>
      )}
    </div>
  );
};

export default WorkOrderList;