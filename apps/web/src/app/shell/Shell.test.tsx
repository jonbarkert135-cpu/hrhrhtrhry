import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceProvider } from '../../data/workspace/context';
import { fakeWorkspaceRepository } from '../../data/workspace/testFakes';
import { Shell } from './Shell';

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('../../lib/auth', () => ({ authClient: { signOut } }));
function LocationReport() {
  return <output aria-label="Current route">{useLocation().pathname}</output>;
}

function renderShell(props: Partial<Parameters<typeof Shell>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LocationReport />
        <WorkspaceProvider repository={fakeWorkspaceRepository()}>
          <Shell {...props}>
            <p>board</p>
          </Shell>
        </WorkspaceProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Shell', () => {
  it('renders skeletons instead of a blank page while loading', () => {
    renderShell({ loading: true });
    expect(screen.getByLabelText('Loading projects')).toBeInTheDocument();
    expect(screen.getByLabelText('Loading board')).toBeInTheDocument();
    expect(screen.queryByText('board')).not.toBeInTheDocument();
  });

  it('teaches the user what to do when there are no projects', () => {
    renderShell({ projects: [] });
    expect(screen.getByRole('button', { name: 'Create your first project' })).toBeInTheDocument();
  });

  it('shows the mapped error copy with a retry action', () => {
    renderShell({ error: 'The server took too long to answer.', onRetry: () => {} });
    expect(screen.getByText("Couldn't load your projects")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('puts skip-to-content first in tab order', () => {
    renderShell({ projects: [{ id: 'p1', name: 'Alpha' }] });
    const focusable = screen.getByRole('link', { name: /skip to content/i });
    expect(focusable).toBeInTheDocument();
  });

  it('shows the brand lockup with a decorative (non-announced) mark', () => {
    renderShell({ projects: [{ id: 'p1', name: 'Alpha' }], boardTitle: 'Case 12' });
    const lockup = screen.getByTestId('brand-lockup');
    expect(lockup).toHaveTextContent('Raven OSINT');
    // The mark is decorative: the board title stays the only heading in the chrome.
    expect(lockup.querySelector('img')).toHaveAttribute('alt', '');
    expect(screen.getByRole('heading', { name: 'Case 12' })).toBeInTheDocument();
  });
});

it('opens commands from the visible search button and supports keyboard dismissal', async () => {
  renderShell();
  await userEvent.click(screen.getByRole('button', { name: 'Search commands' }));
  expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('navigates from the account menu instead of rendering inactive items', async () => {
  renderShell();
  await userEvent.click(screen.getByRole('button', { name: 'Account' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/settings');
  expect(screen.getByRole('heading', { name: 'Workspace settings' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Account' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'System' }));
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/system');
});
it('signs out only on an explicit action and navigates after success', async () => {
  signOut.mockResolvedValue({ error: null });
  renderShell({ authEnabled: true });
  expect(signOut).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Account' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
  await waitFor(() => expect(screen.getByLabelText('Current route')).toHaveTextContent('/login'));
});
it.each([false, true])(
  'keeps the workspace usable when sign out fails (network: %s)',
  async (networkFailure) => {
    if (networkFailure) signOut.mockRejectedValue(new Error('Unavailable'));
    else signOut.mockResolvedValue({ error: { message: 'Unavailable' } });
    renderShell({ authEnabled: true });
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByText("Couldn't sign out")).toBeInTheDocument();
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText("Couldn't sign out")).not.toBeInTheDocument();
  },
);
