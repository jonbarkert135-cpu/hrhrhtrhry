/** A view of the real execution stages, with branching connectors and accessible states. */
import { CheckIcon, ClockIcon, Cross2Icon, MinusIcon, ReloadIcon } from '@radix-ui/react-icons';
import { executionGraph, type ExecutionNode } from './executionView.ts';
import type { QueryRunState } from './useQueryRun.ts';

export interface ExecutionViewProps {
  readonly state: QueryRunState;
  readonly query: string;
}
const ICONS = {
  done: CheckIcon,
  pending: ClockIcon,
  running: ReloadIcon,
  failed: Cross2Icon,
  skipped: MinusIcon,
};
function Row({ node }: { readonly node: ExecutionNode }) {
  const Icon = ICONS[node.state];
  return (
    <li className="nx-exec-row" data-state={node.state} data-testid={`exec-${node.id}`}>
      <span className="nx-exec-mark" aria-label={node.state}>
        <Icon aria-hidden="true" />
      </span>
      <span className="nx-exec-label">{node.label}</span>
      {node.detail === undefined ? null : <span className="nx-exec-detail">{node.detail}</span>}
    </li>
  );
}
export function ExecutionView({ state, query }: ExecutionViewProps) {
  const graph = executionGraph(state, query);
  return (
    <section className="nx-exec" aria-label="Execution view" data-testid="execution-view">
      <div
        className="nx-exec-scroll"
        role="region"
        aria-label="Execution stages, scroll horizontally"
      >
        <div className="nx-exec-flow">
          <ol className="nx-exec-inputs">
            {graph.before.map((node) => (
              <Row key={node.id} node={node} />
            ))}
          </ol>
          <ol className="nx-exec-engines">
            {graph.engines.length === 0 ? (
              <li className="nx-exec-row" data-testid="exec-no-engines">
                No engine has been scheduled yet
              </li>
            ) : (
              graph.engines.map((node) => <Row key={node.id} node={node} />)
            )}
          </ol>
          <ol className="nx-exec-outputs">
            {graph.after.map((node) => (
              <Row key={node.id} node={node} />
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
