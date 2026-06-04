import React, { useState, useEffect } from 'react';
import {
  Modal, Steps, Select, Form, Input, Button, Descriptions, Space, Spin,
  message, Typography, Tag, Alert, Divider,
} from 'antd';
import {
  FileTextOutlined, EditOutlined, FormOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import { rebuildService } from '../../services/rebuildService';
import WMSignaturePad from '../water-mitigation/pdf-annotator/WMSignaturePad';
import type { RebuildProject, RebuildCompletionDoc } from '../../types/rebuild';

const { Text } = Typography;
const { TextArea } = Input;

interface Props {
  open: boolean;
  project: RebuildProject;
  onClose: () => void;
  onSuccess: (doc: RebuildCompletionDoc) => void;
}

interface TemplateInfo {
  id: string;
  name: string;
  document_type: string;
  requires_signature: boolean;
  field_mappings: any[];
}

const DOC_TYPE_OPTIONS = [
  { value: 'coc', label: 'Certificate of Completion' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'warranty', label: 'Warranty' },
  { value: 'permit', label: 'Permit' },
  { value: 'lien_waiver', label: 'Lien Waiver' },
  { value: 'other', label: 'Other' },
];

const RebuildDocGenerator: React.FC<Props> = ({ open, project, onClose, onSuccess }) => {
  const [step, setStep] = useState(0);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateInfo | null>(null);
  const [prefillData, setPrefillData] = useState<Record<string, any>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [docType, setDocType] = useState('coc');
  const [title, setTitle] = useState('');
  const [additionalText, setAdditionalText] = useState('');
  const [signatureImage, setSignatureImage] = useState('');
  const [signatureName, setSignatureName] = useState('');
  const [signaturePadOpen, setSignaturePadOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (open && project) {
      setLoading(true);
      Promise.all([
        rebuildService.getAvailableTemplates(project.id),
        rebuildService.getPrefillData(project.id),
      ]).then(([tmpl, prefill]) => {
        setTemplates(tmpl);
        setPrefillData(prefill);
      }).catch(() => {
        message.error('Failed to load templates');
      }).finally(() => setLoading(false));
    }
  }, [open, project]);

  const handleClose = () => {
    setStep(0);
    setSelectedTemplate(null);
    setOverrides({});
    setDocType('coc');
    setTitle('');
    setAdditionalText('');
    setSignatureImage('');
    setSignatureName('');
    onClose();
  };

  const handleTemplateSelect = (templateId: string) => {
    const tmpl = templates.find(t => t.id === templateId);
    if (tmpl) {
      setSelectedTemplate(tmpl);
      setTitle(tmpl.name);
      setDocType(tmpl.document_type || 'coc');
    }
  };

  const handleOverride = (fieldKey: string, value: string) => {
    setOverrides(prev => ({ ...prev, [fieldKey]: value }));
  };

  const resolveFieldValue = (fieldKey: string): string => {
    if (overrides[fieldKey] !== undefined) return overrides[fieldKey];
    const [cat, key] = fieldKey.split('.');
    return prefillData?.[cat]?.[key] || '';
  };

  const handleGenerate = async () => {
    if (!selectedTemplate) return;
    setGenerating(true);
    try {
      const result = await rebuildService.generateDocument(project.id, {
        template_id: selectedTemplate.id,
        doc_type: docType,
        title,
        overrides,
        additional_text: additionalText,
        signature_image: signatureImage || undefined,
        signature_name: signatureName || undefined,
      });
      message.success('Document generated');
      onSuccess(result);
      handleClose();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to generate');
    } finally {
      setGenerating(false);
    }
  };

  const renderStep0 = () => (
    <div>
      {!project.contractor_id && (
        <Alert type="warning" message="No contractor assigned. Please assign a contractor first." showIcon style={{ marginBottom: 16 }} />
      )}
      {templates.length === 0 && !loading && (
        <Alert type="info" message="No templates found for this contractor's company. Upload templates in Contract Management first." showIcon style={{ marginBottom: 16 }} />
      )}
      <Form layout="vertical" size="small">
        <Form.Item label="Contract Template" required>
          <Select
            placeholder="Select a template..."
            value={selectedTemplate?.id}
            onChange={handleTemplateSelect}
            options={templates.map(t => ({
              value: t.id,
              label: `${t.name} (${t.document_type})`,
            }))}
            disabled={templates.length === 0}
          />
        </Form.Item>
        <Form.Item label="Document Type">
          <Select value={docType} onChange={setDocType} options={DOC_TYPE_OPTIONS} />
        </Form.Item>
        <Form.Item label="Document Title">
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Document title" />
        </Form.Item>
      </Form>
    </div>
  );

  const renderStep1 = () => {
    const mappings = selectedTemplate?.field_mappings || [];
    const uniqueFields = mappings.reduce((acc: any[], m: any) => {
      if (!acc.find((a: any) => a.fieldKey === m.fieldKey)) acc.push(m);
      return acc;
    }, []);

    return (
      <div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Review auto-filled values. Click any value to override it.
        </Text>
        {uniqueFields.length === 0 ? (
          <Alert type="info" message="This template has no field mappings. The original PDF will be used as-is." showIcon />
        ) : (
          <Descriptions size="small" column={1} bordered>
            {uniqueFields.map((field: any) => (
              <Descriptions.Item key={field.fieldKey} label={field.label || field.fieldKey}>
                <Input
                  size="small"
                  value={resolveFieldValue(field.fieldKey)}
                  onChange={e => handleOverride(field.fieldKey, e.target.value)}
                  placeholder="(empty)"
                  variant="borderless"
                  style={{ padding: 0 }}
                />
              </Descriptions.Item>
            ))}
          </Descriptions>
        )}

        <Divider style={{ margin: '16px 0 12px' }} />
        <Form layout="vertical" size="small">
          <Form.Item label="Additional Notes (printed on document)">
            <TextArea
              rows={3}
              value={additionalText}
              onChange={e => setAdditionalText(e.target.value)}
              placeholder="Optional additional text to include..."
            />
          </Form.Item>
        </Form>
      </div>
    );
  };

  const renderStep2 = () => (
    <div>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        Add your signature to the document.
      </Text>
      {signatureImage ? (
        <div style={{ textAlign: 'center', padding: 16, border: '1px solid #d9d9d9', borderRadius: 8, marginBottom: 12 }}>
          <img src={signatureImage} alt="Signature" style={{ maxHeight: 80 }} />
          <div style={{ marginTop: 8 }}>
            <Text>{signatureName}</Text>
          </div>
          <Button size="small" style={{ marginTop: 8 }} onClick={() => { setSignatureImage(''); setSignatureName(''); }}>
            Clear
          </Button>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 24, border: '1px dashed #d9d9d9', borderRadius: 8, marginBottom: 12 }}>
          <Button type="primary" onClick={() => setSignaturePadOpen(true)}>
            Add Signature
          </Button>
        </div>
      )}
      <Alert type="info" message="Signature is optional. You can generate the document without signing." showIcon />
      <WMSignaturePad
        open={signaturePadOpen}
        onClose={() => setSignaturePadOpen(false)}
        onSave={(imageData, _type, typedName) => {
          setSignatureImage(imageData);
          setSignatureName(typedName || '');
          setSignaturePadOpen(false);
        }}
      />
    </div>
  );

  const steps = [
    { title: 'Template', icon: <FileTextOutlined /> },
    { title: 'Fields', icon: <EditOutlined /> },
    { title: 'Sign', icon: <FormOutlined /> },
  ];

  const canNext = () => {
    if (step === 0) return !!selectedTemplate && !!title;
    return true;
  };

  return (
    <Modal
      title="Generate Document"
      open={open}
      width={650}
      onCancel={handleClose}
      footer={
        <Space>
          <Button onClick={handleClose}>Cancel</Button>
          {step > 0 && <Button onClick={() => setStep(s => s - 1)}>Back</Button>}
          {step < 2 ? (
            <Button type="primary" disabled={!canNext()} onClick={() => setStep(s => s + 1)}>
              Next
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={generating}
              onClick={handleGenerate}
            >
              Generate PDF
            </Button>
          )}
        </Space>
      }
    >
      <Spin spinning={loading}>
        <Steps current={step} size="small" items={steps} style={{ marginBottom: 20 }} />
        {step === 0 && renderStep0()}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
      </Spin>
    </Modal>
  );
};

export default RebuildDocGenerator;
