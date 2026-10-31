import { DatasetError } from '@nexus/domain';
import { errorMessage } from '../../lib/trpc';

export const datasetMessage = (error: unknown): string =>
  error instanceof DatasetError ? error.message : errorMessage(error);
