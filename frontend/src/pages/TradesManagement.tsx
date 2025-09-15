import React, { useState } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  Tag,
  Tooltip,
  message,
  Popconfirm,
  Row,
  Col,
  Typography,
  Alert,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Key } from 'react';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ToolOutlined,
  InfoCircleOutlined
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import documentTypeService from '../services/documentTypeService';
import type { Trade } from '../types/documentTypes';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Option } = Select;

const TradesManagement: React.FC = () => {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [form] = Form.useForm();

  // Fetch trades
  const { data: trades = [], isLoading } = useQuery({
    queryKey: ['trades'],
    queryFn: () => documentTypeService.getTrades(),
  });

  // Create/Update mutation
  const saveMutation = useMutation({
    mutationFn: (values: any) => {
      if (editingTrade) {
        return documentTypeService.updateTrade(editingTrade.id, values);
      }
      return documentTypeService.createTrade(values);
    },
    onSuccess: () => {
      message.success(`Trade ${editingTrade ? 'updated' : 'created'} successfully`);
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      handleCloseModal();
    },
    onError: (error: any) => {
      message.error(error.message || 'Failed to save trade');
    }
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentTypeService.deleteTrade(id),
    onSuccess: () => {
      message.success('Trade deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['trades'] });
    },
    onError: (error: any) => {
      message.error(error.message || 'Failed to delete trade');
    }
  });

  const handleAdd = () => {
    setEditingTrade(null);
    form.resetFields();
    setIsModalOpen(true);
  };

  const handleEdit = (record: Trade) => {
    setEditingTrade(record);
    form.setFieldsValue(record);
    setIsModalOpen(true);
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingTrade(null);
    form.resetFields();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      saveMutation.mutate(values);
    } catch (error) {
      console.error('Validation failed:', error);
    }
  };

  const getCategoryColor = (category: string) => {
    const colors: { [key: string]: string } = {
      construction: 'blue',
      finishing: 'green',
      specialty: 'purple',
      maintenance: 'orange',
      other: 'default'
    };
    return colors[category] || 'default';
  };

  const columns: ColumnsType<Trade> = [
    {
      title: 'Trade Name',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Trade) => (
        <Space>
          <ToolOutlined />
          <Text strong>{text}</Text>
          {!record.is_active && <Tag color="red">Inactive</Tag>}
        </Space>
      ),
    },
    {
      title: 'Code',
      dataIndex: 'code',
      key: 'code',
      width: 120,
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      width: 150,
      render: (category: string) => (
        <Tag color={getCategoryColor(category)}>
          {category || 'N/A'}
        </Tag>
      ),
      filters: [
        { text: 'Construction', value: 'construction' },
        { text: 'Finishing', value: 'finishing' },
        { text: 'Specialty', value: 'specialty' },
        { text: 'Maintenance', value: 'maintenance' },
      ],
      onFilter: (value: boolean | Key, record: Trade) => record.category === value,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      width: 300,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 120,
      fixed: 'right' as const,
      render: (_, record) => (
        <Space>
          <Tooltip title="Edit">
            <Button
              type="link"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          <Popconfirm
            title="Delete Trade"
            description="Are you sure you want to delete this trade?"
            onConfirm={() => handleDelete(record.id)}
            okText="Yes"
            cancelText="No"
          >
            <Tooltip title="Delete">
              <Button type="link" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <Card
        title={
          <Space>
            <ToolOutlined />
            <span>Trades Management</span>
          </Space>
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            Add Trade
          </Button>
        }
      >
        <Alert
          message="Manage trades for document classification"
          description="Trades are used to categorize work in estimates and invoices. They don't have fixed prices as pricing is determined by document type and specific job requirements."
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          style={{ marginBottom: 16 }}
        />
        
        <Table
          columns={columns}
          dataSource={trades}
          rowKey="id"
          loading={isLoading}
          scroll={{ x: 1000 }}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `Total ${total} trades`,
          }}
        />
      </Card>

      <Modal
        title={
          <Space>
            <ToolOutlined />
            <span>{editingTrade ? 'Edit Trade' : 'Add Trade'}</span>
          </Space>
        }
        open={isModalOpen}
        onOk={handleSubmit}
        onCancel={handleCloseModal}
        width={600}
        confirmLoading={saveMutation.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            is_active: true,
            category: 'construction',
          }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="name"
                label="Trade Name"
                rules={[{ required: true, message: 'Please enter trade name' }]}
              >
                <Input placeholder="e.g., Plumbing" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="code"
                label="Code"
                rules={[
                  { required: true, message: 'Please enter code' },
                  { pattern: /^[A-Z_]+$/, message: 'Use uppercase letters and underscores only' }
                ]}
              >
                <Input placeholder="e.g., PLUMB" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="description"
            label="Description"
          >
            <TextArea rows={3} placeholder="Enter trade description" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="category"
                label="Category"
                rules={[{ required: true, message: 'Please select category' }]}
              >
                <Select placeholder="Select category">
                  <Option value="construction">Construction</Option>
                  <Option value="finishing">Finishing</Option>
                  <Option value="specialty">Specialty</Option>
                  <Option value="maintenance">Maintenance</Option>
                  <Option value="other">Other</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="is_active"
            label="Active"
            valuePropName="checked"
          >
            <Switch />  
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default TradesManagement;