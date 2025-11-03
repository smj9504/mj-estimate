import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Modal, Form, Input, InputNumber, Switch, Space, message, Divider } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../../../services/api';
import { getErrorMessage, getErrorStatus } from '../../../api/errorHandler';

interface PaymentMethod {
  id: string;
  code: string;
  name: string;
  description?: string;
  requires_account_info: boolean;
  is_active: boolean;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

interface PaymentFrequency {
  id: string;
  code: string;
  name: string;
  description?: string;
  days_interval?: number;
  is_active: boolean;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

const PaymentConfig: React.FC = () => {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [paymentFrequencies, setPaymentFrequencies] = useState<PaymentFrequency[]>([]);
  const [loading, setLoading] = useState(false);
  const [methodModalVisible, setMethodModalVisible] = useState(false);
  const [frequencyModalVisible, setFrequencyModalVisible] = useState(false);
  const [editingMethod, setEditingMethod] = useState<PaymentMethod | null>(null);
  const [editingFrequency, setEditingFrequency] = useState<PaymentFrequency | null>(null);
  const [methodForm] = Form.useForm();
  const [frequencyForm] = Form.useForm();

  // Fetch payment methods
  const fetchPaymentMethods = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/payment-config/payment-methods', {
        params: { active_only: false }
      });
      setPaymentMethods(response.data || []);
    } catch (error) {
      // Only show error if it's not a 404 or empty data
      if (getErrorStatus(error) !== 404) {
        console.error('Error fetching payment methods:', getErrorMessage(error));
      }
      setPaymentMethods([]);
    } finally {
      setLoading(false);
    }
  };

  // Fetch payment frequencies
  const fetchPaymentFrequencies = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/payment-config/payment-frequencies', {
        params: { active_only: false }
      });
      setPaymentFrequencies(response.data || []);
    } catch (error) {
      // Only show error if it's not a 404 or empty data
      if (getErrorStatus(error) !== 404) {
        console.error('Error fetching payment frequencies:', getErrorMessage(error));
      }
      setPaymentFrequencies([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPaymentMethods();
    fetchPaymentFrequencies();
  }, []);

  // Handle payment method form submit
  const handleMethodSubmit = async (values: any) => {
    try {
      if (editingMethod) {
        await api.put(`/api/payment-config/payment-methods/${editingMethod.id}`, values);
        message.success('Payment method updated successfully');
      } else {
        await api.post('/api/payment-config/payment-methods', values);
        message.success('Payment method created successfully');
      }
      setMethodModalVisible(false);
      methodForm.resetFields();
      setEditingMethod(null);
      fetchPaymentMethods();
    } catch (error) {
      message.error(getErrorMessage(error) || 'Failed to save payment method');
    }
  };

  // Handle payment frequency form submit
  const handleFrequencySubmit = async (values: any) => {
    try {
      if (editingFrequency) {
        await api.put(`/api/payment-config/payment-frequencies/${editingFrequency.id}`, values);
        message.success('Payment frequency updated successfully');
      } else {
        await api.post('/api/payment-config/payment-frequencies', values);
        message.success('Payment frequency created successfully');
      }
      setFrequencyModalVisible(false);
      frequencyForm.resetFields();
      setEditingFrequency(null);
      fetchPaymentFrequencies();
    } catch (error) {
      message.error(getErrorMessage(error) || 'Failed to save payment frequency');
    }
  };

  // Delete payment method
  const handleDeleteMethod = async (id: string) => {
    Modal.confirm({
      title: 'Delete Payment Method',
      content: 'Are you sure you want to delete this payment method?',
      onOk: async () => {
        try {
          await api.delete(`/api/payment-config/payment-methods/${id}`);
          message.success('Payment method deleted successfully');
          fetchPaymentMethods();
        } catch (error) {
          message.error(getErrorMessage(error) || 'Failed to delete payment method');
        }
      }
    });
  };

  // Delete payment frequency
  const handleDeleteFrequency = async (id: string) => {
    Modal.confirm({
      title: 'Delete Payment Frequency',
      content: 'Are you sure you want to delete this payment frequency?',
      onOk: async () => {
        try {
          await api.delete(`/api/payment-config/payment-frequencies/${id}`);
          message.success('Payment frequency deleted successfully');
          fetchPaymentFrequencies();
        } catch (error) {
          message.error(getErrorMessage(error) || 'Failed to delete payment frequency');
        }
      }
    });
  };

  // Edit payment method
  const handleEditMethod = (record: PaymentMethod) => {
    setEditingMethod(record);
    methodForm.setFieldsValue(record);
    setMethodModalVisible(true);
  };

  // Edit payment frequency
  const handleEditFrequency = (record: PaymentFrequency) => {
    setEditingFrequency(record);
    frequencyForm.setFieldsValue(record);
    setFrequencyModalVisible(true);
  };

  const methodColumns = [
    {
      title: 'Code',
      dataIndex: 'code',
      key: 'code',
      width: 120,
      sorter: (a: PaymentMethod, b: PaymentMethod) => a.code.localeCompare(b.code),
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      sorter: (a: PaymentMethod, b: PaymentMethod) => a.name.localeCompare(b.name),
      defaultSortOrder: 'ascend' as const,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
    },
    {
      title: 'Requires Account',
      dataIndex: 'requires_account_info',
      key: 'requires_account_info',
      width: 130,
      render: (value: boolean) => value ? 'Yes' : 'No',
    },
    {
      title: 'Active',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      render: (value: boolean) => value ? 'Yes' : 'No',
    },
    {
      title: 'Default',
      dataIndex: 'is_default',
      key: 'is_default',
      width: 80,
      render: (value: boolean) => value ? 'Yes' : 'No',
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 120,
      render: (_: any, record: PaymentMethod) => (
        <Space>
          <Button 
            icon={<EditOutlined />} 
            size="small"
            onClick={() => handleEditMethod(record)}
          />
          <Button 
            icon={<DeleteOutlined />} 
            size="small"
            danger
            onClick={() => handleDeleteMethod(record.id)}
          />
        </Space>
      ),
    },
  ];

  const frequencyColumns = [
    {
      title: 'Code',
      dataIndex: 'code',
      key: 'code',
      width: 120,
      sorter: (a: PaymentFrequency, b: PaymentFrequency) => a.code.localeCompare(b.code),
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      sorter: (a: PaymentFrequency, b: PaymentFrequency) => a.name.localeCompare(b.name),
      defaultSortOrder: 'ascend' as const,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
    },
    {
      title: 'Days Interval',
      dataIndex: 'days_interval',
      key: 'days_interval',
      width: 120,
      render: (value: number | null) => {
        if (value === null || value === undefined) {
          return '-';
        }
        return `${value} days`;
      },
    },
    {
      title: 'Active',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      render: (value: boolean) => value ? 'Yes' : 'No',
    },
    {
      title: 'Default',
      dataIndex: 'is_default',
      key: 'is_default',
      width: 80,
      render: (value: boolean) => value ? 'Yes' : 'No',
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 120,
      render: (_: any, record: PaymentFrequency) => (
        <Space>
          <Button 
            icon={<EditOutlined />} 
            size="small"
            onClick={() => handleEditFrequency(record)}
          />
          <Button 
            icon={<DeleteOutlined />} 
            size="small"
            danger
            onClick={() => handleDeleteFrequency(record.id)}
          />
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* Payment Methods Section */}
      <Card title="Payment Methods" style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 16 }}>
          <Button 
            type="primary" 
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingMethod(null);
              methodForm.resetFields();
              setMethodModalVisible(true);
            }}
          >
            Add Payment Method
          </Button>
        </div>
        <Table
          columns={methodColumns}
          dataSource={paymentMethods}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          locale={{
            emptyText: 'No payment methods configured. Click "Add Payment Method" to create one.'
          }}
        />
      </Card>

      {/* Payment Frequencies Section */}
      <Card title="Payment Frequencies">
        <div style={{ marginBottom: 16 }}>
          <Button 
            type="primary" 
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingFrequency(null);
              frequencyForm.resetFields();
              setFrequencyModalVisible(true);
            }}
          >
            Add Payment Frequency
          </Button>
        </div>
        <Table
          columns={frequencyColumns}
          dataSource={paymentFrequencies}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          locale={{
            emptyText: 'No payment frequencies configured. Click "Add Payment Frequency" to create one.'
          }}
        />
      </Card>

      {/* Payment Method Modal */}
      <Modal
        title={editingMethod ? 'Edit Payment Method' : 'Add Payment Method'}
        open={methodModalVisible}
        onCancel={() => {
          setMethodModalVisible(false);
          methodForm.resetFields();
          setEditingMethod(null);
        }}
        footer={null}
      >
        <Form
          form={methodForm}
          layout="vertical"
          onFinish={handleMethodSubmit}
        >
          <Form.Item
            name="code"
            label="Code"
            rules={[{ required: true, message: 'Please enter code' }]}
          >
            <Input placeholder="e.g., zelle, stripe" />
          </Form.Item>
          
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: 'Please enter name' }]}
          >
            <Input placeholder="Display name" />
          </Form.Item>
          
          <Form.Item
            name="description"
            label="Description"
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          
          <Form.Item
            name="requires_account_info"
            label="Requires Account Info"
            valuePropName="checked"
            initialValue={false}
          >
            <Switch />
          </Form.Item>
          
          <Form.Item
            name="is_active"
            label="Active"
            valuePropName="checked"
            initialValue={true}
          >
            <Switch />
          </Form.Item>
          
          <Form.Item
            name="is_default"
            label="Default"
            valuePropName="checked"
            initialValue={false}
          >
            <Switch />
          </Form.Item>
          
          <Form.Item>
            <Space style={{ float: 'right' }}>
              <Button onClick={() => {
                setMethodModalVisible(false);
                methodForm.resetFields();
                setEditingMethod(null);
              }}>
                Cancel
              </Button>
              <Button type="primary" htmlType="submit">
                {editingMethod ? 'Update' : 'Create'}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Payment Frequency Modal */}
      <Modal
        title={editingFrequency ? 'Edit Payment Frequency' : 'Add Payment Frequency'}
        open={frequencyModalVisible}
        onCancel={() => {
          setFrequencyModalVisible(false);
          frequencyForm.resetFields();
          setEditingFrequency(null);
        }}
        footer={null}
      >
        <Form
          form={frequencyForm}
          layout="vertical"
          onFinish={handleFrequencySubmit}
        >
          <Form.Item
            name="code"
            label="Code"
            rules={[{ required: true, message: 'Please enter code' }]}
          >
            <Input placeholder="e.g., per_job, weekly" />
          </Form.Item>
          
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: 'Please enter name' }]}
          >
            <Input placeholder="Display name" />
          </Form.Item>
          
          <Form.Item
            name="description"
            label="Description"
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          
          <Form.Item
            name="days_interval"
            label="Days Interval"
            tooltip="Number of days between payments (leave empty for per job)"
          >
            <InputNumber min={1} style={{ width: '100%' }} placeholder="Leave empty for per job" />
          </Form.Item>
          
          <Form.Item
            name="is_active"
            label="Active"
            valuePropName="checked"
            initialValue={true}
          >
            <Switch />
          </Form.Item>
          
          <Form.Item
            name="is_default"
            label="Default"
            valuePropName="checked"
            initialValue={false}
          >
            <Switch />
          </Form.Item>
          
          <Form.Item>
            <Space style={{ float: 'right' }}>
              <Button onClick={() => {
                setFrequencyModalVisible(false);
                frequencyForm.resetFields();
                setEditingFrequency(null);
              }}>
                Cancel
              </Button>
              <Button type="primary" htmlType="submit">
                {editingFrequency ? 'Update' : 'Create'}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default PaymentConfig;