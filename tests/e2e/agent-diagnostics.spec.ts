import { test, expect, _electron as electron } from '@playwright/test';
import { exampleProject } from '../../src/domain/example';

// Software-only fixtures: no provider requests, port opens or hardware approvals.
test('tool activity groups distinct calls and deduplicates replayed call identities', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('No API key connected.', { exact: true })).toBeVisible();
    await page.evaluate(() => {
      localStorage.setItem(
        'trace.session.v1',
        JSON.stringify({
          messages: [
            { id: 'goal', role: 'user', text: 'Create a useful circuit.' },
            {
              id: 'step-1',
              role: 'activity',
              kind: 'tool',
              taskId: 'task-fixture',
              requestId: 'request-1',
              toolCallId: 'inspect-1',
              toolName: 'inspect_project',
              status: 'running',
              text: 'Inspecting project',
            },
            {
              id: 'step-1-replay',
              role: 'activity',
              kind: 'tool',
              taskId: 'task-fixture',
              requestId: 'request-1',
              toolCallId: 'inspect-1',
              toolName: 'inspect_project',
              status: 'completed',
              text: 'Project inspected',
              details: 'Bounded project summary',
            },
            {
              id: 'step-2',
              role: 'activity',
              kind: 'tool',
              taskId: 'task-fixture',
              requestId: 'request-2',
              toolCallId: 'inspect-1',
              toolName: 'inspect_project',
              status: 'completed',
              text: 'A genuinely distinct inspection',
            },
            {
              id: 'step-3',
              role: 'activity',
              kind: 'tool',
              taskId: 'task-fixture',
              requestId: 'request-2',
              toolCallId: 'build-1',
              toolName: 'build_firmware',
              status: 'failed',
              text: 'Dependency unavailable',
            },
            {
              id: 'answer',
              role: 'assistant',
              text: 'The project is saved. One dependency still needs attention.',
            },
          ],
        }),
      );
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.reload(),
    );
    const group = page.locator('.activity-group');
    await expect(group).toHaveCount(1);
    await expect(group.locator('summary')).toContainText('3 steps');
    await expect(group.locator('summary')).toContainText('1 failed');
    await expect(group.locator('.activity-error')).toContainText('Dependency unavailable');
    await expect(
      page.getByText('The project is saved. One dependency still needs attention.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(group.locator('ol')).not.toBeVisible();
    await group.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(group.locator('ol > li')).toHaveCount(3);
    await expect(
      group.locator('[data-request-id="request-1"][data-tool-call-id="inspect-1"]'),
    ).toContainText('Project inspected');
    await expect(
      group.locator('[data-request-id="request-2"][data-tool-call-id="inspect-1"]'),
    ).toContainText('genuinely distinct');
    await page.keyboard.press('Enter');
    await expect(group.locator('ol')).not.toBeVisible();
    await page.screenshot({ path: 'artifacts/agent-compact-activity.png' });
  } finally {
    await app.close();
  }
});

test('diagnostic popovers dismiss without swallowing selection and expose explicit Explain/Fix requests', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('No API key connected.', { exact: true })).toBeVisible();
    await app.evaluate(() => {
      (globalThis as any).__diagnosticModelRequests = 0;
      globalThis.fetch = async () => {
        (globalThis as any).__diagnosticModelRequests++;
        throw new Error('No model request permitted in UI fixture.');
      };
    });
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
    await page.evaluate((seed) => {
      localStorage.setItem('trace.draft.v1', JSON.stringify(seed));
    }, project);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.reload(),
    );
    await expect(page.getByRole('button', { name: 'D1 issues', exact: true })).toBeVisible();
    await page.evaluate(() => {
      (window as any).__diagnosticRequests = [];
      window.addEventListener('trace:diagnostic-request', (event) =>
        (window as any).__diagnosticRequests.push((event as CustomEvent).detail),
      );
    });
    const trigger = page.getByRole('button', { name: 'D1 issues', exact: true });
    await trigger.click();
    const popup = page.getByRole('dialog', { name: 'D1 diagnostics', exact: true });
    await expect(popup).toContainText('no series resistor');
    await page.locator('[data-id="board"] .part-art svg').click();
    await expect(popup).not.toBeVisible();
    await expect(page.locator('.inspector h3')).toContainText('U1');
    await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(popup).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await popup.getByRole('button', { name: 'Ask Agent', exact: true }).click();
    await popup.getByRole('menuitem', { name: 'Explain', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__diagnosticRequests))
      .toEqual([{ id: 'led-resistor-led', action: 'explain' }]);
    // Configuring credentials is a local action; opening the issue or action menu makes no request.
    if (await page.getByRole('dialog', { name: 'Settings', exact: true }).isVisible())
      await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Issues and output', exact: true }).click();
    const issue = page
      .locator('.diagnostic')
      .filter({ hasText: 'D1: no series resistor identified' });
    await issue.getByRole('button', { name: 'Ask Agent', exact: true }).click();
    await issue.getByRole('menuitem', { name: 'Fix', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__diagnosticRequests))
      .toEqual([
        { id: 'led-resistor-led', action: 'explain' },
        { id: 'led-resistor-led', action: 'fix' },
      ]);
    expect(await app.evaluate(() => (globalThis as any).__diagnosticModelRequests)).toBe(0);
  } finally {
    await app.close();
  }
});
