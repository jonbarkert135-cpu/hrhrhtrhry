import { expect, test } from '@playwright/test';
import { collectionInput, datasetFixture } from '../../packages/domain/test/datasets.ts';
import { openNewBoard } from '../support/board.ts';

const apiURL = process.env.E2E_API_URL ?? 'http://localhost:3001';
test('server collections persist through the authenticated API without becoming canvas nodes', async ({
  page,
}) => {
  await openNewBoard(page);
  const projectId: string = await page.evaluate(async (base) => {
    const input = encodeURIComponent(
      JSON.stringify({ json: { limit: 50, includeArchived: false } }),
    );
    const response = await fetch(`${base}/trpc/project.list?input=${input}`, {
      credentials: 'include',
    });
    if (!response.ok) throw new Error(`Project metadata failed with ${response.status}`);
    const projects = (await response.json()).result.data.json;
    if (projects.length !== 1)
      throw new Error('Expected the one project created by this fresh account');
    return projects[0].id;
  }, apiURL);
  const collection = collectionInput(`browser-${Date.now()}`);
  const items = datasetFixture(collection.id);
  const result = await page.evaluate(
    async ({ base, projectId, collection, items }) => {
      const rpc = async (name: string, input: unknown, write = false) => {
        const encoded = JSON.stringify({ json: input });
        const response = await fetch(
          `${base}/trpc/datasets.${name}${write ? '' : `?input=${encodeURIComponent(encoded)}`}`,
          {
            method: write ? 'POST' : 'GET',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            ...(write ? { body: encoded } : {}),
          },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(`Dataset ${name} failed with ${response.status}`);
        return data.result.data.json;
      };
      const created = await rpc('create', { projectId, collection }, true);
      const saved = await rpc(
        'commit',
        {
          projectId,
          collectionId: collection.id,
          revision: created.revision,
          changes: items.map((item) => ({ op: 'put', item })),
        },
        true,
      );
      const page = await rpc('items', {
        projectId,
        collectionId: collection.id,
        kind: 'record',
        page: { limit: 10 },
      });
      const audit = await rpc('audit', {
        projectId,
        collectionId: collection.id,
        auditRef: saved.collection.auditRef,
      });
      return { count: page.items.length, title: page.items[0].title, audit: audit.action };
    },
    { base: apiURL, projectId, collection, items },
  );
  expect(result).toEqual({ count: 1, title: 'Example Person (fictional)', audit: 'items.changed' });
  await expect(page.getByTestId('node-count')).toHaveAttribute('data-nodes', '0');
  await page.reload();
  const records = await page.evaluate(
    async ({ base, projectId, id }) => {
      const input = encodeURIComponent(
        JSON.stringify({ json: { projectId, collectionId: id, kind: 'source' } }),
      );
      const response = await fetch(`${base}/trpc/datasets.items?input=${input}`, {
        credentials: 'include',
      });
      const body = await response.json();
      return body.result.data.json.items.map((item: { name: string }) => item.name);
    },
    { base: apiURL, projectId, id: collection.id },
  );
  expect(records).toEqual(['Manual fictional note']);
});

test('IndexedDB and OPFS retain local records and evidence with all outbound transports forbidden', async ({
  page,
}) => {
  await page.goto('/');
  const id = `local-${Date.now()}`;
  const collection = collectionInput(id);
  const items = datasetFixture(id);
  const result = await page.evaluate(
    async ({ collection, items }) => {
      const datasetPath = '/src/data/datasets/local.ts';
      const workspacePath = '/src/data/workspace/local.ts';
      const datasetModule = (await import(
        datasetPath
      )) as typeof import('../../apps/web/src/data/datasets/local.ts');
      const workspaceModule = (await import(
        workspacePath
      )) as typeof import('../../apps/web/src/data/workspace/local.ts');
      const project = await workspaceModule
        .createLocalWorkspaceRepository()
        .createProject({ name: 'Synthetic local dataset E2E' });
      // Imports have loaded; actual data operations must be completely offline.
      const forbid = () => {
        throw new Error('Local dataset used an outbound transport');
      };
      window.fetch = forbid;
      window.XMLHttpRequest = forbid as unknown as typeof XMLHttpRequest;
      window.WebSocket = forbid as unknown as typeof WebSocket;
      const scope = {
        workspaceId: 'browser-workspace',
        orgId: null,
        projectId: project.id,
        boardId: null,
      };
      const repo = datasetModule.createLocalDatasetRepository({ scope, actorId: 'browser-owner' });
      await repo.createCollection(collection);
      await repo.commit(
        collection.id,
        1,
        items.map((item) => ({ op: 'put', item })),
      );
      const blob = new Blob(['Fictional evidence'], { type: 'text/plain' });
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
        (b) => b.toString(16).padStart(2, '0'),
      ).join('');
      const evidence = {
        ...items[0]!,
        id: 'evidence',
        kind: 'evidence' as const,
        sourceId: 'source',
        fileId: 'pending',
        sha256: hash,
        bytes: blob.size,
        filename: 'fictional.txt',
        mime: 'text/plain',
      };
      await repo.attachEvidence(collection.id, 2, evidence, blob);
      const records = await repo.listItems(collection.id, 'record');
      const bytes = await repo.readEvidence(collection.id, 'evidence');
      await repo.close();
      return { scope, count: records.items.length, text: await bytes.text() };
    },
    { collection, items },
  );
  expect(result.count).toBe(1);
  expect(result.text).toBe('Fictional evidence');
  await page.reload();
  const restored = await page.evaluate(
    async ({ scope, id }) => {
      const path = '/src/data/datasets/local.ts';
      const { createLocalDatasetRepository } = (await import(
        path
      )) as typeof import('../../apps/web/src/data/datasets/local.ts');
      const repo = createLocalDatasetRepository({ scope, actorId: 'browser-owner' });
      const evidence = await repo.readEvidence(id, 'evidence');
      const sources = await repo.listItems(id, 'source');
      await repo.close();
      return { bytes: await evidence.text(), sources: sources.items.length };
    },
    { scope: result.scope, id },
  );
  expect(restored).toEqual({ bytes: 'Fictional evidence', sources: 1 });
});
