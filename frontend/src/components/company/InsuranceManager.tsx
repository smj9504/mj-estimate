import React, { useState } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  DatePicker,
  InputNumber,
  Space,
  Tag,
  Tooltip,
  message,
  Card,
  Row,
  Col,
  Popconfirm,
  Badge,
  Switch,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SafetyOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  DollarOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

const { Option } = Select;
const { TextArea } = Input;

// Insurance types (should match backend)
const INSURANCE_TYPES = [
  { id: 'GL', name: 'General Liability', code: 'GL', minCoverage: 1000000 },
  { id: 'WC', name: 'Workers Compensation', code: 'WC', minCoverage: 500000 },
  { id: 'CA', name: 'Commercial Auto', code: 'CA', minCoverage: 500000 },
  { id: 'PL', name: 'Professional Liability', code: 'PL', minCoverage: 1000000 },
  { id: 'UP', name: 'Umbrella Policy', code: 'UP', minCoverage: 2000000 },
  { id: 'PI', name: 'Property Insurance', code: 'PI', minCoverage: null },
  { id: 'BOND', name: 'Bonding', code: 'BOND', minCoverage: null },
];

interface Insurance {
  id?: string;
  insurance_type_id: string;
  insurance_type_name?: string;
  policy_number: string;
  provider: string;
  coverage_amount: number;
  deductible?: number;
  effective_date: string;
  expiration_date: string;
  status: 'active' | 'expired' | 'cancelled' | 'pending';
  is_primary: boolean;
  notes?: string;
  certificate_url?: string;
}

interface InsuranceManagerProps {
  companyId?: string;
  insurancePolicies: Insurance[];
  onChange: (policies: Insurance[]) => void;
  disabled?: boolean;
}

