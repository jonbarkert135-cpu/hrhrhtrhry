import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { prisma } from '@nexus/db';
import {
  CollectionPatchSchema,
  CreateCollectionSchema,
  DatasetChangesSchema,
  DatasetError,
  DatasetIdSchema,
} from '@nexus/domain';
import { createServerDatasetRepository } from '../../datasets/repository.ts';
import { orgProcedure, router } from '../trpc.ts';
import type { Context } from '../context.ts';

const scope = z.object({
  projectId: DatasetIdSchema,
  boardId: DatasetIdSchema.nullable().optional(),
});
const entry = scope.extend({ collectionId: DatasetIdSchema });
const page = z
  .object({
    cursor: DatasetIdSchema.optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .optional();
const kinds = z.enum([
  'version',
  'source',
  'record',
  'assertion',
  'evidence',
  'entity_link',
  'relation',
  'saved_view',
  'form_template',
  'member',
]);
async function call<T>(
  ctx: Context,
  input: z.infer<typeof scope>,
  action: (repo: ReturnType<typeof createServerDatasetRepository>) => Promise<T>,
): Promise<T> {
  if (!ctx.org || !ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  try {
    return await action(
      createServerDatasetRepository({
        db: prisma,
        actorId: ctx.user.id,
        orgId: ctx.org.id,
        projectId: input.projectId,
        boardId: input.boardId ?? null,
      }),
    );
  } catch (error) {
    if (!(error instanceof DatasetError)) throw error;
    const codes = {
      FORBIDDEN: 'FORBIDDEN',
      NOT_FOUND: 'NOT_FOUND',
      INVALID_FORMAT: 'BAD_REQUEST',
      CONFLICT: 'CONFLICT',
      STORAGE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    } as const;
    throw new TRPCError({ code: codes[error.code], message: error.message });
  }
}
export const datasetsRouter = router({
  list: orgProcedure('viewer')
    .input(scope.extend({ page }))
    .query(({ ctx, input }) => call(ctx, input, (repo) => repo.listCollections(input.page))),
  get: orgProcedure('viewer')
    .input(entry)
    .query(({ ctx, input }) => call(ctx, input, (repo) => repo.getCollection(input.collectionId))),
  create: orgProcedure('editor')
    .input(scope.extend({ collection: CreateCollectionSchema }))
    .mutation(({ ctx, input }) =>
      call(ctx, input, (repo) => repo.createCollection(input.collection)),
    ),
  update: orgProcedure('editor')
    .input(entry.extend({ revision: z.number().int().positive(), patch: CollectionPatchSchema }))
    .mutation(({ ctx, input }) =>
      call(ctx, input, (repo) =>
        repo.updateCollection(input.collectionId, input.revision, input.patch),
      ),
    ),
  remove: orgProcedure('editor')
    .input(entry.extend({ revision: z.number().int().positive() }))
    .mutation(({ ctx, input }) =>
      call(ctx, input, (repo) => repo.deleteCollection(input.collectionId, input.revision)),
    ),
  purge: orgProcedure('editor')
    .input(entry.extend({ revision: z.number().int().positive() }))
    .mutation(({ ctx, input }) =>
      call(ctx, input, (repo) => repo.purgeCollection(input.collectionId, input.revision)),
    ),
  item: orgProcedure('viewer')
    .input(entry.extend({ id: DatasetIdSchema }))
    .query(({ ctx, input }) =>
      call(ctx, input, (repo) => repo.getItem(input.collectionId, input.id)),
    ),
  items: orgProcedure('viewer')
    .input(
      entry.extend({
        kind: kinds,
        page: z
          .object({
            cursor: DatasetIdSchema.optional(),
            limit: z.number().int().min(1).max(200).optional(),
            recordId: DatasetIdSchema.optional(),
          })
          .optional(),
      }),
    )
    .query(({ ctx, input }) =>
      call(ctx, input, (repo) => repo.listItems(input.collectionId, input.kind, input.page)),
    ),
  commit: orgProcedure('editor')
    .input(entry.extend({ revision: z.number().int().positive(), changes: DatasetChangesSchema }))
    .mutation(({ ctx, input }) =>
      call(ctx, input, (repo) => repo.commit(input.collectionId, input.revision, input.changes)),
    ),
  audit: orgProcedure('viewer')
    .input(entry.extend({ auditRef: DatasetIdSchema }))
    .query(({ ctx, input }) =>
      call(ctx, input, (repo) => repo.getAudit(input.collectionId, input.auditRef)),
    ),
});
