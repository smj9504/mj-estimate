/**
 * Shared vocabulary for work orders: one status tone map, the status labels
 * and money formatting, so every screen shows a work order the same way.
 */

import React from 'react';
import { Pill, humanize, type TagTone } from '../common/ui';
import type { WorkOrder } from '../../types';

/** Workflow order; on_hold exists on the backend but is not offered here */
export const WORK_ORDER_STATUSES: WorkOrder['status'][] = [
  'draft', 'pending', 'approved', 'in_progress', 'completed', 'cancelled',
];

/** Pending approval needs someone to act, so it is the warm tone */
export const WORK_ORDER_STATUS_TONES: Record<string, TagTone> = {
  draft: 'gray',
  pending: 'orange',
  approved: 'purple',
  in_progress: 'blue',
  completed: 'green',
  cancelled: 'red',
  on_hold: 'yellow',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending approval',
};

export const workOrderStatusLabel = (status?: string) =>
  status ? STATUS_LABELS[status] || humanize(status) : 'Unknown';

export const WorkOrderStatusPill: React.FC<{ status?: string }> = ({ status }) => (
  <Pill tone={WORK_ORDER_STATUS_TONES[status || ''] || 'gray'}>{workOrderStatusLabel(status)}</Pill>
);

/** final_cost arrives as a number or a numeric string */
export const toAmount = (value?: number | string | null) => {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(n) ? (n as number) : 0;
};

export const formatMoney = (value?: number | string | null) =>
  `$${toAmount(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
