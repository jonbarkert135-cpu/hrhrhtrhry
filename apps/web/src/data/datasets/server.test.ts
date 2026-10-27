import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatasetCollection } from '@nexus/domain';
import { collectionInput, datasetFixture, DATASET_TIME } from '@nexus/domain/test/datasets';
import { createDatasetRepository } from './factory.ts';
import { createRemoteDatasetRepository, type DatasetClient } from './server.ts';
import { createLocalWorkspaceRepository } from '../workspace/local.ts';

const scope = { projectId: 'project', boardId: null };
const collection = createDatasetCollection(
  collectionInput(),
  { workspaceId: 'org', orgId: 'org', ...scope },
  'owner',
  DATASET_TIME,
  'audit',
);
const items = datasetFixture();
afterEach(() => {
  vi.unstubAllGlobals();
});
describe('dataset repository mode and transport boundary', () => {
  it('delegates every operation with its bound project/board scope and preserves the payload', async () => {
    const client: DatasetClient = {
      list: vi
        .fn<DatasetClient['list']>()
        .mockResolvedValue({ items: [collection], nextCursor: null }),
      get: vi.fn<DatasetClient['get']>().mockResolvedValue(collection),
      create: vi.fn<DatasetClient['create']>().mockResolvedValue(collection),
      update: vi.fn<DatasetClient['update']>().mockResolvedValue(collection),
      remove: vi.fn<DatasetClient['remove']>().mockResolvedValue(collection),
      item: vi.fn<DatasetClient['item']>().mockResolvedValue(items[0]!),
      items: vi.fn<DatasetClient['items']>().mockResolvedValue({ items, nextCursor: null }),
      commit: vi.fn<DatasetClient['commit']>().mockResolvedValue({ collection, items }),
      restore: vi.fn<DatasetClient['restore']>().mockResolvedValue(collection),
      purge: vi.fn<DatasetClient['purge']>().mockResolvedValue(undefined),
      audit: vi.fn<DatasetClient['audit']>().mockResolvedValue({
        id: 'audit',
        collectionId: collection.id,
        actorId: 'owner',
        at: DATASET_TIME,
        action: 'items.changed',
        revision: 1,
        previousAuditRef: null,
        itemIds: ['version'],
      }),
    };
    const repo = createDatasetRepository({ mode: 'server', scope, client });
    expect(await repo.createCollection(collectionInput())).toEqual(collection);
    expect(await repo.getCollection('collection')).toEqual(collection);
    expect(await repo.listCollections({ limit: 10 })).toEqual({
      items: [collection],
      nextCursor: null,
    });
    await repo.listCollections();
    await repo.updateCollection('collection', 1, { name: 'Changed' });
    await repo.getItem('collection', 'version');
    expect(
      (await repo.listItems('collection', 'record', { limit: 2, recordId: 'record' })).items,
    ).toEqual(items);
    await repo.listItems('collection', 'source');
    const changes = [{ op: 'put' as const, item: items[0]! }];
    await repo.commit('collection', 1, changes);
    await repo.getAudit('collection', 'audit');
    await repo.deleteCollection('collection', 1);
    await repo.purgeCollection('collection', 2);
    await repo.restoreCollection('collection', 2);
    expect(client.restore).toHaveBeenCalledWith({
      ...scope,
      collectionId: 'collection',
      revision: 2,
    });
    expect(client.create).toHaveBeenCalledWith({ ...scope, collection: collectionInput() });
    expect(client.get).toHaveBeenCalledWith({ ...scope, collectionId: 'collection' });
    expect(client.list).toHaveBeenNthCalledWith(1, { ...scope, page: { limit: 10 } });
    expect(client.list).toHaveBeenNthCalledWith(2, scope);
    expect(client.items).toHaveBeenNthCalledWith(1, {
      ...scope,
      collectionId: 'collection',
      kind: 'record',
      page: { limit: 2, recordId: 'record' },
    });
    expect(client.items).toHaveBeenNthCalledWith(2, {
      ...scope,
      collectionId: 'collection',
      kind: 'source',
    });
    expect(client.commit).toHaveBeenCalledWith({
      ...scope,
      collectionId: 'collection',
      revision: 1,
      changes,
    });
    expect(client.update).toHaveBeenCalledWith({
      ...scope,
      collectionId: 'collection',
      revision: 1,
      patch: { name: 'Changed' },
    });
    expect(client.remove).toHaveBeenCalledWith({
      ...scope,
      collectionId: 'collection',
      revision: 1,
    });
    expect(client.purge).toHaveBeenCalledWith({
      ...scope,
      collectionId: 'collection',
      revision: 2,
    });
    expect(client.audit).toHaveBeenCalledWith({
      ...scope,
      collectionId: 'collection',
      auditRef: 'audit',
    });
    // Transport failures are surfaced, never replaced with empty or successful results.
    vi.mocked(client.get).mockRejectedValue(new Error('Permission denied'));
    await expect(
      createRemoteDatasetRepository(client, scope).getCollection('collection'),
    ).rejects.toThrow(/Permission/);
  });
  it('constructs a usable local repository without touching any network transport', async () => {
    const workspace = createLocalWorkspaceRepository();
    const project = await workspace.createProject({ name: 'Factory mode boundary' });
    vi.stubGlobal('fetch', () => {
      throw new Error('Unexpected network');
    });
    const repo = createDatasetRepository({
      mode: 'local',
      scope: {
        workspaceId: `factory-${project.id}`,
        orgId: null,
        projectId: project.id,
        boardId: null,
      },
      actorId: 'owner',
    });
    const data = await repo.createCollection(collectionInput());
    expect((await repo.getCollection(data.id)).scope.orgId).toBeNull();
  });
});
