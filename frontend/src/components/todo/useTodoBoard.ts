/**
 * The signed-in person's todo board: the list, and changes written into the
 * cache before the server answers so cards move the moment they are dropped
 * or tapped. Client pages list the same todos, so they refresh after each change.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { message } from 'antd';
import { CLIENT_TODOS_KEY, TODO_BOARD_KEY, todoService } from '../../services/todoService';
import type { Todo, TodoCreate, TodoStatus, TodoUpdate } from '../../types/client';
import { topOf } from './todoColumns';


interface UpdateVars {
  id: string;
  payload: TodoUpdate;
  /** Name for a newly picked client, shown before the server answers */
  clientName?: string | null;
}

export const useTodoBoard = () => {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: TODO_BOARD_KEY, queryFn: () => todoService.list() });

  const patch = (fn: (todos: Todo[]) => Todo[]) =>
    queryClient.setQueryData<Todo[]>(TODO_BOARD_KEY, old => (old ? fn(old) : old));
  const refreshClientPages = () => queryClient.invalidateQueries({ queryKey: [CLIENT_TODOS_KEY] });
  const failed = (text: string) => () => {
    message.error(text);
    queryClient.invalidateQueries({ queryKey: TODO_BOARD_KEY });
  };

  const createMutation = useMutation({
    mutationFn: (payload: TodoCreate) => todoService.create(payload),
    onSuccess: created => {
      patch(todos => [created, ...todos]);
      refreshClientPages();
    },
    onError: () => message.error("Couldn't add the todo. Try again."),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: UpdateVars) => todoService.update(id, payload),
    onMutate: ({ id, payload, clientName }) => patch(todos => todos.map(t => {
      if (t.id !== id) return t;
      const next: Todo = { ...t, ...payload } as Todo;
      if (payload.status && payload.status !== t.status) {
        next.sort_order = topOf(todos, payload.status, id);
        next.is_completed = payload.status === 'done';
      }
      if ('client_id' in payload && (payload.client_id ?? null) !== (t.client_id ?? null)) {
        next.client_name = clientName ?? null;
        next.claim_id = null;
        next.claim_number = null;
      }
      return next;
    })),
    // Take only what the server works out; status and order are already in place,
    // and a quicker second tap on the circle must not be undone by the first answer
    onSuccess: saved => {
      patch(todos => todos.map(t => (t.id === saved.id ? {
        ...t,
        client_name: saved.client_name,
        claim_id: saved.claim_id,
        claim_number: saved.claim_number,
        completed_at: saved.completed_at,
      } : t)));
      refreshClientPages();
    },
    onError: failed("Couldn't save the todo. Try again."),
  });

  const reorderMutation = useMutation({
    mutationFn: ({ status, ids }: { status: TodoStatus; ids: string[] }) => todoService.reorder(status, ids),
    onSuccess: refreshClientPages,
    onError: failed("Couldn't save the new order. Try again."),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => todoService.remove(id),
    onMutate: id => patch(todos => todos.filter(t => t.id !== id)),
    onSuccess: refreshClientPages,
    onError: failed("Couldn't delete the todo. Try again."),
  });

  /** Put a column in its new order right away (a todo dragged in takes the column's status), then save it */
  const reorder = (status: TodoStatus, ids: string[]) => {
    const index = new Map(ids.map((id, i) => [id, i]));
    patch(todos => todos.map(t => (index.has(t.id)
      ? { ...t, status, sort_order: index.get(t.id)!, is_completed: status === 'done' }
      : t)));
    reorderMutation.mutate({ status, ids });
  };

  return {
    todos: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    create: createMutation.mutateAsync,
    creating: createMutation.isPending,
    update: (id: string, payload: TodoUpdate, clientName?: string | null) =>
      updateMutation.mutate({ id, payload, clientName }),
    reorder,
    remove: removeMutation.mutate,
  };
};
