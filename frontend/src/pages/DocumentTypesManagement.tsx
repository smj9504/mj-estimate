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
  Tag,
  Tooltip,
  message,
  Popconfirm,
  Row,
  Col,
  Typography,
  Divider,
  Alert,
  Tabs
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  DollarOutlined,
  FileTextOutlined,
  SettingOutlined,
  InfoCircleOutlined,
  CalculatorOutlined
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import documentTypeService from '../services/documentTypeService';
import type { DocumentType, PricingRule } from '../types/documentTypes';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Option } = Select;
const { TabPane } = Tabs;

const DocumentTypesManagement: React.FC = () => {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDocType, setEditingDocType] = useState<DocumentType | null>(null);
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState('1');

  // Fetch document types
  const { data: documentTypes = [], isLoading } = useQuery({
    queryKey: ['documentTypes'],
    queryFn: () => documentTypeService.getDocumentTypes(),
  });

  // Create/Update mutation
  const saveMutation = useMutation({
    mutationFn: (values: any) => {
      if (editingDocType) {
        return documentTypeService.updateDocumentType(editingDocType.id, values);
      }
      return documentTypeService.createDocumentType(values);
    },
    onSuccess: () => {
      message.success(`Document type ${editingDocType ? 'updated' : 'created'} successfully`);
      queryClient.invalidateQueries({ queryKey: ['documentTypes'] });
      handleCloseModal();
    },
    onError: (error: any) => {
      message.error(error.message || 'Failed to save document type');
    }
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentTypeService.deleteDocumentType(id),
    onSuccess: () => {
      message.success('Document type deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['documentTypes'] });
    },
    onError: (error: any) => {
      message.error(error.message || 'Failed to delete document type');
    }
  });

  const handleAdd = () => {
    setEditingDocType(null);
    form.resetFields();
    setIsModalOpen(true);
  };

  const handleEdit = (record: DocumentType) => {
    setEditingDocType(record);
    form.setFieldsValue({
      ...record,
      base_price: parseFloat(record.base_price),
      location_base: record.pricing_rules?.location_rules?.base_locations,
      location_additional_price: record.pricing_rules?.location_rules?.additional_location_price,
      location_grouping: record.pricing_rules?.location_rules?.additional_location_grouping,
      addons: record.pricing_rules?.addons || [],
    });
    setIsModalOpen(true);
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingDocType(null);
    form.resetFields();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      
      // Build pricing rules from form values
      const pricingRules: any = {};
      
      if (values.location_base || values.location_additional_price || values.location_grouping) {
        pricingRules.location_rules = {
          base_locations: values.location_base || 0,
          additional_location_price: values.location_additional_price || 0,
          additional_location_grouping: values.location_grouping || 1,
        };
      }
      
      if (values.addons && values.addons.length > 0) {
        pricingRules.addons = values.addons;
      }
      
      const submitData = {
        name: values.name,
        code: values.code,
        description: values.description,
        category: values.category,
        base_price: values.base_price,
        pricing_rules: pricingRules,
        requires_measurement_report: values.requires_measurement_report || false,
        measurement_report_providers: values.measurement_report_providers || [],
        template_name: values.template_name,
        is_active: values.is_active !== undefined ? values.is_active : true,
        is_available_online: values.is_available_online !== undefined ? values.is_available_online : true,
      };
      
      saveMutation.mutate(submitData);
    } catch (error) {
      console.error('Validation failed:', error);
    }
  };

  const columns: ColumnsType<DocumentType> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: DocumentType) => (
        <Space>
          <FileTextOutlined />
          <Text strong>{text}</Text>
          {!record.is_active && <Tag color="red">Inactive</Tag>}
        </Space>
      ),
    },
    // Code column hidden - only used internally
    // {
    //   title: 'Code',
    //   dataIndex: 'code',
    //   key: 'code',
    //   width: 120,
    // },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      width: 120,
      render: (category: string) => (
        <Tag color="blue">{category || 'N/A'}</Tag>
      ),
    },
    {
      title: 'Base Price',
      dataIndex: 'base_price',
      key: 'base_price',
      width: 120,
      render: (price: string) => (
        <Text strong>${parseFloat(price).toFixed(2)}</Text>
      ),
    },
    {
      title: 'Pricing Rules',
      key: 'pricing_rules',
      width: 200,
      render: (_, record) => {
        const rules = [];
        if (record.pricing_rules?.location_rules) {
          rules.push(
            <Tag key="location" color="green">
              Location-based
            </Tag>
          );
        }
        if (record.pricing_rules?.addons && record.pricing_rules.addons.length > 0) {
          rules.push(
            <Tag key="addons" color="purple">
              {record.pricing_rules.addons.length} Addon(s)
            </Tag>
          );
        }
        return rules.length > 0 ? <Space wrap>{rules}</Space> : <Text type="secondary">None</Text>;
      },
    },
    {
      title: 'Requirements',
      key: 'requirements',
      width: 150,
      render: (_, record) => (
        <Space wrap>
          {record.requires_measurement_report && (
            <Tag color="orange">Measurement Required</Tag>
          )}
          {record.requires_approval && (
            <Tag color="red">Approval Required</Tag>
          )}
        </Space>
      ),
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
            title="Delete Document Type"
            description="Are you sure you want to delete this document type?"
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
            <FileTextOutlined />
            <span>Document Types Management</span>
          </Space>
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            Add Document Type
          </Button>
        }
      >
        <Alert
          message="Configure document types and their pricing rules"
          description="Set up base prices, location-based pricing, addons, and measurement report requirements for each document type."
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          style={{ marginBottom: 16 }}
        />
        
        <Table
          columns={columns}
          dataSource={documentTypes}
          rowKey="id"
          loading={isLoading}
          scroll={{ x: 1200 }}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `Total ${total} document types`,
          }}
        />
      </Card>

      <Modal
        title={
          <Space>
            <FileTextOutlined />
            <span>{editingDocType ? 'Edit Document Type' : 'Add Document Type'}</span>
          </Space>
        }
        open={isModalOpen}
        onOk={handleSubmit}
        onCancel={handleCloseModal}
        width={800}
        confirmLoading={saveMutation.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            is_active: true,
            is_available_online: true,
            category: 'estimate',
          }}
        >
          <Tabs activeKey={activeTab} onChange={setActiveTab}>
            <TabPane tab="Basic Information" key="1">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="name"
                    label="Document Type Name"
                    rules={[{ required: true, message: 'Please enter document type name' }]}
                  >
                    <Input placeholder="e.g., Interior Estimate" />
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
                    <Input placeholder="e.g., INT_EST" />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item
                name="description"
                label="Description"
              >
                <TextArea rows={3} placeholder="Enter description" />
              </Form.Item>

              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item
                    name="category"
                    label="Category"
                    rules={[{ required: true, message: 'Please select category' }]}
                  >
                    <Select placeholder="Select category">
                      <Option value="estimate">Estimate</Option>
                      <Option value="invoice">Invoice</Option>
                      <Option value="report">Report</Option>
                      <Option value="other">Other</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    name="base_price"
                    label="Base Price ($)"
                    rules={[{ required: true, message: 'Please enter base price' }]}
                  >
                    <InputNumber
                      style={{ width: '100%' }}
                      min={0}
                      step={5}
                      precision={2}
                      placeholder="0.00"
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item
                    name="is_active"
                    label="Active"
                    valuePropName="checked"
                  >
                    <Switch />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    name="is_available_online"
                    label="Available Online"
                    valuePropName="checked"
                  >
                    <Switch />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    name="requires_approval"
                    label="Requires Approval"
                    valuePropName="checked"
                  >
                    <Switch />
                  </Form.Item>
                </Col>
              </Row>
            </TabPane>

            <TabPane tab="Pricing Rules" key="2">
              <Divider orientation="left">Location-based Pricing</Divider>
              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item
                    name="location_base"
                    label="Base Locations"
                    tooltip="Number of locations included in base price"
                  >
                    <InputNumber
                      style={{ width: '100%' }}
                      min={0}
                      placeholder="e.g., 3"
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    name="location_additional_price"
                    label="Additional Location Price ($)"
                    tooltip="Price for each additional location group"
                  >
                    <InputNumber
                      style={{ width: '100%' }}
                      min={0}
                      step={5}
                      precision={2}
                      placeholder="e.g., 25.00"
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    name="location_grouping"
                    label="Location Grouping"
                    tooltip="Number of locations per additional price unit"
                  >
                    <InputNumber
                      style={{ width: '100%' }}
                      min={1}
                      placeholder="e.g., 3"
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Divider orientation="left">Addons</Divider>
              <Form.List name="addons">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map(({ key, name, ...restField }) => (
                      <Row gutter={16} key={key}>
                        <Col span={12}>
                          <Form.Item
                            {...restField}
                            name={[name, 'name']}
                            label={name === 0 ? 'Addon Name' : ''}
                            rules={[{ required: true, message: 'Missing addon name' }]}
                          >
                            <Input placeholder="e.g., cabinet_estimate" />
                          </Form.Item>
                        </Col>
                        <Col span={10}>
                          <Form.Item
                            {...restField}
                            name={[name, 'price']}
                            label={name === 0 ? 'Addon Price ($)' : ''}
                            rules={[{ required: true, message: 'Missing price' }]}
                          >
                            <InputNumber
                              style={{ width: '100%' }}
                              min={0}
                              step={5}
                              precision={2}
                              placeholder="0.00"
                            />
                          </Form.Item>
                        </Col>
                        <Col span={2}>
                          {name === 0 && <div style={{ height: 22 }} />}
                          <Button
                            type="link"
                            danger
                            onClick={() => remove(name)}
                            icon={<DeleteOutlined />}
                          />
                        </Col>
                      </Row>
                    ))}
                    <Form.Item>
                      <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                        Add Addon
                      </Button>
                    </Form.Item>
                  </>
                )}
              </Form.List>
            </TabPane>

            <TabPane tab="Requirements" key="3">
              <Form.Item
                name="requires_measurement_report"
                label="Requires Measurement Report"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>

              <Form.Item
                name="measurement_report_providers"
                label="Allowed Measurement Report Providers"
                tooltip="Select which providers can be used for measurement reports"
              >
                <Select
                  mode="multiple"
                  placeholder="Select providers"
                  style={{ width: '100%' }}
                >
                  <Option value="eagleview">EagleView</Option>
                  <Option value="roofr">Roofr</Option>
                  <Option value="hover">Hover</Option>
                  <Option value="custom">Custom</Option>
                </Select>
              </Form.Item>

              <Form.Item
                name="template_name"
                label="PDF Template Name"
              >
                <Input placeholder="e.g., interior_estimate.html" />
              </Form.Item>
            </TabPane>
          </Tabs>
        </Form>
      </Modal>
    </div>
  );
};

export default DocumentTypesManagement;