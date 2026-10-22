import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  DatePicker,
  message,
  Typography,
  Row,
  Col,
  Popconfirm,
} from 'antd';
import {
  PlusOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ExclamationCircleOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { paymentService } from '../../services/clientService';
import type { ClaimPayment, ClaimPaymentCreate } from '../../types/client';
import { Pill, useSheetModal, type TagTone } from '../common/ui';
import type { ColumnsType } from 'antd/es/table';

const { Text } = Typography;

interface PaymentTrackerProps {
  clientId: string;
  claimId: string;
  claimNumber: string;
  insuranceCompany?: string;
  onClaimUpdate?: () => void;
}

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  insurance: 'Insurance Payment',
  depreciation_recovery: 'Depreciation Recovery',
  supplement: 'Supplement Payment',
  deductible: 'Deductible',
  other: 'Other',
};

const PAYMENT_STATUS: Record<string, { tone: TagTone; label: string }> = {
  unpaid: { tone: 'red', label: 'Unpaid' },
  partial: { tone: 'orange', label: 'Partial' },
  paid: { tone: 'green', label: 'Paid' },
  overpaid: { tone: 'blue', label: 'Overpaid' },
  disputed: { tone: 'red', label: 'Disputed' },
};

const PaymentTracker: React.FC<PaymentTrackerProps> = ({
  clientId,
  claimId,
  claimNumber,
  insuranceCompany,
  onClaimUpdate,
}) => {
  const queryClient = useQueryClient();
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [form] = Form.useForm();
  const { isPhone, sheetProps } = useSheetModal();

  // Query payment summary
  const { data: summary, isLoading } = useQuery({
    queryKey: ['payment-summary', clientId, claimId],
    queryFn: () => paymentService.getSummary(clientId, claimId),
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: ClaimPaymentCreate) => paymentService.create(clientId, claimId, data),
    onSuccess: () => {
      message.success('Payment recorded');
      setPaymentModalOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['payment-summary', clientId, claimId] });
      queryClient.invalidateQueries({ queryKey: ['claims', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      onClaimUpdate?.();
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Failed to record payment'),
  });

  const deleteMutation = useMutation({
    mutationFn: (paymentId: string) => paymentService.delete(clientId, claimId, paymentId),
    onSuccess: () => {
      message.success('Payment deleted');
      queryClient.invalidateQueries({ queryKey: ['payment-summary', clientId, claimId] });
      queryClient.invalidateQueries({ queryKey: ['claims', clientId] });
      onClaimUpdate?.();
    },
  });

  const formatCurrency = (val?: number) => {
    if (val == null) return '$0.00';
    return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const difference = (summary?.total_invoice_amount || 0) - (summary?.total_insurance_paid || 0);
  const hasDifference = Math.abs(difference) > 0.01;
  const isUnderpaid = difference > 0.01;

  const columns: ColumnsType<ClaimPayment> = [
    {
      title: 'Type',
      dataIndex: 'payment_type',
      key: 'payment_type',
      width: isPhone ? undefined : 160,
      // Phones fold check #, date and description under the type
      render: (type: string, record) => {
        const label = PAYMENT_TYPE_LABELS[type] || type;
        if (!isPhone) return label;
        const meta = [
          record.check_number && `#${record.check_number}`,
          record.received_date && dayjs(record.received_date).format('MM/DD/YYYY'),
          record.description,
        ].filter(Boolean).join(' · ');
        return (
          <>
            <div>{label}</div>
            {meta && <Text type="secondary" style={{ fontSize: 12 }}>{meta}</Text>}
          </>
        );
      },
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      width: 120,
      align: 'right',
      render: (amount: number) => <span className="cl-money cl-money--strong">{formatCurrency(amount)}</span>,
    },
    {
      title: 'Check #',
      dataIndex: 'check_number',
      key: 'check_number',
      width: 120,
      responsive: ['md'],
      render: (val?: string) => val || '-',
    },
    {
      title: 'Date Received',
      dataIndex: 'received_date',
      key: 'received_date',
      width: 120,
      responsive: ['md'],
      render: (date?: string) => date ? dayjs(date).format('MM/DD/YYYY') : '-',
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      responsive: ['md'],
    },
    {
      title: '',
      key: 'actions',
      width: 50,
      align: 'right',
      render: (_, record) => (
        <Popconfirm
          title="Delete this payment?"
          onConfirm={() => deleteMutation.mutate(record.id)}
          okText="Delete"
          okButtonProps={{ danger: true }}
        >
          <Button type="text" size="small" icon={<DeleteOutlined />}
            className="ui-icon-btn ui-icon-btn--danger cl-touch-icon" aria-label="Delete payment" />
        </Popconfirm>
      ),
    },
  ];

  const handleSubmit = () => {
    form.validateFields().then(values => {
      const payload: ClaimPaymentCreate = {
        claim_id: claimId,
        payment_type: values.payment_type,
        amount: values.amount,
        check_number: values.check_number,
        check_date: values.check_date?.toISOString(),
        received_date: values.received_date?.toISOString(),
        paid_by: values.paid_by || insuranceCompany,
        description: values.description,
        notes: values.notes,
      };
      createMutation.mutate(payload);
    });
  };

  return (
    <div>
      {/* Payment Summary: figures on the sheet, money in ink */}
      <dl className="cl-figures">
        <div className="cl-figure">
          <dt>Invoice amount</dt>
          <dd>{isLoading ? '…' : formatCurrency(summary?.total_invoice_amount || 0)}</dd>
        </div>
        <div className="cl-figure">
          <dt>Insurance paid</dt>
          <dd>{isLoading ? '…' : formatCurrency(summary?.total_insurance_paid || 0)}</dd>
        </div>
        <div className="cl-figure">
          <dt>{isUnderpaid ? 'Still owed' : 'Difference'}</dt>
          <dd className={hasDifference && isUnderpaid ? 'is-owed' : undefined}>
            {isLoading ? '…' : `${isUnderpaid ? '−' : ''}${formatCurrency(Math.abs(difference))}`}
          </dd>
        </div>
        <div className="cl-figure">
          <dt>Status</dt>
          <dd>
            <Pill tone={(PAYMENT_STATUS[summary?.payment_status || 'unpaid'] || PAYMENT_STATUS.unpaid).tone}>
              {(PAYMENT_STATUS[summary?.payment_status || 'unpaid'] || PAYMENT_STATUS.unpaid).label}
            </Pill>
          </dd>
        </div>
        <div className="cl-figure">
          <dt>Estimate</dt>
          <dd>
            {summary?.insurance_estimate_received
              ? <Pill tone="green" icon={<CheckCircleOutlined />}>Received</Pill>
              : <Pill tone="orange" icon={<WarningOutlined />}>Not yet</Pill>}
          </dd>
        </div>
        <div className="cl-figure">
          <dt>Supplement</dt>
          <dd>
            {summary?.needs_supplement
              ? <Pill tone="orange" icon={<ExclamationCircleOutlined />}>Needed</Pill>
              : <Pill tone="gray">No</Pill>}
          </dd>
        </div>
      </dl>

      {hasDifference && isUnderpaid && (summary?.total_insurance_paid || 0) > 0 && (
        <div className="cl-note cl-note--orange" role="note">
          <strong>{formatCurrency(difference)} remaining.</strong>{' '}
          {summary?.needs_supplement
            ? 'A supplement may be needed to cover the difference.'
            : 'Follow up with the insurance company for the remaining balance.'}
        </div>
      )}

      <div className="cl-subhead">
        <span className="cl-subhead-title">Payment history</span>
        <Button
          type="text"
          size="small"
          icon={<PlusOutlined />}
          onClick={() => setPaymentModalOpen(true)}
        >
          Record Payment
        </Button>
      </div>

      <Table
        dataSource={summary?.payments || []}
        columns={columns}
        rowKey="id"
        size="small"
        loading={isLoading}
        pagination={false}
        className="cl-table"
        locale={{ emptyText: <div className="cl-empty">No payments recorded yet.</div> }}
      />

      {/* Add Payment Modal */}
      <Modal
        title="Record Payment"
        open={paymentModalOpen}
        onOk={handleSubmit}
        onCancel={() => { setPaymentModalOpen(false); form.resetFields(); }}
        confirmLoading={createMutation.isPending}
        width={500}
        {...sheetProps}
      >
        <Form form={form} layout="vertical" size={isPhone ? undefined : 'small'} className="cl-form">
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item name="payment_type" label="Payment Type" rules={[{ required: true }]} initialValue="insurance">
                <Select options={Object.entries(PAYMENT_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="amount" label="Amount" rules={[{ required: true }]}>
                <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item name="check_number" label="Check #">
                <Input placeholder="Check number" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="received_date" label="Date Received">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="paid_by" label="Paid By" initialValue={insuranceCompany}>
            <Input placeholder="Insurance company" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} placeholder="Payment description" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default PaymentTracker;
