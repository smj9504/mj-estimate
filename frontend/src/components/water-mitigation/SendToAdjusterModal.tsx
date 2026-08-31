/**
 * Send to Adjuster Modal
 * Allows reviewing documents and sending WM documents to insurance adjuster via email.
 * BCC support for PA email copy.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal, Button, Select, Input, Space, Typography, Divider, Alert,
  Checkbox, Tag, Spin, message, Badge,
} from 'antd';
import {
  SendOutlined, FilePdfOutlined, CheckCircleFilled,
  CloseCircleFilled, MailOutlined,
} from '@ant-design/icons';
import RichTextEditor from '../editor/RichTextEditor';
import {
  adjusterEmailService,
  type AdjusterEmailInfo,
  type DocumentReadiness,
  type SendToAdjusterPayload,
} from '../../services/waterMitigationService';

const { Text } = Typography;

interface SendToAdjusterModalProps {
  open: boolean;
  onClose: () => void;
  jobId: string;
  onSent?: (result: { status: string; documents_sent_date: string }) => void;
}

const DOC_LABELS: Record<string, string> = {
  photo_report: 'Photo Report',
  invoice: 'Invoice',
  w9: 'Company W-9',
  cos: 'Certificate of Satisfaction (COS)',
  ewa: 'Emergency Work Authorization (EWA)',
  sketch: 'Sketch',
};

const DOC_ORDER = ['photo_report', 'invoice', 'w9', 'cos', 'ewa', 'sketch'];

const SendToAdjusterModal: React.FC<SendToAdjusterModalProps> = ({
  open, onClose, jobId, onSent,
}) => {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [info, setInfo] = useState<AdjusterEmailInfo | null>(null);
  const [emailContent, setEmailContent] = useState({ subject: '', body_html: '' });
  const [customNotes, setCustomNotes] = useState('');

  // Email addresses
  const [toEmails, setToEmails] = useState<string[]>([]);
  const [bccEmails, setBccEmails] = useState<string[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>();
  const [manualFromEmail, setManualFromEmail] = useState('');

  // Document selection
  const [selectedDocs, setSelectedDocs] = useState<string[]>([...DOC_ORDER]);

  // Load info when modal opens
  const loadInfo = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      const data = await adjusterEmailService.getInfo(jobId);
      setInfo(data);

      // Pre-fill To with all preset emails
      const presetEmails = data.preset_emails || [];
      if (presetEmails.length > 0) {
        setToEmails(presetEmails.map(p => p.email));
      } else if (data.adjuster.email) {
        setToEmails([data.adjuster.email]);
      }

      // Pre-fill BCC with PA email
      if (data.pa.email) {
        setBccEmails([data.pa.email]);
      }

      // Pre-select email account (backend sorts matching company first)
      if (data.email_accounts.length > 0) {
        setSelectedAccountId(data.email_accounts[0].id);
      }

      // Generate email content
      const email = await adjusterEmailService.generateEmail(jobId);
      setEmailContent(email);

      // Auto-select only ready documents
      const readyDocs = DOC_ORDER.filter(key => {
        const doc = data.documents[key as keyof DocumentReadiness];
        return doc && typeof doc === 'object' && 'ready' in doc && doc.ready;
      });
      setSelectedDocs(readyDocs);
    } catch (err) {
      console.error('Failed to load adjuster email info:', err);
      message.error('Failed to load email info');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (open) {
      loadInfo();
    } else {
      // Reset state on close
      setCustomNotes('');
      setToEmails([]);
      setBccEmails([]);
      setManualFromEmail('');
      setSelectedDocs([...DOC_ORDER]);
      setEmailContent({ subject: '', body_html: '' });
    }
  }, [open, loadInfo]);

  const handleRegenerateEmail = async () => {
    try {
      const email = await adjusterEmailService.generateEmail(jobId, customNotes);
      setEmailContent(email);
      message.success('Email updated with notes');
    } catch {
      message.error('Failed to regenerate email');
    }
  };

  const handleSend = async () => {
    if (toEmails.length === 0) {
      message.warning('Please add at least one recipient');
      return;
    }

    setSending(true);
    try {
      const payload: SendToAdjusterPayload = {
        to_addresses: toEmails,
        bcc_addresses: bccEmails,
        subject: emailContent.subject,
        body_html: emailContent.body_html,
        email_account_id: selectedAccountId,
        from_address: manualFromEmail.trim() || undefined,
        selected_documents: selectedDocs,
      };

      const result = await adjusterEmailService.send(jobId, payload);
      message.success(`Email sent with ${result.attachments_count} attachment(s)`);
      onSent?.({ status: result.status, documents_sent_date: result.documents_sent_date });
      onClose();
    } catch (err: any) {
      console.error('Failed to send:', err);
      message.error(err?.response?.data?.detail || 'Failed to send email');
    } finally {
      setSending(false);
    }
  };

  const docs = info?.documents;
  const readyCount = docs
    ? DOC_ORDER.filter(k => {
        const d = docs[k as keyof DocumentReadiness];
        return d && typeof d === 'object' && 'ready' in d && d.ready;
      }).length
    : 0;

  const toggleDoc = (key: string) => {
    setSelectedDocs(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  return (
    <Modal
      title={
        <Space>
          <SendOutlined />
          <span>Send Documents to Adjuster</span>
          {docs && (
            <Badge
              count={`${readyCount}/${DOC_ORDER.length}`}
              style={{
                backgroundColor: readyCount === DOC_ORDER.length ? '#52c41a' : '#faad14',
                fontSize: 11,
              }}
            />
          )}
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
          disabled={toEmails.length === 0 || selectedDocs.length === 0}
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
          {/* Adjuster/Recipients Info Banner */}
          {(info.preset_emails?.length || info.adjuster.name) && (
            <div style={{
              background: '#f6ffed', border: '1px solid #b7eb8f',
              borderRadius: 6, padding: '8px 12px', marginBottom: 12,
            }}>
              {(info.preset_emails && info.preset_emails.length > 1) ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <Text style={{ fontSize: 12, color: '#555' }}>Recipients ({info.preset_emails.length}):</Text>
                  {info.preset_emails.map((p, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
                      <Text strong style={{ fontSize: 13 }}>{p.name || p.email}</Text>
                      {p.name && <Text style={{ fontSize: 12, color: '#1890ff' }}>{p.email}</Text>}
                      {p.role !== 'adjuster' && (
                        <Tag color="blue" style={{ fontSize: 10 }}>{p.role}</Tag>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <Text style={{ fontSize: 12, color: '#555' }}>Adjuster:</Text>
                  <Text strong style={{ fontSize: 13 }}>{info.adjuster.name}</Text>
                  {info.adjuster.email && (
                    <Text style={{ fontSize: 12, color: '#1890ff' }}>{info.adjuster.email}</Text>
                  )}
                  {info.adjuster.phone && (
                    <Text type="secondary" style={{ fontSize: 12 }}>{info.adjuster.phone}</Text>
                  )}
                </div>
              )}
            </div>
          )}

          {/* PA Info for BCC */}
          {info.pa.email && (
            <div style={{
              background: '#f0f5ff', border: '1px solid #adc6ff',
              borderRadius: 6, padding: '8px 12px', marginBottom: 12,
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            }}>
              <MailOutlined style={{ color: '#1890ff' }} />
              <Text style={{ fontSize: 12, color: '#555' }}>BCC (PA copy):</Text>
              {info.pa.name && <Text strong style={{ fontSize: 13 }}>{info.pa.name}</Text>}
              {info.pa.company && (
                <Text type="secondary" style={{ fontSize: 12 }}>{info.pa.company}</Text>
              )}
              <Text style={{ fontSize: 12, color: '#1890ff' }}>{info.pa.email}</Text>
            </div>
          )}

          {/* Previously sent warning */}
          {info.job.documents_sent_date && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={`Documents were previously sent on ${new Date(info.job.documents_sent_date).toLocaleDateString()}. Sending again will update the sent date.`}
            />
          )}

          {/* Document Checklist */}
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              Documents to Attach:
            </Text>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
              {DOC_ORDER.map(key => {
                const doc = docs?.[key as keyof DocumentReadiness];
                const ready = doc && typeof doc === 'object' && 'ready' in doc && doc.ready;
                const checked = selectedDocs.includes(key);

                return (
                  <div
                    key={key}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '4px 8px', borderRadius: 4,
                      background: ready ? '#f6ffed' : '#fff2f0',
                      cursor: ready ? 'pointer' : 'default',
                      opacity: ready ? 1 : 0.7,
                    }}
                    onClick={() => ready && toggleDoc(key)}
                  >
                    <Checkbox
                      checked={checked && ready}
                      disabled={!ready}
                      onChange={() => toggleDoc(key)}
                    />
                    {ready ? (
                      <CheckCircleFilled style={{ color: '#52c41a', fontSize: 14 }} />
                    ) : (
                      <CloseCircleFilled style={{ color: '#ff4d4f', fontSize: 14 }} />
                    )}
                    <Text style={{ fontSize: 13 }}>{DOC_LABELS[key]}</Text>
                    {!ready && (
                      <Tag color="red" style={{ fontSize: 10, marginLeft: 'auto' }}>Missing</Tag>
                    )}
                  </div>
                );
              })}
            </div>
            {selectedDocs.length === 0 && (
              <Alert
                type="warning" showIcon
                message="Select at least one document to attach."
                style={{ marginTop: 8 }}
              />
            )}
          </div>

          <Divider style={{ margin: '12px 0' }} />

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
              placeholder="Or type sender email manually..."
              value={manualFromEmail}
              onChange={e => {
                setManualFromEmail(e.target.value);
                if (e.target.value.trim()) setSelectedAccountId(undefined);
              }}
              allowClear
              style={{ width: '100%' }}
            />
            {!selectedAccountId && !manualFromEmail && (
              <Text type="warning" style={{ fontSize: 12 }}>Select an account or enter email address</Text>
            )}
            {info.reply_to?.name && (
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                Will show as "{info.reply_to.name}" in From, and replies go to{' '}
                {info.reply_to.email || 'the assigned company'} (not the From address above).
              </Text>
            )}
          </div>

          {/* To */}
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>To:</Text>
            <Select
              mode="tags"
              style={{ width: '100%' }}
              placeholder="Adjuster email address..."
              value={toEmails}
              onChange={setToEmails}
              tokenSeparators={[',', ';']}
              options={(() => {
                const presets = info.preset_emails || [];
                if (presets.length > 0) {
                  return presets.map(p => ({
                    value: p.email,
                    label: p.name
                      ? `${p.name} (${p.email})${p.role !== 'adjuster' ? ` [${p.role}]` : ''}`
                      : p.email,
                  }));
                }
                return info.adjuster.email ? [{
                  value: info.adjuster.email,
                  label: info.adjuster.name
                    ? `${info.adjuster.name} (${info.adjuster.email})`
                    : info.adjuster.email,
                }] : [];
              })()}
            />
            {toEmails.length === 0 && (
              <Alert
                type="warning"
                message="At least one recipient email is required."
                showIcon
                style={{ marginTop: 8 }}
              />
            )}
          </div>

          {/* BCC */}
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              BCC (PA will receive a copy):
            </Text>
            <Select
              mode="tags"
              style={{ width: '100%' }}
              placeholder="PA email for BCC..."
              value={bccEmails}
              onChange={setBccEmails}
              tokenSeparators={[',', ';']}
              options={info.pa.email ? [{
                value: info.pa.email,
                label: info.pa.name
                  ? `${info.pa.name} (${info.pa.email})`
                  : info.pa.email,
              }] : []}
            />
          </div>

          <Divider style={{ margin: '12px 0' }} />

          {/* Custom Notes */}
          <div style={{ marginBottom: 12 }}>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>
              Additional Notes (added to email)
            </Text>
            <Input.TextArea
              rows={2}
              placeholder="e.g., Please note the additional drywall repair scope..."
              value={customNotes}
              onChange={e => setCustomNotes(e.target.value)}
            />
            <Button
              size="small" type="link" style={{ padding: '4px 0' }}
              onClick={handleRegenerateEmail}
            >
              Apply notes to email
            </Button>
          </div>

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
              minHeight={250}
              maxHeight={400}
            />
          </div>

          {/* Selected Attachments Summary */}
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              Attachments ({selectedDocs.length}):
            </Text>
            <Space direction="vertical" size={2}>
              {selectedDocs.map(key => (
                <Space key={key} size={4}>
                  <FilePdfOutlined style={{ color: '#ff4d4f' }} />
                  <Text style={{ fontSize: 12 }}>{DOC_LABELS[key]}</Text>
                </Space>
              ))}
              {selectedDocs.length === 0 && (
                <Text type="secondary">No documents selected</Text>
              )}
            </Space>
          </div>
        </div>
      ) : (
        <Alert type="error" message="Failed to load email info. Please try again." />
      )}
    </Modal>
  );
};

export default SendToAdjusterModal;
