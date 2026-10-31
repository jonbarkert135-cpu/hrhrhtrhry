/** Real Postgres contract tests; uses the disposable database provisioned by the unit CI job. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, createFormVersion, personFormFields } from '@nexus/domain';
import { prisma, Prisma } from '@nexus/db';
import {
  collectionInput,
  datasetFixture,
  datasetItem,
  DATASET_TIME,
} from '@nexus/domain/test/datasets';
import { createServerDatasetRepository } from '../src/datasets/repository.ts';
import { appRouter } from '../src/trpc/router.ts';
import { createCallerFactory } from '../src/trpc/trpc.ts';
import type { Context } from '../src/trpc/context.ts';

const prefix = `dt-${crypto.randomUUID()}`;
const orgId = `${prefix}-org`,
  projectId = newId.project(),
  actorId = `${prefix}-owner`;
const otherOrg = `${prefix}-other`,
  otherProject = newId.project(),
  otherUser = `${prefix}-ou`;
const editorId = `${prefix}-editor`,
  viewerId = `${prefix}-viewer`,
  boardId = newId.board();
const repo = (actor = actorId, project = projectId, org = orgId) =>
  createServerDatasetRepository({ db: prisma, actorId: actor, orgId: org, projectId: project });
const collections: string[] = [];
async function create() {
  const id = `${prefix}-${collections.length}`;
  collections.push(id);
  return repo().createCollection(collectionInput(id));
}
const puts = (id: string) => datasetFixture(id).map((item) => ({ op: 'put' as const, item }));
const caller = (
  actor = actorId,
  role: Context['role'] = 'owner',
  org = orgId,
  project = projectId,
) => {
  const context: Context = {
    user: { id: actor, email: 'fictional@example.invalid', name: 'Fictional' },
    org: { id: org, slug: org, name: 'Fictional test org' },
    role,
    req_id: prefix,
    ip: '127.0.0.1',
    logger: { info() {}, warn() {}, error() {} },
  };
  return { api: createCallerFactory(appRouter)(context).datasets, projectId: project };
};
beforeAll(async () => {
  for (const id of [actorId, otherUser, editorId, viewerId])
    await prisma.user.create({
      data: { id, email: `${id}@example.invalid`, name: 'Fictional test account' },
    });
  for (const id of [orgId, otherOrg])
    await prisma.organization.create({
      data: { id, slug: id, name: 'Disposable dataset test org' },
    });
  for (const [userId, org, role] of [
    [actorId, orgId, 'owner'],
    [otherUser, otherOrg, 'owner'],
    [editorId, orgId, 'editor'],
    [viewerId, orgId, 'viewer'],
  ] as const)
    await prisma.membership.create({
      data: { id: `${userId}-membership`, orgId: org, userId, role, joinedAt: new Date() },
    });
  await prisma.project.createMany({
    data: [
      { id: projectId, orgId, key: prefix.slice(0, 24), name: 'Synthetic', createdBy: actorId },
      {
        id: otherProject,
        orgId: otherOrg,
        key: prefix.slice(0, 24),
        name: 'Synthetic',
        createdBy: otherUser,
      },
    ],
  });
  await prisma.board.create({
    data: { id: boardId, orgId, projectId, title: 'Synthetic', createdBy: actorId },
  });
}, 30_000);
afterAll(async () => {
  // Audit events intentionally remain immutable in this disposable database and contain IDs only.
  await prisma.dataEntry.deleteMany({ where: { collectionId: { in: collections } } });
  await prisma.file.deleteMany({ where: { projectId } });
  await prisma.dataCollection.deleteMany({ where: { id: { in: collections } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrg] } } });
  await prisma.user.deleteMany({ where: { id: { in: [actorId, otherUser, editorId, viewerId] } } });
});

describe('Prisma dataset repository and API', () => {
  it('publishes immutable form versions over the API and reports exact joined permissions', async () => {
    const c = await create();
    const { api } = caller();
    const first = createFormVersion({
      collection: c,
      familyId: 'person',
      version: 1,
      name: 'Person',
      fields: personFormFields(),
      now: DATASET_TIME,
    });
    expect(await api.access({ projectId, collectionId: c.id })).toEqual({ canWrite: true });
    await expect(
      caller(editorId, 'editor').api.access({ projectId, collectionId: c.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await api.commit({
      projectId,
      collectionId: c.id,
      revision: 1,
      changes: [
        { op: 'put', item: first },
        {
          op: 'put',
          item: datasetItem(
            { id: 'form-reader', kind: 'member', userId: editorId, role: 'viewer' },
            c.id,
          ),
        },
      ],
    });
    expect(await caller(editorId, 'editor').api.access({ projectId, collectionId: c.id })).toEqual({
      canWrite: false,
    });
    await expect(
      caller(editorId, 'editor').api.commit({
        projectId,
        collectionId: c.id,
        revision: 2,
        changes: [{ op: 'put', item: { ...first, name: 'Forbidden edit' } }],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const second = createFormVersion({
      collection: c,
      familyId: 'person',
      version: 2,
      name: 'Person',
      fields: first.fields.map((field) => ({ ...field, label: `Updated ${field.label}` })),
      now: DATASET_TIME,
      previous: first,
    });
    const result = await Promise.allSettled([
      api.commit({
        projectId,
        collectionId: c.id,
        revision: 2,
        changes: [{ op: 'put', item: second }],
      }),
      api.commit({
        projectId,
        collectionId: c.id,
        revision: 2,
        changes: [{ op: 'put', item: second }],
      }),
    ]);
    expect(result.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    await expect(
      api.commit({
        projectId,
        collectionId: c.id,
        revision: 3,
        changes: [{ op: 'put', item: { ...first, name: 'Overwrite' } }],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await api.get({ projectId, collectionId: c.id })).revision).toBe(3);
    expect(
      (await api.items({ projectId, collectionId: c.id, kind: 'form_template' })).items,
    ).toMatchObject([
      { id: first.id, name: 'Person' },
      { id: second.id, name: 'Person' },
    ]);
    await expect(
      caller(otherUser, 'owner', otherOrg, otherProject).api.access({
        projectId: otherProject,
        collectionId: c.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(api.access({ projectId, collectionId: '' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await api.remove({ projectId, collectionId: c.id, revision: 3 });
    await expect(api.access({ projectId, collectionId: c.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('restores records and a collection without losing provenance or allowing expired/unauthorized restore', async () => {
    const c = await create();
    await repo().commit(c.id, 1, puts(c.id));
    await repo().commit(c.id, 2, [
      { op: 'delete', id: 'assertion' },
      { op: 'delete', id: 'record' },
    ]);
    await repo().commit(c.id, 3, [
      { op: 'restore', id: 'record' },
      { op: 'restore', id: 'assertion' },
    ]);
    expect((await repo().getItem(c.id, 'assertion')).sourceId).toBe('source');
    await expect(repo().commit(c.id, 4, [{ op: 'restore', id: 'record' }])).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await repo().deleteCollection(c.id, 4);
    await expect(repo(editorId).restoreCollection(c.id, 5)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const restored = await caller().api.restore({ projectId, collectionId: c.id, revision: 5 });
    expect(restored.deletedAt).toBeNull();
    expect((await repo().getCollection(c.id)).revision).toBe(6);
    const deleted = await repo().deleteCollection(c.id, 6);
    const maintenance = createServerDatasetRepository({
      db: prisma,
      actorId,
      orgId,
      projectId,
      now: () => deleted.purgeAfter!,
    });
    await expect(maintenance.restoreCollection(c.id, 7)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('serializes project deletion against dataset creation with no orphaned collection', async () => {
    const raceProject = newId.project();
    await prisma.project.create({
      data: {
        id: raceProject,
        orgId,
        key: newId.project(),
        name: 'Race project',
        createdBy: actorId,
      },
    });
    const id = `${prefix}-race`;
    collections.push(id);
    const context: Context = {
      user: { id: actorId, email: 'synthetic@example.invalid', name: 'Synthetic' },
      org: { id: orgId, slug: orgId, name: 'Synthetic' },
      role: 'owner',
      req_id: prefix,
      ip: '127.0.0.1',
      logger: { info() {}, warn() {}, error() {} },
    };
    const results = await Promise.allSettled([
      repo(actorId, raceProject).createCollection(collectionInput(id)),
      createCallerFactory(appRouter)(context).project.delete({
        projectId: raceProject,
        confirmName: 'Race project',
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const parent = await prisma.project.findUniqueOrThrow({ where: { id: raceProject } });
    if (parent.deletedAt) expect(await prisma.dataCollection.count({ where: { id } })).toBe(0);
    else expect(await prisma.dataCollection.count({ where: { id } })).toBe(1);
  });

  it('enforces retention, retries object cleanup, purges bytes before metadata and never reuses collection IDs', async () => {
    const c = await create();
    await repo().commit(c.id, 1, puts(c.id));
    const fileId = newId.file();
    await prisma.file.create({
      data: {
        id: fileId,
        orgId,
        projectId,
        datasetCollectionId: c.id,
        filename: 'synthetic.txt',
        mime: 'text/plain',
        kind: 'document',
        bytes: 12n,
        sha256: 'a'.repeat(64),
        storageKey: 'synthetic-purge-key',
        state: 'ready',
        createdBy: actorId,
      },
    });
    const item = datasetItem(
      {
        id: 'proof',
        kind: 'evidence',
        sourceId: 'source',
        fileId,
        sha256: 'a'.repeat(64),
        bytes: 12,
        filename: 'synthetic.txt',
        mime: 'text/plain',
      },
      c.id,
    );
    await repo().commit(c.id, 2, [{ op: 'put', item }]);
    const deleted = await repo().deleteCollection(c.id, 3);
    await expect(repo().purgeCollection(c.id, 4)).rejects.toMatchObject({ code: 'CONFLICT' });
    let fail = true;
    const removed: string[] = [];
    const maintenance = createServerDatasetRepository({
      db: prisma,
      actorId,
      orgId,
      projectId,
      now: () => deleted.purgeAfter!,
      removeBlob: async (key) => {
        if (fail) throw new Error('Object storage offline');
        removed.push(key);
      },
    });
    await expect(maintenance.purgeCollection(c.id, 4)).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
    });
    expect(await prisma.dataCollection.count({ where: { id: c.id } })).toBe(1);
    fail = false;
    await maintenance.purgeCollection(c.id, 4);
    expect(removed).toEqual(['synthetic-purge-key']);
    expect(await prisma.file.count({ where: { id: fileId } })).toBe(0);
    expect(await prisma.dataEntry.count({ where: { collectionId: c.id } })).toBe(0);
    await expect(repo().createCollection(collectionInput(c.id))).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('persists CRUD and fact provenance independently of any Y.Doc', async () => {
    const collection = await create();
    const id = collection.id;
    const changed = await repo().commit(id, 1, puts(id).reverse());
    expect(changed.collection.revision).toBe(2);
    expect((await repo().listItems(id, 'record', { limit: 1 })).items[0]?.title).toBe(
      'Example Person (fictional)',
    );
    expect(
      (await repo().listItems(id, 'assertion', { recordId: 'record' })).items[0]?.sourceId,
    ).toBe('source');
    const source = await repo().getItem(id, 'source');
    await repo().commit(id, 2, [{ op: 'put', item: { ...source, name: 'Updated' } }]);
    const updated = await repo().updateCollection(id, 3, { name: 'Updated collection' });
    expect((await repo().getCollection(id)).name).toBe(updated.name);
    const context: Context = {
      user: { id: actorId, email: 'synthetic@example.invalid', name: 'Synthetic' },
      org: { id: orgId, slug: orgId, name: 'Synthetic' },
      role: 'owner',
      req_id: prefix,
      ip: '127.0.0.1',
      logger: { info() {}, warn() {}, error() {} },
    };
    await expect(
      createCallerFactory(appRouter)(context).project.delete({
        projectId,
        confirmName: 'Synthetic',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const audit = await repo().getAudit(id, updated.auditRef);
    expect(audit.previousAuditRef).not.toBeNull();
    expect(JSON.stringify(audit)).not.toContain('Example Person');
    await expect(
      prisma.dataAudit.update({ where: { id: audit.id }, data: { actorId: 'forged' } }),
    ).rejects.toThrow(/immutable/);
    await expect(prisma.dataAudit.delete({ where: { id: audit.id } })).rejects.toThrow(/immutable/);
    await repo().commit(
      id,
      4,
      ['assertion', 'record', 'source', 'version'].map((key) => ({
        op: 'delete' as const,
        id: key,
      })),
    );
    await expect(repo().getItem(id, 'record')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const deleted = await repo().deleteCollection(id, 5);
    expect(deleted.purgeAfter).not.toBeNull();
    await expect(repo().getCollection(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('enforces actual organization membership, dataset grants, viewer read-only and owner management', async () => {
    const c = await create();
    await repo().commit(c.id, 1, puts(c.id));
    await expect(repo(otherUser).getCollection(c.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(repo(editorId).getCollection(c.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(repo(otherUser, otherProject, otherOrg).getCollection(c.id)).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
    const grant = datasetItem(
      { id: 'grant', kind: 'member', userId: editorId, role: 'viewer' },
      c.id,
    );
    await repo().commit(c.id, 2, [{ op: 'put', item: grant }]);
    expect((await repo(editorId).listCollections()).items.map((i) => i.id)).toContain(c.id);
    await expect(
      repo(editorId).commit(c.id, 3, [{ op: 'delete', id: 'assertion' }]),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const stored = await repo().getItem(c.id, 'grant');
    await repo().commit(c.id, 3, [{ op: 'put', item: { ...stored, role: 'editor' } }]);
    await repo(editorId).commit(c.id, 4, [{ op: 'delete', id: 'assertion' }]);
    await expect(
      repo(editorId).updateCollection(c.id, 5, { visibility: 'organization' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      repo(editorId).commit(c.id, 5, [{ op: 'delete', id: 'grant' }]),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      repo(viewerId).createCollection(collectionInput(`${prefix}-forbidden`)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('rolls back uniqueness, invalid references, stale revisions and concurrent writers atomically', async () => {
    const c = await create();
    const [version] = datasetFixture(c.id);
    await expect(
      repo().commit(c.id, 1, [
        { op: 'put', item: version! },
        { op: 'put', item: { ...version!, id: 'duplicate-number' } },
      ]),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await repo().getCollection(c.id)).revision).toBe(1);
    expect((await repo().listItems(c.id, 'version')).items).toEqual([]);
    await repo().commit(c.id, 1, puts(c.id));
    await expect(repo().commit(c.id, 2, [{ op: 'delete', id: 'source' }])).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await repo().getCollection(c.id)).revision).toBe(2);
    const other = await create();
    const record = datasetFixture(other.id)[2]!;
    await expect(repo().commit(other.id, 1, [{ op: 'put', item: record }])).rejects.toMatchObject({
      code: 'INVALID_FORMAT',
    });
    const settled = await Promise.allSettled([
      repo().updateCollection(c.id, 2, { name: 'One' }),
      repo().updateCollection(c.id, 2, { name: 'Two' }),
    ]);
    expect(settled.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
    const row = await prisma.dataEntry.findFirstOrThrow({
      where: { collectionId: c.id, kind: 'record' },
    });
    await expect(
      prisma.dataEntry.create({
        data: {
          ...row,
          id: 'forged-scope',
          orgId: otherOrg,
          payload: row.payload as Prisma.InputJsonObject,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
  it('accepts only verified project files and scoped graph references', async () => {
    const c = await create();
    await repo().commit(c.id, 1, puts(c.id));
    const fileId = newId.file();
    const evidence = datasetItem(
      {
        id: 'evidence',
        kind: 'evidence',
        sourceId: 'source',
        fileId,
        sha256: 'a'.repeat(64),
        bytes: 12,
        filename: 'synthetic.txt',
        mime: 'text/plain',
      },
      c.id,
    );
    await expect(repo().commit(c.id, 2, [{ op: 'put', item: evidence }])).rejects.toMatchObject({
      code: 'INVALID_FORMAT',
    });
    await prisma.file.create({
      data: {
        id: fileId,
        orgId,
        projectId,
        filename: 'synthetic.txt',
        mime: 'text/plain',
        kind: 'document',
        bytes: 12n,
        sha256: 'a'.repeat(64),
        storageKey: 'synthetic-test-only',
        datasetCollectionId: c.id,
        state: 'ready',
        createdBy: actorId,
      },
    });
    await repo().commit(c.id, 2, [{ op: 'put', item: evidence }]);
    const link = datasetItem(
      {
        id: 'link',
        kind: 'entity_link',
        recordId: 'record',
        boardId,
        nodeId: 'fictional-node',
        decision: 'confirmed',
        assessment: {
          confidence: 0.5,
          assessedBy: actorId,
          assessedAt: DATASET_TIME,
          rationale: 'Explicit review, not automatic identity merging',
        },
      },
      c.id,
    );
    await expect(
      repo().commit(c.id, 3, [{ op: 'put', item: { ...link, boardId: 'foreign' } }]),
    ).rejects.toMatchObject({ code: 'INVALID_FORMAT' });
    await repo().commit(c.id, 3, [{ op: 'put', item: link }]);
    expect((await repo().getItem(c.id, 'evidence')).fileId).toBe(fileId);
    const context: Context = {
      user: { id: editorId, email: 'fictional@example.invalid', name: 'Fictional' },
      org: { id: orgId, slug: orgId, name: 'Fictional' },
      role: 'editor',
      req_id: prefix,
      ip: '127.0.0.1',
      logger: { info() {}, warn() {}, error() {} },
    };
    const files = createCallerFactory(appRouter)(context).files;
    await expect(files.get({ fileId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(files.download({ fileId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await files.list({ projectId })).some((f) => f.id === fileId)).toBe(false);
    await expect(files.delete({ fileId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('exposes bounded API CRUD with explicit format, access and conflict errors', async () => {
    const { api } = caller();
    const c = await create();
    expect((await api.get({ projectId, collectionId: c.id })).id).toBe(c.id);
    expect((await api.list({ projectId, page: { limit: 1 } })).items.length).toBeLessThanOrEqual(1);
    await api.commit({ projectId, collectionId: c.id, revision: 1, changes: puts(c.id) });
    expect((await api.item({ projectId, collectionId: c.id, id: 'source' })).kind).toBe('source');
    expect(
      (await api.items({ projectId, collectionId: c.id, kind: 'record', page: { limit: 1 } }))
        .items,
    ).toHaveLength(1);
    const updated = await api.update({
      projectId,
      collectionId: c.id,
      revision: 2,
      patch: { name: 'Via API' },
    });
    expect(
      (await api.audit({ projectId, collectionId: c.id, auditRef: updated.auditRef })).action,
    ).toBe('collection.updated');
    await expect(
      api.update({ projectId, collectionId: c.id, revision: 1, patch: {} }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      api.items({ projectId, collectionId: c.id, kind: 'record', page: { limit: 100_000 } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller(viewerId, 'viewer').api.remove({ projectId, collectionId: c.id, revision: 3 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller(otherUser).api.get({ projectId, collectionId: c.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await api.remove({ projectId, collectionId: c.id, revision: 3 });
    await expect(api.get({ projectId, collectionId: c.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
