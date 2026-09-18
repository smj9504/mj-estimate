/**
 * WM Payment Board — public manager page (NO auth, token in URL)
 *
 * A manager opens /wm-payments/:token, sees every active WM job with its
 * amounts, toggles "Received" and can leave a note per job. Those two are
 * the only things this page can change; amounts and check recipient are
 * read-only here. Mobile-first: phones get a card list with a sticky header.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Grid,
  Result,
  Space,
  Spin,
  Switch,
  Table,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { wmPaymentBoardService } from '../services/waterMitigationService';
import type { WMPaymentRow } from '../types/waterMitigation';
import {
  CheckRecipientTag,
  EditableNote,
  RECEIVED_ROW_BG,
  ReceivedTag,
  effectiveApproved,
  formatMoney,
  readAmountsPref,
  writeAmountsPref,
} from '../components/water-mitigation/paymentBoardShared';

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
  // Invoice / Approved can be hidden so the board can be shown without the numbers
  const [showAmounts, setShowAmounts] = useState(() => readAmountsPref(true));
  const [savingId, setSavingId] = useState<string | null>(null);

  const toggleAmounts = (show: boolean) => {
    setShowAmounts(show);
    writeAmountsPref(show);
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
    ...(showAmounts ? [
      {
        title: 'Our Invoice',
        key: 'invoice_amount',
        width: 130,
        align: 'right' as const,
        render: (_: unknown, row: WMPaymentRow) => formatMoney(row.invoice_amount),
      },
      {
        title: 'Approved (Final)',
        key: 'approved_amount',
        width: 140,
        align: 'right' as const,
        render: (_: unknown, row: WMPaymentRow) => formatMoney(effectiveApproved(row)),
      },
    ] : []),
    {
      title: 'Check To',
      key: 'check_recipient',
      width: 130,
      render: (_, row) => <CheckRecipientTag value={row.check_recipient} />,
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
        <EditableNote value={row.payment_note} onSave={(note) => handleNote(row, note)} />
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
          {row.homeowner_name && (
            <Text type="secondary" style={{ fontSize: 12 }}>{row.homeowner_name}</Text>
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

      {showAmounts && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
            marginTop: 10,
            padding: '8px 10px',
            background: 'rgba(0,0,0,0.03)',
            borderRadius: 8,
          }}
        >
          {[
            ['Our Invoice', row.invoice_amount],
            ['Approved (Final)', effectiveApproved(row)],
          ].map(([label, amount]) => (
            <div key={label as string} style={{ minWidth: 0 }}>
              <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>{label}</Text>
              <Text strong style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                {formatMoney(amount as number | null | undefined)}
              </Text>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>Check to</Text>
        <CheckRecipientTag value={row.check_recipient} />
      </div>

      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e8e8e8' }}>
        <EditableNote compact value={row.payment_note} onSave={(note) => handleNote(row, note)} />
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
          <Text style={{ fontSize: 13 }}>Amounts</Text>
          <Switch size="small" checked={showAmounts} onChange={toggleAmounts} />
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
            scroll={{ x: 1000 }}
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
