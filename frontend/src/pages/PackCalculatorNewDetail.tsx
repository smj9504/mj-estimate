/**
 * Pack Calculator New - Detail View Page
 * Shows detailed breakdown of packing estimates
 * Uses packing-estimate API (EstimateResponse structure)
 * Supports inline editing and re-analysis
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { returnToOf } from '../utils/returnTo';
import {
  Button, Table, message, Spin, Tabs, Empty, Input, InputNumber, Select, Switch, Tooltip, Collapse,
} from 'antd';
import {
  ArrowLeftOutlined, EditOutlined, DownloadOutlined, ReloadOutlined, FileTextOutlined,
} from '@ant-design/icons';
import * as packingService from '../services/packingEstimateService';
import PackingReportModal from '../components/packing-estimate/PackingReportModal';
import { companyService } from '../services/companyService';
import type { Company } from '../types';
import type {
  EstimateResponse, MaterialDisplay, MaterialItem, SupplementItem,
} from '../types/packing-estimate';
import { MATERIAL_DISPLAY_OPTIONS } from '../components/packing-estimate/constants';
import { formatDate } from '../utils/formatters';
import { PageHeader, Pill, PropertyList } from '../components/common/ui';
import type { PropertyItem } from '../components/common/ui';
import {
  PACK_STATUSES, PackStatusPill, packStatusLabel, CompanyName, ContaminationPill,
  EstimateBreakdown, Figures, estimateFigures, formatMoney, modeLabel,
  floorLabel, densityLabel, regionLabel, packEstimateTitle,
  itemSizeLabel, itemWeightLabel, packingMethodLabel, materialDisplayLabel, groupMaterials,
} from '../components/packing-estimate/packingUi';

interface DetectedItem {
  name: string;
  category: string;
  quantity: number;
  is_fragile: boolean;
  is_high_value: boolean;
  needs_disassembly: boolean;
  size?: string | null;
  weight?: string | null;
  packing_method?: string;
  packing_locked?: boolean;
  estimated_labor_hours?: number;
  estimator_flags?: string[];
  uncertain_fields?: string[];
  special_instructions?: string;
}

interface RoomDetail {
  room_name: string;
  floor: string | null;
  density: string | null;
  contamination: string | null;
  preset_key?: string | null;
  /** The file ids of the photos saved with the room */
  photos?: string[];
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
    {(item.uncertain_fields?.length ?? 0) > 0 && (
      <Pill tone="yellow" title={`Priced on the AI's answer: ${item.uncertain_fields?.join(', ')}`}>Not reviewed</Pill>
    )}
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
  const [editStatus, setEditStatus] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editMaterialDisplay, setEditMaterialDisplay] = useState<MaterialDisplay>('itemized');
  // Each saved supplement on or off, at its amount
  const [editSupplements, setEditSupplements] = useState<Record<string, { enabled: boolean; amount: number }>>({});
  const [editCompanyId, setEditCompanyId] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);

  // PDF export state
  const [exporting, setExporting] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

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

  // Opened from a client: Back goes to it, here and from a recalculation
  const returnTo = returnToOf(useLocation().state);
  const handleBack = () => {
    navigate(returnTo ?? '/reconstruction-estimate/pack-calculator-new/list');
  };

  // ── Edit ────────────────────────────────────

  const startEdit = useCallback(() => {
    if (!estimate) return;
    setEditStatus(estimate.status || 'draft');
    setEditNotes(estimate.notes || '');
    setEditMaterialDisplay(estimate.material_display || 'itemized');
    setEditSupplements(Object.fromEntries((estimate.supplements || []).map(sup => [
      sup.key, { enabled: sup.enabled, amount: sup.amount },
    ])));
    setEditCompanyId(estimate.company_id);
    setEditing(true);
    companyService.getCompanies().then(setCompanies).catch(() => {});
  }, [estimate]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  const supplementsChanged = (estimate?.supplements || []).some(sup => {
    const edit = editSupplements[sup.key];
    return !!edit && (edit.enabled !== sup.enabled || edit.amount !== sup.amount);
  });

  const handleSave = useCallback(async () => {
    if (!id) return;
    setSaving(true);
    try {
      await packingService.updateEstimate(id, {
        status: editStatus,
        notes: editNotes,
        company_id: editCompanyId,
        // Its Materials lines are made again on the server; the total stays
        ...(editMaterialDisplay !== (estimate?.material_display || 'itemized')
          ? { material_display: editMaterialDisplay }
          : {}),
        // The server works out the supplements total and the grand total again
        ...(supplementsChanged
          ? { supplements: Object.entries(editSupplements).map(([key, v]) => ({ key, ...v })) }
          : {}),
      });
      message.success('Saved successfully');
      setEditing(false);
      await loadEstimate(id);
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }, [id, editStatus, editNotes, editCompanyId, editMaterialDisplay, estimate?.material_display, editSupplements, supplementsChanged]);

  // ── PDF Export ──────────────────────────────

  const handleDownload = useCallback(async () => {
    if (!id) return;
    setExporting(true);
    try {
      await packingService.exportPdf(id);
      message.success('PDF downloaded');
    } catch (err) {
      message.error((await packingService.downloadErrorDetail(err)) || 'Failed to export PDF');
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
          material_display: estimate.material_display || 'itemized',
          // The ones the estimator added; older estimates added theirs on their own
          supplement_choices: Object.fromEntries((estimate.supplements || [])
            .filter(sup => sup.chosen && sup.enabled)
            .map(sup => [sup.key, sup.amount])),
        },
        projectAddress: estimate.project_address,
        clientId: estimate.client_id,
        companyId: estimate.company_id,
        claimId: estimate.claim_id,
        calculationName: estimate.calculation_name,
        rooms: estimate.mode === 'photo_ai' ? estimate.rooms : undefined,
        returnTo,
      },
    });
  }, [id, estimate, navigate, returnTo]);

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

  // Its current company has a name to show before the list arrives
  const companyOptions = companies.map(c => ({ value: c.id, label: c.name }));
  if (estimate.company_id && !companies.some(c => c.id === estimate.company_id)) {
    companyOptions.unshift({ value: estimate.company_id, label: estimate.company_name || '' });
  }

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
    {
      key: 'company',
      label: 'Company',
      value: editing ? (
        <>
          <Select
            value={editCompanyId || undefined}
            onChange={setEditCompanyId}
            placeholder="Select company"
            showSearch
            optionFilterProp="label"
            options={companyOptions}
            style={{ width: '100%', maxWidth: 220 }}
            aria-label="Company"
          />
          {editCompanyId !== estimate.company_id && (
            <span className="ui-cell-meta">The amounts stay as they are. Recalculate to use this company&apos;s prices.</span>
          )}
        </>
      ) : estimate.company_name && <CompanyName id={estimate.company_id} name={estimate.company_name} />,
    },
    { key: 'address', label: 'Project Address', value: estimate.project_address },
    { key: 'created', label: 'Created', value: estimate.created_at && formatDate(estimate.created_at) },
    { key: 'crew', label: 'Crew Size', value: estimate.crew_size },
    { key: 'region', label: 'Region', value: regionLabel(estimate.region), hideEmpty: true },
    { key: 'staging', label: 'Staging', value: estimate.staging_type === 'off_site' ? 'Off-site' : 'On-site' },
    { key: 'storage', label: 'Storage', value: estimate.storage_months > 0 ? `${estimate.storage_months} month${estimate.storage_months === 1 ? '' : 's'}` : 'None' },
    { key: 'packback', label: 'Pack-Back', value: estimate.include_packback ? 'Included' : 'Not included' },
    {
      key: 'materials',
      label: 'Materials',
      value: editing ? (
        <Select
          value={editMaterialDisplay}
          onChange={setEditMaterialDisplay}
          style={{ width: '100%', maxWidth: 220 }}
          options={MATERIAL_DISPLAY_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
          aria-label="How materials show on the estimate and its PDF"
        />
      ) : materialDisplayLabel(estimate.material_display),
    },
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

  const materialTable = (rows: MaterialItem[], totalLabel: string) => (
    <Table
      className="pk-quiet-table"
      dataSource={rows}
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
      summary={(shown) => (
        <Table.Summary.Row>
          <Table.Summary.Cell index={0} colSpan={5}><strong>{totalLabel}</strong></Table.Summary.Cell>
          <Table.Summary.Cell index={5} align="right">
            <strong className="pk-money">{formatMoney((shown as readonly MaterialItem[]).reduce((s, r) => s + (r.total || 0), 0))}</strong>
          </Table.Summary.Cell>
        </Table.Summary.Row>
      )}
    />
  );

  // Grouped on the estimate: each lump with the materials it holds, so the office sees the counts
  const materialsTab = estimate.material_details && estimate.material_details.length > 0 ? (
    estimate.material_display === 'grouped' ? (
      <div className="pk-material-groups">
        {groupMaterials(estimate.material_details).map(([group, rows]) => (
          <section className="pk-material-group" key={group} aria-label={group}>
            {materialTable(rows, group)}
          </section>
        ))}
      </div>
    ) : materialTable(estimate.material_details, 'Materials total')
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
            scroll={{ x: 800 }}
            columns={[
              {
                title: 'Item', dataIndex: 'name', key: 'name',
                render: (name: string, record: DetectedItem) => (
                  <span className="pk-item-name">{name}<ItemFlags item={record} /></span>
                ),
              },
              { title: 'Category', dataIndex: 'category', key: 'category', width: 120, render: (v: string) => <span className="pk-muted">{v}</span> },
              { title: 'Size', dataIndex: 'size', key: 'size', width: 80, render: (v: string | null) => <span className="pk-muted">{itemSizeLabel(v) || '-'}</span> },
              { title: 'Weight', dataIndex: 'weight', key: 'weight', width: 90, render: (v: string | null) => <span className="pk-muted">{itemWeightLabel(v) || '-'}</span> },
              { title: 'Qty', dataIndex: 'quantity', key: 'quantity', width: 60, align: 'right' as const, render: (v: number) => <span className="pk-money">{v}</span> },
              {
                title: 'Labor (hrs)', dataIndex: 'estimated_labor_hours', key: 'labor', width: 96, align: 'right' as const,
                render: (v: number | null) => (v ? <span className="pk-money">{v.toFixed(2)}</span> : <span className="pk-muted">-</span>),
              },
              {
                title: 'Packing Method', dataIndex: 'packing_method', key: 'method', ellipsis: true,
                render: (v: string | null) => <span className="pk-muted">{packingMethodLabel(v) || '-'}</span>,
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
                  {/* What in this job it's for, as the PDF prints it */}
                  {(record.reason || record.description) && (
                    <span className="ui-cell-meta">{record.reason || record.description}</span>
                  )}
                  {!record.chosen && (
                    <span className="ui-cell-meta">Added on its own before supplements were chosen by hand</span>
                  )}
                </div>
              ),
            },
            {
              title: 'Charged', key: 'status', width: 110,
              render: (_: any, record: SupplementItem) => (
                editing ? (
                  <Switch
                    size="small"
                    checked={editSupplements[record.key]?.enabled ?? record.enabled}
                    onChange={on => setEditSupplements(prev => ({
                      ...prev, [record.key]: { amount: prev[record.key]?.amount ?? record.amount, enabled: on },
                    }))}
                    aria-label={`Charge ${record.name}`}
                  />
                ) : record.enabled ? <Pill tone="green">Charged</Pill> : <Pill tone="gray">Off</Pill>
              ),
            },
            {
              title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right' as const, width: 132,
              render: (v: number, record: SupplementItem) => (
                editing ? (
                  <InputNumber
                    size="small"
                    min={0}
                    step={5}
                    precision={2}
                    prefix="$"
                    value={editSupplements[record.key]?.amount ?? v}
                    onChange={amount => setEditSupplements(prev => ({
                      ...prev, [record.key]: { enabled: prev[record.key]?.enabled ?? record.enabled, amount: amount ?? 0 },
                    }))}
                    aria-label={`${record.name} amount`}
                    style={{ width: 112 }}
                  />
                ) : record.enabled ? <span className="pk-money">{formatMoney(v)}</span> : <span className="pk-muted">-</span>
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
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={handleBack} aria-label={returnTo ? 'Back to the client' : 'Back to packing estimates'} />
        }
        title={packEstimateTitle(estimate)}
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
            <Tooltip title="The contents list, room photos, or both">
              <Button icon={<FileTextOutlined />} onClick={() => setReportOpen(true)}>Report</Button>
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

      {id && <PackingReportModal open={reportOpen} onClose={() => setReportOpen(false)} estimateId={id} />}
    </div>
  );
};

export default PackCalculatorNewDetail;
