/**
 * Shared rendering for the WM payment board.
 * Used by the admin list (Payment view) and the public manager page so the
 * two screens read the same way.
 */

import React, { useEffect, useState } from 'react';
import { Button, Input, Space, Tag, Typography } from 'antd';
import {
  ArrowRightOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  EditOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import type { CheckRecipient } from '../../types/waterMitigation';

const { Text } = Typography;

export const CHECK_RECIPIENT_OPTIONS: { value: CheckRecipient; label: string }[] = [
  { value: 'contractor', label: 'Contractor' },
  { value: 'customer', label: 'Customer' },
];

/** Faint green tint for rows whose payment has arrived */
export const RECEIVED_ROW_BG = '#f6ffed';

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

/** Per-viewer "show amounts" preference for the public board (localStorage, best effort) */
export const AMOUNTS_PREF_KEY = 'wm-payments:show-amounts';
export const readAmountsPref = (fallback: boolean): boolean => {
  try {
    const v = localStorage.getItem(AMOUNTS_PREF_KEY);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
};
export const writeAmountsPref = (show: boolean) => {
  try { localStorage.setItem(AMOUNTS_PREF_KEY, show ? '1' : '0'); } catch { /* ignore */ }
};

// Colour AND an arrow glyph, so contractor vs customer reads without relying on colour alone.
export const CheckRecipientTag: React.FC<{ value?: CheckRecipient | null }> = ({ value }) => {
  if (value === 'contractor') {
    return (
      <Tag color="blue" icon={<ArrowRightOutlined />}>Contractor</Tag>
    );
  }
  if (value === 'customer') {
    return (
      <Tag color="orange" icon={<ArrowRightOutlined />}>Customer</Tag>
    );
  }
  return <Tag>—</Tag>;
};

export const ReceivedTag: React.FC<{ received?: boolean }> = ({ received }) =>
  received ? (
    <Tag color="success" icon={<CheckCircleFilled />}>Received</Tag>
  ) : (
    <Tag icon={<ClockCircleOutlined />}>Pending</Tag>
  );

/**
 * Tap-to-edit note. Shows the text (or an "Add note" affordance); editing
 * opens a textarea with Save / Cancel. Saving an empty note clears it.
 */
export const EditableNote: React.FC<{
  value?: string | null;
  onSave: (note: string | null) => Promise<void> | void;
  compact?: boolean;
}> = ({ value, onSave, compact }) => {
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
      <EditOutlined style={{ marginLeft: 6, color: '#8c8c8c', fontSize: 12 }} />
    </div>
  );
};
