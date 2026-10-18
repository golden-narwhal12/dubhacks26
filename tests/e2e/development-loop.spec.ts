import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { menuAction } from './helpers';

async function project(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('trace.draft.v1')!));
}
async function dragPin(page: Page, from: string, to: string) {
  // Wait for the actual hit targets to settle after Dockview/Monaco's initial layout.
  await page.getByRole('button', { name: to, exact: true }).hover();
  await page.getByRole('button', { name: from, exact: true }).hover();
  const a = await page.getByRole('button', { name: from, exact: true }).boundingBox(),
    b = await page.getByRole('button', { name: to, exact: true }).boundingBox();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 15 });
  await page.mouse.up();
}
async function disconnectSignal(page: Page) {
  const point = await page
    .locator('[data-id="signal"] .react-flow__edge-path')
    .evaluate((node: any) => {
      const point = node.getPointAtLength(node.getTotalLength() * 0.88),
        svg = node.ownerSVGElement,
        p = svg.createSVGPoint();
      p.x = point.x;
      p.y = point.y;
      const screen = p.matrixTransform(node.getScreenCTM());
      return { x: screen.x, y: screen.y };
    });
  await page.mouse.click(point.x, point.y);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
}

test('manual wiring → mismatch → reviewed fix → real MCU output, save/reopen and zero inference', async () => {
  test.setTimeout(90000);
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('No API key connected.', { exact: true })).toBeVisible();
    await app.evaluate(() => {
      (globalThis as any).__modelRequests = 0;
      globalThis.fetch = async () => {
        (globalThis as any).__modelRequests++;
        throw new Error('No providers authorized in offline scenario');
      };
    });
    await disconnectSignal(page);
    await expect.poll(async () => (await project(page)).wires.length).toBe(2);
    await dragPin(page, 'U1 terminal 12', 'R1 terminal 1');
    await expect.poll(async () => (await project(page)).wires.length).toBe(3);
    await page.getByRole('button', { name: 'Issues and output', exact: true }).click();
    await expect(page.getByText('LED_PIN does not match the wiring')).toBeVisible();
    await page.getByRole('button', { name: 'Preview fix', exact: true }).click();
    await expect(page.getByText('Bind LED_PIN ↔ U1.12')).toBeVisible();
    await page.getByRole('button', { name: 'Apply and continue', exact: true }).click();
    await expect.poll(async () => (await project(page)).files[0].content).toContain('LED_PIN = 12');
    await menuAction(app, 'Undo Project Change');
    await expect.poll(async () => (await project(page)).files[0].content).toContain('LED_PIN = 13');
    await menuAction(app, 'Redo Project Change');
    await expect.poll(async () => (await project(page)).bindings[0].terminalId).toBe('d12');
    await page.getByRole('button', { name: 'Collapse output' }).click();
    await page.getByRole('button', { name: 'Simulate', exact: true }).click();
    await expect(page.getByText('Compiled MCU execution · external simavr')).toBeVisible({
      timeout: 60000,
    });
    await expect(page.locator('.uart-output')).toContainText('mudroom: indicator ready');
    await expect(page.locator('.uart-output')).toContainText('indicator ON');
    await expect(page.locator('.execution-scope')).toContainText('GPIO trace:');
    await page.getByRole('button', { name: 'Fit view', exact: true }).click();
    await expect
      .poll(() =>
        page.locator('.canvas-area').evaluate((canvas) => {
          const box = canvas.getBoundingClientRect();
          return [...canvas.querySelectorAll('.react-flow__node, .react-flow__edge-path')].every(
            (node) => {
              const part = node.getBoundingClientRect();
              return (
                part.top >= box.top &&
                part.bottom <= box.bottom &&
                part.left >= box.left &&
                part.right <= box.right
              );
            },
          );
        }),
      )
      .toBe(true);
    await page.screenshot({ path: 'artifacts/mcu-execution-desktop.png' });
    await app.evaluate(({ dialog, app }) => {
      const file = app.getPath('temp') + `/trace-e2e-${process.pid}.trace.json`;
      (dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: file });
      (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    });
    await menuAction(app, 'Save');
    await expect(page.locator('.notice')).toContainText('Saved');
    const saved = await project(page);
    await menuAction(app, 'New Project');
    await expect(page.getByText('Start with a connection.')).toBeVisible();
    await menuAction(app, 'Open…');
    await expect.poll(async () => (await project(page)).files[0].content).toContain('LED_PIN = 12');
    const reopened = await project(page);
    expect(reopened.wires).toEqual(saved.wires);
    expect(reopened.layouts).toEqual(saved.layouts);
    expect(await app.evaluate(() => (globalThis as any).__modelRequests)).toBe(0);
  } finally {
    await app.close();
  }
});

