import { TRPCError } from '@trpc/server';
import { prisma } from '@nexus/db';
import { DatasetError } from '@nexus/domain';
import type { Context } from '../trpc/context.ts';
import { createServerDatasetRepository } from './repository.ts';

/** Applied to the ordinary file API as well, so private evidence has no alternate download path. */
export async function assertDatasetFileAccess(
  collectionId: string,
  projectId: string,
  ctx: Context,
  write: boolean,
): Promise<void> {
  if (!ctx.org || !ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const row = await prisma.dataCollection.findFirst({
    where: { id: collectionId, orgId: ctx.org.id, projectId, deletedAt: null },
    select: { boardId: true },
  });
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evidence collection not found' });
  try {
    await createServerDatasetRepository({
      db: prisma,
      actorId: ctx.user.id,
      orgId: ctx.org.id,
      projectId,
      boardId: row.boardId,
    }).assertAccess(collectionId, write);
  } catch (error) {
    if (error instanceof DatasetError)
      throw new TRPCError({
        code: error.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'NOT_FOUND',
        message: 'Evidence collection access denied',
      });
    throw error;
  }
}
