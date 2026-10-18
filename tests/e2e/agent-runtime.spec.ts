import { test, expect, _electron as electron } from '@playwright/test';
import { menuAction } from './helpers';
import { readFileSync } from 'node:fs';
import { servoEncoderProject } from '../../src/domain/servoExample';
async function setup(page: any, app: any, threshold = 1_000_000) {
  await page.evaluate(
    ({ threshold }: { threshold: number }) => {
      localStorage.setItem(
        'trace.agent-limits.v2',
        JSON.stringify({ version: 2, limits: { reportedTokens: threshold } }),
      );
    },
    { threshold },
  );
  await app.evaluate(({ BrowserWindow }: any) =>
    BrowserWindow.getAllWindows()[0].webContents.reload(),
  );
  await expect(page.getByText('No API key connected.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Connect a provider', exact: true }).click();
  await page.getByLabel('Provider API key', { exact: true }).fill('FIXTURE_RUNTIME_KEY');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(page.getByText('Key stored', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
}
test('targeted encoder repair rejects disconnecting data lines before review or mutation', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  try {
    const page = await app.firstWindow();
    const project = servoEncoderProject(readFileSync('examples/servo-encoder/sketch.ino', 'utf8'));
    project.wires = project.wires.filter((w) => !['data-high', 'clock-high'].includes(w.id));
    project.wires.find((w) => w.id === 'data-low')!.from = {
      componentId: 'mega',
      terminalId: 'd20',
    };
    project.wires.find((w) => w.id === 'clock-low')!.from = {
      componentId: 'mega',
      terminalId: 'd21',
    };
    await page.evaluate((p) => localStorage.setItem('trace.draft.v1', JSON.stringify(p)), project);
    await setup(page, app);
    const before = await page.evaluate(() => localStorage.getItem('trace.draft.v1'));
    await app.evaluate((_electron, revision) => {
      let n = 0;
      (globalThis as any).__repairResponses = [];
      globalThis.fetch = async (_url: any, options: any) => {
        (globalThis as any).__repairResponses.push(JSON.parse(options.body).contents);
        const functionCall =
          n++ === 0
            ? {
                id: 'unsafe-repair',
                name: 'edit_circuit',
                args: {
                  expectedRevision: revision,
                  summary: 'Remove incompatible bus',
                  disconnectWireIds: ['data-low', 'clock-low'],
                },
              }
            : {
                id: 'needed-equipment',
                name: 'ask_user',
                args: {
                  question: 'Is an appropriate converter available?',
                  options: [{ label: 'Yes' }, { label: 'Not yet' }],
                },
              };
        return new Response(
          `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ functionCall }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } })}\n\n`,
        );
      };
    }, project.revision);
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('trace:diagnostic-request', {
          detail: { id: 'encoder-bus-encoder', action: 'fix' },
        }),
      ),
    );
    await expect(page.getByRole('form', { name: 'Agent question' })).toBeVisible();
    expect(
      JSON.stringify(await app.evaluate(() => (globalThis as any).__repairResponses)),
    ).toContain('Removing required wires is not a repair');
    expect(await page.evaluate(() => localStorage.getItem('trace.draft.v1'))).toBe(before);
    await expect(page.getByText('Proposed change', { exact: true })).not.toBeVisible();
    await page
      .getByRole('form', { name: 'Agent question' })
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
  } finally {
    await app.close();
  }
});
test('threshold pauses unexecuted duplicate-stream mutation, Settings persist and resume executes it once', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  try {
    const page = await app.firstWindow();
    await setup(page, app, 100);
    await app.evaluate(() => {
      let n = 0;
      (globalThis as any).__runtimeRequests = 0;
      globalThis.fetch = async () => {
        (globalThis as any).__runtimeRequests++;
        const part =
          n++ === 0
            ? {
                functionCall: {
                  id: 'one-edit',
                  name: 'project_changes',
                  args: {
                    expectedRevision: 0,
                    summary: 'A single fixture edit',
                    commands: [{ type: 'configureComponent', id: 'led', label: 'Exactly once' }],
                  },
                },
              }
            : { text: 'The reviewed local edit is complete.' };
        const chunk = {
          responseId: `response-${n}`,
          candidates: [{ content: { parts: [part] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 10, totalTokenCount: 100 },
        };
        return new Response(
          `data: ${JSON.stringify(chunk)}\n\n${n === 1 ? `data: ${JSON.stringify(chunk)}\n\n` : ''}`,
        );
      };
    });
    await page.getByRole('textbox', { name: 'Ask mudroom', exact: true }).fill('Label the LED.');
    await page.getByRole('button', { name: 'Send request', exact: true }).click();
    await expect(page.getByText(/1 tool was not executed/)).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('trace.draft.v1')!).components.find(
            (c: any) => c.id === 'led',
          ).config.label,
      ),
    ).toBe('Status indicator');
    expect(await app.evaluate(() => (globalThis as any).__runtimeRequests)).toBe(1);
    await menuAction(app, 'Settings…');
    await page.getByText('Task limits and supported triggers', { exact: true }).click();
    await page.getByLabel('Reported token threshold', { exact: true }).fill('1000000');
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('trace.agent-limits.v2')!).limits.reportedTokens,
      ),
    ).toBe(1000000);
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.getByRole('button', { name: 'Continue task', exact: true }).click();
    await expect(
      page.getByText('The reviewed local edit is complete.', { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('trace.draft.v1')!).revision),
    ).toBe(1);
    expect(await app.evaluate(() => (globalThis as any).__runtimeRequests)).toBe(2);
    await menuAction(app, 'Undo Project Change');
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('trace.draft.v1')!).components.find(
            (c: any) => c.id === 'led',
          ).config.label,
      ),
    ).toBe('Status indicator');
  } finally {
    await app.close();
  }
});
test('Explain diagnostic is enforced read-only even when the model requests a mutation', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  try {
    const page = await app.firstWindow();
    await setup(page, app);
    const before = await page.evaluate(() => localStorage.getItem('trace.draft.v1'));
    await app.evaluate(() => {
      let n = 0;
      (globalThis as any).__explainResults = [];
      globalThis.fetch = async (_u: any, options: any) => {
        const body = JSON.parse(options.body);
        (globalThis as any).__explainResults.push(body);
        const parts =
          n++ === 0
            ? [
                {
                  functionCall: {
                    id: 'forbidden-edit',
                    name: 'project_changes',
                    args: {
                      expectedRevision: 0,
                      summary: 'Not authorized',
                      commands: [{ type: 'configureComponent', id: 'led', label: 'Forbidden' }],
                    },
                  },
                },
              ]
            : [
                {
                  text: 'The generic LED assumptions do not establish an exact manufacturer current rating.',
                },
              ];
        return new Response(
          `data: ${JSON.stringify({ candidates: [{ content: { parts }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } })}\n\n`,
        );
      };
    });
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('trace:diagnostic-request', {
          detail: { id: 'mapping-led', action: 'explain' },
        }),
      ),
    );
    await expect(
      page.getByText(
        'The generic LED assumptions do not establish an exact manufacturer current rating.',
        { exact: true },
      ),
    ).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('trace.draft.v1'))).toBe(before);
    expect(
      JSON.stringify(await app.evaluate(() => (globalThis as any).__explainResults)),
    ).toContain('Explain is read-only');
  } finally {
    await app.close();
  }
});
test('Resume retains exhausted cumulative budget until the user raises it', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  try {
    const page = await app.firstWindow();
    await setup(page, app, 100);
    await app.evaluate(() => {
      (globalThis as any).__resumeRequests = 0;
      globalThis.fetch = async () => {
        (globalThis as any).__resumeRequests++;
        return new Response(
          `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { id: 'pending-read', name: 'inspect_project', args: { section: 'summary' } } }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 0, totalTokenCount: 100 } })}\n\n`,
        );
      };
    });
    await page
      .getByRole('textbox', { name: 'Ask mudroom', exact: true })
      .fill('Inspect the project.');
    await page.getByRole('button', { name: 'Send request', exact: true }).click();
    await expect(page.getByText(/1 tool was not executed/)).toBeVisible();
    await page.getByRole('button', { name: 'Continue task', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Cancel agent task', exact: true }),
    ).not.toBeVisible();
    expect(await app.evaluate(() => (globalThis as any).__resumeRequests)).toBe(1);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('trace.draft.v1')!).revision),
    ).toBe(0);
  } finally {
    await app.close();
  }
});
test('changing projects cancels the active task and never applies its pending mutation to the new project', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  try {
    const page = await app.firstWindow();
    await setup(page, app);
    await app.evaluate(() => {
      (globalThis as any).__staleRequests = 0;
      globalThis.fetch = async (_u: any, options: any) => {
        (globalThis as any).__staleRequests++;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 1000);
          options.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(Error('cancelled'));
            },
            { once: true },
          );
        });
        return new Response(
          `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { id: 'old-mutation', name: 'project_changes', args: { expectedRevision: 1, summary: 'Wrong project mutation', commands: [{ type: 'renameProject', name: 'Must not apply' }] } } }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } })}\n\n`,
        );
      };
    });
    await page
      .getByRole('textbox', { name: 'Ask mudroom', exact: true })
      .fill('Fix the current circuit.');
    await page.getByRole('button', { name: 'Send request', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Cancel agent task', exact: true }),
    ).toBeVisible();
    await menuAction(app, 'New Project');
    await expect(
      page.getByRole('button', { name: 'Cancel agent task', exact: true }),
    ).not.toBeVisible();
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('trace.draft.v1')!).name),
    ).toBe('Untitled project');
    expect(await app.evaluate(() => (globalThis as any).__staleRequests)).toBe(1);
    await expect(
      page.getByRole('button', { name: 'Continue task', exact: true }),
    ).not.toBeVisible();
  } finally {
    await app.close();
  }
});
