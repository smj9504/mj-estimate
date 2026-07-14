/**
 * ClaimContractDashboard - Displays all contracts for a claim, grouped by company.
 * Shows status summaries, contract lists, and quick actions per company.
 *
 * Usage:
 *   <ClaimContractDashboard
 *     claimId={claim.id}
 *     clientId={claim.client_id}
 *     onContractCreated={() => refetch()}
 *   />
 */

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  Collapse,
  Empty,
  Input,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  MailOutlined,
  PlusOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { contractInstanceService } from '../../services/contractService';
import type {
  CompanyContractSummary,
  ContractInstance,
  ContractStatus,
} from '../../types/contract';
import ContractGenerateModal from './ContractGenerateModal';

const { Text, Title } = Typography;

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ContractStatus, { color: string; icon: React.ReactNode; label: string }> = {
  draft: { color: 'default', icon: <EditOutlined />, label: 'Draft' },
  sent: { color: 'processing', icon: <SendOutlined />, label: 'Sent' },
  viewed: { color: 'warning', icon: <EyeOutlined />, label: 'Viewed' },
  signed: { color: 'success', icon: <CheckCircleFilled />, label: 'Signed' },
  voided: { color: 'error', icon: <StopOutlined />, label: 'Voided' },
};

const ROLE_COLORS: Record<string, string> = {
  plumber: 'blue',
  water_mitigation: 'cyan',
  reconstruction: 'purple',
  moving: 'orange',
  other: 'default',
};

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
  const [generateOpen, setGenerateOpen] = useState(false);
  const [emailModalContract, setEmailModalContract] = useState<ContractInstance | null>(null);
  const [emailAddresses, setEmailAddresses] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [emailBcc, setEmailBcc] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [emailTemplateKey, setEmailTemplateKey] = useState('');
  const [emailSending, setEmailSending] = useState(false);

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

  const handleResend = async (contract: ContractInstance) => {
    try {
      await contractInstanceService.send(claimId, contract.id);
      message.success('Contract marked as sent.');
      queryClient.invalidateQueries({ queryKey: ['contract-dashboard', claimId] });
    } catch {
      message.error('Failed to send contract.');
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

  const handleSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['contract-dashboard', claimId] });
    onContractCreated?.();
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin />
      </div>
    );
  }

  const companies = dashboard?.companies || [];

  return (
    <div>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
      }}>
        <Space>
          <FileTextOutlined style={{ fontSize: 18, color: '#1677ff' }} />
          <Title level={5} style={{ margin: 0 }}>
            Contracts ({dashboard?.total_contracts || 0})
          </Title>
        </Space>
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={() => setGenerateOpen(true)}
        >
          New Contract
        </Button>
      </div>

      {companies.length === 0 ? (
        <Empty
          description="No contracts yet"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setGenerateOpen(true)}
          >
            Generate First Contract
          </Button>
        </Empty>
      ) : (
        <Collapse
          defaultActiveKey={companies.map((_, i) => String(i))}
          style={{ background: '#fafafa' }}
          items={companies.map((company: CompanyContractSummary, idx: number) => ({
            key: String(idx),
            label: (
              <Space>
                <Text strong>{company.company_name}</Text>
                {company.role && (
                  <Tag color={ROLE_COLORS[company.role] || 'default'} style={{ fontSize: 11 }}>
                    {company.role.replace(/_/g, ' ')}
                  </Tag>
                )}
                {company.is_primary && (
                  <Tag color="gold" style={{ fontSize: 11 }}>Primary</Tag>
                )}
                {/* Summary badges */}
                <Space size={4}>
                  {company.summary.signed > 0 && (
                    <Badge count={company.summary.signed} color="#52c41a" title="Signed" />
                  )}
                  {(company.summary.sent + company.summary.viewed) > 0 && (
                    <Badge
                      count={company.summary.sent + company.summary.viewed}
                      color="#faad14"
                      title="Pending"
                    />
                  )}
                  {company.summary.draft > 0 && (
                    <Badge count={company.summary.draft} color="#d9d9d9" title="Draft" />
                  )}
                </Space>
              </Space>
            ),
            children: (
              <List
                size="small"
                dataSource={company.contracts}
                locale={{ emptyText: 'No contracts' }}
                renderItem={(contract: ContractInstance) => {
                  const statusCfg = STATUS_CONFIG[contract.status] || STATUS_CONFIG.draft;
                  return (
                    <List.Item
                      actions={[
                        // View PDF
                        contract.file_url && (
                          <Tooltip title="View PDF" key="view">
                            <Button
                              type="text"
                              size="small"
                              icon={<FilePdfOutlined />}
                              href={`/api/contracts/contracts/${contract.id}/pdf`}
                              target="_blank"
                            />
                          </Tooltip>
                        ),
                        // Copy signing link
                        contract.signing_token && contract.status !== 'voided' && (
                          <Tooltip title="Copy Signing Link" key="copy">
                            <Button
                              type="text"
                              size="small"
                              icon={<CopyOutlined />}
                              onClick={() => handleCopyLink(contract.signing_token!)}
                            />
                          </Tooltip>
                        ),
                        // Send email
                        contract.signing_token && contract.status !== 'voided' && contract.status !== 'signed' && (
                          <Tooltip title="Send via Email" key="email">
                            <Button
                              type="text"
                              size="small"
                              icon={<MailOutlined />}
                              onClick={() => handleOpenEmailModal(contract)}
                            />
                          </Tooltip>
                        ),
                        // Delete
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
                                danger
                                icon={<DeleteOutlined />}
                              />
                            </Tooltip>
                          </Popconfirm>
                        ),
                      ].filter(Boolean)}
                    >
                      <List.Item.Meta
                        title={
                          <Space size={8}>
                            <Text style={{ fontSize: 13 }}>
                              {contract.title || contract.template_name || 'Untitled'}
                            </Text>
                            <Tag
                              color={statusCfg.color}
                              icon={statusCfg.icon}
                              style={{ fontSize: 11 }}
                            >
                              {statusCfg.label}
                            </Tag>
                          </Space>
                        }
                        description={
                          <Space size={16} style={{ fontSize: 11 }}>
                            {contract.contract_number && (
                              <Text type="secondary">{contract.contract_number}</Text>
                            )}
                            {contract.created_at && (
                              <Text type="secondary">
                                <ClockCircleOutlined style={{ marginRight: 4 }} />
                                {new Date(contract.created_at).toLocaleDateString()}
                              </Text>
                            )}
                            {contract.signature_count > 0 && (
                              <Text type="secondary">
                                {contract.signature_count} signature(s)
                              </Text>
                            )}
                          </Space>
                        }
                      />
                    </List.Item>
                  );
                }}
              />
            ),
          }))}
        />
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
            <MailOutlined style={{ color: '#1677ff' }} />
            Send Signing Link via Email
          </Space>
        }
        open={!!emailModalContract}
        onCancel={() => setEmailModalContract(null)}
        onOk={handleSendEmail}
        okText="Send Email"
        okButtonProps={{ loading: emailSending, icon: <SendOutlined /> }}
        cancelButtonProps={{ disabled: emailSending }}
        destroyOnClose
        width={520}
      >
        {/* Document info */}
        <div style={{ marginBottom: 16, padding: '8px 12px', background: '#f6f8fa', borderRadius: 6 }}>
          <Text strong style={{ fontSize: 13 }}>
            {emailModalContract?.title || emailModalContract?.template_name || 'Contract'}
          </Text>
          {emailModalContract?.document_type && (
            <Tag color="blue" style={{ marginLeft: 8, fontSize: 11 }}>
              {emailModalContract.document_type.replace(/_/g, ' ')}
            </Tag>
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
    </div>
  );
};

export default ClaimContractDashboard;
