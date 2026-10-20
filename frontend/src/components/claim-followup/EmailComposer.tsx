import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Button,
  Form,
  Input,
  Select,
  Tag,
  Checkbox,
  message,
  Spin,
  Upload,
  Tooltip,
  Dropdown,
  Modal,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  SendOutlined,
  RobotOutlined,
  FileTextOutlined,
  EyeOutlined,
  EditOutlined,
  PaperClipOutlined,
  DeleteOutlined,
  FilePdfOutlined,
  FileImageOutlined,
  FileOutlined,
  WarningOutlined,
  HighlightOutlined,
  CompressOutlined,
  ExpandOutlined,
  SmileOutlined,
  BankOutlined,
  CheckOutlined,
  DownOutlined,
  SettingOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { claimFollowUpService } from '../../services/claimFollowUpService';
import { emailIngestionService } from '../../services/emailIngestionService';
import { adjusterEmailService, type DocumentReadiness } from '../../services/waterMitigationService';
import { fileService } from '../../services/fileService';
import { useAuth } from '../../contexts/AuthContext';
import RichTextEditor from '../editor/RichTextEditor';
import { Pill, type TagTone } from '../common/ui';
import EmailTemplateManager, { type TemplateDraft } from './EmailTemplateManager';
import {
  fieldLabel, fillTemplate, findPlaceholders, isBlankHtml, placeholderOf,
  templateTypesForTask, toEditorHtml, type TemplateValues,
} from './emailTemplates';
import type {
  EmailTemplate,
  SendEmailRequest,
  GenerateAIEmailRequest,
  PolishEmailAction,
  EmailAttachment,
} from '../../types/claimFollowUp';

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
const WM_STAGE_CONFIG: Record<string, { label: string; tone: TagTone; description: string }> = {
  first:     { label: '1st Follow-up',  tone: 'blue',   description: 'Confirm receipt of documents' },
  second:    { label: '2nd Follow-up',  tone: 'orange', description: 'Ask about review status or payment' },
  third:     { label: '3rd Follow-up',  tone: 'red',    description: 'Request status of endorsement' },
  escalated: { label: '4th+ Follow-up', tone: 'red',    description: 'Direct payment status inquiry' },
};

function getFollowupStage(contactCount: number): string {
  if (contactCount === 0) return 'first';
  if (contactCount === 1) return 'second';
  if (contactCount === 2) return 'third';
  return 'escalated';
}

const AI_CONTEXTS: { key: string; label: string }[] = [
  { key: 'initial_send', label: 'Initial send' },
  { key: 'followup', label: 'Follow-up' },
  { key: 'payment_inquiry', label: 'Payment inquiry' },
  { key: 'estimate_request', label: 'Estimate request' },
  { key: 'supplement', label: 'Supplement' },
];

const POLISH_ACTIONS: { key: PolishEmailAction; label: string; icon: React.ReactNode }[] = [
  { key: 'shorten', label: 'Shorten', icon: <CompressOutlined /> },
  { key: 'lengthen', label: 'Lengthen', icon: <ExpandOutlined /> },
  { key: 'friendly', label: 'More Friendly', icon: <SmileOutlined /> },
  { key: 'formal', label: 'More Formal', icon: <BankOutlined /> },
  { key: 'proofread', label: 'Fix Grammar', icon: <CheckOutlined /> },
];

