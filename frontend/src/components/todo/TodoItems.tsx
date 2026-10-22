/**
 * One todo on the board: a card in a column on desktop (dragged anywhere on
 * it, opened in place to edit), a row in the list on phones (dragged by its
 * handle, opened in a sheet). Both lead with the status circle.
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, Popconfirm } from 'antd';
import { DeleteOutlined, HolderOutlined, UserOutlined } from '@ant-design/icons';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Todo, TodoStatus, TodoUpdate } from '../../types/client';
import ClientSearchSelect from '../common/ClientSearchSelect';
import { TodoStatusButton, TodoStatusIcon } from './todoUi';

interface TodoItemProps {
  todo: Todo;
  onStatus: (todo: Todo, next: TodoStatus) => void;
  onOpen: (todo: Todo) => void;
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** The client (a link to its page) and the claim the todo is tied to */
export const TodoMeta: React.FC<{ todo: Todo }> = ({ todo }) => {
  if (!todo.client_name && !todo.claim_number) return null;
  return (
    <div className="td-meta">
      {todo.client_id && todo.client_name && (
        <Link
          to={`/clients/${todo.client_id}`}
          className="td-client-link"
          onClick={stop}
          onMouseDown={stop}
          onTouchStart={stop}
        >
          {todo.client_name}
        </Link>
      )}
      {todo.claim_number && <span>#{todo.claim_number}</span>}
    </div>
  );
};

const itemClass = (base: string, todo: Todo, extra?: string) =>
  [base, todo.status === 'done' && 'is-done', extra].filter(Boolean).join(' ');

/** Desktop card; the whole card drags, a click or Enter opens it */
export const SortableTodoCard: React.FC<TodoItemProps & { editor?: React.ReactNode }> = ({
  todo, onStatus, onOpen, editor,
}) => {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: todo.id, disabled: !!editor });
  const style = { transform: CSS.Translate.toString(transform), transition };

  if (editor) {
    return <div ref={setNodeRef} style={style}>{editor}</div>;
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={itemClass('td-card', todo, isDragging ? 'is-placeholder' : undefined)}
      {...attributes}
      {...listeners}
      aria-label={todo.title}
      onClick={() => onOpen(todo)}
      onKeyDown={e => {
        listeners?.onKeyDown?.(e);
        if (e.key === 'Enter') {
          e.preventDefault();
          onOpen(todo);
        }
      }}
    >
      <TodoStatusButton status={todo.status} title={todo.title} onChange={next => onStatus(todo, next)} />
      <div className="td-card-body">
        <div className="td-title">{todo.title}</div>
        <TodoMeta todo={todo} />
      </div>
    </div>
  );
};

/** The card under the pointer while it is dragged */
export const TodoCardOverlay: React.FC<{ todo: Todo }> = ({ todo }) => (
  <div className={itemClass('td-card', todo, 'is-overlay')}>
    <span className="td-status" aria-hidden="true"><TodoStatusIcon status={todo.status} /></span>
    <div className="td-card-body">
      <div className="td-title">{todo.title}</div>
      <TodoMeta todo={todo} />
    </div>
  </div>
);

/** Phone row; the handle drags, so the rest of the row scrolls the page as usual */
export const SortableTodoRow: React.FC<TodoItemProps> = ({ todo, onStatus, onOpen }) => {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id: todo.id });
  const style = { transform: CSS.Translate.toString(transform), transition };
  return (
    <li ref={setNodeRef} style={style} className={itemClass('td-row', todo, isDragging ? 'is-placeholder' : undefined)}>
      <TodoStatusButton status={todo.status} title={todo.title} onChange={next => onStatus(todo, next)} />
      <div
        className="td-row-body"
        role="button"
        tabIndex={0}
        onClick={() => onOpen(todo)}
        onKeyDown={e => {
          if (e.key === 'Enter') onOpen(todo);
        }}
      >
        <div className="td-title">{todo.title}</div>
        <TodoMeta todo={todo} />
      </div>
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="td-handle"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${todo.title}`}
      >
        <HolderOutlined />
      </button>
    </li>
  );
};

export const TodoRowOverlay: React.FC<{ todo: Todo }> = ({ todo }) => (
  <div className={itemClass('td-row', todo, 'is-overlay')}>
    <span className="td-status" aria-hidden="true"><TodoStatusIcon status={todo.status} /></span>
    <div className="td-row-body">
      <div className="td-title">{todo.title}</div>
      <TodoMeta todo={todo} />
    </div>
    <span className="td-handle" aria-hidden="true"><HolderOutlined /></span>
  </div>
);

interface TodoInlineEditorProps {
  todo: Todo;
  onSave: (payload: TodoUpdate, clientName: string | null) => void;
  onDelete: () => void;
  onClose: () => void;
}

/** A desktop card opened in place: the title, the client, Delete / Cancel / Save */
export const TodoInlineEditor: React.FC<TodoInlineEditorProps> = ({ todo, onSave, onDelete, onClose }) => {
  const [title, setTitle] = useState(todo.title);
  const [client, setClient] = useState<{ id: string | null; name: string | null }>({
    id: todo.client_id ?? null,
    name: todo.client_name ?? null,
  });

  const save = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const payload: TodoUpdate = {};
    if (trimmed !== todo.title) payload.title = trimmed;
    if (client.id !== (todo.client_id ?? null)) payload.client_id = client.id;
    if (Object.keys(payload).length > 0) onSave(payload, client.name);
    onClose();
  };

  return (
    <div
      className={itemClass('td-card', todo, 'is-editing')}
      onKeyDown={e => {
        // Escape inside the client picker only closes its menu
        if (e.key === 'Escape' && !(e.target as HTMLElement).closest('.ant-select')) onClose();
      }}
    >
      <Input.TextArea
        className="td-editor-title"
        variant="borderless"
        autoFocus
        autoSize={{ minRows: 1, maxRows: 8 }}
        maxLength={500}
        value={title}
        aria-label="Todo"
        onChange={e => setTitle(e.target.value)}
        onFocus={e => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
        onPressEnter={e => {
          if (!e.shiftKey) {
            e.preventDefault();
            save();
          }
        }}
      />
      <ClientSearchSelect
        className="td-editor-client"
        variant="borderless"
        size="small"
        prefix={<UserOutlined />}
        placeholder="No client"
        aria-label="Client"
        value={client.id}
        selectedLabel={client.name}
        onChange={(id, picked) => setClient({ id: id ?? null, name: picked?.display_name ?? null })}
      />
      {todo.claim_number && client.id === (todo.client_id ?? null) && (
        <div className="td-meta">Claim #{todo.claim_number}</div>
      )}
      <div className="td-editor-actions">
        <Popconfirm
          title="Delete this todo?"
          okText="Delete"
          okButtonProps={{ danger: true }}
          cancelText="Cancel"
          onConfirm={onDelete}
        >
          <Button
            type="text"
            size="small"
            className="ui-icon-btn ui-icon-btn--danger"
            icon={<DeleteOutlined />}
            aria-label="Delete todo"
          />
        </Popconfirm>
        <span className="td-editor-actions-end">
          <Button size="small" onClick={onClose}>Cancel</Button>
          <Button type="primary" size="small" onClick={save} disabled={!title.trim()}>Save</Button>
        </span>
      </div>
    </div>
  );
};
