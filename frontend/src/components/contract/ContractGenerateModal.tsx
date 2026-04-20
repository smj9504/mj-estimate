/**
 * ContractGenerateModal - Generate a contract instance from a template for a claim.
 *
 * Usage:
 *   import ContractGenerateModal from '../components/contract/ContractGenerateModal';
 *
 *   <ContractGenerateModal
 *     open={modalOpen}
 *     onClose={() => setModalOpen(false)}
 *     claimId={claim.id}
 *     clientId={claim.client_id}
 *     onSuccess={() => refetch()}
 *   />
 */

import React, { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Steps,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  CopyOutlined,
  FileTextOutlined,
  LinkOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { contractTemplateService, contractInstanceService } from '../../services/contractService';
import { companyService } from '../../services/companyService';
import type { ContractTemplate } from '../../types/contract';

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

// ── QR Code (canvas-based, no external dependency) ────────────────────────────

/**
 * Minimal URL display with a copy button — QR generation requires a library;
 * this placeholder shows the link clearly and can be upgraded to qrcode.react.
 */
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
      <Button
        icon={<CopyOutlined />}
        onClick={handleCopy}
        block
        style={{ marginBottom: 16 }}
      >
        Copy Signing Link
      </Button>
      {/* QR placeholder — replace with <QRCode value={url} /> from qrcode.react if available */}
      <div
        style={{
          border: '1px dashed #d9d9d9',
          borderRadius: 8,
          padding: 24,
          textAlign: 'center',
          color: '#8c8c8c',
          background: '#fafafa',
        }}
      >
        <div style={{ fontSize: 13, marginBottom: 4 }}>QR Code</div>
        <div style={{ fontSize: 12 }}>
          To enable QR code display, install{' '}
          <code>qrcode.react</code> and replace this placeholder.
        </div>
      </div>
    </div>
  );
};

// ── Step labels ───────────────────────────────────────────────────────────────

const STEPS = ['Select Company', 'Choose Template', 'Finalize'];

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
      }),
    onSuccess: (data) => {
      // Backend may return the signing URL directly or we construct it
      const token = data?.signing_token ?? data?.contract?.signing_token;
      const backendUrl = data?.signing_url;
      const signingUrl =
        backendUrl || (token ? `${window.location.origin}/sign/${token}` : '');
      const contractId = data?.contract?.id ?? data?.id ?? '';

      setCreated({ contractId, signingUrl, signingToken: token ?? '' });
      setCurrentStep(3); // success step
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
        form.resetFields();
      }, 300);
    }
  }, [open, form]);

  // ── Navigation ────────────────────────────────────────────────────────────────

  const handleNext = async () => {
    try {
      if (currentStep === 0) {
        await form.validateFields(['company_id']);
        setCurrentStep(1);
      } else if (currentStep === 1) {
        await form.validateFields(['template_id']);
        setCurrentStep(2);
      } else if (currentStep === 2) {
        const values = await form.validateFields();
        createMutation.mutate(values);
      }
    } catch {
      // Validation error — antd already shows inline errors
    }
  };

  const handleBack = () => {
    if (currentStep > 0 && currentStep < 3) setCurrentStep((s) => s - 1);
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
          placeholder={
            !selectedCompanyId ? 'Select a company first' : 'Select template'
          }
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
          </Space>
        </Card>
      )}
    </>
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
    currentStep === 3 ? (
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
          loading={createMutation.isPending}
          icon={currentStep === 2 ? <SendOutlined /> : undefined}
        >
          {currentStep === 2 ? 'Generate Contract' : 'Next'}
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
      onCancel={currentStep === 3 ? onClose : undefined}
      closable={currentStep === 3 || !createMutation.isPending}
      footer={footer}
      destroyOnClose
      width={540}
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
        {currentStep === 2 && StepFinalize}
      </Form>

      {currentStep === 3 && StepSuccess}
    </Modal>
  );
};

export default ContractGenerateModal;
