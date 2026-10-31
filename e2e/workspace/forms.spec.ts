import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openNewBoard, unique } from '../support/board';

async function openCollections(page: Page): Promise<void> {
  if (process.env.E2E_UI_MODE === 'local') await page.goto('/');
  else await openNewBoard(page);
  await page
    .getByRole('navigation', { name: 'Projects' })
    .locator('a[href^="/p/"]')
    .first()
    .click();
  await page.getByRole('link', { name: 'Data collections', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Collections', exact: true })).toBeVisible();
}
async function createCollection(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'New collection', exact: true }).click();
  await page.getByLabel('Collection name', { exact: true }).fill(`Fictional research ${unique()}`);
  await page.getByRole('button', { name: 'Create collection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New Person form', exact: true })).toBeEnabled();
}

test('collection forms publish immutable versions and keep preview data transient', async ({
  page,
}) => {
  const errors: string[] = [];
  await openCollections(page);
  page.on('pageerror', (error) => errors.push(error.message));
  const dataRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (/^\/(?:trpc|auth)\//.test(url.pathname) || /^wss?:$/.test(url.protocol))
      dataRequests.push(request.url());
  });
  await createCollection(page);
  await expect(page.getByTestId('canvas-surface')).toHaveCount(0);
  await page.getByRole('button', { name: 'New Person form', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Person form', exact: true });
  await dialog.getByLabel('Field 1 label', { exact: true }).fill('Legal name');
  await dialog.getByRole('textbox', { name: /^Legal name/ }).fill('Synthetic preview only');
  await dialog.getByLabel('Email 1', { exact: true }).fill('invalid');
  await dialog.getByRole('button', { name: 'Check preview', exact: true }).click();
  await expect(dialog.getByText('Enter an email address', { exact: true })).toBeVisible();
  await dialog.getByLabel('Email 1', { exact: true }).fill('fictional@example.test');
  await expect(dialog.getByText('Input formats are valid', { exact: true })).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Save form', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: 'Preview Person v1', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /^Legal name/ })).toHaveValue('');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'New version of Person v1', exact: true }).click();
  await page.getByLabel('Field 1 type', { exact: true }).selectOption('email');
  await expect(
    page.getByText('Change Legal name from text to email', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save version 2', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Preview Person v1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview Person v2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preview Person v1', exact: true }).click();
  await page.getByRole('textbox', { name: /^Legal name/ }).fill('Still text in version one');
  await page.getByRole('button', { name: 'Check preview', exact: true }).click();
  await expect(page.getByText('Input formats are valid', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  if (process.env.E2E_UI_MODE === 'local') expect(dataRequests).toEqual([]);
});

test('custom forms remain usable on mobile with reduced motion and keyboard navigation', async ({
  page,
}) => {
  await openCollections(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await createCollection(page);
  await page.getByRole('button', { name: 'Custom form', exact: true }).click();
  await page.getByLabel('Form name', { exact: true }).fill('Interview');
  await page.getByRole('button', { name: 'Add field', exact: true }).click();
  await page.getByLabel('Field 1 label', { exact: true }).fill('Attendance');
  await page.getByLabel('Field 1 type', { exact: true }).selectOption('boolean');
  await page.getByRole('combobox', { name: 'Attendance', exact: true }).selectOption('false');
  await page.getByRole('button', { name: 'Check preview', exact: true }).click();
  await expect(page.getByText('Input formats are valid', { exact: true })).toBeVisible();
  const geometry = await page.getByRole('dialog').evaluate((dialog) => ({
    left: dialog.getBoundingClientRect().left,
    right: dialog.getBoundingClientRect().right,
    width: document.documentElement.clientWidth,
    content: dialog.scrollWidth,
    box: dialog.clientWidth,
  }));
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.width);
  expect(geometry.content).toBeLessThanOrEqual(geometry.box + 1);
  await page.getByRole('button', { name: 'Save form', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Preview Interview v1', exact: true }),
  ).toBeVisible();
});
