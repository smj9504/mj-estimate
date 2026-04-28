/**
 * ContractGenerateModal - Generate a contract instance from a template for a claim.
 * 4-step wizard: Select Company → Choose Template → Preview Data → Finalize
 */

import React, { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Steps,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  CopyOutlined,
  FileTextOutlined,
  SendOutlined,
} from '@ant-design/icons';
import {
  contractTemplateService,
  contractInstanceService,
} from '../../services/contractService';
import { companyService } from '../../services/companyService';
import type { ContractTemplate, PrefillPreviewData } from '../../types/contract';

const { Text, Paragraph, Title } = Typography;
const { Option } = Select;
const { TextArea } = Input;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ContractGenerateModalProps {
  open: boolean;
  onClose: () => void;
  claimId: string;
  clientId: string;
  onSuccess: () => void;
}

interface FormValues {
  company_id: string;
  template_id: string;
  title?: string;
  notes?: string;
  token_expires_days: number;
}

interface CreatedResult {
  contractId: string;
  signingUrl: string;
  signingToken: string;
}

// ── Signing Link Display ──────────────────────────────────────────────────────

const SigningLinkDisplay: React.FC<{ url: string }> = ({ url }) => {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      message.success('Link copied to clipboard.');
    } catch {
      message.error('Failed to copy. Please copy the link manually.');
    }
  };

  return (
    <div>
      <div
        style={{
          background: '#f5f5f5',
          border: '1px solid #d9d9d9',
          borderRadius: 8,
          padding: '12px 16px',
          wordBreak: 'break-all',
          fontFamily: 'monospace',
          fontSize: 13,
          marginBottom: 12,
        }}
      >
        {url}
      </div>
      <Button icon={<CopyOutlined />} onClick={handleCopy} block>
        Copy Signing Link
      </Button>
    </div>
  );
};

// ── Category labels ───────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  client: 'Client Information',
  claim: 'Claim Information',
  company: 'Company Information',
  meta: 'Contract Details',
};

// ── Step labels ───────────────────────────────────────────────────────────────

const STEPS = ['Select Company', 'Choose Template', 'Preview Data', 'Finalize'];

// ── Component ─────────────────────────────────────────────────────────────────

