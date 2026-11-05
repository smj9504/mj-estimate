/**
 * Water Mitigation Job List Page
 * Displays all water mitigation jobs with filtering and actions
 * Responsive: mobile card layout, desktop table layout
 */

import React, { useState, useEffect, useRef } from 'react';
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
  Col,
  Alert
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
  JobSupplement,
  JobUpdate,
  CheckRecipient
} from '../types/waterMitigation';
import { JOB_STATUS_OPTIONS } from '../types/waterMitigation';
import { PageHeader, Pill } from '../components/common/ui';
import { WMStatusPill } from '../components/water-mitigation/wmStatus';
import { SUPPLEMENT_STATUS_TONES, supplementStatusLabel } from '../components/supplement/supplementUi';
import { useAuth } from '../contexts/AuthContext';
import JobFormModal from '../components/water-mitigation/JobFormModal';
import GoogleSheetsSyncButton from '../components/water-mitigation/GoogleSheetsSyncButton';
import SheetPAMappingButton from '../components/water-mitigation/SheetPAMappingButton';
import SheetRowMatchModal from '../components/water-mitigation/SheetRowMatchModal';
import googleSheetsService, { type SheetRowMatch, type SyncStats } from '../services/googleSheetsService';
import WMPaymentLinkButton from '../components/water-mitigation/WMPaymentLinkButton';
import { useWaterMitigationAccess } from '../hooks/useWaterMitigationAccess';
import {
  AMOUNT_HINT,
  AmountText,
  CHECK_RECIPIENT_OPTIONS,
  CheckRecipientTag,
  CompanyTag,
  EditableNote,
  RECEIVED_ROW_BG,
  ReceivedTag,
  effectiveApproved,
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
  // The View grant opens jobs and edits their details; no new jobs, sheet
  // sync, payment view, deactivating or deleting
  const { limited } = useWaterMitigationAccess();
  const { canAccessPath, user } = useAuth();
  // The manager link shows every company's jobs: only for those who see them all
  const seesEveryCompany = !!user && (
    user.role === 'admin' || user.role === 'super_admin' || !!user.all_companies
  );
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

  // Sheet rows waiting on whether they are the same as a job entered by hand or a Lead
  const [rowMatches, setRowMatches] = useState<SheetRowMatch[]>([]);
  const [rowMatchesOpen, setRowMatchesOpen] = useState(false);

  // Payment view: swaps the column set for amounts / received tracking
  const [paymentView, setPaymentView] = useState(false);
  // Invoice / Approved columns can be hidden (e.g. when showing the screen to someone)
  const [showAmounts, setShowAmounts] = useState(true);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  // Uncommitted InputNumber edits, keyed `${jobId}:${field}`; committed on blur/enter
  const [drafts, setDrafts] = useState<Record<string, number | null>>({});

  // Latest load wins, so a slow response can't overwrite a newer one
  const loadSeq = useRef(0);

  // A silent load (coming back to the window) keeps the list on screen
  const fetchJobs = async (silent: boolean) => {
    const seq = ++loadSeq.current;
    try {
      if (!silent) setLoading(true);
      const response = await waterMitigationService.getJobs(filters);
      if (seq !== loadSeq.current) return;
      setJobs(response.items);
      setTotal(response.total);
    } catch (error) {
      if (!silent) message.error('Failed to load jobs');
      console.error('Load jobs error:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadJobs = () => fetchJobs(false);

  useEffect(() => {
    loadJobs();
  }, [filters]);

  const loadRowMatches = async () => {
    if (limited) return [];
    try {
      const matches = await googleSheetsService.getRowMatches();
      setRowMatches(matches);
      return matches;
    } catch (error) {
      console.error('Load sheet row matches error:', error);
      return [];
    }
  };

  useEffect(() => {
    loadRowMatches();
  }, [limited]);

  const handleSheetSynced = async (result: SyncStats) => {
    loadJobs();
    const matches = await loadRowMatches();
    if (result.needs_review && matches.length > 0) setRowMatchesOpen(true);
  };

  // Supplement status is read from the supplement records on every load, so
  // coming back to this window picks up a status changed on that screen.
  // Skipped mid-save so the reload can't undo an optimistic payment edit.
  const reloadOnReturn = useRef(() => {});
  reloadOnReturn.current = () => {
    if (savingIds.size === 0) fetchJobs(true);
    loadRowMatches();
  };

  useEffect(() => {
    // Switching tabs fires both events; one reload is enough
    let lastReload = 0;
    const onReturn = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastReload < 1000) return;
      lastReload = Date.now();
      reloadOnReturn.current();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, []);

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
      // The update answers with the bare job: it leaves out what only the list
      // fills in (the insurance amount behind Amount, supplements) and sends
      // them empty, so keep the row's own copies.
      setJobs(prev => prev.map(j => (
        j.id === jobId
          ? {
              ...j,
              ...updated,
              photo_count: j.photo_count,
              approved_amount_auto: j.approved_amount_auto,
              supplements: j.supplements,
            }
          : j
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

  // Amount: the approved (final) amount in dark, which defaults to the claim's
  // insurance estimate until typed. With nothing approved the box stays empty
  // and our invoice shows in light gray as its placeholder.
  const renderAmountCell = () =>
    (_: unknown, record: WaterMitigationJob) => {
      const field = 'approved_amount' as const;
      const key = `${record.id}:${field}`;
      const isAuto = record.approved_amount == null && record.approved_amount_auto != null;
      const stored = effectiveApproved(record);
      const value = key in drafts ? drafts[key] : stored;
      const hasApproved = value != null;
      const showsInvoice = !hasApproved && record.invoice_amount != null;
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
          placeholder={showsInvoice ? Number(record.invoice_amount).toFixed(2) : '—'}
          className={hasApproved ? 'wm-amount-approved' : 'wm-amount-invoice'}
          style={{ width: '100%' }}
          value={value ?? undefined}
          onChange={(v) => setDrafts(prev => ({ ...prev, [key]: v }))}
          onBlur={commit}
          onPressEnter={commit}
        />
      );
      if (showsInvoice) {
        return (
          <Tooltip title="Our invoice. Nothing approved yet; type the approved amount.">
            {input}
          </Tooltip>
        );
      }
      return isAuto && !(key in drafts) ? (
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
      ...(limited ? [] : [{
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
      }])
    ]
  });

  const supplementKind = (s: JobSupplement) =>
    s.request_type === 'estimate_request' ? 'Estimate request' : 'Supplement';

  // The claim's supplement request: the open one when there is one, else the
  // latest. `labelled` names the kind in the pill for rows with no Supplement
  // column header; in the column an estimate request gets a caption instead.
  const canOpenSupplements = canAccessPath('/supplements');
  const renderSupplement = (job: WaterMitigationJob, labelled = false) => {
    const all = job.supplements ?? [];
    const [shown] = all;
    if (!shown) return null;
    const status = supplementStatusLabel(shown.status);
    const pill = (
      <Pill tone={SUPPLEMENT_STATUS_TONES[shown.status] ?? 'gray'}>
        {labelled ? `${supplementKind(shown)}: ${status}` : status}
      </Pill>
    );
    const summary = all.map(s => (
      <div key={s.id}>
        {supplementKind(s)} · {supplementStatusLabel(s.status)}{s.title ? ` — ${s.title}` : ''}
      </div>
    ));
    const tag = (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Tooltip title={summary}>
          {canOpenSupplements ? (
            <a
              href={`/supplements/${shown.id}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                navigate(`/supplements/${shown.id}`);
              }}
              aria-label={`Open ${supplementKind(shown).toLowerCase()} (${status})`}
            >
              {pill}
            </a>
          ) : <span>{pill}</span>}
        </Tooltip>
        {all.length > 1 && <Text type="secondary" style={{ fontSize: 12 }}>+{all.length - 1}</Text>}
      </span>
    );
    if (labelled || shown.request_type !== 'estimate_request') return tag;
    return (
      <div>
        {tag}
        <div><Text type="secondary" style={{ fontSize: 12 }}>Estimate request</Text></div>
      </div>
    );
  };

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
      title: 'Supplement',
      key: 'supplement',
      width: 140,
      render: (_, record) => renderSupplement(record)
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
      render: (name: string, job: WaterMitigationJob) => {
        if (!name) return null;
        // The tab it came from, but its row has gone, so the sheet no longer updates it
        return job.google_sheet_row_number
          ? <Pill tone="purple">{name}</Pill>
          : (
            <div title={`This job's row is no longer on the ${name} tab, so the sheet doesn't update it.`}>
              <Pill tone="gray">{name}</Pill>
              <div className="ui-cell-meta">Off sheet</div>
            </div>
          );
      },
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

  // Payment view columns (desktop). Our invoice has no column of its own: it
  // shows in gray inside Amount until an approved amount replaces it. It is
  // read-only here because the scope invoice sync writes it.
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
          <Tooltip title={AMOUNT_HINT}>
            <span>Amount</span>
          </Tooltip>
        ),
        key: 'approved_amount',
        width: 160,
        render: renderAmountCell()
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
          {renderSupplement(job, true)}
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
                <span>Amount <AmountText row={job} /></span>
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
        actions={limited ? undefined : (
          <>
            {!isMobile && (
              <>
                <SheetPAMappingButton onApplied={loadJobs} />
                <GoogleSheetsSyncButton
                  onSyncComplete={handleSheetSynced}
                  type="default"
                  size="middle"
                  showStats={true}
                />
              </>
            )}
            {seesEveryCompany && <WMPaymentLinkButton size="middle" />}
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleOpenCreateModal}
            >
              New Job
            </Button>
          </>
        )}
      />

      {!limited && rowMatches.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            rowMatches.length === 1
              ? 'A sheet row may already be here, as a job entered by hand or a Lead. It won\'t become a job until you decide.'
              : `${rowMatches.length} sheet rows may already be here, as jobs entered by hand or Leads. They won't become jobs until you decide.`
          }
          action={<Button size="small" onClick={() => setRowMatchesOpen(true)}>Review</Button>}
        />
      )}

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

        <label style={toggleLabelStyle}>
          <Switch
            size="small"
            checked={!!filters.has_supplement}
            onChange={(checked) =>
              setFilters(prev => ({ ...prev, has_supplement: checked || undefined, page: 1 }))
            }
          />
          Supplement only
        </label>

        {!limited && (
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
        )}
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
          scroll={{ x: paymentView ? (showAmounts ? 970 : 900) : 1340 }}
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

      <SheetRowMatchModal
        open={rowMatchesOpen}
        matches={rowMatches}
        onClose={() => setRowMatchesOpen(false)}
        onChanged={() => {
          loadJobs();
          loadRowMatches();
        }}
      />
    </div>
  );
};

export default WaterMitigationList;
