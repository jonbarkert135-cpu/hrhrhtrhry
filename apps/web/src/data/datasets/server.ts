/** React-free tRPC bridge. This module is never constructed by the local factory. */
import type { DatasetInputs as Inputs, DatasetOutputs as Outputs } from '@nexus/api';
import type { DatasetRepository } from '@nexus/domain';

export interface DatasetClient {
  list: (input: Inputs['list']) => Promise<Outputs['list']>;
  get: (input: Inputs['get']) => Promise<Outputs['get']>;
  create: (input: Inputs['create']) => Promise<Outputs['create']>;
  update: (input: Inputs['update']) => Promise<Outputs['update']>;
  remove: (input: Inputs['remove']) => Promise<Outputs['remove']>;
  item: (input: Inputs['item']) => Promise<Outputs['item']>;
  items: (input: Inputs['items']) => Promise<Outputs['items']>;
  commit: (input: Inputs['commit']) => Promise<Outputs['commit']>;
  restore: (input: Inputs['restore']) => Promise<Outputs['restore']>;
  purge: (input: Inputs['purge']) => Promise<Outputs['purge']>;
  audit: (input: Inputs['audit']) => Promise<Outputs['audit']>;
}
export function createRemoteDatasetRepository(
  client: DatasetClient,
  scope: { projectId: string; boardId?: string | null },
): DatasetRepository {
  return {
    listCollections: (page) => client.list({ ...scope, ...(page ? { page } : {}) }),
    getCollection: (collectionId) => client.get({ ...scope, collectionId }),
    createCollection: (collection) => client.create({ ...scope, collection }),
    updateCollection: (collectionId, revision, patch) =>
      client.update({ ...scope, collectionId, revision, patch }),
    deleteCollection: (collectionId, revision) =>
      client.remove({ ...scope, collectionId, revision }),
    restoreCollection: (collectionId, revision) =>
      client.restore({ ...scope, collectionId, revision }),
    purgeCollection: (collectionId, revision) => client.purge({ ...scope, collectionId, revision }),
    getItem: (collectionId, id) => client.item({ ...scope, collectionId, id }),
    listItems: (collectionId, kind, page) =>
      client.items({ ...scope, collectionId, kind, ...(page ? { page } : {}) }),
    commit: (collectionId, revision, changes) =>
      client.commit({ ...scope, collectionId, revision, changes: [...changes] }),
    getAudit: (collectionId, auditRef) => client.audit({ ...scope, collectionId, auditRef }),
  };
}
