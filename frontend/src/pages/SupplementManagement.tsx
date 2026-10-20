import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Button, Modal, Form, Input, InputNumber,
  Select, message, Row, Col, Tooltip,
  Dropdown, Alert, Checkbox, Segmented, Grid, List,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined,
  DeleteOutlined, MoreOutlined,
  FilePdfOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import { supplementService } from '../services/supplementService';
import { fileService } from '../services/fileService';
import ClaimSearchSelect from '../components/common/ClaimSearchSelect';
import { PageHeader, Pill, useSheetModal } from '../components/common/ui';
import { tagTones } from '../styles/tokens';
import {
  SupplementStatusPill, SUPPLEMENT_STATUS_TONES, REQUIRED_ESTIMATE_OPTIONS,
  requiredEstimateLabels, formatCurrency, formatSignedCurrency, supplementStatusLabel,
} from '../components/supplement/supplementUi';
import type {
  SupplementRequest, SupplementRequestCreate,
} from '../types/supplement';
import type { ColumnsType } from 'antd/es/table';

const { useBreakpoint } = Grid;

/** Status filters in workflow order; withdrawn is reachable through All */
const STATUS_FILTERS = ['identified', 'in_progress', 'submitted', 'under_review', 'approved', 'denied'] as const;

/** How many pending-review estimates show before "Show all" */
const REVIEW_PREVIEW_COUNT = 4;

