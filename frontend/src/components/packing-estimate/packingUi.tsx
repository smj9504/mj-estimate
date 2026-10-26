/**
 * Shared vocabulary for the packing estimate pages (calculator, list, detail):
 * one status tone map, labels for room settings, money formatting, the company
 * tile and the estimate breakdown, so an estimate reads the same everywhere.
 */

import React from 'react';
import { RightOutlined } from '@ant-design/icons';
import { Pill, humanize, toneFromKey, type TagTone } from '../common/ui';
import { tagTones } from '../../styles/tokens';
import type { EstimateResponse } from '../../types/packing-estimate';
import {
  CONTAMINATION_OPTIONS, DENSITY_OPTIONS, FLOOR_OPTIONS, REGION_OPTIONS,
} from './constants';
import './packing.css';

export const PACK_STATUSES = ['draft', 'completed', 'approved'] as const;

/** Approved is where the job is settled, so it takes green; a finished draft is blue */
export const PACK_STATUS_TONES: Record<string, TagTone> = {
  draft: 'gray',
  completed: 'blue',
  approved: 'green',
};

export const packStatusLabel = (status?: string | null) => humanize(status || 'draft');

export const PackStatusPill: React.FC<{ status?: string | null }> = ({ status }) => (
  <Pill tone={PACK_STATUS_TONES[status || 'draft'] || 'gray'}>{packStatusLabel(status)}</Pill>
);

export const modeLabel = (mode?: string | null) => (mode === 'photo_ai' ? 'Photo AI' : 'Quick estimate');

/** An estimate goes by its property; names typed on older estimates stand in only when there is no address */
export const packEstimateTitle = (e: {
  project_address?: string | null;
  calculation_name?: string | null;
  client_name?: string | null;
}) => e.project_address?.trim() || e.calculation_name?.trim() || e.client_name?.trim() || 'Packing Estimate';

