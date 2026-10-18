import { _electron as electron } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

// Actual Electron content capture and live Gemini only. Evaluation isolation keeps
// the user's project/profile read-only and blocks every physical operation.
const args = process.argv.slice(2);
const option = (key, fallback) => {
  const index = args.indexOf(`--${key}`);
  return index < 0 ? fallback : args[index + 1];
};
const take = option('take', 'take-1');
if (!/^[a-zA-Z0-9_-]{1,50}$/.test(take)) throw Error('Invalid take name');
const smoke = args.includes('--smoke');
const directory = resolve('artifacts/demos', take);
await mkdir(directory, { recursive: true });
await build({
  entryPoints: ['src/evaluation/cases.ts', 'src/evaluation/oracles.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outdir: 'artifacts/demo-modules',
});
const { evaluationCases, freshSeed } = await import('../artifacts/demo-modules/cases.js');
const { evaluateArtifacts } = await import('../artifacts/demo-modules/oracles.js');
const testCase = evaluationCases.find((c) => c.id === 'led');
const project = { ...freshSeed(testCase), name: 'Status light', id: `demo-${take}` };
const prompt = option(
  'prompt',
  'Build a blinking status light with an Arduino Mega 2560 and a red LED. Choose the parts and current-limiting resistor, wire it neatly, and write a nonblocking sketch that blinks once a second and prints its state. Check the design and compile it, then run the Mega firmware simulation. No physical hardware operations.',
);
const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, TRACE_EVALUATION: '1' },
});
let recording = false;
let page;
const started = Date.now();
const timeline = [];
let report = { outcome: 'incomplete', kind: smoke ? 'recording-smoke-no-model' : 'live-gemini' };
const mark = (event, detail = {}) => {
  const item = { seconds: (Date.now() - started) / 1000, event, ...detail };
  timeline.push(item);
  console.log(JSON.stringify(item));
};
try {
  page = await app.firstWindow();
  await page.waitForFunction(() => window.traceEvaluation);
  await page.waitForFunction(() => window.traceEvaluation.snapshot().connections.length > 0);
  const configured = await page.evaluate(() =>
    window.traceEvaluation
      .snapshot()
      .connections.some((c) => c.provider === 'gemini' && c.configured),
  );
  if (!configured && !smoke) throw Error('Configure Gemini locally in mudroom before recording.');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1600, 900);
  });
  await page.evaluate((seed) => {
    window.traceEvaluation.reset(seed);
    window.traceEvaluation.configure({
      agentLimits: {
        requests: 32,
        tools: 120,
        reportedTokens: 1000000,
        outputTokens: 8192,
        durationMs: 480000,
      },
    });
  }, project);
  await page.getByRole('textbox', { name: 'Ask mudroom', exact: true }).waitFor();
  await page.screencast.start({
    path: `${directory}/capture.webm`,
    size: { width: 1600, height: 900 },
    quality: 95,
    fps: 30,
  });
  recording = true;
  mark('capture-start', { configured });
  await page.waitForTimeout(1200);
  const composer = page.getByRole('textbox', { name: 'Ask mudroom', exact: true });
  await composer.click();
  await composer.pressSequentially(
    smoke ? 'Build a blinking status light with an Arduino Mega 2560.' : prompt,
    { delay: 28 },
  );
  if (smoke) {
    await page.waitForTimeout(1500);
    report.outcome = 'capture-smoke-passed';
  } else {
    await page.waitForTimeout(700);
    mark('request-submitted');
    await page.getByRole('button', { name: 'Send request', exact: true }).click();
    let previous = '';
    let expanded = false;
    const deadline = Date.now() + 510000;
    for (;;) {
      const state = await page.evaluate(() => {
        const s = window.traceEvaluation.snapshot();
        return {
          busy: s.busy,
          question: s.question?.question,
          components: s.project.components.length,
          wires: s.project.wires.length,
          requests: s.requests,
          tools: s.tools,
          tokens: s.tokens,
          status: s.messages.filter((m) => m.kind === 'status').at(-1)?.text,
          result: s.result ? { kind: s.result.kind, success: s.result.success } : null,
        };
      });
      const key = JSON.stringify(state);
      if (key !== previous) {
        mark('progress', state);
        previous = key;
      }
      if (!expanded && state.tools >= 1) {
        const activity = page.locator('.activity-group details').first();
        if (await activity.count()) {
          await activity.locator('summary').click();
          expanded = true;
        }
      }
      if (expanded && state.components >= 3) {
        const activity = page.locator('.activity-group details[open]').first();
        if (await activity.count()) await activity.locator('summary').click();
      }
      if (state.question) throw Error(`Agent needs a real answer: ${state.question}`);
      if (!state.busy && state.requests > 0) break;
      if (Date.now() > deadline) throw Error('Recording task reached its deadline.');
      await page.waitForTimeout(800);
    }
    const snapshot = await page.evaluate(() => window.traceEvaluation.snapshot());
    const answer = snapshot.messages
      .filter((m) => m.role === 'assistant')
      .map((m) => m.text)
      .join('\n');
    const oracle = evaluateArtifacts(testCase, snapshot.project, snapshot.result, answer);
    const providerFailure = snapshot.trace.find((e) => e.event === 'segment-end' && e.cause);
    report = {
      kind: 'live-gemini',
      outcome: providerFailure ? 'blocked' : oracle.outcome,
      model: snapshot.model,
      instructionVersion: snapshot.trace.find((e) => e.instructionVersion)?.instructionVersion,
      toolSchemaVersion: snapshot.trace.find((e) => e.toolSchemaVersion)?.toolSchemaVersion,
      requests: snapshot.requests,
      tools: snapshot.tools,
      reportedTokens: snapshot.tokens,
      cause: providerFailure?.cause,
      oracle,
      answer,
      execution: snapshot.result
        ? {
            kind: snapshot.result.kind,
            success: snapshot.result.success,
            output: snapshot.result.output.slice(-6000),
          }
        : null,
      trace: snapshot.trace,
    };
    await writeFile(`${directory}/project.trace.json`, JSON.stringify(snapshot.project, null, 2));
    mark('task-ended', {
      outcome: report.outcome,
      requests: report.requests,
      tools: report.tools,
      reportedTokens: report.reportedTokens,
    });
    if (report.outcome === 'pass') {
      await page.getByRole('button', { name: 'Fit view', exact: true }).click();
      await page.waitForTimeout(3000);
      const output = page.getByRole('button', { name: 'Issues and output', exact: true });
      if (!(await page.locator('.output-area').isVisible())) await output.click();
      await page.waitForTimeout(7000);
      await page.getByRole('button', { name: 'Collapse output' }).click();
      await page.getByRole('button', { name: 'Fit view', exact: true }).click();
      await page.waitForTimeout(5000);
    } else await page.waitForTimeout(2000);
  }
  await page.screenshot({ path: `${directory}/final.png` });
} catch (error) {
  report = { ...report, outcome: 'blocked', cause: String(error).slice(0, 700) };
  mark('recording-blocked', { cause: report.cause });
  if (page) await page.screenshot({ path: `${directory}/failure.png` }).catch(() => {});
} finally {
  if (recording) await page.screencast.stop();
  report.durationMs = Date.now() - started;
  report.timeline = timeline;
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
  await app.close();
}
if (recording) {
  await new Promise((done, reject) => {
    const child = spawn(
      '/opt/homebrew/bin/ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        `${directory}/capture.webm`,
        '-c:v',
        'libx264',
        '-crf',
        '18',
        '-preset',
        'medium',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        `${directory}/capture.mp4`,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let error = '';
    child.stderr.on('data', (data) => {
      error = (error + data).slice(-2000);
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? done() : reject(Error(error))));
  });
}
console.log(JSON.stringify({ outcome: report.outcome, cause: report.cause, directory }));
if (report.outcome === 'blocked' || report.outcome === 'fail') process.exitCode = 1;
