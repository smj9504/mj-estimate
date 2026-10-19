import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Button,
  Modal,
  message,
  Input,
  Select,
  Dropdown,
  Grid,
  List,
  MenuProps,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  ExportOutlined,
  MoreOutlined,
  DownOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { WorkOrder, DocumentType, PaginatedResponse, Company } from '../types';
import { workOrderService } from '../services/workOrderService';
import { companyService } from '../services/companyService';
import { PageHeader } from '../components/common/ui';
import { CompanyTag } from '../components/water-mitigation/paymentBoardShared';
import {
  WorkOrderStatusPill,
  WORK_ORDER_STATUSES,
  WORK_ORDER_STATUS_TONES,
  workOrderStatusLabel,
  formatMoney,
} from '../components/work-order/workOrderUi';
import { tagTones } from '../styles/tokens';
import type { ColumnsType } from 'antd/es/table';

const { confirm } = Modal;
const { useBreakpoint } = Grid;

const DOCUMENT_TYPE_OPTIONS = [
  { value: 'estimate', label: 'Estimate' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'insurance_estimate', label: 'Insurance Estimate' },
  { value: 'plumber_report', label: 'Plumber Report' },
];

interface WorkOrderListFilters {
  search?: string;
  status?: WorkOrder['status'];
  company_id?: string;
  document_type?: DocumentType;
  page: number;
  page_size: number;
}

const formatDate = (date?: string) => (date ? dayjs(date).format('MMM D, YYYY') : '');

/** Dashboard links arrive as /work-orders?status=pending */
const statusFromQuery = (value: string | null): WorkOrder['status'] | undefined =>
  WORK_ORDER_STATUSES.find(s => s === value);

