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
  List,
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
  EditOutlined,
  EyeOutlined,
  FilePdfOutlined,
  FileTextOutlined,
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
  onContractCreated?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

const ClaimContractDashboard: React.FC<ClaimContractDashboardProps> = ({
  claimId,
  clientId,
  onContractCreated,
}) => {
  const queryClient = useQueryClient();
  const [generateOpen, setGenerateOpen] = useState(false);

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
                              href={contract.filled_pdf_url || contract.file_url}
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
                        // Resend
                        contract.status === 'draft' && (
                          <Tooltip title="Send" key="send">
                            <Button
                              type="text"
                              size="small"
                              icon={<SendOutlined />}
                              onClick={() => handleResend(contract)}
                            />
                          </Tooltip>
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
    </div>
  );
};

export default ClaimContractDashboard;
