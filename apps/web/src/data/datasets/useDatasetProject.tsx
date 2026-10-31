/** React wiring only; both repository adapters remain React-free. */
import { useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Banner, Skeleton } from '@nexus/ui';
import type { DatasetRepository } from '@nexus/domain';
import { useSession } from '../../lib/auth';
import { trpc, errorMessage } from '../../lib/trpc';
import { capabilities } from '../../mode/appMode';
import { createDatasetRepository } from './factory';

export interface DatasetProject {
  repository: DatasetRepository;
  cacheScope: string;
  canCreate: boolean;
  mode: 'local' | 'server';
  access: (collectionId: string) => Promise<{ canWrite: boolean }>;
}

function LocalProject({
  projectId,
  children,
}: {
  projectId: string;
  children: (project: DatasetProject) => ReactNode;
}) {
  const project = useMemo<DatasetProject>(() => {
    const repository = createDatasetRepository({
      mode: 'local',
      actorId: 'local-owner',
      scope: { workspaceId: 'local', orgId: null, projectId, boardId: null },
    });
    return {
      repository,
      cacheScope: `local:local-owner:${projectId}`,
      canCreate: true,
      mode: 'local',
      access: async (collectionId) => {
        await repository.getCollection(collectionId);
        return { canWrite: true };
      },
    };
  }, [projectId]);
  return children(project);
}

function ServerProject({
  projectId,
  children,
}: {
  projectId: string;
  children: (project: DatasetProject) => ReactNode;
}) {
  const utils = trpc.useUtils();
  const session = useSession();
  const actorId = session.data?.user.id;
  const identity = useQuery({
    queryKey: ['dataset-session', actorId],
    enabled: Boolean(actorId),
    queryFn: () => utils.client.auth.session.query(),
    staleTime: 0,
  });
  const project = useMemo<DatasetProject>(
    () => ({
      repository: createDatasetRepository({
        mode: 'server',
        scope: { projectId },
        client: {
          list: (input) => utils.client.datasets.list.query(input),
          get: (input) => utils.client.datasets.get.query(input),
          create: (input) => utils.client.datasets.create.mutate(input),
          update: (input) => utils.client.datasets.update.mutate(input),
          remove: (input) => utils.client.datasets.remove.mutate(input),
          item: (input) => utils.client.datasets.item.query(input),
          items: (input) => utils.client.datasets.items.query(input),
          commit: (input) => utils.client.datasets.commit.mutate(input),
          restore: (input) => utils.client.datasets.restore.mutate(input),
          purge: (input) => utils.client.datasets.purge.mutate(input),
          audit: (input) => utils.client.datasets.audit.query(input),
        },
      }),
      cacheScope: `server:${actorId ?? ''}:${identity.data?.org?.id ?? ''}:${projectId}`,
      canCreate: ['owner', 'admin', 'editor'].includes(identity.data?.role ?? ''),
      mode: 'server',
      access: (collectionId) => utils.client.datasets.access.query({ projectId, collectionId }),
    }),
    [utils, projectId, actorId, identity.data?.org?.id, identity.data?.role],
  );
  if (identity.error)
    return (
      <Banner kind="danger" title="Couldn't check data access">
        {errorMessage(identity.error)}
      </Banner>
    );
  if (session.isPending) return <Skeleton height="var(--nx-space-10)" />;
  if (!actorId)
    return (
      <Banner kind="warn" title="Sign in to open collections">
        Your workspace session is unavailable
      </Banner>
    );
  if (identity.isPending) return <Skeleton height="var(--nx-space-10)" />;
  if (!actorId || identity.data?.user?.id !== actorId || !identity.data?.org)
    return (
      <Banner kind="warn" title="Your workspace session changed">
        Sign in again to open these collections
      </Banner>
    );
  return children(project);
}

export function DatasetProjectBoundary({
  projectId,
  children,
}: {
  projectId: string;
  children: (project: DatasetProject) => ReactNode;
}) {
  return capabilities.backend ? (
    <ServerProject projectId={projectId}>{children}</ServerProject>
  ) : (
    <LocalProject projectId={projectId}>{children}</LocalProject>
  );
}