const ContractGenerateModal: React.FC<ContractGenerateModalProps> = ({
  open,
  onClose,
  claimId,
  clientId,
  onSuccess,
}) => {
  const [form] = Form.useForm<FormValues>();
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | undefined>(undefined);
  const [selectedTemplate, setSelectedTemplate] = useState<ContractTemplate | null>(null);
  const [created, setCreated] = useState<CreatedResult | null>(null);
  const [prefillData, setPrefillData] = useState<PrefillPreviewData | null>(null);
  const [prefillOverrides, setPrefillOverrides] = useState<Record<string, Record<string, string | null>>>({});
  const [prefillLoading, setPrefillLoading] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: companies = [], isLoading: companiesLoading } = useQuery({
    queryKey: ['companies'],
    queryFn: () => companyService.getCompanies(),
    enabled: open,
  });

  const { data: templatesData, isLoading: templatesLoading } = useQuery({
    queryKey: ['contract-templates', selectedCompanyId],
    queryFn: () => contractTemplateService.list(selectedCompanyId),
    enabled: !!selectedCompanyId && open,
  });

  const templates = (templatesData?.templates ?? []).filter((t) => t.is_active);

  // ── Mutation ─────────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (values: FormValues) =>
      contractInstanceService.create(claimId, {
        template_id: values.template_id,
        claim_id: claimId,
        client_id: clientId,
        company_id: values.company_id,
        title: values.title || undefined,
        notes: values.notes || undefined,
        token_expires_days: values.token_expires_days,
        prefill_overrides: Object.keys(prefillOverrides).length > 0 ? prefillOverrides : undefined,
      }),
    onSuccess: (data) => {
      const token = data?.signing_token ?? data?.contract?.signing_token;
      const backendUrl = data?.signing_url;
      const signingUrl =
        backendUrl || (token ? `${window.location.origin}/sign/${token}` : '');
      const contractId = data?.contract?.id ?? data?.id ?? '';

      setCreated({ contractId, signingUrl, signingToken: token ?? '' });
      setCurrentStep(4); // success step
      onSuccess();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to generate contract.');
    },
  });

  // ── Reset on close ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setCurrentStep(0);
        setSelectedCompanyId(undefined);
        setSelectedTemplate(null);
        setCreated(null);
        setPrefillData(null);
        setPrefillOverrides({});
        form.resetFields();
      }, 300);
    }
  }, [open, form]);

  // ── Load prefill preview ──────────────────────────────────────────────────────

  const loadPrefillPreview = async () => {
    if (!selectedCompanyId || !selectedTemplate) return;
    setPrefillLoading(true);
    try {
      const data = await contractInstanceService.getPrefillPreview(
        claimId,
        selectedTemplate.id,
        clientId,
        selectedCompanyId,
      );
      setPrefillData(data);
    } catch (err: any) {
      message.error('Failed to load prefill data.');
    } finally {
      setPrefillLoading(false);
    }
  };

  // ── Navigation ────────────────────────────────────────────────────────────────

  const handleNext = async () => {
    try {
      if (currentStep === 0) {
        await form.validateFields(['company_id']);
        setCurrentStep(1);
      } else if (currentStep === 1) {
        await form.validateFields(['template_id']);
        // Load prefill preview when moving to step 2
        await loadPrefillPreview();
        setCurrentStep(2);
      } else if (currentStep === 2) {
        setCurrentStep(3);
      } else if (currentStep === 3) {
        const values = await form.validateFields();
        createMutation.mutate(values);
      }
    } catch {
      // Validation error — antd already shows inline errors
    }
  };

  const handleBack = () => {
    if (currentStep > 0 && currentStep < 4) setCurrentStep((s) => s - 1);
  };

  // ── Prefill value edit handler ────────────────────────────────────────────────

  const handlePrefillEdit = (category: string, key: string, value: string) => {
    setPrefillOverrides(prev => ({
      ...prev,
      [category]: {
        ...(prev[category] || {}),
        [key]: value || null,
      },
    }));
  };

  // ── Step content ──────────────────────────────────────────────────────────────

  const StepCompany = (
    <Form.Item
      name="company_id"
      label={<Text strong>Company</Text>}
      rules={[{ required: true, message: 'Please select a company.' }]}
    >
      <Select
        placeholder="Select the company providing this contract"
        showSearch
        optionFilterProp="children"
        loading={companiesLoading}
        size="large"
        onChange={(v) => {
          setSelectedCompanyId(v);
          setSelectedTemplate(null);
          form.setFieldValue('template_id', undefined);
        }}
      >
        {companies.map((c) => (
          <Option key={c.id} value={c.id}>
            {c.name}
          </Option>
        ))}
      </Select>
    </Form.Item>
  );

  const StepTemplate = (
    <>
      <Form.Item
        name="template_id"
        label={<Text strong>Contract Template</Text>}
        rules={[{ required: true, message: 'Please select a template.' }]}
      >
        <Select
          placeholder={!selectedCompanyId ? 'Select a company first' : 'Select template'}
          disabled={!selectedCompanyId}
          loading={templatesLoading}
          size="large"
          onChange={(v) => {
            const tpl = templates.find((t) => t.id === v) ?? null;
            setSelectedTemplate(tpl);
          }}
        >
          {templates.map((t) => (
            <Option key={t.id} value={t.id}>
              {t.name}
            </Option>
          ))}
        </Select>
      </Form.Item>

      {selectedTemplate && (
        <Card size="small" style={{ background: '#f9f9f9', borderRadius: 8 }}>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <div>
              <Text type="secondary">Document Type: </Text>
              <Tag color="blue">{selectedTemplate.document_type}</Tag>
            </div>
            {selectedTemplate.description && (
              <div>
                <Text type="secondary">Description: </Text>
                <Text>{selectedTemplate.description}</Text>
              </div>
            )}
            <div>
              <Text type="secondary">Signature Required: </Text>
              <Text>{selectedTemplate.requires_signature ? 'Yes' : 'No'}</Text>
            </div>
            {selectedTemplate.field_mappings && (
              <div>
                <Text type="secondary">Field Mappings: </Text>
                <Tag color="green">Configured</Tag>
              </div>
            )}
          </Space>
        </Card>
      )}
    </>
  );

  const StepPrefillPreview = prefillLoading ? (
    <div style={{ textAlign: 'center', padding: 40 }}>
      <Spin />
      <div style={{ marginTop: 8, color: '#8c8c8c' }}>Loading data...</div>
    </div>
  ) : prefillData ? (
    <div style={{ maxHeight: 400, overflow: 'auto' }}>
      {['client', 'claim', 'company', 'meta'].map((category) => {
        const catData = (prefillData as any)[category] as Record<string, string | null> | undefined;
        if (!catData || Object.keys(catData).length === 0) return null;

        return (
          <div key={category} style={{ marginBottom: 16 }}>
            <Text strong style={{ fontSize: 13, color: '#1677ff' }}>
              {CATEGORY_LABELS[category] || category}
            </Text>
            <Divider style={{ margin: '4px 0 8px' }} />
            <Descriptions column={1} size="small" bordered>
              {Object.entries(catData).map(([key, value]) => {
                const overrideValue = prefillOverrides[category]?.[key];
                const displayValue = overrideValue !== undefined ? overrideValue : value;

                return (
                  <Descriptions.Item
                    key={key}
                    label={<Text style={{ fontSize: 12 }}>{key.replace(/_/g, ' ')}</Text>}
                  >
                    <Input
                      size="small"
                      value={displayValue || ''}
                      onChange={(e) => handlePrefillEdit(category, key, e.target.value)}
                      style={{ fontSize: 12 }}
                      variant="borderless"
                      placeholder="(empty)"
                    />
                  </Descriptions.Item>
                );
              })}
            </Descriptions>
          </div>
        );
      })}
      {prefillData.field_mappings.length > 0 && (
        <Alert
          type="info"
          message={`This template has ${prefillData.field_mappings.length} mapped field(s) that will be auto-filled in the PDF.`}
          style={{ marginTop: 8 }}
        />
      )}
    </div>
  ) : (
    <Alert type="warning" message="No prefill data available." />
  );

  const StepFinalize = (
    <>
      <Form.Item name="title" label={<Text strong>Title Override</Text>}>
        <Input
          placeholder={selectedTemplate?.name ?? 'Leave blank to use template name'}
          size="large"
        />
      </Form.Item>

      <Form.Item name="notes" label={<Text strong>Notes</Text>}>
        <TextArea
          rows={3}
          placeholder="Optional notes visible internally"
          maxLength={2000}
        />
      </Form.Item>

      <Form.Item
        name="token_expires_days"
        label={<Text strong>Link Expires In (days)</Text>}
        rules={[{ required: true, message: 'Please specify expiry days.' }]}
        initialValue={30}
      >
        <InputNumber
          min={1}
          max={365}
          size="large"
          style={{ width: '100%' }}
          addonAfter="days"
        />
      </Form.Item>
    </>
  );

  const StepSuccess = created ? (
    <div style={{ textAlign: 'center' }}>
      <CheckCircleOutlined style={{ fontSize: 56, color: '#52c41a', marginBottom: 12 }} />
      <Title level={4} style={{ marginBottom: 4 }}>
        Contract Generated
      </Title>
      <Paragraph type="secondary" style={{ marginBottom: 24 }}>
        Share the link below with the client to collect their signature.
      </Paragraph>

      {created.signingUrl ? (
        <SigningLinkDisplay url={created.signingUrl} />
      ) : (
        <Alert
          type="info"
          message="The contract was created but no signing URL was returned. Use the Send action in the contracts list to generate a link."
        />
      )}
    </div>
  ) : null;

  // ── Footer buttons ────────────────────────────────────────────────────────────

  const footer =
    currentStep === 4 ? (
      <Button type="primary" onClick={onClose} block>
        Done
      </Button>
    ) : (
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button onClick={currentStep === 0 ? onClose : handleBack} disabled={createMutation.isPending}>
          {currentStep === 0 ? 'Cancel' : 'Back'}
        </Button>
        <Button
          type="primary"
          onClick={handleNext}
          loading={createMutation.isPending || prefillLoading}
          icon={currentStep === 3 ? <SendOutlined /> : undefined}
        >
          {currentStep === 3 ? 'Generate Contract' : 'Next'}
        </Button>
      </div>
    );

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <Modal
      title={
        <Space>
          <FileTextOutlined style={{ color: '#1677ff' }} />
          Generate Contract
        </Space>
      }
      open={open}
      onCancel={currentStep === 4 ? onClose : undefined}
      closable={currentStep === 4 || !createMutation.isPending}
      footer={footer}
      destroyOnClose
      width={600}
    >
      {/* Steps indicator */}
      <Steps
        size="small"
        current={Math.min(currentStep, STEPS.length - 1)}
        items={STEPS.map((label) => ({ title: label }))}
        style={{ marginBottom: 28, marginTop: 8 }}
      />

      <Form
        form={form}
        layout="vertical"
        initialValues={{ token_expires_days: 30 }}
      >
        {currentStep === 0 && StepCompany}
        {currentStep === 1 && StepTemplate}
        {currentStep === 3 && StepFinalize}
      </Form>

      {currentStep === 2 && StepPrefillPreview}
      {currentStep === 4 && StepSuccess}
    </Modal>
  );
};

export default ContractGenerateModal;
