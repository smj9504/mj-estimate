/**
 * WM Payment Board — public manager page (NO auth, token in URL)
 *
 * A manager opens /wm-payments/:token, sees every active WM job with its
 * status and amount, toggles "Received", sets who the check went to and can
 * leave a note per job. Those three are the only things this page can
 * change; amount and status are read-only here. Amount is the approved
 * amount in dark, or our invoice in light gray until one is approved.
 * Mobile-first: phones get a card list with a sticky header.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Grid,
  Result,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { wmPaymentBoardService } from '../services/waterMitigationService';
import type { CheckRecipient, WMPaymentRow } from '../types/waterMitigation';
import {
  AMOUNT_HINT,
  AMOUNT_PREF_KEY,
  AmountText,
  CHECK_RECIPIENT_OPTIONS,
  CheckRecipientTag,
  CompanyTag,
  EditableNote,
  RECEIVED_ROW_BG,
  ReceivedTag,
  readBoolPref,
  writeBoolPref,
} from '../components/water-mitigation/paymentBoardShared';
import { WMStatusPill } from '../components/water-mitigation/wmStatus';

const { Text } = Typography;
const { useBreakpoint } = Grid;

const WMPaymentBoardPublic: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [rows, setRows] = useState<WMPaymentRow[]>([]);
  const [hideReceived, setHideReceived] = useState(false);
  // Amount can be hidden so the board can be shown without the numbers.
  const [showAmount, setShowAmount] = useState(() => readBoolPref(AMOUNT_PREF_KEY, true));
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingRecipientId, setSavingRecipientId] = useState<string | null>(null);

  const toggleAmount = (show: boolean) => {
    setShowAmount(show);
    writeBoolPref(AMOUNT_PREF_KEY, show);
  };

  useEffect(() => {
    if (!token) {
      setInvalid(true);
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const board = await wmPaymentBoardService.getPublicBoard(token);
        if (!board.valid) {
          setInvalid(true);
        } else {
          setRows(board.items);
        }
      } catch {
        setInvalid(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const visibleRows = useMemo(
    () => (hideReceived ? rows.filter((r) => !r.payment_received) : rows),
    [rows, hideReceived]
  );
  const pendingCount = useMemo(() => rows.filter((r) => !r.payment_received).length, [rows]);

  const patchRow = (id: string, patch: Partial<WMPaymentRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const handleToggle = async (row: WMPaymentRow, received: boolean) => {
    if (!token) return;
    const previous = row;
    patchRow(row.id, { payment_received: received }); // optimistic
    setSavingId(row.id);
    try {
      const updated = await wmPaymentBoardService.setPublicReceived(token, row.id, received);
      patchRow(row.id, updated);
    } catch (error) {
      patchRow(row.id, previous);
      message.error('Could not save. Please try again.');
      console.error('Public payment toggle error:', error);
    } finally {
      setSavingId(null);
    }
  };

  const handleCheckRecipient = async (row: WMPaymentRow, recipient: CheckRecipient | null) => {
    if (!token) return;
    const previous = row;
    patchRow(row.id, { check_recipient: recipient }); // optimistic
    setSavingRecipientId(row.id);
    try {
      const updated = await wmPaymentBoardService.setPublicCheckRecipient(token, row.id, recipient);
      patchRow(row.id, updated);
    } catch (error) {
      patchRow(row.id, previous);
      message.error('Could not save. Please try again.');
      console.error('Public check recipient error:', error);
    } finally {
      setSavingRecipientId(null);
    }
  };

  const handleNote = async (row: WMPaymentRow, note: string | null) => {
    if (!token) return;
    try {
      const updated = await wmPaymentBoardService.setPublicNote(token, row.id, note);
      patchRow(row.id, updated);
      message.success('Note saved');
    } catch (error) {
      message.error('Could not save the note. Please try again.');
      console.error('Public payment note error:', error);
      throw error;
    }
  };

  const receivedSwitch = (row: WMPaymentRow) => (
    <Switch
      checked={!!row.payment_received}
      loading={savingId === row.id}
      checkedChildren="✓"
      unCheckedChildren="✗"
      onChange={(checked) => handleToggle(row, checked)}
    />
  );

  const checkRecipientSelect = (row: WMPaymentRow, width: number | string) => (
    <Select
      size="small"
      allowClear
      placeholder="—"
      aria-label="Check to"
      value={row.check_recipient ?? undefined}
      loading={savingRecipientId === row.id}
      style={{ width }}
      options={CHECK_RECIPIENT_OPTIONS}
      onChange={(v) => handleCheckRecipient(row, (v as CheckRecipient | undefined) ?? null)}
      labelRender={({ value: v }) => <CheckRecipientTag value={v as CheckRecipient} />}
    />
  );

  const columns: ColumnsType<WMPaymentRow> = [
    {
      title: 'Address',
      dataIndex: 'property_address',
      key: 'property_address',
      ellipsis: true,
      render: (address: string, row) => (
        <div>
          <div>{address}</div>
          {row.homeowner_name && (
            <Text type="secondary" style={{ fontSize: 12 }}>{row.homeowner_name}</Text>
          )}
        </div>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      width: 170,
      render: (_, row) =>
        row.status ? <WMStatusPill status={row.status} /> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Company',
      key: 'company',
      width: 110,
      render: (_, row) =>
        row.company ? <CompanyTag company={row.company} /> : <Text type="secondary">—</Text>,
    },
    ...(showAmount ? [
      {
        title: (
          <Tooltip title={AMOUNT_HINT}>
            <span>Amount</span>
          </Tooltip>
        ),
        key: 'amount',
        width: 140,
        align: 'right' as const,
        render: (_: unknown, row: WMPaymentRow) => <AmountText row={row} />,
      },
    ] : []),
    {
      title: 'Check To',
      key: 'check_recipient',
      width: 160,
      render: (_, row) => checkRecipientSelect(row, '100%'),
    },
    {
      title: 'Received',
      key: 'payment_received',
      width: 160,
      render: (_, row) => (
        <Space>
          {receivedSwitch(row)}
          <ReceivedTag received={row.payment_received} />
        </Space>
      ),
    },
    {
      title: 'Note',
      key: 'payment_note',
      width: 260,
      render: (_, row) => (
        <EditableNote value={row.payment_note} updatedAt={row.payment_note_updated_at} onSave={(note) => handleNote(row, note)} />
      ),
    },
  ];

  const renderMobileCard = (row: WMPaymentRow) => (
    <div
      key={row.id}
      style={{
        background: row.payment_received ? RECEIVED_ROW_BG : '#fff',
        border: '1px solid #f0f0f0',
        borderRadius: 12,
        padding: '12px 14px',
        marginBottom: 10,
      }}
    >
      {/* Address + Received switch on one line so the main action is always thumb-reachable */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text strong style={{ display: 'block', fontSize: 15, lineHeight: 1.3 }}>
            {row.property_address}
          </Text>
          {(row.company || row.homeowner_name) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <CompanyTag company={row.company} style={{ margin: 0, fontSize: 11 }} />
              {row.homeowner_name && (
                <Text type="secondary" style={{ fontSize: 12 }}>{row.homeowner_name}</Text>
              )}
            </div>
          )}
          {row.status && (
            <div style={{ marginTop: 6 }}>
              <WMStatusPill status={row.status} />
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          {receivedSwitch(row)}
          <Text type="secondary" style={{ fontSize: 11 }}>
            {row.payment_received
              ? `Received${row.payment_received_at ? ` ${dayjs(row.payment_received_at).format('MM/DD')}` : ''}`
              : 'Pending'}
          </Text>
        </div>
      </div>

      {showAmount && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 10px',
            background: 'rgba(0,0,0,0.03)',
            borderRadius: 8,
          }}
        >
          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Amount</Text>
          <AmountText row={row} style={{ fontSize: 13, whiteSpace: 'nowrap' }} />
        </div>
      )}

      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>Check to</Text>
        {checkRecipientSelect(row, 150)}
      </div>

      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e8e8e8' }}>
        <EditableNote compact value={row.payment_note} updatedAt={row.payment_note_updated_at} onSave={(note) => handleNote(row, note)} />
      </div>
    </div>
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (invalid) {
    return (
      <Result
        status="404"
        title="This link is no longer valid"
        subTitle="Ask your admin for a new payment board link."
      />
    );
  }

  const header = (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        background: '#fff',
        borderBottom: '1px solid #f0f0f0',
        padding: isMobile ? '10px 14px' : '14px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <Text strong style={{ fontSize: isMobile ? 16 : 18, display: 'block' }}>WM Payments</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {pendingCount} pending · {rows.length - pendingCount} received
        </Text>
      </div>
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 4 : 16, alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
          <Text style={{ fontSize: 13 }}>Amount</Text>
          <Switch size="small" checked={showAmount} onChange={toggleAmount} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
          <Text style={{ fontSize: 13 }}>Hide received</Text>
          <Switch size="small" checked={hideReceived} onChange={setHideReceived} />
        </label>
      </div>
    </div>
  );

  const empty = (
    <div style={{ textAlign: 'center', padding: '48px 16px' }}>
      <Text type="secondary">{hideReceived ? 'Everything is paid 🎉' : 'No jobs'}</Text>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: isMobile ? '#f5f5f5' : '#fff' }}>
      {header}
      {isMobile ? (
        <div style={{ padding: '12px 12px 32px' }}>
          {visibleRows.length === 0 ? empty : visibleRows.map(renderMobileCard)}
        </div>
      ) : (
        <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
          <Table
            columns={columns}
            dataSource={visibleRows}
            rowKey="id"
            pagination={false}
            size="middle"
            scroll={{ x: 1200 }}
            onRow={(row) => ({
              style: row.payment_received ? { background: RECEIVED_ROW_BG } : undefined,
            })}
            locale={{ emptyText: hideReceived ? 'Everything is paid 🎉' : 'No jobs' }}
          />
        </div>
      )}
    </div>
  );
};

export default WMPaymentBoardPublic;
