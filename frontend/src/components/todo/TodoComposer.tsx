import React, { useRef, useState } from 'react';
import { Button, Input } from 'antd';
import type { InputRef } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import type { TodoCreate } from '../../types/client';
import ClientSearchSelect from '../common/ClientSearchSelect';

interface TodoComposerProps {
  onAdd: (payload: TodoCreate) => Promise<unknown>;
  adding: boolean;
  /** Phone size: 16px text so iOS does not zoom in on focus */
  large?: boolean;
}

/** Add a todo at the top of To do: type it, optionally pick a client, press Enter */
const TodoComposer: React.FC<TodoComposerProps> = ({ onAdd, adding, large }) => {
  const [title, setTitle] = useState('');
  const [client, setClient] = useState<{ id: string; name: string } | null>(null);
  const inputRef = useRef<InputRef>(null);
  const size = large ? 'large' : 'small';

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || adding) return;
    try {
      await onAdd({ title: trimmed, client_id: client?.id ?? null });
      setTitle('');
      setClient(null);
      inputRef.current?.focus();
    } catch {
      // The board shows the error and keeps what was typed
    }
  };

  return (
    <form className="td-composer" onSubmit={submit}>
      <Input
        ref={inputRef}
        className="td-composer-title"
        variant="borderless"
        size={large ? 'large' : 'middle'}
        placeholder="Add a todo"
        aria-label="New todo"
        maxLength={500}
        enterKeyHint="done"
        value={title}
        onChange={e => setTitle(e.target.value)}
      />
      <div className="td-composer-foot">
        <ClientSearchSelect
          className="td-composer-client"
          variant="borderless"
          size={size}
          prefix={<UserOutlined />}
          placeholder="Client (optional)"
          aria-label="Client"
          value={client?.id}
          selectedLabel={client?.name}
          onChange={(id, picked) => setClient(id && picked ? { id, name: picked.display_name } : null)}
        />
        <Button type="primary" size={size} htmlType="submit" loading={adding} disabled={!title.trim()}>
          Add
        </Button>
      </div>
    </form>
  );
};

export default TodoComposer;
