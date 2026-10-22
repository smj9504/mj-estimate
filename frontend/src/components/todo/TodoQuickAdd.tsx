import React, { useMemo } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { message } from 'antd';
import { CLIENT_TODOS_KEY, TODO_BOARD_KEY, todoService } from '../../services/todoService';
import type { Client, TodoCreate } from '../../types/client';
import TodoSheet from './TodoSheet';

interface TodoQuickAddProps {
  open: boolean;
  onClose: () => void;
}

/** The phone bar's Create button: add a todo from any page; on a client page it starts with that client */
const TodoQuickAdd: React.FC<TodoQuickAddProps> = ({ open, onClose }) => {
  const location = useLocation();
  const queryClient = useQueryClient();
  const clientId = matchPath('/clients/:id', location.pathname)?.params.id;
  const clientName = clientId ? queryClient.getQueryData<Client>(['client', clientId])?.display_name : undefined;
  const presetClient = useMemo(
    () => (clientId ? { id: clientId, name: clientName ?? null } : null),
    [clientId, clientName],
  );

  const create = useMutation({
    mutationFn: (payload: TodoCreate) => todoService.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TODO_BOARD_KEY });
      queryClient.invalidateQueries({ queryKey: [CLIENT_TODOS_KEY] });
      message.success('Todo added');
      onClose();
    },
    onError: () => message.error("Couldn't add the todo. Try again."),
  });

  return (
    <TodoSheet
      open={open}
      presetClient={presetClient}
      saving={create.isPending}
      onClose={onClose}
      onSubmit={values => create.mutate({ title: values.title, client_id: values.client_id })}
    />
  );
};

export default TodoQuickAdd;
