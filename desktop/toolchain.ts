import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateProject } from '../src/domain/project';
import { partById } from '../src/parts/catalog';
import type { Project } from '../src/domain/schema';
import type { RunResult } from '../src/services/bridge';
import { targetConfiguration, buildKey, circuitKey } from '../src/domain/semantics';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import type { PreparedArtifact, DevicePort } from '../src/services/hardware';
import { prepareConfinement } from './confinement';

const OUTPUT_LIMIT = 64 * 1024;
const SIMULATION_MS = 3000;
let localToolRoot = resolve('artifacts/tools');
/** Main lifecycle chooses a fixed development or bundled tools directory; never renderer input. */
export function configureToolRoot(root: string) {
  localToolRoot = root;
}
const fqbnByPart: Record<string, string> = {
  'arduino-mega-r3': 'arduino:avr:mega:cpu=atmega2560',
  'esp32-s3-devkitc1-v11': 'esp32:esp32:esp32s3',
};
const safeEnvironment = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    ['HOME', 'USER', 'LOGNAME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL']
      .flatMap((key) => (process.env[key] ? [[key, process.env[key]!]] : []))
      .concat([['NO_COLOR', '1']]),
  );
async function executable(paths: string[]) {
  for (const path of paths) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      /* Try next fixed installation location. */
    }
  }
  return null;
}
const arduinoPath = () =>
  executable([
    '/opt/homebrew/bin/arduino-cli',
    '/usr/local/bin/arduino-cli',
    '/usr/bin/arduino-cli',
  ]);
const simulatorPath = () =>
  executable([
    join(localToolRoot, 'simavr'),
    '/opt/homebrew/bin/simavr',
    '/usr/local/bin/simavr',
    '/usr/bin/simavr',
  ]);

export async function toolchainCapabilities(): Promise<{ arduino: boolean; simavr: boolean }> {
  const [arduino, simavr] = await Promise.all([arduinoPath(), simulatorPath()]);
  return { arduino: Boolean(arduino), simavr: Boolean(simavr) };
}

interface ProcessOptions {
  cwd: string;
  signal: AbortSignal;
  timeoutMs: number;
  maxOutputBytes?: number;
  environment?: NodeJS.ProcessEnv;
}
export interface ProcessResult {
  code: number | null;
  output: string;
  cancelled: boolean;
  timedOut: boolean;
  truncated: boolean;
}
/** Main-process utility; never exposed as a renderer/model command. Kill the process group so compiler children stop too. */
export function runBoundedProcess(
  command: string,
  args: string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  if (options.signal.aborted)
    return Promise.resolve({
      code: null,
      output: 'Cancelled.',
      cancelled: true,
      timedOut: false,
      truncated: false,
    });
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.environment ?? safeEnvironment(),
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const limit = options.maxOutputBytes ?? OUTPUT_LIMIT;
    let output = Buffer.alloc(0),
      cancelled = false,
      timedOut = false,
      truncated = false,
      killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        /* Already exited. */
      }
    };
    const stop = () => {
      kill('SIGTERM');
      killTimer ??= setTimeout(() => kill('SIGKILL'), 500);
    };
    const cancel = () => {
      cancelled = true;
      stop();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs);
    const capture = (chunk: Buffer) => {
      const available = limit - output.length;
      if (available > 0) output = Buffer.concat([output, chunk.subarray(0, available)]);
      if (chunk.length > available) {
        truncated = true;
        stop();
      }
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    options.signal.addEventListener('abort', cancel, { once: true });
    // An abort may arrive between the preflight check and listener installation.
    if (options.signal.aborted) cancel();
    const cleanup = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      options.signal.removeEventListener('abort', cancel);
    };
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('close', (code) => {
      cleanup();
      resolveResult({
        code,
        output: output.toString('utf8').replace(/\u001b\[[0-9;]*m/g, ''),
        cancelled,
        timedOut,
        truncated,
      });
    });
  });
}

