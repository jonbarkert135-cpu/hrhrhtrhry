/** Worker layout first, then one accepted transaction for import + positions + elbow routing. */
import { builtinNodeTypes, listNodes, moveNodes, tx, updateEdge, getEdge } from '@nexus/domain';
import {
  applyProposal,
  type ApplyOptions,
  type ApplyResult,
  type ImportProposal,
} from '@nexus/integrations';
import type * as Y from 'yjs';
import { createLayoutRunner, type WorkerFactory } from '../layout/runner';

const pending = new WeakMap<Y.Doc, Map<string, Promise<ApplyResult>>>();
export function applyInvestigation(
  doc: Y.Doc,
  proposal: ImportProposal,
  options: ApplyOptions,
  factory?: WorkerFactory | null,
): Promise<ApplyResult> {
  let jobs = pending.get(doc);
  if (jobs === undefined) {
    jobs = new Map();
    pending.set(doc, jobs);
  }
  const key = `${proposal.id}:${[...options.selectedItemIds].sort().join(',')}`;
  const existing = jobs.get(key);
  if (existing !== undefined) return existing;
  const task = prepareAndApply(doc, proposal, options, factory);
  jobs.set(key, task);
  // Bounded per-document idempotency also covers a second click before React commits its reset
  if (jobs.size > 32) jobs.delete(jobs.keys().next().value!);
  void task.catch(() => jobs?.delete(key));
  return task;
}
async function prepareAndApply(
  doc: Y.Doc,
  proposal: ImportProposal,
  options: ApplyOptions,
  factory?: WorkerFactory | null,
): Promise<ApplyResult> {
  const selected = new Set(options.selectedItemIds);
  const nodes = proposal.items.flatMap((item) =>
    item.kind === 'new_node' && selected.has(item.id)
      ? [
          {
            id: item.node.tempId,
            x: 0,
            y: 0,
            ...builtinNodeTypes().get(item.node.nodeType).defaults.size,
          },
        ]
      : [],
  );
  const ids = new Set(nodes.map((node) => node.id));
  const edges = proposal.items.flatMap((item) =>
    item.kind === 'new_edge' &&
    selected.has(item.id) &&
    item.edge.fromRef.kind === 'temp' &&
    item.edge.toRef.kind === 'temp' &&
    ids.has(item.edge.fromRef.tempId) &&
    ids.has(item.edge.toRef.tempId)
      ? [{ id: item.id, source: item.edge.fromRef.tempId, target: item.edge.toRef.tempId }]
      : [],
  );
  const runner = createLayoutRunner(factory);
  try {
    const diff = await runner.run(
      { nodes, edges },
      { algorithm: 'tree', direction: 'right', spacingX: 48, spacingY: 128, seed: 1 },
    );
    if (diff === null || doc.isDestroyed)
      throw new Error('The board closed before the layout was ready');
    const positions = new Map(nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
    for (const move of diff.moves) positions.set(move.id, { x: move.x, y: move.y });
    const minX = Math.min(0, ...[...positions.values()].map((value) => value.x));
    const minY = Math.min(0, ...[...positions.values()].map((value) => value.y));
    // Read the latest board after the worker completes, so concurrent manual additions stay untouched
    const right = Math.max(0, ...listNodes(doc).map((node) => node.x + node.w)) + 128;
    return tx(doc, 'local:proposal-apply', () => {
      const outcome = applyProposal(doc, proposal, options);
      const moves = [...positions].flatMap(([temp, position]) => {
        const id = outcome.tempIdMap[temp];
        return id === undefined ? [] : [{ id, x: right + position.x - minX, y: position.y - minY }];
      });
      moveNodes(doc, moves, { origin: 'local:proposal-apply', now: options.now });
      for (const id of outcome.createdEdgeIds) {
        const edge = getEdge(doc, id);
        if (edge !== undefined)
          updateEdge(
            doc,
            id,
            { style: { ...edge.style, routing: 'orthogonal', cornerRadius: 12 } },
            { origin: 'local:proposal-apply', now: options.now },
          );
      }
      return outcome;
    });
  } finally {
    runner.dispose();
  }
}
