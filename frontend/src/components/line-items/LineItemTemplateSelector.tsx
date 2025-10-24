/**
 * Line Item Template Selector Component
 * Allows users to select and apply line item templates to invoices and estimates
 */

import React, { useState, useEffect } from 'react';
import {
  Modal,
  Select,
  Button,
  message,
  Space,
  Divider,
  Alert,
  Form,
  Typography,
  List,
  Tag,
  Spin
} from 'antd';
import {
  AppstoreAddOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined
} from '@ant-design/icons';
import lineItemService from '../../services/lineItemService';
import { LineItemTemplate } from '../../types/lineItem';

const { Title, Text } = Typography;
const { Option } = Select;

interface LineItemTemplateSelectorProps {
  open: boolean;
  onClose: () => void;
  onApply: (template: LineItemTemplate) => void;
  companyId?: string;
  category?: string;
  documentType: 'invoice' | 'estimate' | 'work_order';
}

const LineItemTemplateSelector: React.FC<LineItemTemplateSelectorProps> = ({
  open,
  onClose,
  onApply,
  companyId,
  category,
  documentType
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<LineItemTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<LineItemTemplate | null>(null);
  const [fetching, setFetching] = useState(false);

  // Fetch templates when modal opens
  useEffect(() => {
    if (open) {
      fetchTemplates();
      form.resetFields();
      setSelectedTemplate(null);
    }
  }, [open, companyId, category]);

  const fetchTemplates = async () => {
    try {
      setFetching(true);
      const fetchedTemplates = await lineItemService.getTemplates(
        companyId,
        category,
        true // only active templates
      );
      setTemplates(fetchedTemplates);
    } catch (error: any) {
      message.error(error.message || 'Failed to fetch templates');
      setTemplates([]);
    } finally {
      setFetching(false);
    }
  };

  const handleTemplateChange = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    setSelectedTemplate(template || null);
  };

  const handleApply = async () => {
    try {
      await form.validateFields();

      if (!selectedTemplate) {
        message.warning('Please select a template');
        return;
      }

      setLoading(true);

      // Call parent handler with template
      onApply(selectedTemplate);

      message.success(`Template "${selectedTemplate.name}" applied successfully`);
      onClose();
    } catch (error: any) {
      if (error.errorFields) {
        // Form validation errors
        return;
      }
      message.error(error.message || 'Failed to apply template');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <AppstoreAddOutlined />
          <span>Apply Line Item Template</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      onOk={handleApply}
      confirmLoading={loading}
      okText="Apply Template"
      okButtonProps={{
        icon: <CheckCircleOutlined />,
        disabled: !selectedTemplate
      }}
      width={700}
    >
      <Alert
        message="Template Selection"
        description={`Select a pre-configured template to quickly add multiple line items to this ${documentType}. You can adjust quantities after applying the template.`}
        type="info"
        showIcon
        icon={<InfoCircleOutlined />}
        style={{ marginBottom: 16 }}
      />

      <Form
        form={form}
        layout="vertical"
      >
        <Form.Item
          name="template_id"
          label="Select Template"
          rules={[{ required: true, message: 'Please select a template' }]}
        >
          <Select
            placeholder="Choose a line item template"
            onChange={handleTemplateChange}
            loading={fetching}
            showSearch
            filterOption={(input, option) =>
              option?.children ? String(option.children).toLowerCase().includes(input.toLowerCase()) : false
            }
            notFoundContent={
              fetching ? <Spin size="small" /> : (
                templates.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center' }}>
                    <Text type="secondary">No templates available</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      Create templates from the Line Items management page
                    </Text>
                  </div>
                ) : null
              )
            }
          >
            {templates.map(template => (
              <Option key={template.id} value={template.id}>
                <Space direction="vertical" size={0}>
                  <Text strong>{template.name}</Text>
                  {template.description && (
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      {template.description}
                    </Text>
                  )}
                  <Space size={4}>
                    {template.category && <Tag color="blue">{template.category}</Tag>}
                    <Tag color="green">{template.template_items?.length || 0} items</Tag>
                  </Space>
                </Space>
              </Option>
            ))}
          </Select>
        </Form.Item>
      </Form>

      {selectedTemplate && (
        <>
          <Divider orientation="left">Template Preview</Divider>
          <div style={{
            maxHeight: '300px',
            overflowY: 'auto',
            border: '1px solid #f0f0f0',
            borderRadius: '4px',
            padding: '8px'
          }}>
            <Title level={5}>{selectedTemplate.name}</Title>
            {selectedTemplate.description && (
              <Text type="secondary" style={{ display: 'block', marginBottom: '12px' }}>
                {selectedTemplate.description}
              </Text>
            )}

            <List
              size="small"
              dataSource={selectedTemplate.template_items || []}
              renderItem={(item, index) => {
                // Get item data from either line_item (library reference) or embedded_data
                const description = item.line_item?.description || item.embedded_data?.description || 'No description';
                const itemCode = item.line_item?.item || item.embedded_data?.item_code || '';
                const category = item.line_item?.cat || '';
                const unit = item.line_item?.unit || item.embedded_data?.unit || 'EA';
                const price = Number(item.line_item?.untaxed_unit_price || item.embedded_data?.rate || 0);

                return (
                  <List.Item>
                    <Space direction="vertical" size={0} style={{ width: '100%' }}>
                      <Space>
                        <Text strong>{index + 1}.</Text>
                        <Text>{description}</Text>
                      </Space>
                      <Space size={16}>
                        {category && (
                          <Tag color="blue">{category}</Tag>
                        )}
                        {itemCode && (
                          <Tag>{itemCode}</Tag>
                        )}
                        {item.embedded_data && !item.line_item && (
                          <Tag color="orange">Custom</Tag>
                        )}
                        <Text type="secondary">
                          Qty: {Number(item.quantity_multiplier) || 1} × {unit}
                        </Text>
                        <Text type="secondary">
                          ${price.toFixed(2)}
                        </Text>
                      </Space>
                    </Space>
                  </List.Item>
                );
              }}
            />
          </div>
        </>
      )}
    </Modal>
  );
};

export default LineItemTemplateSelector;
