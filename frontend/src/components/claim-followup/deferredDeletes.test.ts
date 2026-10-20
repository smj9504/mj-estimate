import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferredDeletes } from './deferredDeletes';

const setup = (send = vi.fn().mockResolvedValue(undefined)) => {
  const pending = new Set<string>();
  const deletes = createDeferredDeletes({
    windowMs: 6000,
    send,
    onPendingChange: (id, isPending) => { if (isPending) pending.add(id); else pending.delete(id); },
  });
  return { deletes, send, pending };
};

describe('createDeferredDeletes', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('hides the task at once and sends the delete only after the window', async () => {
    const { deletes, send, pending } = setup();

    expect(deletes.request('t1')).toBe(true);
    expect(pending.has('t1')).toBe(true);
    await vi.advanceTimersByTimeAsync(5999);
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledWith('t1');
    expect(pending.has('t1')).toBe(false);
  });

  it('keeps the task hidden until the send settles', async () => {
    let finish!: () => void;
    const { deletes, pending } = setup(vi.fn(() => new Promise<void>(r => { finish = r; })));

    deletes.request('t1');
    await vi.advanceTimersByTimeAsync(6000);
    expect(pending.has('t1')).toBe(true);

    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(pending.has('t1')).toBe(false);
  });

  it('never sends a delete that was undone', async () => {
    const { deletes, send, pending } = setup();

    deletes.request('t1');
    expect(deletes.undo('t1')).toBe(true);
    expect(pending.has('t1')).toBe(false);

    await vi.advanceTimersByTimeAsync(60000);
    expect(send).not.toHaveBeenCalled();
  });

  it('cannot undo once the delete went out', async () => {
    const { deletes } = setup();

    deletes.request('t1');
    await vi.advanceTimersByTimeAsync(6000);
    expect(deletes.undo('t1')).toBe(false);
  });

  it('ignores a second request for a task already waiting', async () => {
    const { deletes, send } = setup();

    deletes.request('t1');
    expect(deletes.request('t1')).toBe(false);
    await vi.advanceTimersByTimeAsync(6000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('flush sends every waiting delete right away, and only once', async () => {
    const { deletes, send } = setup();

    deletes.request('t1');
    deletes.request('t2');
    expect(deletes.flush()).toEqual(['t1', 't2']);
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls).toEqual([['t1'], ['t2']]);

    await vi.advanceTimersByTimeAsync(6000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('brings the task back when the send fails', async () => {
    const { deletes, pending } = setup(vi.fn().mockRejectedValue(new Error('offline')));

    deletes.request('t1');
    await vi.advanceTimersByTimeAsync(6000);
    expect(pending.has('t1')).toBe(false);
  });
});
