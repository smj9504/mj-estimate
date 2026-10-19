/**
 * Shared vocabulary for the Rebuild list and project detail: one status tone
 * map, the completion documents a project owes, and the PDF URLs they open.
 */

import React from 'react';
import { Pill, humanize, type TagTone } from '../common/ui';
import api from '../../services/api';
import { fileService } from '../../services/fileService';
import type { ProjectStatus, RebuildCompletionDoc } from '../../types/rebuild';

export const REBUILD_STATUSES: ProjectStatus[] = [
  'pending', 'assigned', 'in_progress', 'completed', 'invoiced', 'docs_sent', 'closed',
];

/** Pending still needs a contractor, so it is the warm tone; closed is the only grey */
export const REBUILD_STATUS_TONES: Record<string, TagTone> = {
  pending: 'orange',
  assigned: 'blue',
  in_progress: 'purple',
  completed: 'green',
  invoiced: 'yellow',
  docs_sent: 'pink',
  closed: 'gray',
};

export const rebuildStatusLabel = (status?: string) => (status ? humanize(status) : 'Unknown');

export const RebuildStatusPill: React.FC<{ status?: string }> = ({ status }) => (
  <Pill tone={REBUILD_STATUS_TONES[status || ''] || 'gray'}>{rebuildStatusLabel(status)}</Pill>
);

/** The three documents every project sends at completion, with the project flag that records each as sent */
export const REQUIRED_DOCS = [
  { type: 'coc', label: 'Certificate of completion', sentKey: 'coc_sent' },
  { type: 'invoice', label: 'Invoice', sentKey: 'invoice_sent' },
  { type: 'completion_photo', label: 'Completion photos', sentKey: 'photos_sent' },
] as const;

export const DOC_TYPE_LABELS: Record<string, string> = {
  coc: 'Certificate of completion',
  invoice: 'Invoice',
  completion_photo: 'Completion photos',
  warranty: 'Warranty',
  permit: 'Permit',
  lien_waiver: 'Lien waiver',
  other: 'Other',
};

export const formatCurrency = (val?: number | null) => {
  if (val == null) return '$0.00';
  return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const apiBase = () => {
  // baseURL is '' on localhost (CRA proxy handles /api)
  const base = api.defaults.baseURL || window.location.origin;
  return base.endsWith('/') ? base.slice(0, -1) : base;
};

/** Where a completion doc's PDF opens: generated docs carry a storage path, uploads a file record */
export const completionDocPdfUrl = (doc: RebuildCompletionDoc): string | null => {
  if (doc.file_url) return `${apiBase()}/api/rebuild/projects/${doc.project_id}/docs/${doc.id}/pdf`;
  if (doc.file_id) return fileService.getInlineUrl(doc.file_id);
  return null;
};

export const fileInlineUrl = (fileId: string) => fileService.getInlineUrl(fileId);
