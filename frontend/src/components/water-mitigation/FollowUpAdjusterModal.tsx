/**
 * Follow-Up Email Modal for Water Mitigation
 * Sends a follow-up email to adjuster when no response received after document submission.
 * Optionally re-attaches selected documents.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal, Button, Select, Input, Space, Typography, Divider, Alert,
  Checkbox, Tag, Spin, message, Badge,
} from 'antd';
import {
  SendOutlined, FilePdfOutlined, CheckCircleFilled,
  CloseCircleFilled, MailOutlined, ReloadOutlined,
} from '@ant-design/icons';
import RichTextEditor from '../editor/RichTextEditor';
import {
  adjusterEmailService,
  type AdjusterEmailInfo,
  type DocumentReadiness,
  type SendToAdjusterPayload,
} from '../../services/waterMitigationService';

const { Text } = Typography;

interface FollowUpAdjusterModalProps {
  open: boolean;
  onClose: () => void;
  jobId: string;
  onSent?: () => void;
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

const FollowUpAdjusterModal: React.FC<FollowUpAdjusterModalProps> = ({
  open, onClose, jobId, onSent,
}) => {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [info, setInfo] = useState<AdjusterEmailInfo | null>(null);
  const [emailContent, setEmailContent] = useState({ subject: '', body_html: '' });
  const [customNotes, setCustomNotes] = useState('');
  const [followupMeta, setFollowupMeta] = useState<{
    followup_count: number;
    days_since_sent: number | null;
    documents_sent_date: string;
  }>({ followup_count: 0, days_since_sent: null, documents_sent_date: '' });

  // Email addresses
  const [toEmails, setToEmails] = useState<string[]>([]);
  const [bccEmails, setBccEmails] = useState<string[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>();
  const [manualFromEmail, setManualFromEmail] = useState('');

  // Document re-attachment (optional, default none)
  const [reattachDocs, setReattachDocs] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);

  const loadInfo = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      const [data, followup] = await Promise.all([
        adjusterEmailService.getInfo(jobId),
        adjusterEmailService.generateFollowUp(jobId),
      ]);
      setInfo(data);
      setFollowupMeta({
        followup_count: followup.followup_count,
        days_since_sent: followup.days_since_sent,
        documents_sent_date: followup.documents_sent_date,
      });
      setEmailContent({ subject: followup.subject, body_html: followup.body_html });

      // Pre-fill To with all preset emails
      const presetEmails = data.preset_emails || [];
      if (presetEmails.length > 0) {
        setToEmails(presetEmails.map(p => p.email));
      } else if (data.adjuster.email) {
        setToEmails([data.adjuster.email]);
      }
      if (data.pa.email) setBccEmails([data.pa.email]);
      if (data.email_accounts.length > 0) setSelectedAccountId(data.email_accounts[0].id);
    } catch (err) {
      console.error('Failed to load follow-up info:', err);
      message.error('Failed to load email info');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (open) {
      loadInfo();
    } else {
      setCustomNotes('');
      setToEmails([]);
      setBccEmails([]);
      setManualFromEmail('');
      setReattachDocs(false);
      setSelectedDocs([]);
      setEmailContent({ subject: '', body_html: '' });
    }
  }, [open, loadInfo]);

  const handleRegenerateEmail = async () => {
    try {
      const followup = await adjusterEmailService.generateFollowUp(jobId, customNotes);
      setEmailContent({ subject: followup.subject, body_html: followup.body_html });
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
        selected_documents: reattachDocs ? selectedDocs : [],
      };

      const result = await adjusterEmailService.sendFollowUp(jobId, payload);
      const attachMsg = result.attachments_count > 0
        ? ` with ${result.attachments_count} attachment(s)`
        : '';
      message.success(`Follow-up email sent${attachMsg}`);
      onSent?.();
      onClose();
    } catch (err: any) {
      console.error('Failed to send follow-up:', err);
      message.error(err?.response?.data?.detail || 'Failed to send follow-up email');
    } finally {
      setSending(false);
    }
  };

  const docs = info?.documents;

  const toggleDoc = (key: string) => {
    setSelectedDocs(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const handleReattachToggle = (checked: boolean) => {
    setReattachDocs(checked);
    if (checked && docs) {
      // Auto-select all ready documents
      const readyDocs = DOC_ORDER.filter(key => {
        const d = docs[key as keyof DocumentReadiness];
        return d && typeof d === 'object' && 'ready' in d && d.ready;
      });
      setSelectedDocs(readyDocs);
    } else {
      setSelectedDocs([]);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <ReloadOutlined />
          <span>Follow Up Email</span>
          {followupMeta.followup_count > 0 && (
            <Tag color="blue">#{followupMeta.followup_count + 1}</Tag>
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
          disabled={toEmails.length === 0}
        >
          Send Follow-Up
        </Button>,
      ]}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <div style={{ marginTop: 12 }}>Loading follow-up info...</div>
        </div>
      ) : info ? (
        <div>
          {/* Follow-up context banner */}
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message={
              followupMeta.days_since_sent != null
                ? `Documents were sent ${followupMeta.days_since_sent} day(s) ago (${followupMeta.documents_sent_date}). No response received.`
                : 'Sending a follow-up email to the adjuster.'
            }
          />

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
                </div>
              )}
            </div>
          )}

          {/* PA Info */}
          {info.pa.email && (
            <div style={{
              background: '#f0f5ff', border: '1px solid #adc6ff',
              borderRadius: 6, padding: '8px 12px', marginBottom: 12,
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            }}>
              <MailOutlined style={{ color: '#1890ff' }} />
              <Text style={{ fontSize: 12, color: '#555' }}>BCC (PA copy):</Text>
              {info.pa.name && <Text strong style={{ fontSize: 13 }}>{info.pa.name}</Text>}
              <Text style={{ fontSize: 12, color: '#1890ff' }}>{info.pa.email}</Text>
            </div>
          )}

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
              placeholder="e.g., I also wanted to mention the additional scope..."
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
              placeholder="Follow-up email content..."
              minHeight={200}
              maxHeight={350}
            />
          </div>

          <Divider style={{ margin: '12px 0' }} />

          {/* Re-attach Documents (Optional) */}
          <div style={{ marginBottom: 8 }}>
            <Checkbox
              checked={reattachDocs}
              onChange={e => handleReattachToggle(e.target.checked)}
            >
              <Text strong>Re-attach documents</Text>
            </Checkbox>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginLeft: 24 }}>
              Optionally re-send documents with this follow-up email
            </Text>
          </div>

          {reattachDocs && docs && (
            <div style={{ marginLeft: 24, marginBottom: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
                {DOC_ORDER.map(key => {
                  const doc = docs[key as keyof DocumentReadiness];
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
            </div>
          )}

          {/* Selected Attachments Summary */}
          {reattachDocs && selectedDocs.length > 0 && (
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
              </Space>
            </div>
          )}
        </div>
      ) : (
        <Alert type="error" message="Failed to load email info. Please try again." />
      )}
    </Modal>
  );
};

export default FollowUpAdjusterModal;
