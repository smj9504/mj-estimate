import { describe, expect, it } from 'vitest';
import type { Todo } from '../../types/client';
import { groupColumns, topOf } from './todoColumns';
import { nextTodoStatus } from './todoUi';

const todo = (id: string, status: Todo['status'], sort_order: number, created_at = '2026-10-01'): Todo => ({
  id, status, sort_order, created_at,
  title: id, claim_id: null, priority: 'normal', is_completed: status === 'done',
});

describe('groupColumns', () => {
  it('puts each todo in its column in drag order', () => {
    const columns = groupColumns([
      todo('b', 'todo', 1),
      todo('done', 'done', 0),
      todo('a', 'todo', -1),
      todo('started', 'in_progress', 0),
    ]);
    expect(columns).toEqual({ todo: ['a', 'b'], in_progress: ['started'], done: ['done'] });
  });

  it('breaks a tie with the newest first, as the server does', () => {
    const columns = groupColumns([
      todo('older', 'todo', 0, '2026-10-01'),
      todo('newer', 'todo', 0, '2026-10-02'),
    ]);
    expect(columns.todo).toEqual(['newer', 'older']);
  });
});

describe('topOf', () => {
  it('goes above the highest todo in the column, leaving the moved one out', () => {
    const todos = [todo('a', 'todo', 0), todo('b', 'todo', 3), todo('moving', 'todo', -2), todo('c', 'done', -5)];
    expect(topOf(todos, 'todo', 'moving')).toBe(-1);
    expect(topOf(todos, 'in_progress', 'moving')).toBe(0);
  });
});

describe('nextTodoStatus', () => {
  it('steps To do, In progress, Done, then back to To do', () => {
    expect(nextTodoStatus('todo')).toBe('in_progress');
    expect(nextTodoStatus('in_progress')).toBe('done');
    expect(nextTodoStatus('done')).toBe('todo');
  });
});
