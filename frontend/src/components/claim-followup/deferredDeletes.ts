/**
 * The timing behind an undoable delete, kept apart from React and antd so it
 * can be tested without a DOM.
 *
 * `request` holds a delete for `windowMs`; `undo` cancels it while it is
 * still waiting; `flush` sends every waiting delete at once. `onPendingChange`
 * reports when an id starts and stops being hidden: it stops once `send`
 * settles, so an id stays hidden until the refreshed list no longer has it.
 */
export function createDeferredDeletes(options: {
  windowMs: number;
  send: (id: string) => Promise<unknown>;
  onPendingChange: (id: string, pending: boolean) => void;
}) {
  const { windowMs, send, onPendingChange } = options;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const commit = (id: string) => {
    timers.delete(id);
    return Promise.resolve()
      .then(() => send(id))
      .catch(() => undefined)
      .then(() => onPendingChange(id, false));
  };

  return {
    /** False when that id is already waiting */
    request(id: string): boolean {
      if (timers.has(id)) return false;
      onPendingChange(id, true);
      timers.set(id, setTimeout(() => { commit(id); }, windowMs));
      return true;
    },
    /** False when the delete already went out */
    undo(id: string): boolean {
      const timer = timers.get(id);
      if (timer === undefined) return false;
      clearTimeout(timer);
      timers.delete(id);
      onPendingChange(id, false);
      return true;
    },
    /** Sends every waiting delete now; returns their ids */
    flush(): string[] {
      const ids = Array.from(timers.keys());
      ids.forEach(id => {
        clearTimeout(timers.get(id)!);
        commit(id);
      });
      return ids;
    },
  };
}
