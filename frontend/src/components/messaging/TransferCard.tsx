import React from 'react';
import { Button, Space, Tag, Typography } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { DocumentTransfer, TransferStatus } from '../../services/documentTransferService';
import { useTransferActions } from '../../hooks/useMessaging';
import { useAuth } from '../../contexts/AuthContext';
import './Messaging.css';

const STATUS: Record<TransferStatus, { color: string; label: string }> = {
  pending: { color: 'gold', label: 'Waiting' },
  accepted: { color: 'green', label: 'Accepted' },
  declined: { color: 'default', label: 'Declined' },
  cancelled: { color: 'default', label: 'Taken back' },
};

interface TransferCardProps {
  transfer: DocumentTransfer;
  /** Show who sent it (lists outside a conversation) */
  showSender?: boolean;
}

/** An offered estimate or invoice, with what the viewer can do about it */
const TransferCard: React.FC<TransferCardProps> = ({ transfer, showSender }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { accept, decline, cancel } = useTransferActions();
  const isRecipient = user?.id === transfer.to_staff_id;
  const isSender = user?.id === transfer.from_staff_id;
  const pending = transfer.status === 'pending';
  const busy = accept.isPending || decline.isPending || cancel.isPending;
  const status = STATUS[transfer.status];

  return (
    <div className="transfer-card">
      <FileTextOutlined className="transfer-card-icon" aria-hidden="true" />
      <div className="transfer-card-body">
        <div className="transfer-card-title">
          {transfer.document_label} #{transfer.document_number || '—'}
          <Tag color={status.color} bordered={false} style={{ marginLeft: 8 }}>{status.label}</Tag>
        </div>
        <Typography.Text type="secondary" className="transfer-card-meta">
          {[transfer.client_name, showSender && transfer.from_name ? `from ${transfer.from_name}` : null]
            .filter(Boolean)
            .join(' · ')}
        </Typography.Text>
        {showSender && transfer.note && <div className="transfer-card-note">{transfer.note}</div>}
        <Space size={8} className="transfer-card-actions" wrap>
          {isRecipient && pending && (
            <>
              <Button
                type="primary"
                size="small"
                loading={accept.isPending}
                disabled={busy}
                onClick={() => accept.mutate(transfer.id)}
              >
                Accept
              </Button>
              <Button size="small" disabled={busy} onClick={() => decline.mutate(transfer.id)}>
                Decline
              </Button>
            </>
          )}
          {isSender && pending && (
            <Button size="small" disabled={busy} onClick={() => cancel.mutate(transfer.id)}>
              Take back
            </Button>
          )}
          {transfer.copy_link && (
            <Button size="small" onClick={() => navigate(transfer.copy_link!)}>
              Open your copy
            </Button>
          )}
        </Space>
      </div>
    </div>
  );
};

export default TransferCard;
