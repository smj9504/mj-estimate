import React, { useEffect, useRef, useState } from 'react';
import { Button, Form, Input, Modal, Popconfirm, Segmented } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { DeleteOutlined } from '@ant-design/icons';
import type { Todo, TodoStatus } from '../../types/client';
import { useAuth } from '../../contexts/AuthContext';
import ClientSearchSelect from '../common/ClientSearchSelect';
import { useSheetModal } from '../common/ui';
import AssigneeSelect from './AssigneeSelect';
import { TODO_STATUSES, TODO_STATUS_LABELS } from './todoUi';

export interface TodoSheetValues {
  title: string;
  client_id: string | null;
  client_name: string | null;
  status: TodoStatus;
  /** Who a new todo is for */
  assignee_ids: string[];
}

interface TodoSheetProps {
  open: boolean;
  /** Edit this todo; without one the sheet adds a new todo */
  todo?: Todo | null;
  /** Client to start a new todo with, e.g. the client page the person is on */
  presetClient?: { id: string; name: string | null } | null;
  saving?: boolean;
  onSubmit: (values: TodoSheetValues) => void;
  onDelete?: () => void;
  onClose: () => void;
}

/** Add or edit a todo in a phone sheet: title, client, who a new one is for (you, to start with), and (when editing) its column */
const TodoSheet: React.FC<TodoSheetProps> = ({
  open, todo, presetClient, saving, onSubmit, onDelete, onClose,
}) => {
  const { sheetProps } = useSheetModal();
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [people, setPeople] = useState<string[]>([]);
  const [peopleError, setPeopleError] = useState(false);
  // The client is kept here rather than in the form so its name can show before a search
  const [client, setClient] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
  const titleRef = useRef<TextAreaRef>(null);

  // The form stays mounted (forceRender), so each opening starts it over
  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({ title: todo?.title ?? '', status: todo?.status ?? 'todo' });
    setClient(todo
      ? { id: todo.client_id ?? null, name: todo.client_name ?? null }
      : { id: presetClient?.id ?? null, name: presetClient?.name ?? null });
    setPeople(user?.id ? [user.id] : []);
    setPeopleError(false);
  }, [open, todo, presetClient, form, user?.id]);

  const submit = () => form.validateFields().then(values => {
    if (!todo && people.length === 0) {
      setPeopleError(true);
      return;
    }
    onSubmit({
      title: values.title.trim(),
      client_id: client.id,
      client_name: client.name,
      status: values.status ?? 'todo',
      assignee_ids: people,
    });
  });

  return (
    <Modal
      title={todo ? 'Edit todo' : 'New todo'}
      open={open}
      onCancel={onClose}
      forceRender
      afterOpenChange={visible => {
        if (visible && !todo) titleRef.current?.focus();
      }}
      width={440}
      {...sheetProps}
      footer={[
        ...(todo && onDelete ? [(
          <Popconfirm
            key="delete"
            title="Delete this todo?"
            okText="Delete"
            okButtonProps={{ danger: true }}
            cancelText="Cancel"
            onConfirm={onDelete}
          >
            <Button
              className="ui-icon-btn ui-icon-btn--danger td-sheet-delete"
              type="text"
              icon={<DeleteOutlined />}
              aria-label="Delete todo"
            />
          </Popconfirm>
        )] : []),
        <Button key="cancel" onClick={onClose}>Cancel</Button>,
        <Button key="save" type="primary" loading={saving} onClick={submit}>
          {todo ? 'Save' : 'Add'}
        </Button>,
      ]}
    >
      <Form form={form} layout="vertical" size="large" requiredMark={false} onFinish={submit}>
        <Form.Item
          name="title"
          label="Todo"
          rules={[{ required: true, whitespace: true, message: 'Write what needs doing' }]}
        >
          <Input.TextArea
            ref={titleRef}
            autoSize={{ minRows: 1, maxRows: 6 }}
            maxLength={500}
            placeholder="What needs doing?"
            enterKeyHint="done"
            onPressEnter={e => {
              if (!e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </Form.Item>
        <Form.Item label="Client">
          <ClientSearchSelect
            placeholder="No client"
            aria-label="Client"
            value={client.id}
            selectedLabel={client.name}
            onChange={(id, picked) => setClient({ id: id ?? null, name: picked?.display_name ?? null })}
          />
        </Form.Item>
        {!todo && (
          <Form.Item
            label="For"
            validateStatus={peopleError ? 'error' : undefined}
            help={peopleError ? 'Pick who the todo is for' : undefined}
          >
            <AssigneeSelect
              className="td-sheet-people"
              value={people}
              onChange={ids => {
                setPeople(ids);
                if (ids.length > 0) setPeopleError(false);
              }}
            />
          </Form.Item>
        )}
        {todo?.claim_number && client.id === (todo.client_id ?? null) && (
          <div className="td-sheet-claim">Claim #{todo.claim_number}</div>
        )}
        {todo ? (
          <Form.Item name="status" label="Status">
            <Segmented
              block
              className="td-sheet-status"
              options={TODO_STATUSES.map(s => ({ value: s, label: TODO_STATUS_LABELS[s] }))}
            />
          </Form.Item>
        ) : (
          <Form.Item name="status" hidden><Input /></Form.Item>
        )}
      </Form>
    </Modal>
  );
};

export default TodoSheet;
