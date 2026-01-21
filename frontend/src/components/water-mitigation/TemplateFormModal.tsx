/**
 * Template Form Modal
 * Create and edit water mitigation report templates
 */

import React, { useState, useEffect } from 'react';
import {
  Modal,
  Form,
  Input,
  Select,
  Checkbox,
  Button,
  Space,
  Card,
  Typography,
  Divider,
  message,
  Row,
  Col
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined
} from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import waterMitigationService from '../../services/waterMitigationService';
import type {
  ReportTemplate,
  TemplateCreate,
  TemplateUpdate,
  TemplateSection,
  TemplateType
} from '../../types/waterMitigation';
import { TEMPLATE_TYPE_OPTIONS, LAYOUT_OPTIONS } from '../../types/waterMitigation';

const { TextArea } = Input;
const { Text } = Typography;

interface TemplateFormModalProps {
  visible: boolean;
  template?: ReportTemplate | null;
  onSuccess: () => void;
  onCancel: () => void;
}

const DEFAULT_SECTIONS: Omit<TemplateSection, 'display_order'>[] = [
  { title: 'Wet Area', summary: '', layout: 'two' },
  { title: 'Pre-Mitigation Moving', summary: '', layout: 'two' },
  { title: 'Demolition', summary: '', layout: 'two' },
  { title: 'Containment', summary: '', layout: 'two' },
  { title: 'Drying Process', summary: '', layout: 'two' },
  { title: 'Monitoring - Day 1', summary: '', layout: 'two' },
  { title: 'Monitoring - Day 2', summary: '', layout: 'two' },
  { title: 'Monitoring - Day 3', summary: '', layout: 'two' }
];

const TemplateFormModal: React.FC<TemplateFormModalProps> = ({
  visible,
  template,
  onSuccess,
  onCancel
}) => {
  const [form] = Form.useForm();
  const [sections, setSections] = useState<TemplateSection[]>([]);

  // Initialize form when modal opens or template changes
  useEffect(() => {
    if (visible) {
      if (template) {
        // Edit mode
        form.setFieldsValue({
          name: template.name,
          description: template.description,
          template_type: template.template_type,
          is_default: template.is_default
        });
        setSections(template.sections);
      } else {
        // Create mode - use default sections
        form.resetFields();
        form.setFieldsValue({
          template_type: 'standard',
          is_default: false
        });
        setSections(DEFAULT_SECTIONS.map((section, index) => ({
          ...section,
          id: `section-${Date.now()}-${index}`,
          display_order: index
        })));
      }
    }
  }, [visible, template, form]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: waterMitigationService.templates.create,
    onSuccess: () => {
      message.success('Template created successfully');
      onSuccess();
    },
    onError: () => {
      message.error('Failed to create template');
    }
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: TemplateUpdate }) =>
      waterMitigationService.templates.update(id, data),
    onSuccess: () => {
      message.success('Template updated successfully');
      onSuccess();
    },
    onError: () => {
      message.error('Failed to update template');
    }
  });

  const handleAddSection = () => {
    const newSection: TemplateSection = {
      id: `section-${Date.now()}`,
      title: `Section ${sections.length + 1}`,
      summary: '',
      layout: 'two',
      display_order: sections.length
    };
    setSections([...sections, newSection]);
  };

  const handleRemoveSection = (index: number) => {
    const newSections = sections.filter((_, i) => i !== index);
    // Update display_order
    setSections(newSections.map((section, i) => ({ ...section, display_order: i })));
  };

  const handleMoveSection = (index: number, direction: 'up' | 'down') => {
    const newSections = [...sections];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= newSections.length) return;

    [newSections[index], newSections[targetIndex]] = [newSections[targetIndex], newSections[index]];
    setSections(newSections.map((section, i) => ({ ...section, display_order: i })));
  };

  const handleSectionChange = (index: number, field: keyof TemplateSection, value: any) => {
    const newSections = [...sections];
    newSections[index] = { ...newSections[index], [field]: value };
    setSections(newSections);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();

      const templateData = {
        name: values.name,
        description: values.description,
        template_type: values.template_type as TemplateType,
        is_default: values.is_default || false,
        sections: sections.map((section, index) => ({
          title: section.title,
          summary: section.summary,
          layout: section.layout,
          display_order: index
        }))
      };

      if (template) {
        updateMutation.mutate({ id: template.id, data: templateData });
      } else {
        createMutation.mutate(templateData as TemplateCreate);
      }
    } catch (error) {
      console.error('Form validation failed:', error);
    }
  };

  return (
    <Modal
      title={template ? 'Edit Template' : 'Create Template'}
      open={visible}
      onCancel={onCancel}
      width={800}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          Cancel
        </Button>,
        <Button
          key="submit"
          type="primary"
          onClick={handleSubmit}
          loading={createMutation.isPending || updateMutation.isPending}
        >
          {template ? 'Update' : 'Create'}
        </Button>
      ]}
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          template_type: 'standard',
          is_default: false
        }}
      >
        <Form.Item
          label="Template Name"
          name="name"
          rules={[{ required: true, message: 'Please enter template name' }]}
        >
          <Input placeholder="e.g., Standard Water Mitigation Photos" />
        </Form.Item>

        <Form.Item
          label="Description"
          name="description"
        >
          <TextArea
            rows={2}
            placeholder="Brief description of this template"
          />
        </Form.Item>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              label="Template Type"
              name="template_type"
            >
              <Select options={[...TEMPLATE_TYPE_OPTIONS]} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="is_default"
              valuePropName="checked"
            >
              <Checkbox style={{ marginTop: 30 }}>Set as default template</Checkbox>
            </Form.Item>
          </Col>
        </Row>

        <Divider />

        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text strong>Sections ({sections.length})</Text>
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={handleAddSection}
            >
              Add Section
            </Button>
          </div>
        </div>

        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {sections.map((section, index) => (
            <Card
              key={section.id || index}
              size="small"
              title={
                <Space>
                  <Text strong>Section {index + 1}</Text>
                  <Space size="small">
                    <Button
                      type="text"
                      size="small"
                      icon={<ArrowUpOutlined />}
                      onClick={() => handleMoveSection(index, 'up')}
                      disabled={index === 0}
                    />
                    <Button
                      type="text"
                      size="small"
                      icon={<ArrowDownOutlined />}
                      onClick={() => handleMoveSection(index, 'down')}
                      disabled={index === sections.length - 1}
                    />
                  </Space>
                </Space>
              }
              extra={
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => handleRemoveSection(index)}
                />
              }
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                <Input
                  placeholder="Section Title"
                  value={section.title}
                  onChange={e => handleSectionChange(index, 'title', e.target.value)}
                />
                <TextArea
                  placeholder="Section Summary (optional)"
                  rows={2}
                  value={section.summary}
                  onChange={e => handleSectionChange(index, 'summary', e.target.value)}
                />
                <Select
                  placeholder="Photo Layout"
                  value={section.layout}
                  onChange={value => handleSectionChange(index, 'layout', value)}
                  options={[...LAYOUT_OPTIONS]}
                  style={{ width: '100%' }}
                />
              </Space>
            </Card>
          ))}
        </Space>

        {sections.length === 0 && (
          <Card>
            <div style={{ textAlign: 'center', padding: 20, color: '#999' }}>
              No sections added. Click "Add Section" to create sections.
            </div>
          </Card>
        )}
      </Form>
    </Modal>
  );
};

export default TemplateFormModal;
