import { TRPCError } from '@trpc/server';
import { prisma, type Prisma } from '@nexus/db';

/** Both sides use Serializable: parent deletion and dataset creation cannot commit a write skew. */
export async function mutateDatasetParent<T>(
  kind: 'project' | 'board',
  id: string,
  orgId: string,
  mutate: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const collection = await tx.dataCollection.findFirst({
          where: { orgId, ...(kind === 'project' ? { projectId: id } : { boardId: id }) },
          select: { id: true },
        });
        const link =
          kind === 'board'
            ? await tx.dataEntry.findFirst({
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
        return mutate(tx);
      },
      { isolationLevel: 'Serializable' },
    );
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      ['P2034', 'P2003'].includes(String(error.code))
    )
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Dataset references changed; reload before retrying the parent operation.',
      });
    throw error;
  }
}
