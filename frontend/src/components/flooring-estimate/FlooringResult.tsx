/**
 * The priced estimate, room by room as the PDF lists it: each room's
 * lines and total, the General section and the grand total.
 */

import React, { useMemo } from 'react';
import { Alert, Button, Empty, Grid, List, Space, Table, Typography } from 'antd';
import { CalculatorOutlined, FilePdfOutlined } from '@ant-design/icons';
import type { FlooringEstimate, FlooringLineItem } from '../../types/flooringEstimate';
import PriceBookNotice from '../common/PriceBookNotice';

const { Text, Title } = Typography;

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Section {
  key: string;
  title: string;
  level: string | null;
  lines: FlooringLineItem[];
  total: number;
}

/** Lines in their rooms, in the order calculated; General last */
export function sections(lines: FlooringLineItem[]): Section[] {
  const out: Section[] = [];
  const byKey = new Map<string, Section>();
  for (const li of [...lines].sort((a, b) => a.display_order - b.display_order)) {
    const key = li.room_id || '__general__';
    let s = byKey.get(key);
    if (!s) {
      s = { key, title: li.room_name, level: li.level_name, lines: [], total: 0 };
      byKey.set(key, s);
      out.push(s);
    }
    s.lines.push(li);
    s.total += li.total;
  }
  return [...out.filter((s) => s.key !== '__general__'), ...out.filter((s) => s.key === '__general__')];
}

interface ResultProps {
  estimate: FlooringEstimate;
  stale: boolean;
  calculating: boolean;
  onCalculate: () => void;
  downloading?: boolean;
  onPdf?: () => void;
}

const FlooringResult: React.FC<ResultProps> = ({ estimate, stale, calculating, onCalculate, downloading, onPdf }) => {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const grouped = useMemo(() => sections(estimate.line_items || []), [estimate.line_items]);
  let n = 0;
  const numbered = grouped.map((s) => ({ ...s, lines: s.lines.map((li) => ({ ...li, n: ++n })) }));

  const calculateButton = (
    <Button type="primary" icon={<CalculatorOutlined />} loading={calculating} onClick={onCalculate} data-testid="calculate">
      {estimate.line_items?.length ? 'Recalculate' : 'Calculate'}
    </Button>
  );

  if (!estimate.line_items?.length) {
    return (
      <Empty description="Not calculated yet: pick the rooms' floors, then calculate.">{calculateButton}</Empty>
    );
  }

  return (
    <div data-testid="flooring-result">
      {onPdf && (
        <Space style={{ marginBottom: 12 }}>
          <Button icon={<FilePdfOutlined />} loading={downloading} onClick={onPdf} data-testid="download-pdf">
            PDF
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>Room by room with each room&apos;s sketch, then the floor plan</Text>
        </Space>
      )}
      <PriceBookNotice domain="flooring" estimateId={estimate.id} priceBook={estimate.price_book}
        refreshKeys={[['flooring-estimate', estimate.id]]} />
      {stale && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Changed since it was calculated"
          description="The lines below are from the last calculation." action={calculateButton} />
      )}
      {(estimate.warning_flags || []).length > 0 && (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Check before sending"
          description={<ul style={{ margin: 0, paddingLeft: 18 }}>{estimate.warning_flags!.map((w) => <li key={w}>{w}</li>)}</ul>} />
      )}

      {numbered.map((s) => (
        <div key={s.key} style={{ marginBottom: 16 }} data-testid={`result-${s.key}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid #1f3a5f', marginBottom: 4 }}>
            <Title level={5} style={{ margin: '4px 0' }}>
              {s.title}
              {s.level && <Text type="secondary" style={{ fontWeight: 400, fontSize: 12, marginLeft: 8 }}>{s.level}</Text>}
            </Title>
            <Text strong>{money(s.total)}</Text>
          </div>
          {isMobile ? (
            <List
              size="small"
              dataSource={s.lines}
              renderItem={(li) => (
                <List.Item style={{ display: 'block', paddingInline: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>{li.n}. {li.description}</span>
                    <Text strong>{money(li.total)}</Text>
                  </div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {li.quantity.toFixed(2)} {li.unit} × {money(li.unit_price)}{li.notes ? ` · ${li.notes}` : ''}
                  </Text>
                </List.Item>
              )}
            />
          ) : (
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={s.lines}
              columns={[
                { title: '#', dataIndex: 'n', width: 44 },
                {
                  title: 'Description',
                  key: 'd',
                  render: (_: unknown, li: FlooringLineItem) => (
                    <>
                      {li.description}
                      {li.notes && <div style={{ fontSize: 12, color: '#8c8c8c' }}>{li.notes}</div>}
                    </>
                  ),
                },
                { title: 'Qty', dataIndex: 'quantity', width: 90, align: 'right' as const, render: (q: number) => q.toFixed(2) },
                { title: 'Unit', dataIndex: 'unit', width: 60, align: 'center' as const },
                { title: 'Unit price', dataIndex: 'unit_price', width: 110, align: 'right' as const, render: money },
                { title: 'Total', dataIndex: 'total', width: 120, align: 'right' as const, render: money },
              ]}
            />
          )}
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#f5f5f5', borderTop: '2px solid #1f3a5f' }}>
        <Text strong style={{ fontSize: 16 }}>Grand total</Text>
        <Text strong style={{ fontSize: 16 }} data-testid="grand-total">{money(estimate.total || 0)}</Text>
      </div>
      {estimate.methodology_notes && (
        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 8 }}>{estimate.methodology_notes}</Text>
      )}
    </div>
  );
};

export default FlooringResult;
