/**
 * Messages between staff: one-to-one and group conversations.
 * There is no push; the header and the open conversation check on a timer.
 */

import api from './api';
import type { DocumentTransfer } from './documentTransferService';

export interface Person {
  id: string;
  name: string;
  role: string | null;
  job_title: string | null;
}

export type MessageKind = 'text' | 'document_transfer' | 'transfer_reply' | 'notice';

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  sender_name: string | null;
  kind: MessageKind;
  body: string;
  related_type: string | null;
  related_id: string | null;
  created_at: string;
  /** The offered document's current state, on document_transfer messages */
  transfer?: DocumentTransfer | null;
}

export interface Conversation {
  id: string;
  title: string | null;
  is_group: boolean;
  /** The group's name, or the other person's name */
  display_name: string;
  participants: { id: string; name: string }[];
  last_message: ChatMessage | null;
  last_message_at: string | null;
  created_at: string | null;
  unread_count: number;
}

export const messageService = {
  async people(): Promise<Person[]> {
    const { data } = await api.get('/api/messages/people');
    return data;
  },

  async unreadCount(): Promise<number> {
    const { data } = await api.get('/api/messages/unread-count', { suppressErrorNotification: true });
    return data.unread;
  },

  async conversations(): Promise<Conversation[]> {
    const { data } = await api.get('/api/messages/conversations', { suppressErrorNotification: true });
    return data;
  },

  async conversation(id: string): Promise<Conversation> {
    const { data } = await api.get(`/api/messages/conversations/${id}`);
    return data;
  },

  /** One person and no name reuses your one-to-one conversation with them */
  async start(participantIds: string[], title?: string): Promise<Conversation> {
    const { data } = await api.post('/api/messages/conversations', {
      participant_ids: participantIds,
      title: title || null,
    });
    return data;
  },

  async rename(id: string, title: string): Promise<Conversation> {
    const { data } = await api.patch(`/api/messages/conversations/${id}`, { title });
    return data;
  },

  async addPeople(id: string, staffIds: string[]): Promise<Conversation> {
    const { data } = await api.post(`/api/messages/conversations/${id}/participants`, { staff_ids: staffIds });
    return data;
  },

  async leave(id: string): Promise<void> {
    await api.delete(`/api/messages/conversations/${id}/participants/me`);
  },

  async messages(id: string, options: { before?: string; after?: string } = {}): Promise<ChatMessage[]> {
    const { data } = await api.get(`/api/messages/conversations/${id}/messages`, {
      params: options,
      suppressErrorNotification: true,
    });
    return data;
  },

  async send(id: string, body: string): Promise<ChatMessage> {
    const { data } = await api.post(`/api/messages/conversations/${id}/messages`, { body });
    return data;
  },

  async markRead(id: string): Promise<number> {
    const { data } = await api.post(`/api/messages/conversations/${id}/read`, undefined, {
      suppressErrorNotification: true,
    });
    return data.unread;
  },
};
