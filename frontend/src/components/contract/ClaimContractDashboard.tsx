/**
 * ClaimContractDashboard - Displays all contracts for a claim, grouped by company.
 * Shows status summaries, contract lists, quick actions, activity history and reminders.
 *
 * Usage:
 *   <ClaimContractDashboard
 *     claimId={claim.id}
 *     clientId={claim.client_id}
 *     onContractCreated={() => refetch()}
 *   />
 */

import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Drawer,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Timeline,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  BellOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  HistoryOutlined,
  MailOutlined,
  PlusOutlined,
  SendOutlined,
  StopOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { contractInstanceService } from '../../services/contractService';
import api from '../../services/api';
import type {
  CompanyContractSummary,
  ContractAuditEntry,
  ContractInstance,
  ContractStatus,
} from '../../types/contract';
import CompanySignSheet from './CompanySignSheet';
import ContractGenerateModal from './ContractGenerateModal';
import { canSignForCompany } from './signatureLines';
import { Pill, humanize, useSheetModal, type TagTone } from '../common/ui';
import ClaimSection from '../client/ClaimSection';
import { useAuth } from '../../contexts/AuthContext';

const { Text } = Typography;

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ContractStatus, { tone: TagTone; icon: React.ReactNode; label: string }> = {
  draft: { tone: 'gray', icon: <EditOutlined />, label: 'Draft' },
  sent: { tone: 'blue', icon: <SendOutlined />, label: 'Sent' },
  viewed: { tone: 'yellow', icon: <EyeOutlined />, label: 'Viewed' },
  signed: { tone: 'green', icon: <CheckCircleFilled />, label: 'Signed' },
  voided: { tone: 'red', icon: <StopOutlined />, label: 'Voided' },
};

const ContractStatusPill: React.FC<{ status: ContractStatus }> = ({ status }) => {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  return <Pill tone={cfg.tone} icon={cfg.icon}>{cfg.label}</Pill>;
};

// ── Audit log display ─────────────────────────────────────────────────────────

const AUDIT_ACTION_CONFIG: Record<string, {
  label: string;
  color: string;
  icon: React.ReactNode;
}> = {
  created: {
    label: 'Document created',
    color: 'blue',
    icon: <FileTextOutlined />,
  },
  emailed: {
    label: 'Document emailed for signature',
    color: 'blue',
    icon: <MailOutlined />,
  },
  reminder_sent: {
    label: 'Reminder sent',
    color: 'orange',
    icon: <BellOutlined />,
  },
  viewed: {
    label: 'Document viewed',
    color: 'gray',
    icon: <EyeOutlined />,
  },
  signer_name_entered: {
    label: 'Signer entered name at signing',
    color: 'gray',
    icon: <UserOutlined />,
  },
  signed: {
    label: 'Document e-signed',
    color: 'green',
    icon: <CheckCircleFilled />,
  },
  agreement_completed: {
    label: 'Agreement completed',
    color: 'green',
    icon: <CheckCircleFilled />,
  },
  voided: {
    label: 'Document voided',
    color: 'red',
    icon: <StopOutlined />,
  },
  sent_copy: {
    label: 'Signed copy sent',
    color: 'blue',
    icon: <SendOutlined />,
  },
};

