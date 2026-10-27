import { z } from 'zod';
import {
  DataCollectionSchema,
  datasetJson,
  DatasetIdSchema,
  DatasetItemSchema,
  mapDatasetItem,
  type DataCollection,
  type DatasetScope,
  type DatasetItem,
  type DatasetItemKind,
} from './model.ts';

export type DatasetErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_FORMAT'
  | 'CONFLICT'
  | 'STORAGE_UNAVAILABLE';
export class DatasetError extends Error {
  readonly code: DatasetErrorCode;
  constructor(code: DatasetErrorCode, message: string) {
    super(message);
    this.name = 'DatasetError';
    this.code = code;
  }
}
export const CreateCollectionSchema = DataCollectionSchema.pick({
  id: true,
  name: true,
  description: true,
  visibility: true,
  label: true,
  retentionDays: true,
});
export type CreateCollection = z.infer<typeof CreateCollectionSchema>;
export const CollectionPatchSchema = CreateCollectionSchema.omit({ id: true }).partial().strict();
export type CollectionPatch = z.infer<typeof CollectionPatchSchema>;
export const DatasetChangesSchema = z
  .array(
    z.discriminatedUnion('op', [
      z.object({ op: z.literal('put'), item: DatasetItemSchema }),
      z.object({ op: z.literal('delete'), id: DatasetIdSchema }),
      z.object({ op: z.literal('restore'), id: DatasetIdSchema }),
    ]),
  )
  .min(1)
  .max(100);
