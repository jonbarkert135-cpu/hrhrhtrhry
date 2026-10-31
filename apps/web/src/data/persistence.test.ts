/**
 * N2: a mutation must be durable within 100 ms, and a previously visited board must open with zero
 * network. Both are asserted against a real (in-memory) IndexedDB through `fake-indexeddb`.
 */

import { createBoardDoc, emptyBoardDoc, addNode, listNodes, makeNode } from '@nexus/domain';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { IndexeddbPersistence } from 'y-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DURABILITY_BUDGET_MS, boardStoreName, createPersistence } from './persistence';

const NOW = '2026-08-17T12:00:00.000Z';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  // y-indexeddb uses key ranges, so both globals have to come from the fake implementation.
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('local persistence', () => {
  it('names one IndexedDB store per board', () => {
    expect(boardStoreName('b_1')).toBe('raven-board-b_1');
  });

  it('writes a mutation to IndexedDB inside the durability budget and reloads it', async () => {
    const doc = createBoardDoc({ boardId: 'b_dur', now: NOW });
    const handle = createPersistence({ boardId: 'b_dur', doc });
    await handle.whenLoaded;

    addNode(doc, makeNode({ id: 'n1', x: 1, y: 2, title: 'Durable' }, NOW), {
      origin: 'local:create',
      now: NOW,
    });
    await sleep(DURABILITY_BUDGET_MS);
    await handle.destroy();

    // A fresh tab: nothing but IndexedDB, no network at all.
    const reopened = emptyBoardDoc('b_dur');
    const second = createPersistence({ boardId: 'b_dur', doc: reopened });
    await second.whenLoaded;
    expect(listNodes(reopened).map((node) => node.title)).toEqual(['Durable']);
    await second.destroy();
  });

  it('reports Saved only once the write is flushed', async () => {
    const doc = createBoardDoc({ boardId: 'b_status', now: NOW });
    const handle = createPersistence({ boardId: 'b_status', doc, now: () => 1_000 });
    await handle.whenLoaded;
    const states: string[] = [];
    const off = handle.subscribe((status) => states.push(status.state));

    addNode(doc, makeNode({ id: 'n1', x: 0, y: 0 }, NOW), { origin: 'local:create', now: NOW });
    expect(handle.status().state).toBe('saving');
    await sleep(DURABILITY_BUDGET_MS);
    expect(handle.status().state).toBe('saved');
    expect(handle.status().lastSavedAt).toBe(1_000);
    expect(states).toContain('saving');

    off();
    await handle.destroy();
  });

  it('keeps Saving while a real IndexedDB writer is blocked, then confirms durable data', async () => {
    const boardId = 'b_commit_barrier';
    const doc = createBoardDoc({ boardId, now: NOW });
    const handle = createPersistence({ boardId, doc });
    await handle.whenLoaded;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(boardStoreName(boardId));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Test IndexedDB could not open'));
    });
    const blocker = database.transaction('updates', 'readwrite');
    let held = true;
    const finished = new Promise<void>((resolve) => {
      blocker.oncomplete = () => resolve();
    });
    const keepAlive = (): void => {
      const request = blocker.objectStore('updates').get(0);
      request.onsuccess = () => {
        if (held) keepAlive();
      };
    };
    keepAlive();
    try {
      for (let i = 0; i < 12; i += 1) {
        addNode(doc, makeNode({ id: `pending-${String(i)}`, x: i, y: 0, title: 'Pending' }, NOW), {
          origin: 'local:create',
          now: NOW,
        });
      }
      await sleep(20);
      expect(handle.status().state).toBe('saving');
      expect(handle.status().pending).toBe(12);
    } finally {
      held = false;
      await finished;
      database.close();
    }
    await vi.waitFor(() => expect(handle.status().state).toBe('saved'));
    expect(handle.status().pending).toBe(0);
    await handle.destroy();
    const reopened = emptyBoardDoc(boardId);
    const second = createPersistence({ boardId, doc: reopened });
    await second.whenLoaded;
    expect(listNodes(reopened)).toHaveLength(12);
    await second.destroy();
  });

  it('reports an aborted durability confirmation and retries through a new real connection', async () => {
    const boardId = 'b_aborted_confirmation';
    const doc = createBoardDoc({ boardId, now: NOW });
    let provider: IndexeddbPersistence | null = null;
    const handle = createPersistence({
      boardId,
      doc,
      createProvider: (name, target) => {
        provider = new IndexeddbPersistence(name, target);
        return provider;
      },
    });
    await handle.whenLoaded;
    const database = provider!.db!;
    const transaction = database.transaction.bind(database);
    let abortNextRead = true;
    vi.spyOn(database, 'transaction').mockImplementation((stores, mode, options) => {
      const tx = transaction(stores, mode, options);
      if (mode === 'readonly' && abortNextRead) {
        abortNextRead = false;
        queueMicrotask(() => tx.abort());
      }
      return tx;
    });
    addNode(doc, makeNode({ id: 'retry-note', x: 0, y: 0, title: 'Retry safely' }, NOW), {
      origin: 'local:create',
      now: NOW,
    });
    await vi.waitFor(() => expect(handle.status().state).toBe('error'));
    expect(handle.status().lastSavedAt).not.toBeNull();
    handle.retry();
    expect(handle.status().state).toBe('saving');
    await vi.waitFor(() => expect(handle.status().state).toBe('saved'));
    expect(provider!.db).not.toBe(database);
    await handle.destroy();
    const reopened = emptyBoardDoc(boardId);
    const second = createPersistence({ boardId, doc: reopened });
    await second.whenLoaded;
    expect(listNodes(reopened).map((node) => node.title)).toEqual(['Retry safely']);
    await second.destroy();
  });

  it('retains edits queued before the provider finishes opening', async () => {
    const boardId = 'b_early_edit';
    const doc = createBoardDoc({ boardId, now: NOW });
    const handle = createPersistence({ boardId, doc });
    addNode(doc, makeNode({ id: 'early-note', x: 0, y: 0, title: 'Before load' }, NOW), {
      origin: 'local:create',
      now: NOW,
    });
    await handle.whenLoaded;
    await vi.waitFor(() => expect(handle.status().state).toBe('saved'));
    expect(handle.status().pending).toBe(0);
    await handle.destroy();
    const reopened = emptyBoardDoc(boardId);
    const second = createPersistence({ boardId, doc: reopened });
    await second.whenLoaded;
    expect(listNodes(reopened).map((node) => node.title)).toEqual(['Before load']);
    await second.destroy();
  });

  it('follows the browser connectivity signal', async () => {
    const doc = createBoardDoc({ boardId: 'b_net', now: NOW });
    const listeners: Array<(online: boolean) => void> = [];
    const notify = (online: boolean): void => listeners.forEach((fn) => fn(online));
    const handle = createPersistence({
      boardId: 'b_net',
      doc,
      connectivity: {
        isOnline: () => true,
        subscribe: (fn) => {
          listeners.push(fn);
          return () => listeners.splice(listeners.indexOf(fn), 1);
        },
      },
    });
    await handle.whenLoaded;
    notify(false);
    expect(handle.status().state).toBe('offline');
    notify(true);
    expect(handle.status().online).toBe(true);
    await handle.destroy();
  });

  it('surfaces a storage failure as an actionable error and can retry', async () => {
    const doc = createBoardDoc({ boardId: 'b_fail', now: NOW });
    let attempts = 0;
    const handle = createPersistence({
      boardId: 'b_fail',
      doc,
      createProvider: (name, target) => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error('disk full');
          error.name = 'QuotaExceededError';
          throw error;
        }
        return new IndexeddbPersistence(name, target);
      },
    });
    await handle.whenLoaded;

    expect(handle.status().state).toBe('error');
    expect(handle.status().error?.kind).toBe('quota');
    expect(handle.status().error?.message).toMatch(/export the board/i);

    addNode(doc, makeNode({ id: 'memory-note', x: 0, y: 0, title: 'Recover from memory' }, NOW), {
      origin: 'local:create',
      now: NOW,
    });
    expect(handle.status().state).toBe('error');
    expect(handle.status().pending).toBe(1);
    handle.retry();
    expect(attempts).toBe(2);
    expect(handle.status().error).toBeNull();
    await vi.waitFor(() => expect(handle.status().state).toBe('saved'));
    await handle.destroy();
    const reopened = emptyBoardDoc('b_fail');
    const second = createPersistence({ boardId: 'b_fail', doc: reopened });
    await second.whenLoaded;
    expect(listNodes(reopened).map((node) => node.title)).toEqual(['Recover from memory']);
    await second.destroy();
  });

  it('reports a rejected provider load as an error instead of hanging', async () => {
    const doc = createBoardDoc({ boardId: 'b_reject', now: NOW });
    const handle = createPersistence({
      boardId: 'b_reject',
      doc,
      createProvider: () =>
        ({
          on: () => undefined,
          whenSynced: Promise.reject(new Error('IndexedDB is not supported in private mode')),
          destroy: () => Promise.resolve(),
        }) as unknown as IndexeddbPersistence,
    });
    await handle.whenLoaded;
    expect(handle.status().state).toBe('error');
    expect(handle.status().error?.kind).toBe('unavailable');
    await handle.destroy();
  });
});
