import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openNewBoard } from '../support/board.ts';

test('public welcome loads its own artwork and opens the existing workspace', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes(':3001/')) apiRequests.push(request.url());
  });
  await page.goto('/welcome');
  await expect(page.getByRole('heading', { name: 'Raven OSINT' })).toBeVisible();
  await page.locator('.rvn-product').scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page
        .locator('.rvn-welcome img')
        .evaluateAll((images) =>
          images.every(
            (image) =>
              image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  expect(apiRequests).toEqual([]);
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(audit.violations.map((violation) => `${violation.id}: ${violation.nodes.length}`)).toEqual(
    [],
  );
  await page.locator('.rvn-hero').getByRole('link', { name: 'Open workspace' }).click();
  if (process.env.E2E_UI_MODE === 'local') {
    await expect(page.getByTestId('canvas-surface')).toBeVisible();
    expect(apiRequests).toEqual([]);
  } else {
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  }
});

test('welcome remains readable on mobile and respects reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/welcome');
  await expect(
    page.locator('.rvn-hero').getByRole('link', { name: 'Open workspace' }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    await page.locator('.rvn-hero-art img').evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(audit.violations.map((violation) => `${violation.id}: ${violation.nodes.length}`)).toEqual(
    [],
  );
});

test('manual person edits update the card immediately and survive reload', async ({ page }) => {
  if (process.env.E2E_UI_MODE === 'local') await page.goto('/');
  else await openNewBoard(page);
  await page.getByTestId('quick-add').click();
  await page.getByRole('menuitem', { name: 'Person', exact: true }).click();
  const person = page.locator('[data-node-type="person"]');
  await expect(person).toContainText('Manual entry');
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await title.fill('Mira Example');
  await title.press('Enter');
  await expect(person.locator('.nx-card-title')).toHaveText('Mira Example');
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await name.fill('Mira Example');
  await name.press('Enter');
  const email = page.getByRole('textbox', { name: 'Emails', exact: true });
  await email.fill('mira@example.test');
  await email.press('Tab');
  await expect(person).toContainText('mira@example.test');
  await expect(person).not.toContainText('Unnamed person');
  await page.reload();
  await expect(person.locator('.nx-card-title')).toHaveText('Mira Example');
  await expect(person).toContainText('mira@example.test');
  await expect(person).toContainText('Manual entry');
});
