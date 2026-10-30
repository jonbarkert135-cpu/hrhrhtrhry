import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import LegalPage from './LegalPage';
import { legalDocuments } from './documents';
function page(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/legal/${id}`]}>
      <Routes>
        <Route path="/legal/:document" element={<LegalPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
describe('private group data notices', () => {
  for (const id of Object.keys(legalDocuments))
    it(`serves the real ${id} document with working internal navigation`, () => {
      const { container } = page(id);
      expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
      expect(container.querySelectorAll('main p').length).toBeGreaterThan(2);
      for (const anchor of container.querySelectorAll('footer a'))
        expect(anchor.getAttribute('href')).toMatch(/^\/(?:welcome|legal|$)/);
      expect(container.querySelectorAll('a[href^="mailto:"]').length).toBe(0);
    });
  it('describes optional background AI and retained history without inventing an operator', () => {
    page('privacy');
    expect(screen.getByText(/фоновом режиме/)).toBeVisible();
    expect(screen.getByText(/мгновенное удаление/)).toBeVisible();
    expect(screen.queryByText(/LLC|Inc\.|Ltd/)).toBeNull();
  });
  it('handles unknown document names without rendering arbitrary HTML', () => {
    page('constructor');
    expect(screen.getByRole('heading', { name: 'Документ не найден' })).toBeVisible();
  });
});
