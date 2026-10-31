/**
 * Local-first persistence (P3 §5.6–5.7). `y-indexeddb` owns the write path; this module owns the
 * lifecycle and the status machine around it:
 *
 * - attach before first render, so a previously visited board opens with zero network;
 * - the provider owns writes; a queued read transaction confirms they committed before Saved;
 * - storage failures become an actionable `error` state instead of a silent data loss.
 */

import { IndexeddbPersistence } from 'y-indexeddb';
import type * as Y from 'yjs';

import { initialSyncStatus, reduceSync, toSyncError, type SyncStatus } from './syncStatus.ts';

/** N2's budget: a write must reach IndexedDB within this many milliseconds. */
export const DURABILITY_BUDGET_MS = 100;

export const boardStoreName = (boardId: string): string => `raven-board-${boardId}`;

export interface PersistenceHandle {
  /** Resolves once the persisted state has been loaded into the doc (or storage is unusable). */
  readonly whenLoaded: Promise<void>;
  readonly status: () => SyncStatus;
  subscribe(listener: (status: SyncStatus) => void): () => void;
  /** Clears the `error` state and re-attaches; used by the indicator's Retry action. */
  retry(): void;
  destroy(): Promise<void>;
}

export interface PersistenceOptions {
  boardId: string;
  doc: Y.Doc;
  /** Injected for tests; defaults to `y-indexeddb`. */
  createProvider?: (name: string, doc: Y.Doc) => IndexeddbPersistence;
  /** Injected for tests; defaults to the browser's online state and events. */
  connectivity?: {
    isOnline: () => boolean;
    subscribe: (listener: (online: boolean) => void) => () => void;
  };
  now?: () => number;
}

const browserConnectivity = (): NonNullable<PersistenceOptions['connectivity']> => ({
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  subscribe: (listener) => {
    if (typeof window === 'undefined') return () => undefined;
    const online = () => listener(true);
    const offline = () => listener(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  },
});

/** A transaction on the same store queues behind the provider's writes, across connections. */
function waitForCommittedUpdates(database: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('updates', 'readonly');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB confirmation was aborted'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB confirmation failed'));
  });
}

export function createPersistence(options: PersistenceOptions): PersistenceHandle {
  const now = options.now ?? (() => Date.now());
  const connectivity = options.connectivity ?? browserConnectivity();
  const createProvider =
    options.createProvider ?? ((name: string, doc: Y.Doc) => new IndexeddbPersistence(name, doc));

  let status = initialSyncStatus(connectivity.isOnline());
  const listeners = new Set<(next: SyncStatus) => void>();
  const emit = (event: Parameters<typeof reduceSync>[1]): void => {
    const next = reduceSync(status, event);
    if (next === status) return;
    status = next;
    for (const listener of listeners) listener(status);
  };

  let provider: IndexeddbPersistence | null = null;
  let generation = 0;
  let destroyed = false;
  let issued = 0;
  let confirmed = 0;
  let observedDatabase: IDBDatabase | null = null;
  let offDatabase = (): void => undefined;
  let resolveLoaded: () => void = () => undefined;
  const whenLoaded = new Promise<void>((resolve) => {
    resolveLoaded = resolve;
  });

  const isCurrent = (current: IndexeddbPersistence, attempt: number): boolean =>
    !destroyed && provider === current && generation === attempt;
  const reportError = (error: unknown): void => {
    // Keep the first specific error (for example quota) when its abort event follows it.
    if (!destroyed && status.state !== 'error') emit({ type: 'error', error: toSyncError(error) });
  };
  const confirm = (
    current: IndexeddbPersistence,
    attempt: number,
    sequence: number,
    initial = false,
  ): void => {
    // Our document listener may precede the provider's listener. Enter the queue only once
    // all listeners have had a chance to enqueue this update's native write transaction.
    void Promise.resolve()
      .then(() => current.whenSynced)
      .then(async () => {
        if (!isCurrent(current, attempt)) return;
        const database = current.db;
        if (database === null) throw new Error('IndexedDB is not available for save confirmation');
        if (observedDatabase !== database) {
          offDatabase();
          observedDatabase = database;
          const failed = (event: Event): void => {
            if (!isCurrent(current, attempt)) return;
            const target = event.target as IDBTransaction | IDBRequest | null;
            reportError(target?.error ?? new Error('IndexedDB transaction did not commit'));
          };
          database.addEventListener('error', failed);
          database.addEventListener('abort', failed);
          offDatabase = () => {
            database.removeEventListener('error', failed);
            database.removeEventListener('abort', failed);
            observedDatabase = null;
          };
        }
        await waitForCommittedUpdates(database);
        if (!isCurrent(current, attempt)) return;
        const count = Math.max(0, sequence - confirmed);
        confirmed = Math.max(confirmed, sequence);
        for (let i = 0; i < count; i += 1) emit({ type: 'flushed', at: now() });
        if (initial) {
          if (count === 0 && status.pending === 0) emit({ type: 'flushed', at: now() });
          resolveLoaded();
        }
      })
      .catch((error: unknown) => {
        if (!isCurrent(current, attempt)) return;
        reportError(error);
        if (initial) resolveLoaded();
      });
  };

  const onUpdate = (_update: Uint8Array, origin: unknown): void => {
    if (origin === provider) return;
    issued += 1;
    emit({ type: 'write' });
    if (provider !== null) confirm(provider, generation, issued);
  };

  const attach = (): void => {
    const attempt = ++generation;
    try {
      if (options.createProvider === undefined && globalThis.indexedDB === undefined)
        throw new Error('IndexedDB is not supported in this browser context');
      provider = createProvider(boardStoreName(options.boardId), options.doc);
      confirm(provider, attempt, issued, true);
    } catch (error) {
      reportError(error);
      resolveLoaded();
    }
  };

  options.doc.on('update', onUpdate);
  const offConnectivity = connectivity.subscribe((online) => {
    emit({ type: 'online', online });
  });
  attach();

  return {
    whenLoaded,
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      listener(status);
      return () => listeners.delete(listener);
    },
    retry() {
      if (destroyed) return;
      emit({ type: 'retry' });
      offDatabase();
      const previous = provider;
      provider = null;
      // Reattaching persists the current in-memory Y.Doc as a full snapshot before confirming.
      // This also recovers edits whose original transaction failed, without dropping the doc.
      if (previous !== null) void previous.destroy().catch(reportError);
      attach();
    },
    async destroy() {
      destroyed = true;
      generation += 1;
      offDatabase();
      options.doc.off('update', onUpdate);
      offConnectivity();
      listeners.clear();
      const current = provider;
      provider = null;
      if (current !== null) await current.destroy();
    },
  };
}
