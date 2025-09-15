import React, { useState } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  DatePicker,
  Space,
  Tag,
  Tooltip,
  message,
  Card,
  Row,
  Col,
  Popconfirm,
  Badge,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  FileTextOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

const { Option } = Select;
const { TextArea } = Input;

// License types (should match backend)
const LICENSE_TYPES = [
  { id: 'GC', name: 'General Contractor', code: 'GC' },
  { id: 'EC', name: 'Electrical Contractor', code: 'EC' },
  { id: 'PC', name: 'Plumbing Contractor', code: 'PC' },
  { id: 'HVAC', name: 'HVAC Contractor', code: 'HVAC' },
  { id: 'RC', name: 'Roofing Contractor', code: 'RC' },
  { id: 'BL', name: 'Business License', code: 'BL' },
  { id: 'SC', name: 'Specialty Contractor', code: 'SC' },
];

interface License {
  id?: string;
  license_type_id: string;
  license_type_name?: string;
  license_number: string;
  license_class?: string;
  issued_date?: string;
  expiration_date: string;
  issuing_authority?: string;
  status: 'active' | 'expired' | 'suspended' | 'pending';
  notes?: string;
  document_url?: string;
}

interface LicenseManagerProps {
  companyId?: string;
  licenses: License[];
  onChange: (licenses: License[]) => void;
  disabled?: boolean;
}

