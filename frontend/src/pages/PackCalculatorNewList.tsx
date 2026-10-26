/**
 * Packing Estimate List Page
 * Shows all packing estimates with client/company info
 * Includes mode selection modal for new estimates
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table, Button, message, Tooltip, Modal, Grid, List, Dropdown, Input,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined, EyeOutlined, DeleteOutlined, ReloadOutlined, MoreOutlined,
  AppstoreOutlined, CameraOutlined, RightOutlined,
} from '@ant-design/icons';
import * as packingService from '../services/packingEstimateService';
import type { PackEstimateSummary } from '../types/packing-estimate';
import { formatDateShort } from '../utils/formatters';
import { PageHeader, Pill, useSheetModal } from '../components/common/ui';
import { tagTones } from '../styles/tokens';
import {
  PACK_STATUSES, PACK_STATUS_TONES, PackStatusPill, packStatusLabel,
  CompanyName, formatMoney, modeLabel, packEstimateTitle,
} from '../components/packing-estimate/packingUi';

const { useBreakpoint } = Grid;

const PackCalculatorNewList: React.FC = () => {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { sheetProps } = useSheetModal();
  const [estimates, setEstimates] = useState<PackEstimateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [modeModalOpen, setModeModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [search, setSearch] = useState('');

  useEffect(() => { fetchEstimates(); }, []);

  const fetchEstimates = async () => {
    setLoading(true);
    try {
      const data = await packingService.listEstimates({ limit: 100 });
      setEstimates(data.items);
    } catch {
      message.error('Failed to load estimates');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await packingService.deleteEstimate(id);
      message.success('Estimate deleted');
      fetchEstimates();
    } catch {
      message.error('Failed to delete');
    }
  };

  const handleNewEstimate = useCallback(() => {
    setModeModalOpen(true);
  }, []);

  const handleSelectMode = useCallback((mode: 'quick' | 'photo_ai') => {
    setModeModalOpen(false);
    navigate('/reconstruction-estimate/pack-calculator-new', {
      state: { initialMode: mode },
    });
  }, [navigate]);

  const openDetail = (record: PackEstimateSummary) =>
    navigate(`/reconstruction-estimate/pack-calculator-new/${record.id}`);

  const confirmDelete = (record: PackEstimateSummary) => Modal.confirm({
    title: 'Delete this estimate?',
    content: packEstimateTitle(record),
    okText: 'Delete',
    okButtonProps: { danger: true },
    onOk: () => handleDelete(record.id),
  });

  const rowMenu = (record: PackEstimateSummary) => ({
    items: [
      { key: 'view', icon: <EyeOutlined />, label: 'View', onClick: () => openDetail(record) },
      { type: 'divider' as const },
      { key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true, onClick: () => confirmDelete(record) },
    ],
  });

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    estimates.forEach(e => { const s = e.status || 'draft'; counts[s] = (counts[s] || 0) + 1; });
    return counts;
  }, [estimates]);

  const visibleEstimates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return estimates.filter(e => {
      if (statusFilter && (e.status || 'draft') !== statusFilter) return false;
      if (!q) return true;
      return [e.calculation_name, e.project_address, e.client_name, e.company_name]
        .some(v => v?.toLowerCase().includes(q));
    });
  }, [estimates, statusFilter, search]);

  const columns: ColumnsType<PackEstimateSummary> = [
    {
      title: 'Estimate',
      key: 'name',
      ellipsis: true,
      render: (_, record) => <span className="ui-ink-link">{packEstimateTitle(record)}</span>,
    },
    {
      title: 'Client',
      key: 'client',
      width: 210,
      ellipsis: true,
      render: (_, record) => (
        record.client_name || record.company_name ? (
          <div style={{ minWidth: 0 }}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {record.client_name || <span className="pk-muted">No client</span>}
            </div>
            {record.company_name && (
              <span className="ui-cell-meta"><CompanyName id={record.company_id} name={record.company_name} /></span>
            )}
          </div>
        ) : <span className="ui-props-empty">Empty</span>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 116,
      render: (status: string | null) => <PackStatusPill status={status} />,
    },
    {
      title: 'Mode',
      dataIndex: 'mode',
      key: 'mode',
      width: 128,
      responsive: ['lg'],
      render: (mode: string | null) => <span className="pk-muted">{modeLabel(mode)}</span>,
    },
    {
      title: 'Rooms',
      dataIndex: 'total_rooms',
      key: 'rooms',
      width: 76,
      align: 'right',
      responsive: ['lg'],
      render: (v: number) => <span className="pk-money">{v || 0}</span>,
    },
    {
      title: 'Total',
      dataIndex: 'grand_total',
      key: 'total',
      width: 128,
      align: 'right',
      render: (v: number | null) => <span className="pk-money">{formatMoney(v)}</span>,
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 152,
      className: 'pk-col-after-money',
      render: (v: string | null) => <span className="pk-muted" style={{ whiteSpace: 'nowrap' }}>{v ? formatDateShort(v) : '-'}</span>,
    },
    {
      title: <span className="ui-sr-only">Actions</span>,
      key: 'actions',
      width: 48,
      align: 'center',
      render: (_, record) => (
        <Dropdown menu={rowMenu(record)} trigger={['click']}>
          <Button type="text" size="small" className="ui-icon-btn" icon={<MoreOutlined />} aria-label="Row actions" />
        </Dropdown>
      ),
    },
  ];

  // Phone row: status first, then the address, then client, money and date
  const renderMobileItem = (record: PackEstimateSummary) => (
    <div className="ui-row" onClick={() => openDetail(record)}>
      <div className="ui-row-body">
        <div className="ui-row-tags">
          <PackStatusPill status={record.status} />
        </div>
        <span className="ui-row-title">{packEstimateTitle(record)}</span>
        <div className="ui-row-meta">
          {record.company_name && <CompanyName id={record.company_id} name={record.company_name} />}
          {record.client_name && <span>{record.client_name}</span>}
        </div>
        <div className="ui-row-meta">
          <span className="pk-money" style={{ color: 'var(--color-neutral-900)' }}>{formatMoney(record.grand_total)}</span>
          <span>{record.total_rooms || 0} room{record.total_rooms === 1 ? '' : 's'}</span>
          <span>{modeLabel(record.mode)}</span>
          {record.created_at && <span>{formatDateShort(record.created_at)}</span>}
        </div>
      </div>
      <div onClick={e => e.stopPropagation()}>
        <Dropdown menu={rowMenu(record)} trigger={['click']}>
          <Button type="text" icon={<MoreOutlined />} aria-label="Row actions" style={{ marginRight: -8 }} />
        </Dropdown>
      </div>
    </div>
  );

  const emptyText = estimates.length === 0 ? (
    <div className="pk-list-empty">
      <p>No packing estimates yet</p>
      <Button type="primary" icon={<PlusOutlined />} onClick={handleNewEstimate}>
        Create First Estimate
      </Button>
    </div>
  ) : search.trim()
    ? `No estimates match "${search.trim()}"`
    : `No ${packStatusLabel(statusFilter).toLowerCase()} estimates`;

  return (
    <div className="pk-page">
      <PageHeader
        title="Packing Estimates"
        meta={loading && estimates.length === 0 ? undefined : (
          <span>
            {visibleEstimates.length} {visibleEstimates.length === 1 ? 'estimate' : 'estimates'}
            {statusFilter ? ` · ${packStatusLabel(statusFilter).toLowerCase()}` : ''}
          </span>
        )}
        actions={
          <>
            <Tooltip title="Refresh">
              <Button icon={<ReloadOutlined spin={loading} />} onClick={fetchEstimates} aria-label="Refresh" />
            </Tooltip>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleNewEstimate}>
              New Estimate
            </Button>
          </>
        }
      />

      <div className="ui-toolbar">
        <div className="ui-status-tabs pk-status-tabs" role="group" aria-label="Filter by status">
          <Button
            type="text"
            size="small"
            aria-pressed={!statusFilter}
            className={`ui-view-tab${!statusFilter ? ' is-selected' : ''}`}
            onClick={() => setStatusFilter(undefined)}
          >
            All
            <span className="ui-tab-count">{estimates.length}</span>
          </Button>
          {PACK_STATUSES.map(key => (
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
                style={{ background: tagTones[PACK_STATUS_TONES[key]].text }}
                aria-hidden="true"
              />
              {packStatusLabel(key)}
              <span className="ui-tab-count">{statusCounts[key] || 0}</span>
            </Button>
          ))}
        </div>
        <div className="ui-toolbar-end" style={isMobile ? { width: '100%' } : undefined}>
          <Input.Search
            placeholder="Search name, address, client..."
            allowClear
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: isMobile ? '100%' : 280 }}
            aria-label="Search estimates"
          />
        </div>
      </div>

      {isMobile ? (
        <List
          className="ui-row-list"
          dataSource={visibleEstimates}
          loading={loading}
          renderItem={renderMobileItem}
          locale={{ emptyText }}
          pagination={visibleEstimates.length > 20 ? { pageSize: 20, size: 'small', align: 'center' } : false}
        />
      ) : (
        <Table
          columns={columns}
          dataSource={visibleEstimates}
          rowKey="id"
          loading={loading}
          size="middle"
          scroll={{ x: 760 }}
          locale={{ emptyText }}
          onRow={(record) => ({
            onClick: (e) => {
              const target = e.target as HTMLElement;
              if (target.closest('a, button, .ant-dropdown-trigger, .ant-btn')) return;
              openDetail(record);
            },
            style: { cursor: 'pointer' },
          })}
          pagination={{ pageSize: 20, hideOnSinglePage: true, showTotal: t => `${t} estimates` }}
        />
      )}

      {/* Mode Selection Modal */}
      <Modal
        open={modeModalOpen}
        onCancel={() => setModeModalOpen(false)}
        footer={null}
        title="New Estimate"
        width={480}
        centered={!isMobile}
        {...sheetProps}
      >
        <p className="pk-mode-intro">Choose an estimation method to get started.</p>
        <div className="pk-mode-options">
          <button type="button" className="pk-mode-option" onClick={() => handleSelectMode('quick')}>
            <span className="pk-mode-icon" aria-hidden="true"><AppstoreOutlined /></span>
            <span className="pk-mode-text">
              <span className="pk-mode-title">Quick Estimate <Pill tone="green">Free</Pill></span>
              <span className="pk-mode-desc">Room presets with content hints. Fast and reliable.</span>
            </span>
            <RightOutlined className="pk-mode-chevron" aria-hidden="true" />
          </button>
          <button type="button" className="pk-mode-option" onClick={() => handleSelectMode('photo_ai')}>
            <span className="pk-mode-icon" aria-hidden="true"><CameraOutlined /></span>
            <span className="pk-mode-text">
              <span className="pk-mode-title">Photo AI <Pill tone="blue">Beta</Pill></span>
              <span className="pk-mode-desc">Upload room photos. AI detects items automatically.</span>
            </span>
            <RightOutlined className="pk-mode-chevron" aria-hidden="true" />
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default PackCalculatorNewList;
