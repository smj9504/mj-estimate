import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Button, Space, Tag, Modal, Form, Input, InputNumber,
  Select, DatePicker, message, Typography, Row, Col, Statistic,
  Popconfirm, Divider, Progress,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, DollarOutlined,
  ArrowUpOutlined, ArrowDownOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { expenseService } from '../../services/clientService';
import type { ClaimExpense, ClaimExpenseCreate, ProfitabilitySummary, EXPENSE_CATEGORY_LABELS } from '../../types/client';
import type { ColumnsType } from 'antd/es/table';

const { Text } = Typography;

const CAT_LABELS: Record<string, string> = {
  material: 'Material', labor: 'Labor', subcontractor: 'Subcontractor',
  equipment: 'Equipment', permit: 'Permit', overhead: 'Overhead', other: 'Other',
};

const CAT_COLORS: Record<string, string> = {
  material: 'blue', labor: 'green', subcontractor: 'purple',
  equipment: 'cyan', permit: 'orange', overhead: 'default', other: 'default',
};

const formatCurrency = (val?: number) => {
  if (val == null) return '$0.00';
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

interface ProfitabilityTrackerProps {
  clientId: string;
  claimId: string;
  onUpdate?: () => void;
}

const ProfitabilityTracker: React.FC<ProfitabilityTrackerProps> = ({
  clientId, claimId, onUpdate,
}) => {
  const queryClient = useQueryClient();
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [form] = Form.useForm();

  const { data: profitability, isLoading } = useQuery({
    queryKey: ['profitability', clientId, claimId],
    queryFn: () => expenseService.getProfitability(clientId, claimId),
  });

  const createMutation = useMutation({
    mutationFn: (data: ClaimExpenseCreate) => expenseService.create(clientId, claimId, data),
    onSuccess: () => {
      message.success('Expense recorded');
      setExpenseModalOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['profitability', clientId, claimId] });
      onUpdate?.();
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (expenseId: string) => expenseService.delete(clientId, claimId, expenseId),
    onSuccess: () => {
      message.success('Expense deleted');
      queryClient.invalidateQueries({ queryKey: ['profitability', clientId, claimId] });
      onUpdate?.();
    },
  });

  const p = profitability;

  const columns: ColumnsType<ClaimExpense> = [
    {
      title: 'Category', dataIndex: 'category', width: 110,
      render: (c: string) => <Tag color={CAT_COLORS[c] || 'default'}>{CAT_LABELS[c] || c}</Tag>,
    },
    { title: 'Description', dataIndex: 'description', ellipsis: true },
    {
      title: 'Vendor', dataIndex: 'vendor_name', width: 120, ellipsis: true,
      render: (v?: string) => v || '-',
    },
    {
      title: 'Amount', dataIndex: 'amount', width: 100, align: 'right',
      render: (v: number) => <Text strong>{formatCurrency(v)}</Text>,
    },
    {
      title: 'Date', dataIndex: 'expense_date', width: 90,
      render: (d?: string) => d ? dayjs(d).format('MM/DD/YY') : '-',
    },
    {
      title: '', key: 'actions', width: 40,
      render: (_, r) => (
        <Popconfirm title="Delete?" onConfirm={() => deleteMutation.mutate(r.id)}
          okButtonProps={{ danger: true }}>
          <Button type="text" size="small" icon={<DeleteOutlined />} danger />
        </Popconfirm>
      ),
    },
  ];

  const netProfit = p?.net_profit || 0;
  const netMargin = p?.net_margin_pct || 0;
  const isProfitable = netProfit >= 0;

  return (
    <div>
      {/* Profitability Summary */}
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={12} sm={6}>
          <Statistic title="Revenue" value={p?.total_insurance_paid || 0}
            prefix="$" precision={2} loading={isLoading} valueStyle={{ fontSize: 15 }} />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic title="PA Fee" value={p?.pa_fee_amount || 0}
            prefix="-$" precision={2} loading={isLoading}
            suffix={p?.pa_fee_percentage ? `(${p.pa_fee_percentage}%)` : ''}
            valueStyle={{ fontSize: 15, color: (p?.pa_fee_amount || 0) > 0 ? '#cf1322' : undefined }} />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic title="Total Expenses" value={p?.total_expenses || 0}
            prefix="-$" precision={2} loading={isLoading}
            valueStyle={{ fontSize: 15, color: (p?.total_expenses || 0) > 0 ? '#cf1322' : undefined }} />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic title="Net Profit" value={Math.abs(netProfit)}
            prefix={isProfitable ? '$' : '-$'} precision={2} loading={isLoading}
            suffix={<span style={{ fontSize: 12 }}>({netMargin}%)</span>}
            valueStyle={{ fontSize: 15, color: isProfitable ? '#3f8600' : '#cf1322' }} />
        </Col>
      </Row>

      {/* Cost Breakdown */}
      {(p?.total_expenses || 0) > 0 && (
        <Row gutter={[8, 4]} style={{ marginBottom: 12 }}>
          {[
            { label: 'Material', value: p?.total_material },
            { label: 'Labor', value: p?.total_labor },
            { label: 'Subcontractor', value: p?.total_subcontractor },
            { label: 'Equipment', value: p?.total_equipment },
            { label: 'Other', value: p?.total_other_expenses },
          ].filter(i => (i.value || 0) > 0).map(item => (
            <Col key={item.label}>
              <Tag>
                {item.label}: {formatCurrency(item.value)}
              </Tag>
            </Col>
          ))}
        </Row>
      )}

      {/* Margin Bar */}
      {(p?.total_insurance_paid || 0) > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>Profit Margin</Text>
          <Progress
            percent={Math.max(0, Math.min(100, netMargin))}
            status={isProfitable ? 'success' : 'exception'}
            size="small"
            format={() => `${netMargin}%`}
          />
        </div>
      )}

      <Divider style={{ margin: '8px 0' }} />

      {/* Expenses Table */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Text strong>Expenses</Text>
        <Button type="primary" size="small" icon={<PlusOutlined />}
          onClick={() => setExpenseModalOpen(true)}>
          Add Expense
        </Button>
      </div>

      <Table dataSource={p?.expenses || []} columns={columns} rowKey="id"
        size="small" loading={isLoading} pagination={false}
        locale={{ emptyText: 'No expenses recorded yet' }}
        summary={(data) => {
          const total = data.reduce((sum, e) => sum + (e.amount || 0), 0);
          return total > 0 ? (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={3}>
                <Text strong>Total</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right">
                <Text strong>{formatCurrency(total)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} colSpan={2} />
            </Table.Summary.Row>
          ) : null;
        }}
      />

      {/* Add Expense Modal */}
      <Modal title="Add Expense" open={expenseModalOpen} width={480}
        onOk={() => form.validateFields().then(v => {
          createMutation.mutate({
            ...v,
            claim_id: claimId,
            expense_date: v.expense_date?.toISOString(),
          });
        })}
        onCancel={() => { setExpenseModalOpen(false); form.resetFields(); }}
        confirmLoading={createMutation.isPending}>
        <Form form={form} layout="vertical" size="small">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="category" label="Category" rules={[{ required: true }]}>
                <Select options={Object.entries(CAT_LABELS).map(([k, v]) => ({ value: k, label: v }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="amount" label="Amount" rules={[{ required: true }]}>
                <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="Description" rules={[{ required: true }]}>
            <Input placeholder="e.g., Drywall sheets, 4x8" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="vendor_name" label="Vendor">
                <Input placeholder="Home Depot, etc." />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="expense_date" label="Date">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ProfitabilityTracker;
