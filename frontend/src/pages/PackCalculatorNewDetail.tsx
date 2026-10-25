/**
 * Pack Calculator New - Detail View Page
 * Shows detailed breakdown of packing estimates
 * Uses packing-estimate API (EstimateResponse structure)
 * Supports inline editing and re-analysis
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button, Table, message, Spin, Tabs, Empty, Input, Select, Tooltip, Collapse,
} from 'antd';
import {
  ArrowLeftOutlined, EditOutlined, DownloadOutlined, ReloadOutlined,
} from '@ant-design/icons';
import * as packingService from '../services/packingEstimateService';
import type {
  EstimateResponse, MaterialItem, SupplementItem,
} from '../types/packing-estimate';
import { formatDate } from '../utils/formatters';
import { PageHeader, Pill, PropertyList } from '../components/common/ui';
import type { PropertyItem } from '../components/common/ui';
import {
  PACK_STATUSES, PackStatusPill, packStatusLabel, CompanyName, ContaminationPill,
  EstimateBreakdown, Figures, estimateFigures, formatMoney, modeLabel,
  floorLabel, densityLabel, regionLabel,
} from '../components/packing-estimate/packingUi';

interface DetectedItem {
  name: string;
  category: string;
  quantity: number;
  is_fragile: boolean;
  is_high_value: boolean;
  needs_disassembly: boolean;
  packing_method?: string;
  estimated_labor_hours?: number;
  estimator_flags?: string[];
  special_instructions?: string;
}

interface RoomDetail {
  room_name: string;
  floor: string | null;
  density: string | null;
  contamination: string | null;
  items: DetectedItem[];
}

/** Extended detail response from GET /api/packing-estimate/{id} */
interface EstimateDetail extends EstimateResponse {
  calculation_name: string | null;
  project_address: string | null;
  client_id: string | null;
  client_name: string | null;
  company_id: string | null;
  company_name: string | null;
  mode: string | null;
  status: string | null;
  notes: string | null;
  region: string | null;
  include_packback: boolean;
  storage_months: number;
  special_items: string[];
  custom_special_items: any[];
  claim_id: string | null;
  rooms?: RoomDetail[];
}

/** Item flags carry handling state, so they are the only coloured marks in the room tables */
const ItemFlags: React.FC<{ item: DetectedItem }> = ({ item }) => (
  <>
    {item.is_fragile && <Pill tone="orange">Fragile</Pill>}
    {item.is_high_value && <Pill tone="yellow">High Value</Pill>}
    {item.needs_disassembly && <Pill tone="purple">Disassembly</Pill>}
  </>
);

