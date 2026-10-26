import { describe, expect, it } from 'vitest';

import { NodeSchema, makeNode } from '../src/entities/node.ts';
import { PersonDataSchema } from '../src/nodes/types/person.ts';

const NOW = '2026-01-01T00:00:00.000Z';

describe('persisted schema compatibility and validation limits', () => {
  it('fills nested enrichment defaults on legacy nodes without losing extension fields', () => {
    const node = makeNode({ id: 'legacy', type: 'person', x: 0, y: 0 }, NOW);
    const { enrichment: _enrichment, ...legacy } = node;
    const parsed = NodeSchema.parse({ ...legacy, extension: { revision: 2 } });
    expect(parsed.enrichment).toEqual({
      state: 'idle',
      jobId: null,
      attempts: 0,
      lastError: null,
      updatedAt: null,
    });
    expect(parsed['extension']).toEqual({ revision: 2 });
  });

  it('preserves arbitrary observation fields alongside person defaults', () => {
    expect(PersonDataSchema.parse({ observed: { raw: 'unverified' } })).toMatchObject({
      displayName: '',
      usernames: [],
      emails: [],
      observed: { raw: 'unverified' },
    });
  });

  it('rejects an oversized identifier array before accumulating per-element issues', () => {
    const result = PersonDataSchema.safeParse({ emails: Array.from({ length: 10_000 }, () => 42) });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('oversized identifiers were accepted');
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]).toMatchObject({ code: 'too_big', path: ['emails'] });
  });
});
