import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openNewBoard } from '../support/board.ts';

async function openProject(page: Page) {
  if (process.env.E2E_UI_MODE === 'local') await page.goto('/');
  else await openNewBoard(page);
  await page
    .getByRole('navigation', { name: 'Projects' })
    .locator('a[href^="/p/"]')
    .first()
    .click();
  await expect(page).toHaveURL(/\/p\//);
  await expect(page.getByRole('button', { name: 'New board', exact: true })).toBeVisible();
}

test('workspace discovery, board filtering and command navigation work through the UI', async ({
  page,
}) => {
  await openProject(page);
  for (const title of ['Source review', 'Evidence notes']) {
    await page.getByRole('button', { name: 'New board', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(title);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByTestId('node-count')).toHaveAttribute('data-nodes', '0');
    await page
      .getByRole('navigation', { name: 'Projects' })
      .locator('a[href^="/p/"]')
      .first()
      .click();
  }
  await page.reload();
  const search = page.getByRole('searchbox', { name: 'Find a board' });
  await search.fill('eViDeNcE');
  await expect(page.getByRole('link', { name: 'Evidence notes', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Source review', exact: true })).toHaveCount(0);
  await search.fill('No matching board');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('combobox', { name: 'Sort boards' }).selectOption('name');
  const names = await page.locator('.nx-board-card-title').allTextContents();
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  await page.getByRole('button', { name: 'Search commands' }).click();
  await page.getByRole('textbox', { name: 'Command palette' }).fill('Go to settings');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings$/);
  if (process.env.E2E_UI_MODE !== 'local') {
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  }
});

test('mobile layout respects reduced motion and restores dialog focus without horizontal page overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openProject(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await page.locator('.nx-page').evaluate((el) => getComputedStyle(el).animationName)).toBe(
    'none',
  );
  const trigger = page.getByRole('button', { name: 'New board', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'New board' });
  await expect(dialog.getByLabel('Name', { exact: true })).toBeFocused();
  expect(await dialog.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .exclude('canvas')
    .analyze();
  expect(audit.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});
