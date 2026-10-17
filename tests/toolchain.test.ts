import { describe, expect, it } from 'vitest';
import { runBoundedProcess, runToolchain } from '../desktop/toolchain';
import { exampleProject } from '../src/domain/example';
import { prepareConfinement } from '../desktop/confinement';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('bounded local toolchain', () => {
  it('does not launch a cancelled task', async () => {
    const controller = new AbortController();
    controller.abort();
    const process = await runBoundedProcess('/this-command-must-not-launch', [], {
      cwd: processCwd(),
      signal: controller.signal,
      timeoutMs: 500,
    });
    expect(process.cancelled).toBe(true);
    expect(process.code).toBeNull();
    const result = await runToolchain(
      { project: exampleProject(), requestId: 'cancelled', simulate: false },
      controller.signal,
    );
    expect(result.success).toBe(false);
    expect(result.output).toBe('Cancelled.');
  });
  it('cancels a running subprocess instead of waiting for its deadline', async () => {
    const controller = new AbortController();
    const result = runBoundedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      cwd: processCwd(),
      signal: controller.signal,
      timeoutMs: 5000,
    });
    setTimeout(() => controller.abort(), 100);
    expect((await result).cancelled).toBe(true);
  });
  it('enforces wall-time and output limits', async () => {
    const signal = new AbortController().signal;
    const timed = await runBoundedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      cwd: processCwd(),
      signal,
      timeoutMs: 100,
    });
    expect(timed.timedOut).toBe(true);
    const noisy = await runBoundedProcess(
      process.execPath,
      ['-e', 'process.stdout.write("x".repeat(100000));setInterval(()=>{},1000)'],
      { cwd: processCwd(), signal, timeoutMs: 1000, maxOutputBytes: 1024 },
    );
    expect(noisy.truncated).toBe(true);
    expect(Buffer.byteLength(noisy.output)).toBe(1024);
  });
  it('passes argument metacharacters literally without a shell', async () => {
    const text = '$(touch forbidden) ; & `echo secret`';
    const result = await runBoundedProcess(
      process.execPath,
      ['-e', 'console.log(process.argv[1])', text],
      { cwd: processCwd(), signal: new AbortController().signal, timeoutMs: 1000 },
    );
    expect(result.output.trim()).toBe(text);
    expect(result.code).toBe(0);
  });
  it('rejects unsafe project paths before starting a compiler', async () => {
    const project = exampleProject();
    project.files[0].path = '../escape.ino';
    const result = await runToolchain(
      { project, requestId: 'unsafe', simulate: false },
      new AbortController().signal,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain('Local execution failed');
  });
  it('reports ESP32 simulation unsupported rather than dropping the board', async () => {
    const project = exampleProject();
    project.components[0].partId = 'esp32-s3-devkitc1-v11';
    project.bindings = [];
    project.wires = [];
    const result = await runToolchain(
      { project, requestId: 'unsupported', simulate: true },
      new AbortController().signal,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain('no ESP32-S3 execution engine');
  });
});
const processCwd = () => process.cwd();

describe.skipIf(process.env.TRACE_LIVE_TOOLCHAIN !== '1')(
  'installed compiler and simulator integration',
  () => {
    it('confines imported includes, assembler file reads and network sockets', async () => {
      const excluded = await mkdtemp(join(tmpdir(), 'trace-excluded-')),
        scratch = await mkdtemp(join(tmpdir(), 'trace-confined-'));
      try {
        const file = join(excluded, 'sentinel.h');
        await writeFile(file, '#error PRIVATE_SENTINEL_MUST_NOT_BE_READ\n');
        for (const content of [
          `#include ${JSON.stringify(file)}\nvoid setup(){}\nvoid loop(){}\n`,
          `asm(${JSON.stringify(`.incbin ${JSON.stringify(file)}`)});\nvoid setup(){}\nvoid loop(){}\n`,
        ]) {
          const p = exampleProject();
          p.files[0].content = content;
          const result = await runToolchain(
            { project: p, requestId: 'confined-include', simulate: false },
            new AbortController().signal,
          );
          expect(result.success).toBe(false);
          expect(result.output).not.toContain('PRIVATE_SENTINEL_MUST_NOT_BE_READ');
          expect(result.output).toMatch(
            /Operation not permitted|Permission denied|file not found|No such file/,
          );
        }
        const confined = await prepareConfinement(scratch, join(scratch, 'tools'));
        const network = await runBoundedProcess(
          confined.launcher,
          [
            ...confined.prefix,
            '/usr/bin/python3',
            '-c',
            'import socket; socket.create_connection(("127.0.0.1",9))',
          ],
          { cwd: scratch, signal: new AbortController().signal, timeoutMs: 10000 },
        );
        expect(network.code).not.toBe(0);
        expect(network.output).toMatch(/Operation not permitted|PermissionError/);
      } finally {
        await rm(excluded, { recursive: true, force: true });
        await rm(scratch, { recursive: true, force: true });
      }
    }, 130000);
    it('compiles the Mega example and observes executed UART and GPIO output', async () => {
      const result = await runToolchain(
        { project: exampleProject(), requestId: 'live-mega', simulate: true },
        new AbortController().signal,
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain('Trace: indicator ready');
      expect(result.output).toContain('indicator ON');
      expect(result.output).toMatch(/GPIO trace: [1-9]\d* sampled digital transitions/);
    }, 130000);
    it('compiles firmware for the requested ESP32-S3 target without a physical operation', async () => {
      const project = exampleProject();
      project.components[0].partId = 'esp32-s3-devkitc1-v11';
      project.bindings = [];
      project.wires = [];
      const result = await runToolchain(
        { project, requestId: 'live-esp', simulate: false },
        new AbortController().signal,
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain('esp32:esp32:esp32s3');
    }, 130000);
  },
);
