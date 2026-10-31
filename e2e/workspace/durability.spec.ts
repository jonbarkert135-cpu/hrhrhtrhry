import { expect, test } from '@playwright/test';
import { openNewBoard } from '../support/board';

test('Saved waits for a native IndexedDB commit and survives an immediate reload', async ({
  page,
}) => {
  if (process.env.E2E_UI_MODE === 'local') await page.goto('/');
  else await openNewBoard(page);
  await page.getByTestId('add-note').click();
  const status = page.getByTestId('sync-status');
  await expect(status).toHaveAttribute('data-state', 'saved');
  await page.evaluate(async () => {
    const boardId = location.pathname.match(/\/b\/([^/]+)/)?.[1] ?? 'scratch';
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`raven-board-${boardId}`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Test IndexedDB could not open'));
    });
    const transaction = database.transaction('updates', 'readwrite');
    let held = true;
    const completed = new Promise<void>((resolve) => {
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
    });
    const keepAlive = (): void => {
      const request = transaction.objectStore('updates').get(0);
      request.onsuccess = () => {
        if (held) keepAlive();
      };
    };
    keepAlive();
    // Test-owned lock on the native store, without a product hook or a mocked persistence layer.
    (window as unknown as { releaseSaveLock: () => Promise<void> }).releaseSaveLock = () => {
      held = false;
      return completed;
    };
  });
  try {
    const title = page.getByRole('textbox', { name: 'Title', exact: true });
    await title.fill('Synthetic durable note');
    await title.press('Tab');
    await expect(page.locator('[data-node-type="note"]')).toContainText('Synthetic durable note');
    await expect(status).toHaveAttribute('data-state', 'saving');
  } finally {
    await page.evaluate(() =>
      (window as unknown as { releaseSaveLock: () => Promise<void> }).releaseSaveLock(),
    );
  }
  await expect(status).toHaveAttribute('data-state', 'saved');
  await page.reload();
  await expect(page.locator('[data-node-type="note"]')).toContainText('Synthetic durable note');
});
