/**
 * The "From" picker for email sent from the app. Email goes out only from an
 * account added under Email Accounts - never from the server's own address -
 * so there is no empty choice and no typed address. With no account it says
 * so, linking to Email Accounts only for people who can open that page.
 */
import React from 'react';
import { Select, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export interface SendingAccountOption {
  id: string;
  email_address: string;
  display_name?: string | null;
}

interface SendingAccountSelectProps {
  accounts: SendingAccountOption[];
  value?: string;
  onChange?: (accountId: string) => void;
  style?: React.CSSProperties;
  /** Set by Form.Item so its label points at the select */
  id?: string;
}

const SendingAccountSelect: React.FC<SendingAccountSelectProps> = ({
  accounts, value, onChange, style, id,
}) => {
  const { canAccessPath } = useAuth();

  if (accounts.length === 0) {
    return (
      <Typography.Text type="warning" style={{ fontSize: 12, display: 'block' }}>
        No sending account. Email goes out only from an account added under Email Accounts.
        {canAccessPath('/email-ingestion/accounts') && (
          <> <Link to="/email-ingestion/accounts">Add one</Link></>
        )}
      </Typography.Text>
    );
  }

  return (
    <Select
      id={id}
      value={value}
      onChange={onChange}
      style={{ width: '100%', ...style }}
      placeholder="Select sending account"
      aria-label="Send from"
      options={accounts.map(a => ({
        value: a.id,
        label: a.display_name && a.display_name !== a.email_address
          ? `${a.display_name} (${a.email_address})`
          : a.email_address,
      }))}
    />
  );
};

export default SendingAccountSelect;
