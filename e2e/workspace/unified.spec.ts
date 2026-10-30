import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openNewBoard } from '../support/board';

test('footer documents are public, readable and stay inside the application', async ({ page }) => {
  await page.goto('/welcome');
  await page
    .getByRole('navigation', { name: 'Data links' })
    .getByRole('link', { name: 'Data & privacy' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Какие данные использует Raven');
  await expect(page.locator('main')).toContainText('фоновом режиме');
  for (const id of ['terms', 'data-rules', 'security', 'copyright', 'credits']) {
    await page.goto(`/legal/${id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  const licence = await page.request.get('/legal/Manrope-OFL.txt');
  expect(licence.ok()).toBe(true);
  expect(await licence.text()).toContain('SIL OPEN FONT LICENSE');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/legal/privacy');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(audit.violations.map((v) => v.id)).toEqual([]);
});

test('the Raven pauses on request and outside the viewport without drawing in the background', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as unknown as { ravenDraws: number };
    state.ravenDraws = 0;
    const original = WebGLRenderingContext.prototype.drawElements;
    WebGLRenderingContext.prototype.drawElements = function (...args) {
      state.ravenDraws += 1;
      return original.apply(this, args);
    };
  });
  await page.goto('/welcome');
  const pause = page.getByRole('button', { name: 'Pause rotation', exact: true });
  await expect(pause).toBeVisible({ timeout: 15_000 });
  const draws = () => page.evaluate(() => (window as unknown as { ravenDraws: number }).ravenDraws);
  await expect.poll(draws).toBeGreaterThan(2);
  await pause.click();
  await expect(page.getByRole('button', { name: 'Resume rotation' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.waitForTimeout(100);
  const paused = await draws();
  await page.waitForTimeout(250);
  expect(await draws()).toBe(paused);
  await page.getByRole('button', { name: 'Resume rotation' }).click();
  await page.locator('.rvn-site-footer').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const hidden = await draws();
  await page.waitForTimeout(250);
  expect(await draws()).toBe(hidden);
});

test('reduced motion uses static artwork without loading the geometry', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const geometry: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('raven-sculpture.bin')) geometry.push(r.url());
  });
  await page.goto('/welcome');
  await expect(page.locator('.rvn-sculpture')).toHaveAttribute('data-renderer', 'static');
  await expect(page.getByRole('button', { name: 'Pause rotation' })).toHaveCount(0);
  expect(geometry).toEqual([]);
});

test('the investigation tree preset previews before applying and supports one-step undo', async ({
  page,
}) => {
  if (process.env.E2E_UI_MODE === 'local') await page.goto('/');
  else await openNewBoard(page);
  for (let i = 0; i < 3; i += 1) await page.getByTestId('add-note').click();
  await expect(page.getByTestId('node-count')).toHaveAttribute('data-nodes', '3');
  const before = await page.locator('[data-node-type="note"]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.parentElement?.getAttribute('data-node-id'),
      placement: (node.parentElement as HTMLElement | null)?.style.transform,
    })),
  );
  await page.getByTestId('auto-arrange-open').click();
  await page.getByRole('button', { name: 'Investigation tree', exact: true }).click();
  await expect(page.getByLabel('Layout', { exact: true })).toHaveValue('tree');
  await expect(page.getByLabel('Direction', { exact: true })).toHaveValue('right');
  await page.getByTestId('auto-arrange-preview').click();
  await expect(page.getByTestId('layout-ghosts')).toBeVisible();
  await page.getByTestId('auto-arrange-apply').click();
  await expect(page.getByTestId('layout-toast')).toContainText('One undo');
  await page.getByTestId('layout-toast-undo').click();
  const after = await page.locator('[data-node-type="note"]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.parentElement?.getAttribute('data-node-id'),
      placement: (node.parentElement as HTMLElement | null)?.style.transform,
    })),
  );
  expect(after).toEqual(before);
  await expect(page.getByTestId('node-count')).toHaveAttribute('data-nodes', '3');
  await page.getByRole('combobox', { name: 'Zoom level' }).selectOption('fit');
  const canvas = page.getByTestId('canvas-surface');
  // Undo restores the three overlapping notes; hit testing selects the topmost card.
  const topmost = page.locator('[data-node-type="note"]').last();
  await expect(topmost).toBeVisible();
  let previousBounds = '';
  let stableSamples = 0;
  await expect
    .poll(async () => {
      const area = await canvas.boundingBox();
      const card = await topmost.boundingBox();
      const bounds = JSON.stringify(card);
      stableSamples = bounds === previousBounds ? stableSamples + 1 : 0;
      previousBounds = bounds;
      return (
        stableSamples >= 3 &&
        area !== null &&
        card !== null &&
        card.x >= area.x &&
        card.y >= area.y &&
        card.x + card.width <= area.x + area.width &&
        card.y + card.height <= area.y + area.height
      );
    })
    .toBe(true);
  const area = await canvas.boundingBox();
  if (area === null) throw new Error('Canvas unavailable');
  await page.mouse.click(area.x + 2, area.y + 2);
  const card = await topmost.boundingBox();
  if (card === null) throw new Error('Card unavailable');
  await page.mouse.click(card.x + card.width / 2, card.y + card.height / 2);
  await expect(topmost).toHaveAttribute('data-state', 'selected');
});

test('a browser without WebGL retains the emblem and can enter the workspace', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { ravenGlAttempts: number };
    state.ravenGlAttempts = 0;
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: function (this: HTMLCanvasElement, kind: string, options?: unknown) {
        if (kind === 'webgl') {
          state.ravenGlAttempts += 1;
          return null;
        }
        return Reflect.apply(original, this, [kind, options]) as RenderingContext | null;
      },
    });
  });
  await page.goto('/welcome');
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { ravenGlAttempts: number }).ravenGlAttempts),
    )
    .toBe(1);
  await expect(page.locator('.rvn-sculpture')).toHaveAttribute('data-renderer', 'static');
  await page.locator('.rvn-hero').getByRole('link', { name: 'Open workspace' }).click();
  if (process.env.E2E_UI_MODE === 'local')
    await expect(page.getByTestId('canvas-surface')).toBeVisible();
  else await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
});
