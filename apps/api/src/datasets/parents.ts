import { TRPCError } from '@trpc/server';
import { prisma } from '@nexus/db';

export async function assertDatasetParentCanChange(
  kind: 'project' | 'board',
  id: string,
  orgId: string,
): Promise<void> {
  const collection = await prisma.dataCollection.findFirst({
    where: { orgId, ...(kind === 'project' ? { projectId: id } : { boardId: id }) },
    select: { id: true },
  });
  const link =
    kind === 'board'
      ? await prisma.dataEntry.findFirst({
          where: { orgId, graphBoardId: id, deletedAt: null },
          select: { id: true },
        })
      : null;
  if (collection || link)
    throw new TRPCError({
      code: 'CONFLICT',
      message:
        'Remove dataset projections and purge retained collections before moving or deleting their parent.',
    });
}