const SupplementManagement: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { sheetProps } = useSheetModal();
  const [activeTab, setActiveTab] = useState<string>('supplement');
  const [statusFilter, setStatusFilter] = useState<string | undefined>('identified');
  const [search, setSearch] = useState('');
  const [showAllReview, setShowAllReview] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [claimPaInfo, setClaimPaInfo] = useState<{ pa_name: string; pa_email: string } | null>(null);
  const [claimPaLoading, setClaimPaLoading] = useState(false);

  const isEstimateRequest = activeTab === 'estimate_request';
  const noun = isEstimateRequest ? 'estimate request' : 'supplement';

  // Queries
  const { data: stats } = useQuery({
    queryKey: ['supplement-stats'],
    queryFn: () => supplementService.getStats(),
  });

  const { data: supplements = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['supplements', statusFilter, activeTab],
    queryFn: () => supplementService.list({ status: statusFilter, request_type: activeTab, page_size: 100 }),
  });

  const { data: pendingReview = [] } = useQuery({
    queryKey: ['supplements-pending-review'],
    queryFn: () => supplementService.getPendingReview(),
  });

  // Search runs over the rows already loaded (the list is capped at 100)
  const visibleSupplements = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return supplements;
    return supplements.filter(s =>
      [s.claim_number, s.property_address, s.insurance_company, s.title, s.homeowner_name]
        .some(v => v?.toLowerCase().includes(q)),
    );
  }, [supplements, search]);

  // Pre-load insurance estimate file IDs for all supplements in the list
  const [estimateFileMap, setEstimateFileMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!supplements.length) return;
    const claimIds = Array.from(new Set(supplements.map(s => s.claim_id).filter(Boolean)));
    const newIds = claimIds.filter(id => !(id in estimateFileMap));
    if (!newIds.length) return;

    newIds.forEach(claimId => {
      supplementService.getInsuranceEstimate(claimId).then(est => {
        if (est && (est as any).file_download_id) {
          setEstimateFileMap(prev => ({ ...prev, [claimId]: (est as any).file_download_id }));
        } else {
          setEstimateFileMap(prev => ({ ...prev, [claimId]: '' }));
        }
      }).catch(() => {
        setEstimateFileMap(prev => ({ ...prev, [claimId]: '' }));
      });
    });
  }, [supplements]);

  // Auto-fetch PA info when a claim is picked in create form
  const handleClaimSelect = useCallback(async (claimId?: string) => {
    if (!claimId) {
      setClaimPaInfo(null);
      return;
    }
    setClaimPaLoading(true);
    try {
      const info = await supplementService.getClaimPaInfo(claimId);
      if (info.pa_name || info.pa_email) {
        setClaimPaInfo(info);
        createForm.setFieldsValue({
          submitted_to: info.pa_name || undefined,
          submitted_to_email: info.pa_email || undefined,
        });
      } else {
        setClaimPaInfo(null);
      }
    } catch {
      setClaimPaInfo(null);
    } finally {
      setClaimPaLoading(false);
    }
  }, [createForm]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: SupplementRequestCreate) => supplementService.create(data),
    onSuccess: () => {
      message.success(isEstimateRequest ? 'Estimate request created' : 'Supplement request created');
      setCreateModalOpen(false);
      createForm.resetFields();
      setClaimPaInfo(null);
      queryClient.invalidateQueries({ queryKey: ['supplements'] });
      queryClient.invalidateQueries({ queryKey: ['supplement-stats'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => supplementService.delete(id),
    onSuccess: () => {
      message.success('Deleted');
      queryClient.invalidateQueries({ queryKey: ['supplements'] });
      queryClient.invalidateQueries({ queryKey: ['supplement-stats'] });
    },
  });

  const confirmDelete = (r: SupplementRequest) => Modal.confirm({
    title: `Delete this ${noun}?`,
    content: r.title,
    okText: 'Delete',
    okButtonProps: { danger: true },
    onOk: () => deleteMutation.mutate(r.id),
  });

  const rowMenu = (r: SupplementRequest) => ({
    items: [
      { key: 'delete', label: 'Delete', danger: true, icon: <DeleteOutlined />, onClick: () => confirmDelete(r) },
    ],
  });

  const openDetail = (r: SupplementRequest) => navigate(`/supplements/${r.id}`);

  const estimatePdfLink = (r: SupplementRequest) => {
    const fileId = estimateFileMap[r.claim_id];
    if (!fileId) return null;
    return (
      <Tooltip title="Insurance estimate PDF">
        <a
          className="sup-pdf-link"
          href={`${fileService.getDownloadUrl(fileId)}?inline=true`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          aria-label={`Open insurance estimate PDF for claim ${r.claim_number || ''}`}
        >
          <FilePdfOutlined />
        </a>
      </Tooltip>
    );
  };

  const columns: ColumnsType<SupplementRequest> = [
    {
      title: 'Claim #',
      key: 'claim',
      width: 170,
      render: (_, r) => (
        <div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className="ui-ink-link">{r.claim_number || 'No claim #'}</span>
            {estimatePdfLink(r)}
          </span>
          {r.insurance_company && <div className="sup-cell-meta">{r.insurance_company}</div>}
        </div>
      ),
    },
    {
      title: 'Address', dataIndex: 'property_address', key: 'address', ellipsis: true,
      render: (addr: string, r) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{addr || r.title}</div>
          {r.homeowner_name && <div className="sup-cell-meta">{r.homeowner_name}</div>}
        </div>
      ),
    },
    {
      title: 'Status', dataIndex: 'status', key: 'status', width: 130,
      render: (s: string) => <SupplementStatusPill status={s} />,
    },
    ...(!isEstimateRequest ? [
      {
        title: 'Original', dataIndex: 'original_amount', key: 'original', width: 120,
        align: 'right' as const,
        render: (v: number) => <span className="sup-money-muted">{formatCurrency(v)}</span>,
      },
      {
        title: 'Supplement', dataIndex: 'supplement_amount', key: 'supplement', width: 120,
        align: 'right' as const, render: (v: number) => <span className="sup-money">{formatCurrency(v)}</span>,
      },
      {
        title: 'Diff', dataIndex: 'difference', key: 'diff', width: 120, align: 'right' as const,
        render: (v: number) => (
          <span className={v > 0 ? 'sup-diff-up' : v < 0 ? 'sup-diff-down' : 'sup-money-muted'}>
            {formatSignedCurrency(v)}
          </span>
        ),
      },
    ] : [
      {
        title: 'Our Estimate', dataIndex: 'our_estimate_amount', key: 'our_estimate', width: 140,
        align: 'right' as const, render: (v: number) => <span className="sup-money">{formatCurrency(v)}</span>,
      },
    ]),
    {
      title: 'Required', key: 'required_estimates', width: 190,
      responsive: ['xl'],
      render: (_, r) => {
        const labels = requiredEstimateLabels(r.required_estimates);
        return labels.length
          ? <span className="sup-cell-meta" style={{ marginTop: 0 }}>{labels.join(', ')}</span>
          : <span className="ui-props-empty">—</span>;
      },
    },
    {
      title: 'Bids', dataIndex: 'bid_item_count', key: 'bid_items', width: 64, align: 'right',
      responsive: ['lg'],
      render: (c: number) => <span className={c > 0 ? undefined : 'ui-props-empty'}>{c || 0}</span>,
    },
    {
      title: <span className="ui-sr-only">Actions</span>, key: 'actions', width: 48, align: 'center',
      render: (_, r) => (
        <Dropdown menu={rowMenu(r)} trigger={['click']}>
          <Button type="text" size="small" className="ui-icon-btn" icon={<MoreOutlined />} aria-label="Row actions" />
        </Dropdown>
      ),
    },
  ];

  // Phone row: status first, then the address, then claim and money
  const renderMobileItem = (r: SupplementRequest) => {
    const labels = requiredEstimateLabels(r.required_estimates);
    return (
      <div className="ui-row" onClick={() => openDetail(r)}>
        <div className="ui-row-body">
          <div className="ui-row-tags">
            <SupplementStatusPill status={r.status} />
          </div>
          <span className="ui-row-title">{r.property_address || r.title}</span>
          <div className="ui-row-meta">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {r.claim_number || 'No claim #'}
              {estimatePdfLink(r)}
            </span>
            {r.insurance_company && <span>{r.insurance_company}</span>}
            {(r.bid_item_count || 0) > 0 && <span>Bids: {r.bid_item_count}</span>}
          </div>
          <div className="ui-row-meta sup-row-money">
            {isEstimateRequest ? (
              <span>Our estimate <span className="sup-money">{formatCurrency(r.our_estimate_amount)}</span></span>
            ) : (
              <>
                <span>Supplement <span className="sup-money">{formatCurrency(r.supplement_amount)}</span></span>
                <span className={r.difference > 0 ? 'sup-diff-up' : r.difference < 0 ? 'sup-diff-down' : undefined}>
                  {formatSignedCurrency(r.difference)}
                </span>
              </>
            )}
          </div>
          {labels.length > 0 && <div className="ui-row-meta">{labels.join(', ')}</div>}
        </div>
        <div onClick={e => e.stopPropagation()}>
          <Dropdown menu={rowMenu(r)} trigger={['click']}>
            <Button type="text" icon={<MoreOutlined />} aria-label="Row actions" style={{ marginRight: -8 }} />
          </Dropdown>
        </div>
      </div>
    );
  };

  const statusCount = (key: string) => (stats ? (stats as any)[key] ?? 0 : undefined);
  const reviewItems = showAllReview ? pendingReview : pendingReview.slice(0, REVIEW_PREVIEW_COUNT);

  const emptyText = search.trim()
    ? `No ${noun}s match "${search.trim()}"`
    : statusFilter
      ? `No ${supplementStatusLabel(statusFilter).toLowerCase()} ${noun}s`
      : `No ${noun}s yet`;

  return (
    <div className="sup-page">
      <PageHeader
        title="Estimates"
        meta={isLoading ? undefined : (
          <span>
            {visibleSupplements.length} {visibleSupplements.length === 1 ? noun : `${noun}s`}
            {statusFilter ? ` · ${supplementStatusLabel(statusFilter).toLowerCase()}` : ''}
          </span>
        )}
        actions={
          <>
            <Tooltip title="Refresh">
              <Button icon={<ReloadOutlined spin={isFetching && !isLoading} />} onClick={() => refetch()} aria-label="Refresh" />
            </Tooltip>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
              {isEstimateRequest ? 'New Estimate Request' : 'New Supplement'}
            </Button>
          </>
        }
      />

      {/* Request type + search */}
      <div className="ui-toolbar">
        <Segmented
          value={activeTab}
          onChange={(key) => { setActiveTab(key as string); setStatusFilter(undefined); }}
          options={[
            { value: 'supplement', label: 'Supplements' },
            { value: 'estimate_request', label: 'Estimate Requests' },
          ]}
        />
        <div className="ui-toolbar-end" style={isMobile ? { width: '100%' } : undefined}>
          <Input.Search
            placeholder="Search claim, address, carrier..."
            allowClear
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: isMobile ? '100%' : 280 }}
            aria-label={`Search ${noun}s`}
          />
        </div>
      </div>

      {/* Status filter: one quiet view tab per status, its colour kept as a dot */}
      <div className="sup-status-tabs" role="group" aria-label="Filter by status">
        <Button
          type="text"
          size="small"
          aria-pressed={!statusFilter}
          className={`ui-view-tab${!statusFilter ? ' is-selected' : ''}`}
          onClick={() => setStatusFilter(undefined)}
        >
          All
          {statusCount('total') !== undefined && <span className="sup-tab-count">{statusCount('total')}</span>}
        </Button>
        {STATUS_FILTERS.map(key => (
          <Button
            key={key}
            type="text"
            size="small"
            aria-pressed={statusFilter === key}
            className={`ui-view-tab${statusFilter === key ? ' is-selected' : ''}`}
            onClick={() => setStatusFilter(key)}
          >
            <span
              className="ui-filter-chip-dot"
              style={{ background: tagTones[SUPPLEMENT_STATUS_TONES[key]].text }}
              aria-hidden="true"
            />
            {supplementStatusLabel(key)}
            {statusCount(key) !== undefined && <span className="sup-tab-count">{statusCount(key)}</span>}
          </Button>
        ))}
      </div>

      {/* Insurance estimates that arrived but nobody has looked at yet */}
      {!isEstimateRequest && pendingReview.length > 0 && (
        <section className="sup-review" aria-label="Estimates pending review">
          <div className="sup-review-head">
            <Pill tone="orange" icon={<ClockCircleOutlined />}>
              {pendingReview.length} estimate{pendingReview.length > 1 ? 's' : ''} pending review
            </Pill>
            <span className="sup-review-note">
              Insurance estimates received but not yet reviewed for supplement needs.
            </span>
          </div>
          <ul className="sup-review-list">
            {reviewItems.map(s => (
              <li key={s.id}>
                <a
                  className="ui-ink-link"
                  href={`/supplements/${s.id}`}
                  onClick={e => { e.preventDefault(); navigate(`/supplements/${s.id}`); }}
                >
                  {s.title}
                </a>
                <span className="sup-review-meta">
                  {s.claim_number || 'No claim #'} · {s.insurance_company || 'N/A'}
                </span>
              </li>
            ))}
          </ul>
          {pendingReview.length > REVIEW_PREVIEW_COUNT && (
            <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => setShowAllReview(v => !v)}>
              {showAllReview ? 'Show fewer' : `Show all ${pendingReview.length}`}
            </Button>
          )}
        </section>
      )}

      {/* Mobile: row list / Desktop: table */}
      {isMobile ? (
        <List
          className="ui-row-list"
          dataSource={visibleSupplements}
          loading={isLoading}
          renderItem={renderMobileItem}
          locale={{ emptyText }}
          pagination={visibleSupplements.length > 20 ? {
            pageSize: 20,
            size: 'small',
            align: 'center',
          } : false}
        />
      ) : (
        <Table
          dataSource={visibleSupplements}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          size="middle"
          scroll={{ x: 820 }}
          locale={{ emptyText }}
          onRow={(record) => ({
            onClick: (e) => {
              const target = e.target as HTMLElement;
              if (target.closest('a, button, .ant-dropdown-trigger, .ant-btn')) return;
              openDetail(record);
            },
            style: { cursor: 'pointer' },
          })}
          pagination={{ pageSize: 20, hideOnSinglePage: true, showTotal: t => `${t} ${isEstimateRequest ? 'estimate requests' : 'supplements'}` }}
        />
      )}

      {/* Create Modal */}
      <Modal title={isEstimateRequest ? 'Create Estimate Request' : 'Create Supplement Request'} open={createModalOpen} width={560}
        className="sup-modal" {...sheetProps}
        okText="Create"
        onOk={() => createForm.validateFields().then(v => {
          const { required_estimate_keys, ...rest } = v;
          const required_estimates: Record<string, boolean> = {};
          REQUIRED_ESTIMATE_OPTIONS.forEach(opt => {
            required_estimates[opt.key] = (required_estimate_keys || []).includes(opt.key);
          });
          createMutation.mutate({ ...rest, request_type: activeTab, required_estimates });
        })}
        onCancel={() => {
          setCreateModalOpen(false);
          createForm.resetFields();
          setClaimPaInfo(null);
        }}
        confirmLoading={createMutation.isPending}>
        <Form form={createForm} layout="vertical">
          <Form.Item name="claim_id" label="Claim" rules={[{ required: true, message: 'Please select a claim' }]}>
            <ClaimSearchSelect onChange={id => handleClaimSelect(id)} loading={claimPaLoading} />
          </Form.Item>
          {claimPaInfo && (
            <Alert
              type="info"
              message={`PA auto-assigned: ${claimPaInfo.pa_name}${claimPaInfo.pa_email ? ` (${claimPaInfo.pa_email})` : ''}`}
              style={{ marginBottom: 16 }}
              showIcon
            />
          )}
          <Form.Item name="title" label="Title" rules={[{ required: true, message: 'Please enter a title' }]}>
            <Input placeholder={isEstimateRequest ? 'e.g., Estimate Request - 123 Main St' : 'e.g., Supplement for bathroom rebuild'} />
          </Form.Item>
          <Form.Item name="reason" label="Reason">
            <Input.TextArea rows={3} placeholder={isEstimateRequest ? 'Insurance requested our estimate' : 'Why is re-estimation needed?'} />
          </Form.Item>
          {isEstimateRequest ? (
            <Form.Item name="our_estimate_amount" label="Our Estimate Amount">
              <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
            </Form.Item>
          ) : (
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item name="original_amount" label="Original Amount">
                  <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="supplement_amount" label="Supplement Amount">
                  <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          )}
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item name="submitted_to" label="Submit To (PA Name)">
                <Input placeholder="Auto-filled from claim PA" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="submitted_to_email" label="PA Email">
                <Input placeholder="Auto-filled from claim PA" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="priority" label="Priority" initialValue="normal">
            <Select options={[
              { value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
            ]} />
          </Form.Item>
          <Form.Item name="required_estimate_keys" label="Required Estimates" style={{ marginBottom: 0 }}>
            <Checkbox.Group style={{ width: '100%' }}>
              <Row gutter={[0, 8]}>
                {REQUIRED_ESTIMATE_OPTIONS.map(opt => (
                  <Col span={12} key={opt.key}>
                    <Checkbox value={opt.key}>{opt.label}</Checkbox>
                  </Col>
                ))}
              </Row>
            </Checkbox.Group>
          </Form.Item>
        </Form>
      </Modal>

    </div>
  );
};

export default SupplementManagement;
