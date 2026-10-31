import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createDatasetCollection } from '@nexus/domain';
import { collectionInput, DATASET_TIME } from '@nexus/domain/test/datasets';
import { DatasetProjectBoundary, type DatasetProject } from './useDatasetProject';

const mocks = vi.hoisted(() => {
  const session: { data: { user: { id: string } } | null; isPending: boolean } = {
    data: { user: { id: 'actor' } },
    isPending: false,
  };
  return {
    backend: true,
    session,
    identity: vi.fn(),
    methods: new Map<string, ReturnType<typeof vi.fn>>(),
  };
});
vi.mock('../../mode/appMode', () => ({
  capabilities: {
    get backend() {
      return mocks.backend;
    },
  },
}));
vi.mock('../../lib/auth', () => ({ useSession: () => mocks.session }));
vi.mock('../../lib/trpc', () => {
  const datasets = Object.fromEntries(
    [
      'list',
      'get',
      'create',
      'update',
      'remove',
      'item',
      'items',
      'commit',
      'restore',
      'purge',
      'audit',
      'access',
    ].map((name) => {
      const fn = vi.fn();
      mocks.methods.set(name, fn);
      return [name, { query: fn, mutate: fn }];
    }),
  );
  const utils = { client: { auth: { session: { query: mocks.identity } }, datasets } };
  return { trpc: { useUtils: () => utils }, errorMessage: (error: Error) => error.message };
});
let client: QueryClient;
let selected: DatasetProject | undefined;
const collection = createDatasetCollection(
  collectionInput(),
  { workspaceId: 'org-a', orgId: 'org-a', projectId: 'project', boardId: null },
  'actor',
  DATASET_TIME,
  'audit',
);
const identity = (actor = 'actor', org = 'org-a', role = 'editor') => ({
  user: { id: actor },
  org: { id: org },
  role,
});
function view() {
  return (
    <QueryClientProvider client={client}>
      <DatasetProjectBoundary projectId="project">
        {(project) => {
          selected = project;
          return <p>{project.cacheScope}</p>;
        }}
      </DatasetProjectBoundary>
    </QueryClientProvider>
  );
}
beforeEach(() => {
  selected = undefined;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.backend = true;
  mocks.session = { data: { user: { id: 'actor' } }, isPending: false };
  mocks.identity.mockReset().mockResolvedValue(identity());
  for (const fn of mocks.methods.values()) fn.mockReset();
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

describe('dataset identity boundary', () => {
  it('binds every server operation to the selected project and obtains collection-specific access', async () => {
    render(view());
    await screen.findByText('server:actor:org-a:project');
    expect(selected?.canCreate).toBe(true);
    const methods = mocks.methods;
    methods.get('list')!.mockResolvedValue({ items: [collection], nextCursor: null });
    methods.get('get')!.mockResolvedValue(collection);
    methods.get('create')!.mockResolvedValue(collection);
    methods.get('update')!.mockResolvedValue(collection);
    methods.get('remove')!.mockResolvedValue(collection);
    methods.get('restore')!.mockResolvedValue(collection);
    methods.get('items')!.mockResolvedValue({ items: [], nextCursor: null });
    methods.get('commit')!.mockResolvedValue({ collection, items: [] });
    methods.get('access')!.mockResolvedValue({ canWrite: false });
    const repo = selected!.repository;
    await repo.listCollections();
    await repo.getCollection('collection');
    await repo.createCollection(collectionInput());
    await repo.updateCollection('collection', 1, { description: 'Synthetic' });
    await repo.deleteCollection('collection', 1);
    await repo.getItem('collection', 'entry');
    await repo.listItems('collection', 'form_template');
    await repo.commit('collection', 1, []);
    await repo.restoreCollection('collection', 1);
    await repo.purgeCollection('collection', 1);
    await repo.getAudit('collection', 'audit');
    expect(await selected!.access('collection')).toEqual({ canWrite: false });
    for (const fn of methods.values())
      expect(fn.mock.calls[0]?.[0]).toMatchObject({ projectId: 'project' });
  });

  it('separates cached state after actor and organization changes and rejects a stale identity response', async () => {
    const rendered = render(view());
    await screen.findByText('server:actor:org-a:project');
    mocks.session = { data: { user: { id: 'second' } }, isPending: false };
    mocks.identity.mockResolvedValue(identity('actor', 'org-a'));
    rendered.rerender(view());
    await screen.findByText('Your workspace session changed');
    expect(screen.queryByText('server:actor:org-a:project')).not.toBeInTheDocument();
    mocks.identity.mockResolvedValue(identity('second', 'org-b', 'viewer'));
    await act(() => client.invalidateQueries({ queryKey: ['dataset-session', 'second'] }));
    await screen.findByText('server:second:org-b:project');
    expect(selected?.canCreate).toBe(false);
  });

  it('does not call identity while signed out or release children while session is pending', () => {
    mocks.session = { data: null, isPending: true };
    const rendered = render(view());
    expect(selected).toBeUndefined();
    mocks.session = { data: null, isPending: false };
    rendered.rerender(view());
    expect(screen.getByText('Sign in to open collections')).toBeInTheDocument();
    expect(mocks.identity).not.toHaveBeenCalled();
  });

  it('keeps children closed while identity is pending or fails', async () => {
    let reject: (error: Error) => void = () => undefined;
    mocks.identity.mockImplementation(
      () =>
        new Promise((_resolve, no) => {
          reject = no;
        }),
    );
    render(view());
    await waitFor(() => expect(mocks.identity).toHaveBeenCalledOnce());
    expect(selected).toBeUndefined();
    reject(new Error('Session unavailable'));
    expect(await screen.findByText('Session unavailable')).toBeInTheDocument();
    expect(selected).toBeUndefined();
  });
});
