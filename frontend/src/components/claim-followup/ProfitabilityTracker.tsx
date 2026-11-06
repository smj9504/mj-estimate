import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  DatePicker,
  message,
  Typography,
  Row,
  Col,
  Popconfirm,
  Segmented,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { expenseService } from '../../services/clientService';
import { EXPENSE_CATEGORY_LABELS as CAT_LABELS } from '../../types/client';
import type { ClaimExpense, ClaimExpenseCreate, ExpenseParty } from '../../types/client';
import type { ColumnsType } from 'antd/es/table';
import { useSheetModal } from '../common/ui';

const { Text } = Typography;

// The contractor's revenue is what was paid and the PA fee is one of its
// costs; the public adjuster's revenue is that fee. The server sends only the
// sides this person keeps books for (admins: both).
const SIDE_LABELS: Record<ExpenseParty, string> = {
  contractor: 'Contractor',
  public_adjuster: 'Public Adjuster',
};

const formatCurrency = (val?: number | null) => {
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
  const [chosenSide, setChosenSide] = useState<ExpenseParty | null>(null);
  const [form] = Form.useForm();
  const { isPhone, sheetProps } = useSheetModal();

  const { data: profitability, isLoading } = useQuery({
    queryKey: ['profitability', clientId, claimId],
    queryFn: () => expenseService.getProfitability(clientId, claimId),
  });

  const sides = profitability?.sides ?? [];
  const side: ExpenseParty | undefined =
    chosenSide && sides.includes(chosenSide) ? chosenSide : sides[0];
  const view = side ? profitability?.[side] : undefined;
  const isPA = side === 'public_adjuster';

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
  const paPct = p?.pa_fee_percentage || 0;
  const paFee = p?.pa_fee_amount || 0;
  const feeNote = paFee > 0 && paPct > 0
    ? `${paPct}% of ${formatCurrency(p?.insurance_received)} received from insurance`
    : null;
  const minus = (v?: number | null) => `${(v || 0) > 0 ? '−' : ''}${formatCurrency(v || 0)}`;

  const columns: ColumnsType<ClaimExpense> = [
    {
      title: 'Category', dataIndex: 'category', width: 110,
      render: (c: string) => CAT_LABELS[c] || c,
    },
    {
      title: 'Description', dataIndex: 'description', ellipsis: !isPhone,
      // Phones fold vendor and date under the description
      render: (d: string, r) => {
        if (!isPhone) return d;
        const meta = [r.vendor_name, r.expense_date && dayjs(r.expense_date).format('MM/DD/YY')]
          .filter(Boolean).join(' · ');
        return (
          <>
            <div>{d}</div>
            {meta && <Text type="secondary" style={{ fontSize: 12 }}>{meta}</Text>}
          </>
        );
      },
    },
    {
      title: 'Vendor', dataIndex: 'vendor_name', width: 120, ellipsis: true,
      render: (v?: string) => v || '-',
      responsive: ['md'],
    },
    {
      title: 'Amount', dataIndex: 'amount', width: 100, align: 'right',
      render: (v: number) => <span className="cl-money cl-money--strong">{formatCurrency(v)}</span>,
    },
    {
      title: 'Date', dataIndex: 'expense_date', width: 90,
      render: (d?: string) => d ? dayjs(d).format('MM/DD/YY') : '-',
      responsive: ['md'],
    },
    {
      title: '', key: 'actions', width: 48, align: 'right',
      render: (_, r) => (
        <Popconfirm title="Delete this expense?" onConfirm={() => deleteMutation.mutate(r.id)}
          okText="Delete" okButtonProps={{ danger: true }}>
          <Button type="text" size="small" icon={<DeleteOutlined />}
            className="ui-icon-btn ui-icon-btn--danger cl-touch-icon" aria-label="Delete expense" />
        </Popconfirm>
      ),
    },
  ];

  const netProfit = view?.net_profit || 0;
  const netMargin = view?.net_margin_pct || 0;
  const isProfitable = netProfit >= 0;

  // What the costs are made of, the PA fee first on the contractor's side
  const totals = view?.category_totals ?? {};
  const costLines = [
    ...(!isPA && paFee > 0 ? [{ label: `PA fee${paPct > 0 ? ` (${paPct}%)` : ''}`, value: paFee }] : []),
    ...Object.keys(CAT_LABELS).map(k => ({ label: CAT_LABELS[k], value: totals[k] })),
    ...Object.keys(totals).filter(k => !(k in CAT_LABELS)).map(k => ({ label: k, value: totals[k] })),
  ].filter(i => (i.value || 0) > 0);
  const deductible = view?.deductible || 0;

  return (
    <div>
      {sides.length > 1 && side && (
        <Segmented
          size="small"
          value={side}
          onChange={v => setChosenSide(v as ExpenseParty)}
          options={sides.map(s => ({ value: s, label: SIDE_LABELS[s] }))}
          style={{ marginBottom: 12 }}
        />
      )}

      {/* Profitability Summary: figures on the sheet, money in ink */}
      <dl className="cl-figures">
        {isPA ? (
          <div className="cl-figure">
            <dt>Fee income{paPct > 0 ? ` (${paPct}%)` : ''}</dt>
            <dd>{isLoading ? '…' : formatCurrency(view?.revenue || 0)}</dd>
            {feeNote && <span className="cl-figure-note">{feeNote}</span>}
          </div>
        ) : (
          <>
            <div className="cl-figure">
              <dt>Revenue (paid)</dt>
              <dd>{isLoading ? '…' : formatCurrency(view?.revenue || 0)}</dd>
            </div>
            <div className="cl-figure">
              <dt>PA fee{paPct > 0 ? ` (${paPct}%)` : ''}</dt>
              <dd>{isLoading ? '…' : minus(paFee)}</dd>
              {feeNote && <span className="cl-figure-note">{feeNote}</span>}
            </div>
          </>
        )}
        <div className="cl-figure">
          <dt>{isPA ? 'Expenses' : 'Other expenses'}</dt>
          <dd>{isLoading ? '…' : minus(view?.expense_total)}</dd>
        </div>
        <div className="cl-figure">
          <dt>Net profit</dt>
          <dd className={isProfitable ? undefined : 'is-owed'}>
            {isLoading ? '…' : `${isProfitable ? '' : '−'}${formatCurrency(Math.abs(netProfit))}`}
            <span className="cl-figure-suffix">{netMargin}%</span>
          </dd>
        </div>
      </dl>

      {/* Deductible is paid by the homeowner, beside the revenue above (the
          contractor's books only); the cost lines show what the costs are made of */}
      {isPA && !p?.has_public_adjuster && paFee === 0 && (
        <div className="cl-fact-lines">
          <div className="cl-meta">
            No public adjuster on this claim yet. Fee income shows once the claim has a PA and a fee %.
          </div>
        </div>
      )}
      {(deductible > 0 || costLines.length > 0) && (
        <div className="cl-fact-lines">
          {deductible > 0 && (
            <div>
              <span className="cl-meta">Deductible </span>
              <span className="cl-money">{formatCurrency(deductible)}</span>
              {(view?.deductible_discount || 0) > 0 && (
                <>
                  <span className="cl-meta"> − discount </span>
                  <span className="cl-money">{formatCurrency(view?.deductible_discount)}</span>
                </>
              )}
              <span className="cl-meta"> · Homeowner owes </span>
              <span className="cl-money cl-money--strong">{formatCurrency(view?.homeowner_deductible_due)}</span>
            </div>
          )}
          {costLines.length > 0 && (
            <div>
              <span className="cl-meta">Costs: </span>
              {costLines.map((item, i) => (
                <span key={item.label}>
                  {i > 0 && <span className="cl-meta"> · </span>}
                  <span className="cl-meta">{item.label} </span>
                  <span className="cl-money">{formatCurrency(item.value)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="cl-subhead">
        <span className="cl-subhead-title">
          {sides.length > 1 && side ? `${SIDE_LABELS[side]} expenses` : 'Expenses'}
        </span>
        <Button type="text" size="small" icon={<PlusOutlined />}
          disabled={!side}
          onClick={() => setExpenseModalOpen(true)}>
          Add Expense
        </Button>
      </div>

      <Table dataSource={view?.expenses || []} columns={columns} rowKey="id"
        size="small" loading={isLoading} pagination={false}
        className="cl-table"
        locale={{ emptyText: <div className="cl-empty">No expenses recorded yet.</div> }}
        summary={(data) => {
          const total = data.reduce((sum, e) => sum + (e.amount || 0), 0);
          return total > 0 ? (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={isPhone ? 2 : 3}>
                <Text strong>Total</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right">
                <span className="cl-money cl-money--strong">{formatCurrency(total)}</span>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} colSpan={isPhone ? 1 : 2} />
            </Table.Summary.Row>
          ) : null;
        }}
      />

      {/* Add Expense Modal */}
      <Modal
        title={sides.length > 1 && side ? `Add ${SIDE_LABELS[side]} Expense` : 'Add Expense'}
        open={expenseModalOpen} width={480}
        onOk={() => form.validateFields().then(v => {
          createMutation.mutate({
            ...v,
            claim_id: claimId,
            party: side,
            expense_date: v.expense_date?.toISOString(),
          });
        })}
        onCancel={() => { setExpenseModalOpen(false); form.resetFields(); }}
        confirmLoading={createMutation.isPending}
        {...sheetProps}>
        <Form form={form} layout="vertical" size={isPhone ? undefined : 'small'} className="cl-form">
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item name="category" label="Category" rules={[{ required: true }]}>
                <Select options={Object.entries(CAT_LABELS).map(([k, v]) => ({ value: k, label: v }))} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="amount" label="Amount" rules={[{ required: true }]}>
                <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="Description" rules={[{ required: true }]}>
            <Input placeholder="e.g., Drywall sheets, 4x8" />
          </Form.Item>
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item name="vendor_name" label="Vendor">
                <Input placeholder="Home Depot, etc." />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
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
