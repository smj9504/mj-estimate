import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  Table, List, Button, Modal, Form, Input, InputNumber,
  Select, message, Row, Col, DatePicker, Skeleton, Tooltip, Checkbox,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, TeamOutlined, CheckOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { rebuildService } from '../services/rebuildService';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import RebuildProjectDetailModal from '../components/rebuild/RebuildProjectDetailModal';
import {
  REBUILD_STATUSES, REBUILD_STATUS_TONES, RebuildStatusPill, rebuildStatusLabel, formatCurrency,
} from '../components/rebuild/rebuildUi';
import AddressAutocomplete from '../components/common/AddressAutocomplete';
import ClaimSearchSelect from '../components/common/ClaimSearchSelect';
import { PageHeader, Pill, useSheetModal } from '../components/common/ui';
import { tagTones } from '../styles/tokens';
import type {
  RebuildProject, RebuildProjectCreate, RebuildContractor,
} from '../types/rebuild';
import type { ColumnsType } from 'antd/es/table';
import '../components/rebuild/rebuild.css';

const { TextArea } = Input;

const docsSentCount = (r: RebuildProject) => [r.coc_sent, r.invoice_sent, r.photos_sent].filter(Boolean).length;

/** Completion documents sent out of three; green only once all three are out */
const DocsSent: React.FC<{ sent: number; prefix?: string }> = ({ sent, prefix }) =>
  sent === 3 ? (
    <Pill tone="green" icon={<CheckOutlined />}>{prefix}3/3</Pill>
  ) : (
    <span className="rb-num">{prefix}{sent}/3</span>
  );

const wholeDollars = (v?: number | null) => `$${Math.round(v || 0).toLocaleString('en-US')}`;

