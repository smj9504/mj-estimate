/**
 * Todo board API: each person's todos, with or without a client, in three
 * columns (To do, In progress, Done) in drag order. Claim todos are the same records.
 */

import api from './api';
import type { Todo, TodoCreate, TodoStatus, TodoUpdate } from '../types/client';

/** react-query key for the signed-in person's board */
export const TODO_BOARD_KEY = ['todo-board'];
/** react-query key prefix for the todo lists on client pages */
export const CLIENT_TODOS_KEY = 'client-todos';

export const todoService = {
  /** Your board; with a client, everyone's todos for that client; with a claim too, the claim's and the client's general ones */
  async list(params?: { client_id?: string; claim_id?: string }) {
    const { data } = await api.get('/api/todos/', { params });
    return data as Todo[];
  },

  async create(payload: TodoCreate) {
    const { data } = await api.post('/api/todos/', payload);
    return data as Todo;
  },

  async update(todoId: string, payload: TodoUpdate) {
    const { data } = await api.patch(`/api/todos/${todoId}`, payload);
    return data as Todo;
  },

  async remove(todoId: string) {
    await api.delete(`/api/todos/${todoId}`);
  },

  /** Save a column's full order after a drop; todos dragged in from another column move to it */
  async reorder(status: TodoStatus, ids: string[]) {
    await api.put('/api/todos/reorder', { status, ids });
  },
};
