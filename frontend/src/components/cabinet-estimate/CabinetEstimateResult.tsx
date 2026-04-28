import React from 'react';
import { Card, Descriptions, Divider, Space, Table, Tag, Typography } from 'antd';
import type { CabinetEstimate, EstimateLineItem } from '../../types/cabinetEstimate';

const { Title, Text } = Typography;

interface CabinetEstimateResultProps {
  estimate: CabinetEstimate;
}

const CATEGORY_COLORS: Record<string, string> = {
  supply: 'blue',
  scope: 'green',
  premium: 'orange',
  labor: 'cyan',
};

const CabinetEstimateResult: React.FC<CabinetEstimateResultProps> = ({ estimate }) => {
  const fmtMoney = (val: number) =>
    `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const columns = [
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      width: 100,
      render: (cat: string) => cat ? (
        <Tag color={CATEGORY_COLORS[cat] || 'default'}>{cat}</Tag>
      ) : '-',
    },
    {
      title: 'Qty',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 80,
      align: 'right' as const,
      render: (val: number) => val?.toFixed(1),
    },
    {
      title: 'Unit',
      dataIndex: 'unit',
      key: 'unit',
      width: 60,
    },
    {
      title: 'Unit Price',
      dataIndex: 'unit_price',
      key: 'unit_price',
      width: 110,
      align: 'right' as const,
      render: (val: number) => fmtMoney(val),
    },
    {
      title: 'Total',
      dataIndex: 'total',
      key: 'total',
      width: 120,
      align: 'right' as const,
      render: (val: number) => <Text strong>{fmtMoney(val)}</Text>,
    },
  ];

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Table
          dataSource={estimate.line_items}
          columns={columns}
          rowKey="id"
          pagination={false}
          size="small"
          summary={() => (
            <>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={5} align="right">
                  <Text strong>Subtotal</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <Text strong>{fmtMoney(estimate.subtotal)}</Text>
                </Table.Summary.Cell>
              </Table.Summary.Row>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={5} align="right">
                  Overhead ({(estimate.overhead_pct * 100).toFixed(0)}%)
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  {fmtMoney(estimate.overhead_amount)}
                </Table.Summary.Cell>
              </Table.Summary.Row>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={5} align="right">
                  Profit ({(estimate.profit_pct * 100).toFixed(0)}%)
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  {fmtMoney(estimate.profit_amount)}
                </Table.Summary.Cell>
              </Table.Summary.Row>
              <Table.Summary.Row style={{ background: '#f0f5ff' }}>
                <Table.Summary.Cell index={0} colSpan={5} align="right">
                  <Title level={5} style={{ margin: 0 }}>TOTAL</Title>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <Title level={5} style={{ margin: 0 }}>{fmtMoney(estimate.total)}</Title>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            </>
          )}
        />
      </Card>

      {estimate.warning_flags && estimate.warning_flags.length > 0 && (
        <Card size="small" title="Notes" style={{ marginBottom: 16 }}>
          <Space direction="vertical" size={4}>
            {estimate.warning_flags.map((w, i) => (
              <Text key={i} type="warning">- {w}</Text>
            ))}
          </Space>
        </Card>
      )}

      {estimate.methodology_notes && (
        <Card size="small" title="Methodology">
          <pre style={{ fontSize: 12, margin: 0, whiteSpace: 'pre-wrap' }}>
            {estimate.methodology_notes}
          </pre>
        </Card>
      )}
    </div>
  );
};

export default CabinetEstimateResult;
