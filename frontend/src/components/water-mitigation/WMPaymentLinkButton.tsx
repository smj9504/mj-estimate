/**
 * "Manager Link" button for the WM payment board.
 * Opens a modal with the no-login URL a manager uses to confirm payments,
 * plus Copy and Regenerate (which kills the old link immediately).
 */

import React, { useState } from 'react';
import { Alert, Button, Input, Modal, Popconfirm, Space, Typography, message } from 'antd';
import { CopyOutlined, ExportOutlined, LinkOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { wmPaymentBoardService } from '../../services/waterMitigationService';
import type { WMPaymentBoardToken } from '../../types/waterMitigation';

const { Text } = Typography;

const buildUrl = (token: string) => `${window.location.origin}/wm-payments/${token}`;

const WMPaymentLinkButton: React.FC<{ size?: 'small' | 'middle' }> = ({ size = 'middle' }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<WMPaymentBoardToken | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setToken(await wmPaymentBoardService.getToken());
    } catch (error) {
      message.error('Failed to load manager link');
      console.error('Load payment board token error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = () => {
    setOpen(true);
    if (!token) load();
  };

  const handleCopy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(buildUrl(token.token));
      message.success('Link copied');
    } catch {
      message.error('Copy failed — select the link and copy it manually');
    }
  };

  const handleRegenerate = async () => {
    try {
      setLoading(true);
      setToken(await wmPaymentBoardService.regenerateToken());
      message.success('New link issued. The old link no longer works.');
    } catch (error) {
      message.error('Failed to regenerate link');
      console.error('Regenerate payment board token error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button icon={<LinkOutlined />} size={size} onClick={handleOpen}>
        Manager Link
      </Button>
      <Modal
        title="Manager payment link"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        destroyOnClose={false}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Alert
            type="info"
            showIcon
            message="Anyone with this link can see the payment board and mark payments received — no login needed."
            description="Amounts and check recipient can only be edited here, not from the link."
          />
          <Space.Compact style={{ width: '100%' }}>
            <Input
              readOnly
              value={token ? buildUrl(token.token) : ''}
              placeholder={loading ? 'Loading…' : ''}
              onFocus={(e) => e.target.select()}
            />
            <Button icon={<CopyOutlined />} onClick={handleCopy} disabled={!token}>
              Copy
            </Button>
          </Space.Compact>
          <Button
            type="primary"
            icon={<ExportOutlined />}
            disabled={!token}
            onClick={() => token && window.open(buildUrl(token.token), '_blank', 'noopener')}
            block
          >
            Open manager page
          </Button>
          {token && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Opened {token.view_count}× · Confirmed {token.confirm_count}×
              {token.last_accessed_at &&
                ` · Last used ${dayjs(token.last_accessed_at).format('YYYY-MM-DD HH:mm')}`}
            </Text>
          )}
          <Popconfirm
            title="Regenerate link?"
            description="The current link stops working immediately. You'll need to send the new one to the manager."
            okText="Regenerate"
            okButtonProps={{ danger: true }}
            onConfirm={handleRegenerate}
          >
            <Button danger icon={<ReloadOutlined />} loading={loading}>
              Regenerate link
            </Button>
          </Popconfirm>
        </Space>
      </Modal>
    </>
  );
};

export default WMPaymentLinkButton;
