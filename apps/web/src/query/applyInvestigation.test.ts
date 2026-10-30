import {
  createBoardDoc,
  createBoardHistory,
  createNode,
  listEdges,
  listNodes,
  getNode,
} from '@nexus/domain';
import type { ImportProposal } from '@nexus/integrations';
import { describe, expect, it } from 'vitest';
import { applyInvestigation } from './applyInvestigation';
const NOW = '2026-10-29T00:00:00.000Z';
function proposal(): ImportProposal {
  const provenance = {
    source: 'Fictional training source',
    tool: 'raven.query',
    toolVersion: '1',
    runId: 'run',
    observedAt: NOW,
    importedAt: NOW,
    confidence: 0.7,
    actorUserId: 'local',
  };
  return {
    id: 'p',
    runId: 'run',
    integrationId: 'raven.query',
    boardId: 'b',
    createdAt: NOW,
    expiresAt: '2030-01-01T00:00:00.000Z',
    summary: { newNodes: 3, newEdges: 2, enriched: 0, conflicts: 0, skippedDuplicates: 0 },
    issues: [],
    items: [
      ...[0, 1, 2].map((i) => ({
        id: `n${i}`,
        kind: 'new_node' as const,
        selectedByDefault: true,
        confidence: 0.7,
        explain: 'Training source',
        node: {
          tempId: `t${i}`,
          identityKey: `domain:${i}.example.test`,
          nodeType: 'website',
          title: `${i}.example.test`,
          props: { url: `https://${i}.example.test` },
          tags: [],
          provenance,
        },
      })),
      ...[1, 2].map((i) => ({
        id: `e${i}`,
        kind: 'new_edge' as const,
        selectedByDefault: true,
        confidence: 0.7,
        explain: 'Training reference',
        edge: {
          tempId: `e${i}`,
          fromRef: { kind: 'temp' as const, tempId: 't0' },
          toRef: { kind: 'temp' as const, tempId: `t${i}` },
          edgeType: 'references',
          props: {},
          provenance,
        },
      })),
    ],
  };
}
describe('accepted investigation tree', () => {
  it('lays out branches to the right, preserves existing cards and remains one undo step', async () => {
    const doc = createBoardDoc({ boardId: 'b', now: NOW });
    createNode(
      doc,
      { type: 'note', x: 20, y: 30, title: 'Existing evidence' },
      { now: NOW, makeId: () => 'old' },
    );
    const old = getNode(doc, 'old');
    const history = createBoardHistory(doc);
    let id = 0;
    const p = proposal();
    const options = {
      selectedItemIds: p.items.map((i) => i.id),
      conflictResolutions: {},
      placement: 'radial' as const,
      newId: () => `made${++id}`,
      now: NOW,
    };
    const first = applyInvestigation(doc, p, options, null);
    const second = applyInvestigation(doc, p, options, null);
    expect(first).toBe(second);
    const result = await first;
    expect(getNode(doc, 'old')).toEqual(old);
    expect(listNodes(doc)).toHaveLength(4);
    expect(listEdges(doc)).toHaveLength(2);
    const root = getNode(doc, result.tempIdMap['t0']!)!;
    const child = getNode(doc, result.tempIdMap['t1']!)!;
    const sibling = getNode(doc, result.tempIdMap['t2']!)!;
    expect(child.x).toBeGreaterThan(root.x + root.w);
    expect(child.x).toBe(sibling.x);
    expect(Math.abs(child.y - sibling.y)).toBeGreaterThanOrEqual(child.h + 48);
    expect(root.x).toBeGreaterThan(old!.x + old!.w);
    expect(listEdges(doc).every((edge) => edge.style.routing === 'orthogonal')).toBe(true);
    history.undo();
    expect(listNodes(doc).map((n) => n.id)).toEqual(['old']);
    expect(listEdges(doc)).toHaveLength(0);
    history.redo();
    expect(listNodes(doc)).toHaveLength(4);
    history.destroy();
    doc.destroy();
  });
  it('applies only selected nodes and refuses a destroyed board without writing', async () => {
    let id = 0;
    const doc = createBoardDoc({ boardId: 'b', now: NOW });
    const p = proposal();
    await applyInvestigation(
      doc,
      p,
      {
        selectedItemIds: ['n1'],
        conflictResolutions: {},
        placement: 'radial',
        newId: () => `a${++id}`,
        now: NOW,
      },
      null,
    );
    expect(listNodes(doc)).toHaveLength(1);
    expect(listEdges(doc)).toHaveLength(0);
    doc.destroy();
    await expect(
      applyInvestigation(
        doc,
        { ...p, id: 'next' },
        {
          selectedItemIds: [],
          conflictResolutions: {},
          placement: 'radial',
          newId: () => 'unused',
          now: NOW,
        },
        null,
      ),
    ).rejects.toThrow('closed');
  });
});
