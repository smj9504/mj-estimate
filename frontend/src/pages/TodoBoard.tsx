/**
 * Todos: each person's own board, the app's home page. Three columns on
 * desktop (To do, In progress, Done), dragged to set priority and moved
 * between columns by drag or by the status circle; on phones, view tabs
 * over one list with a drag handle per row.
 */

import React, { useMemo, useRef, useState } from 'react';
import { Button, Skeleton, message } from 'antd';
import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { PageHeader, Pill, useSheetModal } from '../components/common/ui';
import { tagTones } from '../styles/tokens';
import type { Todo, TodoCreate, TodoStatus } from '../types/client';
import { TODO_STATUSES, TODO_STATUS_LABELS, TODO_STATUS_TONES } from '../components/todo/todoUi';
import { useTodoBoard } from '../components/todo/useTodoBoard';
import { groupColumns, type TodoColumns } from '../components/todo/todoColumns';
import {
  SortableTodoCard,
  SortableTodoRow,
  TodoCardOverlay,
  TodoInlineEditor,
  TodoRowOverlay,
} from '../components/todo/TodoItems';
import TodoComposer from '../components/todo/TodoComposer';
import TodoSheet from '../components/todo/TodoSheet';

/** Done keeps growing, so it shows the latest few until asked for the rest */
const DONE_PREVIEW = 10;

const EMPTY_TEXT: Record<TodoStatus, { desktop: string; phone: string }> = {
  todo: { desktop: 'Nothing to do. Add one above.', phone: 'Nothing to do. Add one above.' },
  in_progress: {
    desktop: 'Drag a todo here when you start it.',
    phone: "Tap a todo's circle when you start it.",
  },
  done: { desktop: 'Finished todos land here.', phone: 'Finished todos land here.' },
};

const isColumn = (id: UniqueIdentifier): id is TodoStatus => TODO_STATUSES.includes(id as TodoStatus);

interface ColumnProps {
  status: TodoStatus;
  count: number;
  highlighted: boolean;
  ids: string[];
  children: React.ReactNode;
}

/** A desktop column; its body takes drops, so an empty column still accepts a card */
const BoardColumn: React.FC<ColumnProps> = ({ status, count, highlighted, ids, children }) => {
  const { setNodeRef } = useDroppable({ id: status });
  return (
    <section className="td-column" aria-label={TODO_STATUS_LABELS[status]}>
      <header className="td-column-head">
        <Pill tone={TODO_STATUS_TONES[status]}>{TODO_STATUS_LABELS[status]}</Pill>
        <span className="ui-tab-count">{count}</span>
      </header>
      <SortableContext id={status} items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className={`td-column-body${highlighted ? ' is-over' : ''}`}>
          {children}
        </div>
      </SortableContext>
    </section>
  );
};

