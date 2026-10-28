import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceProvider } from '../../data/workspace/context';
import { fakeBoard, fakeProject, fakeWorkspaceRepository } from '../../data/workspace/testFakes';
import { WorkspaceError, type WorkspaceRepository } from '../../data/workspace/types';
import ProjectPage from './ProjectPage';

const project = fakeProject({ id: 'p1', name: 'Atlas' });

let repository: WorkspaceRepository;

const base = (): WorkspaceRepository =>
  fakeWorkspaceRepository({
    listProjects: vi.fn(() => Promise.resolve([project])),
    createProject: vi.fn(() => Promise.reject(new Error('not used here'))),
    listBoards: vi.fn(() => Promise.resolve([])),
    createBoard: vi.fn((input: { projectId: string; title: string }) =>
      Promise.resolve(fakeBoard({ id: 'b-new', ...input })),
    ),
  });

beforeEach(() => {
  repository = base();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider repository={repository}>
        <MemoryRouter initialEntries={['/p/p1']}>
          <Routes>
            <Route path="/p/:projectId" element={<ProjectPage />} />
            <Route path="/b/:boardId" element={<p>canvas</p>} />
          </Routes>
        </MemoryRouter>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

describe('ProjectPage', () => {
  it('names the project and creates the first board', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Atlas' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /create your first board/i }));
    await userEvent.type(await screen.findByLabelText(/name/i), 'Sweep');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => {
      expect(repository.createBoard).toHaveBeenCalledWith({ projectId: 'p1', title: 'Sweep' });
    });
  });

  it('opens the new board once it exists', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Atlas' });
    await userEvent.click(screen.getByRole('button', { name: /create your first board/i }));
    await userEvent.type(await screen.findByLabelText(/name/i), 'Sweep');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(screen.getByText('canvas')).toBeInTheDocument());
  });

  it('links every existing board and offers another one', async () => {
    repository.listBoards = vi.fn(() =>
      Promise.resolve([fakeBoard({ id: 'b1', projectId: 'p1', title: 'Sweep' })]),
    );
    renderPage();
    expect(await screen.findByRole('link', { name: 'Sweep' })).toHaveAttribute('href', '/b/b1');
    expect(screen.getByRole('button', { name: 'New board' })).toBeInTheDocument();
  });

  it('shows a skeleton while either query is pending', () => {
    renderPage();
    expect(screen.getByLabelText('Loading project')).toBeInTheDocument();
  });

  it('maps a failed local read to copy the user can act on', async () => {
    repository.listBoards = vi.fn(() =>
      Promise.reject(new WorkspaceError('This device is out of storage.')),
    );
    renderPage();
    expect(await screen.findByText("Couldn't load this project")).toBeInTheDocument();
    expect(screen.getByText('This device is out of storage.')).toBeInTheDocument();
  });

  it('explains a project that is gone instead of rendering an empty page', async () => {
    repository.listProjects = vi.fn(() => Promise.resolve([]));
    renderPage();
    expect(await screen.findByText('That project no longer exists')).toBeInTheDocument();
  });
});

it('filters real board metadata, sorts by name and clears an empty result', async () => {
  repository.listBoards = vi.fn(() =>
    Promise.resolve([
      fakeBoard({ id: 'b1', projectId: 'p1', title: 'Source review' }),
      fakeBoard({ id: 'b2', projectId: 'p1', title: 'Evidence notes' }),
      fakeBoard({
        id: 'b3',
        projectId: 'p1',
        title: 'Archived template',
        archivedAt: '2026-01-01T00:00:00.000Z',
        isTemplate: true,
      }),
    ]),
  );
  renderPage();
  await screen.findByRole('link', { name: 'Source review' });
  await userEvent.type(screen.getByRole('searchbox', { name: 'Find a board' }), 'evidence');
  expect(screen.queryByRole('link', { name: 'Source review' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Evidence notes' })).toBeInTheDocument();
  await userEvent.type(screen.getByRole('searchbox'), ' missing');
  await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort boards' }), 'name');
  expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(
    expect.arrayContaining([expect.stringContaining('Evidence notes')]),
  );
  await userEvent.click(screen.getByRole('checkbox', { name: 'Show archived' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Templates only' }));
  expect(screen.getByRole('link', { name: 'Archived template' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Evidence notes' })).not.toBeInTheDocument();
});
