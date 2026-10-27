import { openDatasetDatabase } from './storage.ts';
import {
  DataCollectionSchema,
  assertDatasetPurge,
  Sha256,
  SNIFF_WINDOW_BYTES,
  validateUpload,
  verifySniffedType,
  DatasetChangesSchema,
  DatasetError,
  DatasetIdSchema,
  createDatasetCollection,
  reviseCollection,
  restoreDatasetCollection,
  prepareDatasetChanges,
  datasetReferences,
  mapDatasetItem,
  pageLimit,
  parseDatasetInput,
  type DataCollection,
  type DatasetScope,
  type DatasetRepository,
  type DatasetItem,
  type DatasetAudit,
  type DatasetEvidence,
} from '@nexus/domain';
import { readBytes } from '../../files/upload.ts';
import { createBlobStore, type BlobStore } from '../opfs.ts';

interface CollectionRow {
  key: string;
  scope: string;
  id: string;
  active: number;
  data: DataCollection;
}
interface ItemRow {
  key: string;
  collection: string;
  id: string;
  kind: string;
  active: number;
  recordId?: string;
  versionNumber?: number;
  memberId?: string;
  refs: string[];
  data: DatasetItem;
}
const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Dataset storage request failed'));
  });
function storageError(error: unknown): Error {
  if (error instanceof DatasetError) return error;
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'ConstraintError'
  )
    return new DatasetError('CONFLICT', 'Dataset ID or version already exists');
  return new DatasetError(
    'STORAGE_UNAVAILABLE',
    'Dataset storage is unavailable; no changes were committed',
  );
}
function scan<T>(source: IDBIndex, range: IDBKeyRange, limit: number): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const rows: T[] = [];
    const req = source.openCursor(range);
    req.onerror = () => reject(req.error ?? new Error('Dataset storage request failed'));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || rows.length === limit) {
        resolve(rows);
        return;
      }
      rows.push(cursor.value as T);
      cursor.continue();
    };
  });
}
export function createLocalDatasetRepository(options: {
  scope: DatasetScope;
  actorId: string;
  factory?: IDBFactory;
  blobs?: BlobStore;
  now?: () => string;
  id?: () => string;
}) {
  const { scope, actorId } = options;
  if (scope.orgId !== null)
    throw new DatasetError('INVALID_FORMAT', 'Local storage cannot be bound to an organization');
  const factory = options.factory ?? globalThis.indexedDB;
  const blobs = options.blobs ?? createBlobStore();
  const now = options.now ?? (() => new Date().toISOString());
  const nextId = options.id ?? (() => crypto.randomUUID());
  const scopeKey = JSON.stringify([scope.workspaceId, actorId, scope.projectId, scope.boardId]);
  const collectionKey = (id: string): string => JSON.stringify([scopeKey, id]);
  const itemKey = (collectionId: string, id: string): string =>
    JSON.stringify([collectionKey(collectionId), id]);
  const blobNamespace = (collectionId: string): string =>
    `dataset-${new Sha256().update(new TextEncoder().encode(collectionKey(collectionId))).hex()}`;
  const verifiedFiles = new Map<string, DatasetEvidence>();
  let connection: Promise<IDBDatabase> | undefined;
  const open = (): Promise<IDBDatabase> =>
    (connection ??= openDatasetDatabase(factory).catch((error: unknown) => {
      connection = undefined;
      throw error;
    }));
  const transaction = async <T>(
    mode: IDBTransactionMode,
    run: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> => {
    try {
      const tx = (await open()).transaction(
        ['collections', 'items', 'audit', 'projects', 'boards', 'blobStaging'],
        mode,
      );
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error('Dataset storage request failed'));
        tx.onerror = () => reject(tx.error ?? new Error('Dataset storage request failed'));
      });
      // Attach a handler before work so an explicit abort cannot produce an unhandled rejection.
      void done.catch(() => undefined);
      try {
        const project = (await request(tx.objectStore('projects').get(scope.projectId))) as
          | { deletedAt: string | null }
          | undefined;
        if (!project || project.deletedAt !== null)
          throw new DatasetError('NOT_FOUND', 'Dataset project not found');
        if (scope.boardId) {
          const board = (await request(tx.objectStore('boards').get(scope.boardId))) as
            | { projectId: string; deletedAt: string | null }
            | undefined;
          if (!board || board.deletedAt !== null || board.projectId !== scope.projectId)
            throw new DatasetError('NOT_FOUND', 'Dataset board not found in project');
        }
        const value = await run(tx);
        await done;
        return value;
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* Already completed or aborted. */
        }
        await done.catch(() => undefined);
        throw error;
      }
    } catch (error) {
      throw storageError(error);
    }
  };
  const getCollection = async (
    tx: IDBTransaction,
    id: string,
    includeDeleted = false,
  ): Promise<DataCollection> => {
    parseDatasetInput(() => DatasetIdSchema.parse(id));
    const row = (await request(tx.objectStore('collections').get(collectionKey(id)))) as
      | CollectionRow
      | undefined;
    if (!row || (!includeDeleted && row.data.deletedAt !== null))
      throw new DatasetError('NOT_FOUND', 'Collection not found');
    return parseDatasetInput(() => DataCollectionSchema.parse(row.data));
  };
  const saveCollection = async (tx: IDBTransaction, data: DataCollection): Promise<void> => {
    await request(
      tx.objectStore('collections').put({
        key: collectionKey(data.id),
        scope: scopeKey,
        id: data.id,
        active: data.deletedAt === null ? 0 : 1,
        data,
      } satisfies CollectionRow),
    );
  };
  const audit = async (
    tx: IDBTransaction,
    data: DataCollection,
    action: string,
    previous: string | null,
    itemIds: string[] = [],
  ): Promise<void> => {
    const event: DatasetAudit = {
      id: data.auditRef,
      collectionId: data.id,
      actorId,
      at: data.updatedAt,
      action,
      revision: data.revision,
      previousAuditRef: previous,
      itemIds,
    };
    await request(
      tx
        .objectStore('audit')
        .add({ key: itemKey(data.id, event.id), collection: collectionKey(data.id), data: event }),
    );
  };
  const rowFor = (item: DatasetItem): ItemRow => ({
    key: itemKey(item.collectionId, item.id),
    collection: collectionKey(item.collectionId),
    id: item.id,
    kind: item.kind,
    active: item.deletedAt === null ? 0 : 1,
    ...(typeof item.recordId === 'string' ? { recordId: item.recordId } : {}),
    ...(item.kind === 'version' ? { versionNumber: item.number } : {}),
    ...(item.kind === 'member' ? { memberId: item.userId } : {}),
    refs: datasetReferences(item).map((ref) => itemKey(item.collectionId, ref.id)),
    data: item,
  });
  const repo: DatasetRepository = {
    listCollections: (input = {}) =>
      transaction('readonly', async (tx) => {
        const limit = pageLimit(input.limit);
        const rows = await scan<CollectionRow>(
          tx.objectStore('collections').index('scope'),
          IDBKeyRange.bound(
            [scopeKey, 0, input.cursor ?? ''],
            [scopeKey, 0, '\uffff'],
            Boolean(input.cursor),
          ),
          limit + 1,
        );
        return {
          items: rows
            .slice(0, limit)
            .map((r) => parseDatasetInput(() => DataCollectionSchema.parse(r.data))),
          nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
        };
      }),
    getCollection: (id) => transaction('readonly', (tx) => getCollection(tx, id)),
    createCollection: (input) =>
      transaction('readwrite', async (tx) => {
        const collection = createDatasetCollection(input, scope, actorId, now(), nextId());
        if (
          (await request(
            tx
              .objectStore('audit')
              .index('collection')
              .count(IDBKeyRange.only(collectionKey(collection.id))),
          )) > 0
        )
          throw new DatasetError('CONFLICT', 'Collection IDs cannot be reused');
        await request(
          tx.objectStore('collections').add({
            key: collectionKey(collection.id),
            scope: scopeKey,
            id: collection.id,
            active: 0,
            data: collection,
          } satisfies CollectionRow),
        );
        await audit(tx, collection, 'collection.created', null);
        return collection;
      }),
    updateCollection: (id, revision, patch) =>
      transaction('readwrite', async (tx) => {
        const old = await getCollection(tx, id);
        const updated = reviseCollection(old, revision, now(), nextId(), patch);
        await saveCollection(tx, updated);
        await audit(tx, updated, 'collection.updated', old.auditRef);
        return updated;
      }),
    deleteCollection: (id, revision) =>
      transaction('readwrite', async (tx) => {
        const old = await getCollection(tx, id);
        const updated = reviseCollection(old, revision, now(), nextId(), 'delete');
        await saveCollection(tx, updated);
        await audit(tx, updated, 'collection.deleted', old.auditRef);
        return updated;
      }),
    restoreCollection: (id, revision) =>
      transaction('readwrite', async (tx) => {
        const old = await getCollection(tx, id, true);
        const next = restoreDatasetCollection(old, revision, now(), nextId());
        await saveCollection(tx, next);
        await audit(tx, next, 'collection.restored', old.auditRef);
        return next;
      }),
    getItem: (collectionId, id) =>
      transaction('readonly', async (tx) => {
        await getCollection(tx, collectionId);
        const row = (await request(tx.objectStore('items').get(itemKey(collectionId, id)))) as
          | ItemRow
          | undefined;
        if (!row || row.data.deletedAt !== null)
          throw new DatasetError('NOT_FOUND', 'Dataset item not found');
        return parseDatasetInput(() => mapDatasetItem(row.data));
      }),
    listItems: (collectionId, kind, input = {}) =>
      transaction('readonly', async (tx) => {
        await getCollection(tx, collectionId);
        const limit = pageLimit(input.limit);
        const prefix = input.recordId
          ? [collectionKey(collectionId), kind, 0, input.recordId]
          : [collectionKey(collectionId), kind, 0];
        const rows = await scan<ItemRow>(
          tx.objectStore('items').index(input.recordId ? 'record' : 'page'),
          IDBKeyRange.bound(
            [...prefix, input.cursor ?? ''],
            [...prefix, '\uffff'],
            Boolean(input.cursor),
          ),
          limit + 1,
        );
        return {
          items: rows.slice(0, limit).map((r) => parseDatasetInput(() => mapDatasetItem(r.data))),
          nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
        };
      }),
    commit: (collectionId, revision, changes) =>
      transaction('readwrite', async (tx) => {
        parseDatasetInput(() => DatasetChangesSchema.parse(changes));
        const collection = await getCollection(tx, collectionId);
        const store = tx.objectStore('items');
        const existing = new Map<string, DatasetItem>();
        const ids = new Set(
          changes.flatMap((c) =>
            c.op === 'put' ? [c.item.id, ...datasetReferences(c.item).map((r) => r.id)] : [c.id],
          ),
        );
        for (const id of ids) {
          const row = (await request(store.get(itemKey(collectionId, id)))) as ItemRow | undefined;
          if (row) existing.set(id, row.data);
        }
        for (const item of [...existing.values()])
          for (const ref of datasetReferences(item)) {
            if (existing.has(ref.id)) continue;
            const row = (await request(store.get(itemKey(collectionId, ref.id)))) as
              | ItemRow
              | undefined;
            if (row) existing.set(ref.id, row.data);
          }
        const updated = reviseCollection(collection, revision, now(), nextId(), {});
        const items = prepareDatasetChanges(
          collection,
          revision,
          changes,
          existing,
          updated.updatedAt,
          updated.auditRef,
        );
        const replacements = new Map(items.map((item) => [item.id, item]));
        for (const item of items) {
          if (item.kind === 'entity_link' && item.deletedAt === null) {
            const board = (await request(tx.objectStore('boards').get(item.boardId))) as
              | { projectId: string; deletedAt: string | null }
              | undefined;
            if (!board || board.projectId !== scope.projectId || board.deletedAt !== null)
              throw new DatasetError('INVALID_FORMAT', 'Entity link board is outside this project');
          }
          if (item.kind === 'member')
            throw new DatasetError(
              'INVALID_FORMAT',
              'Local collections do not have organization memberships',
            );
          if (item.kind === 'evidence' && item.deletedAt === null) {
            const old = existing.get(item.id);
            const verified = verifiedFiles.get(item.fileId);
            const file = verified ?? (old?.kind === 'evidence' ? old : undefined);
            if (
              !file ||
              file.sha256 !== item.sha256 ||
              file.fileId !== item.fileId ||
              file.bytes !== item.bytes ||
              file.mime !== item.mime
            )
              throw new DatasetError(
                'INVALID_FORMAT',
                'Attach and verify evidence bytes before committing metadata',
              );
          }
          if (item.deletedAt !== null || item.kind === 'form_template') {
            const refs = await scan<ItemRow>(
              store.index('refs'),
              IDBKeyRange.only(itemKey(collectionId, item.id)),
              201,
            );
            for (const ref of refs) {
              const live = replacements.get(ref.id) ?? ref.data;
              if (live.deletedAt === null && datasetReferences(live).some((r) => r.id === item.id))
                throw new DatasetError(
                  'CONFLICT',
                  'A live item references this item; remove its references first',
                );
            }
            if (refs.length > 200)
              throw new DatasetError(
                'CONFLICT',
                'Too many dependent items; remove their references first',
              );
          }
        }
        for (const item of items) {
          await request(store.put(rowFor(item)));
          if (item.kind === 'evidence')
            await request(tx.objectStore('blobStaging').delete(itemKey(collectionId, item.fileId)));
        }
        await saveCollection(tx, updated);
        await audit(
          tx,
          updated,
          'items.changed',
          collection.auditRef,
          items.map((i) => i.id),
        );
        return { collection: updated, items };
      }),
    async purgeCollection(id, revision) {
      const data = await transaction('readonly', (tx) => getCollection(tx, id, true));
      assertDatasetPurge(data, revision, now());
      for (const active of [0, 1]) {
        let cursor = '';
        for (;;) {
          const rows = await transaction('readonly', (tx) =>
            scan<ItemRow>(
              tx.objectStore('items').index('page'),
              IDBKeyRange.bound(
                [collectionKey(id), 'evidence', active, cursor],
                [collectionKey(id), 'evidence', active, '\uffff'],
                cursor !== '',
              ),
              200,
            ),
          );
          if (!rows.length) break;
          for (const row of rows)
            if (row.data.kind === 'evidence')
              try {
                await blobs.remove(blobNamespace(id), row.data.fileId);
              } catch (error) {
                throw storageError(error);
              }
          cursor = rows[rows.length - 1]!.id;
        }
      }
      // The staging ledger survives a crash between OPFS writes and metadata commit.
      for (;;) {
        const pending = await transaction('readonly', (tx) =>
          scan<{ key: string; id: string }>(
            tx.objectStore('blobStaging').index('collection'),
            IDBKeyRange.bound([collectionKey(id), ''], [collectionKey(id), '\uffff']),
            200,
          ),
        );
        if (!pending.length) break;
        for (const file of pending) {
          try {
            await blobs.remove(blobNamespace(id), file.id);
          } catch {
            throw new DatasetError(
              'STORAGE_UNAVAILABLE',
              'Evidence cleanup is incomplete; retry purge',
            );
          }
          await transaction('readwrite', async (tx) => {
            await request(tx.objectStore('blobStaging').delete(file.key));
          });
        }
      }
      await transaction('readwrite', async (tx) => {
        const current = await getCollection(tx, id, true);
        assertDatasetPurge(current, revision, now());
        const prefix = `[${JSON.stringify(collectionKey(id))},`;
        await request(tx.objectStore('items').delete(IDBKeyRange.bound(prefix, `${prefix}\uffff`)));
        await request(tx.objectStore('collections').delete(collectionKey(id)));
        await audit(
          tx,
          { ...current, revision: revision + 1, updatedAt: now(), auditRef: nextId() },
          'collection.purged',
          current.auditRef,
        );
      });
    },
    getAudit: (collectionId, auditRef) =>
      transaction('readonly', async (tx) => {
        await getCollection(tx, collectionId);
        const row = (await request(
          tx.objectStore('audit').get(itemKey(collectionId, auditRef)),
        )) as { data: DatasetAudit } | undefined;
        if (!row) throw new DatasetError('NOT_FOUND', 'Dataset audit event not found');
        return row.data;
      }),
  };
  return {
    ...repo,
    async attachEvidence(
      collectionId: string,
      revision: number,
      evidence: DatasetEvidence,
      blob: Blob,
    ) {
      await repo.getCollection(collectionId);
      if (blobs.backend === 'memory')
        throw new DatasetError(
          'STORAGE_UNAVAILABLE',
          'Persistent file storage is required for evidence',
        );
      if (
        blob.size !== evidence.bytes ||
        blob.type !== evidence.mime ||
        blob.size > 100 * 1024 * 1024
      )
        throw new DatasetError('INVALID_FORMAT', 'Evidence type or size does not match');
      const rejected = validateUpload({
        filename: evidence.filename,
        declaredMime: evidence.mime,
        bytes: blob.size,
      });
      const sniff = verifySniffedType({
        filename: evidence.filename,
        head: await readBytes(blob.slice(0, SNIFF_WINDOW_BYTES)),
      });
      if (rejected || !sniff.ok)
        throw new DatasetError(
          'INVALID_FORMAT',
          rejected?.message ?? sniff.message ?? 'Unsafe evidence file',
        );
      const digest = new Sha256();
      for (let start = 0; start < blob.size; start += 1024 * 1024)
        digest.update(await readBytes(blob.slice(start, start + 1024 * 1024)));
      const hash = digest.hex();
      if (hash !== evidence.sha256)
        throw new DatasetError('INVALID_FORMAT', 'Evidence checksum does not match');
      const fileId = nextId();
      const item = { ...evidence, fileId };
      await transaction('readwrite', async (tx) => {
        await getCollection(tx, collectionId);
        await request(
          tx.objectStore('blobStaging').add({
            key: itemKey(collectionId, fileId),
            collection: collectionKey(collectionId),
            id: fileId,
          }),
        );
      });
      try {
        await blobs.put(blobNamespace(collectionId), fileId, blob);
        verifiedFiles.set(fileId, item);
        return await repo.commit(collectionId, revision, [{ op: 'put', item }]);
      } catch (error) {
        try {
          await blobs.remove(blobNamespace(collectionId), fileId);
          await transaction('readwrite', async (tx) => {
            await request(tx.objectStore('blobStaging').delete(itemKey(collectionId, fileId)));
          });
        } catch {
          /* Keep the staging ledger so retention purge can recover the orphan. */
        }
        throw storageError(error);
      } finally {
        verifiedFiles.delete(fileId);
      }
    },
    async readEvidence(collectionId: string, id: string): Promise<Blob> {
      const item = await repo.getItem(collectionId, id);
      if (item.kind !== 'evidence') throw new DatasetError('INVALID_FORMAT', 'Expected evidence');
      const blob = await blobs.get(blobNamespace(collectionId), item.fileId);
      if (!blob) throw new DatasetError('NOT_FOUND', 'Evidence bytes not found');
      return blob;
    },
    async close() {
      const previous = connection;
      connection = undefined;
      if (previous) await previous.then((db) => db.close()).catch(() => undefined);
    },
  };
}
