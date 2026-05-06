import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Card,
  Button,
  Space,
  Form,
  Input,
  Select,
  Tag,
  message,
  Typography,
  Row,
  Col,
  Divider,
  Alert,
} from 'antd';
import {
  SendOutlined,
  RobotOutlined,
  FileTextOutlined,
  EyeOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { claimFollowUpService } from '../../services/claimFollowUpService';
import { emailIngestionService } from '../../services/emailIngestionService';
import type {
  EmailTemplate,
  SendEmailRequest,
  GenerateAIEmailRequest,
} from '../../types/claimFollowUp';

const { Text } = Typography;
const { TextArea } = Input;

interface EmailComposerProps {
  claimId: string;
  followupTaskId?: string;
  defaultTo?: string;
  defaultSubject?: string;
  onSent?: () => void;
  onCancel?: () => void;
}

const EmailComposer: React.FC<EmailComposerProps> = ({
  claimId,
  followupTaskId,
  defaultTo,
  defaultSubject,
  onSent,
  onCancel,
}) => {
  const [form] = Form.useForm();
  const [selectedTemplate, setSelectedTemplate] = useState<string | undefined>();
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>();
  const [previewMode, setPreviewMode] = useState(false);

  // Load email accounts (from addresses)
  const { data: accounts = [] } = useQuery({
    queryKey: ['email-accounts'],
    queryFn: () => emailIngestionService.listAccounts(),
  });

  // Load templates
  const { data: templates = [] } = useQuery({
    queryKey: ['email-templates'],
    queryFn: () => claimFollowUpService.getTemplates(),
  });

  // Set defaults
  useEffect(() => {
    if (defaultTo) form.setFieldValue('to_addresses', defaultTo);
    if (defaultSubject) form.setFieldValue('subject', defaultSubject);
  }, [defaultTo, defaultSubject, form]);

  // Auto-select first account
  useEffect(() => {
    if (accounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  // Send mutation
  const sendMutation = useMutation({
    mutationFn: (data: SendEmailRequest) => claimFollowUpService.sendEmail(data),
    onSuccess: () => {
      message.success('Email sent successfully');
      form.resetFields();
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

  const handleSend = () => {
    form.validateFields().then(values => {
      const toList = typeof values.to_addresses === 'string'
        ? values.to_addresses.split(',').map((e: string) => e.trim()).filter(Boolean)
        : [values.to_addresses];
      const ccList = values.cc_addresses
        ? values.cc_addresses.split(',').map((e: string) => e.trim()).filter(Boolean)
        : [];

      const payload: SendEmailRequest = {
        claim_id: claimId,
        followup_task_id: followupTaskId,
        email_account_id: selectedAccountId,
        to_addresses: toList,
        cc_addresses: ccList,
        subject: values.subject,
        body_html: values.body_html,
        template_id: selectedTemplate,
      };

      sendMutation.mutate(payload);
    });
  };

  const selectedAccount = accounts.find(a => a.id === selectedAccountId);

  return (
    <Card
      title={
        <Space>
          <SendOutlined />
          <span>Compose Email</span>
        </Space>
      }
      extra={
        <Space>
          <Button size="small" onClick={onCancel}>Cancel</Button>
          <Button
            type="primary"
            size="small"
            icon={<SendOutlined />}
            onClick={handleSend}
            loading={sendMutation.isPending}
          >
            Send
          </Button>
        </Space>
      }
    >
      {/* From Account Selection */}
      <div style={{ marginBottom: 12 }}>
        <Text type="secondary" style={{ marginRight: 8 }}>From:</Text>
        {accounts.length > 0 ? (
          <Select
            value={selectedAccountId}
            onChange={setSelectedAccountId}
            style={{ width: 350 }}
            placeholder="Select sending account"
            options={accounts.filter(a => a.is_active).map(a => ({
              value: a.id,
              label: (
                <Space>
                  <UserOutlined />
                  <span>{a.display_name}</span>
                  <Text type="secondary">({a.email_address})</Text>
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

      {/* AI Quick Actions */}
      <div style={{ marginBottom: 12 }}>
        <Text type="secondary" style={{ marginRight: 8 }}>AI Generate:</Text>
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
        <Text type="secondary" style={{ marginRight: 8 }}>Template:</Text>
        <Select
          placeholder="Select a template"
          allowClear
          style={{ width: 300 }}
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
        <Row gutter={16}>
          <Col span={16}>
            <Form.Item
              name="to_addresses"
              label="To"
              rules={[{ required: true, message: 'Enter recipient email' }]}
            >
              <Input placeholder="adjuster@insurance.com (comma-separated for multiple)" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="cc_addresses" label="CC">
              <Input placeholder="cc@example.com" />
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
            <TextArea
              rows={10}
              placeholder="Write your email here... (HTML supported)"
            />
          )}
        </Form.Item>
      </Form>

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