export const formatMoney = (val?: number | null) =>
  `$${(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const formatHours = (val?: number | null) =>
  (val || 0).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const optionLabel = (options: { value: string; label: string }[], value?: string | null) =>
  options.find(o => o.value === value)?.label || (value ? humanize(value) : '');

/** Option labels without the multiplier, for reading rather than choosing: "Dense", "Gray Water" */
export const plainLabel = (label: string) => label.replace(/\s*\([^)]*\)\s*$/, '');

export const floorLabel = (v?: string | null) => optionLabel(FLOOR_OPTIONS, v);
export const densityLabel = (v?: string | null) => plainLabel(optionLabel(DENSITY_OPTIONS, v));
export const regionLabel = (v?: string | null) => optionLabel(REGION_OPTIONS, v);
export const contaminationLabel = (v?: string | null) => plainLabel(optionLabel(CONTAMINATION_OPTIONS, v));

/** Clean water carries nothing to flag; category 2 and 3 water do */
const CONTAMINATION_TONES: Record<string, TagTone> = {
  gray_water: 'yellow',
  black_water: 'red',
};

/** A chosen setting with its cost effect, compact: "Dense (1.3x)" shows as "Dense 1.3×" */
export const multiplierSelectLabel = ({ label }: { label?: React.ReactNode }) => {
  const text = String(label ?? '');
  const m = text.match(/^(.*?)\s*\(([\d.]+)x\)\s*$/);
  if (!m) return text;
  return (
    <span className="pk-mult-label">
      {m[1]}
      <span className="pk-mult">{m[2]}×</span>
    </span>
  );
};

/** The chosen contamination inside a select: a tone dot for flagged water, then the compact label */
export const contaminationSelectLabel = ({ value, label }: { value?: unknown; label?: React.ReactNode }) => {
  const tone = CONTAMINATION_TONES[String(value)];
  const shown = multiplierSelectLabel({ label });
  if (!tone) return shown;
  return (
    <span className="pk-tone-label">
      <span className="pk-tone-dot" style={{ background: tagTones[tone].text }} aria-hidden="true" />
      {shown}
    </span>
  );
};

export const ContaminationPill: React.FC<{ value?: string | null }> = ({ value }) => {
  const tone = value ? CONTAMINATION_TONES[value] : undefined;
  if (!tone) return null;
  return <Pill tone={tone}>{contaminationLabel(value)}</Pill>;
};

/** Company as its square tile, toned by its id, beside the name */
export const CompanyName: React.FC<{ id?: string | null; name?: string | null }> = ({ id, name }) => {
  if (!name) return null;
  const tone = tagTones[toneFromKey(id || name)];
  const code = name.split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return (
    <span className="pk-company">
      <span className="ui-monogram" aria-hidden="true" style={{ background: tone.bg, color: tone.text }}>
        {code || name.slice(0, 2)}
      </span>
      <span className="pk-company-name">{name}</span>
    </span>
  );
};

// ── Figures ──────────────────────────────────

export interface Figure {
  key: string;
  label: string;
  value: React.ReactNode;
}

export const Figures: React.FC<{ items: Figure[]; className?: string }> = ({ items, className }) => (
  <dl className={`pk-figures${className ? ` ${className}` : ''}`}>
    {items.map(f => (
      <div className="pk-figure" key={f.key}>
        <dt>{f.label}</dt>
        <dd>{f.value}</dd>
      </div>
    ))}
  </dl>
);

export const estimateFigures = (e: Pick<EstimateResponse, 'total_rooms' | 'total_items' | 'total_hours' | 'crew_size' | 'grand_total'>): Figure[] => [
  { key: 'rooms', label: 'Total rooms', value: e.total_rooms || 0 },
  ...(e.total_items ? [{ key: 'items', label: 'Total items', value: e.total_items }] : []),
  { key: 'hours', label: 'Total hours', value: formatHours(e.total_hours) },
  { key: 'crew', label: 'Crew size', value: e.crew_size || 0 },
  { key: 'total', label: 'Grand total', value: formatMoney(e.grand_total) },
];

// ── Breakdown ────────────────────────────────

type BreakdownSource = Pick<EstimateResponse,
  'sections' | 'section_details' | 'subtotal' | 'include_op' | 'op_rate' | 'op_amount'
  | 'supplements' | 'include_contingency' | 'contingency_rate' | 'contingency_amount' | 'grand_total'>;

/** Sections of an estimate that have line items to show */
export const sectionsWithLines = (estimate: Pick<EstimateResponse, 'section_details'>) =>
  Object.entries(estimate.section_details || {})
    .filter(([, d]) => (d?.lines || []).length > 0)
    .map(([name]) => name);

/**
 * The estimate as line items: a column header, one block per section (name
 * and total over a hairline, its lines below), then the totals. A narrow
 * column folds qty and rate under the line name so the amount keeps its
 * column. With `onToggleSection` each section head folds its lines away;
 * `collapsed` names the folded sections, so every section starts open.
 */
export const EstimateBreakdown: React.FC<{
  estimate: BreakdownSource;
  collapsed?: Set<string>;
  onToggleSection?: (section: string) => void;
}> = ({ estimate, collapsed, onToggleSection }) => {
  const collapsible = !!onToggleSection;
  const details = estimate.section_details || {};
  const sectionNames = Object.keys(details).length > 0
    ? Object.keys(details)
    : Object.keys(estimate.sections || {});
  const hasLines = sectionNames.some(s => (details[s]?.lines || []).length > 0);

  return (
    <div className={`pk-breakdown${collapsible ? ' pk-breakdown--collapsible' : ''}`}>
      {sectionNames.length === 0 && <p className="pk-empty-line">No line items in this estimate.</p>}
      {hasLines && (
        <div className="pk-bd-cols" aria-hidden="true">
          <span className="pk-bd-cols-item">Item</span>
          <span className="pk-bd-qty">Qty</span>
          <span className="pk-bd-rate">Rate</span>
          <span className="pk-bd-amount">Amount</span>
        </div>
      )}
      {sectionNames.map(section => {
        const lines = details[section]?.lines || [];
        const isOpen = !collapsed?.has(section);
        const toggle = () => onToggleSection?.(section);
        const total = <span className="pk-money">{formatMoney(estimate.sections?.[section])}</span>;
        return (
          <section className="pk-bd-section" key={section} aria-label={section}>
            {collapsible && lines.length > 0 ? (
              <button
                type="button"
                className="pk-bd-head pk-bd-head--toggle"
                onClick={toggle}
                aria-expanded={isOpen}
              >
                <span className="pk-bd-title">
                  <RightOutlined className={`pk-items-caret${isOpen ? ' is-open' : ''}`} aria-hidden="true" />
                  {section}
                  <span className="pk-bd-count">{lines.length}</span>
                </span>
                {total}
              </button>
            ) : (
              <div className="pk-bd-head">
                <h3 className="pk-bd-title">{section}</h3>
                {total}
              </div>
            )}
            {isOpen && lines.length > 0 && (
              <table className="pk-bd-table">
                <thead className="ui-sr-only">
                  <tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td className="pk-bd-item">
                        <span className="pk-bd-name">{l.name}</span>
                        {l.detail && <span className="pk-bd-detail">{l.detail}</span>}
                        <span className="pk-bd-calc">{l.qty} {l.unit} × {formatMoney(l.rate)}</span>
                      </td>
                      <td className="pk-bd-num pk-bd-qty">{l.qty} {l.unit}</td>
                      <td className="pk-bd-num pk-bd-rate">{formatMoney(l.rate)}</td>
                      <td className="pk-bd-num pk-bd-amount">{formatMoney(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}

      <dl className="pk-totals">
        <div className="pk-totals-row">
          <dt>Subtotal</dt>
          <dd>{formatMoney(estimate.subtotal)}</dd>
        </div>
        {estimate.include_op && (
          <div className="pk-totals-row">
            <dt>O&amp;P ({estimate.op_rate}%)</dt>
            <dd>{formatMoney(estimate.op_amount)}</dd>
          </div>
        )}
        {estimate.supplements?.filter(s => s.enabled).map(s => (
          <div className="pk-totals-row" key={s.key}>
            <dt>{s.name}</dt>
            <dd>{formatMoney(s.amount)}</dd>
          </div>
        ))}
        {estimate.include_contingency && (estimate.contingency_amount || 0) > 0 && (
          <div className="pk-totals-row">
            <dt>Contingency ({estimate.contingency_rate}%)</dt>
            <dd>{formatMoney(estimate.contingency_amount)}</dd>
          </div>
        )}
        <div className="pk-totals-row pk-totals-grand">
          <dt>Grand total</dt>
          <dd>{formatMoney(estimate.grand_total)}</dd>
        </div>
      </dl>
    </div>
  );
};
