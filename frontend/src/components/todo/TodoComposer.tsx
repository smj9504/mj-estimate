import React, { useEffect, useRef, useState } from 'react';
import { Button, Input } from 'antd';
import type { InputRef } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import type { TodoCreate } from '../../types/client';
import ClientSearchSelect from '../common/ClientSearchSelect';
import AssigneeSelect from './AssigneeSelect';

interface TodoComposerProps {
  onAdd: (payload: TodoCreate) => Promise<unknown>;
  adding: boolean;
  /** Phone size: 16px text so iOS does not zoom in on focus */
  large?: boolean;
}

/**
 * Add a todo at the top of To do: type it, optionally pick a client and who
 * it's for (you, to start with), press Enter
 */
const TodoComposer: React.FC<TodoComposerProps> = ({ onAdd, adding, large }) => {
  const { user } = useAuth();
  const me = user?.id ? [user.id] : [];
  const [title, setTitle] = useState('');
  const [client, setClient] = useState<{ id: string; name: string } | null>(null);
  const [people, setPeople] = useState<string[]>(me);
  // Signed in after this mounted: start with them all the same
  const myId = user?.id;
  useEffect(() => {
    if (myId) setPeople(prev => (prev.length > 0 ? prev : [myId]));
  }, [myId]);
  const inputRef = useRef<InputRef>(null);
  const size = large ? 'large' : 'small';

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || adding || people.length === 0) return;
    try {
      await onAdd({ title: trimmed, client_id: client?.id ?? null, assignee_ids: people });
      setTitle('');
      setClient(null);
      setPeople(me);
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
      <AssigneeSelect
        className="td-composer-people"
        variant="borderless"
        size={size}
        value={people}
        onChange={setPeople}
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
        <Button
          type="primary"
          size={size}
          htmlType="submit"
          loading={adding}
          disabled={!title.trim() || people.length === 0}
        >
          Add
        </Button>
      </div>
    </form>
  );
};

export default TodoComposer;
