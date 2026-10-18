import { _electron as electron } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const args = process.argv.slice(2),
  option = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i < 0 ? fallback : args[i + 1];
  };
await mkdir('artifacts/evaluations', { recursive: true });
await build({
  entryPoints: ['src/evaluation/oracles.ts', 'src/evaluation/cases.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outdir: 'artifacts/evaluation-modules',
});
const { evaluationCases, freshSeed } = await import('../artifacts/evaluation-modules/cases.js');
const { evaluateArtifacts } = await import('../artifacts/evaluation-modules/oracles.js');
const selected = option('cases', 'led,servo-encoder').split(','),
  repeat = Number(option('repeat', '1'));
if (!Number.isInteger(repeat) || repeat < 1 || repeat > 3)
  throw Error('Repeat must be 1–3. Select bounded batches.');
const seedPath = option('seed', '');
if (seedPath && selected.length !== 1) throw Error('--seed requires exactly one selected case');
const suppliedSeed = seedPath ? JSON.parse(await readFile(seedPath, 'utf8')) : null;
const cases = selected.map((id) => {
  const c = evaluationCases.find((c) => c.id === id);
  if (!c) throw Error(`Unknown case ${id}`);
  return c;
});
const limits = {
  requests: Number(option('requests', '24')),
  tools: Number(option('tools', '100')),
  reportedTokens: Number(option('tokens', '1000000')),
  outputTokens: 8192,
  durationMs: Number(option('seconds', '600')) * 1000,
};
const batch = option('batch', new Date().toISOString().replaceAll(':', '-'));
if (!/^[A-Za-z0-9_.-]{1,100}$/.test(batch)) throw Error('Invalid batch identifier');
const gapSeconds = Number(option('gap-seconds', '0'));
if (!Number.isFinite(gapSeconds) || gapSeconds < 0 || gapSeconds > 60)
  throw Error('Gap must be 0–60 seconds');
const reports = [];
const indexHtml = await readFile('dist/index.html', 'utf8');
const renderer = indexHtml.match(/src="\.\/(assets\/index-[^"]+\.js)"/)?.[1];
const runtimeHash = createHash('sha256')
  .update(await readFile('dist-desktop/main.cjs'))
  .update(renderer ? await readFile(`dist/${renderer}`) : indexHtml)
  .digest('hex')
  .slice(0, 16);
let halted = false;
for (const testCase of cases)
  for (let attempt = 1; attempt <= repeat; attempt++) {
    if (halted) break;
    if (reports.length && gapSeconds)
      await new Promise((resolve) => setTimeout(resolve, gapSeconds * 1000));
    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env, TRACE_EVALUATION: '1' },
    });
    const started = Date.now();
    let report;
    try {
      const page = await app.firstWindow();
      await page.waitForFunction(() => window.traceEvaluation);
      await page.waitForFunction(() =>
        window.traceEvaluation
          .snapshot()
          .connections.some((c) => c.provider === 'gemini' && c.configured),
      );
      await page.evaluate(
        ({ seed, limits, model }) => {
          window.traceEvaluation.reset(seed);
          window.traceEvaluation.configure({ agentLimits: limits, ...(model ? { model } : {}) });
        },
        { seed: suppliedSeed ?? freshSeed(testCase), limits, model: option('model', '') },
      );
      if (['diagnostic-explain', 'diagnostic-fix'].includes(testCase.category)) {
        await page.getByRole('button', { name: 'Issues and output', exact: true }).click();
        const issue = page
          .locator('.diagnostic')
          .filter({ hasText: 'no series resistor identified' })
          .first();
        await issue.getByRole('button', { name: 'Ask Agent', exact: true }).click();
        await issue
          .getByRole('menuitem', {
            name: testCase.category === 'diagnostic-explain' ? 'Explain' : 'Fix',
            exact: true,
          })
          .click();
      } else await page.evaluate((goal) => window.traceEvaluation.start(goal), testCase.goal);
      await page.waitForFunction(
        () =>
          window.traceEvaluation.snapshot().busy ||
          window.traceEvaluation.snapshot().messages.length > 0,
      );
      await page.waitForFunction(
        () =>
          !window.traceEvaluation.snapshot().busy || !!window.traceEvaluation.snapshot().question,
        {},
        { timeout: limits.durationMs + 30000 },
      );
      const snapshot = await page.evaluate(() => window.traceEvaluation.snapshot());
      const text =
        snapshot.messages
          .filter((m) => m.role === 'assistant')
          .map((m) => m.text)
          .join('\n') +
        (snapshot.question
          ? '\n' +
            snapshot.question.question +
            '\n' +
            snapshot.question.options.map((o) => o.label).join('\n')
          : '');
      const oracle = evaluateArtifacts(testCase, snapshot.project, snapshot.result, text);
      const stop = snapshot.messages.filter((m) => m.kind === 'status').at(-1)?.text;
      const providerError = snapshot.trace.find((e) => e.event === 'segment-end' && e.cause);
      report = {
        case: testCase.id,
        runtimeHash,
        seedSource: suppliedSeed ? 'provided-snapshot' : 'case-seed',
        attempt,
        kind: 'live-gemini',
        model: snapshot.model,
        instructionVersion: snapshot.trace.find((e) => e.instructionVersion)?.instructionVersion,
        toolSchemaVersion: snapshot.trace.find((e) => e.toolSchemaVersion)?.toolSchemaVersion,
        limits,
        durationMs: Date.now() - started,
        requests: snapshot.requests,
        tools: snapshot.tools,
        reportedTokens: snapshot.tokens,
        oracle,
        outcome: providerError ? 'blocked' : oracle.outcome,
        cause: providerError?.cause ?? stop,
        trace: snapshot.trace,
        answer: text.slice(-4000),
        question: snapshot.question,
        compile: snapshot.result
          ? {
              success: snapshot.result.success,
              kind: snapshot.result.kind,
              buildKey: snapshot.result.buildKey,
              output: snapshot.result.output.slice(-2000),
            }
          : null,
      };
      await writeFile(
        `artifacts/evaluations/${batch}-${testCase.id}-${attempt}.trace.json`,
        JSON.stringify(snapshot.project, null, 2),
      );
      await page.screenshot({
        path: `artifacts/evaluations/${batch}-${testCase.id}-${attempt}.png`,
      });
    } catch (e) {
      report = {
        case: testCase.id,
        attempt,
        kind: 'live-gemini',
        outcome: 'blocked',
        durationMs: Date.now() - started,
        cause: String(e).slice(0, 500),
      };
    } finally {
      await app.close();
    }
    reports.push(report);
    if (/HTTP 429|HTTP 404|Key rejected|cannot be decrypted/.test(report.cause ?? '')) {
      halted = true;
      console.log(
        'Batch stopped on provider configuration/quota failure; no further paid cases will start.',
      );
    }
    await writeFile(`artifacts/evaluations/${batch}.json`, JSON.stringify(reports, null, 2));
    console.log(
      JSON.stringify({
        case: report.case,
        attempt,
        outcome: report.outcome,
        requests: report.requests,
        tools: report.tools,
        reportedTokens: report.reportedTokens,
        cause: report.cause,
      }),
    );
  }
console.log(`Report: artifacts/evaluations/${batch}.json`);
