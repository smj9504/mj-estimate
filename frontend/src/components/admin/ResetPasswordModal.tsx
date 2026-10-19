import React, { useRef, useState } from 'react';
import { Button, Form, Input, Modal, Radio, Space, Typography, message } from 'antd';
import authService from '../../services/authService';

const { Paragraph, Text } = Typography;

const MIN_PASSWORD_LENGTH = 8;

interface Props {
  user: { id: string; username: string; full_name?: string } | null;
  onClose: () => void;
}

/**
 * Admin gives someone a new password, either one the server makes up or one
 * they type, and sees it once to pass on.
 */
const ResetPasswordModal: React.FC<Props> = ({ user, onClose }) => {
  const [form] = Form.useForm();
  const mode: 'generate' | 'custom' = Form.useWatch('mode', form) ?? 'generate';
  const [saving, setSaving] = useState(false);
  const [newPassword, setNewPassword] = useState<string | null>(null);

  // Keep the name in the title while the modal fades out
  const lastUser = useRef(user);
  if (user) lastUser.current = user;
  const target = lastUser.current;
  const name = target?.full_name?.trim() || target?.username || '';

  const close = () => {
    setNewPassword(null);
    onClose();
  };

  const reset = async () => {
    if (!user) return;
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return; // the form shows what's missing
    }
    setSaving(true);
    try {
      const result = await authService.resetUserPassword(
        user.id,
        values.mode === 'custom' ? values.password : undefined
      );
      setNewPassword(result.password);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      message.error(typeof detail === 'string' ? detail : "Couldn't reset the password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Reset password for ${name}`}
      open={!!user}
      width={460}
      onCancel={close}
      destroyOnClose
      footer={
        newPassword
          ? [<Button key="done" type="primary" onClick={close}>Done</Button>]
          : [
              <Button key="cancel" onClick={close}>Cancel</Button>,
              <Button key="reset" type="primary" loading={saving} onClick={reset}>
                Reset password
              </Button>,
            ]
      }
    >
      {newPassword ? (
        <>
          <Paragraph>
            {name}'s password is now:
          </Paragraph>
          <Paragraph>
            <Text code copyable style={{ fontSize: 16 }} data-testid="new-password">
              {newPassword}
            </Text>
          </Paragraph>
          <Paragraph type="secondary">
            Share it with them privately. It won't be shown again. When they sign in
            with it, they'll be asked to choose their own.
          </Paragraph>
        </>
      ) : (
        <>
          <Paragraph>
            Their current password stops working right away, and they're signed out
            everywhere.
          </Paragraph>
          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
            preserve={false}
            initialValues={{ mode: 'generate' }}
          >
            <Form.Item name="mode" style={{ marginBottom: mode === 'custom' ? 12 : 0 }}>
              <Radio.Group>
                <Space direction="vertical">
                  <Radio value="generate">Make up a temporary password</Radio>
                  <Radio value="custom">Set the password myself</Radio>
                </Space>
              </Radio.Group>
            </Form.Item>
            {mode === 'custom' && (
              <Form.Item
                name="password"
                label="New password"
                rules={[
                  { required: true, message: 'Enter a password' },
                  { min: MIN_PASSWORD_LENGTH, message: `Use at least ${MIN_PASSWORD_LENGTH} characters` },
                ]}
                style={{ marginBottom: 0 }}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
            )}
          </Form>
        </>
      )}
    </Modal>
  );
};

export default ResetPasswordModal;
