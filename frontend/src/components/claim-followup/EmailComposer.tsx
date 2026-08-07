import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Card,
  Button,
  Space,
  Form,
  Input,
  Select,
  Tag,
  Checkbox,
  message,
  Typography,
  Row,
  Col,
  Divider,
  Alert,
  Spin,
  Upload,
  List,
  Tooltip,
} from 'antd';
import {
  SendOutlined,
  RobotOutlined,
  FileTextOutlined,
  EyeOutlined,
  UserOutlined,
  PaperClipOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  UploadOutlined,
  DeleteOutlined,
  FilePdfOutlined,
  FileImageOutlined,
  FileOutlined,
  LoadingOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { claimFollowUpService } from '../../services/claimFollowUpService';
import { emailIngestionService } from '../../services/emailIngestionService';
import { adjusterEmailService, type DocumentReadiness } from '../../services/waterMitigationService';
import { fileService } from '../../services/fileService';
import RichTextEditor from '../editor/RichTextEditor';
import type {
  EmailTemplate,
  SendEmailRequest,
  GenerateAIEmailRequest,
  EmailAttachment,
} from '../../types/claimFollowUp';

const { Text } = Typography;

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 576);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 575px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
};

// WM task types → use WM company email
const WM_TASK_TYPES = ['wm_docs_sent', 'wm_payment_check'];
// Rebuild task types → use rebuild company email
const REBUILD_TASK_TYPES = [
  'depreciation_recovery', 'estimate_request',
  'payment_check', 'supplement_sent',
];

const WM_DOC_LABELS: Record<string, string> = {
  photo_report: 'Photo Report',
  invoice: 'Invoice',
  w9: 'Company W-9',
  cos: 'Certificate of Satisfaction (COS)',
  ewa: 'Emergency Work Authorization (EWA)',
  sketch: 'Sketch',
};

const WM_DOC_ORDER = ['photo_report', 'invoice', 'w9', 'cos', 'ewa', 'sketch'];

// Follow-up stage labels
const WM_STAGE_CONFIG: Record<string, { label: string; color: string; description: string }> = {
  first:     { label: '1st Follow-up',  color: 'blue',    description: 'Confirm receipt of documents' },
  second:    { label: '2nd Follow-up',  color: 'orange',  description: 'Ask about review status or payment' },
  third:     { label: '3rd Follow-up',  color: 'red',     description: 'Request status of endorsement' },
  escalated: { label: '4th+ Follow-up', color: 'volcano',  description: 'Direct payment status inquiry' },
};

function getFollowupStage(contactCount: number): string {
  if (contactCount === 0) return 'first';
  if (contactCount === 1) return 'second';
  if (contactCount === 2) return 'third';
  return 'escalated';
}

const ROLE_COLORS: Record<string, string> = {
  adjuster: 'orange',
  insurance: 'green',
  pa: 'purple',
  client: 'blue',
  owner: 'cyan',
  other: 'default',
};

const FILE_ICON_MAP: Record<string, React.ReactNode> = {
  'application/pdf': <FilePdfOutlined style={{ color: '#ff4d4f' }} />,
  'image/': <FileImageOutlined style={{ color: '#1890ff' }} />,
};

