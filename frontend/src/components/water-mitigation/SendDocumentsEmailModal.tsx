/**
 * Email Selected Documents Modal for Water Mitigation
 * Sends the documents picked in the Documents tab to any recipient. Unlike
 * Send to Adjuster it doesn't mark the documents as sent or move the status.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal, Button, Select, Input, Space, Typography, Divider, Alert,
  Tag, Spin, message,
} from 'antd';
import {
  SendOutlined, FilePdfOutlined, FileOutlined, MailOutlined, CloseOutlined,
} from '@ant-design/icons';
import RichTextEditor from '../editor/RichTextEditor';
import AttachmentPreviewModal, { AttachmentLink, type AttachmentToPreview } from './AttachmentPreviewModal';
import waterMitigationService, {
  adjusterEmailService,
  type AdjusterEmailInfo,
  type SendDocumentsPayload,
} from '../../services/waterMitigationService';

const { Text } = Typography;

// Matches the backend's raw attachment limit before compression kicks in
const EMAIL_SIZE_LIMIT = 18 * 1024 * 1024;

// A saved document, attached as it is
export interface DocumentEmailAttachment {
  id: string;
  filename: string;
  size?: number;
}

interface SendDocumentsEmailModalProps {
  open: boolean;
  onClose: () => void;
  jobId: string;
  attachments: DocumentEmailAttachment[];
  // Picked invoices that have no saved PDF to attach
  invoicesWithoutPdf?: string[];
  onSent?: () => void;
}

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const buildDefaultEmail = (info: AdjusterEmailInfo) => {
  const address = info.job.property_address || '';
  const addressShort = address.split(',')[0].trim();
  const subject = [info.job.claim_number, addressShort].filter(Boolean).join(' - ') || 'Documents';
  const body_html = [
    '<p>Hello,</p>',
    `<p>Please find the attached document(s)${address ? ` for ${address}` : ''}.</p>`,
    '<p>Let me know if you have any questions.</p>',
    '<p>Thank you.</p>',
  ].join('\n\n');
  return { subject, body_html };
};

const SendDocumentsEmailModal: React.FC<SendDocumentsEmailModalProps> = ({
  open, onClose, jobId, attachments, invoicesWithoutPdf = [], onSent,
}) => {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [info, setInfo] = useState<AdjusterEmailInfo | null>(null);
  const [emailContent, setEmailContent] = useState({ subject: '', body_html: '' });
  // The selection as opened; removing one here leaves the list's selection alone
  const [items, setItems] = useState<DocumentEmailAttachment[]>([]);
  const [previewing, setPreviewing] = useState<AttachmentToPreview | null>(null);

  // Email addresses
  const [toEmails, setToEmails] = useState<string[]>([]);
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [bccEmails, setBccEmails] = useState<string[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>();
  const [manualFromEmail, setManualFromEmail] = useState('');

  const loadInfo = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      const data = await adjusterEmailService.getInfo(jobId);
      setInfo(data);
      setEmailContent(buildDefaultEmail(data));

      // Adjuster contacts in To, the PA copied in BCC as on the other sends
      const presetEmails = (data.preset_emails || []).filter(p => p.role !== 'pa');
      if (presetEmails.length > 0) {
        setToEmails(presetEmails.map(p => p.email));
      } else if (data.adjuster.email) {
        setToEmails([data.adjuster.email]);
      }
      if (data.pa.email) setBccEmails([data.pa.email]);
      if (data.email_accounts.length > 0) setSelectedAccountId(data.email_accounts[0].id);
    } catch (err) {
      console.error('Failed to load email info:', err);
      message.error('Failed to load email info');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (open) {
      setItems(attachments);
      loadInfo();
    } else {
      setItems([]);
      setToEmails([]);
      setCcEmails([]);
      setBccEmails([]);
      setManualFromEmail('');
      setEmailContent({ subject: '', body_html: '' });
    }
  // The selection is read once, when the modal opens
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loadInfo]);

  const handleSend = async () => {
    if (toEmails.length === 0) {
      message.warning('Please add at least one recipient');
      return;
    }
    if (items.length === 0) {
      message.warning('Please keep at least one document');
      return;
    }

    setSending(true);
    try {
      const payload: SendDocumentsPayload = {
        to_addresses: toEmails,
        cc_addresses: ccEmails,
        bcc_addresses: bccEmails,
        subject: emailContent.subject,
        body_html: emailContent.body_html,
        email_account_id: selectedAccountId,
        from_address: manualFromEmail.trim() || undefined,
        document_ids: items.map(i => i.id),
      };

      const result = await adjusterEmailService.sendDocuments(jobId, payload);
      message.success(`Email sent with ${result.attachments_count} attachment(s)`);
      onSent?.();
      onClose();
    } catch (err: any) {
      console.error('Failed to email documents:', err);
      message.error(err?.response?.data?.detail || 'Failed to send email');
    } finally {
      setSending(false);
    }
  };

  // The PA is offered in CC/BCC, everyone else in To and CC
  const presetOptions = (() => {
    if (!info) return [];
    const presets = info.preset_emails || [];
    if (presets.length > 0) {
      return presets.map(p => ({
        value: p.email,
        label: p.name
          ? `${p.name} (${p.email})${p.role !== 'adjuster' ? ` [${p.role}]` : ''}`
          : p.email,
      }));
    }
    const options = [];
    if (info.adjuster.email) {
      options.push({
        value: info.adjuster.email,
        label: info.adjuster.name ? `${info.adjuster.name} (${info.adjuster.email})` : info.adjuster.email,
      });
    }
    if (info.pa.email) {
      options.push({
        value: info.pa.email,
        label: info.pa.name ? `${info.pa.name} (${info.pa.email}) [pa]` : info.pa.email,
      });
    }
    return options;
  })();

  const totalSize = items.reduce((sum, i) => sum + (i.size || 0), 0);

  return (
    <Modal
      title={
        <Space>
          <MailOutlined />
          <span>Email Documents</span>
          <Tag color="blue">{items.length}</Tag>
        </Space>
      }
      open={open}
      width={720}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>Cancel</Button>,
        <Button
          key="send"
          type="primary"
          icon={<SendOutlined />}
          loading={sending}
          onClick={handleSend}
          disabled={toEmails.length === 0 || items.length === 0}
        >
          Send Email
        </Button>,
      ]}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <div style={{ marginTop: 12 }}>Loading email info...</div>
        </div>
      ) : info ? (
        <div>
          {/* Email Account */}
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>From:</Text>
            {info.email_accounts.length > 0 && (
              <Select
                value={manualFromEmail ? undefined : selectedAccountId}
                onChange={(val) => { setSelectedAccountId(val); setManualFromEmail(''); }}
                style={{ width: '100%', marginBottom: 6 }}
                placeholder="Select email account..."
                allowClear
                disabled={!!manualFromEmail}
                options={info.email_accounts.map(a => ({
                  value: a.id,
                  label: `${a.display_name} (${a.email_address})`,
                }))}
              />
            )}
            <Input
              placeholder="Or type the email replies should go to..."
              value={manualFromEmail}
              onChange={e => {
                setManualFromEmail(e.target.value);
                if (e.target.value.trim()) setSelectedAccountId(undefined);
              }}
              allowClear
              style={{ width: '100%' }}
            />
            {manualFromEmail.trim() && (
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                Sent from our verified address so it doesn't land in spam;
                replies go to this address.
              </Text>
            )}
          </div>

          {/* To */}
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>To:</Text>
            <Select
              mode="tags"
              style={{ width: '100%' }}
              placeholder="Recipient email address..."
              value={toEmails}
              onChange={setToEmails}
              tokenSeparators={[',', ';']}
              options={presetOptions}
            />
          </div>

          {/* CC */}
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>CC:</Text>
            <Select
              mode="tags"
              style={{ width: '100%' }}
              placeholder="CC email address..."
              value={ccEmails}
              onChange={setCcEmails}
              tokenSeparators={[',', ';']}
              options={presetOptions}
            />
          </div>

          {/* BCC */}
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              BCC{info.pa.email ? ' (PA will receive a copy)' : ''}:
            </Text>
            <Select
              mode="tags"
              style={{ width: '100%' }}
              placeholder="BCC email address..."
              value={bccEmails}
              onChange={setBccEmails}
              tokenSeparators={[',', ';']}
              options={presetOptions}
            />
          </div>

          <Divider style={{ margin: '12px 0' }} />

          {/* Subject */}
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Subject:</Text>
            <Input
              value={emailContent.subject}
              onChange={e => setEmailContent(prev => ({ ...prev, subject: e.target.value }))}
            />
          </div>

          {/* Body */}
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              Email Body:
            </Text>
            <RichTextEditor
              value={emailContent.body_html}
              onChange={val => setEmailContent(prev => ({ ...prev, body_html: val }))}
              placeholder="Email content..."
              minHeight={160}
              maxHeight={300}
            />
          </div>

          <Divider style={{ margin: '12px 0' }} />

          {/* Attachments */}
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              Attachments ({items.length}){totalSize > 0 && ` · ${formatFileSize(totalSize)}`}:
            </Text>
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              {items.map(item => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AttachmentLink
                    label={item.filename}
                    icon={item.filename.toLowerCase().endsWith('.pdf')
                      ? <FilePdfOutlined style={{ color: '#d44c47' }} />
                      : <FileOutlined style={{ color: '#787774' }} />}
                    onClick={() => setPreviewing({
                      title: item.filename,
                      filename: item.filename,
                      load: () => waterMitigationService.documents.getBlob(item.id),
                    })}
                  />
                  {!!item.size && (
                    <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                      {formatFileSize(item.size)}
                    </Text>
                  )}
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined />}
                    aria-label={`Remove ${item.filename}`}
                    onClick={() => setItems(prev => prev.filter(i => i.id !== item.id))}
                    style={{ marginLeft: 'auto', flexShrink: 0 }}
                  />
                </div>
              ))}
            </Space>
            {invoicesWithoutPdf.length > 0 && (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 8 }}
                message={`No saved PDF for ${invoicesWithoutPdf.join(', ')}, so it won't be attached.`}
                description="Download or preview the invoice in the list to save its PDF, then email it."
              />
            )}
            {totalSize > EMAIL_SIZE_LIMIT && (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 8 }}
                message={`These files are over the ${EMAIL_SIZE_LIMIT / 1024 / 1024}MB email limit. PDFs will be compressed before sending; if they're still too big the email won't be sent.`}
              />
            )}
          </div>

          <AttachmentPreviewModal attachment={previewing} onClose={() => setPreviewing(null)} />
        </div>
      ) : (
        <Alert type="error" message="Failed to load email info. Please try again." />
      )}
    </Modal>
  );
};

export default SendDocumentsEmailModal;