export type DatasetChange = z.infer<typeof DatasetChangesSchema>[number];
export interface DatasetPage<T> {
  items: T[];
  nextCursor: string | null;
}
export interface DatasetAudit {
  id: string;
  collectionId: string;
  actorId: string;
  at: string;
  action: string;
  revision: number;
  previousAuditRef: string | null;
  itemIds: string[];
}
export interface DatasetRepository {
  listCollections(options?: {
    cursor?: string | undefined;
    limit?: number | undefined;
  }): Promise<DatasetPage<DataCollection>>;
  getCollection(id: string): Promise<DataCollection>;
  createCollection(input: CreateCollection): Promise<DataCollection>;
  updateCollection(id: string, revision: number, patch: CollectionPatch): Promise<DataCollection>;
  deleteCollection(id: string, revision: number): Promise<DataCollection>;
  restoreCollection(id: string, revision: number): Promise<DataCollection>;
  getItem(collectionId: string, id: string): Promise<DatasetItem>;
  listItems(
    collectionId: string,
    kind: DatasetItemKind,
    options?: {
      cursor?: string | undefined;
      limit?: number | undefined;
      recordId?: string | undefined;
    },
  ): Promise<DatasetPage<DatasetItem>>;
  commit(
    collectionId: string,
    revision: number,
    changes: readonly DatasetChange[],
  ): Promise<{ collection: DataCollection; items: DatasetItem[] }>;
  purgeCollection(id: string, revision: number): Promise<void>;
  getAudit(collectionId: string, auditRef: string): Promise<DatasetAudit>;
}
export function pageLimit(value = 50): number {
  if (!Number.isInteger(value) || value < 1 || value > 200)
    throw new DatasetError('INVALID_FORMAT', 'Page size must be between 1 and 200');
  return value;
}
export function parseDatasetInput<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof DatasetError) throw error;
    throw new DatasetError(
      'INVALID_FORMAT',
      error instanceof Error ? error.message : 'Invalid dataset data',
    );
  }
}
export function createDatasetCollection(
  input: CreateCollection,
  scope: DatasetScope,
  ownerId: string,
  now: string,
  auditRef: string,
): DataCollection {
  const data = parseDatasetInput(() => CreateCollectionSchema.parse(datasetJson(input)));
  if (scope.orgId === null && data.visibility === 'organization')
    throw new DatasetError('INVALID_FORMAT', 'Local collections have no organization');
  return DataCollectionSchema.parse({
    ...data,
    format: 'raven.dataset.v1',
    scope,
    ownerId,
    revision: 1,
    auditRef,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    purgeAfter: null,
  });
}
export function reviseCollection(
  collection: DataCollection,
  revision: number,
  now: string,
  auditRef: string,
  patch: CollectionPatch | 'delete',
): DataCollection {
  assertRevision(collection, revision);
  const changes =
    patch === 'delete'
      ? {
          deletedAt: now,
          purgeAfter: new Date(Date.parse(now) + collection.retentionDays * 86400000).toISOString(),
        }
      : parseDatasetInput(() => CollectionPatchSchema.parse(patch));
  if (
    collection.scope.orgId === null &&
    'visibility' in changes &&
    changes.visibility === 'organization'
  )
    throw new DatasetError('INVALID_FORMAT', 'Local collections have no organization');
  return DataCollectionSchema.parse({
    ...collection,
    ...changes,
    revision: revision + 1,
    updatedAt: now,
    auditRef,
  });
}
export function assertRevision(collection: DataCollection, revision: number): void {
  if (collection.deletedAt !== null) throw new DatasetError('NOT_FOUND', 'Collection was deleted');
  if (collection.revision !== revision)
    throw new DatasetError('CONFLICT', 'Collection changed; reload before retrying');
}
const REFERENCE_FIELDS: Record<DatasetItemKind, Record<string, DatasetItemKind>> = {
  version: {},
  source: {},
  record: { versionId: 'version', templateId: 'form_template' },
  assertion: { recordId: 'record', sourceId: 'source', evidenceId: 'evidence' },
  evidence: { sourceId: 'source' },
  entity_link: { recordId: 'record' },
  relation: { recordId: 'record', targetRecordId: 'record', sourceId: 'source' },
  saved_view: {},
  form_template: {},
  member: {},
};
export function datasetReferences(
  item: DatasetItem,
): Array<{ field: string; id: string; kind: DatasetItemKind }> {
  return Object.entries(REFERENCE_FIELDS[item.kind]).flatMap(([field, kind]) => {
    const id = item[field];
    return typeof id === 'string' ? [{ field, id, kind }] : [];
  });
}
export function orderDatasetItems(items: DatasetItem[]): DatasetItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered: DatasetItem[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (item: DatasetItem): void => {
    if (done.has(item.id)) return;
    if (visiting.has(item.id))
      throw new DatasetError('INVALID_FORMAT', 'Cyclic dataset references');
    visiting.add(item.id);
    for (const ref of datasetReferences(item)) {
      const parent = byId.get(ref.id);
      if (parent) visit(parent);
    }
    visiting.delete(item.id);
    done.add(item.id);
    ordered.push(item);
  };
  items.forEach(visit);
  return ordered;
}
/** Validate only touched items/references, never load a collection's complete record set. */
export function prepareDatasetChanges(
  collection: DataCollection,
  revision: number,
  changes: readonly DatasetChange[],
  existing: ReadonlyMap<string, DatasetItem>,
  now: string,
  auditRef: string,
): DatasetItem[] {
  assertRevision(collection, revision);
  const parsed = parseDatasetInput(() => DatasetChangesSchema.parse(changes));
  const touched = new Set<string>();
  const result: DatasetItem[] = [];
  const state = new Map(existing);
  for (const change of parsed) {
    const id = change.op === 'put' ? change.item.id : change.id;
    if (touched.has(id))
      throw new DatasetError('INVALID_FORMAT', 'An item may be changed only once per transaction');
    touched.add(id);
    const old = existing.get(id);
    if (old?.deletedAt !== null && old !== undefined && change.op !== 'restore')
      throw new DatasetError('CONFLICT', 'Deleted item IDs cannot be reused');
    if (change.op === 'restore' && old?.deletedAt === null)
      throw new DatasetError('CONFLICT', 'Item is not deleted');
    if (old?.kind === 'version' && old.sealedAt !== null)
      throw new DatasetError('CONFLICT', 'Sealed versions are immutable');
    if (change.op !== 'put' && old === undefined)
      throw new DatasetError('NOT_FOUND', 'Dataset item not found');
    if (
      change.op === 'put' &&
      (change.item.collectionId !== collection.id ||
        (old && (old.kind !== change.item.kind || old.revision !== change.item.revision)))
    )
      throw new DatasetError('CONFLICT', 'Item scope, kind or revision does not match');
    const next = parseDatasetInput(() =>
      mapDatasetItem({
        ...(change.op === 'put' ? change.item : old),
        revision: (old?.revision ?? 0) + 1,
        auditRef,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
        deletedAt: change.op === 'delete' ? now : null,
      }),
    );
    state.set(id, next);
    result.push(next);
  }
  for (const item of result) {
    if (item.deletedAt !== null) continue;
    for (const ref of datasetReferences(item)) {
      const target = state.get(ref.id);
      if (
        !target ||
        target.kind !== ref.kind ||
        target.deletedAt !== null ||
        target.collectionId !== collection.id
      )
        throw new DatasetError('INVALID_FORMAT', `Missing live ${ref.kind} reference`);
    }
    if (item.kind === 'relation' && item.recordId === item.targetRecordId)
      throw new DatasetError('INVALID_FORMAT', 'A record cannot relate to itself');
    if (
      item.kind === 'form_template' &&
      new Set(item.fields.map((f) => f.id)).size !== item.fields.length
    )
      throw new DatasetError('INVALID_FORMAT', 'Duplicate form field IDs');
    if (
      item.kind === 'entity_link' &&
      item.decision === 'confirmed' &&
      (!item.assessment.assessedBy || !item.assessment.assessedAt)
    )
      throw new DatasetError(
        'INVALID_FORMAT',
        'Confirmed entity links require an explicit assessment',
      );
  }
  // The adapters additionally check persisted reverse references before deleting or replacing templates.
  for (const item of state.values()) {
    if (
      item.deletedAt === null &&
      datasetReferences(item).some(
        (ref) => touched.has(ref.id) && state.get(ref.id)?.deletedAt !== null,
      )
    )
      throw new DatasetError('CONFLICT', 'A live item still references the deleted item');
  }
  return result;
}

export function assertDatasetPurge(
  collection: DataCollection,
  revision: number,
  now: string,
): void {
  if (collection.revision !== revision)
    throw new DatasetError('CONFLICT', 'Collection changed; reload before retrying');
  if (
    !collection.deletedAt ||
    !collection.purgeAfter ||
    Date.parse(collection.purgeAfter) > Date.parse(now)
  )
    throw new DatasetError(
      'CONFLICT',
      'Soft delete and wait for the retention deadline before purging',
    );
}

export function restoreDatasetCollection(
  collection: DataCollection,
  revision: number,
  now: string,
  auditRef: string,
): DataCollection {
  if (collection.revision !== revision)
    throw new DatasetError('CONFLICT', 'Collection changed; reload before retrying');
  if (
    !collection.deletedAt ||
    !collection.purgeAfter ||
    Date.parse(now) >= Date.parse(collection.purgeAfter)
  )
    throw new DatasetError(
      'CONFLICT',
      'Collection can only be restored before its retention deadline',
    );
  return DataCollectionSchema.parse({
    ...collection,
    revision: revision + 1,
    updatedAt: now,
    auditRef,
    deletedAt: null,
    purgeAfter: null,
  });
}