function parseAuditLog(raw: string | ContractAuditEntry[] | undefined): ContractAuditEntry[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function formatAuditTimestamp(ts: string): string {
  try {
    const d = new Date(ts + (ts.endsWith('Z') ? '' : 'Z'));
    return d.toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch {
    return ts;
  }
}

function getAuditDescription(entry: ContractAuditEntry): string {
  const cfg = AUDIT_ACTION_CONFIG[entry.action];
  let desc = cfg?.label || entry.action;
  const detail = entry.detail;

  switch (entry.action) {
    case 'created':
      if (entry.actor_name) desc += ` by ${entry.actor_name}`;
      if (entry.actor_email) desc += ` (${entry.actor_email})`;
      break;
    case 'emailed':
      if (detail?.recipients) {
        const r = Array.isArray(detail.recipients) ? detail.recipients : [detail.recipients];
        desc += ` to ${r.join(', ')}`;
      }
      break;
    case 'reminder_sent':
      if (detail?.recipients) {
        const r = Array.isArray(detail.recipients) ? detail.recipients : [detail.recipients];
        desc += ` to ${r.join(', ')}`;
      }
      break;
    case 'viewed':
      if (entry.actor_email) desc += ` by ${entry.actor_email}`;
      break;
    case 'signer_name_entered':
      if (detail?.signer_name) desc += ` as ${detail.signer_name}`;
      if (entry.actor_email) desc = `Signer ${entry.actor_email} entered name at signing as ${detail?.signer_name || ''}`;
      break;
    case 'signed':
      if (detail?.signer_name) {
        desc = `Document e-signed by ${detail.signer_name}`;
        if (detail.signer_role === 'company_rep') desc += ' for the company';
        if (entry.actor_email) desc += ` (${entry.actor_email})`;
      }
      break;
    case 'voided':
      if (detail?.reason) desc += ` — ${detail.reason}`;
      break;
    default:
      break;
  }

  return desc;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface ClaimContractDashboardProps {
  claimId: string;
  clientId: string;
  clientEmail?: string;
  onContractCreated?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

const ClaimContractDashboard: React.FC<ClaimContractDashboardProps> = ({
  claimId,
  clientId,
  clientEmail,
  onContractCreated,
}) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [signingContract, setSigningContract] = useState<ContractInstance | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const { sheetProps } = useSheetModal();
  const [emailModalContract, setEmailModalContract] = useState<ContractInstance | null>(null);
  const [emailAddresses, setEmailAddresses] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [emailBcc, setEmailBcc] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [emailTemplateKey, setEmailTemplateKey] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  // Activity drawer
  const [activityContract, setActivityContract] = useState<ContractInstance | null>(null);
  // Reminder
  const [reminderContract, setReminderContract] = useState<ContractInstance | null>(null);
  const [reminderMessage, setReminderMessage] = useState('');
  const [reminderSending, setReminderSending] = useState(false);

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['contract-dashboard', claimId],
    queryFn: () => contractInstanceService.getDashboard(claimId),
    enabled: !!claimId,
  });

  const handleCopyLink = async (token: string) => {
    const url = `${window.location.origin}/sign/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      message.success('Signing link copied.');
    } catch {
      message.error('Failed to copy link.');
    }
  };

  const handleDelete = async (contract: ContractInstance) => {
    try {
      await contractInstanceService.delete(claimId, contract.id);
      message.success('Contract deleted.');
      queryClient.invalidateQueries({ queryKey: ['contract-dashboard', claimId] });
    } catch {
      message.error('Failed to delete contract.');
    }
  };

  const parseEmails = (str: string) =>
    str.split(/[,;\n]+/).map(e => e.trim()).filter(e => e && e.includes('@'));

  const handleOpenEmailModal = (contract: ContractInstance) => {
    setEmailModalContract(contract);
    setEmailAddresses(clientEmail || '');
    setEmailCc('');
    setEmailBcc('');
    setEmailMessage('');
    setEmailTemplateKey(contract.document_type || 'other');
  };

  const handleSendEmail = async () => {
    if (!emailModalContract) return;
    const emails = parseEmails(emailAddresses);
    if (emails.length === 0) {
      message.warning('Please enter at least one valid email address.');
      return;
    }
    const cc = parseEmails(emailCc);
    const bcc = parseEmails(emailBcc);
    setEmailSending(true);
    try {
      const result = await contractInstanceService.sendEmail(
        claimId, emailModalContract.id,
        {
          emails,
          cc: cc.length > 0 ? cc : undefined,
          bcc: bcc.length > 0 ? bcc : undefined,
          message: emailMessage || undefined,
          template_key: emailTemplateKey || undefined,
          origin_url: window.location.origin,
        },
      );
      message.success(result.message || `Email sent to ${emails.length} recipient(s).`);
      setEmailModalContract(null);
      queryClient.invalidateQueries({ queryKey: ['contract-dashboard', claimId] });
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      message.error(typeof detail === 'string' ? detail : 'Failed to send email.');
    } finally {
      setEmailSending(false);
    }
  };

  const handleSendReminder = async () => {
    if (!reminderContract) return;
    // Get recipients from sent_to_emails or clientEmail
    let emails: string[] = [];
    if (reminderContract.sent_to_emails) {
      try {
        const parsed = typeof reminderContract.sent_to_emails === 'string'
          ? JSON.parse(reminderContract.sent_to_emails)
          : reminderContract.sent_to_emails;
        if (Array.isArray(parsed)) emails = parsed;
      } catch { /* ignore */ }
    }
    if (emails.length === 0 && clientEmail) emails = [clientEmail];
    if (emails.length === 0) {
      message.warning('No recipient email found for reminder.');
      return;
    }

    setReminderSending(true);
    try {
      const result = await contractInstanceService.sendReminder(
        claimId, reminderContract.id,
        {
          emails,
          message: reminderMessage || undefined,
          origin_url: window.location.origin,
        },
      );
      message.success(result.message || 'Reminder sent.');
      setReminderContract(null);
      setReminderMessage('');
      queryClient.invalidateQueries({ queryKey: ['contract-dashboard', claimId] });
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      message.error(typeof detail === 'string' ? detail : 'Failed to send reminder.');
    } finally {
      setReminderSending(false);
    }
  };

  const handleSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['contract-dashboard', claimId] });
    onContractCreated?.();
  };

  // Parse audit log for activity drawer
  const auditEntries = useMemo(() => {
    if (!activityContract) return [];
    return parseAuditLog(activityContract.audit_log);
  }, [activityContract]);

  const companies = dashboard?.companies || [];

  const contractActions = (contract: ContractInstance) => [
    !!contract.open_company_lines?.length && canSignForCompany(user, contract.company_id) && (
      <Button key="company-sign" size="small" onClick={() => setSigningContract(contract)}>
        Sign for company
      </Button>
    ),
    contract.file_url && (
      <Tooltip title="View PDF" key="view">
        <a
          className="sup-pdf-link cl-touch-link"
          href={`${api.defaults.baseURL || ''}/api/contracts/contracts/${contract.id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View PDF"
        >
          <FilePdfOutlined />
        </a>
      </Tooltip>
    ),
    contract.signing_token && contract.status !== 'voided' && (
      <Tooltip title="Copy Signing Link" key="copy">
        <Button
          type="text"
          size="small"
          className="ui-icon-btn cl-touch-icon"
          aria-label="Copy signing link"
          icon={<CopyOutlined />}
          onClick={() => handleCopyLink(contract.signing_token!)}
        />
      </Tooltip>
    ),
    contract.signing_token && contract.status !== 'voided' && contract.status !== 'signed' && (
      <Tooltip title="Send via Email" key="email">
        <Button
          type="text"
          size="small"
          className="ui-icon-btn cl-touch-icon"
          aria-label="Send via email"
          icon={<MailOutlined />}
          onClick={() => handleOpenEmailModal(contract)}
        />
      </Tooltip>
    ),
    contract.signing_token && (contract.status === 'sent' || contract.status === 'viewed') && (
      <Tooltip title="Send Reminder" key="reminder">
        <Button
          type="text"
          size="small"
          className="ui-icon-btn cl-touch-icon"
          aria-label="Send reminder"
          icon={<BellOutlined />}
          onClick={() => {
            setReminderContract(contract);
            setReminderMessage('');
          }}
        />
      </Tooltip>
    ),
    <Tooltip title="Activity History" key="history">
      <Button
        type="text"
        size="small"
        className="ui-icon-btn cl-touch-icon"
        aria-label="Activity history"
        icon={<HistoryOutlined />}
        onClick={() => setActivityContract(contract)}
      />
    </Tooltip>,
    contract.status !== 'signed' && (
      <Popconfirm
        key="delete"
        title="Delete this contract?"
        description="This action cannot be undone."
        onConfirm={() => handleDelete(contract)}
        okText="Delete"
        okButtonProps={{ danger: true }}
      >
        <Tooltip title="Delete">
          <Button
            type="text"
            size="small"
            className="ui-icon-btn ui-icon-btn--danger cl-touch-icon"
            aria-label="Delete contract"
            icon={<DeleteOutlined />}
          />
        </Tooltip>
      </Popconfirm>
    ),
  ].filter(Boolean);

  return (
    <ClaimSection
      title="Contracts"
      count={dashboard?.total_contracts || undefined}
      actions={(
        <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => setGenerateOpen(true)}>
          New Contract
        </Button>
      )}
    >
      {isLoading ? (
        <Spin size="small" />
      ) : companies.length === 0 ? (
        <div className="cl-empty">No contracts yet.</div>
      ) : (
        companies.map((company: CompanyContractSummary, idx: number) => {
          const pending = company.summary.sent + company.summary.viewed;
          const counts = [
            company.summary.signed > 0 && `${company.summary.signed} signed`,
            pending > 0 && `${pending} pending`,
            company.summary.draft > 0 && `${company.summary.draft} draft`,
          ].filter(Boolean);
          return (
            <div key={idx} className="cl-group">
              <div className="cl-group-head">
                <span className="cl-group-name">{company.company_name}</span>
                {company.role && <span className="cl-meta">{humanize(company.role)}</span>}
                {company.is_primary && <Pill tone="gray">Primary</Pill>}
                {counts.length > 0 && <span className="cl-meta cl-group-counts">{counts.join(' · ')}</span>}
              </div>
              {company.contracts.length === 0 ? (
                <div className="cl-empty">No contracts</div>
              ) : (
                <ul className="cl-list">
                  {company.contracts.map((contract: ContractInstance) => {
                    const meta = [
                      contract.contract_number,
                      contract.created_at && new Date(contract.created_at).toLocaleDateString(),
                      contract.signature_count > 0
                        && `${contract.signature_count} signature${contract.signature_count === 1 ? '' : 's'}`,
                    ].filter(Boolean);
                    return (
                      <li key={contract.id} className="cl-list-item">
                        <div className="cl-list-body">
                          <div className="cl-list-title">
                            <span>{contract.title || contract.template_name || 'Untitled'}</span>
                            <ContractStatusPill status={contract.status} />
                            {!!contract.open_company_lines?.length && (
                              <Pill tone="orange">Needs company signature</Pill>
                            )}
                          </div>
                          {meta.length > 0 && <div className="cl-meta">{meta.join(' · ')}</div>}
                        </div>
                        <div className="cl-row-actions">{contractActions(contract)}</div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })
      )}

      {signingContract && (
        <CompanySignSheet contract={signingContract} onClose={() => setSigningContract(null)} />
      )}

      {/* Generate Contract Modal */}
      <ContractGenerateModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        claimId={claimId}
        clientId={clientId}
        onSuccess={handleSuccess}
      />

      {/* Send Email Modal */}
      <Modal
        title={
          <Space>
            <MailOutlined />
            Send Signing Link via Email
          </Space>
        }
        open={!!emailModalContract}
        onCancel={() => setEmailModalContract(null)}
        onOk={handleSendEmail}
        okText="Send Email"
        okButtonProps={{ loading: emailSending, icon: <SendOutlined /> }}
        cancelButtonProps={{ disabled: emailSending }}
        destroyOnHidden
        width={520}
        {...sheetProps}
      >
        {/* Document info */}
        <div className="cl-quiet-box">
          <Text strong style={{ fontSize: 13 }}>
            {emailModalContract?.title || emailModalContract?.template_name || 'Contract'}
          </Text>
          {emailModalContract?.document_type && (
            <Pill tone="gray" style={{ marginLeft: 8 }}>
              {humanize(emailModalContract.document_type)}
            </Pill>
          )}
          {emailModalContract?.contract_number && (
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              {emailModalContract.contract_number}
            </Text>
          )}
        </div>

        {/* Email Template */}
        <div style={{ marginBottom: 12 }}>
          <Text strong style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Email Template</Text>
          <Select
            style={{ width: '100%' }}
            value={emailTemplateKey || 'other'}
            onChange={(val) => setEmailTemplateKey(val)}
            popupMatchSelectWidth={true}
          >
            <Select.OptGroup label="Authorization">
              <Select.Option value="authorization">EWA — Authorization to Work</Select.Option>
            </Select.OptGroup>
            <Select.OptGroup label="Certificate of Satisfaction">
              <Select.Option value="cos_water_mitigation">COS — Water Mitigation</Select.Option>
              <Select.Option value="cos_rebuild">COS — Rebuild / Restoration</Select.Option>
              <Select.Option value="certificate_of_satisfaction">COS — General</Select.Option>
            </Select.OptGroup>
            <Select.OptGroup label="Other Documents">
              <Select.Option value="certificate_of_completion">Certificate of Completion</Select.Option>
              <Select.Option value="scope_of_work">Scope of Work</Select.Option>
              <Select.Option value="lien_waiver">Lien Waiver</Select.Option>
              <Select.Option value="change_order">Change Order</Select.Option>
              <Select.Option value="other">Other</Select.Option>
            </Select.OptGroup>
          </Select>
        </div>

        {/* To */}
        <div style={{ marginBottom: 12 }}>
          <Text strong style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>To</Text>
          <Input.TextArea
            rows={2}
            placeholder="Enter email addresses (comma or line separated)"
            value={emailAddresses}
            onChange={(e) => setEmailAddresses(e.target.value)}
          />
          <Text type="secondary" style={{ fontSize: 11, marginTop: 2, display: 'block' }}>
            All recipients share the same link. Once signed, others see the signed document.
          </Text>
        </div>

        {/* CC */}
        <div style={{ marginBottom: 12 }}>
          <Text strong style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>CC (optional)</Text>
          <Input
            placeholder="cc@example.com"
            value={emailCc}
            onChange={(e) => setEmailCc(e.target.value)}
          />
        </div>

        {/* BCC */}
        <div style={{ marginBottom: 12 }}>
          <Text strong style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>BCC (optional)</Text>
          <Input
            placeholder="bcc@example.com"
            value={emailBcc}
            onChange={(e) => setEmailBcc(e.target.value)}
          />
        </div>

        {/* Custom message */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
            Additional Message (optional)
          </Text>
          <Input.TextArea
            rows={2}
            placeholder="Add a personal note to the email..."
            value={emailMessage}
            onChange={(e) => setEmailMessage(e.target.value)}
            maxLength={500}
          />
        </div>
      </Modal>

      {/* Send Reminder Modal */}
      <Modal
        title={
          <Space>
            <BellOutlined />
            Send Reminder
          </Space>
        }
        open={!!reminderContract}
        onCancel={() => setReminderContract(null)}
        onOk={handleSendReminder}
        okText="Send Reminder"
        okButtonProps={{ loading: reminderSending, icon: <BellOutlined /> }}
        cancelButtonProps={{ disabled: reminderSending }}
        destroyOnHidden
        width={480}
        {...sheetProps}
      >
        <div className="cl-quiet-box">
          <Text strong style={{ fontSize: 13 }}>
            {reminderContract?.title || reminderContract?.template_name || 'Contract'}
          </Text>
          {reminderContract?.status && (
            <span style={{ marginLeft: 8 }}><ContractStatusPill status={reminderContract.status} /></span>
          )}
        </div>
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            A reminder email will be sent to the original recipients with the signing link.
          </Text>
          {(() => {
            let emails: string[] = [];
            try {
              const raw = reminderContract?.sent_to_emails;
              if (raw) {
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (Array.isArray(parsed)) emails = parsed;
              }
            } catch { /* ignore */ }
            if (emails.length === 0 && clientEmail) emails = [clientEmail];
            return emails.length > 0 ? (
              <div style={{ marginTop: 8 }}>
                <Text strong style={{ fontSize: 12 }}>Recipients: </Text>
                <Text style={{ fontSize: 12 }}>{emails.join(', ')}</Text>
              </div>
            ) : null;
          })()}
        </div>
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
            Additional Message (optional)
          </Text>
          <Input.TextArea
            rows={2}
            placeholder="Add a note to the reminder email..."
            value={reminderMessage}
            onChange={(e) => setReminderMessage(e.target.value)}
            maxLength={500}
          />
        </div>
      </Modal>

      {/* Activity History Drawer */}
      <Drawer
        title={
          <Space>
            <HistoryOutlined />
            <span>Activity</span>
          </Space>
        }
        placement="right"
        width={420}
        open={!!activityContract}
        onClose={() => setActivityContract(null)}
        destroyOnHidden
      >
        {activityContract && (
          <div>
            {/* Document header */}
            <div className="cl-quiet-box" style={{ marginBottom: 20 }}>
              <Text strong style={{ fontSize: 14, display: 'block' }}>
                {activityContract.title || activityContract.template_name || 'Contract'}
              </Text>
              {activityContract.contract_number && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {activityContract.contract_number}
                </Text>
              )}
              <div style={{ marginTop: 6 }}>
                <ContractStatusPill status={activityContract.status} />
              </div>
            </div>

            {/* Timeline */}
            {auditEntries.length === 0 ? (
              <Empty
                description="No activity recorded yet"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                style={{ marginTop: 40 }}
              />
            ) : (
              <Timeline
                items={[...auditEntries].reverse().map((entry, idx) => {
                  const cfg = AUDIT_ACTION_CONFIG[entry.action] || {
                    label: entry.action,
                    color: 'gray',
                    icon: <ClockCircleOutlined />,
                  };
                  return {
                    key: idx,
                    color: cfg.color,
                    dot: cfg.icon,
                    children: (
                      <div>
                        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                          {getAuditDescription(entry)}
                        </div>
                        <div className="cl-meta" style={{ marginTop: 2 }}>
                          {formatAuditTimestamp(entry.timestamp)}
                          {entry.ip && (
                            <span style={{ marginLeft: 8 }}>
                              IP: {entry.ip}
                            </span>
                          )}
                        </div>
                      </div>
                    ),
                  };
                })}
              />
            )}
          </div>
        )}
      </Drawer>
    </ClaimSection>
  );
};

export default ClaimContractDashboard;
