import React, { useState } from 'react';
import {
  List, Input, Button, Space, Tag, Checkbox, Typography, Popconfirm,
  message, Empty, Select, DatePicker, Form, Tooltip,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EditOutlined,
  SaveOutlined, CloseOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { claimTodoService } from '../../services/clientService';
import type { ClaimTodo, ClaimTodoCreate, TodoPriority } from '../../types/client';
import { TODO_PRIORITY_COLORS } from '../../types/client';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const { Text } = Typography;

interface ClaimTodosProps {
  clientId: string;
  claimId: string;
}

const PRIORITY_OPTIONS: { value: TodoPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const ClaimTodos: React.FC<ClaimTodosProps> = ({ clientId, claimId }) => {
  const queryClient = useQueryClient();
  const queryKey = ['claim-todos', claimId];

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [showCompleted, setShowCompleted] = useState(true);

  const { data: todos = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => claimTodoService.list(clientId, claimId),
  });

  const createMutation = useMutation({
    mutationFn: (payload: ClaimTodoCreate) =>
      claimTodoService.create(clientId, claimId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      // Also refresh dashboard todos
      queryClient.invalidateQueries({ queryKey: ['active-todos'] });
      form.resetFields();
      setShowForm(false);
      message.success('Todo added');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ todoId, payload }: { todoId: string; payload: Partial<ClaimTodo> }) =>
      claimTodoService.update(clientId, claimId, todoId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['active-todos'] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (todoId: string) => claimTodoService.delete(clientId, claimId, todoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['active-todos'] });
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

  const handleToggleComplete = (todo: ClaimTodo) => {
    updateMutation.mutate({
      todoId: todo.id,
      payload: { is_completed: !todo.is_completed },
    });
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

  const activeTodos = todos.filter((t) => !t.is_completed);
  const completedTodos = todos.filter((t) => t.is_completed);
  const displayTodos = showCompleted ? todos : activeTodos;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Space>
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setShowForm(!showForm)}
          >
            Add Todo
          </Button>
          {completedTodos.length > 0 && (
            <Button
              type="link"
              size="small"
              onClick={() => setShowCompleted(!showCompleted)}
            >
              {showCompleted ? 'Hide completed' : `Show completed (${completedTodos.length})`}
            </Button>
          )}
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {activeTodos.length} active{completedTodos.length > 0 ? `, ${completedTodos.length} done` : ''}
        </Text>
      </div>

      {/* Add form */}
      {showForm && (
        <div style={{ background: '#fafafa', padding: 12, borderRadius: 6, marginBottom: 12 }}>
          <Form form={form} onFinish={handleCreate} layout="vertical" size="small">
            <Form.Item name="title" rules={[{ required: true, message: 'Title required' }]}>
              <Input placeholder="What needs to be done?" autoFocus />
            </Form.Item>
            <Form.Item name="description">
              <Input.TextArea rows={1} placeholder="Description (optional)" />
            </Form.Item>
            <Space>
              <Form.Item name="priority" initialValue="normal" noStyle>
                <Select options={PRIORITY_OPTIONS} style={{ width: 100 }} />
              </Form.Item>
              <Form.Item name="due_date" noStyle>
                <DatePicker placeholder="Due date" />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={createMutation.isPending}>
                Add
              </Button>
              <Button onClick={() => { setShowForm(false); form.resetFields(); }}>
                Cancel
              </Button>
            </Space>
          </Form>
        </div>
      )}

      {/* Todo list */}
      <List
        loading={isLoading}
        dataSource={displayTodos}
        locale={{ emptyText: <Empty description="No todos yet" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        renderItem={(todo: ClaimTodo) => {
          const isOverdue = todo.due_date && !todo.is_completed && dayjs(todo.due_date).isBefore(dayjs(), 'day');

          if (editingId === todo.id) {
            return (
              <List.Item style={{ padding: '8px 0' }}>
                <div style={{ width: '100%', background: '#fafafa', padding: 12, borderRadius: 6 }}>
                  <Form
                    form={editForm}
                    layout="vertical"
                    size="small"
                    initialValues={{
                      title: todo.title,
                      description: todo.description,
                      priority: todo.priority,
                      due_date: todo.due_date ? dayjs(todo.due_date) : null,
                    }}
                  >
                    <Form.Item name="title" rules={[{ required: true }]}>
                      <Input autoFocus />
                    </Form.Item>
                    <Form.Item name="description">
                      <Input.TextArea rows={1} />
                    </Form.Item>
                    <Space>
                      <Form.Item name="priority" noStyle>
                        <Select options={PRIORITY_OPTIONS} style={{ width: 100 }} />
                      </Form.Item>
                      <Form.Item name="due_date" noStyle>
                        <DatePicker />
                      </Form.Item>
                      <Button type="primary" icon={<SaveOutlined />} onClick={handleSaveEdit}>
                        Save
                      </Button>
                      <Button icon={<CloseOutlined />} onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </Space>
                  </Form>
                </div>
              </List.Item>
            );
          }

          return (
            <List.Item
              style={{
                padding: '6px 0',
                opacity: todo.is_completed ? 0.5 : 1,
              }}
              actions={[
                <Button
                  key="edit"
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => setEditingId(todo.id)}
                />,
                <Popconfirm
                  key="delete"
                  title="Delete this todo?"
                  onConfirm={() => deleteMutation.mutate(todo.id)}
                  okText="Yes"
                  cancelText="No"
                >
                  <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>,
              ]}
            >
              <Space align="start">
                <Checkbox
                  checked={todo.is_completed}
                  onChange={() => handleToggleComplete(todo)}
                />
                <div>
                  <div style={{ textDecoration: todo.is_completed ? 'line-through' : undefined }}>
                    <Text strong={!todo.is_completed}>{todo.title}</Text>
                  </div>
                  {todo.description && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {todo.description}
                    </Text>
                  )}
                  <div>
                    <Space size={4} style={{ marginTop: 2 }}>
                      <Tag color={TODO_PRIORITY_COLORS[todo.priority]} style={{ fontSize: 11 }}>
                        {todo.priority}
                      </Tag>
                      {todo.due_date && (
                        <Tooltip title={dayjs(todo.due_date).format('YYYY-MM-DD')}>
                          <Tag color={isOverdue ? 'red' : undefined} style={{ fontSize: 11 }}>
                            {isOverdue ? 'Overdue: ' : 'Due: '}
                            {dayjs(todo.due_date).format('MM/DD')}
                          </Tag>
                        </Tooltip>
                      )}
                      {todo.completed_at && (
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          Done {dayjs(todo.completed_at).fromNow()}
                        </Text>
                      )}
                    </Space>
                  </div>
                </div>
              </Space>
            </List.Item>
          );
        }}
      />
    </div>
  );
};

export default ClaimTodos;
