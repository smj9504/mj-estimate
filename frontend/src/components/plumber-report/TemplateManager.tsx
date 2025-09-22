import React, { useState, useEffect } from 'react';
import {
  Modal,
  List,
  Button,
  Space,
  Tabs,
  Form,
  Input,
  Card,
  Tag,
  message,
  Popconfirm,
  Row,
  Col,
  Select,
  Tooltip,
  Empty,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  SaveOutlined,
  ClearOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import {
  PlumberReportTemplate,
  PlumberReportTemplateDetail,
  PlumberReportTemplateCreate,
  plumberReportTemplateService
} from '../../services/plumberReportTemplateService';
import { useAuth } from '../../contexts/AuthContext';
import RichTextEditor from '../editor/RichTextEditor';

const { TextArea } = Input;

interface TemplateManagerProps {
  visible: boolean;
  onClose: () => void;
  companyId: string;
  templateType: 'warranty' | 'terms' | 'notes';
  onTemplateSelect: (content: string, template: PlumberReportTemplate) => void;
}

type TabKey = 'browse' | 'manage';

const TemplateManager: React.FC<TemplateManagerProps> = ({
  visible,
  onClose,
  companyId,
  templateType,
  onTemplateSelect,
}) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>('browse');
  const [templates, setTemplates] = useState<PlumberReportTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<PlumberReportTemplateDetail | null>(null);

  // Create/Edit modal states
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PlumberReportTemplateDetail | null>(null);
  const [form] = Form.useForm();
  const [editorContent, setEditorContent] = useState('');

  // Preview modal states
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [previewContent, setPreviewContent] = useState('');
  const [previewTitle, setPreviewTitle] = useState('');

  useEffect(() => {
    if (visible) {
      loadTemplates();
    }
  }, [visible, companyId, templateType]);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const data = await plumberReportTemplateService.getTemplatesByType(
        companyId,
        templateType
      );
      setTemplates(data);
    } catch (error) {
      console.error('Failed to load templates:', error);
      message.error('Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const handleTemplateSelect = async (template: PlumberReportTemplate) => {
    try {
      const result = await plumberReportTemplateService.useTemplate(
        template.id,
        companyId,
        user?.id || 'anonymous'
      );
      onTemplateSelect(result.content, template);
      onClose();
      message.success(`Template "${template.name}" applied`);
    } catch (error) {
      console.error('Failed to use template:', error);
      message.error('Failed to apply template');
    }
  };

  const handlePreviewTemplate = async (template: PlumberReportTemplate) => {
    try {
      const detail = await plumberReportTemplateService.getTemplate(template.id);
      setPreviewContent(detail.content);
      setPreviewTitle(template.name);
      setPreviewModalVisible(true);
    } catch (error) {
      console.error('Failed to load template detail:', error);
      message.error('Failed to load template preview');
    }
  };

  const handleCreateTemplate = () => {
    setEditingTemplate(null);
    form.resetFields();
    form.setFieldsValue({ type: templateType });
    setEditorContent('');
    setEditModalVisible(true);
  };

  const handleEditTemplate = async (template: PlumberReportTemplate) => {
    try {
      const detail = await plumberReportTemplateService.getTemplate(template.id);
      setEditingTemplate(detail);
      form.setFieldsValue({
        name: detail.name,
        type: detail.type,
        description: detail.description || '',
      });
      setEditorContent(detail.content || '');
      setEditModalVisible(true);
    } catch (error) {
      console.error('Failed to load template for editing:', error);
      message.error('Failed to load template');
    }
  };

  const handleSaveTemplate = async () => {
    try {
      const values = await form.validateFields();
      const templateData: PlumberReportTemplateCreate = {
        name: values.name,
        type: values.type,
        content: editorContent,
        description: values.description,
      };

      if (editingTemplate) {
        // Update existing template
        await plumberReportTemplateService.updateTemplate(
          editingTemplate.id,
          companyId,
          templateData
        );
        message.success('Template updated successfully');
      } else {
        // Create new template
        await plumberReportTemplateService.createTemplate(
          companyId,
          user?.id || 'anonymous',
          templateData
        );
        message.success('Template created successfully');
      }

      setEditModalVisible(false);
      loadTemplates(); // Reload templates
    } catch (error) {
      console.error('Failed to save template:', error);
      message.error('Failed to save template');
    }
  };

  const handleDeleteTemplate = async (templateId: string, templateName: string) => {
    try {
      await plumberReportTemplateService.deleteTemplate(templateId, companyId);
      message.success(`Template "${templateName}" deleted successfully`);
      loadTemplates(); // Reload templates
    } catch (error) {
      console.error('Failed to delete template:', error);
      message.error('Failed to delete template');
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'warranty': return 'Warranty Information';
      case 'terms': return 'Terms & Conditions';
      case 'notes': return 'Additional Notes';
      default: return type;
    }
  };

  const tabItems = [
    {
      key: 'browse' as TabKey,
      label: 'Browse Templates',
      children: (
        <div style={{ minHeight: '400px' }}>
          <List
            loading={loading}
            dataSource={templates}
            locale={{
              emptyText: (
                <Empty
                  description={`No ${getTypeLabel(templateType).toLowerCase()} templates found`}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                >
                  <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateTemplate}>
                    Create First Template
                  </Button>
                </Empty>
              )
            }}
            renderItem={(template) => (
              <List.Item
                actions={[
                  <Tooltip title="Preview">
                    <Button
                      icon={<EyeOutlined />}
                      onClick={() => handlePreviewTemplate(template)}
                    />
                  </Tooltip>,
                  <Button
                    type="primary"
                    onClick={() => handleTemplateSelect(template)}
                  >
                    Use Template
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <span>{template.name}</span>
                      {template.usage_count > 0 && (
                        <Tag color="blue">Used {template.usage_count} times</Tag>
                      )}
                    </Space>
                  }
                  description={template.description}
                />
              </List.Item>
            )}
          />
        </div>
      ),
    },
    {
      key: 'manage' as TabKey,
      label: 'Manage Templates',
      children: (
        <div style={{ minHeight: '400px' }}>
          <div style={{ marginBottom: 16, textAlign: 'right' }}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreateTemplate}
            >
              Create New Template
            </Button>
          </div>

          <List
            loading={loading}
            dataSource={templates}
            locale={{
              emptyText: (
                <Empty
                  description={`No ${getTypeLabel(templateType).toLowerCase()} templates found`}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                >
                  <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateTemplate}>
                    Create First Template
                  </Button>
                </Empty>
              )
            }}
            renderItem={(template) => (
              <List.Item
                actions={[
                  <Tooltip title="Preview">
                    <Button
                      icon={<EyeOutlined />}
                      onClick={() => handlePreviewTemplate(template)}
                    />
                  </Tooltip>,
                  <Tooltip title="Edit">
                    <Button
                      icon={<EditOutlined />}
                      onClick={() => handleEditTemplate(template)}
                    />
                  </Tooltip>,
                  <Popconfirm
                    title={`Delete template "${template.name}"?`}
                    description="This action cannot be undone."
                    onConfirm={() => handleDeleteTemplate(template.id, template.name)}
                    okText="Delete"
                    cancelText="Cancel"
                    okType="danger"
                  >
                    <Tooltip title="Delete">
                      <Button danger icon={<DeleteOutlined />} />
                    </Tooltip>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <span>{template.name}</span>
                      {template.usage_count > 0 && (
                        <Tag color="blue">Used {template.usage_count} times</Tag>
                      )}
                    </Space>
                  }
                  description={template.description}
                />
              </List.Item>
            )}
          />
        </div>
      ),
    },
  ];

  return (
    <>
      {/* Main Template Manager Modal */}
      <Modal
        title={`${getTypeLabel(templateType)} Templates`}
        open={visible}
        onCancel={onClose}
        footer={null}
        width={900}
        destroyOnClose
      >
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as TabKey)}
          items={tabItems}
        />
      </Modal>

      {/* Create/Edit Template Modal */}
      <Modal
        title={editingTemplate ? 'Edit Template' : 'Create New Template'}
        open={editModalVisible}
        onCancel={() => {
          setEditModalVisible(false);
          form.resetFields();
          setEditorContent('');
        }}
        footer={[
          <Button key="cancel" onClick={() => setEditModalVisible(false)}>
            Cancel
          </Button>,
          <Button key="save" type="primary" icon={<SaveOutlined />} onClick={handleSaveTemplate}>
            {editingTemplate ? 'Update' : 'Create'} Template
          </Button>,
        ]}
        width={800}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ type: templateType }}
        >
          <Row gutter={16}>
            <Col span={16}>
              <Form.Item
                name="name"
                label="Template Name"
                rules={[{ required: true, message: 'Please enter template name' }]}
              >
                <Input placeholder="Enter template name" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="type"
                label="Type"
                rules={[{ required: true }]}
              >
                <Select disabled>
                  <Select.Option value="warranty">Warranty Information</Select.Option>
                  <Select.Option value="terms">Terms & Conditions</Select.Option>
                  <Select.Option value="notes">Additional Notes</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="description" label="Description (Optional)">
            <TextArea
              placeholder="Enter template description"
              rows={3}
              maxLength={500}
              showCount
            />
          </Form.Item>

          <Form.Item
            label="Template Content"
            required
            tooltip="Use rich text formatting to create your template content"
          >
            <RichTextEditor
              value={editorContent}
              onChange={setEditorContent}
              placeholder="Enter template content with rich text formatting..."
              minHeight={200}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Template Preview Modal */}
      <Modal
        title={`Preview: ${previewTitle}`}
        open={previewModalVisible}
        onCancel={() => setPreviewModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setPreviewModalVisible(false)}>
            Close
          </Button>,
        ]}
        width={700}
      >
        <Card>
          <div
            dangerouslySetInnerHTML={{ __html: previewContent }}
            style={{
              maxHeight: '500px',
              overflow: 'auto',
              padding: '16px',
              border: '1px solid #f0f0f0',
              borderRadius: '4px',
              backgroundColor: '#fafafa',
              lineHeight: '1.6',
            }}
          />
        </Card>
      </Modal>
    </>
  );
};

export default TemplateManager;