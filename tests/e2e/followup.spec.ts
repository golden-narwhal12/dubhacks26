import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { menuAction } from './helpers';
import { buildKey } from '../../src/domain/semantics';
import { exampleProject } from '../../src/domain/example';
async function hardwareFixture(app: ElectronApplication) {
  await app.evaluate(async (_electron, key) => {
    const service = (globalThis as any).__traceTestHardware;
    const EventEmitter = Object.getPrototypeOf(
      Object.getPrototypeOf(service.dependencies.serial),
    ).constructor;
    const device = {
      key: '/dev/cu.fixture',
      path: '/dev/cu.fixture',
      label: 'Fixture Mega',
      identity: 'fixture:mega:123',
      serialNumber: '123',
      weakIdentity: false,
      boardName: 'Mega 2560 (fixture)',
    };
    class Port extends EventEmitter {
      isOpen = false;
      open(cb: any) {
        this.isOpen = true;
        cb(null);
      }
      close(cb: any) {
        this.isOpen = false;
        this.emit('close');
        cb(null);
      }
      set(_f: any, cb: any) {
        cb();
      }
      write(data: any, cb: any) {
        (globalThis as any).__writes.push(data.toString('hex'));
        cb();
      }
      drain(cb: any) {
        cb();
      }
    }
    (globalThis as any).__physicalUploads = 0;
    (globalThis as any).__writes = [];
    service.dependencies.serial.create = () => new Port();
    service.dependencies.discover = async () => [device];
    service.dependencies.prepare = async (project: any) => {
      if ((globalThis as any).__fixtureCompileFail)
        throw new Error('Compilation failed: fixture compiler error.');
      return {
        artifact: {
          id: 'fixture-exact-artifact',
          buildKey: key,
          target: 'Mega 2560',
          configuration: 'arduino:avr:mega:cpu=atmega2560',
          createdAt: Date.now(),
          files: project.files.map(({ path, content }: any) => ({ path, content })),
        },
        directory: '/private/tmp/not-a-real-build',
        dispose: async () => {},
        result: { success: true },
      };
    };
    service.dependencies.verify = async (input: any) => ({
      success: true,
      revision: input.project.revision,
      kind: 'build',
      output: 'Fixture compile complete',
      durationMs: 1,
      buildKey: key,
    });
    service.dependencies.upload = async () => {
      (globalThis as any).__physicalUploads++;
      return {
        code: 0,
        output: 'Fixture upload only',
        cancelled: false,
        timedOut: false,
        truncated: false,
      };
    };
  }, buildKey(exampleProject()));
}
test('native chrome, per-workspace layouts, quiet Debug and top-layer settings over floating panes', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('No API key connected.', { exact: true })).toBeVisible();
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()),
    ).toBe('Indicator / Mega 2560');
    await app.evaluate(() => {
      (globalThis as any).__modelCalls = 0;
      globalThis.fetch = async () => {
        (globalThis as any).__modelCalls++;
        throw Error('No API');
      };
    });
    await expect(page.locator('.titlebar,.statusbar,.canvas-caption')).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Ask Trace', exact: true }).fill('Unsent shared draft');
    await page.getByRole('button', { name: 'Debug', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Ask Trace', exact: true })).toHaveValue(
      'Unsent shared draft',
    );
    await expect(page.getByRole('log', { name: 'Physical serial output' })).toBeVisible();
    await expect(page.getByText('Device program identity unknown')).toBeVisible();
    await page.getByRole('button', { name: 'Prototype', exact: true }).click();
    await expect(page.locator('.monaco-editor')).toBeVisible();
    const region = page.getByRole('region', { name: 'Agent', exact: true });
    await region.getByRole('button', { name: 'Float pane', exact: true }).click();
    await menuAction(app, 'Settings…');
    const modal = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(modal).toBeVisible();
    expect(await page.evaluate(() => document.querySelector('dialog')?.matches(':modal'))).toBe(
      true,
    );
    await page.getByLabel('Provider model').focus();
    for (let i = 0; i < 18; i++) await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => document.querySelector('dialog')!.contains(document.activeElement)),
    ).toBe(true);
    const button = page.getByRole('button', { name: 'Verify', exact: true }),
      box = (await button.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(button).not.toBeFocused();
    if (await modal.isVisible()) await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
    await menuAction(app, 'Reset Workspace Layout');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 760));
    await page.getByRole('button', { name: 'Connect a provider', exact: true }).click();
    await page.screenshot({ path: 'artifacts/settings-floating-laptop.png' });
    await page.keyboard.press('Escape');
    expect(await app.evaluate(() => (globalThis as any).__modelCalls)).toBe(0);
    await page.screenshot({ path: 'artifacts/prototype-laptop.png' });
  } finally {
    await app.close();
  }
});
test('physical workflow fixture: warning, action approval, Debug transition and local telemetry with zero inference', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('No API key connected.', { exact: true })).toBeVisible();
    await hardwareFixture(app);
    await app.evaluate(() => {
      (globalThis as any).__modelCalls = 0;
      globalThis.fetch = async () => {
        (globalThis as any).__modelCalls++;
        throw Error('No API');
      };
    });
    await page.getByLabel('Board and serial port').click();
    await page.getByRole('button', { name: 'Refresh ports', exact: true }).click();
    await page.getByLabel('Serial port', { exact: true }).selectOption('/dev/cu.fixture');
    await page.getByLabel('Board and serial port').click();
    await page.getByRole('button', { name: 'Program Board', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Verification required' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await app.evaluate(() => (globalThis as any).__physicalUploads)).toBe(0);
    await page.getByRole('button', { name: 'Program Board', exact: true }).click();
    await page.getByRole('button', { name: 'Program Anyway', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Program Board', exact: true })).toBeVisible();
    expect(await app.evaluate(() => (globalThis as any).__physicalUploads)).toBe(0);
    await page.getByRole('button', { name: 'Program Anyway', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start monitoring', exact: true })).toBeVisible();
    expect(await app.evaluate(() => (globalThis as any).__physicalUploads)).toBe(1);
    await page.getByRole('button', { name: 'Start monitoring', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Start monitoring' })).toContainText(
      'may still reset',
    );
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop monitoring', exact: true })).toBeVisible();
    await app.evaluate(() => {
      const serial = (globalThis as any).__traceTestHardware.dependencies.serial;
      serial.ingest(Buffer.from('angle=12'));
      serial.ingest(Buffer.from('.5\nservo=90\n'));
    });
    await expect(page.getByRole('log')).toContainText('angle=12.5');
    await page.getByRole('button', { name: 'Map field', exact: true }).click();
    await page.getByLabel('Telemetry example').fill('angle=12.5');
    await page.getByLabel('Telemetry field', { exact: true }).fill('angle');
    await page.getByLabel('Telemetry label').fill('Encoder angle');
    await page.getByLabel('Telemetry units').fill('deg');
    await expect(page.getByText('Preview: 12.5 deg')).toBeVisible();
    await page.getByRole('button', { name: 'Save mapping', exact: true }).click();
    await expect(page.getByText('Not reported', { exact: true }).first()).toBeVisible();
    await app.evaluate(() => {
      (globalThis as any).__traceTestHardware.dependencies.serial.ingest(
        Buffer.from('angle=42\nangle=bad\n'),
      );
    });
    await expect(page.getByText('42 deg', { exact: true })).toBeVisible();
    await page.getByLabel('Serial command', { exact: true }).fill('STATUS');
    await page.getByRole('button', { name: 'Review serial command' }).click();
    await expect(page.getByRole('dialog', { name: 'Send serial command' })).toContainText(
      '"STATUS\\n"',
    );
    expect(await app.evaluate(() => (globalThis as any).__writes)).toEqual([]);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await app.evaluate(() => (globalThis as any).__writes)).toEqual([]);
    expect(await app.evaluate(() => (globalThis as any).__modelCalls)).toBe(0);
    await page.screenshot({ path: 'artifacts/debug-telemetry-fixture.png' });
  } finally {
    await app.close();
  }
});
test('generic properties, rotated routes and inspectable breadboard terminals persist', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('No API key connected.', { exact: true })).toBeVisible();
    const project = () => page.evaluate(() => JSON.parse(localStorage.getItem('trace.draft.v1')!));
    const original = await project();
    await page.locator('[data-id="resistor"] .part-art svg').click();
    await page.getByLabel('Resistance', { exact: true }).fill('4.7kΩ');
    await page.getByRole('button', { name: 'Rotate 90°', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await project()).components.find((c: any) => c.id === 'resistor').config.resistanceOhms,
      )
      .toBe(4700);
    await expect.poll(async () => (await project()).layouts.wiring.resistor.rotation).toBe(90);
    expect((await project()).wires).toEqual(original.wires);
    await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await page.getByRole('button', { name: 'Fit view', exact: true }).click();
    await expect(page.getByText('Route blocked · move part')).toHaveCount(0);
    await menuAction(app, 'Undo Project Change');
    await expect.poll(async () => (await project()).layouts.wiring.resistor.rotation).toBe(0);
    await page.locator('[data-id="led"] .part-art svg').click();
    await page.getByLabel('LED color', { exact: true }).selectOption('blue');
    await expect
      .poll(
        async () => (await project()).components.find((c: any) => c.id === 'led').config.ledColor,
      )
      .toBe('blue');
    expect(
      (await project()).components.find((c: any) => c.id === 'led').config.forwardVoltageV,
    ).toBeUndefined();
    await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await page.getByRole('button', { name: 'Parts', exact: true }).click();
    await page.getByLabel('Search parts', { exact: true }).fill('BB830');
    await page.getByRole('button', { name: /BB830 breadboard/ }).click();
    await expect.poll(async () => (await project()).components.length).toBe(4);
    await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await page.getByRole('button', { name: 'BB4 terminal A1', exact: true }).click();
    await expect(page.locator('.inspector')).toContainText('A1');
    await expect(page.locator('.inspector')).not.toContainText('Firmware binding');
    await page.screenshot({ path: 'artifacts/breadboard-pin-popover.png' });
    await app.evaluate(({ dialog, app }) => {
      const file = app.getPath('temp') + `/trace-parts-${process.pid}.trace.json`;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }) as any;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) as any;
    });
    await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await menuAction(app, 'Save');
    await expect(page.locator('.notice')).toContainText('Saved');
    await menuAction(app, 'New Project');
    await menuAction(app, 'Open…');
    await expect.poll(async () => (await project()).components.length).toBe(4);
    expect(
      (await project()).components.find((c: any) => c.id === 'resistor').config.resistanceOhms,
    ).toBe(4700);
    expect((await project()).components.find((c: any) => c.id === 'led').config.ledColor).toBe(
      'blue',
    );
  } finally {
    await app.close();
  }
});
test('agent hardware tool waits for approval and does not repeat a declined action', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('No API key connected.', { exact: true })).toBeVisible();
    await hardwareFixture(app);
    await menuAction(app, 'Settings…');
    await page.getByLabel('Provider API key', { exact: true }).fill('FIXTURE_APPROVAL_KEY');
    await page.getByRole('button', { name: 'Save connection', exact: true }).click();
    await expect(page.getByText('Key stored', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await app.evaluate(() => {
      let n = 0;
      (globalThis as any).__approvalRequests = [];
      globalThis.fetch = async (_url: any, options: any) => {
        (globalThis as any).__approvalRequests.push(JSON.parse(options.body));
        const parts =
          n++ < 2
            ? [
                {
                  functionCall: {
                    id: `connect-${n}`,
                    name: 'request_hardware',
                    args: {
                      operation: {
                        action: 'connect',
                        portKey: '/dev/cu.fixture',
                        baud: 115200,
                        delimiter: 'lf',
                      },
                      reason: 'Read firmware output from the selected fixture.',
                    },
                  },
                },
              ]
            : [{ text: 'The connection was declined. No physical operation was performed.' }];
        return new Response(
          `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 20 } })}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        );
      };
    });
    await page
      .getByRole('textbox', { name: 'Ask Trace', exact: true })
      .fill('Request the device connection.');
    await page.getByRole('button', { name: 'Send request', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Start monitoring', exact: true })).toBeVisible();
    expect(
      await app.evaluate(
        () => (globalThis as any).__traceTestHardware.dependencies.serial.state.state,
      ),
    ).toBe('disconnected');
    expect(await app.evaluate(() => (globalThis as any).__approvalRequests.length)).toBe(1);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(
      page.getByText('The connection was declined. No physical operation was performed.', {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await app.evaluate(() => (globalThis as any).__traceTestHardware.snapshot().requests.length),
    ).toBe(1);
    expect(
      await app.evaluate(
        () => (globalThis as any).__traceTestHardware.dependencies.serial.state.state,
      ),
    ).toBe('disconnected');
    expect(await app.evaluate(() => (globalThis as any).__approvalRequests.length)).toBe(3);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
test('Verify from program warning never uploads, and compilation failure cannot be overridden', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('No API key connected.', { exact: true })).toBeVisible();
    await hardwareFixture(app);
    await page.getByLabel('Board and serial port').click();
    await page.getByRole('button', { name: 'Refresh ports', exact: true }).click();
    await page.getByLabel('Serial port', { exact: true }).selectOption('/dev/cu.fixture');
    await page.getByLabel('Board and serial port').click();
    await page.getByRole('button', { name: 'Program Board', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Verification required' })
      .getByRole('button', { name: 'Verify', exact: true })
      .click();
    await expect(page.getByText('Arduino CLI compile', { exact: true })).toBeVisible();
    expect(await app.evaluate(() => (globalThis as any).__physicalUploads)).toBe(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Program Board', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Program Board', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await app.evaluate(() => ((globalThis as any).__fixtureCompileFail = true));
    await page.locator('.monaco-editor textarea').focus();
    await page.keyboard.press('Meta+End');
    await page.keyboard.insertText('\n// changed since verify');
    await page.getByRole('button', { name: 'Program Board', exact: true }).click();
    await page.getByRole('button', { name: 'Program Anyway', exact: true }).click();
    await expect(page.locator('.notice')).toContainText('Compilation failed');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await app.evaluate(() => (globalThis as any).__physicalUploads)).toBe(0);
  } finally {
    await app.close();
  }
});
