import React, { useState, useEffect } from 'react';
import {
  Card,
  Button,
  Space,
  Input,
  InputNumber,
  Select,
  Table,
  Popconfirm,
  Typography,
  Tag,
  Row,
  Col,
  Divider,
  Empty,
  message,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  DollarOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';

const { Text, Title } = Typography;
const { Option } = Select;
const { TextArea } = Input;

// Predefined cost templates
const COST_TEMPLATES = [
  { 
    id: 'roofr_report',
    type: 'report',
    name: 'Roofr Report',
    amount: 19,
    isFixed: true,
    description: 'Roofr aerial measurement report'
  },
  { 
    id: 'eagleview_roof',
    type: 'report',
    name: 'EagleView (Roof)',
    amount: null,
    isFixed: false,
    description: 'EagleView roof measurement report'
  },
  { 
    id: 'eagleview_siding',
    type: 'report',
    name: 'EagleView (Siding)',
    amount: null,
    isFixed: false,
    description: 'EagleView siding measurement report'
  },
  { 
    id: 'permit_building',
    type: 'permit',
    name: 'Building Permit',
    amount: null,
    isFixed: false,
    description: 'Local building permit fees'
  },
  { 
    id: 'permit_electrical',
    type: 'permit',
    name: 'Electrical Permit',
    amount: null,
    isFixed: false,
    description: 'Electrical work permit fees'
  },
  { 
    id: 'inspection_structural',
    type: 'inspection',
    name: 'Structural Inspection',
    amount: null,
    isFixed: false,
    description: 'Professional structural inspection'
  },
];

const COST_TYPES = [
  { value: 'report', label: 'Report', color: 'blue' },
  { value: 'permit', label: 'Permit', color: 'orange' },
  { value: 'inspection', label: 'Inspection', color: 'green' },
  { value: 'material', label: 'Material', color: 'purple' },
  { value: 'labor', label: 'Labor', color: 'cyan' },
  { value: 'other', label: 'Other', color: 'default' },
];

export interface AdditionalCost {
  id: string;
  type?: string;  // Made optional since custom costs don't need type
  name: string;
  amount: number;
  description?: string;
  isTemplate?: boolean;
}

interface AdditionalCostsProps {
  costs: AdditionalCost[];
  onChange: (costs: AdditionalCost[]) => void;
}

const AdditionalCosts: React.FC<AdditionalCostsProps> = ({ costs, onChange }) => {
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [customCost, setCustomCost] = useState<Partial<AdditionalCost>>({
    name: '',
    amount: 0,
    description: '',
  });
  const [showCustomForm, setShowCustomForm] = useState(false);

  // Calculate total additional costs
  const totalAdditionalCosts = costs.reduce((sum, cost) => sum + (cost.amount || 0), 0);

  // Add cost from template
  const handleAddTemplate = () => {
    if (!selectedTemplate) {
      message.warning('Please select a template');
      return;
    }

    const template = COST_TEMPLATES.find(t => t.id === selectedTemplate);
    if (!template) return;

    // Check if template requires amount input
    if (!template.isFixed) {
      // For variable price templates, prompt for amount
      const amount = prompt(`Enter amount for ${template.name}:`);
      if (!amount || isNaN(parseFloat(amount))) {
        message.warning('Please enter a valid amount');
        return;
      }

      const newCost: AdditionalCost = {
        id: `${template.id}_${Date.now()}`,
        type: template.type,
        name: template.name,
        amount: parseFloat(amount),
        description: template.description,
        isTemplate: true,
      };

      onChange([...costs, newCost]);
    } else {
      // Fixed price template
      const newCost: AdditionalCost = {
        id: `${template.id}_${Date.now()}`,
        type: template.type,
        name: template.name,
        amount: template.amount!,
        description: template.description,
        isTemplate: true,
      };

      onChange([...costs, newCost]);
    }

    setSelectedTemplate('');
    message.success('Cost item added');
  };

  // Add custom cost
  const handleAddCustom = () => {
    if (!customCost.name || !customCost.amount) {
      message.warning('Please enter name and amount');
      return;
    }

    const newCost: AdditionalCost = {
      id: `custom_${Date.now()}`,
      type: 'custom',  // Fixed type for all custom costs
      name: customCost.name,
      amount: customCost.amount,
      description: customCost.description,
      isTemplate: false,
    };

    onChange([...costs, newCost]);
    
    // Reset form
    setCustomCost({
      name: '',
      amount: 0,
      description: '',
    });
    setShowCustomForm(false);
    message.success('Custom cost added');
  };

  // Remove cost
  const handleRemove = (id: string) => {
    onChange(costs.filter(cost => cost.id !== id));
    message.success('Cost item removed');
  };

  // Table columns
  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text>{name}</Text>,
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      width: 120,
      align: 'right' as const,
      render: (amount: number) => (
        <Text strong>${amount.toFixed(2)}</Text>
      ),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (description: string) => (
        <Text type="secondary">{description || '-'}</Text>
      ),
    },
    {
      title: 'Action',
      key: 'action',
      width: 80,
      render: (_: any, record: AdditionalCost) => (
        <Popconfirm
          title="Remove this cost?"
          onConfirm={() => handleRemove(record.id)}
          okText="Yes"
          cancelText="No"
        >
          <Button type="text" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space>
          <DollarOutlined />
          <Text strong>Additional Costs</Text>
          {costs.length > 0 && (
            <Tag color="green">Total: ${totalAdditionalCosts.toFixed(2)}</Tag>
          )}
        </Space>
      </div>
      {/* Template Selection */}
      <Row gutter={8} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Select
            placeholder="Select a cost template"
            style={{ width: '100%' }}
            value={selectedTemplate}
            onChange={setSelectedTemplate}
            allowClear
            size="middle"
          >
            {COST_TEMPLATES.map(template => (
              <Option key={template.id} value={template.id}>
                <Space>
                  <span>{template.name}</span>
                  {template.isFixed ? (
                    <Tag color="green">${template.amount}</Tag>
                  ) : (
                    <Tag color="orange">Variable</Tag>
                  )}
                </Space>
              </Option>
            ))}
          </Select>
        </Col>
        <Col span={12}>
          <Space wrap>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAddTemplate}
              disabled={!selectedTemplate}
              size="middle"
            >
              Add
            </Button>
            <Button
              icon={<PlusOutlined />}
              onClick={() => setShowCustomForm(!showCustomForm)}
              size="middle"
            >
              Custom
            </Button>
          </Space>
        </Col>
      </Row>

      {/* Custom Cost Form */}
      {showCustomForm && (
        <Card size="small" style={{ marginBottom: 16, backgroundColor: '#f5f5f5' }}>
          <Row gutter={8}>
            <Col span={8}>
              <Input
                placeholder="Cost Name"
                value={customCost.name}
                onChange={(e) => setCustomCost({ ...customCost, name: e.target.value })}
                size="small"
              />
            </Col>
            <Col span={6}>
              <InputNumber
                placeholder="Amount"
                prefix="$"
                style={{ width: '100%' }}
                min={0}
                precision={2}
                value={customCost.amount}
                onChange={(value) => setCustomCost({ ...customCost, amount: value || 0 })}
                size="small"
              />
            </Col>
            <Col span={10}>
              <Space size="small">
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  onClick={handleAddCustom}
                  size="small"
                >
                  Add
                </Button>
                <Button onClick={() => setShowCustomForm(false)} size="small">
                  Cancel
                </Button>
              </Space>
            </Col>
          </Row>
          <Row style={{ marginTop: 8 }}>
            <Col span={24}>
              <Input.TextArea
                placeholder="Description (optional)"
                rows={1}
                value={customCost.description}
                onChange={(e) => setCustomCost({ ...customCost, description: e.target.value })}
                size="small"
              />
            </Col>
          </Row>
        </Card>
      )}

      {/* Cost Items Table */}
      {costs.length > 0 ? (
        <Table
          columns={columns}
          dataSource={costs}
          rowKey="id"
          pagination={false}
          size="small"
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={2}>
                <Text strong>Total Additional Costs</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="right">
                <Text strong style={{ color: '#52c41a' }}>
                  ${totalAdditionalCosts.toFixed(2)}
                </Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3} colSpan={2} />
            </Table.Summary.Row>
          )}
        />
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No additional costs added"
        />
      )}
    </div>
  );
};

export default AdditionalCosts;