const WorkOrderList: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [searchParams] = useSearchParams();

  const [filters, setFilters] = useState<WorkOrderListFilters>(() => ({
    status: statusFromQuery(searchParams.get('status')),
    page: 1,
    page_size: 20,
  }));
  const [searchInput, setSearchInput] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // Search goes to the server once typing pauses
  useEffect(() => {
    const timer = setTimeout(() => {
      const search = searchInput.trim() || undefined;
      setFilters(prev => (prev.search === search ? prev : { ...prev, search, page: 1 }));
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const {
    data: workOrdersData,
    isLoading,
    error,
    refetch,
  } = useQuery<PaginatedResponse<WorkOrder>>({
    queryKey: ['work-orders', filters],
    queryFn: () => workOrderService.searchWorkOrders(filters),
    placeholderData: (previousData: PaginatedResponse<WorkOrder> | undefined) => previousData,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  // Counts for the status tabs, scoped to the company filter
  const { data: stats } = useQuery({
    queryKey: ['work-orders', 'stats', filters.company_id ?? 'all'],
    queryFn: () => workOrderService.getStats(filters.company_id),
    staleTime: 30 * 1000,
  });

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['companies'],
    queryFn: () => companyService.getCompanies(),
  });

  // Delete work order mutation with optimistic update
  const deleteMutation = useMutation({
    mutationFn: workOrderService.deleteWorkOrder,
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ['work-orders'] });
      const previousWorkOrders = queryClient.getQueryData(['work-orders', filters]);
      queryClient.setQueryData(['work-orders', filters], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.filter((item: WorkOrder) => item.id !== id),
          total: old.total - 1,
        };
      });
      return { previousWorkOrders };
    },
    onError: (error: any, variables, context) => {
      if (context?.previousWorkOrders) {
        queryClient.setQueryData(['work-orders', filters], context.previousWorkOrders);
      }
      message.error(error.message || 'Failed to delete.');
    },
    onSuccess: () => {
      message.success('Work order has been deleted.');
      setSelectedRowKeys([]);
      queryClient.invalidateQueries({
        queryKey: ['work-orders'],
        refetchType: 'active',
      });
    },
  });

  // Update status mutation with optimistic update
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: WorkOrder['status'] }) =>
      workOrderService.updateWorkOrderStatus(id, status),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['work-orders'] });
      const previousWorkOrders = queryClient.getQueryData(['work-orders', filters]);
      queryClient.setQueryData(['work-orders', filters], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((item: WorkOrder) =>
            item.id === id ? { ...item, status } : item
          ),
        };
      });
      return { previousWorkOrders };
    },
    onError: (error: any, variables, context) => {
      if (context?.previousWorkOrders) {
        queryClient.setQueryData(['work-orders', filters], context.previousWorkOrders);
      }
      message.error(error.message || 'Failed to update status.');
    },
    onSuccess: () => {
      message.success('Status has been updated.');
      queryClient.invalidateQueries({
        queryKey: ['work-orders'],
        refetchType: 'active',
      });
    },
  });

  const workOrders = useMemo(() => workOrdersData?.items || [], [workOrdersData?.items]);
  const total = workOrdersData?.total || 0;

  const companyById = useMemo(() => {
    const map: Record<string, Company> = {};
    companies.forEach(c => { map[c.id] = c; });
    return map;
  }, [companies]);

  const getCompany = useCallback(
    (record: WorkOrder) => record.company || companyById[record.company_id],
    [companyById],
  );

  const getCompanyName = useCallback(
    (record: WorkOrder) => getCompany(record)?.name || 'Unknown Company',
    [getCompany],
  );

  const updateFilters = useCallback((next: Partial<WorkOrderListFilters>) => {
    setFilters(prev => ({ ...prev, ...next, page: 1 }));
    setSelectedRowKeys([]);
  }, []);

  const hasActiveFilters = !!(filters.search || filters.company_id || filters.document_type);

  const resetFilters = useCallback(() => {
    setSearchInput('');
    updateFilters({ search: undefined, company_id: undefined, document_type: undefined });
  }, [updateFilters]);

  const handleTableChange = useCallback((pagination: any) => {
    setFilters(prev => ({
      ...prev,
      page: pagination.current,
      page_size: pagination.pageSize,
    }));
  }, []);

  const detailPath = (record: WorkOrder) => `/work-order/${record.id}`;

  const handleView = useCallback((record: WorkOrder) => {
    navigate(`/work-order/${record.id}`);
  }, [navigate]);

  const handleEdit = useCallback((record: WorkOrder) => {
    navigate(`/work-orders/${record.id}/edit`);
  }, [navigate]);

  const handleDelete = useCallback((record: WorkOrder) => {
    confirm({
      title: 'Are you sure you want to delete this work order?',
      content: 'This action cannot be undone.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: () => deleteMutation.mutate(record.id),
    });
  }, [deleteMutation]);

  const handleBulkDelete = useCallback(() => {
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
  }, [selectedRowKeys, deleteMutation]);

  // Export the rows on screen to Excel
  const handleExport = useCallback(async () => {
    if (workOrders.length === 0) {
      message.warning('No data to export.');
      return;
    }

    const [{ utils, write }, { saveAs }] = await Promise.all([
      import('xlsx'),
      import('file-saver'),
    ]);

    const exportData = workOrders.map((order: WorkOrder) => ({
      'Work Order Number': order.work_order_number,
      'Company Name': getCompanyName(order),
      'Document Type': order.document_type_name || order.document_type,
      'Client Name': order.client_name,
      'Status': workOrderStatusLabel(order.status),
      'Final Cost': order.final_cost,
      'Created Date': new Date(order.created_at).toLocaleDateString('en-US'),
      'Created By': order.created_by_staff_name || '-',
    }));

    const ws = utils.json_to_sheet(exportData);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, 'Work Order List');

    const excelBuffer = write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `work_order_list_${new Date().toISOString().split('T')[0]}.xlsx`);
  }, [workOrders, getCompanyName]);

  const statusMenuItems = useCallback((record: WorkOrder): MenuProps['items'] =>
    WORK_ORDER_STATUSES
      .filter(status => status !== record.status)
      .map(status => ({
        key: status,
        label: (
          <span className="wo-status-option">
            <span
              className="ui-filter-chip-dot"
              style={{ background: tagTones[WORK_ORDER_STATUS_TONES[status]].text }}
              aria-hidden="true"
            />
            {workOrderStatusLabel(status)}
          </span>
        ),
        onClick: () => statusMutation.mutate({ id: record.id, status }),
      })),
  [statusMutation]);

  const rowMenu = useCallback((record: WorkOrder, withStatus = false): MenuProps => ({
    items: [
      { key: 'view', icon: <EyeOutlined />, label: 'View', onClick: () => handleView(record) },
      { key: 'edit', icon: <EditOutlined />, label: 'Edit', onClick: () => handleEdit(record) },
      ...(withStatus
        ? [{ key: 'status', icon: <SwapOutlined />, label: 'Change status', children: statusMenuItems(record) }]
        : []),
      { type: 'divider' as const },
      { key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true, onClick: () => handleDelete(record) },
    ],
  }), [handleView, handleEdit, handleDelete, statusMenuItems]);

  // Narrow desktops keep the monogram only (its title carries the full name)
  const showCompanyName = !!screens.xl;

  const companyCell = (record: WorkOrder) => {
    const company = getCompany(record);
    if (!company) return <span className="ui-props-empty">Unknown Company</span>;
    return (
      <span className="wo-company">
        <CompanyTag company={company} />
        {showCompanyName && company.company_code && <span className="wo-company-name">{company.name}</span>}
      </span>
    );
  };

  const columns: ColumnsType<WorkOrder> = [
    {
      title: 'Work Order',
      dataIndex: 'work_order_number',
      key: 'work_order_number',
      width: 170,
      render: (text: string, record) => (
        <div>
          <a
            className="ui-ink-link"
            href={detailPath(record)}
            onClick={e => { e.preventDefault(); handleView(record); }}
          >
            {text}
          </a>
          <span className="ui-cell-meta">{record.document_type_name || record.document_type}</span>
        </div>
      ),
    },
    {
      title: 'Client',
      dataIndex: 'client_name',
      key: 'client_name',
      ellipsis: true,
      render: (name: string, record) => {
        const place = [record.client_address, record.client_city].filter(Boolean).join(', ');
        return (
          <div style={{ minWidth: 0 }}>
            <div className="wo-ellipsis">{name || <span className="ui-props-empty">Empty</span>}</div>
            {place && <span className="ui-cell-meta">{place}</span>}
          </div>
        );
      },
    },
    {
      title: 'Company',
      dataIndex: 'company_id',
      key: 'company_id',
      width: showCompanyName ? 200 : 88,
      ellipsis: !showCompanyName,
      responsive: ['md'],
      render: (_, record) => companyCell(record),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 160,
      render: (status: WorkOrder['status'], record) => (
        <Dropdown menu={{ items: statusMenuItems(record) }} trigger={['click']}>
          <button
            type="button"
            className="wo-status-trigger"
            aria-label={`Status: ${workOrderStatusLabel(status)}. Change status`}
          >
            <WorkOrderStatusPill status={status} />
            <DownOutlined className="wo-status-caret" aria-hidden="true" />
          </button>
        </Dropdown>
      ),
    },
    {
      title: 'Final Cost',
      dataIndex: 'final_cost',
      key: 'final_cost',
      width: 130,
      align: 'right',
      render: (cost: number | string) => <span className="wo-money">{formatMoney(cost)}</span>,
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 150,
      responsive: ['xl'],
      render: (date: string, record) => (
        <div>
          <span className="wo-nowrap">{formatDate(date)}</span>
          {record.created_by_staff_name && (
            <span className="ui-cell-meta">{record.created_by_staff_name}</span>
          )}
        </div>
      ),
    },
    {
      title: <span className="ui-sr-only">Actions</span>,
      key: 'actions',
      width: 48,
      align: 'center',
      render: (_, record) => (
        <Dropdown menu={rowMenu(record)} trigger={['click']}>
          <Button
            type="text"
            size="small"
            className="ui-icon-btn"
            icon={<MoreOutlined />}
            aria-label={`Actions for ${record.work_order_number}`}
          />
        </Dropdown>
      ),
    },
  ];

  // Phone row: status first, then the client, then number, company and money
  const renderMobileItem = (record: WorkOrder) => (
    <div className="ui-row" onClick={() => handleView(record)}>
      <div className="ui-row-body">
        <div className="ui-row-tags">
          <WorkOrderStatusPill status={record.status} />
        </div>
        <span className="ui-row-title">{record.client_name || record.work_order_number}</span>
        <div className="ui-row-meta">
          <span>{record.work_order_number}</span>
          {(record.document_type_name || record.document_type) && (
            <span>{record.document_type_name || record.document_type}</span>
          )}
        </div>
        <div className="ui-row-meta">
          {getCompany(record) && <CompanyTag company={getCompany(record)} />}
          <span className="wo-money">{formatMoney(record.final_cost)}</span>
          <span>{formatDate(record.created_at)}</span>
        </div>
      </div>
      <div onClick={e => e.stopPropagation()}>
        <Dropdown menu={rowMenu(record, true)} trigger={['click']}>
          <Button
            type="text"
            icon={<MoreOutlined />}
            aria-label={`Actions for ${record.work_order_number}`}
            style={{ marginRight: -8 }}
          />
        </Dropdown>
      </div>
    </div>
  );

  // Counts follow the company filter only, so hide them when other filters narrow the list
  const showCounts = !!stats && !filters.search && !filters.document_type;
  const statusCount = (key?: string) =>
    showCounts ? (key ? stats!.by_status[key] ?? 0 : stats!.total) : undefined;

  const statusText = filters.status ? workOrderStatusLabel(filters.status).toLowerCase() : '';
  const emptyText = filters.search
    ? `No work orders match "${filters.search}"`
    : filters.status
      ? `No ${statusText} work orders`
      : hasActiveFilters
        ? 'No work orders match these filters'
        : 'No work orders yet';

  return (
    <div>
      <PageHeader
        title="Work Orders"
        meta={isLoading ? undefined : (
          <span>
            {total} {total === 1 ? 'work order' : 'work orders'}
            {statusText ? ` · ${statusText}` : ''}
          </span>
        )}
        actions={
          <>
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
          </>
        }
      />

      {/* Search + company + document type */}
      <div className="ui-toolbar">
        <Input.Search
          placeholder="Search by work order number or address..."
          allowClear
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          onSearch={value => {
            setSearchInput(value);
            const search = value.trim() || undefined;
            setFilters(prev => (prev.search === search ? prev : { ...prev, search, page: 1 }));
          }}
          style={{ width: isMobile ? '100%' : 340 }}
          aria-label="Search work orders"
        />
        <Select
          placeholder="All companies"
          allowClear
          showSearch
          optionFilterProp="label"
          value={filters.company_id}
          onChange={value => updateFilters({ company_id: value || undefined })}
          options={companies.map(c => ({ value: c.id, label: c.name }))}
          style={isMobile ? { flex: '1 1 0', minWidth: 0 } : { width: 200 }}
          aria-label="Filter by company"
        />
        <Select
          placeholder="All document types"
          allowClear
          value={filters.document_type}
          onChange={value => updateFilters({ document_type: value || undefined })}
          options={DOCUMENT_TYPE_OPTIONS}
          style={isMobile ? { flex: '1 1 0', minWidth: 0 } : { width: 190 }}
          aria-label="Filter by document type"
        />
        {hasActiveFilters && (
          <Button type="text" onClick={resetFilters}>
            Reset
          </Button>
        )}
      </div>

      {/* Status filter: one quiet view tab per status, its colour kept as a dot */}
      <div className="ui-status-tabs" role="group" aria-label="Filter by status">
        <Button
          type="text"
          size="small"
          aria-pressed={!filters.status}
          className={`ui-view-tab${!filters.status ? ' is-selected' : ''}`}
          onClick={() => updateFilters({ status: undefined })}
        >
          All
          {statusCount() !== undefined && <span className="ui-tab-count">{statusCount()}</span>}
        </Button>
        {WORK_ORDER_STATUSES.map(key => (
          <Button
            key={key}
            type="text"
            size="small"
            aria-pressed={filters.status === key}
            className={`ui-view-tab${filters.status === key ? ' is-selected' : ''}`}
            onClick={() => updateFilters({ status: key })}
          >
            <span
              className="ui-filter-chip-dot"
              style={{ background: tagTones[WORK_ORDER_STATUS_TONES[key]].text }}
              aria-hidden="true"
            />
            {workOrderStatusLabel(key)}
            {statusCount(key) !== undefined && <span className="ui-tab-count">{statusCount(key)}</span>}
          </Button>
        ))}
      </div>

      {error && !workOrdersData ? (
        <div className="wo-error" role="alert">
          <span>Couldn't load work orders.</span>
          <Button size="small" onClick={() => refetch()}>Try again</Button>
        </div>
      ) : isMobile ? (
        <List
          className="ui-row-list"
          dataSource={workOrders}
          loading={isLoading}
          renderItem={renderMobileItem}
          locale={{ emptyText }}
          pagination={total > filters.page_size ? {
            current: filters.page,
            pageSize: filters.page_size,
            total,
            size: 'small',
            align: 'center',
            onChange: (page, pageSize) => handleTableChange({ current: page, pageSize }),
          } : false}
        />
      ) : (
        <Table
          columns={columns}
          dataSource={workOrders}
          rowKey="id"
          loading={isLoading}
          size="middle"
          scroll={{ x: 780 }}
          locale={{ emptyText }}
          onChange={handleTableChange}
          onRow={(record) => ({
            onClick: (e) => {
              const target = e.target as HTMLElement;
              // Clicks inside a dropdown menu bubble here through the portal
              if (!(e.currentTarget as HTMLElement).contains(target)) return;
              if (target.closest('a, button, .ant-btn, .ant-checkbox-wrapper, .ant-table-selection-column')) return;
              handleView(record);
            },
            style: { cursor: 'pointer' },
          })}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
            selections: [
              Table.SELECTION_ALL,
              Table.SELECTION_INVERT,
              Table.SELECTION_NONE,
            ],
          }}
          pagination={{
            current: filters.page,
            pageSize: filters.page_size,
            total,
            showSizeChanger: true,
            showQuickJumper: total > filters.page_size * 5,
            showTotal: (t, range) => `${range[0]}-${range[1]} of ${t} total`,
            pageSizeOptions: ['10', '20', '50', '100'],
            hideOnSinglePage: total <= 10,
          }}
        />
      )}

      {/* Bulk actions float over the list while rows are checked */}
      {!isMobile && selectedRowKeys.length > 0 && (
        <div className="wo-bulk-bar" role="region" aria-label="Bulk actions">
          <span className="wo-bulk-count">{selectedRowKeys.length} selected</span>
          <span className="wo-bulk-divider" aria-hidden="true" />
          <Button type="text" onClick={() => setSelectedRowKeys([])}>
            Clear Selection
          </Button>
          <Button
            type="text"
            icon={<DeleteOutlined />}
            className="ui-icon-btn ui-icon-btn--danger"
            onClick={handleBulkDelete}
          >
            Delete Selected Items
          </Button>
        </div>
      )}
    </div>
  );
};

export default WorkOrderList;