test('dock resizing/maximize/tabbing, part placement/deletion, code files and keyboard focus', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('No API key connected.', { exact: true })).toBeVisible();
    const circuit = page.getByRole('region', { name: 'Circuit', exact: true });
    await circuit.getByRole('button', { name: 'Maximize or restore pane' }).click();
    await expect(page.getByRole('region', { name: 'Code', exact: true })).not.toBeVisible();
    await circuit.getByRole('button', { name: 'Maximize or restore pane' }).click();
    await expect(page.getByRole('region', { name: 'Code', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Parts', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search parts' }).fill('ESP32');
    await page.getByRole('button', { name: /ESP32-S3 DevKitC-1/ }).click();
    await expect.poll(async () => (await project(page)).components.length).toBe(4);
    await page.getByRole('button', { name: 'Delete selection', exact: true }).click();
    await expect.poll(async () => (await project(page)).components.length).toBe(3);
    await menuAction(app, 'Undo Project Change');
    await expect.poll(async () => (await project(page)).components.length).toBe(4);
    await page.getByRole('button', { name: 'Add firmware file' }).click();
    await page.getByRole('textbox', { name: 'New firmware filename' }).fill('pins.h');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('button', { name: 'pins.h', exact: true })).toBeVisible();
    const editor = page.locator('.monaco-editor textarea');
    await editor.focus();
    await page.keyboard.insertText('#pragma once\nconstexpr int SENSOR_PIN = 4;\n');
    await expect
      .poll(async () => (await project(page)).files.find((f: any) => f.path === 'pins.h').content)
      .toContain('SENSOR_PIN');
    const tabs = page.getByRole('tab', { name: 'Agent', exact: true });
    const code = await page.getByRole('region', { name: 'Code', exact: true }).boundingBox();
    const fromTab = (await tabs.boundingBox())!,
      toTab = (await page.getByRole('tab', { name: 'Code', exact: true }).boundingBox())!;
    await page.mouse.move(fromTab.x + fromTab.width / 2, fromTab.y + fromTab.height / 2);
    await page.mouse.down();
    await page.mouse.move(fromTab.x + fromTab.width / 2 - 15, fromTab.y + fromTab.height / 2, {
      steps: 4,
    });
    await page.mouse.move(toTab.x + toTab.width / 2, toTab.y + toTab.height / 2, { steps: 20 });
    await page.mouse.move(toTab.x + toTab.width / 2 + 3, toTab.y + toTab.height / 2, { steps: 2 });
    await page.mouse.up();
    await expect(page.getByRole('tab', { name: 'Agent', exact: true })).toBeVisible();
    await expect(page.locator('.dv-groupview')).toHaveCount(2);
    await menuAction(app, 'Reset Workspace Layout');
    await expect(page.getByRole('region', { name: 'Agent', exact: true })).toBeVisible();
    await expect(page.locator('.dv-groupview')).toHaveCount(3);
    const circuitWidth = (await circuit.boundingBox())!.width;
    const sash = page
      .locator('.dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash')
      .first();
    const sashBounds = await sash.boundingBox();
    if (!sashBounds) throw new Error('Dock splitter is missing');
    await page.mouse.move(sashBounds.x + sashBounds.width / 2, sashBounds.y + 100);
    await page.mouse.down();
    await page.mouse.move(sashBounds.x + 70, sashBounds.y + 100, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () => (await circuit.boundingBox())!.width)
      .toBeGreaterThan(circuitWidth + 30);
    await page.getByRole('button', { name: 'Connect a provider' }).focus();
    await expect(page.getByRole('button', { name: 'Connect a provider' })).toBeFocused();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 760));
    await expect(page.getByRole('button', { name: 'Verify', exact: true })).toBeVisible();
    await page.screenshot({ path: 'artifacts/laptop-workspace.png' });
  } finally {
    await app.close();
  }
});

