/** Board column helpers, kept free of the API so they can be tested on their own */

import type { Todo, TodoStatus } from '../../types/client';

export type TodoColumns = Record<TodoStatus, string[]>;

const byBoardOrder = (a: Todo, b: Todo) =>
  a.sort_order - b.sort_order || (b.created_at ?? '').localeCompare(a.created_at ?? '');

/** Todo ids per column, in drag order */
export const groupColumns = (todos: Todo[]): TodoColumns => {
  const columns: TodoColumns = { todo: [], in_progress: [], done: [] };
  [...todos].sort(byBoardOrder).forEach(t => (columns[t.status] ?? columns.todo).push(t.id));
  return columns;
};

/** The sort_order that puts a todo at the top of a column, as the server does */
export const topOf = (todos: Todo[], status: TodoStatus, exceptId: string) => {
  const orders = todos.filter(t => t.status === status && t.id !== exceptId).map(t => t.sort_order);
  return orders.length ? Math.min(...orders) - 1 : 0;
};
