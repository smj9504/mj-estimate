import React, { useState } from 'react';
import {
  Input, Button, Popconfirm, message, Select, DatePicker, Form, Tooltip, Spin,
} from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CLIENT_TODOS_KEY, TODO_BOARD_KEY, todoService } from '../../services/todoService';
import { useAuth } from '../../contexts/AuthContext';
import type { ClaimTodoCreate, Todo, TodoPriority, TodoUpdate } from '../../types/client';
import { Pill, humanize, type TagTone } from '../common/ui';
import { TodoStatusButton } from '../todo/todoUi';
import { assignedTo } from '../todo/todoPeople';
import ClaimSection from './ClaimSection';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

// Normal and low priority stay plain; only the ones that need attention get a tone
const PRIORITY_TONES: Partial<Record<TodoPriority, TagTone>> = {
  high: 'orange',
  urgent: 'red',
};

interface ClaimTodosProps {
  clientId: string;
  /** Without a claim (a client with none yet) it lists the client's todos */
  claimId?: string;
}

const PRIORITY_OPTIONS: { value: TodoPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

/**
 * A claim's todos and the client's todos that are not tied to a claim, from
 * everyone. They are the same todos as on each person's board, so the board
 * refreshes after a change here.
 */
const ClaimTodos: React.FC<ClaimTodosProps> = ({ clientId, claimId }) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const queryKey = [CLIENT_TODOS_KEY, clientId, claimId ?? 'client'];
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [CLIENT_TODOS_KEY] });
    queryClient.invalidateQueries({ queryKey: TODO_BOARD_KEY });
  };

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [showCompleted, setShowCompleted] = useState(true);

  const { data: todos = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => todoService.list({ client_id: clientId, claim_id: claimId }),
  });

  const createMutation = useMutation({
    mutationFn: (payload: ClaimTodoCreate) =>
      todoService.create({ ...payload, client_id: clientId, claim_id: claimId ?? null }),
    onSuccess: () => {
      refresh();
      form.resetFields();
      setShowForm(false);
      message.success('Todo added');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ todoId, payload }: { todoId: string; payload: TodoUpdate }) =>
      todoService.update(todoId, payload),
    onSuccess: () => {
      refresh();
      setEditingId(null);
    },
    onError: () => message.error("Couldn't save the todo. Try again."),
  });

  const deleteMutation = useMutation({
    mutationFn: (todoId: string) => todoService.remove(todoId),
    onSuccess: () => {
      refresh();
      message.success('Todo deleted');
    },
  });

  const handleCreate = (values: any) => {
    const payload: ClaimTodoCreate = {
      title: values.title,
      description: values.description || undefined,
      priority: values.priority || 'normal',
      due_date: values.due_date ? values.due_date.toISOString() : undefined,
    };
    createMutation.mutate(payload);
  };

  const handleStatus = (todo: Todo, status: Todo['status']) => {
    updateMutation.mutate({ todoId: todo.id, payload: { status } });
  };

  const handleSaveEdit = () => {
    if (!editingId) return;
    editForm.validateFields().then((values) => {
      updateMutation.mutate({
        todoId: editingId,
        payload: {
          title: values.title,
          description: values.description || undefined,
          priority: values.priority,
          due_date: values.due_date ? values.due_date.toISOString() : undefined,
        },
      });
    });
  };

  const activeTodos = todos.filter((t) => t.status !== 'done');
  const completedTodos = todos.filter((t) => t.status === 'done');
  const displayTodos = showCompleted ? todos : activeTodos;

  // Fields shared by the add and edit forms; rendered inside each <Form>
  const renderForm = (onCancel: () => void, submitLabel: string, loading: boolean) => (
    <div className="cl-inline-form">
      <Form.Item name="title" rules={[{ required: true, message: 'Title required' }]}>
        <Input placeholder="What needs to be done?" autoFocus />
      </Form.Item>
      <Form.Item name="description">
        <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} placeholder="Description (optional)" />
      </Form.Item>
      <div className="cl-inline-form-row">
        <Form.Item name="priority" noStyle>
          <Select options={PRIORITY_OPTIONS} style={{ width: 104 }} aria-label="Priority" />
        </Form.Item>
        <Form.Item name="due_date" noStyle>
          <DatePicker placeholder="Due date" format="MM/DD/YYYY" style={{ width: 136 }} />
        </Form.Item>
        <span className="cl-inline-form-actions">
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="primary" htmlType="submit" loading={loading}>
            {submitLabel}
          </Button>
        </span>
      </div>
    </div>
  );

  return (
    <ClaimSection
      title="Todos"
      count={activeTodos.length || undefined}
      actions={(
        <>
          {completedTodos.length > 0 && (
            <Button type="text" size="small" onClick={() => setShowCompleted(!showCompleted)}>
              {showCompleted ? 'Hide completed' : `Show completed (${completedTodos.length})`}
            </Button>
          )}
          <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => setShowForm(!showForm)}>
            Add Todo
          </Button>
        </>
      )}
    >
      {showForm && (
        <Form form={form} onFinish={handleCreate} layout="vertical" size="small" initialValues={{ priority: 'normal' }}>
          {renderForm(() => { setShowForm(false); form.resetFields(); }, 'Add', createMutation.isPending)}
        </Form>
      )}

      {isLoading ? (
        <Spin size="small" />
      ) : displayTodos.length === 0 ? (
        !showForm && <div className="cl-empty">No todos yet.</div>
      ) : (
        <ul className="cl-list">
          {displayTodos.map((todo: Todo) => {
            const isOverdue = todo.due_date && !todo.is_completed && dayjs(todo.due_date).isBefore(dayjs(), 'day');

            if (editingId === todo.id) {
              return (
                <li key={todo.id} className="cl-list-item cl-list-item--form">
                  <Form
                    form={editForm}
                    layout="vertical"
                    size="small"
                    onFinish={handleSaveEdit}
                    initialValues={{
                      title: todo.title,
                      description: todo.description,
                      priority: todo.priority,
                      due_date: todo.due_date ? dayjs(todo.due_date) : null,
                    }}
                  >
                    {renderForm(() => setEditingId(null), 'Save', updateMutation.isPending)}
                  </Form>
                </li>
              );
            }

            const assigned = assignedTo(todo, user?.id);
            const meta = [
              // A shared or someone else's todo says who it's assigned to; a client todo shows on every claim
              assigned && `Assigned to ${assigned}`,
              claimId && !todo.claim_id && 'All claims',
              todo.status === 'in_progress' && 'In progress',
              todo.due_date && !todo.is_completed && !isOverdue && `Due ${dayjs(todo.due_date).format('MM/DD')}`,
              todo.completed_at && `Done ${dayjs(todo.completed_at).fromNow()}`,
            ].filter(Boolean);

            return (
              <li key={todo.id} className={`cl-list-item cl-todo${todo.is_completed ? ' is-done' : ''}`}>
                <TodoStatusButton
                  status={todo.status}
                  title={todo.title}
                  onChange={(next) => handleStatus(todo, next)}
                />
                <div className="cl-list-body">
                  <div className="cl-list-title">
                    <span className="cl-todo-title">{todo.title}</span>
                    {!todo.is_completed && PRIORITY_TONES[todo.priority] && (
                      <Pill tone={PRIORITY_TONES[todo.priority]!}>{humanize(todo.priority)}</Pill>
                    )}
                    {isOverdue && (
                      <Tooltip title={dayjs(todo.due_date).format('MM/DD/YYYY')}>
                        <span><Pill tone="red">Overdue {dayjs(todo.due_date).format('MM/DD')}</Pill></span>
                      </Tooltip>
                    )}
                  </div>
                  {todo.description && <div className="cl-meta">{todo.description}</div>}
                  {meta.length > 0 && <div className="cl-meta">{meta.join(' · ')}</div>}
                </div>
                <div className="cl-row-actions">
                  <Button
                    type="text"
                    size="small"
                    className="ui-icon-btn cl-touch-icon"
                    aria-label="Edit todo"
                    icon={<EditOutlined />}
                    onClick={() => setEditingId(todo.id)}
                  />
                  <Popconfirm
                    title="Delete this todo?"
                    onConfirm={() => deleteMutation.mutate(todo.id)}
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                    cancelText="Cancel"
                  >
                    <Button
                      type="text"
                      size="small"
                      className="ui-icon-btn ui-icon-btn--danger cl-touch-icon"
                      aria-label="Delete todo"
                      icon={<DeleteOutlined />}
                    />
                  </Popconfirm>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ClaimSection>
  );
};

export default ClaimTodos;
