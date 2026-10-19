import React, { useState, useEffect } from 'react';
import {
  Modal, Steps, Select, Form, Input, Button, Descriptions, Space, Spin,
  message, Typography, Tag, Alert, Divider,
} from 'antd';
import {
  FileTextOutlined, EditOutlined, FormOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import { rebuildService } from '../../services/rebuildService';
import { humanize } from '../common/ui';
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
  /** Completion doc type this template produces (certificate_of_completion -> coc) */
  doc_type: string;
  requires_signature: boolean;
  field_mappings: any[];
}

// Boxes filled from the signature step, not typed values
const SIGNATURE_PREFIXES = ['signature.', 'initial.', 'date_signed.'];
const isSignatureKey = (key: string) => SIGNATURE_PREFIXES.some(p => key.startsWith(p));

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
  const [signatureFieldKey, setSignatureFieldKey] = useState<string | undefined>();
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
    setSignatureFieldKey(undefined);
    onClose();
  };

  /** One option per signature box the template maps (a box repeated on several pages counts once) */
  const signatureBoxes = (tmpl: TemplateInfo | null) =>
    (tmpl?.field_mappings || []).reduce((acc: { key: string; label: string }[], m: any) => {
      if (m.fieldKey?.startsWith('signature.') && !acc.some(a => a.key === m.fieldKey)) {
        acc.push({ key: m.fieldKey, label: m.label || m.fieldKey });
      }
      return acc;
    }, []);

  const handleTemplateSelect = (templateId: string) => {
    const tmpl = templates.find(t => t.id === templateId);
    if (tmpl) {
      setSelectedTemplate(tmpl);
      setTitle(tmpl.name);
      setDocType(tmpl.doc_type || 'coc');
      setSignatureFieldKey(signatureBoxes(tmpl)[0]?.key);
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
        signature_field_key: signatureImage ? signatureFieldKey : undefined,
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

  // Templates come from the contractor's company, else the claim's reconstruction company
  const templateCompany = project.contractor_id ? project.contractor_name : project.rebuild_company_name;

  const renderStep0 = () => (
    <div>
      {templates.length === 0 && !loading && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={templateCompany
            ? `${templateCompany} has no completion template yet`
            : 'No company to take templates from'}
          description={templateCompany
            ? 'Add a "Certificate of Completion (Recon)" template for this company in Contract Templates, then map its fields.'
            : "Assign a contractor, or set the claim's reconstruction company, to use that company's templates."}
        />
      )}
      <Form layout="vertical" size="small">
        <Form.Item label="Contract Template" required>
          <Select
            placeholder="Select a template..."
            value={selectedTemplate?.id}
            onChange={handleTemplateSelect}
            options={templates.map(t => ({
              value: t.id,
              label: `${t.name} (${humanize(t.document_type || 'other')})`,
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
      if (!isSignatureKey(m.fieldKey || '') && !acc.find((a: any) => a.fieldKey === m.fieldKey)) acc.push(m);
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

  const renderStep2 = () => {
    const boxes = signatureBoxes(selectedTemplate);
    return (
    <div>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        {boxes.length
          ? 'The signature is placed in the template\'s signature box, with today\'s date in its date box.'
          : 'This template has no signature box, so the signature goes at the bottom right of the last page.'}
      </Text>
      {boxes.length > 1 && (
        <Form layout="vertical" size="small">
          <Form.Item label="Sign as">
            <Select value={signatureFieldKey} onChange={setSignatureFieldKey}
              options={boxes.map(b => ({ value: b.key, label: b.label }))} />
          </Form.Item>
        </Form>
      )}
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
  };

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
