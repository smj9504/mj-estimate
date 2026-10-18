/**
 * Shared vocabulary for the Supplements list and detail pages: one status
 * tone map, the bid-type and required-estimate labels, and money formatting,
 * so both pages show a supplement the same way.
 */

import React from 'react';
import { Pill, humanize, type TagTone } from '../common/ui';
import type { SupplementStatus } from '../../types/supplement';

export const SUPPLEMENT_STATUSES: SupplementStatus[] = [
  'identified', 'in_progress', 'submitted', 'under_review', 'approved', 'denied', 'withdrawn',
];

/** Identified needs someone to act, so it is the warm tone; settled states are green/red/grey */
export const SUPPLEMENT_STATUS_TONES: Record<string, TagTone> = {
  identified: 'orange',
  in_progress: 'blue',
  submitted: 'purple',
  under_review: 'yellow',
  approved: 'green',
  denied: 'red',
  withdrawn: 'gray',
};

export const supplementStatusLabel = (status?: string) => (status ? humanize(status) : 'Unknown');

export const SupplementStatusPill: React.FC<{ status?: string }> = ({ status }) => (
  <Pill tone={SUPPLEMENT_STATUS_TONES[status || ''] || 'gray'}>{supplementStatusLabel(status)}</Pill>
);

export const BID_TYPE_LABELS: Record<string, string> = {
  xactimate: 'Xactimate', bathroom: 'Bathroom', cabinet: 'Cabinet', packing: 'Packing',
  roofing: 'Roofing', kitchen: 'Kitchen', flooring: 'Flooring', other: 'Other',
};

export const REQUIRED_ESTIMATE_OPTIONS = [
  { key: 'xactimate', label: 'Xactimate' },
  { key: 'pack_in_out', label: 'Pack-in / Pack-out' },
  { key: 'cabinet', label: 'Cabinet' },
  { key: 'bathroom', label: 'Bathroom' },
  { key: 'roofing', label: 'Roofing' },
  { key: 'kitchen', label: 'Kitchen' },
  { key: 'flooring', label: 'Flooring' },
];

/** Labels of the required estimates that are switched on, in checklist order */
export const requiredEstimateLabels = (required?: Record<string, boolean>) =>
  REQUIRED_ESTIMATE_OPTIONS.filter(o => required?.[o.key]).map(o => o.label);

export const formatCurrency = (val?: number) => {
  if (val == null) return '$0.00';
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** A difference carries its sign so it reads without colour: +$1,200.00 / −$300.00 */
export const formatSignedCurrency = (val?: number) => {
  if (!val) return formatCurrency(0);
  return `${val > 0 ? '+' : '−'}${formatCurrency(Math.abs(val))}`;
};