const RebuildProjectList: React.FC = () => {
  const queryClient = useQueryClient();
  const { isPhone, sheetProps } = useSheetModal();
  // Phones get thumb-sized controls at 16px, which also keeps iOS from zooming on focus
  const formSize = isPhone ? 'large' : 'small';
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  // Our builds by default; the customer's own builds only when asked for
  const [customerView, setCustomerView] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [contractorModalOpen, setContractorModalOpen] = useState(false);
  const [detailProjectId, setDetailProjectId] = useState<string | null>(null);
  const [editProject, setEditProject] = useState<RebuildProject | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [contractorForm] = Form.useForm();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['rebuild-stats'],
    queryFn: () => rebuildService.getStats(),
  });
  // Server pages and searches; the last page stays on screen while the next loads
  const { data: projectPage, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['rebuild-projects', customerView, statusFilter, debouncedSearch, page, pageSize],
    queryFn: () => rebuildService.listProjects({
      status: statusFilter,
      search: debouncedSearch || undefined,
      customer_managed: customerView || undefined,
      page,
      page_size: pageSize,
    }),
    placeholderData: keepPreviousData,
  });
  const projects = projectPage?.items ?? [];
  const total = projectPage?.total ?? 0;

  // A new filter or search starts again from page 1
  const pickStatus = (key?: string) => { setStatusFilter(key); setCustomerView(false); setPage(1); };
  const pickCustomerView = () => { setCustomerView(true); setStatusFilter(undefined); setPage(1); };
  const changeSearch = (value: string) => { setSearch(value); setPage(1); };
  // Deleting the last row of the last page steps back to the page before it
  useEffect(() => {
    if (!projectPage) return;
    const lastPage = Math.max(1, Math.ceil(projectPage.total / pageSize));
    if (page > lastPage) setPage(lastPage);
  }, [projectPage, page, pageSize]);
  const { data: contractors = [] } = useQuery({
    queryKey: ['rebuild-contractors'],
    queryFn: () => rebuildService.listContractors(),
  });

  // ?project=<id> 로 진입하면 해당 프로젝트 상세를 자동으로 연다 (다른 화면에서 행 클릭 시)
  const [searchParams, setSearchParams] = useSearchParams();
  const openedProjectParam = useRef<string | null>(null);
  const projectParam = searchParams.get('project');
  useEffect(() => {
    if (!projectParam || openedProjectParam.current === projectParam) return;
    openedProjectParam.current = projectParam;
    setDetailProjectId(projectParam);
    searchParams.delete('project');
    setSearchParams(searchParams, { replace: true });
  }, [projectParam, searchParams, setSearchParams]);

  const createProjectMutation = useMutation({
    mutationFn: (data: RebuildProjectCreate) => rebuildService.createProject(data),
    onSuccess: () => {
      message.success('Project created');
      setCreateModalOpen(false);
      createForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['rebuild-projects'] });
      queryClient.invalidateQueries({ queryKey: ['rebuild-stats'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Failed'),
  });

  const updateProjectMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<RebuildProject> }) =>
      rebuildService.updateProject(id, data),
    onSuccess: (_, { id }) => {
      message.success('Updated');
      queryClient.invalidateQueries({ queryKey: ['rebuild-projects'] });
      queryClient.invalidateQueries({ queryKey: ['rebuild-stats'] });
      queryClient.invalidateQueries({ queryKey: ['rebuild-project', id] });
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Could not update the project'),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: (id: string) => rebuildService.deleteProject(id),
    onSuccess: () => {
      message.success('Deleted');
      queryClient.invalidateQueries({ queryKey: ['rebuild-projects'] });
      queryClient.invalidateQueries({ queryKey: ['rebuild-stats'] });
    },
  });

  const createContractorMutation = useMutation({
    mutationFn: (data: Partial<RebuildContractor>) => rebuildService.createContractor(data),
    onSuccess: () => {
      message.success('Contractor added');
      setContractorModalOpen(false);
      contractorForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['rebuild-contractors'] });
    },
  });

  const columns: ColumnsType<RebuildProject> = [
    {
      title: 'Property', key: 'property', ellipsis: true,
      render: (_, r) => <span className="rb-list-address">{r.property_address || r.title}</span>,
    },
    {
      title: 'Client', key: 'client', width: 180, ellipsis: true,
      render: (_, r) => r.client_name || '-',
    },
    {
      title: 'Claim', key: 'claim', width: 160,
      render: (_, r) => <span className="rb-list-claim">{r.claim_number || '-'}</span>,
    },
    {
      title: 'Contractor', key: 'contractor', width: 170, ellipsis: true,
      render: (_, r) => r.contractor_name || <span className="ui-props-empty">Unassigned</span>,
    },
    {
      title: 'Status', dataIndex: 'status', width: 130,
      render: (s: string) => <RebuildStatusPill status={s} />,
    },
    {
      title: 'Contract $', dataIndex: 'contract_amount', width: 120, align: 'right',
      render: (v: number) => <span className="rb-num">{formatCurrency(v)}</span>,
    },
    {
      title: 'Docs', key: 'docs', width: 80, align: 'center',
      render: (_, r) => <DocsSent sent={docsSentCount(r)} />,
    },
  ];

  // Phone row: status first, then the address, then client, claim, contractor and money
  const renderMobileItem = (r: RebuildProject) => (
    <div
      className="ui-row"
      role="button"
      tabIndex={0}
      onClick={() => setDetailProjectId(r.id)}
      onKeyDown={e => { if (e.key === 'Enter') setDetailProjectId(r.id); }}
    >
      <div className="ui-row-body">
        <div className="ui-row-tags">
          <RebuildStatusPill status={r.status} />
        </div>
        <span className="ui-row-title">{r.property_address || r.title}</span>
        <div className="ui-row-meta">
          {r.client_name && <span>{r.client_name}</span>}
          {r.claim_number && <span>{r.claim_number}</span>}
          <span>{r.contractor_name || 'Unassigned'}</span>
        </div>
        <div className="ui-row-meta">
          <span className="rb-num rb-list-money">{formatCurrency(r.contract_amount)}</span>
          <DocsSent sent={docsSentCount(r)} prefix="Docs " />
        </div>
      </div>
    </div>
  );

  const figures = [
    { label: 'In progress', value: String(stats?.in_progress ?? 0) },
    { label: 'Completed', value: String(stats?.completed ?? 0) },
    { label: 'Total $', value: wholeDollars(stats?.total_contract_amount) },
    { label: 'Contractors', value: String(stats?.total_contractors ?? 0) },
  ];

  const statusText = customerView
    ? "customer's contractor"
    : statusFilter ? rebuildStatusLabel(statusFilter).toLowerCase() : '';
  const emptyText = debouncedSearch
    ? `No ${statusFilter ? `${statusText} ` : ''}projects match "${debouncedSearch}"`
    : customerView ? 'No projects where the customer hires their own contractor'
      : statusFilter ? `No ${statusText} projects` : 'No rebuild projects yet';

  // Builds the customer arranges themselves: off the other tabs, here on their own
  const customerTab = (
    <>
      <span className="rb-tabs-divider" aria-hidden="true" />
      <Tooltip title="The customer hires their own contractor and we don't build it">
        <Button
          type="text"
          size="small"
          aria-pressed={customerView}
          className={`ui-view-tab rb-customer-tab${customerView ? ' is-selected' : ''}`}
          onClick={pickCustomerView}
        >
          Customer's contractor
          {!!stats?.customer_managed && <span className="ui-tab-count">{stats.customer_managed}</span>}
        </Button>
      </Tooltip>
    </>
  );

  const pagination = {
    current: page,
    pageSize,
    total,
    onChange: (p: number, ps: number) => {
      // A new page size starts from page 1
      if (ps !== pageSize) { setPageSize(ps); setPage(1); } else setPage(p);
    },
  };

  return (
    <div>
      <PageHeader
        title="Rebuild Projects"
        meta={isLoading ? undefined : (
          <span>
            {total} {total === 1 ? 'project' : 'projects'}
            {statusText ? ` · ${statusText}` : ''}
            {debouncedSearch ? ` · matching "${debouncedSearch}"` : ''}
          </span>
        )}
        actions={
          <>
            <Button icon={<TeamOutlined />} onClick={() => setContractorModalOpen(true)}>Add Contractor</Button>
            <Tooltip title="Refresh">
              <Button icon={<ReloadOutlined spin={isFetching && !isLoading} />} onClick={() => refetch()} aria-label="Refresh" />
            </Tooltip>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>New Project</Button>
          </>
        }
      />

      {/* Totals across all our builds, whatever the filter; the customer's own builds never count */}
      <dl className="rb-figures">
        {figures.map(f => (
          <div className="rb-figure" key={f.label}>
            <dt>{f.label}</dt>
            <dd>
              {statsLoading
                ? <Skeleton.Button active size="small" className="rb-figure-skel" />
                : f.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* Status filter: one quiet view tab per status, its colour kept as a dot; search shares the row */}
      <div className="ui-toolbar rb-toolbar">
        <div className="ui-status-tabs rb-status-tabs" role="group" aria-label="Filter by status">
          <Button
            type="text"
            size="small"
            aria-pressed={!customerView && !statusFilter}
            className={`ui-view-tab${!customerView && !statusFilter ? ' is-selected' : ''}`}
            onClick={() => pickStatus(undefined)}
          >
            All
          </Button>
          {REBUILD_STATUSES.map(key => (
            <Button
              key={key}
              type="text"
              size="small"
              aria-pressed={!customerView && statusFilter === key}
              className={`ui-view-tab${!customerView && statusFilter === key ? ' is-selected' : ''}`}
              onClick={() => pickStatus(key)}
            >
              <span
                className="ui-filter-chip-dot"
                style={{ background: tagTones[REBUILD_STATUS_TONES[key]].text }}
                aria-hidden="true"
              />
              {rebuildStatusLabel(key)}
            </Button>
          ))}
          {/* Phones: the tab row scrolls, so it ends the row */}
          {isPhone && customerTab}
        </div>
        {/* Desktop: kept out of the scrolling tabs so it never slides out of sight */}
        {!isPhone && customerTab}
        <div className="ui-toolbar-end" style={isPhone ? { width: '100%' } : undefined}>
          <Input.Search
            placeholder="Search address, client, claim #..."
            allowClear
            value={search}
            onChange={e => changeSearch(e.target.value)}
            size={isPhone ? 'large' : undefined}
            style={{ width: isPhone ? '100%' : 260 }}
            aria-label="Search rebuild projects"
          />
        </div>
      </div>

      {isPhone ? (
        <List
          className="ui-row-list"
          dataSource={projects}
          loading={isLoading}
          renderItem={renderMobileItem}
          locale={{ emptyText }}
          pagination={total > pageSize
            ? { ...pagination, size: 'small', align: 'center', showSizeChanger: false }
            : false}
        />
      ) : (
        <Table dataSource={projects} columns={columns} rowKey="id" loading={isLoading}
          size="middle" scroll={{ x: 980 }}
          locale={{ emptyText }}
          pagination={{
            ...pagination,
            hideOnSinglePage: true,
            showSizeChanger: true,
            pageSizeOptions: [20, 50, 100],
            showTotal: t => `${t} projects`,
          }}
          onRow={(record) => ({
            onClick: () => setDetailProjectId(record.id),
            style: { cursor: 'pointer' },
          })} />
      )}

      {/* Create Project Modal */}
      <Modal title="Create Rebuild Project" open={createModalOpen} width={550} {...sheetProps}
        okText="Create project"
        onOk={() => createForm.validateFields().then(v => {
          createProjectMutation.mutate({
            ...v,
            start_date: v.start_date?.toISOString(),
            estimated_completion: v.estimated_completion?.toISOString(),
          });
        })}
        onCancel={() => { setCreateModalOpen(false); createForm.resetFields(); }}
        confirmLoading={createProjectMutation.isPending}>
        <Form form={createForm} layout="vertical" size={formSize}>
          <Form.Item name="claim_id" label="Claim" rules={[{ required: true, message: 'Please select a claim' }]}>
            <ClaimSearchSelect />
          </Form.Item>
          <Form.Item name="title" label="Project Title" rules={[{ required: true }]}>
            <Input placeholder="e.g., 123 Main St - Full Rebuild" />
          </Form.Item>
          <Form.Item name="contractor_id" label="Contractor">
            <Select allowClear placeholder="Assign contractor"
              options={contractors.map(c => ({ value: c.id, label: c.company_name }))} />
          </Form.Item>
          <Form.Item name="scope_of_work" label="Scope of Work">
            <TextArea rows={3} placeholder="Describe the work to be done" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="insurance_estimate_amount" label="Insurance Est. $">
                <InputNumber min={0} step={0.01} prefix="$" inputMode="decimal" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="contract_amount" label="Contract $">
                <InputNumber min={0} step={0.01} prefix="$" inputMode="decimal" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="start_date" label="Start Date">
                <DatePicker inputReadOnly={isPhone} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="estimated_completion" label="Est. Completion">
                <DatePicker inputReadOnly={isPhone} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* Add Contractor Modal */}
      <Modal title="Add Contractor" open={contractorModalOpen} width={450} {...sheetProps}
        okText="Add contractor"
        onOk={() => contractorForm.validateFields().then(v => createContractorMutation.mutate(v))}
        onCancel={() => { setContractorModalOpen(false); contractorForm.resetFields(); }}
        confirmLoading={createContractorMutation.isPending}>
        <Form form={contractorForm} layout="vertical" size={formSize}>
          <Form.Item name="company_name" label="Company Name" rules={[{ required: true }]}>
            <Input autoComplete="organization" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="contact_name" label="Contact Name"><Input autoComplete="name" /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="phone" label="Phone"><Input type="tel" inputMode="tel" autoComplete="tel" /></Form.Item>
            </Col>
          </Row>
          <Form.Item name="email" label="Email"><Input type="email" inputMode="email" autoComplete="email" /></Form.Item>
          <Form.Item name="specialty" label="Specialty">
            <Select options={['general','plumbing','electrical','flooring','painting','roofing','hvac','other']
              .map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Project Detail Modal */}
      <RebuildProjectDetailModal
        projectId={detailProjectId}
        open={!!detailProjectId}
        onClose={() => setDetailProjectId(null)}
        onChanged={() => {
          queryClient.invalidateQueries({ queryKey: ['rebuild-projects'] });
          queryClient.invalidateQueries({ queryKey: ['rebuild-stats'] });
        }}
        onEdit={(p) => {
          editForm.setFieldsValue({
            title: p.title,
            description: p.description,
            scope_of_work: p.scope_of_work,
            property_address: p.property_address,
            status: p.status,
            priority: p.priority,
            contractor_id: p.contractor_id,
            insurance_estimate_amount: p.insurance_estimate_amount,
            contract_amount: p.contract_amount,
            final_invoice_amount: p.final_invoice_amount,
            start_date: p.start_date ? dayjs(p.start_date) : undefined,
            estimated_completion: p.estimated_completion ? dayjs(p.estimated_completion) : undefined,
            notes: p.notes,
            customer_managed: !!p.customer_managed,
          });
          setEditProject(p);
        }}
      />

      {/* Edit Project Modal */}
      <Modal title="Edit Project" open={!!editProject} width={600} {...sheetProps}
        okText="Save"
        onOk={() => editForm.validateFields().then(values => {
          if (editProject) {
            const payload = {
              ...values,
              start_date: values.start_date?.toISOString() || null,
              estimated_completion: values.estimated_completion?.toISOString() || null,
            };
            updateProjectMutation.mutate({ id: editProject.id, data: payload });
            setEditProject(null);
          }
        })}
        onCancel={() => { setEditProject(null); editForm.resetFields(); }}
        confirmLoading={updateProjectMutation.isPending}>
        <Form form={editForm} layout="vertical" size={formSize}>
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="status" label="Status">
                <Select options={REBUILD_STATUSES.map(s => ({ value: s, label: rebuildStatusLabel(s) }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="priority" label="Priority">
                <Select options={[
                  { value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' },
                  { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="contractor_id" label="Contractor">
            <Select allowClear placeholder="Select contractor"
              options={contractors.map((c: RebuildContractor) => ({ value: c.id, label: c.company_name }))} />
          </Form.Item>
          {/* Moves the project off the list into the "Customer's own contractor" tab */}
          <Form.Item name="customer_managed" valuePropName="checked"
            extra="We don't build it. It moves off the main list and out of the totals, into the Customer's contractor tab.">
            <Checkbox>Customer hires their own contractor</Checkbox>
          </Form.Item>
          <Form.Item name="property_address" label="Property Address">
            <AddressAutocomplete fillFullAddress />
          </Form.Item>
          {/* Three amounts share a row on desktop; phones take two per row */}
          <Row gutter={12}>
            <Col xs={12} sm={8}>
              <Form.Item name="insurance_estimate_amount" label="Insurance $">
                <InputNumber min={0} step={0.01} prefix="$" inputMode="decimal" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8}>
              <Form.Item name="contract_amount" label="Contract $">
                <InputNumber min={0} step={0.01} prefix="$" inputMode="decimal" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8}>
              <Form.Item name="final_invoice_amount" label="Final Invoice $">
                <InputNumber min={0} step={0.01} prefix="$" inputMode="decimal" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="start_date" label="Start Date">
                <DatePicker inputReadOnly={isPhone} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="estimated_completion" label="Est. Completion">
                <DatePicker inputReadOnly={isPhone} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="scope_of_work" label="Scope of Work">
            <TextArea rows={3} />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <TextArea rows={2} />
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

    </div>
  );
};

export default RebuildProjectList;
