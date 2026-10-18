import { test, expect, _electron as electron } from '@playwright/test';
import { menuAction } from './helpers';
async function configured(app: any) {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Connect a provider', exact: true }).click();
  await page.getByLabel('Provider API key', { exact: true }).fill('FIXTURE_AUTONOMY_KEY');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(page.getByText('Key stored', { exact: true })).toBeVisible();
  await page.getByLabel('Change application policy', { exact: true }).selectOption('preview');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  return page;
}
test('malformed recovery → explicit question → reviewed batch → checks completes with no Resume step', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  try {
    const page = await configured(app);
    await app.evaluate(() => {
      (globalThis as any).__autonomyCalls = 0;
      globalThis.fetch = async () => {
        const round = (globalThis as any).__autonomyCalls++;
        const parts =
          round === 0
            ? []
            : round === 1
              ? [
                  {
                    functionCall: {
                      id: 'question',
                      name: 'ask_user',
                      args: {
                        question: 'Which label should I use?',
                        options: [{ label: 'Ready' }, { label: 'Idle' }],
                      },
                    },
                  },
                ]
              : round === 2
                ? [
                    {
                      functionCall: {
                        id: 'edit',
                        name: 'project_changes',
                        args: {
                          expectedRevision: 0,
                          summary: 'Set chosen label',
                          commands: [{ type: 'configureComponent', id: 'led', label: 'Ready' }],
                        },
                      },
                    },
                  ]
                : round === 3
                  ? [{ functionCall: { id: 'checks', name: 'run_checks', args: {} } }]
                  : [{ text: 'The chosen label is applied and local checks ran.' }];
        return new Response(
          `data: ${JSON.stringify({ candidates: [{ content: { parts }, finishReason: round === 0 ? 'MALFORMED_FUNCTION_CALL' : 'STOP' }], usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 10, totalTokenCount: 100 } })}\n\n`,
        );
      };
    });
    await page
      .getByRole('textbox', { name: 'Ask Trace', exact: true })
      .fill('Ask which label to use, then label the LED.');
    await page.getByRole('button', { name: 'Send request', exact: true }).click();
    const question = page.getByRole('form', { name: 'Agent question' });
    await expect(question).toBeVisible();
    await expect(question.getByRole('button', { name: 'Send answer', exact: true })).toBeDisabled();
    expect(await app.evaluate(() => (globalThis as any).__autonomyCalls)).toBe(2);
    await question.getByRole('radio', { name: 'Ready', exact: true }).check();
    await question.getByRole('button', { name: 'Send answer', exact: true }).click();
    await expect(page.getByText('Proposed change', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Continue task', exact: true }),
    ).not.toBeVisible();
    expect(await app.evaluate(() => (globalThis as any).__autonomyCalls)).toBe(3);
    await page.getByRole('button', { name: 'Apply and continue', exact: true }).click();
    await expect(
      page.getByText('The chosen label is applied and local checks ran.', { exact: true }),
    ).toBeVisible();
    expect(await app.evaluate(() => (globalThis as any).__autonomyCalls)).toBe(5);
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('trace.draft.v1')!).components.find(
            (c: any) => c.id === 'led',
          ).config.label,
      ),
    ).toBe('Ready');
    await expect(
      page.getByRole('button', { name: 'Continue task', exact: true }),
    ).not.toBeVisible();
    await menuAction(app, 'New Project');
    await expect(page.locator('.message')).toHaveCount(0);
    await expect(page.locator('.activity-group')).toHaveCount(0);
    const fresh = await page.evaluate(() => JSON.parse(localStorage.getItem('trace.draft.v1')!));
    expect(fresh.components).toEqual([]);
    expect(fresh.telemetry).toEqual([]);
    expect(fresh.wires).toEqual([]);
    expect(fresh.revision).toBe(0);
    await menuAction(app, 'Undo Project Change');
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('trace.draft.v1')!).components),
    ).toEqual([]);
  } finally {
    await app.close();
  }
});
test('New chat cancels a waiting question and old asynchronous status cannot reappear', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  try {
    const page = await configured(app);
    await app.evaluate(() => {
      globalThis.fetch = async () =>
        new Response(
          `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { id: 'wait', name: 'ask_user', args: { question: 'Which label should I use?', options: [{ label: 'One' }, { label: 'Two' }] } } }] }, finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 100 } })}\n\n`,
        );
    });
    await page
      .getByRole('textbox', { name: 'Ask Trace', exact: true })
      .fill('Ask me about the label.');
    await page.getByRole('button', { name: 'Send request', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Agent question' })).toBeVisible();
    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Agent question' })).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Cancel agent task', exact: true }),
    ).not.toBeVisible();
    await expect(page.locator('.message')).toHaveCount(0);
    await expect(page.locator('.activity-group')).toHaveCount(0);
    await page
      .getByRole('button', { name: 'AI connections and participation', exact: true })
      .click();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect(page.locator('.message')).toHaveCount(0);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('trace.session.v1')!).messages),
    ).toEqual([]);
  } finally {
    await app.close();
  }
});
test('intermittent 503 recovery resets after success while preserving one reviewed mutation', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, TRACE_TEST: '1' } });
  try {
    const page = await configured(app);
    await app.evaluate(() => {
      (globalThis as any).__intermittent = 0;
      globalThis.fetch = async () => {
        const n = (globalThis as any).__intermittent++;
        if ([0, 2, 4].includes(n)) return new Response('', { status: 503 });
        const parts =
          n === 1
            ? [
                {
                  functionCall: {
                    id: 'read',
                    name: 'inspect_project',
                    args: { section: 'summary' },
                  },
                },
              ]
            : n === 3
              ? [
                  {
                    functionCall: {
                      id: 'edit',
                      name: 'edit_circuit',
                      args: {
                        expectedRevision: 0,
                        summary: 'Label once',
                        configure: [{ id: 'led', config: { label: 'Recovered' } }],
                      },
                    },
                  },
                ]
              : [{ text: 'The label was applied once after transient server errors.' }];
        return new Response(
          `data: ${JSON.stringify({ candidates: [{ content: { parts }, finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 100 } })}\n\n`,
        );
      };
    });
    await page
      .getByRole('textbox', { name: 'Ask Trace', exact: true })
      .fill('Label the LED Recovered.');
    await page.getByRole('button', { name: 'Send request', exact: true }).click();
    await page.getByRole('button', { name: 'Apply and continue', exact: true }).click();
    await expect(
      page.getByText('The label was applied once after transient server errors.', { exact: true }),
    ).toBeVisible();
    expect(await app.evaluate(() => (globalThis as any).__intermittent)).toBe(6);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('trace.draft.v1')!).revision),
    ).toBe(1);
  } finally {
    await app.close();
  }
});
