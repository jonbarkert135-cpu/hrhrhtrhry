import { getStorage } from '../files/storage.ts';
import { Prisma, type PrismaClient } from '@nexus/db';
import {
  DataCollectionSchema,
  assertDatasetPurge,
  DatasetError,
  DatasetIdSchema,
  DatasetChangesSchema,
  createDatasetCollection,
  reviseCollection,
  restoreDatasetCollection,
  prepareDatasetChanges,
  datasetReferences,
  orderDatasetItems,
  mapDatasetItem,
  pageLimit,
  parseDatasetInput,
  type DataCollection,
  type DatasetScope,
  type DatasetRepository,
  type DatasetAudit,
} from '@nexus/domain';

type Tx = Prisma.TransactionClient;
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export function createServerDatasetRepository(options: {
  db: PrismaClient;
  actorId: string;
  orgId: string;
  projectId: string;
  boardId?: string | null;
  now?: () => string;
  id?: () => string;
  removeBlob?: (key: string) => Promise<void>;
}): DatasetRepository & { assertAccess: (id: string, write: boolean) => Promise<DataCollection> } {
  const { db, actorId, orgId, projectId } = options;
  const scope: DatasetScope = {
    workspaceId: orgId,
    orgId,
    projectId,
    boardId: options.boardId ?? null,
  };
  const now = options.now ?? (() => new Date().toISOString());
  const nextId = options.id ?? (() => crypto.randomUUID());
  const whereScope = { orgId, projectId, boardId: scope.boardId, deletedAt: null };
  const run = async <T>(write: boolean, work: (tx: Tx, role: string) => Promise<T>): Promise<T> => {
    try {
      return await db.$transaction(
        async (tx) => {
          const membership = await tx.membership.findUnique({
            where: { orgId_userId: { orgId, userId: actorId } },
            include: {
              org: { select: { deletedAt: true } },
              user: { select: { deletedAt: true } },
            },
          });
          if (
            !membership ||
            membership.joinedAt === null ||
            membership.org.deletedAt !== null ||
            membership.user.deletedAt !== null ||
            (write && membership.role === 'viewer')
          )
            throw new DatasetError('FORBIDDEN', 'Dataset permission denied');
          const project = await tx.project.findFirst({
            where: { id: projectId, orgId, deletedAt: null },
          });
          if (!project) throw new DatasetError('NOT_FOUND', 'Project not found');
          if (
            scope.boardId &&
            !(await tx.board.findFirst({
              where: { id: scope.boardId, orgId, projectId, deletedAt: null },
            }))
          )
            throw new DatasetError('NOT_FOUND', 'Board not found in this project');
          return work(tx, membership.role);
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (error instanceof DatasetError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (['P2002', 'P2034'].includes(error.code))
          throw new DatasetError(
            'CONFLICT',
            'Dataset changed or ID/version already exists; reload before retrying',
          );
        if (['P2003', 'P2025'].includes(error.code))
          throw new DatasetError(
            'INVALID_FORMAT',
            'Dataset reference does not exist in this scope',
          );
      }
      throw error;
    }
  };
  const collection = async (
    tx: Tx,
    id: string,
    role: string,
    write: boolean,
    manage = false,
    includeDeleted = false,
  ): Promise<DataCollection> => {
    parseDatasetInput(() => DatasetIdSchema.parse(id));
    const row = await tx.dataCollection.findFirst({
      where: { id, ...whereScope, ...(includeDeleted ? { deletedAt: { not: null } } : {}) },
    });
    if (!row) throw new DatasetError('NOT_FOUND', 'Collection not found');
    const data = parseDatasetInput(() => DataCollectionSchema.parse(row.payload));
    if (data.ownerId === actorId || role === 'owner' || role === 'admin') return data;
    if (manage)
      throw new DatasetError(
        'FORBIDDEN',
        'Only the collection owner or an organization admin may manage this collection',
      );
    const member = await tx.dataEntry.findFirst({
      where: { collectionId: id, kind: 'member', memberUserId: actorId, deletedAt: null },
    });
    const memberRole = member ? parseDatasetInput(() => mapDatasetItem(member.payload)) : null;
    if (memberRole?.kind === 'member') {
      if (write && memberRole.role !== 'editor')
        throw new DatasetError('FORBIDDEN', 'Collection is read-only');
      return data;
    }
    if (data.visibility === 'private' || data.label === 'restricted')
      throw new DatasetError('FORBIDDEN', 'Collection is private');
    return data;
  };
  const event = async (
    tx: Tx,
    data: DataCollection,
    action: string,
    previous: string | null,
    itemIds: string[] = [],
  ): Promise<void> => {
    const payload: DatasetAudit = {
      id: data.auditRef,
      collectionId: data.id,
      actorId,
      at: data.updatedAt,
      action,
      revision: data.revision,
      previousAuditRef: previous,
      itemIds,
    };
    await tx.dataAudit.create({
      data: {
        id: payload.id,
        collectionId: data.id,
        orgId,
        projectId,
        actorId,
        payload: json(payload),
        createdAt: new Date(payload.at),
      },
    });
  };
  const update = async (tx: Tx, previous: DataCollection, next: DataCollection): Promise<void> => {
    const result = await tx.dataCollection.updateMany({
      where: { id: previous.id, orgId, projectId, revision: previous.revision, deletedAt: null },
      data: {
        revision: next.revision,
        payload: json(next),
        deletedAt: next.deletedAt ? new Date(next.deletedAt) : null,
        purgeAfter: next.purgeAfter ? new Date(next.purgeAfter) : null,
      },
    });
    if (result.count !== 1)
      throw new DatasetError('CONFLICT', 'Collection changed; reload before retrying');
  };
  return {
    assertAccess: (id, write) => run(write, (tx, role) => collection(tx, id, role, write)),
    listCollections: (input = {}) =>
      run(false, async (tx, role) => {
        const limit = pageLimit(input.limit);
        const visibility: Prisma.DataCollectionWhereInput =
          role === 'admin' || role === 'owner'
            ? {}
            : {
                OR: [
                  { ownerId: actorId },
                  {
                    AND: [
                      { payload: { path: ['visibility'], not: 'private' } },
                      { payload: { path: ['label'], not: 'restricted' } },
                    ],
                  },
                  { entries: { some: { kind: 'member', memberUserId: actorId, deletedAt: null } } },
                ],
              };
        const rows = await tx.dataCollection.findMany({
          where: {
            ...whereScope,
            ...visibility,
            ...(input.cursor ? { id: { gt: input.cursor } } : {}),
          },
          orderBy: { id: 'asc' },
          take: limit + 1,
        });
        return {
          items: rows
            .slice(0, limit)
            .map((r) => parseDatasetInput(() => DataCollectionSchema.parse(r.payload))),
          nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
        };
      }),
    getCollection: (id) => run(false, (tx, role) => collection(tx, id, role, false)),
    createCollection: (input) =>
      run(true, async (tx) => {
        const data = createDatasetCollection(input, scope, actorId, now(), nextId());
        if (
          await tx.dataAudit.findFirst({ where: { collectionId: data.id }, select: { id: true } })
        )
          throw new DatasetError('CONFLICT', 'Collection IDs cannot be reused');
        await tx.dataCollection.create({
          data: {
            id: data.id,
            orgId,
            projectId,
            boardId: scope.boardId,
            ownerId: actorId,
            revision: data.revision,
            payload: json(data),
            createdAt: new Date(data.createdAt),
          },
        });
        await event(tx, data, 'collection.created', null);
        return data;
      }),
    updateCollection: (id, revision, patch) =>
      run(true, async (tx, role) => {
        const old = await collection(tx, id, role, true, true);
        const next = reviseCollection(old, revision, now(), nextId(), patch);
        await update(tx, old, next);
        await event(tx, next, 'collection.updated', old.auditRef);
        return next;
      }),
    deleteCollection: (id, revision) =>
      run(true, async (tx, role) => {
        const old = await collection(tx, id, role, true, true);
        const next = reviseCollection(old, revision, now(), nextId(), 'delete');
        await update(tx, old, next);
        await event(tx, next, 'collection.deleted', old.auditRef);
        return next;
      }),
    restoreCollection: (id, revision) =>
      run(true, async (tx, role) => {
        const old = await collection(tx, id, role, true, true, true);
        const next = restoreDatasetCollection(old, revision, now(), nextId());
        const result = await tx.dataCollection.updateMany({
          where: { id, orgId, projectId, revision, deletedAt: { not: null } },
          data: { revision: next.revision, payload: json(next), deletedAt: null, purgeAfter: null },
        });
        if (result.count !== 1)
          throw new DatasetError('CONFLICT', 'Collection changed; reload before retrying');
        await event(tx, next, 'collection.restored', old.auditRef);
        return next;
      }),
    getItem: (collectionId, id) =>
      run(false, async (tx, role) => {
        await collection(tx, collectionId, role, false);
        const row = await tx.dataEntry.findFirst({ where: { collectionId, id, deletedAt: null } });
        if (!row) throw new DatasetError('NOT_FOUND', 'Dataset item not found');
        return parseDatasetInput(() => mapDatasetItem(row.payload));
      }),
    listItems: (collectionId, kind, input = {}) =>
      run(false, async (tx, role) => {
        await collection(tx, collectionId, role, false);
        const limit = pageLimit(input.limit);
        const rows = await tx.dataEntry.findMany({
          where: {
            collectionId,
            kind,
            deletedAt: null,
            ...(input.recordId ? { recordId: input.recordId } : {}),
            ...(input.cursor ? { id: { gt: input.cursor } } : {}),
          },
          orderBy: { id: 'asc' },
          take: limit + 1,
        });
        return {
          items: rows
            .slice(0, limit)
            .map((r) => parseDatasetInput(() => mapDatasetItem(r.payload))),
          nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
        };
      }),
    commit: (collectionId, revision, changes) =>
      run(true, async (tx, role) => {
        parseDatasetInput(() => DatasetChangesSchema.parse(changes));
        const old = await collection(
          tx,
          collectionId,
          role,
          true,
          changes.some((c) => c.op === 'put' && c.item.kind === 'member'),
        );
        const next = reviseCollection(old, revision, now(), nextId(), {});
        // CAS also serializes two writers before reference/deletion checks; everything rolls back on error.
        await update(tx, old, next);
        const ids = Array.from(
          new Set(
            changes.flatMap((c) =>
              c.op === 'put' ? [c.item.id, ...datasetReferences(c.item).map((r) => r.id)] : [c.id],
            ),
          ),
        );
        const rows = await tx.dataEntry.findMany({ where: { collectionId, id: { in: ids } } });
        const existing = new Map(
          rows.map((r) => [r.id, parseDatasetInput(() => mapDatasetItem(r.payload))]),
        );
        const needed = Array.from(
          new Set(
            [...existing.values()]
              .flatMap((item) => datasetReferences(item).map((ref) => ref.id))
              .filter((id) => !existing.has(id)),
          ),
        );
        if (needed.length)
          for (const row of await tx.dataEntry.findMany({
            where: { collectionId, id: { in: needed } },
          }))
            existing.set(
              row.id,
              parseDatasetInput(() => mapDatasetItem(row.payload)),
            );
        // Deleting a membership requires the same management rights as granting it.
        if (changes.some((c) => c.op !== 'put' && existing.get(c.id)?.kind === 'member'))
          await collection(tx, collectionId, role, true, true);
        const items = prepareDatasetChanges(
          old,
          revision,
          changes,
          existing,
          next.updatedAt,
          next.auditRef,
        );
        const replacements = new Map(items.map((item) => [item.id, item]));
        for (const item of items) {
          if (item.deletedAt !== null || item.kind === 'form_template') {
            const refs = await tx.dataEntry.findMany({
              where: {
                collectionId,
                deletedAt: null,
                OR: [
                  'sourceId',
                  'recordId',
                  'targetRecordId',
                  'versionId',
                  'templateId',
                  'evidenceId',
                ].map((field) => ({ [field]: item.id })),
              },
              take: 201,
            });
            if (
              refs.length > 200 ||
              refs.some((r) => {
                const live =
                  replacements.get(r.id) ?? parseDatasetInput(() => mapDatasetItem(r.payload));
                return (
                  live.deletedAt === null &&
                  datasetReferences(live).some((ref) => ref.id === item.id)
                );
              })
            )
              throw new DatasetError(
                'CONFLICT',
                'A live item references this item; remove its references first',
              );
          }
          if (item.kind === 'evidence' && item.deletedAt === null) {
            const file = await tx.file.findFirst({
              where: { id: item.fileId, orgId, projectId, deletedAt: null, state: 'ready' },
            });
            if (
              !file ||
              file.datasetCollectionId !== collectionId ||
              file.sha256 !== item.sha256 ||
              file.bytes !== BigInt(item.bytes) ||
              file.mime !== item.mime
            )
              throw new DatasetError(
                'INVALID_FORMAT',
                'Evidence must reference a verified project file with matching checksum, MIME and size',
              );
          }
          if (
            item.kind === 'entity_link' &&
            item.deletedAt === null &&
            !(await tx.board.findFirst({
              where: { id: item.boardId, orgId, projectId, deletedAt: null },
            }))
          )
            throw new DatasetError('INVALID_FORMAT', 'Entity link board is outside this project');
        }
        for (const item of orderDatasetItems(items)) {
          const ref = (field: string): string | null =>
            datasetReferences(item).find((r) => r.field === field)?.id ?? null;
          const data = {
            orgId,
            projectId,
            kind: item.kind,
            revision: item.revision,
            payload: json(item),
            sourceId: ref('sourceId'),
            recordId: ref('recordId'),
            targetRecordId: ref('targetRecordId'),
            versionId: ref('versionId'),
            templateId: ref('templateId'),
            evidenceId: ref('evidenceId'),
            versionNumber: item.kind === 'version' ? item.number : null,
            memberUserId: item.kind === 'member' ? item.userId : null,
            graphBoardId:
              item.kind === 'entity_link' && item.deletedAt === null ? item.boardId : null,
            fileId: item.kind === 'evidence' ? item.fileId : null,
            deletedAt: item.deletedAt ? new Date(item.deletedAt) : null,
          };
          await tx.dataEntry.upsert({
            where: { collectionId_id: { collectionId, id: item.id } },
            create: { ...data, collectionId, id: item.id, createdAt: new Date(item.createdAt) },
            update: data,
          });
        }
        await event(
          tx,
          next,
          'items.changed',
          old.auditRef,
          items.map((i) => i.id),
        );
        return { collection: next, items };
      }),
    async purgeCollection(id, revision) {
      const pending = await run(true, async (tx, role) => {
        const data = await collection(tx, id, role, true, true, true);
        assertDatasetPurge(data, revision, now());
        const files = await tx.file.findMany({
          where: { datasetCollectionId: id, orgId, projectId },
        });
        await tx.file.updateMany({
          where: { datasetCollectionId: id, orgId, projectId },
          data: { deletedAt: new Date(now()) },
        });
        return files;
      });
      // Tombstoned metadata remains until object cleanup succeeds; retries are idempotent.
      try {
        for (const file of pending)
          for (const key of [file.storageKey, file.thumbKey, file.previewKey])
            if (key) await (options.removeBlob ?? ((k) => getStorage().remove(k)))(key);
      } catch {
        throw new DatasetError(
          'STORAGE_UNAVAILABLE',
          'Evidence cleanup is incomplete; retry purge',
        );
      }
      await run(true, async (tx, role) => {
        const data = await collection(tx, id, role, true, true, true);
        assertDatasetPurge(data, revision, now());
        await tx.dataEntry.deleteMany({ where: { collectionId: id } });
        await tx.file.deleteMany({ where: { datasetCollectionId: id, orgId, projectId } });
        await tx.dataCollection.delete({ where: { id } });
        await event(
          tx,
          { ...data, revision: data.revision + 1, auditRef: nextId(), updatedAt: now() },
          'collection.purged',
          data.auditRef,
        );
      });
    },
    getAudit: (collectionId, auditRef) =>
      run(false, async (tx, role) => {
        await collection(tx, collectionId, role, false);
        const row = await tx.dataAudit.findFirst({
          where: { id: auditRef, collectionId, orgId, projectId },
        });
        if (!row) throw new DatasetError('NOT_FOUND', 'Dataset audit event not found');
        return row.payload as unknown as DatasetAudit;
      }),
  };
}
