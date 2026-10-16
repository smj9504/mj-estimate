/**
 * Water Mitigation Job List Page
 * Displays all water mitigation jobs with filtering and actions
 * Responsive: mobile card layout, desktop table layout
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  Button,
  Input,
  Select,
  Space,
  message,
  Dropdown,
  Grid,
  List,
  Typography,
  Switch,
  InputNumber,
  Tooltip,
  Statistic,
  Row,
  Col
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  MoreOutlined,
  PoweroffOutlined
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import waterMitigationService from '../services/waterMitigationService';
import type {
  WaterMitigationJob,
  JobFilters,
  JobStatus,
  JobUpdate,
  CheckRecipient
} from '../types/waterMitigation';
import { JOB_STATUS_OPTIONS } from '../types/waterMitigation';
import { PageHeader, Pill } from '../components/common/ui';
import { WMStatusPill } from '../components/water-mitigation/wmStatus';
import JobFormModal from '../components/water-mitigation/JobFormModal';
import GoogleSheetsSyncButton from '../components/water-mitigation/GoogleSheetsSyncButton';
import SheetPAMappingButton from '../components/water-mitigation/SheetPAMappingButton';
import WMPaymentLinkButton from '../components/water-mitigation/WMPaymentLinkButton';
import {
  CHECK_RECIPIENT_OPTIONS,
  CheckRecipientTag,
  CompanyTag,
  EditableNote,
  RECEIVED_ROW_BG,
  ReceivedTag,
  effectiveApproved,
  formatMoney,
  outstandingAmount
} from '../components/water-mitigation/paymentBoardShared';

const { Search } = Input;
const { Option } = Select;
const { Text } = Typography;
const { useBreakpoint } = Grid;

const WaterMitigationList: React.FC = () => {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<WaterMitigationJob[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<JobFilters>({
    page: 1,
    page_size: 20,
    active: true,
    status: undefined,
    search: ''
  });
  const [formVisible, setFormVisible] = useState(false);
  const [editingJob, setEditingJob] = useState<WaterMitigationJob | undefined>(undefined);

  // Payment view: swaps the column set for amounts / received tracking
  const [paymentView, setPaymentView] = useState(false);
  // Invoice / Approved columns can be hidden (e.g. when showing the screen to someone)
  const [showAmounts, setShowAmounts] = useState(true);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  // Uncommitted InputNumber edits, keyed `${jobId}:${field}`; committed on blur/enter
  const [drafts, setDrafts] = useState<Record<string, number | null>>({});

  // Load jobs
  const loadJobs = async () => {
    try {
      setLoading(true);
      const response = await waterMitigationService.getJobs(filters);
      setJobs(response.items);
      setTotal(response.total);
    } catch (error) {
      message.error('Failed to load jobs');
      console.error('Load jobs error:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
  }, [filters]);

  const handleSearch = (value: string) => {
    setFilters(prev => ({ ...prev, search: value, page: 1 }));
  };

  const handleStatusChange = (values: JobStatus[]) => {
    setFilters(prev => ({ ...prev, status: values.length > 0 ? values : undefined, page: 1 }));
  };

  const handleActiveChange = (value: string) => {
    const activeValue = value === 'all' ? undefined : value === 'active';
    setFilters(prev => ({ ...prev, active: activeValue, page: 1 }));
  };

  const handleToggleActive = async (jobId: string, currentActive: boolean) => {
    try {
      await waterMitigationService.toggleJobActive(jobId, !currentActive);
      message.success('Job status updated');
      loadJobs();
    } catch (error) {
      message.error('Failed to update job status');
      console.error('Toggle active error:', error);
    }
  };

  const handleDelete = async (jobId: string) => {
    try {
      await waterMitigationService.deleteJob(jobId);
      message.success('Job deleted successfully');
      loadJobs();
    } catch (error) {
      message.error('Failed to delete job');
      console.error('Delete error:', error);
    }
  };

  const handleOpenCreateModal = () => {
    setEditingJob(undefined);
    setFormVisible(true);
  };

  const handleOpenEditModal = (job: WaterMitigationJob) => {
    setEditingJob(job);
    setFormVisible(true);
  };

  const handleFormSuccess = () => {
    setFormVisible(false);
    setEditingJob(undefined);
    loadJobs();
  };

  const handlePaymentViewChange = (checked: boolean) => {
    setPaymentView(checked);
    // with_insurance pulls each job's insurance estimate for the Approved column
    setFilters(prev => ({
      ...prev,
      with_insurance: checked || undefined,
      hide_received: checked ? prev.hide_received : undefined,
      page: 1
    }));
  };

  // Inline save for the payment view. Optimistic, rolled back on failure.
  const handleInlineUpdate = async (jobId: string, patch: JobUpdate) => {
    const previous = jobs.find(j => j.id === jobId);
    if (!previous) return;
    setJobs(prev => prev.map(j => (j.id === jobId ? { ...j, ...patch } as WaterMitigationJob : j)));
    setSavingIds(prev => new Set(prev).add(jobId));
    try {
      const updated = await waterMitigationService.updateJob(jobId, patch);
      setJobs(prev => prev.map(j => (
        j.id === jobId ? { ...j, ...updated, photo_count: j.photo_count } : j
      )));
      // A job just marked received drops out of the list when hide_received is on
      if (patch.payment_received !== undefined && filters.hide_received) {
        loadJobs();
      }
    } catch (error) {
      setJobs(prev => prev.map(j => (j.id === jobId ? previous : j)));
      message.error('Failed to save payment info');
      console.error('Inline payment update error:', error);
    } finally {
      setSavingIds(prev => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  };

  // Approved is the final amount; it defaults to the claim's insurance estimate until typed
  const renderApprovedCell = () =>
    (_: unknown, record: WaterMitigationJob) => {
      const field = 'approved_amount' as const;
      const key = `${record.id}:${field}`;
      const isAuto = record.approved_amount == null && record.approved_amount_auto != null;
      const stored = effectiveApproved(record);
      const value = key in drafts ? drafts[key] : stored;
      const commit = () => {
        if (!(key in drafts)) return;
        const next = drafts[key];
        setDrafts(prev => {
          const rest = { ...prev };
          delete rest[key];
          return rest;
        });
        if ((next ?? null) !== (record[field] ?? null)) {
          handleInlineUpdate(record.id, { [field]: next } as JobUpdate);
        }
      };
      const input = (
        <InputNumber
          size="small"
          prefix="$"
          precision={2}
          min={0}
          placeholder="—"
          style={{ width: '100%', ...(isAuto && !(key in drafts) ? { color: '#73726e' } : {}) }}
          value={value ?? undefined}
          onChange={(v) => setDrafts(prev => ({ ...prev, [key]: v }))}
          onBlur={commit}
          onPressEnter={commit}
        />
      );
      return isAuto ? (
        <Tooltip title="From the insurance estimate on the job detail. Type to override.">
          {input}
        </Tooltip>
      ) : input;
    };

  const rowMenu = (job: WaterMitigationJob) => ({
    items: [
      {
        key: 'edit',
        icon: <EditOutlined />,
        label: 'Edit',
        onClick: () => handleOpenEditModal(job)
      },
      {
        key: 'toggle-active',
        icon: <PoweroffOutlined />,
        label: job.active ? 'Deactivate' : 'Activate',
        onClick: () => handleToggleActive(job.id, job.active)
      },
      {
        key: 'delete',
        icon: <DeleteOutlined />,
        label: 'Delete',
        danger: true,
        onClick: () => {
          const confirmed = window.confirm('Delete this job?');
          if (confirmed) handleDelete(job.id);
        }
      }
    ]
  });

  // Table columns (desktop)
  const columns: ColumnsType<WaterMitigationJob> = [
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 150,
      render: (status: JobStatus) => <WMStatusPill status={status} />
    },
    {
      title: 'Property Address',
      dataIndex: 'property_address',
      key: 'property_address',
      ellipsis: true,
      render: (address: string, record) => (
        <a className="ui-ink-link" onClick={() => navigate(`/water-mitigation/${record.id}`)}>
          {address}
        </a>
      )
    },
    {
      title: 'Company',
      dataIndex: 'company',
      key: 'company',
      width: 120,
      ellipsis: true,
      render: (company: { id: string; name: string; company_code?: string } | undefined) =>
        <CompanyTag company={company} />
    },
    {
      title: 'Homeowner',
      dataIndex: 'homeowner_name',
      key: 'homeowner_name',
      width: 150,
      ellipsis: true
    },
    {
      title: 'Insurance Company',
      dataIndex: 'insurance_company',
      key: 'insurance_company',
      width: 150,
      ellipsis: true
    },
    {
      title: 'PA',
      dataIndex: 'google_sheet_name',
      key: 'google_sheet_name',
      width: 90,
      render: (name: string) => name ? <Pill tone="purple">{name}</Pill> : null,
    },
    {
      title: 'Claim #',
      dataIndex: 'claim_number',
      key: 'claim_number',
      width: 120
    },
    {
      title: 'Photos',
      dataIndex: 'photo_count',
      key: 'photo_count',
      width: 80,
      align: 'right',
      render: (count: number) => <Text type="secondary">{count || 0}</Text>
    },
    {
      title: <span className="ui-sr-only">Actions</span>,
      key: 'actions',
      width: 56,
      fixed: 'right',
      render: (_, record) => (
        <Dropdown menu={rowMenu(record)} trigger={['click']}>
          <Button type="text" icon={<MoreOutlined />} aria-label="Job actions" />
        </Dropdown>
      )
    }
  ];

  // Payment view columns (desktop). invoice_amount is read-only here: the
  // scope invoice sync writes it, so a typed value would be overwritten.
  const paymentColumns: ColumnsType<WaterMitigationJob> = [
    {
      title: 'Property Address',
      dataIndex: 'property_address',
      key: 'property_address',
      ellipsis: true,
      render: (address: string, record) => (
        <div>
          <a className="ui-ink-link" onClick={() => navigate(`/water-mitigation/${record.id}`)}>
            {address}
          </a>
          {record.homeowner_name && (
            <div><Text type="secondary" style={{ fontSize: 12 }}>{record.homeowner_name}</Text></div>
          )}
        </div>
      )
    },
    ...(showAmounts ? [
      {
        title: (
          <Tooltip title="From the generated invoice — edit on the job detail page">
            <span>Our Invoice</span>
          </Tooltip>
        ),
        dataIndex: 'invoice_amount',
        key: 'invoice_amount',
        width: 130,
        align: 'right' as const,
        render: (v?: number | null) => formatMoney(v)
      },
      {
        title: 'Approved (Final)',
        key: 'approved_amount',
        width: 160,
        render: renderApprovedCell()
      },
    ] : []),
    {
      title: 'Check To',
      dataIndex: 'check_recipient',
      key: 'check_recipient',
      width: 160,
      render: (value: CheckRecipient | null | undefined, record) => (
        <Select
          size="small"
          allowClear
          placeholder="—"
          value={value ?? undefined}
          style={{ width: '100%' }}
          options={CHECK_RECIPIENT_OPTIONS}
          onChange={(v) => handleInlineUpdate(record.id, { check_recipient: v ?? null })}
          labelRender={({ value: v }) => <CheckRecipientTag value={v as CheckRecipient} />}
        />
      )
    },
    {
      title: 'Received',
      key: 'payment_received',
      width: 170,
      render: (_, record) => (
        <Space>
          <Switch
            checked={!!record.payment_received}
            loading={savingIds.has(record.id)}
            checkedChildren="✓"
            unCheckedChildren="✗"
            onChange={(checked) => handleInlineUpdate(record.id, { payment_received: checked })}
          />
          <ReceivedTag received={record.payment_received} />
        </Space>
      )
    },
    {
      title: 'Note',
      key: 'payment_note',
      width: 240,
      render: (_, record) => (
        <EditableNote
          value={record.payment_note}
          updatedAt={record.payment_note_updated_at}
          onSave={(note) => handleInlineUpdate(record.id, { payment_note: note ?? '' })}
        />
      )
    }
  ];

  const pendingJobs = jobs.filter(j => !j.payment_received);
  const outstandingTotal = pendingJobs.reduce((sum, j) => sum + outstandingAmount(j), 0);

  // Mobile row renderer: one tappable block per job
  const renderMobileItem = (job: WaterMitigationJob) => (
    <div
      className="ui-row"
      style={paymentView && job.payment_received ? { background: RECEIVED_ROW_BG } : undefined}
      onClick={() => navigate(`/water-mitigation/${job.id}`)}
    >
      <div className="ui-row-body">
        <div className="ui-row-tags">
          <WMStatusPill status={job.status} />
          {!job.active && <Pill tone="gray">Inactive</Pill>}
        </div>
        <span className="ui-row-title">{job.property_address}</span>
        <div className="ui-row-meta">
          {job.company && <CompanyTag company={job.company} />}
          {job.homeowner_name && <span>{job.homeowner_name}</span>}
          {job.claim_number && <span>Claim: {job.claim_number}</span>}
          {(job.photo_count ?? 0) > 0 && <span>Photos: {job.photo_count}</span>}
        </div>
        {paymentView && (
          // Amounts are edited on desktop or the detail page; mobile only toggles received
          <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 10 }}>
            {showAmounts && (
              <div className="ui-row-meta" style={{ marginTop: 0 }}>
                <span>Invoice <Text>{formatMoney(job.invoice_amount)}</Text></span>
                <span>Approved <Text>{formatMoney(effectiveApproved(job))}</Text></span>
              </div>
            )}
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <CheckRecipientTag value={job.check_recipient} />
              <Switch
                size="small"
                checked={!!job.payment_received}
                loading={savingIds.has(job.id)}
                onChange={(checked) => handleInlineUpdate(job.id, { payment_received: checked })}
              />
              <ReceivedTag received={job.payment_received} />
            </div>
            <div style={{ marginTop: 8 }}>
              <EditableNote
                compact
                value={job.payment_note}
                updatedAt={job.payment_note_updated_at}
                onSave={(note) => handleInlineUpdate(job.id, { payment_note: note ?? '' })}
              />
            </div>
          </div>
        )}
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        <Dropdown menu={rowMenu(job)} trigger={['click']}>
          <Button type="text" icon={<MoreOutlined />} aria-label="Job actions" style={{ marginRight: -8 }} />
        </Dropdown>
      </div>
    </div>
  );

  const toggleLabelStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap'
  };

  return (
    <div>
      <PageHeader
        title="Water Mitigation Jobs"
        meta={<span>{total} {total === 1 ? 'job' : 'jobs'}</span>}
        actions={
          <>
            {!isMobile && (
              <>
                <SheetPAMappingButton onApplied={loadJobs} />
                <GoogleSheetsSyncButton
                  onSyncComplete={loadJobs}
                  type="default"
                  size="middle"
                  showStats={true}
                />
              </>
            )}
            <WMPaymentLinkButton size="middle" />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleOpenCreateModal}
            >
              New Job
            </Button>
          </>
        }
      />

      {/* Filters */}
      <div className="ui-toolbar">
        <Search
          placeholder="Search address, homeowner, claim..."
          allowClear
          onSearch={handleSearch}
          style={{ width: isMobile ? '100%' : 320, minWidth: 0 }}
        />
        <Select
          mode="multiple"
          placeholder="Filter by status"
          maxTagCount="responsive"
          style={{ minWidth: isMobile ? 0 : 200, flex: isMobile ? '1 1 100%' : undefined }}
          onChange={handleStatusChange}
          allowClear
        >
          {JOB_STATUS_OPTIONS.map(option => (
            <Option key={option.value} value={option.value}>
              {option.label}
            </Option>
          ))}
        </Select>

        <Select
          placeholder="Active status"
          style={{ width: isMobile ? 'auto' : 140, flex: isMobile ? '1 1 0' : undefined }}
          onChange={handleActiveChange}
          defaultValue="active"
        >
          <Option value="all">All</Option>
          <Option value="active">Active Only</Option>
          <Option value="inactive">Inactive Only</Option>
        </Select>

        <div className="ui-toolbar-end">
          <label style={toggleLabelStyle}>
            <Switch size="small" checked={paymentView} onChange={handlePaymentViewChange} />
            Payment view
          </label>
          {paymentView && (
            <>
              <label style={toggleLabelStyle}>
                <Switch size="small" checked={showAmounts} onChange={setShowAmounts} />
                Amounts
              </label>
              <label style={toggleLabelStyle}>
                <Switch
                  size="small"
                  checked={!!filters.hide_received}
                  onChange={(checked) =>
                    setFilters(prev => ({ ...prev, hide_received: checked || undefined, page: 1 }))
                  }
                />
                Hide received
              </label>
            </>
          )}
        </div>
      </div>

      {paymentView && showAmounts && (
        <Row gutter={32} style={{ margin: '4px 0 16px' }}>
          <Col style={{ paddingLeft: 0 }}>
            <Statistic title="Pending (this page)" value={pendingJobs.length} suffix={`/ ${jobs.length}`} />
          </Col>
          <Col>
            <Statistic
              title="Outstanding (this page)"
              value={outstandingTotal}
              precision={2}
              prefix="$"
            />
          </Col>
        </Row>
      )}

      {/* Mobile: row list / Desktop: table */}
      {isMobile ? (
        <List
          className="ui-row-list"
          dataSource={jobs}
          loading={loading}
          renderItem={renderMobileItem}
          pagination={{
            current: filters.page,
            pageSize: filters.page_size,
            total: total,
            size: 'small',
            align: 'center',
            showTotal: (total) => `${total} jobs`,
            onChange: (page, pageSize) => {
              setFilters(prev => ({ ...prev, page, page_size: pageSize }));
            }
          }}
        />
      ) : (
        <Table
          columns={paymentView ? paymentColumns : columns}
          dataSource={jobs}
          rowKey="id"
          loading={loading}
          onRow={(record) => ({
            onClick: (e) => {
              // Don't navigate if clicking on a link, button, dropdown, or an inline editor
              const target = e.target as HTMLElement;
              if (target.closest(
                'a, button, .ant-dropdown-trigger, .ant-btn, .ant-input-number, .ant-select, .ant-switch'
              )) return;
              navigate(`/water-mitigation/${record.id}`);
            },
            style: {
              cursor: 'pointer',
              background: paymentView && record.payment_received ? RECEIVED_ROW_BG : undefined
            }
          })}
          pagination={{
            current: filters.page,
            pageSize: filters.page_size,
            total: total,
            showSizeChanger: true,
            showTotal: (total) => `Total ${total} jobs`,
            onChange: (page, pageSize) => {
              setFilters(prev => ({ ...prev, page, page_size: pageSize }));
            }
          }}
          scroll={{ x: paymentView ? (showAmounts ? 1100 : 900) : 1200 }}
        />
      )}

      <JobFormModal
        visible={formVisible}
        onCancel={() => {
          setFormVisible(false);
          setEditingJob(undefined);
        }}
        onSuccess={handleFormSuccess}
        job={editingJob}
      />
    </div>
  );
};

export default WaterMitigationList;