function getFileIcon(type: string) {
  if (type === 'application/pdf') return <FilePdfOutlined className="fu-pdf-icon" />;
  if (type.startsWith('image/')) return <FileImageOutlined />;
  return <FileOutlined />;
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
  /** Claim details that fill template fields such as {{claim_number}} */
  templateValues?: TemplateValues;
  /** An extra first row, e.g. the task this email is about */
  regarding?: React.ReactNode;
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
  templateValues,
  regarding,
  onSent,
  onCancel,
}) => {
  const [form] = Form.useForm();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [selectedTemplate, setSelectedTemplate] = useState<string | undefined>();
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>();
  const [previewMode, setPreviewMode] = useState(false);
  const [selectedWmDocs, setSelectedWmDocs] = useState<string[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerDraft, setManagerDraft] = useState<TemplateDraft | null>(null);

  const subject: string | undefined = Form.useWatch('subject', form);
  const bodyHtml: string | undefined = Form.useWatch('body_html', form);
  const ccValue: string[] | undefined = Form.useWatch('cc_addresses', form);

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
    const option = (name: string, email: string, roleLabel: string, searchText: string) => ({
      value: email,
      label: (
        <span className="fu-recipient-option">
          <span className="fu-recipient-option-name">{name || email}</span>
          <span className="fu-recipient-option-meta">{roleLabel}{name ? ` · ${email}` : ''}</span>
        </span>
      ),
      searchText,
    });
    const options = contacts
      .filter(c => {
        if (!c.email || seen.has(c.email.toLowerCase())) return false;
        seen.add(c.email.toLowerCase());
        return true;
      })
      .map(c => option(c.name, c.email, c.label || c.role, `${c.name} ${c.email} ${c.role} ${c.label || ''}`.toLowerCase()));

    // Add WM job preset emails (adjuster/insurance contacts)
    if (wmJobInfo?.preset_emails) {
      for (const p of wmJobInfo.preset_emails) {
        if (!p.email || seen.has(p.email.toLowerCase())) continue;
        seen.add(p.email.toLowerCase());
        const roleLabel = p.role === 'insurance' ? 'Insurance' : p.role === 'adjuster' ? 'Adjuster' : p.role === 'pa' ? 'PA' : p.role;
        options.push(option(p.name || '', p.email, roleLabel, `${p.name} ${p.email} ${p.role}`.toLowerCase()));
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

  const sendableAccounts = accounts.filter(a => a.is_active && a.can_send !== false);
  const selectedAccount = accounts.find(a => a.id === selectedAccountId);

  /** What template fields fill with: the claim, then who is sending */
  const fieldValues = useMemo(() => {
    const userName = user?.full_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ');
    return {
      ...templateValues,
      company_name: templateValues?.company_name || selectedAccount?.company_name,
      sender_name: selectedAccount?.sender_name || userName || undefined,
      sender_phone: selectedAccount?.sender_phone || user?.mobile_phone || user?.phone,
    };
  }, [templateValues, selectedAccount, user]);

  const blankFields = useMemo(() => findPlaceholders(subject, bodyHtml), [subject, bodyHtml]);

  // Send mutation
  const sendMutation = useMutation({
    mutationFn: (data: SendEmailRequest) => claimFollowUpService.sendEmail(data),
    onSuccess: () => {
      message.success('Email sent successfully');
      form.resetFields();
      setAttachedFiles([]);
      setSelectedTemplate(undefined);
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
      setPreviewMode(false);
      message.success('AI email generated');
    },
    onError: () => {
      message.error('AI generation failed. Using fallback template.');
    },
  });

  // AI polish mutation (Gmail-style "Help me write" quick edits on the current draft)
  const polishMutation = useMutation({
    mutationFn: (action: PolishEmailAction) => {
      const { subject, body_html } = form.getFieldsValue(['subject', 'body_html']);
      return claimFollowUpService.polishEmail({ body_html, action, subject });
    },
    onSuccess: (result) => {
      form.setFieldsValue({
        subject: result.subject || form.getFieldValue('subject'),
        body_html: result.body_html,
      });
      message.success('Email polished');
    },
    onError: () => {
      message.error('Failed to polish email. Please try again.');
    },
  });

  const handlePolish = (action: PolishEmailAction) => {
    if (isBlankHtml(form.getFieldValue('body_html'))) {
      message.warning('Write something in the body first');
      return;
    }
    polishMutation.mutate(action);
  };

  /** Ask before something overwrites what the person has written */
  const confirmReplace = (source: string, apply: () => void) => {
    const hasDraft = !isBlankHtml(form.getFieldValue('body_html')) || !!form.getFieldValue('subject')?.trim();
    if (!hasDraft) {
      apply();
      return;
    }
    Modal.confirm({
      title: 'Replace your draft?',
      content: `${source} replaces the subject and body you've written.`,
      okText: 'Replace',
      cancelText: 'Keep my draft',
      onOk: apply,
    });
  };

  const applyTemplate = (t: EmailTemplate) => {
    form.setFieldsValue({
      subject: fillTemplate(t.subject_template, fieldValues),
      body_html: fillTemplate(toEditorHtml(t.body_template), fieldValues, { html: true }),
    });
    setSelectedTemplate(t.id);
    setPreviewMode(false);
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

  const openManager = (draft: TemplateDraft | null = null) => {
    setManagerDraft(draft);
    setManagerOpen(true);
  };

  const saveAsTemplate = () => {
    const { subject: s, body_html: b } = form.getFieldsValue(['subject', 'body_html']);
    if (isBlankHtml(b) && !s?.trim()) {
      message.info('Write the email first, then save it as a template.');
      return;
    }
    openManager({ subject: s || '', body: b || '' });
  };

  const doSend = async (values: any) => {
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
  };

  const handleSend = async () => {
    let values: any;
    try {
      values = await form.validateFields();
    } catch {
      return; // form validation failed
    }
    const left = findPlaceholders(values.subject, values.body_html);
    if (left.length > 0) {
      Modal.confirm({
        title: `Send with ${left.length} blank field${left.length === 1 ? '' : 's'}?`,
        content: `The recipient will see ${left.map(placeholderOf).join(', ')} where a value should be.`,
        okText: 'Send anyway',
        cancelText: 'Go back',
        onOk: () => doSend(values),
      });
      return;
    }
    doSend(values);
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

  // ── Menus ──

  const suggestedTypes = templateTypesForTask(taskType);
  const suggested = templates.filter((t: EmailTemplate) => suggestedTypes.includes(t.template_type));
  const otherTemplates = templates.filter((t: EmailTemplate) => !suggestedTypes.includes(t.template_type));
  const templateItem = (t: EmailTemplate) => ({
    key: t.id,
    label: (
      <span className="fu-menu-option">
        <span className="fu-menu-option-title">{t.name}</span>
        <span className="fu-menu-option-hint">{t.description || fillTemplate(t.subject_template, fieldValues)}</span>
      </span>
    ),
  });
  const templateMenu: MenuProps = {
    className: 'fu-template-menu',
    items: [
      ...(suggested.length ? [{ type: 'group' as const, key: 'g-suggested', label: 'Suggested for this task', children: suggested.map(templateItem) }] : []),
      ...(otherTemplates.length ? [{ type: 'group' as const, key: 'g-all', label: suggested.length ? 'Other templates' : 'Templates', children: otherTemplates.map(templateItem) }] : []),
      ...(templates.length === 0 ? [{ key: '__none', disabled: true, label: 'No templates yet' }] : []),
      { type: 'divider' as const },
      { key: '__manage', icon: <SettingOutlined />, label: 'Manage templates' },
    ],
    onClick: ({ key }) => {
      if (key === '__manage') {
        openManager();
        return;
      }
      const t = templates.find((x: EmailTemplate) => x.id === key);
      if (t) confirmReplace(`“${t.name}”`, () => applyTemplate(t));
    },
  };

  const aiMenu: MenuProps = {
    items: AI_CONTEXTS.map(({ key, label }) => ({ key, label })),
    onClick: ({ key }) => confirmReplace('The AI draft', () => handleAIGenerate(key)),
  };

  const recipientSelect = (placeholder: string) => (
    <Select
      mode="tags"
      variant="borderless"
      placeholder={placeholder}
      tokenSeparators={[',', ';', ' ']}
      style={{ width: '100%' }}
      optionFilterProp="searchText"
      options={contactOptions}
      popupMatchSelectWidth={isMobile ? true : 420}
      suffixIcon={null}
      tagRender={({ value, closable, onClose }) => {
        const contact = contacts.find(c => c.email === value);
        const preset = wmJobInfo?.preset_emails?.find(p => p.email === value);
        const name = contact?.name || preset?.name || '';
        return (
          <Tag
            closable={closable}
            onClose={onClose}
            className="fu-recipient-tag"
            title={value}
          >
            <span className="fu-recipient-tag-text">
              {name && name !== value ? `${name} (${value})` : value}
            </span>
          </Tag>
        );
      }}
    />
  );

  return (
    <div className="fu-compose">
      <div className="fu-compose-head">
        <h3 className="fu-compose-title">New email</h3>
        <div className="fu-compose-tools">
          <Dropdown menu={templateMenu} trigger={['click']} placement="bottomRight">
            <Button icon={<FileTextOutlined />}>
              Template <DownOutlined className="fu-caret" aria-hidden="true" />
            </Button>
          </Dropdown>
          <Dropdown menu={aiMenu} trigger={['click']} placement="bottomRight" disabled={aiMutation.isPending}>
            <Button icon={<RobotOutlined />} loading={aiMutation.isPending}>
              Draft with AI <DownOutlined className="fu-caret" aria-hidden="true" />
            </Button>
          </Dropdown>
        </div>
      </div>

      {/* Follow-up stage: which reminder this is and what it asks */}
      {isWmFollowUp && stageConfig && (
        <div className="fu-compose-stage">
          <Pill tone={stageConfig.tone}>{stageConfig.label}</Pill>
          <span>{stageConfig.description}</span>
          {contactCount > 0 && (
            <span className="fu-muted">
              {contactCount} email{contactCount !== 1 ? 's' : ''} sent before
            </span>
          )}
          <Button
            type="link"
            className="fu-compose-stage-action"
            icon={<RobotOutlined />}
            onClick={() => confirmReplace('The AI draft', () => handleAIGenerate('followup'))}
            loading={aiMutation.isPending && aiMutation.variables?.context_type === 'followup'}
          >
            Draft this follow-up
          </Button>
        </div>
      )}

      <Form form={form} requiredMark={false} className="fu-compose-form">
        <div className="fu-compose-fields">
          {regarding && (
            <div className="fu-compose-row">
              <span className="fu-compose-label">Regarding</span>
              <div className="fu-compose-control">{regarding}</div>
            </div>
          )}

          <div className="fu-compose-row">
            <span className="fu-compose-label">From</span>
            <div className="fu-compose-control">
              {sendableAccounts.length > 0 ? (
                <Select
                  variant="borderless"
                  value={selectedAccountId}
                  onChange={setSelectedAccountId}
                  style={{ width: '100%' }}
                  placeholder="Select sending account"
                  aria-label="Send from"
                  options={sendableAccounts.map(a => ({
                    value: a.id,
                    label: (
                      <span className="fu-account-option">
                        <span>{a.display_name}</span>
                        {!isMobile && <span className="fu-muted">{a.email_address}</span>}
                        {a.company_name && <span className="fu-muted">· {a.company_name}</span>}
                      </span>
                    ),
                  }))}
                />
              ) : (
                <span className="fu-compose-warning">
                  No email accounts configured. <a href="/email-ingestion/accounts">Add one here</a>
                </span>
              )}
            </div>
          </div>

          <div className="fu-compose-row">
            <label className="fu-compose-label" htmlFor="fu-compose-to">To</label>
            <div className="fu-compose-control">
              <Form.Item
                name="to_addresses"
                className="fu-compose-item"
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
                {React.cloneElement(recipientSelect('Choose a contact or type an email'), { id: 'fu-compose-to' })}
              </Form.Item>
            </div>
            {!showCc && !(ccValue && ccValue.length) && (
              <button type="button" className="fu-compose-cc-toggle" onClick={() => setShowCc(true)}>Cc</button>
            )}
          </div>

          {(showCc || (ccValue && ccValue.length > 0)) && (
            <div className="fu-compose-row">
              <label className="fu-compose-label" htmlFor="fu-compose-cc">Cc</label>
              <div className="fu-compose-control">
                <Form.Item name="cc_addresses" className="fu-compose-item">
                  {React.cloneElement(recipientSelect('Add people to copy'), { id: 'fu-compose-cc' })}
                </Form.Item>
              </div>
            </div>
          )}

          <div className="fu-compose-row">
            <label className="fu-compose-label" htmlFor="fu-compose-subject">Subject</label>
            <div className="fu-compose-control">
              <Form.Item
                name="subject"
                className="fu-compose-item"
                rules={[{ required: true, message: 'Enter subject' }]}
              >
                <Input id="fu-compose-subject" variant="borderless" placeholder="What this email is about" />
              </Form.Item>
            </div>
          </div>
        </div>

        <div className="fu-compose-body">
          <div className="fu-compose-body-tools">
            <Dropdown
              trigger={['click']}
              disabled={polishMutation.isPending || previewMode}
              menu={{
                items: POLISH_ACTIONS.map(({ key, label, icon }) => ({
                  key,
                  label,
                  icon,
                })) as MenuProps['items'],
                onClick: ({ key }) => handlePolish(key as PolishEmailAction),
              }}
            >
              <Button type="text" size="small" icon={<HighlightOutlined />} loading={polishMutation.isPending} disabled={previewMode}>
                Polish
              </Button>
            </Dropdown>
            <Button
              type="text"
              size="small"
              icon={previewMode ? <EditOutlined /> : <EyeOutlined />}
              onClick={() => setPreviewMode(!previewMode)}
              aria-pressed={previewMode}
            >
              {previewMode ? 'Edit' : 'Preview'}
            </Button>
          </div>
          <Form.Item
            name="body_html"
            hidden={previewMode}
            className="fu-compose-item"
            rules={[{ required: true, message: 'Enter email body' }]}
            getValueFromEvent={(val: string) => val}
            trigger="onChange"
            valuePropName="value"
          >
            <RichTextEditor
              placeholder="Write your email here..."
              minHeight={isMobile ? 220 : 280}
              maxHeight={560}
            />
          </Form.Item>
          {previewMode && (
            <div
              className="fu-compose-preview"
              dangerouslySetInnerHTML={{ __html: bodyHtml || '<p class="fu-muted">Nothing written yet.</p>' }}
            />
          )}
        </div>
      </Form>

      {blankFields.length > 0 && (
        <p className="fu-compose-blank" role="status">
          <WarningOutlined aria-hidden="true" />
          <span>
            Fill in before sending:{' '}
            {blankFields.map((k, i) => (
              <React.Fragment key={k}>
                {i > 0 && ', '}
                <Tooltip title={fieldLabel(k)}><code>{placeholderOf(k)}</code></Tooltip>
              </React.Fragment>
            ))}
          </span>
        </p>
      )}

      {/* WM Document Attachments */}
      {isWmFollowUp && (
        <div className="fu-compose-block">
          <div className="fu-compose-block-head">
            <span className="fu-compose-block-title">
              WM documents to attach
              {selectedWmDocs.length > 0 && <span className="fu-count">{selectedWmDocs.length} selected</span>}
            </span>
            {wmDocReadiness && (
              <span className="fu-compose-block-actions">
                <button
                  type="button"
                  className="fu-link-btn"
                  onClick={() => {
                    const allReady = WM_DOC_ORDER.filter(
                      key => (wmDocReadiness[key as keyof DocumentReadiness] as any)?.ready
                    );
                    setSelectedWmDocs(allReady);
                  }}
                >
                  Select All
                </button>
                <button type="button" className="fu-link-btn" onClick={() => setSelectedWmDocs([])}>
                  Clear All
                </button>
              </span>
            )}
          </div>
          {wmDocsLoading ? (
            <Spin size="small" />
          ) : wmDocReadiness ? (
            <div className="fu-wm-docs">
              {WM_DOC_ORDER.map(docKey => {
                const docInfo = wmDocReadiness[docKey as keyof DocumentReadiness] as any;
                const isReady = docInfo?.ready;
                return (
                  <Checkbox
                    key={docKey}
                    checked={selectedWmDocs.includes(docKey)}
                    disabled={!isReady}
                    onChange={e => handleWmDocToggle(docKey, e.target.checked)}
                    className="fu-wm-doc"
                  >
                    <span>{WM_DOC_LABELS[docKey] || docKey}</span>
                    {!isReady && <span className="fu-muted"> · Not ready</span>}
                    {isReady && docInfo?.stale && (
                      <Tooltip title="Floor sketch was edited after this PDF was last generated - it may be outdated. Regenerate it in the Documents tab if you want the latest version sent.">
                        <Pill tone="orange" icon={<WarningOutlined />} style={{ marginLeft: 8 }}>Outdated</Pill>
                      </Tooltip>
                    )}
                  </Checkbox>
                );
              })}
            </div>
          ) : null}
        </div>
      )}

      {/* File Attachments */}
      <div className="fu-compose-block">
        <div className="fu-compose-block-head">
          <span className="fu-compose-block-title">
            Attachments
            {attachedFiles.length > 0 && <span className="fu-count">{attachedFiles.length}</span>}
          </span>
          <Upload
            multiple
            showUploadList={false}
            beforeUpload={handleFileAdd}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.txt,.csv,.zip"
          >
            <Button icon={<PaperClipOutlined />}>Add File</Button>
          </Upload>
        </div>
        {attachedFiles.length > 0 && (
          <ul className="fu-attach-list">
            {attachedFiles.map((file, index) => (
              <li key={`${file.name}-${file.size}`} className="fu-attach">
                {getFileIcon(file.type)}
                <span className="fu-attach-name">{file.name}</span>
                <span className="fu-muted">{formatFileSize(file.size)}</span>
                <Button
                  type="text"
                  size="small"
                  className="ui-icon-btn ui-icon-btn--danger"
                  icon={<DeleteOutlined />}
                  aria-label={`Remove ${file.name}`}
                  onClick={() => handleFileRemove(index)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {aiMutation.isSuccess && (
        <p className="fu-note">
          <RobotOutlined aria-hidden="true" />
          This email was generated by AI. Please review before sending.
        </p>
      )}

      <div className="fu-compose-foot">
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          loading={isSending}
        >
          Send{totalAttachments > 0 ? ` (${totalAttachments} files)` : ''}
        </Button>
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
        <span className="fu-compose-foot-spacer" />
        <Button type="text" icon={<SaveOutlined />} onClick={saveAsTemplate}>Save as template</Button>
      </div>

      <EmailTemplateManager
        open={managerOpen}
        onClose={() => { setManagerOpen(false); setManagerDraft(null); }}
        values={fieldValues}
        draft={managerDraft}
        onUse={(t) => confirmReplace(`“${t.name}”`, () => applyTemplate(t))}
      />
    </div>
  );
};

export default EmailComposer;
