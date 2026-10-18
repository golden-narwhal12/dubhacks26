import { test, expect, _electron as electron } from '@playwright/test';
import { freshSeed, getEvaluationCase } from '../../src/evaluation/cases';
import { evaluateArtifacts } from '../../src/evaluation/oracles';
import { exampleProject } from '../../src/domain/example';
import type { Command } from '../../src/domain/project';
import { servoEncoderProject } from '../../src/domain/servoExample';
import { readFileSync } from 'node:fs';
for (const id of ['led', 'continue-circuit', 'repair-led', 'explain-led', 'servo-encoder'])
  test(`evaluation fixture uses real runtime, mutations and compiler: ${id}`, async () => {
    test.setTimeout(90000);
    const app = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        TRACE_TEST: '1',
        TRACE_EVALUATION: '1',
        TRACE_EVALUATION_FIXTURE: '1',
      },
    });
    try {
      const page = await app.firstWindow();
      await page.waitForFunction(() => (window as any).traceEvaluation);
      await page.getByRole('button', { name: 'Connect a provider', exact: true }).click();
      await page.getByLabel('Provider API key', { exact: true }).fill('FIXTURE_EVAL_KEY');
      await page.getByRole('button', { name: 'Save connection', exact: true }).click();
      await expect(page.getByText('Key stored', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Close settings', exact: true }).click();
      const seed = freshSeed(id),
        desired =
          id === 'servo-encoder'
            ? servoEncoderProject(readFileSync('examples/servo-encoder/sketch.ino', 'utf8'))
            : exampleProject(),
        commands: Command[] = [];
      if (id === 'led' || id === 'servo-encoder') {
        for (const component of desired.components)
          commands.push({
            type: 'addComponent',
            component,
            // Reproduce live model placements that overlap the large Mega illustration.
            placement:
              id === 'led' ? { x: 50, y: 50, rotation: 0 } : desired.layouts.wiring[component.id],
          });
        for (const wire of desired.wires) commands.push({ type: 'connect', wire });
        for (const binding of desired.bindings) commands.push({ type: 'setBinding', binding });
        commands.push(
          { type: 'writeFile', file: desired.files[0] },
          { type: 'setTarget', id: id === 'servo-encoder' ? 'mega' : 'board' },
        );
        if (id === 'servo-encoder')
          for (const mapping of desired.telemetry) commands.push({ type: 'setTelemetry', mapping });
      } else if (id === 'repair-led') {
        commands.push(
          { type: 'disconnect', id: 'direct-drive' },
          {
            type: 'addComponent',
            component: desired.components.find((c) => c.id === 'resistor')!,
            placement: desired.layouts.wiring.resistor,
          },
        );
        for (const wire of desired.wires.filter((w) => w.id !== 'return'))
          commands.push({ type: 'connect', wire });
        commands.push({ type: 'setBinding', binding: desired.bindings[0] });
      } else if (id === 'continue-circuit') {
        commands.push({
          type: 'addComponent',
          component: {
            id: 'pot',
            partId: 'potentiometer-generic',
            partVersion: 1,
            ref: 'RV1',
            config: { potentiometerOhms: 10000 },
          },
          placement: { x: 950, y: 500, rotation: 0 },
        });
        for (const [pin, hole] of [
          ['5v', 'p1'],
          ['gnd1', 'p2'],
          ['a0', 'wiper'],
        ])
          commands.push({
            type: 'connect',
            wire: {
              id: `pot-${hole}`,
              from: { componentId: 'board', terminalId: pin },
              to: { componentId: 'pot', terminalId: hole },
              color: 'mint',
            },
          });
        commands.push(
          {
            type: 'writeFile',
            file: {
              ...seed.files[0],
              content:
                seed.files[0].content.split('void loop()')[0] +
                `unsigned long lastBlink=0,lastReport=0;
bool ledState=false;
void loop(){
 const unsigned long now=millis();
 if(now-lastBlink>=INTERVAL_MS){lastBlink=now;ledState=!ledState;digitalWrite(LED_PIN,ledState);}
 if(now-lastReport>=100){lastReport=now;Serial.print("pot_raw=");Serial.println(analogRead(A0));}
}
`,
            },
          },
          {
            type: 'setTelemetry',
            mapping: {
              id: 'pot-raw',
              label: 'Potentiometer',
              parser: 'keyvalue',
              field: 'pot_raw',
              componentId: 'pot',
              terminalId: 'wiper',
              units: 'ADC counts',
              meaning: 'raw',
              staleAfterMs: 1000,
            },
          },
        );
      }
      await page.evaluate((seed) => (window as any).traceEvaluation.reset(seed), seed);
      await app.evaluate(
        (_electron, { commands, explain, servo }) => {
          let round = 0;
          globalThis.fetch = async (_u: any, options: any) => {
            const body = JSON.parse(options.body),
              initial = JSON.parse(body.contents[0].parts[0].text);
            const parts =
              round++ === 0
                ? [
                    {
                      functionCall: {
                        id: 'inspect',
                        name: 'inspect_project',
                        args: { section: 'summary' },
                      },
                    },
                  ]
                : round === 2
                  ? explain
                    ? [
                        {
                          text: 'The GPIO-driven bare LED needs current limiting. The actual anode path bypasses a resistor; the supported nominal assumptions cannot establish a guaranteed current.',
                        },
                      ]
                    : [
                        {
                          functionCall: {
                            id: 'edit',
                            name: servo ? 'edit_circuit' : 'project_changes',
                            args: servo
                              ? {
                                  expectedRevision: initial.project.revision,
                                  summary: 'Fixture coordinated servo and encoder design',
                                  add: commands
                                    .filter((c) => c.type === 'addComponent')
                                    .map((c: any) => ({
                                      component: c.component,
                                      placement: c.placement,
                                    })),
                                  connect: commands
                                    .filter((c) => c.type === 'connect')
                                    .map((c: any) => c.wire),
                                  files: commands
                                    .filter((c) => c.type === 'writeFile')
                                    .map((c: any) => c.file),
                                  bindings: commands
                                    .filter((c) => c.type === 'setBinding')
                                    .map((c: any) => c.binding),
                                  telemetry: commands
                                    .filter((c) => c.type === 'setTelemetry')
                                    .map((c: any) => c.mapping),
                                  targetBoardId: 'mega',
                                }
                              : {
                                  expectedRevision: initial.project.revision,
                                  summary: 'Fixture supported project implementation',
                                  commands,
                                },
                          },
                        },
                      ]
                  : round === 3
                    ? [
                        { functionCall: { id: 'checks', name: 'run_checks', args: {} } },
                        {
                          functionCall: {
                            id: 'compile',
                            name: 'run_build',
                            args: { simulate: false },
                          },
                        },
                      ]
                    : [
                        {
                          text: servo
                            ? 'The documented external power supply and 3.3 V I2C level shifter are included. Visible source compiles. Couple and align the magnet to the shaft, then calibrate zero and direction; no physical device was accessed.'
                            : 'The visible project changes compile. No physical device was accessed.',
                        },
                      ];
            return new Response(
              `data: ${JSON.stringify({ candidates: [{ content: { parts }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 } })}\n\n`,
            );
          };
        },
        { commands, explain: id === 'explain-led', servo: id === 'servo-encoder' },
      );
      await page.evaluate(
        (goal) => (window as any).traceEvaluation.start(goal),
        getEvaluationCase(id).goal,
      );
      await page.waitForFunction(
        () =>
          (window as any).traceEvaluation.snapshot().busy ||
          (window as any).traceEvaluation.snapshot().messages.length > 0,
      );
      await page.waitForFunction(
        () => !(window as any).traceEvaluation.snapshot().busy,
        {},
        { timeout: 80000 },
      );
      const snapshot = await page.evaluate(() => (window as any).traceEvaluation.snapshot());
      const report = evaluateArtifacts(
        getEvaluationCase(id),
        snapshot.project,
        snapshot.result,
        snapshot.messages
          .filter((m: any) => m.role === 'assistant')
          .map((m: any) => m.text)
          .join('\n'),
      );
      expect(report.reasons).toEqual([]);
      expect(report.outcome).toBe('pass');
      expect(snapshot.trace.some((e: any) => e.event === 'provider-request')).toBe(true);
      expect(snapshot.trace.some((e: any) => e.name === 'request_hardware')).toBe(false);
      if (id === 'led') {
        await expect(page.getByText('Route blocked · move part')).toHaveCount(0);
        await page.getByRole('button', { name: 'Fit view', exact: true }).click();
        await expect(async () => {
          const canvas = await page.locator('.canvas-area').boundingBox();
          for (const node of await page.locator('.react-flow__node').all()) {
            const box = await node.boundingBox();
            expect(box!.x).toBeGreaterThanOrEqual(canvas!.x);
            expect(box!.y).toBeGreaterThanOrEqual(canvas!.y);
            expect(box!.x + box!.width).toBeLessThanOrEqual(canvas!.x + canvas!.width);
            expect(box!.y + box!.height).toBeLessThanOrEqual(canvas!.y + canvas!.height);
          }
        }).toPass();
        await page.screenshot({ path: 'artifacts/agent-spaced-indicator.png' });
      }
    } finally {
      await app.close();
    }
  });
