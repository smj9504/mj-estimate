/**
 * Todo statuses, shared by the todo board and the client page: one map of
 * labels and tones, and the status circle (empty, half, done) that steps a
 * todo to its next column when tapped.
 */

import React from 'react';
import type { TodoStatus } from '../../types/client';
import type { TagTone } from '../common/ui';
import { tagTones } from '../../styles/tokens';
import './todo.css';

export const TODO_STATUSES: TodoStatus[] = ['todo', 'in_progress', 'done'];

export const TODO_STATUS_LABELS: Record<TodoStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

export const TODO_STATUS_TONES: Record<TodoStatus, TagTone> = {
  todo: 'gray',
  in_progress: 'blue',
  done: 'green',
};

/** Tapping the circle steps forward: To do → In progress → Done → back to To do */
export const nextTodoStatus = (status: TodoStatus): TodoStatus =>
  status === 'todo' ? 'in_progress' : status === 'in_progress' ? 'done' : 'todo';

const NEXT_ACTION: Record<TodoStatus, string> = {
  todo: 'Start',
  in_progress: 'Mark done',
  done: 'Reopen',
};

/** Empty ring for To do, half filled for In progress, a check for Done */
export const TodoStatusIcon: React.FC<{ status: TodoStatus; size?: number }> = ({ status, size = 16 }) => {
  const color = tagTones[TODO_STATUS_TONES[status]].text;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {status === 'done' ? (
        <>
          <circle cx="8" cy="8" r="7" fill={color} />
          <path d="M4.8 8.2l2.1 2.1 4.3-4.5" fill="none" stroke="#fff" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="6.25" fill="none" stroke={color} strokeWidth="1.5" />
          {status === 'in_progress' && <path d="M8 3.5a4.5 4.5 0 0 1 0 9z" fill={color} />}
        </>
      )}
    </svg>
  );
};

interface TodoStatusButtonProps {
  status: TodoStatus;
  title: string;
  onChange: (next: TodoStatus) => void;
  disabled?: boolean;
  className?: string;
}

export const TodoStatusButton: React.FC<TodoStatusButtonProps> = ({
  status, title, onChange, disabled, className,
}) => {
  const action = `${NEXT_ACTION[status]}: ${title}`;
  return (
    <button
      type="button"
      className={`td-status${className ? ` ${className}` : ''}`}
      aria-label={action}
      title={`${TODO_STATUS_LABELS[status]} · ${NEXT_ACTION[status]}`}
      disabled={disabled}
      // Keep a drag from starting on the card under the circle
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onTouchStart={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
      onClick={e => {
        e.stopPropagation();
        onChange(nextTodoStatus(status));
      }}
    >
      <TodoStatusIcon status={status} />
    </button>
  );
};
