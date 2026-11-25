/**
 * Email a Rebuild project's completion documents (COC, invoice, completion
 * photos...) to the public adjuster, the carrier's adjuster or anyone, from
 * one of the company's mailboxes (rebuild/completion_send.py). Each document
 * goes as it is saved. Sent, they can be marked sent on the checklist.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Checkbox, Input, Modal, Select, Skeleton, message } from 'antd';
import { FilePdfOutlined } from '@ant-design/icons';
import RichTextEditor from '../editor/RichTextEditor';
import SendingAccountSelect from '../common/SendingAccountSelect';
import { useSheetModal } from '../common/ui';
import { rebuildService } from '../../services/rebuildService';
import { withPdfUploadLock } from '../../utils/pdfUploadLock';
import { DOC_TYPE_LABELS } from './rebuildUi';
import type { RebuildCompletionDoc, RebuildDocsEmailInfo, RebuildProject } from '../../types/rebuild';

interface Props {
  open: boolean;
  project: RebuildProject;
  /** The project's documents with a file, in the checklist's order */
  docs: RebuildCompletionDoc[];
  onClose: () => void;
  onSent: () => void;
}

const ROLE_LABELS: Record<string, string> = { pa: 'Public adjuster', adjuster: 'Adjuster', client: 'Client' };

const RebuildSendDocsModal: React.FC<Props> = ({ open, project, docs, onClose, onSent }) => {
  const { isPhone, sheetProps } = useSheetModal('tall');
  const [info, setInfo] = useState<RebuildDocsEmailInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [accountId, setAccountId] = useState<string | undefined>();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [markSent, setMarkSent] = useState(true);

  useEffect(() => {
    if (!open) return;
    setPicked(docs.map(d => d.id));
    setMarkSent(true);
    setCc([]);
    setBcc([]);
    setLoading(true);
    rebuildService.docsEmailInfo(project.id)
      .then(data => {
        setInfo(data);
        setSubject(data.subject);
        setBody(data.body_html);
        setAccountId(data.email_accounts[0]?.id);
        // The public adjuster, else the carrier's adjuster
        const pa = data.recipients.filter(r => r.role === 'pa').map(r => r.email);
        const adjusters = data.recipients.filter(r => r.role === 'adjuster').map(r => r.email);
        setTo(pa.length ? pa : adjusters.slice(0, 1));
      })
      .catch(() => message.error('Could not load the email details'))
      .finally(() => setLoading(false));
  // Read once as it opens; the documents picked stay as picked
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project.id]);

  const options = useMemo(() => (info?.recipients || []).map(r => ({
    value: r.email,
    label: `${r.name ? `${r.name} · ` : ''}${r.email}${ROLE_LABELS[r.role] ? ` (${ROLE_LABELS[r.role]})` : ''}`,
  })), [info]);

  const send = async () => {
    if (!to.length) {
      message.warning('Add at least one recipient');
      return;
    }
    setSending(true);
    try {
      const result = await withPdfUploadLock(() => rebuildService.sendDocs(project.id, {
        doc_ids: docs.filter(d => picked.includes(d.id)).map(d => d.id),
        to_addresses: to,
        cc_addresses: cc,
        bcc_addresses: bcc,
        subject,
        body_html: body,
        email_account_id: accountId,
        mark_sent: markSent,
      }), 'Sending email…');
      message.success(`Email sent with ${result.attachments_count} document${result.attachments_count === 1 ? '' : 's'}`);
      onSent();
      onClose();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Could not send the email');
    } finally {
      setSending(false);
    }
  };

  const recipientSelect = (value: string[], onChange: (v: string[]) => void, label: string) => (
    <label className="rb-mail-field">
      <span className="rb-inv-label">{label}</span>
      <Select mode="tags" value={value} onChange={onChange} options={options} tokenSeparators={[',', ';', ' ']}
        placeholder="Email address" aria-label={label} size={isPhone ? 'large' : 'middle'} />
    </label>
  );

  return (
    <Modal
      title="Email completion documents"
      open={open}
      width={720}
      onCancel={onClose}
      onOk={send}
      okText="Send email"
      okButtonProps={{ disabled: loading || !info || !to.length || !picked.length || !accountId }}
      confirmLoading={sending}
      destroyOnClose
      {...sheetProps}
    >
      {loading ? <Skeleton active paragraph={{ rows: 8 }} /> : !info ? (
        <Alert type="error" showIcon message="Could not load the email details. Close this and try again." />
      ) : (
        <div className="rb-mail">
          {info.email_accounts.length === 0 && (
            <Alert type="warning" showIcon
              message="No mailbox you may send from. Add one under Email Accounts first." />
          )}
          <label className="rb-mail-field">
            <span className="rb-inv-label">From</span>
            <SendingAccountSelect accounts={info.email_accounts} value={accountId} onChange={setAccountId} />
          </label>
          {recipientSelect(to, setTo, 'To')}
          {recipientSelect(cc, setCc, 'CC')}
          {recipientSelect(bcc, setBcc, 'BCC')}
          <label className="rb-mail-field">
            <span className="rb-inv-label">Subject</span>
            <Input value={subject} onChange={e => setSubject(e.target.value)} aria-label="Subject" size={isPhone ? 'large' : 'middle'} />
          </label>
          <div className="rb-mail-field">
            <span className="rb-inv-label">Message</span>
            <RichTextEditor value={body} onChange={setBody} minHeight={140} maxHeight={260} placeholder="Message" />
          </div>
          <div className="rb-mail-field">
            <span className="rb-inv-label">Attached ({picked.length} of {docs.length})</span>
            <Checkbox.Group value={picked} onChange={v => setPicked(v as string[])} className="rb-mail-docs">
              {docs.map(d => (
                <Checkbox key={d.id} value={d.id}>
                  <FilePdfOutlined className="sup-pdf-icon" aria-hidden="true" />{' '}
                  <span className="rb-mail-doc">{d.title}</span>
                  <span className="rb-mail-doc-type">{DOC_TYPE_LABELS[d.doc_type] || d.doc_type}</span>
                </Checkbox>
              ))}
            </Checkbox.Group>
          </div>
          <Checkbox checked={markSent} onChange={e => setMarkSent(e.target.checked)}>
            Mark them as sent on the checklist
          </Checkbox>
        </div>
      )}
    </Modal>
  );
};

export default RebuildSendDocsModal;
