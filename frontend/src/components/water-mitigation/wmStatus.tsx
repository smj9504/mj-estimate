/**
 * WM job status → pastel tone. Shared by the list, detail and status history
 * so a status reads the same colour everywhere.
 */

import React from 'react';
import { Pill, type TagTone } from '../common/ui';
import type { JobStatus } from '../../types/waterMitigation';

export const WM_STATUS_TONES: Record<string, TagTone> = {
  'Lead': 'gray',
  'Doc prepping': 'brown',
  'Sent to adjuster': 'blue',
  'Follow up': 'orange',
  'Paperwork received': 'purple',
  'Estimate requested': 'pink',
  'Payment on the way': 'blue',
  'Check received': 'yellow',
  'Complete': 'green',
};

export const WMStatusPill: React.FC<{ status?: JobStatus | string | null }> = ({ status }) =>
  status ? <Pill tone={WM_STATUS_TONES[status] ?? 'gray'}>{status}</Pill> : null;
