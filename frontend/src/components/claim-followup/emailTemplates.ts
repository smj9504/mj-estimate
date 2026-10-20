/**
 * Email template fields: the {{placeholders}} a template can use, filling
 * them from the claim, and finding the ones still left blank.
 *
 * Placeholders follow the backend's renderer (`{{word}}`, no spaces), so a
 * template reads the same whether it is filled here or by the server.
 */

import type { FollowUpTask } from '../../types/claimFollowUp';

export type TemplateValues = Record<string, string | undefined>;

/** Claim details a follow-up task carries; the composer adds who is sending */
export const templateValuesFromTask = (task?: FollowUpTask): TemplateValues | undefined => (task ? {
  claim_number: task.claim_number,
  property_address: task.property_address,
  adjuster_name: task.adjuster_name,
  pa_name: task.pa_name,
  insurance_company: task.insurance_company,
} : undefined);

export interface TemplateField {
  key: string;
  label: string;
}

/** Fields offered in the template editor, in the order people reach for them */
export const TEMPLATE_FIELDS: TemplateField[] = [
  { key: 'claim_number', label: 'Claim #' },
  { key: 'property_address', label: 'Property address' },
  { key: 'homeowner_name', label: 'Homeowner' },
  { key: 'adjuster_name', label: 'Adjuster' },
  { key: 'pa_name', label: 'Public adjuster' },
  { key: 'insurance_company', label: 'Insurance company' },
  { key: 'invoice_amount', label: 'Invoice amount' },
  { key: 'documents_sent_date', label: 'Documents sent date' },
  { key: 'company_name', label: 'Our company' },
  { key: 'sender_name', label: 'Your name' },
  { key: 'sender_phone', label: 'Your phone' },
];

const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  TEMPLATE_FIELDS.map(f => [f.key, f.label]),
);

export const fieldLabel = (key: string) => FIELD_LABELS[key] || key.replace(/_/g, ' ');

export const placeholderOf = (key: string) => `{{${key}}}`;

/** Template types the backend knows, with the words people use for them */
export const TEMPLATE_TYPE_OPTIONS = [
  { value: 'initial_send', label: 'First send' },
  { value: 'first_followup', label: '1st follow-up' },
  { value: 'second_followup', label: '2nd follow-up' },
  { value: 'urgent_notice', label: 'Urgent notice' },
  { value: 'payment_inquiry', label: 'Payment inquiry' },
  { value: 'estimate_request', label: 'Estimate request' },
  { value: 'supplement_followup', label: 'Supplement follow-up' },
  { value: 'custom', label: 'Other' },
];

const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  TEMPLATE_TYPE_OPTIONS.map(o => [o.value, o.label]),
);

export const templateTypeLabel = (type: string) => TYPE_LABELS[type] || type.replace(/_/g, ' ');

/** Template types that fit a follow-up task, so the menu can offer them first */
const TYPES_FOR_TASK: Record<string, string[]> = {
  wm_docs_sent: ['initial_send', 'first_followup', 'second_followup', 'urgent_notice'],
  docs_sent: ['initial_send', 'first_followup', 'second_followup', 'urgent_notice'],
  payment_check: ['payment_inquiry'],
  wm_payment_check: ['payment_inquiry'],
  estimate_request: ['estimate_request'],
  supplement_estimate_prep: ['supplement_followup'],
  supplement_sent: ['supplement_followup'],
  depreciation_recovery: ['payment_inquiry'],
};

export const templateTypesForTask = (taskType?: string): string[] =>
  (taskType && TYPES_FOR_TASK[taskType]) || [];

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Replace every placeholder that has a value. Ones without a value stay as
 * written so the sender can see what is missing. `html` escapes the values
 * for an HTML body; a subject line takes them as they are.
 */
export const fillTemplate = (
  text: string,
  values: Record<string, string | undefined>,
  { html = false }: { html?: boolean } = {},
): string =>
  (text || '').replace(PLACEHOLDER, (match, key: string) => {
    const value = values[key];
    if (value === undefined || value === null || String(value).trim() === '') return match;
    return html ? escapeHtml(String(value)) : String(value);
  });

/** Placeholder names still in the text, each once, in reading order */
export const findPlaceholders = (...texts: (string | undefined)[]): string[] => {
  const seen = new Set<string>();
  texts.forEach(text => {
    for (const m of (text || '').matchAll(PLACEHOLDER)) seen.add(m[1]);
  });
  return Array.from(seen);
};

/** Older templates were saved as plain text; give them paragraphs for the editor */
export const toEditorHtml = (body: string): string => {
  if (!body) return '';
  if (/<[a-z][\s\S]*>/i.test(body)) return body;
  return body
    .split(/\n{2,}/)
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
};

/** True when an HTML body has no visible words */
export const isBlankHtml = (html?: string) =>
  !(html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