test('completion review returns unresolved physical facts without accepting a false verification claim', async () => {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, TRACE_TEST: '1', TRACE_EVALUATION: '1', TRACE_EVALUATION_FIXTURE: '1' },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => (window as any).traceEvaluation);
    await page.getByRole('button', { name: 'Connect a provider', exact: true }).click();
    await page.getByLabel('Provider API key', { exact: true }).fill('FIXTURE_REVIEW_KEY');
    await page.getByRole('button', { name: 'Save connection', exact: true }).click();
    await expect(page.getByText('Key stored', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    const seed = exampleProject();
    seed.components.push({
      id: 'servo',
      partId: 'sg90-generic',
      partVersion: 1,
      ref: 'M1',
      config: {},
    });
    for (const v of ['wiring', 'schematic'] as const)
      seed.layouts[v].servo = { x: 950, y: 500, rotation: 0 };
    seed.wires.push({
      id: 'servo-power',
      from: { componentId: 'board', terminalId: '5v' },
      to: { componentId: 'servo', terminalId: 'power' },
      color: 'red',
    });
    await page.evaluate((seed) => (window as any).traceEvaluation.reset(seed), seed);
    await app.evaluate((_electron, content) => {
      let n = 0;
      (globalThis as any).__reviewBodies = [];
      globalThis.fetch = async (_u: any, options: any) => {
        const body = JSON.parse(options.body);
        (globalThis as any).__reviewBodies.push(body);
        const revision = JSON.parse(body.contents[0].parts[0].text).project.revision;
        const parts =
          n++ === 0
            ? [
                {
                  functionCall: {
                    id: 'local-code',
                    name: 'project_changes',
                    args: {
                      expectedRevision: revision,
                      summary: 'Prepare visible serial reporting',
                      commands: [
                        {
                          type: 'writeFile',
                          file: {
                            id: 'main',
                            path: 'sketch.ino',
                            content:
                              content + '\nvoid report(){Serial.println("command_deg=90");}\n',
                          },
                        },
                      ],
                    },
                  },
                },
              ]
            : n === 2
              ? [{ text: 'The whole circuit is now physically verified.' }]
              : [
                  {
                    functionCall: {
                      id: 'physical-question',
                      name: 'ask_user',
                      args: {
                        question:
                          'Which external servo power supply will be available? Compilation cannot establish load capacity.',
                        options: [
                          { label: 'Propose an external source' },
                          { label: 'I will specify the supply' },
                        ],
                      },
                    },
                  },
                ];
        return new Response(
          `data: ${JSON.stringify({ candidates: [{ content: { parts }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 } })}\n\n`,
        );
      };
    }, seed.files[0].content);
    await page.evaluate(() =>
      (window as any).traceEvaluation.start('Prepare the servo circuit and reporting.'),
    );
    await expect(page.getByRole('form', { name: 'Agent question' })).toBeVisible();
    await expect(
      page.getByText('The whole circuit is now physically verified.', { exact: true }),
    ).not.toBeVisible();
    expect(JSON.stringify(await app.evaluate(() => (globalThis as any).__reviewBodies))).toContain(
      'implementation-review',
    );
    expect((await page.evaluate(() => (window as any).traceEvaluation.snapshot())).requests).toBe(
      3,
    );
  } finally {
    await app.close();
  }
});