const LicenseManager: React.FC<LicenseManagerProps> = ({
  companyId,
  licenses = [],
  onChange,
  disabled = false,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLicense, setEditingLicense] = useState<License | null>(null);
  const [form] = Form.useForm();

  const handleAdd = () => {
    setEditingLicense(null);
    form.resetFields();
    form.setFieldsValue({
      status: 'active',
    });
    setIsModalOpen(true);
  };

  const handleEdit = (license: License) => {
    setEditingLicense(license);
    form.setFieldsValue({
      ...license,
      issued_date: license.issued_date ? dayjs(license.issued_date) : null,
      expiration_date: dayjs(license.expiration_date),
    });
    setIsModalOpen(true);
  };

  const handleDelete = (licenseId: string | undefined) => {
    if (!licenseId) return;
    
    const updatedLicenses = licenses.filter(l => l.id !== licenseId);
    onChange(updatedLicenses);
    message.success('License removed successfully');
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const licenseData: License = {
        ...values,
        issued_date: values.issued_date ? values.issued_date.format('YYYY-MM-DD') : null,
        expiration_date: values.expiration_date.format('YYYY-MM-DD'),
        license_type_name: LICENSE_TYPES.find(t => t.id === values.license_type_id)?.name,
      };

      let updatedLicenses: License[];
      if (editingLicense?.id) {
        // Update existing license
        updatedLicenses = licenses.map(l =>
          l.id === editingLicense.id ? { ...licenseData, id: l.id } : l
        );
        message.success('License updated successfully');
      } else {
        // Add new license
        const newLicense = {
          ...licenseData,
          id: `temp_${Date.now()}`, // Temporary ID for new licenses
        };
        updatedLicenses = [...licenses, newLicense];
        message.success('License added successfully');
      }

      onChange(updatedLicenses);
      setIsModalOpen(false);
      form.resetFields();
      setEditingLicense(null);
    } catch (error) {
      console.error('Validation failed:', error);
    }
  };

  const getStatusTag = (status: string, expirationDate: string) => {
    const daysUntilExpiration = dayjs(expirationDate).diff(dayjs(), 'day');
    
    if (status === 'suspended') {
      return <Tag color="red" icon={<ExclamationCircleOutlined />}>Suspended</Tag>;
    }
    
    if (status === 'pending') {
      return <Tag color="blue" icon={<ClockCircleOutlined />}>Pending</Tag>;
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

  const columns: ColumnsType<License> = [
    {
      title: 'License Type',
      dataIndex: 'license_type_name',
      key: 'license_type_name',
      render: (text) => (
        <Space>
          <FileTextOutlined />
          <strong>{text}</strong>
        </Space>
      ),
    },
    {
      title: 'License Number',
      dataIndex: 'license_number',
      key: 'license_number',
    },
    {
      title: 'Class',
      dataIndex: 'license_class',
      key: 'license_class',
      width: 100,
      render: (text) => text || '-',
    },
    {
      title: 'Expiration Date',
      dataIndex: 'expiration_date',
      key: 'expiration_date',
      render: (date) => dayjs(date).format('MMM DD, YYYY'),
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, record) => getStatusTag(record.status, record.expiration_date),
    },
    {
      title: 'Issuing Authority',
      dataIndex: 'issuing_authority',
      key: 'issuing_authority',
      ellipsis: true,
      render: (text) => text || '-',
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
            title="Delete License"
            description="Are you sure you want to delete this license?"
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
  const totalLicenses = licenses.length;
  const activeLicenses = licenses.filter(l => {
    const daysUntilExpiration = dayjs(l.expiration_date).diff(dayjs(), 'day');
    return l.status === 'active' && daysUntilExpiration >= 0;
  }).length;
  const expiringLicenses = licenses.filter(l => {
    const daysUntilExpiration = dayjs(l.expiration_date).diff(dayjs(), 'day');
    return daysUntilExpiration >= 0 && daysUntilExpiration <= 90;
  }).length;
  const expiredLicenses = licenses.filter(l => {
    const daysUntilExpiration = dayjs(l.expiration_date).diff(dayjs(), 'day');
    return daysUntilExpiration < 0;
  }).length;

  return (
    <Card
      title={
        <Space>
          <FileTextOutlined />
          <span>Licenses</span>
        </Space>
      }
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleAdd}
          disabled={disabled}
        >
          Add License
        </Button>
      }
    >
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Badge count={totalLicenses} showZero color="#1890ff">
            <Card size="small" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#666' }}>Total Licenses</div>
            </Card>
          </Badge>
        </Col>
        <Col span={6}>
          <Badge count={activeLicenses} showZero color="#52c41a">
            <Card size="small" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#666' }}>Active</div>
            </Card>
          </Badge>
        </Col>
        <Col span={6}>
          <Badge count={expiringLicenses} showZero color="#faad14">
            <Card size="small" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#666' }}>Expiring Soon</div>
            </Card>
          </Badge>
        </Col>
        <Col span={6}>
          <Badge count={expiredLicenses} showZero color="#ff4d4f">
            <Card size="small" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#666' }}>Expired</div>
            </Card>
          </Badge>
        </Col>
      </Row>

      <Table
        columns={columns}
        dataSource={licenses}
        rowKey={record => record.id || `${record.license_type_id}_${record.license_number}`}
        pagination={false}
        size="small"
      />

      <Modal
        title={editingLicense ? 'Edit License' : 'Add License'}
        open={isModalOpen}
        onOk={handleSubmit}
        onCancel={() => {
          setIsModalOpen(false);
          form.resetFields();
          setEditingLicense(null);
        }}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            status: 'active',
          }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="license_type_id"
                label="License Type"
                rules={[{ required: true, message: 'Please select license type' }]}
              >
                <Select placeholder="Select license type">
                  {LICENSE_TYPES.map(type => (
                    <Option key={type.id} value={type.id}>
                      {type.name}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="license_number"
                label="License Number"
                rules={[{ required: true, message: 'Please enter license number' }]}
              >
                <Input placeholder="Enter license number" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="license_class"
                label="License Class"
              >
                <Input placeholder="e.g., A, B, C" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="issued_date"
                label="Issue Date"
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
            <Col span={12}>
              <Form.Item
                name="issuing_authority"
                label="Issuing Authority"
              >
                <Input placeholder="e.g., State Licensing Board" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="status"
                label="Status"
                rules={[{ required: true }]}
              >
                <Select>
                  <Option value="active">Active</Option>
                  <Option value="pending">Pending</Option>
                  <Option value="suspended">Suspended</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="notes"
            label="Notes"
          >
            <TextArea rows={3} placeholder="Additional notes about this license" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default LicenseManager;