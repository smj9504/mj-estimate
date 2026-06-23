import React, { useState } from 'react';
import {
  List, Input, Button, Space, Typography, Popconfirm, message, Empty, Tooltip,
} from 'antd';
import {
  PushpinOutlined, PushpinFilled, DeleteOutlined, EditOutlined,
  SaveOutlined, CloseOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { claimNoteService } from '../../services/clientService';
import type { ClaimNote } from '../../types/client';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const { TextArea } = Input;
const { Text } = Typography;

interface ClaimNotesProps {
  clientId: string;
  claimId: string;
}

const ClaimNotes: React.FC<ClaimNotesProps> = ({ clientId, claimId }) => {
  const queryClient = useQueryClient();
  const queryKey = ['claim-notes', claimId];

  const [newContent, setNewContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const { data: notes = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => claimNoteService.list(clientId, claimId),
  });

  const createMutation = useMutation({
    mutationFn: (content: string) =>
      claimNoteService.create(clientId, claimId, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setNewContent('');
      message.success('Note added');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ noteId, payload }: { noteId: string; payload: Partial<ClaimNote> }) =>
      claimNoteService.update(clientId, claimId, noteId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (noteId: string) => claimNoteService.delete(clientId, claimId, noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      message.success('Note deleted');
    },
  });

  const handleAdd = () => {
    const trimmed = newContent.trim();
    if (!trimmed) return;
    createMutation.mutate(trimmed);
  };

  const handleSaveEdit = () => {
    if (!editingId || !editContent.trim()) return;
    updateMutation.mutate({ noteId: editingId, payload: { content: editContent.trim() } });
  };

  const handleTogglePin = (note: ClaimNote) => {
    updateMutation.mutate({ noteId: note.id, payload: { pinned: !note.pinned } });
  };

  return (
    <div>
      {/* Add note */}
      <div style={{ marginBottom: 12 }}>
        <TextArea
          rows={2}
          placeholder="Add a note..."
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          onPressEnter={(e) => {
            if (e.ctrlKey || e.metaKey) handleAdd();
          }}
          style={{ marginBottom: 8 }}
        />
        <Button
          type="primary"
          size="small"
          onClick={handleAdd}
          loading={createMutation.isPending}
          disabled={!newContent.trim()}
        >
          Add Note
        </Button>
        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
          Ctrl+Enter to save
        </Text>
      </div>

      {/* Notes list */}
      <List
        loading={isLoading}
        dataSource={notes}
        locale={{ emptyText: <Empty description="No notes yet" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        renderItem={(note: ClaimNote) => (
          <List.Item
            style={{
              padding: '8px 0',
              borderLeft: note.pinned ? '3px solid #1890ff' : undefined,
              paddingLeft: note.pinned ? 8 : 0,
            }}
            actions={
              editingId === note.id
                ? [
                    <Button
                      key="save"
                      type="link"
                      size="small"
                      icon={<SaveOutlined />}
                      onClick={handleSaveEdit}
                    />,
                    <Button
                      key="cancel"
                      type="link"
                      size="small"
                      icon={<CloseOutlined />}
                      onClick={() => setEditingId(null)}
                    />,
                  ]
                : [
                    <Tooltip key="pin" title={note.pinned ? 'Unpin' : 'Pin'}>
                      <Button
                        type="link"
                        size="small"
                        icon={note.pinned ? <PushpinFilled style={{ color: '#1890ff' }} /> : <PushpinOutlined />}
                        onClick={() => handleTogglePin(note)}
                      />
                    </Tooltip>,
                    <Button
                      key="edit"
                      type="link"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => {
                        setEditingId(note.id);
                        setEditContent(note.content);
                      }}
                    />,
                    <Popconfirm
                      key="delete"
                      title="Delete this note?"
                      onConfirm={() => deleteMutation.mutate(note.id)}
                      okText="Yes"
                      cancelText="No"
                    >
                      <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>,
                  ]
            }
          >
            <List.Item.Meta
              description={
                editingId === note.id ? (
                  <TextArea
                    rows={2}
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    autoFocus
                  />
                ) : (
                  <div>
                    <div style={{ whiteSpace: 'pre-wrap', color: 'rgba(0,0,0,0.85)' }}>
                      {note.content}
                    </div>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {note.created_at ? dayjs(note.created_at).fromNow() : ''}
                      {note.created_by_name ? ` by ${note.created_by_name}` : ''}
                    </Text>
                  </div>
                )
              }
            />
          </List.Item>
        )}
      />
    </div>
  );
};

export default ClaimNotes;
