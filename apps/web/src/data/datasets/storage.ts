import { DatasetError } from '@nexus/domain';
import { WorkspaceError } from '../workspace/types.ts';

export function openDatasetDatabase(factory: IDBFactory | undefined): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!factory) {
      reject(new DatasetError('STORAGE_UNAVAILABLE', 'IndexedDB is required for collections'));
      return;
    }
    const req = factory.open('raven-workspace', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects'))
        db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('boards'))
        db.createObjectStore('boards', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      const collections = db.createObjectStore('collections', { keyPath: 'key' });
      collections.createIndex('scope', ['scope', 'active', 'id']);
      collections.createIndex('project', 'data.scope.projectId');
      collections.createIndex('board', 'data.scope.boardId');
      const items = db.createObjectStore('items', { keyPath: 'key' });
      items.createIndex('page', ['collection', 'kind', 'active', 'id']);
      items.createIndex('record', ['collection', 'kind', 'active', 'recordId', 'id']);
      items.createIndex('refs', 'refs', { multiEntry: true });
      items.createIndex('versions', ['collection', 'kind', 'versionNumber'], { unique: true });
      items.createIndex('members', ['collection', 'kind', 'memberId'], { unique: true });
      items.createIndex('board', ['kind', 'active', 'data.boardId']);
      db.createObjectStore('audit', { keyPath: 'key' }).createIndex('collection', 'collection');
    };
    req.onerror = () => reject(req.error ?? new Error('Dataset storage could not open'));
    req.onblocked = () =>
      reject(
        new DatasetError(
          'STORAGE_UNAVAILABLE',
          'Close older Raven tabs to upgrade dataset storage',
        ),
      );
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
  });
}

/** Parent metadata and dataset references share one transaction, including concurrent tabs. */
export async function writeWorkspaceRow(
  db: IDBDatabase,
  store: 'projects' | 'boards',
  row: { id: string; deletedAt?: string | null; projectId?: string },
): Promise<void> {
  const tx = db.transaction([store, 'collections', 'items'], 'readwrite');
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new WorkspaceError('Workspace write was aborted'));
  });
  void done.catch(() => undefined);
  const read = <T>(req: IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Workspace write failed'));
    });
  try {
    const old = (await read(tx.objectStore(store).get(row.id))) as
      | { projectId?: string }
      | undefined;
    if (row.deletedAt || (store === 'boards' && old && old.projectId !== row.projectId)) {
      const kind = store === 'projects' ? 'project' : 'board';
      const collections = await read(
        tx.objectStore('collections').index(kind).count(IDBKeyRange.only(row.id)),
      );
      const links =
        kind === 'board'
          ? await read(
              tx
                .objectStore('items')
                .index('board')
                .count(IDBKeyRange.only(['entity_link', 0, row.id])),
            )
          : 0;
      if (collections || links)
        throw new WorkspaceError(
          'Remove dataset projections and purge retained collections before moving or deleting their parent.',
        );
    }
    await read(tx.objectStore(store).put(row));
    await done;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Already completed. */
    }
    await done.catch(() => undefined);
    throw error;
  }
}
