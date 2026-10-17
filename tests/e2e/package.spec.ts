import { test, expect, _electron as electron } from '@playwright/test';
import { resolve } from 'node:path';
test('native macOS bundle launches from another working directory and runs bundled MCU helper', async () => {
  test.skip(!process.env.TRACE_PACKAGED, 'Opt in after npm run package');
  test.setTimeout(90000);
  const app = await electron.launch({
    executablePath: resolve(`release/Trace-darwin-${process.arch}/Trace.app/Contents/MacOS/Trace`),
    args: [],
    cwd: '/private/tmp',
    env: { ...process.env, TRACE_TEST: '1' },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('Hardware meets firmware.')).toBeVisible();
    const capabilities = await page.evaluate(() => window.trace!.capabilities());
    expect(capabilities).toEqual({ desktop: true, arduino: true, simavr: true });
    await page.getByRole('button', { name: 'Run MCU', exact: true }).click();
    await expect(page.locator('.uart-output')).toContainText('Trace: indicator ready', {
      timeout: 60000,
    });
    await expect(page.locator('.execution-scope')).toContainText('GPIO trace:');
    await page.getByRole('button', { name: 'Fit View', exact: true }).click();
    await page.screenshot({ path: 'artifacts/native-bundle-execution.png' });
  } finally {
    await app.close();
  }
});
