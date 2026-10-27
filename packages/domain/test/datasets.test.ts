import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createDatasetCollection,
  prepareDatasetChanges,
  reviseCollection,
  datasetReferences,
  orderDatasetItems,
  datasetJson,
  exportDatasetPage,
  importDatasetPage,
  mapDatasetItem,
  pageLimit,
} from '../src/index.ts';
import { collectionInput, datasetFixture, datasetItem, DATASET_TIME as at } from './datasets.ts';
const scope = { workspaceId: 'local', orgId: null, projectId: 'project', boardId: null };
const collection = () => createDatasetCollection(collectionInput(), scope, 'owner', at, 'audit');

describe('versioned dataset documents', () => {
  it('validates the documented synthetic interchange example', () => {
    const text = readFileSync(
      new URL('../../../docs/examples/dataset.page.v1.json', import.meta.url),
      'utf8',
    );
    expect(importDatasetPage(exportDatasetPage(importDatasetPage(text)))).toEqual(JSON.parse(text));
  });

  it('round-trips future extension fields without touching the board format', () => {
    const page = {
      format: 'raven.dataset.page.v1' as const,
      collection: { ...collection(), future: { visibilityPolicy: 2 } },
      items: datasetFixture().map((i) => ({ ...i, extension: ['future', 12] })),
      nextCursor: null,
      futurePage: true,
    };
    expect(importDatasetPage(exportDatasetPage(page))).toEqual(page);
    expect(() =>
      importDatasetPage(JSON.stringify({ ...page, format: 'raven.board.v1' })),
    ).toThrow();
  });
  it('requires fact sources, distinguishes inferred confidence and preserves conflicting observations', () => {
    const fixtures = datasetFixture();
    const assertion = fixtures[3]!;
    const inferred = mapDatasetItem({
      ...assertion,
      id: 'other',
      value: 'Another claim',
      assertionType: 'inferred',
    });
    const result = prepareDatasetChanges(
      collection(),
      1,
      [...fixtures, inferred].map((item) => ({ op: 'put' as const, item })),
      new Map(),
      at,
      'next',
    );
    expect(result.filter((i) => i.kind === 'assertion')).toHaveLength(2);
    expect(() => mapDatasetItem({ ...assertion, sourceId: undefined })).toThrow();
    expect(() =>
      prepareDatasetChanges(
        collection(),
        1,
        [{ op: 'put', item: assertion }],
        new Map(),
        at,
        'next',
      ),
    ).toThrow(/reference/);
  });
  it('checks revisions, soft deletion, transaction uniqueness and typed references', () => {
    expect(() => reviseCollection(collection(), 4, at, 'next', {})).toThrow(/changed/);
    const deleted = reviseCollection(collection(), 1, at, 'next', 'delete');
    expect(deleted.purgeAfter).toBe('2026-11-25T00:00:00.000Z');
    expect(() => reviseCollection(deleted, 2, at, 'again', {})).toThrow(/deleted/);
    const [version] = datasetFixture();
    expect(() =>
      prepareDatasetChanges(
        collection(),
        1,
        [
          { op: 'put', item: version! },
          { op: 'delete', id: version!.id },
        ],
        new Map(),
        at,
        'next',
      ),
    ).toThrow(/once/);
    expect(datasetReferences({ ...version!, sourceId: 'future-extension' })).toEqual([]);
    expect(orderDatasetItems(datasetFixture().reverse()).map((i) => i.id)).toEqual([
      'version',
      'record',
      'source',
      'assertion',
    ]);
  });
  it('rejects sealed version changes, template duplicate fields, dangling deletions and unreviewed identity confirmations', () => {
    const items = datasetFixture();
    const state = new Map(items.map((i) => [i.id, i]));
    expect(() =>
      prepareDatasetChanges(collection(), 1, [{ op: 'delete', id: 'source' }], state, at, 'next'),
    ).toThrow(/references/);
    state.set('version', mapDatasetItem({ ...items[0], sealedAt: at }));
    expect(() =>
      prepareDatasetChanges(collection(), 1, [{ op: 'delete', id: 'version' }], state, at, 'next'),
    ).toThrow(/immutable/);
    const link = datasetItem({
      id: 'link',
      kind: 'entity_link',
      recordId: 'record',
      boardId: 'board',
      nodeId: 'node',
      decision: 'confirmed',
      assessment: {
        confidence: 0.9,
        assessedBy: null,
        assessedAt: null,
        rationale: 'Same name is not proof',
      },
    });
    expect(() =>
      prepareDatasetChanges(collection(), 1, [{ op: 'put', item: link }], state, at, 'next'),
    ).toThrow(/explicit assessment/);
    const field = { id: 'name', label: 'Name', type: 'text', required: true, multiple: false };
    const template = datasetItem({
      id: 'form',
      kind: 'form_template',
      name: 'Person',
      version: 1,
      fields: [field, field],
    });
    expect(() =>
      prepareDatasetChanges(collection(), 1, [{ op: 'put', item: template }], state, at, 'next'),
    ).toThrow(/Duplicate/);
  });
  it('rejects unsupported JSON and boundedness violations', () => {
    for (const value of [
      undefined,
      NaN,
      Infinity,
      new Date(),
      { a: undefined },
      JSON.parse('{"__proto__":{}}'),
    ])
      expect(() => datasetJson(value)).toThrow();
    const cycle: unknown[] = [];
    cycle.push(cycle);
    expect(() => datasetJson(cycle)).toThrow();
    let nested: unknown = null;
    for (let i = 0; i < 40; i++) nested = { nested };
    expect(() => datasetJson(nested)).toThrow(/nesting/);
    expect(() => datasetJson({ text: 'x'.repeat(1024 * 1024) })).toThrow(/1 MiB/);
    expect(() => pageLimit(100_000)).toThrow();
    expect(pageLimit()).toBe(50);
    expect(() =>
      createDatasetCollection(
        { ...collectionInput(), visibility: 'organization' },
        scope,
        'owner',
        at,
        'audit',
      ),
    ).toThrow(/organization/);
  });
});