const InsuranceManager: React.FC<InsuranceManagerProps> = ({
  companyId,
  insurancePolicies = [],
  onChange,
  disabled = false,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<Insurance | null>(null);
  const [form] = Form.useForm();

  const handleAdd = () => {
    setEditingPolicy(null);
    form.resetFields();
    form.setFieldsValue({
      status: 'active',
      is_primary: false,
    });
    setIsModalOpen(true);
  };

  const handleEdit = (policy: Insurance) => {
    setEditingPolicy(policy);
    form.setFieldsValue({
      ...policy,
      effective_date: dayjs(policy.effective_date),
      expiration_date: dayjs(policy.expiration_date),
    });
    setIsModalOpen(true);
  };

  const handleDelete = (policyId: string | undefined) => {
    if (!policyId) return;
    
    const updatedPolicies = insurancePolicies.filter(p => p.id !== policyId);
    onChange(updatedPolicies);
    message.success('Insurance policy removed successfully');
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const policyData: Insurance = {
        ...values,
        effective_date: values.effective_date.format('YYYY-MM-DD'),
        expiration_date: values.expiration_date.format('YYYY-MM-DD'),
        insurance_type_name: INSURANCE_TYPES.find(t => t.id === values.insurance_type_id)?.name,
      };

      let updatedPolicies: Insurance[];
      if (editingPolicy?.id) {
        // Update existing policy
        updatedPolicies = insurancePolicies.map(p =>
          p.id === editingPolicy.id ? { ...policyData, id: p.id } : p
        );
        message.success('Insurance policy updated successfully');
      } else {
        // Add new policy
        const newPolicy = {
          ...policyData,
          id: `temp_${Date.now()}`, // Temporary ID for new policies
        };
        updatedPolicies = [...insurancePolicies, newPolicy];
        message.success('Insurance policy added successfully');
      }

      // Ensure only one primary policy per insurance type
      if (policyData.is_primary) {
        updatedPolicies = updatedPolicies.map(p =>
          p.insurance_type_id === policyData.insurance_type_id && p.id !== (editingPolicy?.id || policyData.id)
            ? { ...p, is_primary: false }
            : p
        );
      }

      onChange(updatedPolicies);
      setIsModalOpen(false);
      form.resetFields();
      setEditingPolicy(null);
    } catch (error) {
      console.error('Validation failed:', error);
    }
  };

  const getStatusTag = (status: string, effectiveDate: string, expirationDate: string) => {
    const now = dayjs();
    const effective = dayjs(effectiveDate);
    const expiration = dayjs(expirationDate);
    const daysUntilExpiration = expiration.diff(now, 'day');
    
    if (status === 'cancelled') {
      return <Tag color="red" icon={<ExclamationCircleOutlined />}>Cancelled</Tag>;
    }
    
    if (status === 'pending') {
      return <Tag color="blue" icon={<ClockCircleOutlined />}>Pending</Tag>;
    }
    
    if (now.isBefore(effective)) {
      return <Tag color="blue" icon={<ClockCircleOutlined />}>Not Yet Effective</Tag>;
    }
    
    if (daysUntilExpiration < 0) {
      return <Tag color="red" icon={<ExclamationCircleOutlined />}>Expired</Tag>;
    }
    
    if (daysUntilExpiration <= 30) {
      return <Tag color="orange" icon={<WarningOutlined />}>Expiring Soon</Tag>;
    }
    
    if (daysUntilExpiration <= 90) {
      return <Tag color="gold" icon={<ClockCircleOutlined />}>Expires in {daysUntilExpiration} days</Tag>;
    }
    
    return <Tag color="green" icon={<CheckCircleOutlined />}>Active</Tag>;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const columns: ColumnsType<Insurance> = [
    {
      title: 'Insurance Type',
      dataIndex: 'insurance_type_name',
      key: 'insurance_type_name',
      render: (text, record) => (
        <Space>
          <SafetyOutlined />
          <strong>{text}</strong>
          {record.is_primary && <Tag color="blue">Primary</Tag>}
        </Space>
      ),
    },
    {
      title: 'Policy Number',
      dataIndex: 'policy_number',
      key: 'policy_number',
    },
    {
      title: 'Provider',
      dataIndex: 'provider',
      key: 'provider',
    },
    {
      title: 'Coverage',
      dataIndex: 'coverage_amount',
      key: 'coverage_amount',
      render: (amount) => (
        <Space>
          <DollarOutlined />
          {formatCurrency(amount)}
        </Space>
      ),
    },
    {
      title: 'Effective Period',
      key: 'period',
      render: (_, record) => (
        <div>
          <div>{dayjs(record.effective_date).format('MMM DD, YYYY')}</div>
          <div style={{ fontSize: 12, color: '#666' }}>
            to {dayjs(record.expiration_date).format('MMM DD, YYYY')}
          </div>
        </div>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, record) => getStatusTag(record.status, record.effective_date, record.expiration_date),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_, record) => (
        <Space>
          <Tooltip title="Edit">
            <Button
              type="link"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
              disabled={disabled}
            />
          </Tooltip>
          <Popconfirm
            title="Delete Insurance Policy"
            description="Are you sure you want to delete this insurance policy?"
            onConfirm={() => handleDelete(record.id)}
            okText="Yes"
            cancelText="No"
          >
            <Tooltip title="Delete">
              <Button
                type="link"
                danger
                icon={<DeleteOutlined />}
                disabled={disabled}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // Calculate summary statistics
  const totalPolicies = insurancePolicies.length;
  const activePolicies = insurancePolicies.filter(p => {
    const now = dayjs();
    const effective = dayjs(p.effective_date);
    const expiration = dayjs(p.expiration_date);
    return p.status === 'active' && now.isAfter(effective) && now.isBefore(expiration);
  }).length;
  const expiringPolicies = insurancePolicies.filter(p => {
    const daysUntilExpiration = dayjs(p.expiration_date).diff(dayjs(), 'day');
    return daysUntilExpiration >= 0 && daysUntilExpiration <= 90;
  }).length;
  const expiredPolicies = insurancePolicies.filter(p => {
    const daysUntilExpiration = dayjs(p.expiration_date).diff(dayjs(), 'day');
    return daysUntilExpiration < 0;
  }).length;

  // Calculate total coverage
  const totalCoverage = insurancePolicies
    .filter(p => p.status === 'active')
    .reduce((sum, p) => sum + p.coverage_amount, 0);

  return (
    <Card
      title={
        <Space>
          <SafetyOutlined />
          <span>Insurance Policies</span>
        </Space>
      }
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleAdd}
          disabled={disabled}
        >
          Add Insurance
        </Button>
      }
    >
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Badge count={totalPolicies} showZero color="#1890ff">
            <Card size="small" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#666' }}>Total Policies</div>
            </Card>
          </Badge>
        </Col>
        <Col span={6}>
          <Badge count={activePolicies} showZero color="#52c41a">
            <Card size="small" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#666' }}>Active</div>
            </Card>
          </Badge>
        </Col>
        <Col span={6}>
          <Badge count={expiringPolicies} showZero color="#faad14">
            <Card size="small" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#666' }}>Expiring Soon</div>
            </Card>
          </Badge>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ textAlign: 'center', background: '#f0f5ff' }}>
            <div style={{ fontSize: 16, fontWeight: 'bold', color: '#1890ff' }}>
              {formatCurrency(totalCoverage)}
            </div>
            <div style={{ fontSize: 12, color: '#666' }}>Total Coverage</div>
          </Card>
        </Col>
      </Row>

      <Table
        columns={columns}
        dataSource={insurancePolicies}
        rowKey={record => record.id || `${record.insurance_type_id}_${record.policy_number}`}
        pagination={false}
        size="small"
      />

      <Modal
        title={editingPolicy ? 'Edit Insurance Policy' : 'Add Insurance Policy'}
        open={isModalOpen}
        onOk={handleSubmit}
        onCancel={() => {
          setIsModalOpen(false);
          form.resetFields();
          setEditingPolicy(null);
        }}
        width={700}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            status: 'active',
            is_primary: false,
          }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="insurance_type_id"
                label="Insurance Type"
                rules={[{ required: true, message: 'Please select insurance type' }]}
              >
                <Select
                  placeholder="Select insurance type"
                  onChange={(value) => {
                    const type = INSURANCE_TYPES.find(t => t.id === value);
                    if (type?.minCoverage) {
                      form.setFieldsValue({ coverage_amount: type.minCoverage });
                    }
                  }}
                >
                  {INSURANCE_TYPES.map(type => (
                    <Option key={type.id} value={type.id}>
                      {type.name}
                      {type.minCoverage && ` (Min: ${formatCurrency(type.minCoverage)})`}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="policy_number"
                label="Policy Number"
                rules={[{ required: true, message: 'Please enter policy number' }]}
              >
                <Input placeholder="Enter policy number" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="provider"
                label="Insurance Provider"
                rules={[{ required: true, message: 'Please enter provider name' }]}
              >
                <Input placeholder="e.g., State Farm, Allstate" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="coverage_amount"
                label="Coverage Amount"
                rules={[{ required: true, message: 'Please enter coverage amount' }]}
              >
                <InputNumber<number>
                  style={{ width: '100%' }}
                  formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={value => {
                    const parsed = value!.replace(/\$\s?|(,*)/g, '');
                    return parsed === '' ? 0 : Number(parsed);
                  }}
                  min={0}
                  placeholder="Enter coverage amount"
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="deductible"
                label="Deductible"
              >
                <InputNumber<number>
                  style={{ width: '100%' }}
                  formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={value => {
                    const parsed = value!.replace(/\$\s?|(,*)/g, '');
                    return parsed === '' ? 0 : Number(parsed);
                  }}
                  min={0}
                  placeholder="Enter deductible"
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="effective_date"
                label="Effective Date"
                rules={[{ required: true, message: 'Please select effective date' }]}
              >
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="expiration_date"
                label="Expiration Date"
                rules={[{ required: true, message: 'Please select expiration date' }]}
              >
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="status"
                label="Status"
                rules={[{ required: true }]}
              >
                <Select>
                  <Option value="active">Active</Option>
                  <Option value="pending">Pending</Option>
                  <Option value="cancelled">Cancelled</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="is_primary"
                label="Primary Policy"
                valuePropName="checked"
                tooltip="Mark as primary policy for this insurance type"
              >
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="notes"
            label="Notes"
          >
            <TextArea rows={3} placeholder="Additional notes about this policy" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default InsuranceManager;