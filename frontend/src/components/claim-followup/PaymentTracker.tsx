import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
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
  Statistic,
  Alert,
  Popconfirm,
  Divider,
  Tooltip,
  Switch,
  Upload,
} from 'antd';
import {
  PlusOutlined,
  DollarOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ExclamationCircleOutlined,
  DeleteOutlined,
  FilePdfOutlined,
  UploadOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { paymentService, claimService } from '../../services/clientService';
import type { ClaimPayment, ClaimPaymentCreate, PaymentSummary } from '../../types/client';
import type { ColumnsType } from 'antd/es/table';

const { Text, Title } = Typography;

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

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  unpaid: 'red',
  partial: 'orange',
  paid: 'green',
  overpaid: 'blue',
  disputed: 'volcano',
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
      width: 160,
      render: (type: string) => PAYMENT_TYPE_LABELS[type] || type,
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      width: 120,
      align: 'right',
      render: (amount: number) => <Text strong>{formatCurrency(amount)}</Text>,
    },
    {
      title: 'Check #',
      dataIndex: 'check_number',
      key: 'check_number',
      width: 120,
      render: (val?: string) => val || '-',
    },
    {
      title: 'Date Received',
      dataIndex: 'received_date',
      key: 'received_date',
      width: 120,
      render: (date?: string) => date ? dayjs(date).format('MM/DD/YYYY') : '-',
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: '',
      key: 'actions',
      width: 50,
      render: (_, record) => (
        <Popconfirm
          title="Delete this payment?"
          onConfirm={() => deleteMutation.mutate(record.id)}
          okText="Delete"
          okButtonProps={{ danger: true }}
        >
          <Button type="text" size="small" icon={<DeleteOutlined />} danger />
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
      {/* Payment Summary */}
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} sm={6}>
          <Statistic
            title="Invoice Amount"
            value={summary?.total_invoice_amount || 0}
            prefix="$"
            precision={2}
            loading={isLoading}
            valueStyle={{ fontSize: 16 }}
          />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic
            title="Insurance Paid"
            value={summary?.total_insurance_paid || 0}
            prefix="$"
            precision={2}
            loading={isLoading}
            valueStyle={{ fontSize: 16, color: (summary?.total_insurance_paid || 0) > 0 ? '#3f8600' : undefined }}
          />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic
            title="Difference"
            value={Math.abs(difference)}
            prefix={isUnderpaid ? '-$' : '$'}
            precision={2}
            loading={isLoading}
            valueStyle={{ fontSize: 16, color: hasDifference ? (isUnderpaid ? '#cf1322' : '#3f8600') : undefined }}
          />
        </Col>
        <Col xs={12} sm={6}>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Status</Text>
            <div>
              <Tag
                color={PAYMENT_STATUS_COLORS[summary?.payment_status || 'unpaid']}
                style={{ marginTop: 4 }}
              >
                {(summary?.payment_status || 'unpaid').toUpperCase()}
              </Tag>
            </div>
          </div>
        </Col>
      </Row>

      {/* Alerts */}
      {hasDifference && isUnderpaid && (summary?.total_insurance_paid || 0) > 0 && (
        <Alert
          message={`Payment difference: ${formatCurrency(difference)} remaining`}
          description={summary?.needs_supplement
            ? 'A supplement may be needed to cover the difference.'
            : 'Follow up with the insurance company for the remaining balance.'
          }
          type="warning"
          showIcon
          icon={<ExclamationCircleOutlined />}
          style={{ marginBottom: 12 }}
        />
      )}

      {/* Insurance Estimate Status */}
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12}>
          <Space>
            <Text type="secondary">Insurance Estimate Received:</Text>
            {summary?.insurance_estimate_received ? (
              <Tag icon={<CheckCircleOutlined />} color="success">Received</Tag>
            ) : (
              <Tag icon={<WarningOutlined />} color="warning">Not Yet</Tag>
            )}
          </Space>
        </Col>
        <Col xs={12}>
          <Space>
            <Text type="secondary">Supplement Needed:</Text>
            {summary?.needs_supplement ? (
              <Tag icon={<ExclamationCircleOutlined />} color="warning">Yes</Tag>
            ) : (
              <Tag color="default">No</Tag>
            )}
          </Space>
        </Col>
      </Row>

      <Divider style={{ margin: '8px 0' }} />

      {/* Payments Table */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Text strong>Payment History</Text>
        <Button
          type="primary"
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
        locale={{ emptyText: 'No payments recorded yet' }}
      />

      {/* Add Payment Modal */}
      <Modal
        title="Record Payment"
        open={paymentModalOpen}
        onOk={handleSubmit}
        onCancel={() => { setPaymentModalOpen(false); form.resetFields(); }}
        confirmLoading={createMutation.isPending}
        width={500}
      >
        <Form form={form} layout="vertical" size="small">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="payment_type" label="Payment Type" rules={[{ required: true }]} initialValue="insurance">
                <Select options={Object.entries(PAYMENT_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="amount" label="Amount" rules={[{ required: true }]}>
                <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="check_number" label="Check #">
                <Input placeholder="Check number" />
              </Form.Item>
            </Col>
            <Col span={12}>
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
