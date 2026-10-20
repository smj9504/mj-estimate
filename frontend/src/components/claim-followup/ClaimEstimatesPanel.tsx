/**
 * ClaimEstimatesPanel — every estimate on a claim in one place: the carrier's
 * estimate versions (with their section breakdown, editable in place), a WM
 * amount recorded without a PDF, and our supplement estimates by status.
 * Used by the follow-up list drawers and the claim follow-up page.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button, Col, Input, InputNumber, message, Popconfirm, Row, Select, Skeleton, Tooltip, Upload,
} from 'antd';
import {
  DeleteOutlined, EditOutlined, FilePdfOutlined, PlusOutlined, UploadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { claimFollowUpService } from '../../services/claimFollowUpService';
import { supplementService } from '../../services/supplementService';
import { fileService } from '../../services/fileService';
import { withPdfUploadLock } from '../../utils/pdfUploadLock';
import { Pill, type TagTone } from '../common/ui';
import {
  BID_TYPE_LABELS, SUPPLEMENT_STATUSES, SupplementStatusPill, formatCurrency,
} from '../supplement/supplementUi';

// ── Estimate Category Configuration ──
// Add new estimate types here. Everything else adapts automatically.
export const ESTIMATE_CATEGORIES: Record<string, {
  label: string;
  tone: TagTone;
  fileLabel: string;       // Used in PDF filenames: {address}-{fileLabel}-v1.pdf
  sectionKeywords: string[]; // Keywords to auto-detect sections in this category
}> = {
  combined:          { label: 'Combined',          tone: 'brown',  fileLabel: 'Insurance-Estimate',        sectionKeywords: [] },
  reconstruction:    { label: 'Reconstruction',    tone: 'purple', fileLabel: 'Reconstruction-Estimate',   sectionKeywords: ['dwelling', 'water damage', 'rebuild', 'reconstruction', 'drywall', 'flooring', 'paint', 'cabinet', 'plumb', 'electrical', 'code', 'upgrade', 'coverage a'] },
  water_mitigation:  { label: 'Water Mitigation',  tone: 'blue',   fileLabel: 'WM-Estimate',              sectionKeywords: ['water mitigation', 'emergency service', 'dry out', 'drying', 'dehumidifier', 'extraction'] },
  mold_remediation:  { label: 'Mold Remediation',  tone: 'orange', fileLabel: 'Mold-Estimate',           sectionKeywords: ['mold', 'remediation', 'fungi', 'microbial'] },
};

const ESTIMATE_CATEGORY_OPTIONS = Object.entries(ESTIMATE_CATEGORIES).map(([value, cfg]) => ({
  value,
  label: cfg.label,
}));

const getEstimateCategoryConfig = (category: string | null | undefined) =>
  (category && ESTIMATE_CATEGORIES[category]) || null;

const REVISION_TYPE_LABELS: Record<string, string> = {
  initial: 'Initial',
  supplement: 'Supplement',
  re_inspection: 'Re-inspection',
};

/** Sections grouped under their category; the dot carries the category tone */
const SECTION_GROUPS: { key: string; label: string; tone: TagTone }[] = [
  ...Object.entries(ESTIMATE_CATEGORIES)
    .filter(([k]) => k !== 'combined')
    .map(([key, cfg]) => ({ key, label: cfg.label, tone: cfg.tone })),
  { key: 'other', label: 'Other', tone: 'gray' },
];

