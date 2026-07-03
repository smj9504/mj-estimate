/**
 * WMContractTab - Contract management within Water Mitigation job detail page.
 * Lists existing contracts, allows generating new ones from company templates.
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Steps,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleOutlined,
  CopyOutlined,
  FileTextOutlined,
  PlusOutlined,
  SendOutlined,
  StopOutlined,
  LinkOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import {
  wmContractService,
  contractInstanceService,
} from '../../services/contractService';
// Note: wmContractService.getPrefillPreview is used for WM-specific prefill (includes WM job fields)
import type { ContractInstance, ContractTemplate, ContractStatus, PrefillPreviewData } from '../../types/contract';
import dayjs from 'dayjs';

const { Text, Paragraph, Title } = Typography;
const { TextArea } = Input;

interface WMContractTabProps {
  jobId: string;
  claimId?: string;
  clientId?: string;
  companyId?: string;
  companyName?: string;
}

const STATUS_COLORS: Record<ContractStatus, string> = {
  draft: 'default',
  sent: 'processing',
  viewed: 'warning',
  signed: 'success',
  voided: 'error',
};

const CATEGORY_LABELS: Record<string, string> = {
  client: 'Client Information',
  claim: 'Claim / Insurance Information',
  company: 'Company Information',
  wm_job: 'Water Mitigation Job',
  meta: 'Contract Details',
};

// ---- Generate Modal --------------------------------------------------------

interface GenerateModalProps {
  open: boolean;
  onClose: () => void;
  jobId: string;
  claimId: string;
  clientId: string;
  companyId: string;
  onSuccess: () => void;
}

interface FormValues {
  template_id: string;
  title?: string;
  notes?: string;
  token_expires_days: number;
}

const STEPS = ['Choose Template', 'Preview Data', 'Finalize'];

const GenerateContractModal: React.FC<GenerateModalProps> = ({
  open,
  onClose,
  jobId,
  claimId,
  clientId,
  companyId,
  onSuccess,
}) => {
  const [form] = Form.useForm<FormValues>();
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<ContractTemplate | null>(null);
  const [prefillData, setPrefillData] = useState<PrefillPreviewData | null>(null);
  const [prefillOverrides, setPrefillOverrides] = useState<Record<string, Record<string, string | null>>>({});
  const [prefillLoading, setPrefillLoading] = useState(false);
  const [created, setCreated] = useState<{ signingUrl: string } | null>(null);

  const { data: templatesData, isLoading: templatesLoading } = useQuery({
    queryKey: ['wm-contract-templates', jobId],
    queryFn: () => wmContractService.getAvailableTemplates(jobId),
    enabled: open,
  });

  const templates = templatesData?.templates ?? [];

  const createMutation = useMutation({
    mutationFn: (values: FormValues) =>
      wmContractService.create(jobId, {
        template_id: values.template_id,
        claim_id: claimId,
        client_id: clientId,
        company_id: companyId,
        title: values.title || undefined,
        notes: values.notes || undefined,
        token_expires_days: values.token_expires_days,
        prefill_overrides: Object.keys(prefillOverrides).length > 0 ? prefillOverrides : undefined,
      }),
    onSuccess: (data) => {
      const token = data?.signing_token ?? data?.contract?.signing_token;
      const signingUrl = token ? `${window.location.origin}/sign/${token}` : '';
      setCreated({ signingUrl });
      setCurrentStep(3);
      onSuccess();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to generate contract.');
    },
  });

  React.useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setCurrentStep(0);
        setSelectedTemplate(null);
        setPrefillData(null);
        setPrefillOverrides({});
        setCreated(null);
        form.resetFields();
      }, 300);
    }
  }, [open, form]);

  const loadPrefillPreview = async () => {
    if (!selectedTemplate) return;
    setPrefillLoading(true);
    try {
      // Use WM-specific prefill endpoint that includes WM job fields
      const data = await wmContractService.getPrefillPreview(jobId, selectedTemplate.id);
      setPrefillData(data);
    } catch {
      message.error('Failed to load prefill data.');
    } finally {
      setPrefillLoading(false);
    }
  };

  const handleNext = async () => {
    try {
      if (currentStep === 0) {
        await form.validateFields(['template_id']);
        await loadPrefillPreview();
        setCurrentStep(1);
      } else if (currentStep === 1) {
        setCurrentStep(2);
      } else if (currentStep === 2) {
        const values = await form.validateFields();
        createMutation.mutate(values);
      }
    } catch {
      // validation error
    }
  };

  const handleBack = () => {
    if (currentStep > 0 && currentStep < 3) setCurrentStep((s) => s - 1);
  };

  const handlePrefillEdit = (category: string, key: string, value: string) => {
    setPrefillOverrides(prev => ({
      ...prev,
      [category]: { ...(prev[category] || {}), [key]: value || null },
    }));
  };

  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      message.success('Signing link copied.');
    } catch {
      message.error('Failed to copy link.');
    }
  };

  // Step 0: Choose Template
  const StepTemplate = (
    <>
      <Form.Item
        name="template_id"
        label={<Text strong>Contract Template</Text>}
        rules={[{ required: true, message: 'Please select a template.' }]}
      >
        <Select
          placeholder="Select a contract template"
          loading={templatesLoading}
          size="large"
          onChange={(v) => {
            const tpl = templates.find((t) => t.id === v) ?? null;
            setSelectedTemplate(tpl);
          }}
        >
          {templates.map((t) => (
            <Select.Option key={t.id} value={t.id}>
              {t.name}
              <Tag color="blue" style={{ marginLeft: 8 }}>{t.document_type}</Tag>
            </Select.Option>
          ))}
        </Select>
      </Form.Item>

      {selectedTemplate?.description && (
        <Card size="small" style={{ background: '#f9f9f9' }}>
          <Text type="secondary">{selectedTemplate.description}</Text>
        </Card>
      )}

      {templates.length === 0 && !templatesLoading && (
        <Alert
          type="info"
          message="No templates available"
          description="This company has no active contract templates. Add templates in Company Management > Contracts tab."
        />
      )}
    </>
  );

  // Step 1: Preview Prefill Data
  const StepPreview = prefillLoading ? (
    <div style={{ textAlign: 'center', padding: 40 }}>
      <Spin />
      <div style={{ marginTop: 8, color: '#8c8c8c' }}>Loading claim data...</div>
    </div>
  ) : prefillData ? (
    <div style={{ maxHeight: 400, overflow: 'auto' }}>
      {['client', 'claim', 'company', 'wm_job', 'meta'].map((category) => {
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
    </div>
  ) : (
    <Alert type="warning" message="No prefill data available." />
  );

  // Step 2: Finalize
  const StepFinalize = (
    <>
      <Form.Item name="title" label={<Text strong>Title Override</Text>}>
        <Input
          placeholder={selectedTemplate?.name ?? 'Leave blank to use template name'}
          size="large"
        />
      </Form.Item>
      <Form.Item name="notes" label={<Text strong>Notes</Text>}>
        <TextArea rows={3} placeholder="Optional internal notes" maxLength={2000} />
      </Form.Item>
      <Form.Item
        name="token_expires_days"
        label={<Text strong>Signing Link Expires In</Text>}
        rules={[{ required: true }]}
        initialValue={30}
      >
        <InputNumber min={1} max={365} size="large" style={{ width: '100%' }} addonAfter="days" />
      </Form.Item>
    </>
  );

  // Step 3: Success
  const StepSuccess = created ? (
    <div style={{ textAlign: 'center' }}>
      <CheckCircleOutlined style={{ fontSize: 56, color: '#52c41a', marginBottom: 12 }} />
      <Title level={4} style={{ marginBottom: 4 }}>Contract Generated</Title>
      <Paragraph type="secondary" style={{ marginBottom: 24 }}>
        Share the signing link with the homeowner.
      </Paragraph>
      {created.signingUrl ? (
        <div>
          <div style={{
            background: '#f5f5f5', border: '1px solid #d9d9d9', borderRadius: 8,
            padding: '12px 16px', wordBreak: 'break-all', fontFamily: 'monospace',
            fontSize: 13, marginBottom: 12,
          }}>
            {created.signingUrl}
          </div>
          <Button icon={<CopyOutlined />} onClick={() => handleCopyLink(created.signingUrl)} block>
            Copy Signing Link
          </Button>
        </div>
      ) : (
        <Alert type="info" message="Contract created. Use the Send action to generate a signing link." />
      )}
    </div>
  ) : null;

  const footer = currentStep === 3 ? (
    <Button type="primary" onClick={onClose} block>Done</Button>
  ) : (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <Button onClick={currentStep === 0 ? onClose : handleBack} disabled={createMutation.isPending}>
        {currentStep === 0 ? 'Cancel' : 'Back'}
      </Button>
      <Button
        type="primary"
        onClick={handleNext}
        loading={createMutation.isPending || prefillLoading}
        icon={currentStep === 2 ? <SendOutlined /> : undefined}
      >
        {currentStep === 2 ? 'Generate Contract' : 'Next'}
      </Button>
    </div>
  );

  return (
    <Modal
      title={<Space><FileTextOutlined style={{ color: '#1677ff' }} />Generate Contract</Space>}
      open={open}
      onCancel={currentStep === 3 ? onClose : undefined}
      closable={currentStep === 3 || !createMutation.isPending}
      footer={footer}
      destroyOnClose
      width={600}
    >
      <Steps
        size="small"
        current={Math.min(currentStep, STEPS.length - 1)}
        items={STEPS.map((label) => ({ title: label }))}
        style={{ marginBottom: 28, marginTop: 8 }}
      />
      <Form form={form} layout="vertical" initialValues={{ token_expires_days: 30 }}>
        {currentStep === 0 && StepTemplate}
        {currentStep === 2 && StepFinalize}
      </Form>
      {currentStep === 1 && StepPreview}
      {currentStep === 3 && StepSuccess}
    </Modal>
  );
};

// ---- Main Tab Component ----------------------------------------------------

const WMContractTab: React.FC<WMContractTabProps> = ({
  jobId,
  claimId,
  clientId,
  companyId,
  companyName,
}) => {
  const queryClient = useQueryClient();
  const [generateOpen, setGenerateOpen] = useState(false);

  const { data: contractsData, isLoading } = useQuery({
    queryKey: ['wm-job-contracts', jobId],
    queryFn: () => wmContractService.listByJob(jobId),
    enabled: !!jobId,
  });

  const contracts = contractsData?.contracts ?? [];

  const sendMutation = useMutation({
    mutationFn: ({ claimId, contractId }: { claimId: string; contractId: string }) =>
      contractInstanceService.send(claimId, contractId),
    onSuccess: (data) => {
      const token = data?.signing_token;
      if (token) {
        const url = `${window.location.origin}/sign/${token}`;
        navigator.clipboard.writeText(url).then(() => {
          message.success('Contract sent. Signing link copied to clipboard.');
        }).catch(() => {
          message.success('Contract sent.');
        });
      } else {
        message.success('Contract sent.');
      }
      queryClient.invalidateQueries({ queryKey: ['wm-job-contracts', jobId] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to send contract.');
    },
  });

  const voidMutation = useMutation({
    mutationFn: ({ claimId, contractId }: { claimId: string; contractId: string }) =>
      contractInstanceService.void(claimId, contractId),
    onSuccess: () => {
      message.success('Contract voided.');
      queryClient.invalidateQueries({ queryKey: ['wm-job-contracts', jobId] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to void contract.');
    },
  });

  const handleSend = (contract: ContractInstance) => {
    sendMutation.mutate({ claimId: contract.claim_id, contractId: contract.id });
  };

  const handleVoid = (contract: ContractInstance) => {
    Modal.confirm({
      title: 'Void Contract',
      icon: <ExclamationCircleOutlined />,
      content: 'This will invalidate the signing link. This action cannot be undone.',
      okText: 'Void',
      okType: 'danger',
      onOk: () => voidMutation.mutate({ claimId: contract.claim_id, contractId: contract.id }),
    });
  };

  const handleCopyLink = async (token: string) => {
    const url = `${window.location.origin}/sign/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      message.success('Signing link copied.');
    } catch {
      message.error('Failed to copy.');
    }
  };

  const columns: ColumnsType<ContractInstance> = [
    {
      title: 'Contract',
      key: 'title',
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{record.title || record.template_name || 'Untitled'}</Text>
          {record.contract_number && (
            <Text type="secondary" style={{ fontSize: 12 }}>#{record.contract_number}</Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'document_type',
      key: 'document_type',
      width: 150,
      render: (v?: string) => v ? <Tag>{v.replace(/_/g, ' ')}</Tag> : '-',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: ContractStatus) => (
        <Tag color={STATUS_COLORS[s]}>{s.charAt(0).toUpperCase() + s.slice(1)}</Tag>
      ),
    },
    {
      title: 'Date',
      key: 'date',
      width: 120,
      render: (_, record) => {
        const d = record.signed_at || record.sent_at || record.created_at;
        return d ? dayjs(d).format('MMM D, YYYY') : '-';
      },
    },
    {
      title: '',
      key: 'actions',
      width: 160,
      align: 'right',
      render: (_, record) => (
        <Space size={4}>
          {record.filled_pdf_url && (
            <Tooltip title="View PDF">
              <Button
                size="small"
                type="text"
                icon={<FileTextOutlined />}
                href={`/api/contracts/contracts/${record.id}/pdf`}
                target="_blank"
              />
            </Tooltip>
          )}
          {record.signing_token && record.status !== 'voided' && (
            <Tooltip title="Copy Signing Link">
              <Button
                size="small"
                type="text"
                icon={<LinkOutlined />}
                onClick={() => handleCopyLink(record.signing_token!)}
              />
            </Tooltip>
          )}
          {record.status === 'draft' && (
            <Tooltip title="Send for Signing">
              <Button
                size="small"
                type="text"
                icon={<SendOutlined />}
                onClick={() => handleSend(record)}
                loading={sendMutation.isPending}
              />
            </Tooltip>
          )}
          {record.status !== 'voided' && record.status !== 'signed' && (
            <Tooltip title="Void">
              <Button
                size="small"
                type="text"
                danger
                icon={<StopOutlined />}
                onClick={() => handleVoid(record)}
              />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  const canGenerate = !!companyId;
  const hasNoClaim = !claimId;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <FileTextOutlined style={{ fontSize: 18, color: '#1677ff' }} />
          <Text strong style={{ fontSize: 16 }}>Contracts</Text>
          {companyName && <Tag color="blue">{companyName}</Tag>}
        </Space>
        <Tooltip title={!canGenerate ? 'Assign a company to this job first' : hasNoClaim ? 'Link a claim to this job first' : ''}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setGenerateOpen(true)}
            disabled={!canGenerate || hasNoClaim}
            size="small"
          >
            Generate Contract
          </Button>
        </Tooltip>
      </div>

      {hasNoClaim && (
        <Alert
          type="info"
          message="No claim linked"
          description="Link a claim to this WM job to enable contract generation with auto-filled insurance and claim data."
          style={{ marginBottom: 16 }}
          showIcon
        />
      )}

      {!companyId && (
        <Alert
          type="info"
          message="No company assigned"
          description="Assign a company to this job to access their contract templates."
          style={{ marginBottom: 16 }}
          showIcon
        />
      )}

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : contracts.length === 0 ? (
        <Empty
          description="No contracts generated yet"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <Table<ContractInstance>
          rowKey="id"
          dataSource={contracts}
          columns={columns}
          pagination={false}
          size="small"
        />
      )}

      {canGenerate && claimId && clientId && companyId && (
        <GenerateContractModal
          open={generateOpen}
          onClose={() => setGenerateOpen(false)}
          jobId={jobId}
          claimId={claimId}
          clientId={clientId}
          companyId={companyId}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['wm-job-contracts', jobId] });
          }}
        />
      )}
    </div>
  );
};

export default WMContractTab;
