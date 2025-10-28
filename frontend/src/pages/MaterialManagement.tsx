/**
 * Material Management Admin Page
 * Simple interface for managing material weights and categories
 */

import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  message,
  Popconfirm,
  Typography,
  Row,
  Col,
  Tag,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import {
  MaterialWeight,
  MaterialWeightCreate,
  MaterialWeightUpdate,
  MaterialCategory,
  UnitType,
} from '../types/reconstructionEstimate';
import { materialWeightAPI, materialCategoryAPI } from '../services/reconstructionEstimateService';

const { Title, Text } = Typography;
const { Option } = Select;

const MaterialManagement: React.FC = () => {
  const [materials, setMaterials] = useState<MaterialWeight[]>([]);
  const [categories, setCategories] = useState<MaterialCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<MaterialWeight | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [materialsData, categoriesData] = await Promise.all([
        materialWeightAPI.getAll({ active_only: false }),
        materialCategoryAPI.getAll(),
      ]);
      setMaterials(materialsData.materials);
      setCategories(categoriesData);
    } catch (error) {
      message.error('Failed to load data');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingMaterial(null);
    form.resetFields();
    form.setFieldsValue({
      damp_multiplier: 1.2,
      wet_multiplier: 1.5,
      saturated_multiplier: 2.0,
      active: true,
      unit: UnitType.SF,
    });
    setModalVisible(true);
  };

  const handleEdit = (material: MaterialWeight) => {
    setEditingMaterial(material);
    form.setFieldsValue(material);
    setModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await materialWeightAPI.delete(id);
      message.success('Material deleted');
      loadData();
    } catch (error) {
      message.error('Failed to delete material');
      console.error(error);
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();

      if (editingMaterial) {
        await materialWeightAPI.update(editingMaterial.id, values);
        message.success('Material updated');
      } else {
        await materialWeightAPI.create(values);
        message.success('Material created');
      }

      setModalVisible(false);
      loadData();
    } catch (error) {
      message.error('Failed to save material');
      console.error(error);
    }
  };

  const columns = [
    {
      title: 'Material Type',
      dataIndex: 'material_type',
      key: 'material_type',
      render: (text: string) => text.replace(/_/g, ' '),
      sorter: (a: MaterialWeight, b: MaterialWeight) =>
        a.material_type.localeCompare(b.material_type),
    },
    {
      title: 'Category',
      dataIndex: 'category_name',
      key: 'category_name',
      filters: categories.map(cat => ({ text: cat.category_name, value: cat.id })),
      onFilter: (value: any, record: MaterialWeight) => record.category_id === value,
    },
    {
      title: 'Weight/Unit',
      dataIndex: 'dry_weight_per_unit',
      key: 'dry_weight_per_unit',
      render: (weight: number, record: MaterialWeight) => (
        <Text>{weight} lbs/{record.unit}</Text>
      ),
      align: 'right' as const,
    },
    {
      title: 'Moisture Multipliers',
      key: 'multipliers',
      render: (_: any, record: MaterialWeight) => (
        <Space size="small">
          <Tag color="blue">Damp: {record.damp_multiplier}</Tag>
          <Tag color="cyan">Wet: {record.wet_multiplier}</Tag>
          <Tag color="geekblue">Sat: {record.saturated_multiplier}</Tag>
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'active',
      key: 'active',
      render: (active: boolean) => (
        <Tag color={active ? 'green' : 'red'}>{active ? 'Active' : 'Inactive'}</Tag>
      ),
      filters: [
        { text: 'Active', value: true },
        { text: 'Inactive', value: false },
      ],
      onFilter: (value: any, record: MaterialWeight) => record.active === value,
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: MaterialWeight) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            Edit
          </Button>
          <Popconfirm
            title="Are you sure you want to delete this material?"
            onConfirm={() => handleDelete(record.id)}
            okText="Yes"
            cancelText="No"
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              Delete
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 24 }}>
        <Col>
          <Title level={2}>
            <DatabaseOutlined /> Material Management
          </Title>
          <Text type="secondary">Manage construction material weights and properties</Text>
        </Col>
        <Col>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            Add Material
          </Button>
        </Col>
      </Row>

      <Card>
        <Table
          dataSource={materials}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total) => `Total ${total} materials`,
          }}
        />
      </Card>

      <Modal
        title={editingMaterial ? 'Edit Material' : 'Add Material'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={600}
        okText="Save"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="material_type"
            label="Material Type"
            rules={[{ required: true, message: 'Please enter material type' }]}
          >
            <Input placeholder="e.g., hardwood_floor, drywall_half_inch" />
          </Form.Item>

          <Form.Item
            name="category_id"
            label="Category"
            rules={[{ required: true, message: 'Please select a category' }]}
          >
            <Select placeholder="Select category">
              {categories.map(cat => (
                <Option key={cat.id} value={cat.id}>
                  {cat.category_name}
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} placeholder="Optional description" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="dry_weight_per_unit"
                label="Dry Weight per Unit (lbs)"
                rules={[{ required: true, message: 'Please enter weight' }]}
              >
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="unit"
                label="Unit"
                rules={[{ required: true, message: 'Please select unit' }]}
              >
                <Select>
                  <Option value={UnitType.SF}>SF (Square Feet)</Option>
                  <Option value={UnitType.LF}>LF (Linear Feet)</Option>
                  <Option value={UnitType.EA}>EA (Each)</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Title level={5}>Moisture Multipliers</Title>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="damp_multiplier"
                label="Damp"
                rules={[{ required: true }]}
              >
                <InputNumber min={1} max={5} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="wet_multiplier" label="Wet" rules={[{ required: true }]}>
                <InputNumber min={1} max={5} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="saturated_multiplier"
                label="Saturated"
                rules={[{ required: true }]}
              >
                <InputNumber min={1} max={5} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="active" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default MaterialManagement;
