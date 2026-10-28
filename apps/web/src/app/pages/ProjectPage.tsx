import { DashboardIcon, PlusIcon, LockClosedIcon } from '@radix-ui/react-icons';
import { capabilities } from '../../mode/appMode';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Banner, Button, Skeleton } from '@nexus/ui';
import {
  useBoards,
  useCreateBoard,
  useProjects,
  useWorkspaceRole,
} from '../../data/workspace/context';
import { workspaceErrorMessage } from '../../data/workspace/errors';
import { BoardGrid, canMutate, NewBoardDialog } from '../../projects/BoardGrid';

/** Boards of one project, plus the only way to make a new one. */
export default function ProjectPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const role = useWorkspaceRole();
  const mutable = canMutate(role);

  const id = projectId ?? '';
  const projects = useProjects();
  const project = projects.data?.find((candidate) => candidate.id === id);
  const boards = useBoards(id, { includeArchived: true });
  const create = useCreateBoard(id, async (board) => {
    setOpen(false);
    await navigate(`/b/${board.id}`);
  });

  if (projects.isPending || boards.isPending) {
    return (
      <section className="nx-stack" aria-busy="true" aria-label="Loading project">
        <Skeleton height="var(--nx-space-9)" />
        <Skeleton height="var(--nx-space-9)" />
      </section>
    );
  }

  if (projects.error || boards.error) {
    return (
      <Banner kind="danger" title="Couldn't load this project">
        {workspaceErrorMessage(projects.error ?? boards.error)}
      </Banner>
    );
  }

  if (!project) {
    return (
      <Banner kind="warn" title="That project no longer exists">
        It may have been deleted or moved. Pick another project from the rail.
      </Banner>
    );
  }

  const items = boards.data ?? [];

  return (
    <section className="nx-page">
      <header className="nx-page-head">
        <div>
          <p className="nx-page-kicker">Investigation workspace</p>
          <h2 className="nx-page-title">{project.name}</h2>
          <p className="nx-page-sub">
            {items.length === 0
              ? 'A clear starting point for your next investigation.'
              : `${String(items.length)} ${items.length === 1 ? 'board' : 'boards'} to collect, connect and investigate.`}
          </p>
        </div>
        {items.length > 0 ? (
          <Button
            variant="primary"
            icon={<PlusIcon aria-hidden="true" />}
            onClick={() => setOpen(true)}
            disabled={!mutable}
            title={mutable ? undefined : 'Viewers cannot create boards'}
          >
            New board
          </Button>
        ) : null}
      </header>

      {items.length === 0 ? (
        <div className="nx-empty">
          <div className="nx-empty-card">
            <div className="nx-empty-emblem" aria-hidden="true">
              <DashboardIcon />
            </div>
            <h3 className="nx-empty-title">Start with a board</h3>
            <p className="nx-empty-body">
              A board is one canvas: notes, links and files you connect while you work. Everything
              {capabilities.auth
                ? 'belongs to this organization workspace.'
                : 'stays on this device until you choose otherwise.'}
            </p>
            <Button
              variant="primary"
              icon={<PlusIcon aria-hidden="true" />}
              onClick={() => setOpen(true)}
              disabled={!mutable}
              title={mutable ? undefined : 'Viewers cannot create boards'}
            >
              Create your first board
            </Button>
          </div>
        </div>
      ) : (
        <BoardGrid boards={items} role={role} />
      )}
      <p className="nx-project-privacy">
        <LockClosedIcon aria-hidden="true" />
        {capabilities.auth
          ? 'Access follows your organization permissions.'
          : 'Local workspace. No account or external service required.'}
      </p>
      <NewBoardDialog
        open={open}
        onOpenChange={setOpen}
        submitting={create.isPending}
        {...(create.error ? { error: workspaceErrorMessage(create.error) } : {})}
        onSubmit={(input) => create.mutate(input)}
      />
    </section>
  );
}