function getFileIcon(type: string) {
  if (type === 'application/pdf') return FILE_ICON_MAP['application/pdf'];
  if (type.startsWith('image/')) return FILE_ICON_MAP['image/'];
  return <FileOutlined style={{ color: '#8c8c8c' }} />;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export interface ClaimContact {
  name: string;
  email: string;
  role: string;    // 'adjuster' | 'pa' | 'client' | 'owner' | 'other'
  label?: string;  // display label like "Adjuster", "Public Adjuster"
}

interface EmailComposerProps {
  claimId: string;
  followupTaskId?: string;
  taskType?: string;
  wmJobId?: string;
  contactCount?: number;
  contacts?: ClaimContact[];
  defaultTo?: string | string[];
  defaultSubject?: string;
  onSent?: () => void;
  onCancel?: () => void;
}

const EmailComposer: React.FC<EmailComposerProps> = ({
  claimId,
  followupTaskId,
  taskType,
  wmJobId,
  contactCount = 0,
  contacts = [],
  defaultTo,
  defaultSubject,
  onSent,
  onCancel,
}) => {
  const [form] = Form.useForm();
  const isMobile = useIsMobile();
  const [selectedTemplate, setSelectedTemplate] = useState<string | undefined>();
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>();
  const [previewMode, setPreviewMode] = useState(false);
  const [selectedWmDocs, setSelectedWmDocs] = useState<string[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  // Determine if this is a WM follow-up that can attach documents
  const isWmFollowUp = !!wmJobId && taskType === 'wm_docs_sent';
  const wmFollowupStage = isWmFollowUp ? getFollowupStage(contactCount) : null;
  const stageConfig = wmFollowupStage ? WM_STAGE_CONFIG[wmFollowupStage] : null;

  // Load WM job info (documents + preset emails) when this is a WM follow-up
  const { data: wmJobInfo, isLoading: wmDocsLoading } = useQuery({
    queryKey: ['wm-job-email-info', wmJobId],
    queryFn: async () => {
      return adjusterEmailService.getInfo(wmJobId!);
    },
    enabled: isWmFollowUp,
  });
  const wmDocReadiness = wmJobInfo?.documents;

  // Build contact options for To/CC select (includes WM preset emails)
  const contactOptions = useMemo(() => {
    const seen = new Set<string>();
    const options = contacts
      .filter(c => {
        if (!c.email || seen.has(c.email.toLowerCase())) return false;
        seen.add(c.email.toLowerCase());
        return true;
      })
      .map(c => ({
        value: c.email,
        label: (
          <Space size={4}>
            <Tag color={ROLE_COLORS[c.role] || 'default'} style={{ margin: 0, fontSize: 11 }}>
              {c.label || c.role}
            </Tag>
            <span>{c.name}</span>
            <Text type="secondary" style={{ fontSize: 12 }}>({c.email})</Text>
          </Space>
        ),
        searchText: `${c.name} ${c.email} ${c.role} ${c.label || ''}`.toLowerCase(),
      }));

    // Add WM job preset emails (adjuster/insurance contacts)
    if (wmJobInfo?.preset_emails) {
      for (const p of wmJobInfo.preset_emails) {
        if (!p.email || seen.has(p.email.toLowerCase())) continue;
        seen.add(p.email.toLowerCase());
        const roleLabel = p.role === 'insurance' ? 'Insurance' : p.role === 'adjuster' ? 'Adjuster' : p.role;
        options.push({
          value: p.email,
          label: (
            <Space size={4}>
              <Tag color={ROLE_COLORS[p.role] || 'orange'} style={{ margin: 0, fontSize: 11 }}>
                {roleLabel}
              </Tag>
              <span>{p.name || p.email}</span>
              {p.name && <Text type="secondary" style={{ fontSize: 12 }}>({p.email})</Text>}
            </Space>
          ),
          searchText: `${p.name} ${p.email} ${p.role}`.toLowerCase(),
        });
      }
    }

    return options;
  }, [contacts, wmJobInfo]);

  // Auto-select all ready documents when readiness data loads
  useEffect(() => {
    if (wmDocReadiness) {
      const readyDocs = WM_DOC_ORDER.filter(
        key => wmDocReadiness[key as keyof DocumentReadiness] &&
               (wmDocReadiness[key as keyof DocumentReadiness] as any)?.ready
      );
      setSelectedWmDocs(readyDocs);
    }
  }, [wmDocReadiness]);

  // Override To addresses with WM job preset emails (adjuster emails from job, not from follow-up task)
  useEffect(() => {
    if (wmJobInfo?.preset_emails && wmJobInfo.preset_emails.length > 0) {
      const presetAddrs = wmJobInfo.preset_emails.map(p => p.email);
      form.setFieldValue('to_addresses', presetAddrs);
    }
  }, [wmJobInfo, form]);

  // Load email accounts (from addresses)
  const { data: accounts = [] } = useQuery({
    queryKey: ['email-accounts'],
    queryFn: () => emailIngestionService.listAccounts(),
  });

  // Load claim company assignments for auto-selection
  const { data: claimCompanies } = useQuery({
    queryKey: ['claim-companies', claimId],
    queryFn: () => claimFollowUpService.getClaimCompanies(claimId),
    enabled: !!claimId,
  });

  // Load templates
  const { data: templates = [] } = useQuery({
    queryKey: ['email-templates'],
    queryFn: () => claimFollowUpService.getTemplates(),
  });

  // Set defaults
  useEffect(() => {
    if (defaultTo) {
      const toArr = Array.isArray(defaultTo) ? defaultTo : [defaultTo];
      form.setFieldValue('to_addresses', toArr.filter(Boolean));
    }
    if (defaultSubject) form.setFieldValue('subject', defaultSubject);
  }, [defaultTo, defaultSubject, form]);

  // Auto-select account based on task type and company assignment
  useEffect(() => {
    if (accounts.length === 0) return;

    let targetCompanyId: string | undefined;
    if (taskType && claimCompanies) {
      if (WM_TASK_TYPES.includes(taskType)) {
        targetCompanyId = claimCompanies.wm_company_id;
      } else if (REBUILD_TASK_TYPES.includes(taskType)) {
        targetCompanyId = claimCompanies.rebuild_company_id;
      }
    }

    if (targetCompanyId) {
      const matched = accounts.find(
        a => a.is_active && a.can_send !== false && a.company_id === targetCompanyId
      );
      if (matched) {
        setSelectedAccountId(matched.id);
        return;
      }
    }

    // Fallback: first active sendable account
    if (!selectedAccountId) {
      const first = accounts.find(a => a.is_active && a.can_send !== false);
      if (first) setSelectedAccountId(first.id);
    }
  }, [accounts, claimCompanies, taskType, selectedAccountId]);

  // Send mutation
  const sendMutation = useMutation({
    mutationFn: (data: SendEmailRequest) => claimFollowUpService.sendEmail(data),
    onSuccess: () => {
      message.success('Email sent successfully');
      form.resetFields();
      setAttachedFiles([]);
      onSent?.();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to send email');
    },
  });

  // AI generate mutation
  const aiMutation = useMutation({
    mutationFn: (data: GenerateAIEmailRequest) => claimFollowUpService.generateAIEmail(data),
    onSuccess: (result) => {
      form.setFieldsValue({
        subject: result.subject,
        body_html: result.body_html,
      });
      message.success('AI email generated');
    },
    onError: () => {
      message.error('AI generation failed. Using fallback template.');
    },
  });

  const handleTemplateSelect = async (templateId: string) => {
    setSelectedTemplate(templateId);
    if (!templateId) return;

    try {
      const rendered = await claimFollowUpService.renderTemplate(templateId, {});
      form.setFieldsValue({
        subject: rendered.subject,
        body_html: rendered.body_html,
      });
    } catch {
      message.error('Failed to load template');
    }
  };

  const handleAIGenerate = (contextType: string) => {
    aiMutation.mutate({
      claim_id: claimId,
      followup_task_id: followupTaskId,
      context_type: contextType,
      tone: 'professional',
      language: 'en',
    });
  };

  const handleSend = async () => {
    try {
      const values = await form.validateFields();
      const toList = Array.isArray(values.to_addresses)
        ? values.to_addresses.filter(Boolean)
        : typeof values.to_addresses === 'string'
          ? values.to_addresses.split(',').map((e: string) => e.trim()).filter(Boolean)
          : [];
      const ccList = Array.isArray(values.cc_addresses)
        ? values.cc_addresses.filter(Boolean)
        : values.cc_addresses
          ? values.cc_addresses.split(',').map((e: string) => e.trim()).filter(Boolean)
          : [];

      // Upload attached files first
      let fileAttachments: EmailAttachment[] = [];
      if (attachedFiles.length > 0) {
        setUploading(true);
        try {
          const uploaded = await fileService.uploadFiles(
            attachedFiles,
            'email',
            claimId,
            'attachment',
          );
          fileAttachments = uploaded.map(f => ({
            filename: f.originalName || f.filename,
            file_id: f.id,
            mime_type: f.contentType,
            size: f.size,
          }));
        } catch (err) {
          message.error('Failed to upload attachments');
          setUploading(false);
          return;
        }
        setUploading(false);
      }

      const payload: SendEmailRequest = {
        claim_id: claimId,
        followup_task_id: followupTaskId,
        email_account_id: selectedAccountId,
        to_addresses: toList,
        cc_addresses: ccList,
        subject: values.subject,
        body_html: values.body_html,
        template_id: selectedTemplate,
        attachments: fileAttachments.length > 0 ? fileAttachments : undefined,
      };

      // Attach WM documents if selected
      if (isWmFollowUp && selectedWmDocs.length > 0) {
        payload.wm_job_id = wmJobId;
        payload.wm_documents = selectedWmDocs;
      }

      sendMutation.mutate(payload);
    } catch {
      // form validation failed
    }
  };

  const handleWmDocToggle = (docKey: string, checked: boolean) => {
    setSelectedWmDocs(prev =>
      checked ? [...prev, docKey] : prev.filter(d => d !== docKey)
    );
  };

  const handleFileAdd = (file: File) => {
    // Prevent duplicates by name+size
    setAttachedFiles(prev => {
      if (prev.some(f => f.name === file.name && f.size === file.size)) return prev;
      return [...prev, file];
    });
    return false; // prevent antd auto upload
  };

  const handleFileRemove = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const totalAttachments =
    attachedFiles.length +
    (isWmFollowUp ? selectedWmDocs.length : 0);

  const isSending = sendMutation.isPending || uploading;

  return (
    <Card
      title={
        <Space>
          <SendOutlined />
          <span>Compose Email</span>
        </Space>
      }
      extra={
        <Space size={4}>
          <Button size="small" onClick={onCancel}>Cancel</Button>
          <Button
            type="primary"
            size="small"
            icon={isSending ? <LoadingOutlined /> : <SendOutlined />}
            onClick={handleSend}
            loading={isSending}
          >
            Send{totalAttachments > 0 ? ` (${totalAttachments} files)` : ''}
          </Button>
        </Space>
      }
      styles={{ body: { padding: isMobile ? '12px' : '24px' } }}
    >
      {/* From Account Selection */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 4 }}>
          <Text type="secondary">From:</Text>
        </div>
        {accounts.length > 0 ? (
          <Select
            value={selectedAccountId}
            onChange={setSelectedAccountId}
            style={{ width: '100%' }}
            placeholder="Select sending account"
            options={accounts.filter(a => a.is_active && a.can_send !== false).map(a => ({
              value: a.id,
              label: (
                <Space>
                  <UserOutlined />
                  {a.company_name && <Tag color="blue" style={{ margin: 0 }}>{a.company_name}</Tag>}
                  <span>{a.display_name}</span>
                  {!isMobile && <Text type="secondary">({a.email_address})</Text>}
                </Space>
              ),
            }))}
          />
        ) : (
          <Text type="warning">
            No email accounts configured.{' '}
            <a href="/email-ingestion/accounts">Add one here</a>
          </Text>
        )}
      </div>

      {/* WM Document Attachments */}
      {isWmFollowUp && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4 }}>
            <Space>
              <PaperClipOutlined />
              <Text type="secondary">WM Documents to Attach:</Text>
              {selectedWmDocs.length > 0 && (
                <Tag color="blue">{selectedWmDocs.length} selected</Tag>
              )}
            </Space>
          </div>
          {wmDocsLoading ? (
            <Spin size="small" />
          ) : wmDocReadiness ? (
            <div
              style={{
                border: '1px solid #f0f0f0',
                borderRadius: 6,
                padding: '8px 12px',
                background: '#fafafa',
              }}
            >
              <Row gutter={[8, 4]}>
                {WM_DOC_ORDER.map(docKey => {
                  const docInfo = wmDocReadiness[docKey as keyof DocumentReadiness] as any;
                  const isReady = docInfo?.ready;
                  return (
                    <Col xs={24} sm={12} key={docKey}>
                      <Checkbox
                        checked={selectedWmDocs.includes(docKey)}
                        disabled={!isReady}
                        onChange={e => handleWmDocToggle(docKey, e.target.checked)}
                      >
                        <Space size={4}>
                          {isReady ? (
                            <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 12 }} />
                          ) : (
                            <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 12 }} />
                          )}
                          <span style={{ fontSize: 13 }}>
                            {WM_DOC_LABELS[docKey] || docKey}
                          </span>
                          {!isReady && (
                            <Text type="secondary" style={{ fontSize: 11 }}>(not ready)</Text>
                          )}
                          {isReady && docInfo?.stale && (
                            <Tooltip title="Floor sketch was edited after this PDF was last generated - it may be outdated. Regenerate it in the Documents tab if you want the latest version sent.">
                              <Tag color="warning" style={{ marginLeft: 0, fontSize: 11, lineHeight: '16px', padding: '0 4px' }}>
                                <WarningOutlined /> Outdated
                              </Tag>
                            </Tooltip>
                          )}
                        </Space>
                      </Checkbox>
                    </Col>
                  );
                })}
              </Row>
              <div style={{ marginTop: 6 }}>
                <Space size={8}>
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, fontSize: 12 }}
                    onClick={() => {
                      const allReady = WM_DOC_ORDER.filter(
                        key => (wmDocReadiness[key as keyof DocumentReadiness] as any)?.ready
                      );
                      setSelectedWmDocs(allReady);
                    }}
                  >
                    Select All
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, fontSize: 12 }}
                    onClick={() => setSelectedWmDocs([])}
                  >
                    Clear All
                  </Button>
                </Space>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Follow-up Stage Indicator */}
      {isWmFollowUp && stageConfig && (
        <Alert
          message={
            <Space>
              <Tag color={stageConfig.color} style={{ margin: 0 }}>{stageConfig.label}</Tag>
              <Text style={{ fontSize: 13 }}>{stageConfig.description}</Text>
              {contactCount > 0 && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  ({contactCount} email{contactCount !== 1 ? 's' : ''} sent previously)
                </Text>
              )}
            </Space>
          }
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          action={
            <Button
              size="small"
              type="primary"
              icon={<RobotOutlined />}
              onClick={() => handleAIGenerate('followup')}
              loading={aiMutation.isPending}
            >
              Generate
            </Button>
          }
        />
      )}

      {/* AI Quick Actions */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 4 }}>
          <Text type="secondary">AI Generate:</Text>
        </div>
        <Space wrap size={4}>
          {['initial_send', 'followup', 'payment_inquiry', 'estimate_request', 'supplement'].map(type => (
            <Button
              key={type}
              size="small"
              icon={<RobotOutlined />}
              onClick={() => handleAIGenerate(type)}
              loading={aiMutation.isPending && aiMutation.variables?.context_type === type}
            >
              {type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </Button>
          ))}
        </Space>
      </div>

      {/* Template Selection */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 4 }}>
          <Text type="secondary">Template:</Text>
        </div>
        <Select
          placeholder="Select a template"
          allowClear
          style={{ width: '100%' }}
          onChange={handleTemplateSelect}
          value={selectedTemplate}
          options={templates.map((t: EmailTemplate) => ({
            value: t.id,
            label: (
              <Space>
                <FileTextOutlined />
                {t.name}
                <Tag>{t.template_type}</Tag>
              </Space>
            ),
          }))}
        />
      </div>

      <Divider style={{ margin: '8px 0' }} />

      {/* Email Form */}
      <Form form={form} layout="vertical" size="small">
        <Row gutter={[16, 0]}>
          <Col xs={24} sm={16}>
            <Form.Item
              name="to_addresses"
              label="To"
              rules={[{
                required: true,
                message: 'Select or enter recipient email',
                validator: (_, value) => {
                  if (!value || (Array.isArray(value) && value.length === 0)) {
                    return Promise.reject('Select or enter recipient email');
                  }
                  return Promise.resolve();
                },
              }]}
            >
              <Select
                mode="tags"
                placeholder="Select contacts or type email..."
                tokenSeparators={[',', ';', ' ']}
                style={{ width: '100%', minHeight: 38 }}
                optionFilterProp="searchText"
                options={contactOptions}
                tagRender={({ label, value, closable, onClose }) => {
                  const contact = contacts.find(c => c.email === value);
                  const preset = wmJobInfo?.preset_emails?.find(p => p.email === value);
                  const role = contact?.role || preset?.role || '';
                  const name = contact?.name || preset?.name || '';
                  const color = ROLE_COLORS[role] || 'default';
                  return (
                    <Tag
                      color={color}
                      closable={closable}
                      onClose={onClose}
                      style={{ margin: '2px 4px 2px 0', maxWidth: '100%' }}
                    >
                      {name ? `${name} (${value})` : value}
                    </Tag>
                  );
                }}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="cc_addresses" label="CC">
              <Select
                mode="tags"
                placeholder="CC..."
                tokenSeparators={[',', ';', ' ']}
                style={{ width: '100%', minHeight: 38 }}
                optionFilterProp="searchText"
                options={contactOptions}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="subject"
          label="Subject"
          rules={[{ required: true, message: 'Enter subject' }]}
        >
          <Input placeholder="Email subject" />
        </Form.Item>

        <Form.Item
          name="body_html"
          label={
            <Space>
              <span>Body</span>
              <Button
                type="link"
                size="small"
                icon={<EyeOutlined />}
                onClick={() => setPreviewMode(!previewMode)}
              >
                {previewMode ? 'Edit' : 'Preview'}
              </Button>
            </Space>
          }
          rules={[{ required: true, message: 'Enter email body' }]}
          getValueFromEvent={(val: string) => val}
          trigger="onChange"
          valuePropName="value"
        >
          {previewMode ? (
            <div
              style={{
                border: '1px solid #d9d9d9',
                borderRadius: 4,
                padding: 16,
                minHeight: 200,
                backgroundColor: '#fff',
              }}
              dangerouslySetInnerHTML={{ __html: form.getFieldValue('body_html') || '' }}
            />
          ) : (
            <RichTextEditor
              placeholder="Write your email here..."
              minHeight={250}
              maxHeight={500}
            />
          )}
        </Form.Item>
      </Form>

      {/* File Attachments */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <Space>
            <PaperClipOutlined />
            <Text type="secondary">Attachments</Text>
            {attachedFiles.length > 0 && (
              <Tag color="blue">{attachedFiles.length} file(s)</Tag>
            )}
          </Space>
          <Upload
            multiple
            showUploadList={false}
            beforeUpload={handleFileAdd}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.txt,.csv,.zip"
          >
            <Button size="small" icon={<UploadOutlined />}>
              Add File
            </Button>
          </Upload>
        </div>

        {attachedFiles.length > 0 && (
          <div
            style={{
              border: '1px solid #f0f0f0',
              borderRadius: 6,
              padding: '4px 0',
              background: '#fafafa',
            }}
          >
            <List
              size="small"
              dataSource={attachedFiles}
              renderItem={(file, index) => (
                <List.Item
                  style={{ padding: '4px 12px' }}
                  actions={[
                    <Button
                      key="remove"
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleFileRemove(index)}
                    />,
                  ]}
                >
                  <Space size={8}>
                    {getFileIcon(file.type)}
                    <Text style={{ fontSize: 13 }}>{file.name}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      ({formatFileSize(file.size)})
                    </Text>
                  </Space>
                </List.Item>
              )}
            />
          </div>
        )}
      </div>

      {isWmFollowUp && selectedWmDocs.length > 0 && (
        <Alert
          message={`${selectedWmDocs.length} WM document(s) will be attached to this email`}
          type="info"
          showIcon
          icon={<PaperClipOutlined />}
          style={{ marginTop: 8 }}
        />
      )}

      {aiMutation.isSuccess && (
        <Alert
          message="This email was generated by AI. Please review before sending."
          type="info"
          showIcon
          closable
          style={{ marginTop: 8 }}
        />
      )}
    </Card>
  );
};

export default EmailComposer;
