import React, { useState, useEffect } from 'react';
import { Select, Button, Space, Modal, List, Card, Tag, message } from 'antd';
import { FileTextOutlined, ClearOutlined, EyeOutlined, SettingOutlined } from '@ant-design/icons';
import {
  PlumberReportTemplate,
  plumberReportTemplateService
} from '../../services/plumberReportTemplateService';
import { useAuth } from '../../contexts/AuthContext';
import TemplateManager from './TemplateManager';

interface TemplateSelectorProps {
  companyId: string;
  templateType: 'warranty' | 'terms' | 'notes';
  selectedTemplate?: PlumberReportTemplate | null;
  onTemplateSelect: (content: string, template: PlumberReportTemplate) => void;
  onTemplateClear: () => void;
  disabled?: boolean;
}

const TemplateSelector: React.FC<TemplateSelectorProps> = ({
  companyId,
  templateType,
  selectedTemplate,
  onTemplateSelect,
  onTemplateClear,
  disabled = false,
}) => {
  const { user } = useAuth();
  const [quickTemplates, setQuickTemplates] = useState<PlumberReportTemplate[]>([]);
  const [allTemplates, setAllTemplates] = useState<PlumberReportTemplate[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [templateManagerVisible, setTemplateManagerVisible] = useState(false);
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [previewContent, setPreviewContent] = useState('');
  const [previewTitle, setPreviewTitle] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadQuickTemplates();
  }, [companyId, templateType]);

  const loadQuickTemplates = async () => {
    try {
      const templates = await plumberReportTemplateService.getQuickTemplates(
        companyId,
        templateType
      );
      setQuickTemplates(templates);
    } catch (error) {
      console.error('Failed to load quick templates:', error);
    }
  };

  const loadAllTemplates = async () => {
    try {
      setLoading(true);
      const templates = await plumberReportTemplateService.getTemplatesByType(
        companyId,
        templateType
      );
      setAllTemplates(templates);
    } catch (error) {
      console.error('Failed to load all templates:', error);
      message.error('Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickSelect = async (templateId: string) => {
    const template = quickTemplates.find(t => t.id === templateId);
    if (!template) return;

    try {
      const result = await plumberReportTemplateService.useTemplate(
        templateId,
        companyId,
        user?.id || 'anonymous'
      );
      onTemplateSelect(result.content, template);
      message.success(`Template "${template.name}" applied`);
    } catch (error) {
      console.error('Failed to use template:', error);
      message.error('Failed to apply template');
    }
  };

  const handleBrowseTemplates = () => {
    loadAllTemplates();
    setModalVisible(true);
  };

  const handleManageTemplates = () => {
    setTemplateManagerVisible(true);
  };

  const handleTemplateManagerSelect = (content: string, template: PlumberReportTemplate) => {
    onTemplateSelect(content, template);
    setTemplateManagerVisible(false);
    // Reload quick templates to reflect changes
    loadQuickTemplates();
  };

  const handleTemplateSelect = async (template: PlumberReportTemplate) => {
    try {
      const result = await plumberReportTemplateService.useTemplate(
        template.id,
        companyId,
        user?.id || 'anonymous'
      );
      onTemplateSelect(result.content, template);
      setModalVisible(false);
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

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'warranty': return 'Warranty Information';
      case 'terms': return 'Terms & Conditions';
      case 'notes': return 'Additional Notes';
      default: return type;
    }
  };

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Space wrap>
          {quickTemplates.length > 0 && (
            <Select
              placeholder="Quick Templates"
              style={{ minWidth: 200 }}
              value={selectedTemplate?.id}
              onChange={handleQuickSelect}
              disabled={disabled}
              allowClear
              onClear={onTemplateClear}
            >
              {quickTemplates.map(template => (
                <Select.Option key={template.id} value={template.id}>
                  {template.name}
                  {template.usage_count > 0 && (
                    <Tag style={{ marginLeft: 4, fontSize: '11px', padding: '0 4px' }}>
                      {template.usage_count}
                    </Tag>
                  )}
                </Select.Option>
              ))}
            </Select>
          )}

          <Button
            icon={<FileTextOutlined />}
            onClick={handleBrowseTemplates}
            disabled={disabled}
          >
            Browse All Templates
          </Button>

          <Button
            icon={<SettingOutlined />}
            onClick={handleManageTemplates}
            disabled={disabled}
            type="dashed"
          >
            Manage Templates
          </Button>

          {selectedTemplate && (
            <Button
              icon={<ClearOutlined />}
              onClick={onTemplateClear}
              disabled={disabled}
            >
              Clear Template
            </Button>
          )}
        </Space>

        {selectedTemplate && (
          <div style={{ marginTop: 8 }}>
            <Tag color="blue">
              Using: {selectedTemplate.name}
            </Tag>
          </div>
        )}
      </div>

      {/* Browse All Templates Modal */}
      <Modal
        title={`Choose ${getTypeLabel(templateType)} Template`}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={800}
      >
        <List
          loading={loading}
          dataSource={allTemplates}
          renderItem={(template) => (
            <List.Item
              actions={[
                <Button
                  icon={<EyeOutlined />}
                  onClick={() => handlePreviewTemplate(template)}
                >
                  Preview
                </Button>,
                <Button
                  type="primary"
                  onClick={() => handleTemplateSelect(template)}
                >
                  Use This Template
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={template.name}
                description={
                  <Space>
                    {template.description && <span>{template.description}</span>}
                    {template.usage_count > 0 && (
                      <Tag color="blue">Used {template.usage_count} times</Tag>
                    )}
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Modal>

      {/* Template Preview Modal */}
      <Modal
        title={`Preview: ${previewTitle}`}
        open={previewModalVisible}
        onCancel={() => setPreviewModalVisible(false)}
        footer={null}
        width={600}
      >
        <div
          dangerouslySetInnerHTML={{ __html: previewContent }}
          style={{
            maxHeight: '400px',
            overflow: 'auto',
            padding: '16px',
            border: '1px solid #f0f0f0',
            borderRadius: '4px',
            backgroundColor: '#fafafa',
          }}
        />
      </Modal>

      {/* Template Manager Modal */}
      <TemplateManager
        visible={templateManagerVisible}
        onClose={() => {
          setTemplateManagerVisible(false);
          // Reload quick templates to reflect any changes
          loadQuickTemplates();
        }}
        companyId={companyId}
        templateType={templateType}
        onTemplateSelect={handleTemplateManagerSelect}
      />
    </>
  );
};

export default TemplateSelector;