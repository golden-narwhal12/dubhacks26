import { test, expect, _electron as electron } from '@playwright/test';
import { exampleProject } from '../../src/domain/example';
import { menuAction } from './helpers';

test('circuit diagnostics use the native top layer, dismiss without consuming gestures and yield to Settings', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.react-flow')).toBeVisible();
    const project = exampleProject();
    project.components = project.components.filter((component) => component.id !== 'resistor');
    delete project.layouts.wiring.resistor;
    delete project.layouts.schematic.resistor;
    project.bindings = [];
    project.wires = [
      {
        id: 'direct-led',
        from: { componentId: 'board', terminalId: 'd13' },
        to: { componentId: 'led', terminalId: 'a' },
        color: 'mint',
      },
      project.wires.find((wire) => wire.id === 'return')!,
    ];
    await page.evaluate(
      (seed) => localStorage.setItem('trace.draft.v1', JSON.stringify(seed)),
      project,
    );
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(1180, 760);
      win.webContents.reload();
    });
    const trigger = page.getByRole('button', { name: 'D1 issues', exact: true });
    await trigger.click();
    const popup = page.getByRole('dialog', { name: 'D1 diagnostics', exact: true });
    await expect(popup).toBeVisible();
    expect(
      await popup.evaluate(
        (element) => element.matches(':popover-open') && element.parentElement === document.body,
      ),
    ).toBe(true);
    expect(await trigger.locator('svg').getAttribute('class')).toContain('circle-alert');
    expect(
      await popup.evaluate((element) => {
        const r = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + 12));
      }),
    ).toBe(true);
    await page.screenshot({ path: 'artifacts/circuit-top-layer-laptop.png' });
    // First outside pointer still selects the intended board rather than being swallowed.
    await page.locator('[data-id="board"] .part-art svg').click();
    await expect(popup).not.toBeVisible();
    await expect(page.locator('.inspector h3')).toContainText('U1');
    await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await trigger.click();
    await menuAction(app, 'Settings…');
    await expect(popup).not.toBeVisible();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(settings).toBeVisible();
    expect(await settings.evaluate((element) => element.matches(':modal'))).toBe(true);
    await page.keyboard.press('Escape');
    // Floating circuit content still uses the same top-layer overlay.
    const circuit = page.getByRole('region', { name: 'Circuit', exact: true });
    await circuit.getByRole('button', { name: 'Float pane', exact: true }).click();
    await trigger.click();
    await expect(popup).toBeVisible();
    expect(await popup.evaluate((element) => element.matches(':popover-open'))).toBe(true);
    await popup.getByRole('button', { name: 'Ask Agent', exact: true }).click();
    await expect(popup.getByRole('menuitem', { name: 'Explain', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popup).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popup).not.toBeVisible();
  } finally {
    await app.close();
  }
});
