import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Modal, Typography, message } from 'antd';
import authService from '../../services/authService';

const { Paragraph, Text } = Typography;

// The server allows three code requests a minute
const RESEND_WAIT_SECONDS = 60;
const MIN_PASSWORD_LENGTH = 8;

interface Props {
  open: boolean;
  email: string;
  onClose: () => void;
}

interface CodeSent {
  sent_to: string;
  expires_in_minutes: number;
  code?: string | null;
}

const errorDetail = (err: any, fallback: string) => {
  const detail = err?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
};

/**
 * Change your own password: a code goes to the email on your account, and
 * you enter it with the new password.
 */
const ChangePasswordModal: React.FC<Props> = ({ open, email, onClose }) => {
  const [form] = Form.useForm();
  const [codeSent, setCodeSent] = useState<CodeSent | null>(null);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const close = () => {
    setCodeSent(null);
    setResendIn(0);
    onClose();
  };

  const sendCode = async () => {
    setSending(true);
    try {
      const sent = await authService.requestPasswordChangeCode();
      // On a resend the form is showing; the old code no longer works
      if (codeSent) form.setFields([{ name: 'code', value: '', errors: [] }]);
      setCodeSent(sent);
      setResendIn(RESEND_WAIT_SECONDS);
    } catch (err: any) {
      message.error(errorDetail(err, "Couldn't send the code"));
    } finally {
      setSending(false);
    }
  };

  const changePassword = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return; // the form shows what's missing
    }
    setSaving(true);
    try {
      await authService.changePassword(values.code.trim(), values.new_password);
      message.success('Password changed');
      close();
    } catch (err: any) {
      const detail = errorDetail(err, "Couldn't change the password");
      if (err?.response?.status === 400) {
        form.setFields([{ name: 'code', errors: [detail] }]);
      } else {
        message.error(detail);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Change password"
      open={open}
      width={460}
      onCancel={close}
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={close}>Cancel</Button>,
        codeSent ? (
          <Button key="change" type="primary" loading={saving} onClick={changePassword}>
            Change password
          </Button>
        ) : (
          <Button key="send" type="primary" loading={sending} onClick={sendCode}>
            Send code
          </Button>
        ),
      ]}
    >
      {!codeSent ? (
        <Paragraph>
          To confirm it's you, we'll email a 6-digit code to <Text strong>{email}</Text>.
          You'll enter it with your new password.
        </Paragraph>
      ) : (
        <>
          <Paragraph>
            We sent a code to <Text strong>{codeSent.sent_to}</Text>. It expires
            in {codeSent.expires_in_minutes} minutes.{' '}
            <Button
              type="link"
              size="small"
              style={{ padding: 0, height: 'auto' }}
              disabled={resendIn > 0 || sending}
              onClick={sendCode}
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
            </Button>
          </Paragraph>
          {codeSent.code && (
            <Paragraph type="secondary">
              Email is off on this server (development). Code: <Text code>{codeSent.code}</Text>
            </Paragraph>
          )}
          <Form form={form} layout="vertical" requiredMark={false} preserve={false}>
            <Form.Item
              name="code"
              label="Code from the email"
              rules={[
                { required: true, message: 'Enter the code from the email' },
                { pattern: /^\s*\d{6}\s*$/, message: 'The code is 6 digits' },
              ]}
            >
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                autoFocus
              />
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
          </Form>
        </>
      )}
    </Modal>
  );
};

export default ChangePasswordModal;
