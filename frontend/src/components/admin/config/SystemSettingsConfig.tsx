import React, { useState, useEffect } from 'react';
import { Card, Switch, Space, Typography, Skeleton, message } from 'antd';
import api from '../../../services/api';
import { getErrorMessage } from '../../../api/errorHandler';

const { Text } = Typography;

const SystemSettingsConfig: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [routeThroughFallback, setRouteThroughFallback] = useState(false);

  const fetchSetting = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/admin/settings/route-personal-accounts');
      setRouteThroughFallback(response.data?.enabled ?? false);
    } catch (error) {
      message.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSetting();
  }, []);

  const handleToggle = async (checked: boolean) => {
    setSaving(true);
    const previous = routeThroughFallback;
    setRouteThroughFallback(checked);
    try {
      await api.put('/api/admin/settings/route-personal-accounts', { enabled: checked });
      message.success(`Setting updated: ${checked ? 'enabled' : 'disabled'}`);
    } catch (error) {
      setRouteThroughFallback(previous);
      message.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Skeleton active paragraph={{ rows: 2 }} />;
  }

  return (
    <Card size="small" title="Email Sending">
      <Space align="start" size={12}>
        <Switch checked={routeThroughFallback} loading={saving} onChange={handleToggle} />
        <div>
          <Text strong>Route personal accounts through Resend</Text>
          <div>
            <Text type="secondary" style={{ fontSize: 13 }}>
              When enabled, sending through a personal Gmail/Outlook/Yahoo email account
              (e.g. msong@enter.construction) is routed through the system's verified
              send-only relay instead of that account's own SMTP server. The selected
              account's address is kept as Reply-To, and the From name still shows
              "&lt;person&gt; - &lt;company&gt;" either way. Turn this on only if
              deliverability testing shows it helps - direct sending through the
              account's own SMTP server is the default.
            </Text>
          </div>
        </div>
      </Space>
    </Card>
  );
};

export default SystemSettingsConfig;