const TodoBoard: React.FC = () => {
  const { isPhone } = useSheetModal();
  const board = useTodoBoard();
  const { todos } = board;

  const byId = useMemo(() => new Map((todos ?? []).map(t => [t.id, t])), [todos]);
  const serverColumns = useMemo(() => groupColumns(todos ?? []), [todos]);
  // While a card is dragged it can move between columns before the drop is saved
  const [dragColumns, setDragColumns] = useState<TodoColumns | null>(null);
  const columns = dragColumns ?? serverColumns;
  const [activeId, setActiveId] = useState<string | null>(null);
  const dragFrom = useRef<TodoStatus | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [sheetTodo, setSheetTodo] = useState<Todo | null>(null);
  const [tab, setTab] = useState<TodoStatus>('todo');
  const [showAllDone, setShowAllDone] = useState(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    // Enter opens a card, so only Space picks it up and drops it
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: [KeyboardCode.Space], cancel: [KeyboardCode.Esc], end: [KeyboardCode.Space] },
    }),
  );

  const visibleIds = (status: TodoStatus, cols: TodoColumns = columns) =>
    status === 'done' && !showAllDone ? cols.done.slice(0, DONE_PREVIEW) : cols[status];

  const findColumn = (id: UniqueIdentifier, cols: TodoColumns = columns): TodoStatus | undefined =>
    isColumn(id) ? id : TODO_STATUSES.find(s => cols[s].includes(String(id)));

  const handleDragStart = ({ active }: DragStartEvent) => {
    setEditingId(null);
    setActiveId(String(active.id));
    dragFrom.current = findColumn(active.id, serverColumns) ?? null;
    setDragColumns(serverColumns);
  };

  // Crossing into another column moves the card there, under the card it is over
  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    setDragColumns(prev => {
      const cols = prev ?? serverColumns;
      const from = findColumn(active.id, cols);
      const to = findColumn(over.id, cols);
      if (!from || !to || from === to) return prev;
      const id = String(active.id);
      const target = cols[to].filter(x => x !== id);
      const overIndex = target.indexOf(String(over.id));
      let index: number;
      if (overIndex >= 0) {
        const translated = active.rect.current.translated;
        const below = !!translated && translated.top > over.rect.top + over.rect.height / 2;
        index = overIndex + (below ? 1 : 0);
      } else {
        // Over the column itself: the end of what it shows (inside Done's preview)
        index = to === 'done' && !showAllDone ? Math.min(target.length, DONE_PREVIEW - 1) : target.length;
      }
      target.splice(index, 0, id);
      return { ...cols, [from]: cols[from].filter(x => x !== id), [to]: target };
    });
  };

  const finishDrag = () => {
    setActiveId(null);
    setDragColumns(null);
    dragFrom.current = null;
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    const from = dragFrom.current;
    const to = over ? findColumn(over.id) : undefined;
    if (!over || !to || !from) {
      finishDrag();
      return;
    }
    let ids = columns[to];
    const oldIndex = ids.indexOf(id);
    const overIndex = ids.indexOf(String(over.id));
    if (oldIndex >= 0 && overIndex >= 0 && oldIndex !== overIndex) {
      ids = arrayMove(ids, oldIndex, overIndex);
    }
    const moved = to !== from || ids.join() !== serverColumns[to].join();
    // Write the new order into the board before the drag state goes, so nothing jumps back
    if (moved) board.reorder(to, ids);
    finishDrag();
  };

  const changeStatus = (todo: Todo, next: TodoStatus) => {
    board.update(todo.id, { status: next });
    // On a phone the todo leaves the tab being looked at, so say where it went
    if (isPhone) {
      const key = `todo-moved-${todo.id}`;
      const previous = todo.status;
      message.open({
        key,
        type: 'success',
        duration: 4,
        content: (
          <span>
            Moved to {TODO_STATUS_LABELS[next]}
            <Button
              type="link"
              size="small"
              onClick={() => {
                board.update(todo.id, { status: previous });
                message.destroy(key);
              }}
            >
              Undo
            </Button>
          </span>
        ),
      });
    }
  };

  const add = (payload: TodoCreate) => board.create(payload);
  const activeTodo = activeId ? byId.get(activeId) : undefined;
  const activeColumn = activeId ? findColumn(activeId) : undefined;

  const doneToggle = (shown: number) => columns.done.length > DONE_PREVIEW && (
    <Button type="text" size="small" className="td-more" onClick={() => setShowAllDone(v => !v)}>
      {showAllDone ? 'Show fewer' : `Show ${columns.done.length - shown} more`}
    </Button>
  );

  const header = (
    <PageHeader
      title="Todos"
      meta={isPhone
        ? 'Your own board. Hold a handle to reorder by priority.'
        : 'Your own board. Drag a todo to set its priority.'}
    />
  );

  if (board.isError) {
    return (
      <div className="td-page">
        {header}
        <div className="td-error" role="alert">
          Couldn&apos;t load your todos.
          <Button size="small" onClick={() => board.refetch()}>Try again</Button>
        </div>
      </div>
    );
  }

  // ── Phone: view tabs over one list ─────────────────
  if (isPhone) {
    const ids = visibleIds(tab);
    return (
      <div className="td-page">
        {header}
        <div className="ui-status-tabs" role="group" aria-label="Show todos by status">
          {TODO_STATUSES.map(status => (
            <Button
              key={status}
              type="text"
              size="small"
              aria-pressed={tab === status}
              className={`ui-view-tab${tab === status ? ' is-selected' : ''}`}
              onClick={() => setTab(status)}
            >
              <span
                className="ui-filter-chip-dot"
                style={{ background: tagTones[TODO_STATUS_TONES[status]].text }}
                aria-hidden="true"
              />
              {TODO_STATUS_LABELS[status]}
              {todos && <span className="ui-tab-count">{columns[status].length}</span>}
            </Button>
          ))}
        </div>

        {tab === 'todo' && <TodoComposer onAdd={add} adding={board.creating} large />}

        {board.isLoading ? (
          <Skeleton active title={false} paragraph={{ rows: 4 }} />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={finishDrag}
          >
            <SortableContext id={tab} items={ids} strategy={verticalListSortingStrategy}>
              <ul className="td-rows">
                {ids.map(id => {
                  const todo = byId.get(id);
                  return todo && (
                    <SortableTodoRow key={id} todo={todo} onStatus={changeStatus} onOpen={setSheetTodo} />
                  );
                })}
                {ids.length === 0 && <li className="td-rows-empty">{EMPTY_TEXT[tab].phone}</li>}
              </ul>
            </SortableContext>
            {tab === 'done' && <div className="td-rows-more">{doneToggle(ids.length)}</div>}
            <DragOverlay modifiers={[restrictToVerticalAxis]}>
              {activeTodo && <TodoRowOverlay todo={activeTodo} />}
            </DragOverlay>
          </DndContext>
        )}

        <TodoSheet
          open={!!sheetTodo}
          todo={sheetTodo}
          onClose={() => setSheetTodo(null)}
          onDelete={() => {
            if (sheetTodo) board.remove(sheetTodo.id);
            setSheetTodo(null);
          }}
          onSubmit={values => {
            const todo = sheetTodo;
            if (!todo) return;
            const payload: Partial<TodoCreate> = {};
            if (values.title !== todo.title) payload.title = values.title;
            if (values.client_id !== (todo.client_id ?? null)) payload.client_id = values.client_id;
            if (values.status !== todo.status) payload.status = values.status;
            if (Object.keys(payload).length > 0) board.update(todo.id, payload, values.client_name);
            setSheetTodo(null);
          }}
        />
      </div>
    );
  }

  // ── Desktop: three columns ─────────────────────────
  return (
    <div className="td-page">
      {header}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={finishDrag}
      >
        <div className="td-board">
          {TODO_STATUSES.map(status => {
            const ids = visibleIds(status);
            return (
              <BoardColumn
                key={status}
                status={status}
                count={columns[status].length}
                highlighted={activeColumn === status}
                ids={ids}
              >
                {status === 'todo' && <TodoComposer onAdd={add} adding={board.creating} />}
                {board.isLoading ? (
                  <Skeleton active title={false} paragraph={{ rows: 3 }} />
                ) : (
                  <>
                    {ids.map(id => {
                      const todo = byId.get(id);
                      return todo && (
                        <SortableTodoCard
                          key={id}
                          todo={todo}
                          onStatus={changeStatus}
                          onOpen={t => setEditingId(t.id)}
                          editor={editingId === id ? (
                            <TodoInlineEditor
                              todo={todo}
                              onSave={(payload, clientName) => board.update(id, payload, clientName)}
                              onDelete={() => board.remove(id)}
                              onClose={() => setEditingId(null)}
                            />
                          ) : undefined}
                        />
                      );
                    })}
                    {ids.length === 0 && <div className="td-column-empty">{EMPTY_TEXT[status].desktop}</div>}
                    {status === 'done' && doneToggle(ids.length)}
                  </>
                )}
              </BoardColumn>
            );
          })}
        </div>
        <DragOverlay>
          {activeTodo && <TodoCardOverlay todo={activeTodo} />}
        </DragOverlay>
      </DndContext>
    </div>
  );
};

export default TodoBoard;
