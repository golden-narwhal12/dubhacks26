import { test, expect, _electron as electron } from '@playwright/test';
import { menuAction } from './helpers';
import { readFileSync } from 'node:fs';
test('manual servo/encoder template is editable, compiles exact source, and Debug never invents offline readings', async () => {
  test.setTimeout(60000);
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('No API key connected.', { exact: true })).toBeVisible();
    await app.evaluate(() => {
      (globalThis as any).__offlineRequests = 0;
      globalThis.fetch = async () => {
        (globalThis as any).__offlineRequests++;
        throw Error('No model requests authorized');
      };
    });
    await menuAction(app, 'Servo and Encoder Example');
    await expect
      .poll(async () =>
        page.evaluate(() => JSON.parse(localStorage.getItem('trace.draft.v1')!).components.length),
      )
      .toBe(5);
    const source = readFileSync('examples/servo-encoder/sketch.ino', 'utf8');
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('trace.draft.v1')!).files[0].content,
      ),
    ).toBe(source);
    await page.getByRole('button', { name: 'Fit view', exact: true }).click();
    await expect(page.getByText('Route blocked · move part')).toHaveCount(0);
    await page.screenshot({ path: 'artifacts/servo-encoder-manual-example.png' });
    await page.getByRole('button', { name: 'Verify', exact: true }).click();
    await expect(page.getByText('Build complete.', { exact: false })).toBeVisible({
      timeout: 40000,
    });
    await page.getByRole('button', { name: 'Debug', exact: true }).click();
    await expect(page.getByText('Not reported', { exact: true })).toHaveCount(4);
    expect(await app.evaluate(() => (globalThis as any).__offlineRequests)).toBe(0);
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('trace.draft.v1')!).files[0].content,
      ),
    ).toBe(source);
  } finally {
    await app.close();
  }
});
