import React, { useState } from 'react';
import {
  Input, Button, Popconfirm, message, Tooltip, Spin,
} from 'antd';
import {
  PushpinOutlined, PushpinFilled, DeleteOutlined, EditOutlined,
  SaveOutlined, CloseOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { claimNoteService } from '../../services/clientService';
import type { ClaimNote } from '../../types/client';
import ClaimSection from './ClaimSection';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const { TextArea } = Input;

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

  // Pinned notes stay on top, newest first within each group (sort is stable)
  const sorted = [...notes].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));

  return (
    <ClaimSection title="Notes" count={notes.length || undefined}>
      <div className="cl-note-composer">
        <TextArea
          autoSize={{ minRows: 2, maxRows: 8 }}
          placeholder="Add a note..."
          aria-label="New note"
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          onPressEnter={(e) => {
            if (e.ctrlKey || e.metaKey) handleAdd();
          }}
        />
        <div className="cl-note-composer-foot">
          <span className="cl-meta">Ctrl+Enter to save</span>
          <Button
            size="small"
            onClick={handleAdd}
            loading={createMutation.isPending}
            disabled={!newContent.trim()}
          >
            Add Note
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Spin size="small" />
      ) : sorted.length === 0 ? (
        <div className="cl-empty">No notes yet.</div>
      ) : (
        <ul className="cl-list">
          {sorted.map((note: ClaimNote) => (
            <li key={note.id} className="cl-list-item cl-note">
              <div className="cl-list-body">
                {editingId === note.id ? (
                  <TextArea
                    autoSize={{ minRows: 2, maxRows: 8 }}
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    onPressEnter={(e) => {
                      if (e.ctrlKey || e.metaKey) handleSaveEdit();
                    }}
                    aria-label="Edit note"
                    autoFocus
                  />
                ) : (
                  <div className="cl-note-text">{note.content}</div>
                )}
                <div className="cl-meta cl-note-meta">
                  {note.pinned && (
                    <span className="cl-note-pin"><PushpinFilled aria-hidden="true" /> Pinned</span>
                  )}
                  <span>
                    {note.created_at ? dayjs(note.created_at).fromNow() : ''}
                    {note.created_by_name ? ` · ${note.created_by_name}` : ''}
                  </span>
                </div>
              </div>
              <div className="cl-row-actions">
                {editingId === note.id ? (
                  <>
                    <Tooltip title="Save">
                      <Button type="text" size="small" className="ui-icon-btn cl-touch-icon"
                        aria-label="Save note" icon={<SaveOutlined />} onClick={handleSaveEdit} />
                    </Tooltip>
                    <Tooltip title="Cancel">
                      <Button type="text" size="small" className="ui-icon-btn cl-touch-icon"
                        aria-label="Cancel editing" icon={<CloseOutlined />} onClick={() => setEditingId(null)} />
                    </Tooltip>
                  </>
                ) : (
                  <>
                    <Tooltip title={note.pinned ? 'Unpin' : 'Pin'}>
                      <Button type="text" size="small" className="ui-icon-btn cl-touch-icon"
                        aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
                        icon={note.pinned ? <PushpinFilled /> : <PushpinOutlined />}
                        onClick={() => handleTogglePin(note)} />
                    </Tooltip>
                    <Tooltip title="Edit">
                      <Button type="text" size="small" className="ui-icon-btn cl-touch-icon"
                        aria-label="Edit note" icon={<EditOutlined />}
                        onClick={() => {
                          setEditingId(note.id);
                          setEditContent(note.content);
                        }} />
                    </Tooltip>
                    <Popconfirm
                      title="Delete this note?"
                      onConfirm={() => deleteMutation.mutate(note.id)}
                      okText="Delete"
                      okButtonProps={{ danger: true }}
                      cancelText="Cancel"
                    >
                      <Button type="text" size="small" className="ui-icon-btn ui-icon-btn--danger cl-touch-icon"
                        aria-label="Delete note" icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </ClaimSection>
  );
};

export default ClaimNotes;
