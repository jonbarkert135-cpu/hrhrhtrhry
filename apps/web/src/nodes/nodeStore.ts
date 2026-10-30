/**
 * Per-node subscriptions (P4 §7, §10). A card must re-render when *its* node changes and at no
 * other time: on a 200-node board, editing one title may not cost 200 renders. The store keeps one
 * listener set per node id and a snapshot cache, so `useSyncExternalStore` sees a stable object
 * identity until that node is actually written.
 */

import { getNode, listNodes, observeBoard, type BoardNode } from '@nexus/domain';
import type * as Y from 'yjs';

export interface NodeStore {
  /** Subscribe to one node. Returns the unsubscribe function. */
  subscribe(id: string, listener: () => void): () => void;
  /** Subscribe to the id list only (mount/unmount of cards, not their content). */
  subscribeIds(listener: () => void): () => void;
  getSnapshot(id: string): BoardNode | undefined;
  getIds(): readonly string[];
  destroy(): void;
}

export function createNodeStore(doc: Y.Doc): NodeStore {
  const listeners = new Map<string, Set<() => void>>();
  const idListeners = new Set<() => void>();
  const snapshots = new Map<string, BoardNode>();
  let ids: string[] = listNodes(doc).map((node) => node.id);

  let knownIds = new Set(ids);

  const refresh = (id: string): void => {
    const node = getNode(doc, id);
    if (node === undefined) snapshots.delete(id);
    else snapshots.set(id, node);
  };

  const onChange: Parameters<typeof observeBoard>[1] = (change) => {
    for (const id of change.nodes.upserted) {
      refresh(id);
      const set = listeners.get(id);
      if (set !== undefined) for (const listener of set) listener();
    }
    for (const id of change.nodes.removed) {
      snapshots.delete(id);
      const set = listeners.get(id);
      if (set !== undefined) for (const listener of set) listener();
    }
    // Editing content must not deserialize every node just to discover the id list is unchanged
    if (
      change.nodes.upserted.some((id) => !knownIds.has(id)) ||
      change.nodes.removed.some((id) => knownIds.has(id))
    ) {
      const next = listNodes(doc).map((node) => node.id);
      const changed = next.length !== ids.length || next.some((id, index) => id !== ids[index]);
      if (changed) {
        ids = next;
        knownIds = new Set(next);
        for (const listener of idListeners) listener();
      }
    }
  };
  // Subscribe lazily: React StrictMode may clean up and subscribe to the same store again.
  // A store allocated during a discarded render must not leave a document observer behind.
  let stop: (() => void) | undefined;
  const connect = (): void => {
    stop ??= observeBoard(doc, onChange);
  };

  return {
    subscribe(id, listener) {
      connect();
      const set = listeners.get(id) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(id, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(id);
      };
    },
    subscribeIds(listener) {
      connect();
      idListeners.add(listener);
      return () => {
        idListeners.delete(listener);
      };
    },
    getSnapshot(id) {
      const cached = snapshots.get(id);
      if (stop !== undefined && cached !== undefined) return cached;
      const node = getNode(doc, id);
      // Without an active observer, preserve referential stability while checking for edits
      // made between subscriptions. This path is outside the subscribed card render loop.
      if (cached !== undefined && JSON.stringify(cached) === JSON.stringify(node)) return cached;
      if (node !== undefined) snapshots.set(id, node);
      else snapshots.delete(id);
      return node;
    },
    getIds() {
      if (stop === undefined) {
        const next = listNodes(doc).map((node) => node.id);
        if (next.length !== ids.length || next.some((id, index) => id !== ids[index])) {
          ids = next;
          knownIds = new Set(next);
        }
      }
      return ids;
    },
    destroy() {
      stop?.();
      stop = undefined;
      listeners.clear();
      idListeners.clear();
      snapshots.clear();
    },
  };
}