// Auto-categorize sections by matching keywords from ESTIMATE_CATEGORIES config
const categorizeSection = (name: string): string => {
  const lower = name.toLowerCase();
  for (const [key, cfg] of Object.entries(ESTIMATE_CATEGORIES)) {
    if (key === 'combined') continue; // skip combined — it's not a section type
    if (cfg.sectionKeywords.some(kw => lower.includes(kw))) return key;
  }
  return 'other';
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const ClaimEstimatesPanel: React.FC<{ claimId: string }> = ({ claimId }) => {
  const navigate = useNavigate();
  const [estimates, setEstimates] = useState<any[]>([]);
  const [supplements, setSupplements] = useState<any[]>([]);
  const [bidItems, setBidItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [editReplacePdf, setEditReplacePdf] = useState<File | undefined>();
  const [editParsing, setEditParsing] = useState(false);

  const loadData = async () => {
    try {
      const [estData, supData] = await Promise.all([
        supplementService.listInsuranceEstimates(claimId).catch(() => []),
        supplementService.getByClaim(claimId).catch(() => []),
      ]);
      setEstimates(estData);
      setSupplements(supData);
      const allBidItems = supData.flatMap((s: any) => (s.bid_items || []).map((b: any) => ({
        ...b, supplement_title: s.title,
      })));
      setBidItems(allBidItems);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimId]);

  const startEdit = (ver: any) => {
    setEditingId(ver.id);
    setEditReplacePdf(undefined);
    setEditValues({
      rcv_amount: ver.rcv_amount || 0,
      acv_amount: ver.acv_amount || 0,
      depreciation_amount: ver.depreciation_amount || 0,
      deductible: ver.deductible || 0,
      estimate_category: ver.estimate_category || null,
      sections_data: ver.sections_data ? JSON.parse(JSON.stringify(ver.sections_data)) : [],
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues({});
    setEditReplacePdf(undefined);
  };

  const saveEdit = async (ver: any) => {
    setSaving(true);
    try {
      // If PDF replaced, upload file first then replace on negotiation.
      // Locked as one step so the screen stays blocked between the two calls.
      if (editReplacePdf) {
        await withPdfUploadLock(async () => {
          const uploaded = await fileService.uploadFiles(
            [editReplacePdf], 'negotiation', ver.id, 'estimate', 'Insurance estimate PDF'
          );
          if (uploaded?.[0]?.id) {
            await supplementService.replaceInsuranceEstimatePdf(claimId, ver.id, uploaded[0].id);
          }
        });
      }
      await supplementService.updateInsuranceEstimate(claimId, ver.id, editValues);
      message.success('Estimate updated');
      setEditingId(null);
      setEditValues({});
      setEditReplacePdf(undefined);
      setLoading(true);
      await loadData();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  // ACV = RCV - DEP (deductible is separate, not subtracted from ACV)
  const withTotals = (sections: any[]) => {
    const totalRcv = sections.reduce((s: number, sec: any) => s + (sec.rcv || 0), 0);
    const totalDep = sections.reduce((s: number, sec: any) => s + (sec.depreciation || 0), 0);
    return {
      sections_data: sections,
      rcv_amount: round2(totalRcv),
      acv_amount: round2(totalRcv - totalDep),
      depreciation_amount: round2(totalDep),
    };
  };

  const addEditSection = () => {
    const sections = [...(editValues.sections_data || []), { section_name: '', rcv: 0, depreciation: 0, net_acv: 0 }];
    setEditValues({ ...editValues, sections_data: sections });
  };

  const removeEditSection = (idx: number) => {
    const sections = (editValues.sections_data || []).filter((_: any, i: number) => i !== idx);
    setEditValues({ ...editValues, ...withTotals(sections) });
  };

  const updateEditSection = (idx: number, field: string, value: any) => {
    const sections = [...(editValues.sections_data || [])];
    sections[idx] = { ...sections[idx], [field]: value };
    if (field === 'rcv' || field === 'depreciation') {
      const rcv = field === 'rcv' ? (value || 0) : (sections[idx].rcv || 0);
      const dep = field === 'depreciation' ? (value || 0) : (sections[idx].depreciation || 0);
      sections[idx].net_acv = round2(rcv - dep);
    }
    setEditValues({ ...editValues, ...withTotals(sections) });
  };

  const handleDelete = async (ver: any) => {
    try {
      await supplementService.deleteInsuranceEstimate(claimId, ver.id);
      message.success('Estimate deleted');
      setLoading(true);
      await loadData();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to delete');
    }
  };

  const handleReplacePdf = async (file: File) => {
    setEditReplacePdf(file);
    if (!file.name.toLowerCase().endsWith('.pdf')) return;
    setEditParsing(true);
    try {
      const result = await claimFollowUpService.parseEstimatePdf(file);
      if (result.sections?.length) {
        const sections = result.sections;
        setEditValues((prev: any) => ({
          ...prev,
          ...withTotals(sections),
          deductible: result.totals?.deductible || prev.deductible || 0,
        }));
        message.success(`Parsed ${sections.length} sections`);
      }
    } catch {
      message.warning('PDF parsing failed. Edit amounts manually.');
    } finally {
      setEditParsing(false);
    }
  };

  if (loading) {
    return <Skeleton active title={false} paragraph={{ rows: 4 }} style={{ padding: '8px 0' }} />;
  }

  const hasEstimates = estimates.length > 0;
  const hasSupplements = supplements.length > 0;
  const hasBidItems = bidItems.filter((b: any) => b.custom_document_file_id).length > 0;

  // Check for WM data on claim but no WM negotiation record
  const hasWmNegotiation = estimates.some((e: any) => e.estimate_category === 'water_mitigation');
  const claimWmStatus = hasEstimates ? (estimates[0] as any).claim_wm_cost_status : null;
  const claimWmAmount = hasEstimates ? (estimates[0] as any).claim_wm_estimate_amount : 0;
  const showWmFallback = !hasWmNegotiation && claimWmStatus === 'separate_estimate' && claimWmAmount > 0;

  if (!hasEstimates && !hasSupplements && !hasBidItems && !showWmFallback) {
    return <p className="fu-empty">No estimate documents uploaded yet.</p>;
  }

  // "Latest" marks the newest version within each category
  const seenCategories = new Set<string>();

  const renderFigures = (ver: any) => (
    <dl className="fu-figures">
      <div className="fu-figure">
        <dt>RCV</dt>
        <dd className="fu-money fu-money--strong">{formatCurrency(ver.rcv_amount)}</dd>
      </div>
      <div className="fu-figure">
        <dt>ACV</dt>
        <dd className="fu-money fu-money--strong">{formatCurrency(ver.acv_amount)}</dd>
      </div>
      <div className="fu-figure">
        <dt>Depreciation</dt>
        <dd className="fu-money">{formatCurrency(ver.depreciation_amount)}</dd>
      </div>
      <div className="fu-figure">
        <dt>Deductible</dt>
        <dd className="fu-money">{ver.deductible > 0 ? formatCurrency(ver.deductible) : '—'}</dd>
      </div>
    </dl>
  );

  const renderEditFigures = () => (
    <>
      <Row gutter={[12, 8]} className="fu-edit-grid">
        {([
          ['rcv_amount', 'RCV'],
          ['acv_amount', 'ACV'],
          ['depreciation_amount', 'Depreciation'],
          ['deductible', 'Deductible'],
        ] as const).map(([field, label]) => (
          <Col xs={12} sm={6} key={field}>
            <label className="fu-field">
              <span className="fu-field-label">{label}</span>
              <InputNumber
                min={0} step={0.01} prefix="$" style={{ width: '100%' }}
                value={editValues[field]}
                onChange={v => {
                  if (field === 'deductible') {
                    const rcv = editValues.rcv_amount || 0;
                    const dep = editValues.depreciation_amount || 0;
                    setEditValues({ ...editValues, deductible: v || 0, acv_amount: round2(rcv - dep) });
                  } else {
                    setEditValues({ ...editValues, [field]: v || 0 });
                  }
                }}
              />
            </label>
          </Col>
        ))}
      </Row>
      <Row gutter={[12, 8]} className="fu-edit-grid">
        <Col xs={24} sm={12}>
          <div className="fu-field">
            <span className="fu-field-label">Replace PDF</span>
            <Upload
              maxCount={1}
              accept=".pdf"
              beforeUpload={(file) => { handleReplacePdf(file); return false; }}
              onRemove={() => setEditReplacePdf(undefined)}
              fileList={editReplacePdf ? [{ uid: '-1', name: editReplacePdf.name, status: 'done' as const }] : []}
            >
              <Button icon={<UploadOutlined />} loading={editParsing}>
                {editParsing ? 'Parsing...' : 'Upload PDF'}
              </Button>
            </Upload>
          </div>
        </Col>
        <Col xs={24} sm={12}>
          <label className="fu-field">
            <span className="fu-field-label">Category</span>
            <Select
              style={{ width: '100%' }}
              value={editValues.estimate_category}
              onChange={v => setEditValues({ ...editValues, estimate_category: v })}
              allowClear
              placeholder="Select..."
              options={ESTIMATE_CATEGORY_OPTIONS}
            />
          </label>
        </Col>
      </Row>
    </>
  );

  const renderSections = (ver: any, isEditing: boolean) => {
    const displaySections: any[] = isEditing ? (editValues.sections_data || []) : (ver.sections_data || []);
    if (displaySections.length === 0 && !isEditing) return null;

    const grouped: Record<string, { items: any[]; indices: number[] }> = {};
    displaySections.forEach((s: any, sIdx: number) => {
      const cat = categorizeSection(s.section_name || '');
      if (!grouped[cat]) grouped[cat] = { items: [], indices: [] };
      grouped[cat].items.push(s);
      grouped[cat].indices.push(sIdx);
    });

    return (
      <div className="fu-sections">
        {SECTION_GROUPS.map(({ key, label, tone }) => {
          const group = grouped[key];
          if (!group || group.items.length === 0) return null;
          const catRcv = group.items.reduce((sum: number, s: any) => sum + (s.rcv || 0), 0);
          const catAcv = group.items.reduce((sum: number, s: any) => sum + (s.net_acv || 0), 0);
          return (
            <div key={key} className="fu-section-group">
              <div className="fu-section-head">
                <span className="fu-section-name">
                  <span className="fu-dot" style={{ background: `var(--tag-${tone}-text)` }} aria-hidden="true" />
                  {label}
                </span>
                <span className="fu-section-nums">
                  RCV {formatCurrency(catRcv)} · ACV {formatCurrency(catAcv)}
                </span>
              </div>
              {group.items.map((s: any, sIdx: number) => {
                const globalIdx = group.indices[sIdx];
                return isEditing ? (
                  <div key={globalIdx} className="fu-section-edit">
                    <Input
                      value={s.section_name}
                      placeholder="Section name"
                      aria-label="Section name"
                      onChange={e => updateEditSection(globalIdx, 'section_name', e.target.value)}
                    />
                    <InputNumber
                      min={0} step={0.01} prefix="$" placeholder="RCV" aria-label="RCV"
                      value={s.rcv} onChange={v => updateEditSection(globalIdx, 'rcv', v || 0)}
                    />
                    <InputNumber
                      min={0} step={0.01} prefix="$" placeholder="Dep" aria-label="Depreciation"
                      value={s.depreciation} onChange={v => updateEditSection(globalIdx, 'depreciation', v || 0)}
                    />
                    <Tooltip title="Remove section">
                      <Button
                        type="text" className="ui-icon-btn ui-icon-btn--danger" icon={<DeleteOutlined />}
                        aria-label="Remove section"
                        onClick={() => removeEditSection(globalIdx)}
                      />
                    </Tooltip>
                  </div>
                ) : (
                  <div key={globalIdx} className="fu-section-row">
                    <span>{s.section_name || 'Untitled section'}</span>
                    <span className="fu-section-nums">
                      {formatCurrency(s.rcv)}
                      {(s.depreciation || 0) > 0 && ` · dep ${formatCurrency(s.depreciation)}`}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
        {isEditing && (
          <Button type="dashed" icon={<PlusOutlined />} onClick={addEditSection} block>
            Add section
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className="fu-panel">
      {/* Insurance company estimates */}
      {hasEstimates && (
        <section className="fu-block">
          <h3 className="fu-block-title">
            Insurance company estimates
            <span className="fu-count">{estimates.length}</span>
          </h3>
          {estimates.map((ver: any) => {
            const verCat = ver.estimate_category || '_none';
            const isLatestInCategory = !seenCategories.has(verCat);
            seenCategories.add(verCat);
            const isEditing = editingId === ver.id;
            const categoryCfg = getEstimateCategoryConfig(ver.estimate_category);
            const revisionLabel = ver.revision_type
              ? (REVISION_TYPE_LABELS[ver.revision_type] || ver.revision_type.replace(/_/g, ' '))
              : null;

            return (
              <article key={ver.id} className={`fu-version${isEditing ? ' is-editing' : ''}`}>
                <div className="fu-version-head">
                  <div className="fu-version-title">
                    <span className="fu-version-rev">Rev #{ver.revision_number}</span>
                    {revisionLabel && <span>{revisionLabel}</span>}
                    {categoryCfg && <span>{categoryCfg.label}</span>}
                    {isLatestInCategory && <Pill tone="blue">Latest</Pill>}
                  </div>
                  <div className="fu-version-actions">
                    {ver.file_download_id && (
                      <a
                        className="fu-file-chip"
                        href={`${fileService.getDownloadUrl(ver.file_download_id)}?inline=true`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={ver.document_name || 'View PDF'}
                      >
                        <FilePdfOutlined className="fu-pdf-icon" />
                        <span>{ver.document_name || 'PDF'}</span>
                      </a>
                    )}
                    {isEditing ? (
                      <>
                        <Button type="primary" loading={saving} onClick={() => saveEdit(ver)}>Save</Button>
                        <Button onClick={cancelEdit}>Cancel</Button>
                      </>
                    ) : (
                      <>
                        <Button type="text" className="ui-icon-btn" icon={<EditOutlined />} onClick={() => startEdit(ver)}>
                          Edit
                        </Button>
                        <Popconfirm
                          title="Delete this estimate?"
                          description={`Rev #${ver.revision_number} will be permanently deleted.`}
                          onConfirm={() => handleDelete(ver)}
                          okText="Delete"
                          okButtonProps={{ danger: true }}
                        >
                          <Tooltip title="Delete estimate">
                            <Button
                              type="text" className="ui-icon-btn ui-icon-btn--danger"
                              icon={<DeleteOutlined />} aria-label="Delete estimate"
                            />
                          </Tooltip>
                        </Popconfirm>
                      </>
                    )}
                  </div>
                </div>

                {ver.date_received && (
                  <div className="fu-version-meta">
                    Received {dayjs(ver.date_received).format('MM/DD/YYYY')}
                    {ver.received_from && ` from ${ver.received_from}`}
                  </div>
                )}

                {isEditing ? renderEditFigures() : renderFigures(ver)}
                {renderSections(ver, isEditing)}
              </article>
            );
          })}
        </section>
      )}

      {/* WM estimate recorded on the claim without its own estimate record */}
      {showWmFallback && (
        <section className="fu-block">
          <h3 className="fu-block-title">Water mitigation estimate</h3>
          <article className="fu-version">
            <div className="fu-version-title">
              <span className="fu-version-rev">Separate WM estimate</span>
              <span className="fu-muted">No PDF uploaded</span>
            </div>
            <dl className="fu-figures">
              <div className="fu-figure">
                <dt>WM amount</dt>
                <dd className="fu-money fu-money--strong">{formatCurrency(Number(claimWmAmount))}</dd>
              </div>
            </dl>
          </article>
        </section>
      )}

      {/* Supplement estimates — grouped by status, identified/in_progress first */}
      {hasSupplements && (() => {
        const grouped: Record<string, any[]> = {};
        supplements.forEach((sup: any) => {
          const st = sup.status || 'identified';
          if (!grouped[st]) grouped[st] = [];
          grouped[st].push(sup);
        });
        const orderedStatuses = SUPPLEMENT_STATUSES.filter(st => grouped[st]?.length > 0);

        return (
          <section className="fu-block">
            <h3 className="fu-block-title">
              Supplement estimates
              <span className="fu-count">{supplements.length}</span>
            </h3>
            {orderedStatuses.map(status => (
              <div key={status} className="fu-sup-group">
                <div className="fu-sup-group-head">
                  <SupplementStatusPill status={status} />
                  <span className="fu-count">{grouped[status].length}</span>
                </div>
                {grouped[status].map((sup: any) => {
                  const supBidItems = (sup.bid_items || []).filter((b: any) => b.custom_document_file_id);
                  const totalAmount = sup.supplement_amount || sup.our_estimate_amount || 0;
                  return (
                    <div key={sup.id} className="fu-sup" onClick={() => navigate(`/supplements/${sup.id}`)}>
                      <div className="fu-sup-head">
                        <a
                          className="ui-ink-link fu-sup-title"
                          href={`/supplements/${sup.id}`}
                          onClick={e => { e.preventDefault(); e.stopPropagation(); navigate(`/supplements/${sup.id}`); }}
                        >
                          {sup.title}
                        </a>
                        {sup.request_type === 'estimate_request' && <Pill tone="gray">Estimate request</Pill>}
                        {totalAmount > 0 && (
                          <span className="fu-money fu-money--strong fu-sup-amount">{formatCurrency(totalAmount)}</span>
                        )}
                      </div>
                      {sup.reason && <p className="fu-sup-reason">{sup.reason}</p>}
                      {supBidItems.length > 0 && (
                        <ul className="fu-bid-list">
                          {supBidItems.map((item: any) => (
                            <li key={item.id}>
                              <span className="fu-muted">
                                {BID_TYPE_LABELS[item.estimate_type] || item.estimate_type}
                              </span>
                              <span className="fu-bid-title">{item.title || item.estimate_type}</span>
                              {item.custom_amount != null && (
                                <span className="fu-money">{formatCurrency(item.custom_amount)}</span>
                              )}
                              <a
                                className="fu-file-chip fu-file-chip--icon"
                                href={`${fileService.getDownloadUrl(item.custom_document_file_id)}?inline=true`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="View PDF"
                                aria-label={`View ${item.title || item.estimate_type} PDF`}
                                onClick={e => e.stopPropagation()}
                              >
                                <FilePdfOutlined className="fu-pdf-icon" />
                                <span>PDF</span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        );
      })()}
    </div>
  );
};

export default ClaimEstimatesPanel;
