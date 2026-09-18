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
  Tag,
  Card,
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
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  MoreOutlined,
  RightOutlined,
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
import JobFormModal from '../components/water-mitigation/JobFormModal';
import GoogleSheetsSyncButton from '../components/water-mitigation/GoogleSheetsSyncButton';
import SheetPAMappingButton from '../components/water-mitigation/SheetPAMappingButton';
import WMPaymentLinkButton from '../components/water-mitigation/WMPaymentLinkButton';
import {
  CHECK_RECIPIENT_OPTIONS,
  CheckRecipientTag,
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

const STATUS_COLORS: Record<JobStatus, string> = {
  'Lead': 'blue',
  'Doc prepping': 'cyan',
  'Sent to adjuster': 'geekblue',
  'Follow up': 'orange',
  'Paperwork received': 'purple',
  'Estimate requested': 'magenta',
  'Check received': 'green',
  'Complete': 'success'
};

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
          style={{ width: '100%', ...(isAuto && !(key in drafts) ? { color: '#8c8c8c' } : {}) }}
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

  // Table columns (desktop)
  const columns: ColumnsType<WaterMitigationJob> = [
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 150,
      render: (status: JobStatus) => (
        <Tag color={STATUS_COLORS[status]}>{status}</Tag>
      )
    },
    {
      title: 'Property Address',
      dataIndex: 'property_address',
      key: 'property_address',
      ellipsis: true,
      render: (address: string, record) => (
        <a
          onClick={() => navigate(`/water-mitigation/${record.id}`)}
          style={{ color: '#1890ff', cursor: 'pointer' }}
        >
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
        company ? (
          <Tag color="blue">{company.company_code || company.name}</Tag>
        ) : null
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
      render: (name: string) => name ? <Tag color="purple">{name}</Tag> : null,
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
      render: (count: number) => count || 0
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 80,
      fixed: 'right',
      render: (_, record) => (
        <Dropdown
          menu={{
            items: [
              {
                key: 'edit',
                icon: <EditOutlined />,
                label: 'Edit',
                onClick: () => handleOpenEditModal(record)
              },
              {
                key: 'toggle-active',
                icon: <PoweroffOutlined />,
                label: record.active ? 'Deactivate' : 'Activate',
                onClick: () => handleToggleActive(record.id, record.active)
              },
              {
                key: 'delete',
                icon: <DeleteOutlined />,
                label: 'Delete',
                danger: true,
                onClick: () => {
                  const confirmed = window.confirm('Delete this job?');
                  if (confirmed) {
                    handleDelete(record.id);
                  }
                }
              }
            ]
          }}
          trigger={['click']}
        >
          <Button type="text" icon={<MoreOutlined />} />
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
          <a
            onClick={() => navigate(`/water-mitigation/${record.id}`)}
            style={{ color: '#1890ff', cursor: 'pointer' }}
          >
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
          onSave={(note) => handleInlineUpdate(record.id, { payment_note: note ?? '' })}
        />
      )
    }
  ];

  const pendingJobs = jobs.filter(j => !j.payment_received);
  const outstandingTotal = pendingJobs.reduce((sum, j) => sum + outstandingAmount(j), 0);

  // Mobile card item renderer
  const renderMobileItem = (job: WaterMitigationJob) => (
    <List.Item
      style={{ padding: '12px 0' }}
      actions={[
        <Dropdown
          key="actions"
          menu={{
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
          }}
          trigger={['click']}
        >
          <Button type="text" icon={<MoreOutlined />} />
        </Dropdown>
      ]}
    >
      <div
        style={{ flex: 1, cursor: 'pointer', minWidth: 0 }}
        onClick={() => navigate(`/water-mitigation/${job.id}`)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <Tag color={STATUS_COLORS[job.status]}>{job.status}</Tag>
          {job.company && (
            <Tag color="blue">{job.company.company_code || job.company.name}</Tag>
          )}
          {!job.active && <Tag>INACTIVE</Tag>}
        </div>
        <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 2 }}>
          {job.property_address}
        </Text>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {job.homeowner_name && (
            <Text type="secondary" style={{ fontSize: 12 }}>{job.homeowner_name}</Text>
          )}
          {job.claim_number && (
            <Text type="secondary" style={{ fontSize: 12 }}>Claim: {job.claim_number}</Text>
          )}
          {(job.photo_count ?? 0) > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>Photos: {job.photo_count}</Text>
          )}
        </div>
        {paymentView && (
          // Amounts are edited on desktop or the detail page; mobile only toggles received
          <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 8 }}>
            {showAmounts && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
                <Text type="secondary">Invoice {formatMoney(job.invoice_amount)}</Text>
                <Text type="secondary">Approved {formatMoney(effectiveApproved(job))}</Text>
              </div>
            )}
            <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <CheckRecipientTag value={job.check_recipient} />
              <Switch
                size="small"
                checked={!!job.payment_received}
                loading={savingIds.has(job.id)}
                onChange={(checked) => handleInlineUpdate(job.id, { payment_received: checked })}
              />
              <ReceivedTag received={job.payment_received} />
            </div>
            <div style={{ marginTop: 6 }}>
              <EditableNote
                compact
                value={job.payment_note}
                onSave={(note) => handleInlineUpdate(job.id, { payment_note: note ?? '' })}
              />
            </div>
          </div>
        )}
      </div>
    </List.Item>
  );

  return (
    <div style={{ padding: isMobile ? '0' : '24px' }}>
      <Card
        title="Water Mitigation Jobs"
        extra={
          <Space size={isMobile ? 'small' : 'middle'}>
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
            <WMPaymentLinkButton size={isMobile ? 'small' : 'middle'} />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleOpenCreateModal}
            >
              {isMobile ? 'New' : 'New Job'}
            </Button>
          </Space>
        }
        styles={{
          header: isMobile ? { padding: '0 12px' } : undefined,
          body: isMobile ? { padding: '12px' } : undefined
        }}
      >
        {/* Filters */}
        <div style={{ marginBottom: 16 }}>
          <div style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            gap: 8,
            flexWrap: 'wrap'
          }}>
            <Search
              placeholder="Search address, homeowner, claim..."
              allowClear
              onSearch={handleSearch}
              style={{ width: isMobile ? '100%' : 400, minWidth: 0 }}
              prefix={<SearchOutlined />}
            />

            <div style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              flex: isMobile ? undefined : 1
            }}>
              <Select
                mode="multiple"
                placeholder="Filter by status"
                style={{ minWidth: isMobile ? '100%' : 200, flex: isMobile ? '1 1 100%' : undefined }}
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
                style={{ width: isMobile ? '100%' : 150 }}
                onChange={handleActiveChange}
                defaultValue="active"
              >
                <Option value="all">All</Option>
                <Option value="active">Active Only</Option>
                <Option value="inactive">Inactive Only</Option>
              </Select>

              <Space wrap style={{ marginLeft: isMobile ? 0 : 'auto' }}>
                <Text style={{ fontSize: 13 }}>Payment view</Text>
                <Switch checked={paymentView} onChange={handlePaymentViewChange} />
                {paymentView && (
                  <>
                    <Text style={{ fontSize: 13 }}>Amounts</Text>
                    <Switch checked={showAmounts} onChange={setShowAmounts} />
                    <Text style={{ fontSize: 13 }}>Hide received</Text>
                    <Switch
                      checked={!!filters.hide_received}
                      onChange={(checked) =>
                        setFilters(prev => ({ ...prev, hide_received: checked || undefined, page: 1 }))
                      }
                    />
                  </>
                )}
              </Space>
            </div>
          </div>
        </div>

        {paymentView && showAmounts && (
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={12} md={6}>
              <Statistic title="Pending (this page)" value={pendingJobs.length} suffix={`/ ${jobs.length}`} />
            </Col>
            <Col xs={12} md={6}>
              <Statistic
                title="Outstanding (this page)"
                value={outstandingTotal}
                precision={2}
                prefix="$"
              />
            </Col>
          </Row>
        )}

        {/* Mobile: Card List / Desktop: Table */}
        {isMobile ? (
          <List
            dataSource={jobs}
            loading={loading}
            renderItem={renderMobileItem}
            pagination={{
              current: filters.page,
              pageSize: filters.page_size,
              total: total,
              size: 'small',
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
      </Card>

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
