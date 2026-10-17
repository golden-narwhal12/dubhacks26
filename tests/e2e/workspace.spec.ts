import { test, expect, _electron as electron } from '@playwright/test';
test('desktop foundation: circuit, code, offline checks and layout', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(page.getByText('Hardware meets firmware.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'U1 terminal 13', exact: true })).toBeVisible();
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'artifacts/foundation-initial.png' });
  await page.getByRole('button', { name: 'Local checks', exact: false }).click();
  await expect(page.getByText('D1: ≈9.4 mA nominal estimate')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse output' }).click();
  await expect(async () => {
    expect((await page.locator('.canvas-area').boundingBox())!.height).toBeGreaterThan(600);
  }).toPass();
  await page.screenshot({ path: 'artifacts/foundation-desktop.png' });
  expect(errors).toEqual([]);
  await app.close();
});
