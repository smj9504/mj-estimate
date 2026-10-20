import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, message } from 'antd';
import { claimFollowUpService } from '../../services/claimFollowUpService';
import { createDeferredDeletes } from './deferredDeletes';

/** How long Undo stays on screen before the task is really deleted */
const UNDO_WINDOW_MS = 6000;

const toastKey = (taskId: string) => `undo-delete-${taskId}`;

/**
 * Deletes a follow-up task only once its Undo window has passed.
 *
 * The task leaves the page at once (filter the list by `pendingIds`) and a
 * toast offers Undo; the delete request goes out when the window ends.
 * Leaving the page sends any delete still waiting. Closing the tab before
 * the window ends keeps the task, which is the safe way for this to fail.
 *
 * `onDeleted` refreshes the list; the task stays hidden until it resolves,
 * so it does not flash back before the refetch lands.
 */
export function useUndoableTaskDelete(onDeleted: () => Promise<unknown> | void) {
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());
  const mounted = useRef(true);
  const onDeletedRef = useRef(onDeleted);
  onDeletedRef.current = onDeleted;

  const [deletes] = useState(() => createDeferredDeletes({
    windowMs: UNDO_WINDOW_MS,
    send: async (taskId) => {
      try {
        await claimFollowUpService.deleteTask(taskId);
        await onDeletedRef.current();
      } catch (err: any) {
        message.error(err?.response?.data?.detail || 'Failed to delete task');
      }
    },
    onPendingChange: (taskId, pending) => {
      if (!mounted.current) return;
      setPendingIds(prev => {
        const next = new Set(prev);
        if (pending) next.add(taskId);
        else next.delete(taskId);
        return next;
      });
    },
  }));

  const requestDelete = useCallback((taskId: string) => {
    if (!deletes.request(taskId)) return;
    const undo = () => {
      if (deletes.undo(taskId)) {
        message.success({ key: toastKey(taskId), content: 'Task restored', duration: 2 });
      }
    };
    message.success({
      key: toastKey(taskId),
      duration: UNDO_WINDOW_MS / 1000,
      content: (
        <span>
          Task deleted
          <Button type="link" size="small" onClick={undo}>Undo</Button>
        </span>
      ),
    });
  }, [deletes]);

  // Leaving the page sends whatever is still waiting
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      deletes.flush().forEach(taskId => message.destroy(toastKey(taskId)));
    };
  }, [deletes]);

  return { pendingIds, requestDelete };
}