test('Gemini tool loop with deterministic protocol fixtures, visible proposal and encrypted key isolation', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('No API key connected.', { exact: true })).toBeVisible();
    await menuAction(app, 'Settings…');
    await page.getByLabel('Provider API key', { exact: true }).fill('FIXTURE_NOT_A_REAL_KEY');
    await page.getByRole('button', { name: 'Save connection' }).click();
    await expect(page.getByText('Key stored')).toBeVisible();
    await page.getByLabel('Change application policy').selectOption('preview');
    await page.getByRole('button', { name: 'Close settings' }).click();
    await app.evaluate(() => {
      let n = 0;
      (globalThis as any).__fixtureRequests = [];
      globalThis.fetch = async (_url: any, options: any) => {
        const body = JSON.parse(options.body);
        (globalThis as any).__fixtureRequests.push(body);
        let parts: any[];
        if (n++ === 0)
          parts = [
            {
              functionCall: {
                id: 'inspect',
                name: 'inspect_project',
                args: { section: 'summary' },
              },
            },
          ];
        else if (n === 2) {
          const summary = body.contents
            .flatMap((c: any) => c.parts)
            .find((p: any) => p.functionResponse)?.functionResponse.response.result;
          parts = [
            {
              functionCall: {
                id: 'edit',
                name: 'project_changes',
                args: {
                  expectedRevision: summary.revision,
                  summary: 'Label the shared indicator',
                  commands: [
                    { type: 'configureComponent', id: 'led', label: 'Agent updated indicator' },
                  ],
                },
              },
            },
          ];
        } else parts = [{ text: 'The component label is applied. [[led]]' }];
        return new Response(
          `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 15 } })}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        );
      };
    });
    await page
      .getByRole('textbox', { name: 'Ask mudroom', exact: true })
      .fill('Inspect the real shared circuit and label the LED.');
    await page.getByRole('button', { name: 'Send request', exact: true }).click();
    await expect(page.getByText('Proposed change', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Continue task', exact: true }),
    ).not.toBeVisible();
    expect((await app.evaluate(() => (globalThis as any).__fixtureRequests)).length).toBe(2);
    expect((await project(page)).components.find((c: any) => c.id === 'led').config.label).toBe(
      'Status indicator',
    );
    await page.getByRole('button', { name: 'Apply and continue', exact: true }).click();
    await expect
      .poll(
        async () => (await project(page)).components.find((c: any) => c.id === 'led').config.label,
      )
      .toBe('Agent updated indicator');
    await expect(page.getByText('The component label is applied. led')).toBeVisible();
    const requests = await app.evaluate(() => (globalThis as any).__fixtureRequests);
    expect(requests).toHaveLength(3);
    expect(JSON.stringify(requests)).not.toContain('FIXTURE_NOT_A_REAL_KEY');
    expect(JSON.stringify(await project(page))).not.toContain('FIXTURE_NOT_A_REAL_KEY');
    await menuAction(app, 'Settings…');
    await page.getByRole('button', { name: 'OpenAI', exact: true }).click();
    await expect(page.getByText('Not connected', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Google Gemini', exact: true }).click();
    await expect(page.getByText('Key stored', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Provider API key', { exact: true })).toHaveValue('');
  } finally {
    await app.close();
  }
});

test('proactive failed-build continuation stays inside the requested task and its budget', async () => {
  test.setTimeout(45000);
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('No API key connected.', { exact: true })).toBeVisible();
    await menuAction(app, 'Settings…');
    await page.getByLabel('Provider API key', { exact: true }).fill('FIXTURE_PROACTIVE_KEY');
    await page.getByRole('button', { name: 'Save connection' }).click();
    await expect(page.getByText('Key stored', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page
      .getByRole('combobox', { name: 'Participation mode', exact: true })
      .selectOption('proactive');
    await page.locator('.monaco-editor textarea').focus();
    await page.keyboard.press('Meta+a');
    await page.keyboard.insertText('void setup() { missing_function(); }\nvoid loop() {}\n');
    await expect
      .poll(async () => (await project(page)).files[0].content)
      .toContain('missing_function');
    await app.evaluate(() => {
      let n = 0;
      (globalThis as any).__proactiveRequests = [];
      globalThis.fetch = async (_url: any, options: any) => {
        const body = JSON.parse(options.body);
        (globalThis as any).__proactiveRequests.push(body);
        const round = n++;
        if (round === 0)
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 6000);
            options.signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new Error('cancelled'));
              },
              { once: true },
            );
          });
        const parts =
          round === 0
            ? [{ text: 'Initial requested inspection complete.' }]
            : round === 1
              ? [
                  {
                    functionCall: {
                      id: 'read-error',
                      name: 'read_firmware',
                      args: { fileId: 'main', startLine: 1, endLine: 10 },
                    },
                  },
                ]
              : [
                  {
                    text: 'The failed build identifies missing_function as undeclared; a correction requires defining it or removing the call.',
                  },
                ];
        return new Response(
          `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 12 } })}\n\n`,
        );
      };
    });
    await page
      .getByRole('textbox', { name: 'Ask mudroom', exact: true })
      .fill('Inspect the firmware project.');
    await page.getByRole('button', { name: 'Send request', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Cancel agent task', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Verify', exact: true }).click();
    await expect(
      page.getByText('Proactive: investigating your failed build within this active task.', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      page.getByText(
        'The failed build identifies missing_function as undeclared; a correction requires defining it or removing the call.',
        { exact: true },
      ),
    ).toBeVisible();
    const requests = await app.evaluate(() => (globalThis as any).__proactiveRequests);
    expect(requests).toHaveLength(3);
    expect(JSON.stringify(requests[1])).toContain('failed-build');
    expect(JSON.stringify(requests[2])).toContain('missing_function');
    await expect(
      page.getByRole('button', { name: 'Cancel agent task', exact: true }),
    ).not.toBeVisible();
  } finally {
    await app.close();
  }
});
