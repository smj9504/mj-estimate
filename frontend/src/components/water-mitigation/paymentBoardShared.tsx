/**
 * Shared rendering for the WM payment board.
 * Used by the admin list (Payment view) and the public manager page so the
 * two screens read the same way.
 */

import React, { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Button, Input, Space, Typography } from 'antd';
import {
  ArrowRightOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  EditOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import type { CheckRecipient } from '../../types/waterMitigation';
import { Pill, toneFromKey } from '../common/ui';
import { tagTones } from '../../styles/tokens';

const { Text } = Typography;

export const CHECK_RECIPIENT_OPTIONS: { value: CheckRecipient; label: string }[] = [
  { value: 'contractor', label: 'Contractor' },
  { value: 'customer', label: 'Customer' },
  { value: 'pa', label: 'PA' },
];

/** Faint green tint for rows whose payment has arrived */
export const RECEIVED_ROW_BG = '#f6f9f5';

export const formatMoney = (value?: number | null): string => {
  if (value === null || value === undefined) return '—';
  return `$${Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

/** Approved amount as shown: the stored value, else the claim's insurance estimate. */
export const effectiveApproved = (row: {
  approved_amount?: number | null;
  approved_amount_auto?: number | null;
}): number | null => row.approved_amount ?? row.approved_amount_auto ?? null;

/** The amount we're actually waiting on: the approved (= final) amount, else our invoice. */
export const outstandingAmount = (row: {
  invoice_amount?: number | null;
  approved_amount?: number | null;
  approved_amount_auto?: number | null;
}): number => Number(effectiveApproved(row) ?? row.invoice_amount ?? 0);

/** Per-viewer column visibility preferences for the public board (localStorage, best effort) */
export const INVOICE_PREF_KEY = 'wm-payments:show-invoice';
export const APPROVED_PREF_KEY = 'wm-payments:show-approved';
export const readBoolPref = (key: string, fallback: boolean): boolean => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
};
export const writeBoolPref = (key: string, value: boolean) => {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* ignore */ }
};

// Colour AND an arrow glyph, so contractor vs customer reads without relying on colour alone.
export const CheckRecipientTag: React.FC<{ value?: CheckRecipient | null }> = ({ value }) => {
  if (value === 'contractor') {
    return <Pill tone="blue" icon={<ArrowRightOutlined />}>Contractor</Pill>;
  }
  if (value === 'customer') {
    return <Pill tone="orange" icon={<ArrowRightOutlined />}>Customer</Pill>;
  }
  if (value === 'pa') {
    return <Pill tone="purple" icon={<ArrowRightOutlined />}>PA</Pill>;
  }
  return <Pill tone="gray">—</Pill>;
};

/**
 * WM company shown by its code (name when it has none). Each company keeps
 * its own pastel tone, picked from its id. It is a square monogram tile, not
 * a pill, so it never reads as one more status tag next to the job status.
 */
export const CompanyTag: React.FC<{
  company?: { id: string; name: string; company_code?: string | null } | null;
  style?: React.CSSProperties;
}> = ({ company, style }) => {
  if (!company) return null;
  const tone = tagTones[toneFromKey(company.id)];
  return (
    <span
      className="ui-monogram"
      title={company.name}
      style={{ background: tone.bg, color: tone.text, ...style }}
    >
      {company.company_code || company.name}
    </span>
  );
};

export const ReceivedTag: React.FC<{ received?: boolean }> = ({ received }) =>
  received ? (
    <Pill tone="green" icon={<CheckCircleFilled />}>Received</Pill>
  ) : (
    <Pill tone="gray" icon={<ClockCircleOutlined />}>Pending</Pill>
  );

/**
 * Tap-to-edit note. Shows the text (or an "Add note" affordance); editing
 * opens a textarea with Save / Cancel. Saving an empty note clears it.
 * updatedAt (when the note was last written) is shown small under the text.
 */
export const EditableNote: React.FC<{
  value?: string | null;
  updatedAt?: string | null;
  onSave: (note: string | null) => Promise<void> | void;
  compact?: boolean;
}> = ({ value, updatedAt, onSave, compact }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  const save = async () => {
    const next = draft.trim() || null;
    if (next === (value?.trim() || null)) {
      setEditing(false);
      return;
    }
    try {
      setSaving(true);
      await onSave(next);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%' }}>
        <Input.TextArea
          autoFocus
          autoSize={{ minRows: 2, maxRows: 6 }}
          maxLength={4000}
          value={draft}
          placeholder="Note…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(false);
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
          }}
        />
        <Space size="small" style={{ marginTop: 6 }}>
          <Button type="primary" size="small" loading={saving} onClick={save}>Save</Button>
          <Button size="small" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
        </Space>
      </div>
    );
  }

  if (!value) {
    return (
      <Button
        type="link"
        size="small"
        icon={<PlusOutlined />}
        style={{ padding: 0, height: 'auto', fontSize: compact ? 12 : 13 }}
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      >
        Add note
      </Button>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      onKeyDown={(e) => { if (e.key === 'Enter') setEditing(true); }}
      style={{ cursor: 'text', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: compact ? 12 : 13 }}
    >
      <Text>{value}</Text>
      <EditOutlined style={{ marginLeft: 6, color: '#a5a29a', fontSize: 12 }} />
      {updatedAt && (
        <Text type="secondary" style={{ display: 'block', fontSize: 11, marginTop: 2 }}>
          {dayjs(updatedAt).format('MM/DD/YY h:mm A')}
        </Text>
      )}
    </div>
  );
};
