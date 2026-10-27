import type { DatasetRepository, DatasetScope } from '@nexus/domain';
import { createLocalDatasetRepository } from './local.ts';
import { createRemoteDatasetRepository, type DatasetClient } from './server.ts';

/** Explicit mode boundary: constructing local repositories performs no transport calls. */
export function createDatasetRepository(
  options:
    | { mode: 'local'; scope: DatasetScope; actorId: string }
    | {
        mode: 'server';
        scope: { projectId: string; boardId?: string | null };
        client: DatasetClient;
      },
): DatasetRepository {
  return options.mode === 'local'
    ? createLocalDatasetRepository(options)
    : createRemoteDatasetRepository(options.client, options.scope);
}
export { createLocalDatasetRepository, createRemoteDatasetRepository };
export type { DatasetClient };
