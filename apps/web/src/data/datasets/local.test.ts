import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBIndex, IDBCursor } from 'fake-indexeddb';
import * as Y from 'yjs';
import { Sha256, createFormVersion, personFormFields, type DatasetItem } from '@nexus/domain';
import {
  collectionInput,
  datasetFixture,
  datasetItem,
  DATASET_TIME,
} from '@nexus/domain/test/datasets';
import { createLocalWorkspaceRepository } from '../workspace/local.ts';
import { createLocalDatasetRepository } from './local.ts';
import type { BlobStore } from '../opfs.ts';

let scope: { workspaceId: string; orgId: null; projectId: string; boardId: null };
let otherProjectId: string;
let factory: IDBFactory;
let repos: ReturnType<typeof createLocalDatasetRepository>[];
let blobData: Map<string, Blob>;
const create = (over: Partial<Parameters<typeof createLocalDatasetRepository>[0]> = {}) => {
  const blobs: BlobStore = {
    backend: 'indexeddb',
    put: (ns, id, blob) => {
      blobData.set(`${ns}/${id}`, blob);
      return Promise.resolve();
    },
    get: (ns, id) => Promise.resolve(blobData.get(`${ns}/${id}`) ?? null),
    remove: (ns, id) => {
      blobData.delete(`${ns}/${id}`);
      return Promise.resolve();
    },
  };
  const repo = createLocalDatasetRepository({
    scope,
    actorId: 'owner',
    factory,
    blobs,
    now: () => DATASET_TIME,
    ...over,
  });
  repos.push(repo);
  return repo;
};
beforeEach(async () => {
  factory = new IDBFactory();
  const workspace = createLocalWorkspaceRepository({ factory });
  scope = {
    workspaceId: 'workspace',
    orgId: null,
    projectId: (await workspace.createProject({ name: 'Synthetic' })).id,
    boardId: null,
  };
  otherProjectId = (await workspace.createProject({ name: 'Other synthetic' })).id;
  repos = [];
  blobData = new Map();
  vi.stubGlobal('fetch', () => {
    throw new Error('Local datasets must never use fetch');
  });
});
afterEach(async () => {
  await Promise.all(repos.map((r) => r.close()));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const put = (items: DatasetItem[]) => items.map((item) => ({ op: 'put' as const, item }));

describe('offline dataset repository', () => {
  it('publishes immutable form versions atomically across tabs and keeps existing record definitions', async () => {
    const repo = create();
    const collection = await repo.createCollection(collectionInput());
    const first = createFormVersion({
      collection,
      familyId: 'person',
      version: 1,
      name: 'Person',
      fields: personFormFields(),
      now: DATASET_TIME,
    });
    const fixture = datasetFixture();
    const record = fixture.find((item) => item.kind === 'record')!;
    await repo.commit(
      collection.id,
      1,
      put([
        first,
        ...fixture.filter((item) => item.kind !== 'record'),
        { ...record, templateId: first.id },
      ]),
    );
    const second = createFormVersion({
      collection,
      familyId: 'person',
      version: 2,
      name: 'Person',
      fields: first.fields.map((field) =>
        field.id === 'full_name' ? { ...field, type: 'email' as const } : field,
      ),
      now: DATASET_TIME,
      previous: first,
    });
    const results = await Promise.allSettled([
      repo.commit(collection.id, 2, put([second])),
      create().commit(collection.id, 2, put([second])),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const before = await repo.getCollection(collection.id);
    await expect(
      repo.commit(collection.id, 3, put([{ ...first, name: 'Overwrite' }])),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await repo.getCollection(collection.id)).toEqual(before);
    await repo.close();
    const reopened = create();
    expect((await reopened.getItem(collection.id, 'record')).templateId).toBe(first.id);
    const forms = await reopened.listItems(collection.id, 'form_template');
    expect(forms.items.map((item) => item.id)).toEqual([first.id, second.id]);
    const [v1, v2] = forms.items;
    if (v1?.kind !== 'form_template' || v2?.kind !== 'form_template')
      throw new Error('Expected two forms');
    expect(v1.fields.find((field) => field.id === 'full_name')?.type).toBe('text');
    expect(v2.fields.find((field) => field.id === 'full_name')?.type).toBe('email');
    await expect(
      reopened.commit(collection.id, 3, [{ op: 'delete', id: first.id }]),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await reopened.commit(collection.id, 3, [{ op: 'delete', id: second.id }]);
    await reopened.commit(collection.id, 4, [{ op: 'restore', id: second.id }]);
    expect((await reopened.getItem(collection.id, second.id)).name).toBe('Person');
  });

  it('restores soft-deleted records atomically and collections only within retention', async () => {
    const repo = create();
    await repo.createCollection(collectionInput());
    await repo.commit('collection', 1, put(datasetFixture()));
    await repo.commit('collection', 2, [
      { op: 'delete', id: 'assertion' },
      { op: 'delete', id: 'record' },
    ]);
    await expect(repo.getItem('collection', 'record')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(repo.commit('collection', 3, put([datasetFixture()[2]!]))).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const restored = await repo.commit('collection', 3, [
      { op: 'restore', id: 'record' },
      { op: 'restore', id: 'assertion' },
    ]);
    expect(restored.items.map((i) => i.deletedAt)).toEqual([null, null]);
    expect((await repo.getItem('collection', 'record')).createdAt).toBe(DATASET_TIME);
    await repo.deleteCollection('collection', 4);
    const active = await repo.restoreCollection('collection', 5);
    expect(active.deletedAt).toBeNull();
    expect(active.purgeAfter).toBeNull();
    expect((await repo.getAudit('collection', active.auditRef)).action).toBe('collection.restored');
    const deleted = await repo.deleteCollection('collection', 6);
    await expect(
      create({ now: () => deleted.purgeAfter! }).restoreCollection('collection', 7),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('upgrades legacy workspace metadata without changing projects or boards', async () => {
    const legacy = new IDBFactory();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = legacy.open('raven-workspace', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('projects', { keyPath: 'id' });
        req.result
          .createObjectStore('boards', { keyPath: 'id' })
          .createIndex('projectId', 'projectId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Legacy fixture failed'));
    });
    const tx = db.transaction(['projects', 'boards'], 'readwrite');
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('Legacy fixture failed'));
    });
    tx.objectStore('projects').put({
      id: 'legacy-project',
      name: 'Legacy',
      color: null,
      icon: null,
      archivedAt: null,
      deletedAt: null,
      createdAt: DATASET_TIME,
      futureField: 'preserved',
    });
    tx.objectStore('boards').put({
      id: 'legacy-board',
      projectId: 'legacy-project',
      title: 'Legacy board',
      archivedAt: null,
      deletedAt: null,
      createdAt: DATASET_TIME,
    });
    await done;
    db.close();
    const workspace = createLocalWorkspaceRepository({ factory: legacy });
    expect((await workspace.listProjects())[0]).toMatchObject({
      id: 'legacy-project',
      futureField: 'preserved',
    });
    expect((await workspace.listBoards('legacy-project'))[0]?.title).toBe('Legacy board');
    const repo = create({ factory: legacy, scope: { ...scope, projectId: 'legacy-project' } });
    await repo.createCollection(collectionInput());
    expect((await repo.getCollection('collection')).revision).toBe(1);
  });
  it('serializes parent deletion against collection creation across repository instances', async () => {
    const repo = create();
    const workspace = createLocalWorkspaceRepository({ factory });
    const results = await Promise.allSettled([
      repo.createCollection(collectionInput()),
      workspace.deleteProject({ projectId: scope.projectId, confirmName: 'Synthetic' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    if (results[0]?.status === 'fulfilled')
      expect((await workspace.listProjects()).some((p) => p.id === scope.projectId)).toBe(true);
    else
      await expect(repo.getCollection('collection')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('persists collections, versions, records, sources and audit across reopen', async () => {
    const repo = create();
    const created = await repo.createCollection(collectionInput());
    const result = await repo.commit(created.id, 1, put(datasetFixture().reverse()));
    expect(result.collection.revision).toBe(2);
    expect((await repo.getAudit(created.id, result.collection.auditRef)).itemIds).toContain(
      'source',
    );
    await repo.close();
    const reopened = create();
    expect((await reopened.getCollection(created.id)).name).toBe('Fictional research');
    expect((await reopened.listItems(created.id, 'record')).items).toHaveLength(1);
    const source = await reopened.getItem(created.id, 'source');
    const updated = await reopened.commit(
      created.id,
      2,
      put([{ ...source, name: 'Renamed source' }]),
    );
    expect(updated.items[0]?.revision).toBe(2);
    expect((await reopened.updateCollection(created.id, 3, { name: 'Renamed' })).name).toBe(
      'Renamed',
    );
  });
  it('isolates workspace, project and owner namespaces, including equal collection IDs', async () => {
    const a = create();
    await a.createCollection(collectionInput());
    for (const b of [
      create({ scope: { ...scope, workspaceId: 'other' } }),
      create({ scope: { ...scope, projectId: otherProjectId } }),
      create({ actorId: 'other' }),
    ]) {
      expect((await b.listCollections()).items).toEqual([]);
      await expect(b.getCollection('collection')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await b.createCollection(collectionInput());
    }
    expect((await a.listCollections()).items).toHaveLength(1);
    await expect(
      createLocalWorkspaceRepository({ factory }).deleteProject({
        projectId: scope.projectId,
        confirmName: 'Synthetic',
      }),
    ).rejects.toThrow(/purge retained/);
    await expect(
      create({ scope: { ...scope, projectId: 'missing-project' } }).createCollection(
        collectionInput(),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(() => create({ scope: { ...scope, orgId: 'org' } })).toThrow(/organization/);
  });
  it('rolls back the entire batch, metadata revision and audit on a unique-index failure', async () => {
    const repo = create();
    const created = await repo.createCollection(collectionInput());
    const version = datasetFixture()[0]!;
    await expect(
      repo.commit(created.id, 1, put([version, { ...version, id: 'duplicate-number' }])),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await repo.getCollection(created.id)).auditRef).toBe(created.auditRef);
    expect((await repo.listItems(created.id, 'version')).items).toEqual([]);
    await expect(repo.createCollection(collectionInput())).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
  it('rejects dangling/cross-collection references and detects concurrent writes', async () => {
    const repo = create();
    await repo.createCollection(collectionInput());
    await repo.commit('collection', 1, put(datasetFixture()));
    await expect(
      repo.commit('collection', 2, [{ op: 'delete', id: 'source' }]),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      repo.commit(
        'collection',
        2,
        put([
          datasetItem({
            id: 'invalid',
            kind: 'record',
            versionId: 'absent',
            templateId: null,
            title: '',
            rowIndex: null,
          }),
        ]),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_FORMAT' });
    const results = await Promise.allSettled([
      repo.updateCollection('collection', 2, { name: 'one' }),
      repo.updateCollection('collection', 2, { name: 'two' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(
      repo.commit(
        'collection',
        3,
        put([datasetItem({ id: 'member', kind: 'member', userId: 'person', role: 'editor' })]),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_FORMAT' });
  });
  it('supports bounded cursor pages, record filters, deletion and retention tombstones', async () => {
    const repo = create();
    await repo.createCollection(collectionInput());
    await repo.createCollection(collectionInput('second'));
    const first = await repo.listCollections({ limit: 1 });
    expect(first.nextCursor).not.toBeNull();
    expect(
      (await repo.listCollections({ limit: 1, cursor: first.nextCursor! })).items,
    ).toHaveLength(1);
    await repo.commit('collection', 1, put(datasetFixture()));
    expect(
      (await repo.listItems('collection', 'assertion', { recordId: 'record' })).items,
    ).toHaveLength(1);
    await repo.commit('collection', 2, [
      { op: 'delete', id: 'assertion' },
      { op: 'delete', id: 'record' },
      { op: 'delete', id: 'source' },
      { op: 'delete', id: 'version' },
    ]);
    await expect(repo.getItem('collection', 'record')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await repo.deleteCollection('collection', 3);
    await expect(repo.listItems('collection', 'record')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await repo.listCollections()).items.map((c) => c.id)).toEqual(['second']);
    await expect(repo.getAudit('second', 'absent')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(repo.listItems('second', 'record', { limit: 500 })).rejects.toMatchObject({
      code: 'INVALID_FORMAT',
    });
  });
  it('verifies and persists local evidence bytes, cleans failed writes and never uses a server', async () => {
    const repo = create();
    await repo.createCollection(collectionInput());
    await repo.commit('collection', 1, put(datasetFixture()));
    const bytes = new TextEncoder().encode('Fictional evidence');
    const blob = new Blob([bytes], { type: 'text/plain' });
    const evidence = datasetItem({
      id: 'evidence',
      kind: 'evidence',
      sourceId: 'source',
      fileId: 'untrusted',
      filename: 'example.txt',
      mime: 'text/plain',
      bytes: blob.size,
      sha256: new Sha256().update(bytes).hex(),
    });
    if (evidence.kind !== 'evidence') throw new Error('Expected evidence fixture');
    await repo.attachEvidence('collection', 2, evidence, blob);
    expect((await repo.readEvidence('collection', 'evidence')).size).toBe(blob.size);
    expect(blobData.size).toBe(1);
    await expect(
      repo.attachEvidence('collection', 2, { ...evidence, id: 'retry' }, blob),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(blobData.size).toBe(1);
    await expect(
      repo.attachEvidence('collection', 3, { ...evidence, sha256: '0'.repeat(64) }, blob),
    ).rejects.toMatchObject({ code: 'INVALID_FORMAT' });
    const deleted = await repo.deleteCollection('collection', 3);
    await expect(repo.purgeCollection('collection', 4)).rejects.toMatchObject({ code: 'CONFLICT' });
    const maintenance = create({ now: () => deleted.purgeAfter! });
    await maintenance.purgeCollection('collection', 4);
    expect(blobData.size).toBe(0);
    await expect(maintenance.createCollection(collectionInput())).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(repo.readEvidence('collection', 'record')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      repo.commit('collection', 3, put([{ ...evidence, id: 'forged', fileId: 'another' }])),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('recovers staged evidence after a failed device write and a repository restart', async () => {
    let offline = true;
    const blobs: BlobStore = {
      backend: 'indexeddb',
      put: (ns, id, blob) => {
        blobData.set(`${ns}/${id}`, blob);
        return Promise.reject(new Error('Device write interrupted'));
      },
      get: (ns, id) => Promise.resolve(blobData.get(`${ns}/${id}`) ?? null),
      remove: (ns, id) => {
        if (offline) return Promise.reject(new Error('Device offline'));
        blobData.delete(`${ns}/${id}`);
        return Promise.resolve();
      },
    };
    const repo = create({ blobs });
    await repo.createCollection(collectionInput());
    await repo.commit('collection', 1, put(datasetFixture()));
    const bytes = new TextEncoder().encode('Fictional evidence');
    const blob = new Blob([bytes], { type: 'text/plain' });
    const item = datasetItem({
      id: 'proof',
      kind: 'evidence',
      sourceId: 'source',
      fileId: 'pending',
      sha256: new Sha256().update(bytes).hex(),
      bytes: blob.size,
      filename: 'fictional.txt',
      mime: 'text/plain',
    });
    if (item.kind !== 'evidence') throw new Error('Expected evidence fixture');
    await expect(repo.attachEvidence('collection', 2, item, blob)).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
    });
    expect((await repo.listItems('collection', 'evidence')).items).toEqual([]);
    expect(blobData.size).toBe(1);
    const deleted = await repo.deleteCollection('collection', 2);
    await repo.close();
    const reopened = create({ blobs, now: () => deleted.purgeAfter! });
    await expect(reopened.purgeCollection('collection', 3)).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
    });
    offline = false;
    await reopened.purgeCollection('collection', 3);
    expect(blobData.size).toBe(0);
  });

  it('reads one indexed page out of 100k records without getAll or loading any graph', async () => {
    const repo = create();
    await repo.createCollection(collectionInput());
    await repo.commit('collection', 1, put([datasetFixture()[0]!]));
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open('raven-workspace', 2);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Dataset storage request failed'));
    });
    const namespace = JSON.stringify([
      JSON.stringify([scope.workspaceId, 'owner', scope.projectId, scope.boardId]),
      'collection',
    ]);
    const record = datasetFixture()[2]!;
    const tx = db.transaction('items', 'readwrite');
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('Dataset storage request failed'));
    });
    for (let i = 0; i < 100_000; i++) {
      const id = `r${String(i).padStart(6, '0')}`;
      tx.objectStore('items').add({
        key: JSON.stringify([namespace, id]),
        collection: namespace,
        kind: 'record',
        active: 0,
        id,
        refs: [],
        data: { ...record, id },
      });
    }
    await done;
    db.close();
    vi.spyOn(IDBIndex.prototype, 'getAll').mockImplementation(() => {
      throw new Error('Unbounded read');
    });
    vi.spyOn(Y.Doc.prototype, 'getMap').mockImplementation(() => {
      throw new Error('Graph was loaded');
    });
    const calls = vi.spyOn(IDBCursor.prototype, 'continue');
    const page = await repo.listItems('collection', 'record', { limit: 20, cursor: 'r050000' });
    expect(page.items).toHaveLength(20);
    expect(page.items[0]?.id).toBe('r050001');
    expect(page.nextCursor).toBe('r050020');
    expect(calls.mock.calls.length).toBeLessThanOrEqual(22);
  }, 90_000);
});
