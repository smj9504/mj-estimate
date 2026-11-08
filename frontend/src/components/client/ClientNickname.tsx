/**
 * A client's nickname: what staff call the client among themselves
 * ("아이스크림집", "목사님") when the name or address isn't how they think of
 * it. Most clients have none. Everyone who can see the client sees it, so it
 * shows beside the name wherever staff pick or look at a client. It never
 * goes on anything the customer gets.
 */

import React from 'react';
import { Form, Input } from 'antd';

/** Same as the backend's NICKNAME_MAX (client/schemas.py) */
export const NICKNAME_MAX = 100;

interface ClientNicknameProps {
  nickname?: string | null;
  /** Bigger, for beside the page title */
  size?: 'title' | 'default';
  style?: React.CSSProperties;
}

/** The nickname in quotes beside the client's name; nothing when there's none */
export const ClientNickname: React.FC<ClientNicknameProps> = ({ nickname, size = 'default', style }) => {
  const text = nickname?.trim();
  if (!text) return null;
  return (
    <span
      className="client-nickname"
      title="Nickname"
      style={{
        fontSize: size === 'title' ? 15 : 'inherit',
        fontWeight: 400,
        color: 'var(--color-neutral-600)',
        // In a narrow column "아이스크림집" moves to the next line whole
        // instead of breaking between its syllables
        wordBreak: 'keep-all',
        overflowWrap: 'break-word',
        ...style,
      }}
    >
      {'“'}{text}{'”'}
    </span>
  );
};

/** The Nickname box for the client add and edit forms */
export const NicknameFormItem: React.FC = () => (
  <Form.Item
    name="nickname"
    label="Nickname"
    extra="What the team calls this client, e.g. 아이스크림집 or 목사님. Everyone who can see the client sees it; customers never do."
    rules={[{ max: NICKNAME_MAX, message: `At most ${NICKNAME_MAX} characters` }]}
  >
    <Input placeholder="Optional" maxLength={NICKNAME_MAX} allowClear />
  </Form.Item>
);

export default ClientNickname;
