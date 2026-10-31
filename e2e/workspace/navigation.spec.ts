import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openNewBoard } from '../support/board';

test('canvas navigation operates the real camera and groups lines from the keyboard', async ({
  page,
}) => {
  if (process.env.E2E_UI_MODE === 'local') await page.goto('/');
  else await openNewBoard(page);
  const dock = page.getByRole('region', { name: 'Canvas navigation' });
  const zoom = dock.getByRole('combobox', { name: 'Zoom level' });
  await expect(zoom).toHaveValue('1');
  await dock.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(zoom).toHaveValue('1.25');
  await dock.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await expect(zoom).toHaveValue('1');
  await zoom.selectOption('2');
  await expect(zoom).toHaveValue('2');
  await dock.getByRole('button', { name: 'Fit board to view' }).click();
  await expect(zoom).toHaveValue('1');
  const slider = dock.getByRole('slider', { name: 'Line grouping' });
  await slider.focus();
  await slider.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', '10%');
  await expect(dock.getByRole('status')).toHaveText('10%');
  await slider.press('Home');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Off');
  const audit = await new AxeBuilder({ page })
    .include('.nx-canvas-navigator')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(audit.violations.map((violation) => violation.id)).toEqual([]);
});

test('map folding stays inside a mobile viewport and respects reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (process.env.E2E_UI_MODE === 'local') await page.goto('/');
  else await openNewBoard(page);
  const dock = page.getByRole('region', { name: 'Canvas navigation' });
  const toggle = dock.getByRole('button', { name: 'Toggle minimap' });
  const canvas = await page.getByTestId('canvas-minimap').elementHandle();
  const before = await dock.boundingBox();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.nx-map-panel')).toHaveAttribute('inert');
  await expect
    .poll(async () => (await dock.boundingBox())?.height ?? 0)
    .toBeLessThan((before?.height ?? 0) - 100);
  expect(await canvas?.evaluate((element) => element.isConnected)).toBe(true);
  const bounds = await dock.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(await dock.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  await toggle.press('m');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.nx-map-panel')).not.toHaveAttribute('inert');
  const zoom = dock.getByRole('combobox', { name: 'Zoom level' });
  await zoom.selectOption('4');
  await expect(dock.getByRole('button', { name: 'Zoom in', exact: true })).toBeDisabled();
  await zoom.selectOption('0.05');
  await expect(dock.getByRole('button', { name: 'Zoom out', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