export async function runToolchain(
  input: { project: Project; requestId: string; simulate: boolean },
  signal: AbortSignal,
  retained?: { directory?: string; artifact?: PreparedArtifact },
): Promise<RunResult> {
  const started = Date.now(),
    kind = input.simulate ? 'simulation' : 'build';
  let semanticKeys: { buildKey?: string; circuitKey?: string } = {};
  let revision = 0,
    directory: string | undefined;
  const result = (success: boolean, output: string): RunResult => ({
    revision,
    success,
    cancelled: signal.aborted,
    kind,
    output,
    durationMs: Date.now() - started,
    ...semanticKeys,
  });
  try {
    const project = validateProject(input.project);
    revision = project.revision;
    semanticKeys = { buildKey: buildKey(project), circuitKey: circuitKey(project) };
    if (
      typeof input.requestId !== 'string' ||
      !/^[a-zA-Z0-9_.-]{1,120}$/.test(input.requestId) ||
      typeof input.simulate !== 'boolean'
    )
      return result(false, 'Invalid toolchain request.');
    if (signal.aborted) return result(false, 'Cancelled.');
    const board = project.components.find((c) => c.id === project.targetBoardId);
    if (!board) return result(false, 'Choose a target board in the circuit before building.');
    const part = partById(board.partId),
      fqbn = targetConfiguration(project, Boolean(retained)).fqbn;
    if (!fqbn) return result(false, 'No build adapter is available for this exact part.');
    if (input.simulate && part.id !== 'arduino-mega-r3')
      return result(
        false,
        'Firmware simulation is available for Mega 2560 only. ESP32-S3 supports compilation; no ESP32-S3 execution engine is installed.',
      );
    const cli = await arduinoPath();
    if (!cli)
      return result(
        false,
        'Arduino CLI is unavailable. Install arduino-cli and the arduino:avr / esp32:esp32 core to compile locally.',
      );
    const sim = input.simulate ? await simulatorPath() : null;
    if (input.simulate && !sim)
      return result(
        false,
        'simavr is unavailable. Run node scripts/setup-simavr.mjs to build the local Mega firmware simulator. Compilation remains available independently.',
      );
    const ino = project.files.filter((file) => file.path.endsWith('.ino'));
    if (!ino.length) return result(false, 'Add an .ino firmware file before compiling.');
    const main = ino.find((file) => file.path === 'sketch.ino') ?? ino[0];
    // Revalidate names here so path safety does not depend on upstream IPC validation.
    const names = project.files.map((file) => (file.id === main.id ? 'sketch.ino' : file.path));
    if (
      names.some((name) => !/^[_a-zA-Z0-9-]+\.(ino|cpp|c|h)$/.test(name)) ||
      new Set(names.map((name) => name.toLowerCase())).size !== names.length
    )
      return result(
        false,
        'Firmware filenames must be unique simple .ino/.cpp/.c/.h names (case insensitive).',
      );
    directory = await mkdtemp(join(tmpdir(), 'trace-build-'));
    const confined = await prepareConfinement(directory, localToolRoot);
    const environment = { ...safeEnvironment(), TMPDIR: confined.tmp };
    const sketch = join(directory, 'sketch'),
      build = join(directory, 'build');
    await mkdir(sketch);
    await Promise.all(
      project.files.map((file, index) =>
        writeFile(join(sketch, names[index]), file.content, { encoding: 'utf8', mode: 0o600 }),
      ),
    );
    const libraryRoot = join(localToolRoot, 'libraries');
    let libraryArguments: string[] = [];
    try {
      await access(join(libraryRoot, 'Servo/library.properties'));
      libraryArguments = ['--libraries', libraryRoot];
    } catch {}
    const compiled = await runBoundedProcess(
      confined.launcher,
      [
        ...confined.prefix,
        cli,
        '--config-file',
        confined.config,
        'compile',
        '--no-color',
        '--fqbn',
        fqbn,
        '--jobs',
        '2',
        '--build-path',
        build,
        '--warnings',
        'default',
        ...libraryArguments,
        sketch,
      ],
      { cwd: directory, signal, timeoutMs: 120000, environment },
    );
    const buildOutput = `${part.name} · ${fqbn}\n${libraryArguments.length ? 'Available bundled library: Servo 1.3.0 (unchanged official source)\n' : ''}${compiled.output}`;
    if (compiled.cancelled) return result(false, `${buildOutput}\nCancelled.`);
    if (compiled.truncated)
      return result(false, `${buildOutput}\nStopped: build output exceeded ${OUTPUT_LIMIT} bytes.`);
    if (compiled.timedOut) return result(false, `${buildOutput}\nBuild exceeded the 120 s limit.`);
    if (compiled.code !== 0)
      return result(
        false,
        `${buildOutput}\nCompilation failed. Ensure the selected Arduino core is installed.`,
      );
    const variant =
      part.id === 'esp32-s3-devkitc1-v11'
        ? `\nESP32-S3 configuration: ${project.boardSettings.esp32 ? `${project.boardSettings.esp32.flashMB} MB flash / ${project.boardSettings.esp32.psram} PSRAM; ${project.boardSettings.esp32.confirmed ? 'user-confirmed variant' : 'variant unconfirmed'}` : '4 MB flash / disabled PSRAM defaults; variant unconfirmed'}. Compilation is not a physical board test.`
        : '';
    if (!input.simulate) {
      if (retained) {
        const artifactId = await hashBuild(directory, buildKey(project));
        retained.directory = directory;
        retained.artifact = {
          id: artifactId,
          buildKey: buildKey(project),
          target: `${board.ref} (${board.id}) · ${part.name}`,
          configuration: fqbn,
          createdAt: Date.now(),
          files: project.files.map((f) => ({ path: f.path, content: f.content })),
        };
      }
      return result(true, `${buildOutput}\nBuild complete.${variant}`);
    }
    const hex = join(build, 'sketch.ino.hex');
    await access(hex);
    const trace = join(directory, 'gpio.vcd');
    // Trace each explicitly bound Mega port bit using the package mapping; no guessed pin numbers.
    const traceArgs = project.bindings
      .filter((b) => b.boardId === board.id)
      .slice(0, 16)
      .flatMap((binding) => {
        const pin = part.terminals.find((t) => t.id === binding.terminalId),
          match = pin?.gpio?.match(/^P([A-L])([0-7])$/);
        // simavr portpin uses address = bit index, mask = ASCII port letter.
        return match
          ? [
              '--add-trace',
              `${binding.symbol.slice(0, 48)}=portpin@0x${Number(match[2]).toString(16)}/0x${match[1].charCodeAt(0).toString(16)}`,
            ]
          : [];
      });
    const simulated = await runBoundedProcess(
      confined.launcher,
      [
        ...confined.prefix,
        sim!,
        '--mcu',
        'atmega2560',
        '--freq',
        '16000000',
        ...(traceArgs.length ? ['--output', trace, ...traceArgs] : []),
        hex,
      ],
      { cwd: directory, signal, timeoutMs: SIMULATION_MS, environment },
    );
    let waveform = '',
      transitionCount: number | null = null;
    if (traceArgs.length) {
      try {
        if ((await stat(trace)).size > 1024 * 1024) {
          waveform =
            '\nGPIO trace exceeded the 1 MiB inspection limit; transition summary omitted.';
        } else {
          const vcd = await readFile(trace, 'utf8');
          const transitions = vcd.split('\n').filter((line) => /^[01][!-~]+$/.test(line));
          transitionCount = transitions.length;
          waveform = `\nGPIO trace: ${transitions.length} sampled digital transitions across ${traceArgs.length / 2} bound signal(s).`;
        }
      } catch {
        waveform = '\nGPIO trace unavailable.';
      }
    }
    const scope =
      '\nCompiled ATmega2560 instructions · 16 MHz · 3 s wall-time sample. UART text is firmware output. GPIO tracing is digital MCU state; external wiring, sensors (AS5600/ITR9608), servos, LEDs, resistors, potentiometers, supply and analog behavior are not simulated. Upstream support above 128 KB flash is preliminary.';
    const executionOutput = `${buildOutput}\n\nMCU execution / simavr\n${simulated.output}${waveform}${scope}`;
    if (simulated.cancelled) return result(false, `${executionOutput}\nCancelled.`);
    if (simulated.truncated)
      return result(
        false,
        `${executionOutput}\nStopped: simulation output exceeded ${OUTPUT_LIMIT} bytes.`,
      );
    if (simulated.code !== 0)
      return result(false, `${executionOutput}\nSimulation exited abnormally.`);
    if (/crash|invalid opcode|unsupported opcode/i.test(simulated.output))
      return result(false, `${executionOutput}\nThe simulator reported an execution failure.`);
    const uart = simulated.output
      .split('\n')
      .filter(
        (line) =>
          line.trim() &&
          !/^(Loaded |Adding portpin trace |signal caught|avr_gdb_init|AVR_MMCU_TAG)/.test(line),
      )
      .slice(0, 20)
      .join('\n');
    return {
      ...result(
        true,
        `${executionOutput}\n${simulated.timedOut ? 'Sample complete; simulator stopped at the time limit.' : 'Firmware execution ended.'}`,
      ),
      observations: {
        uart,
        digitalTransitions: transitionCount,
        scope:
          'Digital MCU execution only · 3 s wall-time sample. External circuitry and analog behavior are not simulated.',
      },
    };
  } catch (error) {
    return result(
      false,
      signal.aborted
        ? 'Cancelled.'
        : `Local execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  } finally {
    if (directory && !retained?.directory) await rm(directory, { recursive: true, force: true });
  }
}

/** Private main-process immutable artifact; no arbitrary path is accepted from IPC. */
export interface RetainedBuild {
  artifact: PreparedArtifact;
  directory: string;
  result: RunResult;
  dispose(): Promise<void>;
}
export async function prepareFirmwareArtifact(
  project: Project,
  signal: AbortSignal,
): Promise<RetainedBuild> {
  const retained: { directory?: string; artifact?: PreparedArtifact } = {};
  const result = await runToolchain(
    { project, requestId: 'prepare-upload', simulate: false },
    signal,
    retained,
  );
  if (!result.success || !retained.directory || !retained.artifact) throw new Error(result.output);
  const directory = retained.directory;
  return {
    artifact: retained.artifact,
    directory,
    result,
    dispose: () => rm(directory, { recursive: true, force: true }),
  };
}
async function hashBuild(directory: string, key: string) {
  const hash = createHash('sha256').update(key);
  const root = join(directory, 'build');
  async function visit(path: string, prefix: string) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error('Artifact contains a symbolic link.');
      if (entry.isDirectory()) await visit(join(path, entry.name), relative + '/');
      else if (entry.isFile()) {
        const content = await readFile(join(path, entry.name));
        hash.update(JSON.stringify([relative, content.length])).update(content);
      }
    }
  }
  await visit(root, '');
  return hash.digest('hex');
}
export async function uploadFirmware(
  build: RetainedBuild,
  device: DevicePort,
  signal: AbortSignal,
) {
  if ((await hashBuild(build.directory, build.artifact.buildKey)) !== build.artifact.id)
    throw new Error('Prepared artifact changed; programming approval is invalid.');
  const cli = await arduinoPath();
  if (!cli) throw new Error('Arduino CLI is unavailable.');
  const confinement = await prepareConfinement(build.directory, localToolRoot, device.path);
  return runBoundedProcess(
    confinement.launcher,
    [
      ...confinement.prefix,
      cli,
      '--config-file',
      confinement.config,
      'upload',
      '--fqbn',
      build.artifact.configuration,
      '--port',
      device.path,
      '--input-dir',
      join(build.directory, 'build'),
      join(build.directory, 'sketch'),
    ],
    {
      cwd: build.directory,
      signal,
      timeoutMs: 120000,
      environment: { ...safeEnvironment(), TMPDIR: confinement.tmp },
    },
  );
}