const PackCalculatorNewDetail: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [estimate, setEstimate] = useState<EstimateDetail | null>(null);

  // Edit mode state
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // PDF export state
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (id) loadEstimate(id);
  }, [id]);

  const loadEstimate = async (estimateId: string) => {
    setLoading(true);
    try {
      const data = await packingService.getEstimate(estimateId);
      setEstimate(data);
    } catch {
      message.error('Failed to load estimate details');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    navigate('/reconstruction-estimate/pack-calculator-new/list');
  };

  // ── Edit ────────────────────────────────────

  const startEdit = useCallback(() => {
    if (!estimate) return;
    setEditName(estimate.calculation_name || '');
    setEditStatus(estimate.status || 'draft');
    setEditNotes(estimate.notes || '');
    setEditing(true);
  }, [estimate]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!id) return;
    setSaving(true);
    try {
      await packingService.updateEstimate(id, {
        calculation_name: editName,
        status: editStatus,
        notes: editNotes,
      });
      message.success('Saved successfully');
      setEditing(false);
      await loadEstimate(id);
    } catch {
      message.error('Failed to save changes');
    } finally {
      setSaving(false);
    }
  }, [id, editName, editStatus, editNotes]);

  // ── PDF Export ──────────────────────────────

  const handleDownload = useCallback(async () => {
    if (!id) return;
    setExporting(true);
    try {
      await packingService.exportPdf(id);
      message.success('PDF downloaded');
    } catch {
      message.error('Failed to export PDF');
    } finally {
      setExporting(false);
    }
  }, [id]);

  // ── Recalculate ─────────────────────────────

  const handleRecalculate = useCallback(() => {
    if (!id || !estimate) return;
    // Navigate to the create page with the estimate data loaded for re-analysis
    navigate('/reconstruction-estimate/pack-calculator-new', {
      state: {
        recalculateFrom: id,
        mode: estimate.mode,
        settings: {
          crew_size: estimate.crew_size,
          storage_months: estimate.storage_months,
          staging_type: estimate.staging_type,
          include_packback: estimate.include_packback,
          include_op: estimate.include_op,
          op_rate: estimate.op_rate,
          include_contingency: estimate.include_contingency,
          contingency_rate: estimate.contingency_rate,
          region: estimate.region,
          special_items: estimate.special_items || [],
          custom_special_items: estimate.custom_special_items || [],
        },
        calculationName: estimate.calculation_name,
        projectAddress: estimate.project_address,
        clientId: estimate.client_id,
        companyId: estimate.company_id,
        claimId: estimate.claim_id,
      },
    });
  }, [id, estimate, navigate]);

  // ── Loading / Empty ─────────────────────────

  if (loading) {
    return (
      <div className="pk-page-state">
        <Spin size="large" tip="Loading estimate details...">
          <div style={{ width: 200, height: 80 }} />
        </Spin>
      </div>
    );
  }

  if (!estimate) {
    return (
      <div className="pk-page-state">
        <Empty description="Estimate not found" image={Empty.PRESENTED_IMAGE_SIMPLE}>
          <Button type="primary" onClick={handleBack}>Back to List</Button>
        </Empty>
      </div>
    );
  }

  // ── Sections ────────────────────────────────

  const detailItems: PropertyItem[] = [
    ...(editing ? [{
      key: 'status',
      label: 'Status',
      value: (
        <Select
          value={editStatus}
          onChange={setEditStatus}
          style={{ width: '100%', maxWidth: 220 }}
          options={PACK_STATUSES.map(s => ({ value: s, label: packStatusLabel(s) }))}
        />
      ),
    }] : []),
    { key: 'client', label: 'Client', value: estimate.client_name },
    { key: 'company', label: 'Company', value: estimate.company_name && <CompanyName id={estimate.company_id} name={estimate.company_name} /> },
    { key: 'address', label: 'Project Address', value: estimate.project_address },
    { key: 'created', label: 'Created', value: estimate.created_at && formatDate(estimate.created_at) },
    { key: 'crew', label: 'Crew Size', value: estimate.crew_size },
    { key: 'region', label: 'Region', value: regionLabel(estimate.region), hideEmpty: true },
    { key: 'staging', label: 'Staging', value: estimate.staging_type === 'off_site' ? 'Off-site' : 'On-site' },
    { key: 'storage', label: 'Storage', value: estimate.storage_months > 0 ? `${estimate.storage_months} month${estimate.storage_months === 1 ? '' : 's'}` : 'None' },
    { key: 'packback', label: 'Pack-Back', value: estimate.include_packback ? 'Included' : 'Not included' },
    {
      key: 'notes',
      label: 'Notes',
      value: editing ? (
        <Input.TextArea
          value={editNotes}
          onChange={e => setEditNotes(e.target.value)}
          autoSize={{ minRows: 3, maxRows: 8 }}
          placeholder="Add notes..."
        />
      ) : estimate.notes,
    },
  ];

  const hasSections = Object.keys(estimate.section_details || {}).length > 0
    || Object.keys(estimate.sections || {}).length > 0;
  const breakdownTab = hasSections
    ? <EstimateBreakdown estimate={estimate} />
    : <Empty description="No section data available" image={Empty.PRESENTED_IMAGE_SIMPLE} />;

  const materialsTab = estimate.material_details && estimate.material_details.length > 0 ? (
    <Table
      className="pk-quiet-table"
      dataSource={estimate.material_details}
      rowKey={(record, i) => `mat-${record.code}-${i}`}
      pagination={false}
      size="small"
      scroll={{ x: 560 }}
      columns={[
        { title: 'Code', dataIndex: 'code', key: 'code', width: 80, render: (v: string) => <span className="pk-code">{v}</span> },
        { title: 'Name', dataIndex: 'name', key: 'name' },
        { title: 'Quantity', dataIndex: 'quantity', key: 'quantity', align: 'right' as const, width: 90, render: (v: number) => <span className="pk-money">{v}</span> },
        { title: 'Unit', dataIndex: 'unit', key: 'unit', width: 64, render: (v: string) => <span className="pk-muted">{v}</span> },
        { title: 'Unit Price', dataIndex: 'unit_price', key: 'unit_price', align: 'right' as const, width: 110, render: (v: number) => <span className="pk-money">{formatMoney(v)}</span> },
        { title: 'Total', dataIndex: 'total', key: 'total', align: 'right' as const, width: 120, render: (v: number) => <span className="pk-money">{formatMoney(v)}</span> },
      ]}
      summary={(rows) => (
        <Table.Summary.Row>
          <Table.Summary.Cell index={0} colSpan={5}><strong>Materials total</strong></Table.Summary.Cell>
          <Table.Summary.Cell index={5} align="right">
            <strong className="pk-money">{formatMoney((rows as readonly MaterialItem[]).reduce((s, r) => s + (r.total || 0), 0))}</strong>
          </Table.Summary.Cell>
        </Table.Summary.Row>
      )}
    />
  ) : estimate.materials && Object.keys(estimate.materials).length > 0 ? (
    <PropertyList
      items={Object.entries(estimate.materials).map(([code, qty]) => ({
        key: code, label: <span className="pk-code">{code}</span>, value: <span className="pk-money">{qty as number}</span>,
      }))}
    />
  ) : (
    <Empty description="No material data available" image={Empty.PRESENTED_IMAGE_SIMPLE} />
  );

  const roomsTab = estimate.rooms && estimate.rooms.length > 0 ? (
    <Collapse
      ghost
      className="ui-collapse-rows"
      defaultActiveKey={estimate.rooms.length <= 3 ? estimate.rooms.map((_, i) => String(i)) : undefined}
      items={estimate.rooms.map((room, i) => ({
        key: String(i),
        label: (
          <div className="pk-room-head">
            <span className="pk-room-title">
              {room.room_name}
              <ContaminationPill value={room.contamination} />
            </span>
            <span className="pk-room-meta">
              {[floorLabel(room.floor), densityLabel(room.density), `${room.items.length} item${room.items.length === 1 ? '' : 's'}`]
                .filter(Boolean).join(' · ')}
            </span>
          </div>
        ),
        children: room.items.length > 0 ? (
          <Table
            className="pk-quiet-table"
            dataSource={room.items}
            rowKey={(_, idx) => `item-${i}-${idx}`}
            pagination={false}
            size="small"
            scroll={{ x: 640 }}
            columns={[
              {
                title: 'Item', dataIndex: 'name', key: 'name',
                render: (name: string, record: DetectedItem) => (
                  <span className="pk-item-name">{name}<ItemFlags item={record} /></span>
                ),
              },
              { title: 'Category', dataIndex: 'category', key: 'category', width: 120, render: (v: string) => <span className="pk-muted">{v}</span> },
              { title: 'Qty', dataIndex: 'quantity', key: 'quantity', width: 60, align: 'right' as const, render: (v: number) => <span className="pk-money">{v}</span> },
              {
                title: 'Labor (hrs)', dataIndex: 'estimated_labor_hours', key: 'labor', width: 96, align: 'right' as const,
                render: (v: number | null) => (v ? <span className="pk-money">{v.toFixed(2)}</span> : <span className="pk-muted">-</span>),
              },
              {
                title: 'Packing Method', dataIndex: 'packing_method', key: 'method', ellipsis: true,
                render: (v: string | null) => <span className="pk-muted">{v || '-'}</span>,
              },
            ]}
          />
        ) : (
          <p className="pk-empty-line">No items detected</p>
        ),
      }))}
    />
  ) : estimate.room_summaries && estimate.room_summaries.length > 0 ? (
    /* Fallback: Quick Estimate room summaries */
    <Collapse
      ghost
      className="ui-collapse-rows"
      items={estimate.room_summaries.map((room, i) => ({
        key: String(i),
        label: (
          <div className="pk-room-head">
            <span className="pk-room-title">{room.room_name}</span>
            <span className="pk-room-meta">{room.item_count} items</span>
          </div>
        ),
        children: (
          <PropertyList
            labelWidth={140}
            items={[
              { key: 'notable', label: 'Notable Items', value: room.notable_items.join(', '), hideEmpty: true },
              { key: 'high', label: 'High Value Items', value: room.high_value_items.join(', '), hideEmpty: true },
              { key: 'categories', label: 'Categories', value: room.categories_present.join(', '), hideEmpty: true },
              {
                key: 'notes', label: 'Packing Notes', hideEmpty: true,
                value: room.packing_notes.length > 0 && (
                  <ul className="pk-notes">{room.packing_notes.map((note, j) => <li key={j}>{note}</li>)}</ul>
                ),
              },
            ]}
          />
        ),
      }))}
    />
  ) : (
    <Empty description="No room data available" image={Empty.PRESENTED_IMAGE_SIMPLE} />
  );

  const hasSupplements = (estimate.supplements && estimate.supplements.length > 0)
    || (estimate.special_items && estimate.special_items.length > 0);

  const supplementsTab = (
    <>
      {estimate.supplements && estimate.supplements.length > 0 && (
        <Table
          className="pk-quiet-table"
          dataSource={estimate.supplements}
          rowKey={(record) => record.key}
          pagination={false}
          size="small"
          scroll={{ x: 520 }}
          columns={[
            {
              title: 'Supplement', dataIndex: 'name', key: 'name',
              render: (name: string, record: SupplementItem) => (
                <div>
                  <span>{name}</span>
                  {record.description && <span className="ui-cell-meta">{record.description}</span>}
                </div>
              ),
            },
            {
              title: 'Status', key: 'status', width: 110,
              render: (_: any, record: SupplementItem) => (
                record.enabled ? <Pill tone="green">Enabled</Pill> : <Pill tone="gray">Disabled</Pill>
              ),
            },
            {
              title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right' as const, width: 120,
              render: (v: number, record: SupplementItem) => (
                record.enabled ? <span className="pk-money">{formatMoney(v)}</span> : <span className="pk-muted">-</span>
              ),
            },
          ]}
        />
      )}
      {estimate.special_items && estimate.special_items.length > 0 && (
        <section className="ui-section">
          <div className="ui-section-head"><h3 className="ui-section-title">Special Items</h3></div>
          <p className="pk-plain-list">{estimate.special_items.join(', ')}</p>
        </section>
      )}
    </>
  );

  return (
    <div className="pk-page pk-detail">
      <PageHeader
        leading={
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={handleBack} aria-label="Back to packing estimates" />
        }
        title={editing ? (
          <Input
            value={editName}
            onChange={e => setEditName(e.target.value)}
            className="pk-title-input"
            placeholder="Estimate Name"
            aria-label="Estimate name"
            autoFocus
          />
        ) : (estimate.calculation_name || 'Untitled')}
        meta={
          <>
            <PackStatusPill status={editing ? editStatus : estimate.status} />
            <span>{modeLabel(estimate.mode)}</span>
            {estimate.created_at && <span>Created {formatDate(estimate.created_at)}</span>}
          </>
        }
        actions={editing ? (
          <>
            <Button onClick={cancelEdit} disabled={saving}>Cancel</Button>
            <Button type="primary" onClick={handleSave} loading={saving}>Save</Button>
          </>
        ) : (
          <>
            <Button icon={<EditOutlined />} onClick={startEdit}>Edit</Button>
            <Tooltip title="Re-estimate with current settings">
              <Button icon={<ReloadOutlined />} onClick={handleRecalculate}>Recalculate</Button>
            </Tooltip>
            <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownload} loading={exporting}>
              Export PDF
            </Button>
          </>
        )}
      />

      <div className="pk-detail-grid">
        <Figures items={estimateFigures(estimate)} className="pk-detail-figures" />
        <div className="pk-detail-main">
          <Tabs
            defaultActiveKey="sections"
            items={[
              { key: 'sections', label: 'Estimate Breakdown', children: breakdownTab },
              { key: 'materials', label: 'Materials', children: materialsTab },
              { key: 'rooms', label: 'Rooms', children: roomsTab },
              ...(hasSupplements ? [{ key: 'supplements', label: 'Supplements', children: supplementsTab }] : []),
            ]}
          />
        </div>
        <aside className="pk-detail-side" aria-label="Estimate details">
          <section className="ui-section">
            <div className="ui-section-head"><h2 className="ui-section-title">Details</h2></div>
            <PropertyList items={detailItems} labelWidth={124} />
          </section>
        </aside>
      </div>
    </div>
  );
};

export default PackCalculatorNewDetail;
