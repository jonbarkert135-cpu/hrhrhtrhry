import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, afterEach } from 'vitest';
import WelcomePage from './WelcomePage';

afterEach(() => vi.unstubAllGlobals());
function renderWelcome() {
  return render(
    <MemoryRouter initialEntries={['/welcome']}>
      <Routes>
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/" element={<h1>Workspace opened</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}
describe('public Raven welcome page', () => {
  it('renders the product without requesting an account or remote data', () => {
    const forbidden = vi.fn(() => {
      throw new Error('No network on the public welcome page');
    });
    vi.stubGlobal('fetch', forbidden);
    renderWelcome();
    expect(screen.getByRole('heading', { level: 1, name: 'Raven OSINT' })).toBeInTheDocument();
    expect(screen.getByText('Starts on your device. No account required')).toBeInTheDocument();
    expect(forbidden).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole('navigation', { name: 'Welcome navigation' })).getByRole('link', {
        name: 'Workflow',
      }),
    ).toHaveAttribute('href', '#workflow');
    expect(screen.getByRole('link', { name: 'Principles' })).toHaveAttribute('href', '#principles');
  });
  it('opens the actual workspace route from the metallic CTA', async () => {
    renderWelcome();
    await userEvent.click(
      within(screen.getByRole('region', { name: 'Raven OSINT' })).getByRole('link', {
        name: 'Open workspace',
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Workspace opened' })).toBeInTheDocument();
  });
});
