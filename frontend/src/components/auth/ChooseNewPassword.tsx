import React, { useState } from 'react';
import { Alert, Button, Form, Input, Typography, message } from 'antd';
import { useAuth } from '../../contexts/AuthContext';
import authService from '../../services/authService';

const { Title, Paragraph } = Typography;

const MIN_PASSWORD_LENGTH = 8;

/**
 * Shown instead of the app after someone signs in with a password an admin
 * reset. They confirm it once more and pick their own.
 */
const ChooseNewPassword: React.FC = () => {
  const { user, updateSession, logout } = useAuth();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (values: { current_password: string; new_password: string }) => {
    setSaving(true);
    setError(null);
    try {
      const { access_token } = await authService.changeTemporaryPassword(
        values.current_password,
        values.new_password
      );
      updateSession(access_token, { must_change_password: false });
      message.success('Password saved');
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : "Couldn't save the password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main style={{ maxWidth: 400, margin: '0 auto', padding: '96px 16px 48px' }}>
      <Title level={4} style={{ marginTop: 0 }}>Choose your own password</Title>
      <Paragraph type="secondary">
        An admin reset the password for {user?.username}. Enter the temporary password
        once more, then choose one only you know.
      </Paragraph>

      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

      <Form form={form} layout="vertical" requiredMark={false} onFinish={save}>
        <Form.Item
          name="current_password"
          label="Temporary password"
          rules={[{ required: true, message: 'Enter the temporary password' }]}
        >
          <Input.Password autoComplete="current-password" autoFocus />
        </Form.Item>
        <Form.Item
          name="new_password"
          label="New password"
          rules={[
            { required: true, message: 'Enter a new password' },
            { min: MIN_PASSWORD_LENGTH, message: `Use at least ${MIN_PASSWORD_LENGTH} characters` },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm_password"
          label="Confirm new password"
          dependencies={['new_password']}
          rules={[
            { required: true, message: 'Enter the new password again' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('new_password') === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error("The passwords don't match"));
              },
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={saving} block>
          Save password
        </Button>
        <Button type="link" block style={{ marginTop: 8 }} onClick={() => logout()}>
          Sign out
        </Button>
      </Form>
    </main>
  );
};

export default ChooseNewPassword;
