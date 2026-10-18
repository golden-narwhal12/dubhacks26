import { randomUUID } from 'node:crypto';
import { SerialPort } from 'serialport';
import {
  HardwareRequestInputSchema,
  ObserveSchema,
  type DevicePort,
  type HardwareRequest,
  type HardwareSnapshot,
  type HardwareRequestInput,
  type ObserveCondition,
} from '../src/services/hardware';
import { buildKey, circuitKey, targetConfiguration } from '../src/domain/semantics';
import { validateProject } from '../src/domain/project';
import { validateCircuit } from '../src/domain/validation';
import type { Project } from '../src/domain/schema';
import {
  runToolchain,
  prepareFirmwareArtifact,
  uploadFirmware,
  type RetainedBuild,
} from './toolchain';
import { SerialService } from './serial';
export interface HardwareDependencies {
  discover: () => Promise<DevicePort[]>;
  prepare: typeof prepareFirmwareArtifact;
  upload: typeof uploadFirmware;
  verify: typeof runToolchain;
  serial: SerialService;
  now: () => number;
}
async function discoverPorts(): Promise<DevicePort[]> {
  return (await SerialPort.list())
    .filter((p) => /^\/dev\/(cu|tty)\.[A-Za-z0-9_.-]{1,180}$/.test(p.path))
    .map((p) => {
      const identity = [p.vendorId ?? '', p.productId ?? '', p.serialNumber ?? '', p.path].join(
        ':',
      );
      return {
        key: p.path,
        path: p.path,
        label: p.manufacturer ? `${p.manufacturer} · ${p.path}` : p.path,
        serialNumber: p.serialNumber,
        vendorId: p.vendorId,
        productId: p.productId,
        identity,
        weakIdentity: !p.serialNumber,
        ...((p.vendorId?.toUpperCase() === '2341' &&
          ['0010', '0042', '0210', '0242'].includes(p.productId?.toUpperCase() ?? '')) ||
        (p.vendorId?.toUpperCase() === '2A03' &&
          ['0010', '0042'].includes(p.productId?.toUpperCase() ?? ''))
          ? { boardName: 'Mega 2560 (USB ID)' }
          : {}),
      };
    });
}
export class HardwareService {
  private project: Project | null = null;
  private state: HardwareSnapshot = {
    ports: [],
    requests: [],
    serial: {
      state: 'disconnected',
      lines: [],
      channels: [],
      droppedLines: 0,
      parseErrors: 0,
      lastSequence: 0,
    },
    verification: null,
    uploaded: null,
    busy: false,
  };
  private dependencies: HardwareDependencies;
  private usedIds = new Set<string>();
  private requestCircuits = new Map<string, string>();
  private builds = new Map<string, RetainedBuild>();
  private controllers = new Map<string, AbortController>();
  private observations = new Map<string, AbortController>();
  private emission: ReturnType<typeof setTimeout> | null = null;
  private expiry: ReturnType<typeof setInterval>;
  constructor(
    private emit: (snapshot: HardwareSnapshot) => void = () => {},
    dependencies: Partial<HardwareDependencies> = {},
  ) {
    this.dependencies = {
      discover: discoverPorts,
      prepare: prepareFirmwareArtifact,
      upload: uploadFirmware,
      verify: runToolchain,
      serial: new SerialService(),
      now: Date.now,
      ...dependencies,
    };
    this.dependencies.serial.on('update', () => this.notify(true));
    this.dependencies.serial.on('disconnect', () => {
      const device = this.dependencies.serial.state.port;
      if (device?.weakIdentity && this.state.uploaded?.device.identity === device.identity)
        this.state.uploaded = null;
      if (device)
        for (const r of this.state.requests)
          if (r.status === 'pending' && r.device?.identity === device.identity)
            this.invalidate(
              r,
              'Device disconnected; select it again and request a fresh approval.',
            );
      this.notify();
    });
    this.expiry = setInterval(() => {
      for (const r of this.state.requests)
        if (r.status === 'pending' && r.expiresAt <= this.dependencies.now())
          this.invalidate(r, 'Approval expired.', 'expired');
    }, 1000);
    this.expiry.unref();
  }
  snapshot(): HardwareSnapshot {
    this.state.serial = this.dependencies.serial.snapshot();
    return structuredClone(this.state);
  }
  private notify(throttle = false) {
    if (throttle) {
      this.emission ??= setTimeout(() => {
        this.emission = null;
        this.emit(this.snapshot());
      }, 100);
      return;
    }
    this.emit(this.snapshot());
  }
  private invalidate(
    r: HardwareRequest,
    error: string,
    status: 'cancelled' | 'expired' = 'cancelled',
  ) {
    if (r.status !== 'pending') return;
    r.status = status;
    r.error = error;
    const build = this.builds.get(r.id);
    this.builds.delete(r.id);
    this.requestCircuits.delete(r.id);
    void build?.dispose();
    this.notify();
  }
  syncProject(input: Project) {
    const project = validateProject(input);
    this.project = structuredClone(project);
    this.dependencies.serial.configure(project.telemetry);
    for (const r of this.state.requests)
      if (
        r.status === 'pending' &&
        r.artifact &&
        (r.artifact.buildKey !== buildKey(project) ||
          this.requestCircuits.get(r.id) !== circuitKey(project))
      )
        this.invalidate(r, 'Project changed; prepare a new programming approval.');
    return this.snapshot();
  }
  async discover() {
    const ports = await this.dependencies.discover();
    this.state.ports = ports;
    if (
      this.state.uploaded &&
      !ports.some((p) => p.identity === this.state.uploaded!.device.identity)
    )
      this.state.uploaded = null;
    for (const r of this.state.requests)
      if (
        r.status === 'pending' &&
        r.device &&
        !ports.some((p) => p.key === r.device!.key && p.identity === r.device!.identity)
      )
        this.invalidate(r, 'Selected device is no longer available.');
    this.notify();
    return this.snapshot();
  }
  async verify(input: Project, requestId: string, signal = new AbortController().signal) {
    if (this.state.busy) throw new Error('Another hardware/build operation is running.');
    if (!/^[A-Za-z0-9_.-]{1,120}$/.test(requestId)) throw new Error('Invalid request identifier.');
    const p = validateProject(input);
    this.syncProject(p);
    const key = buildKey(p),
      circuit = circuitKey(p);
    const controller = new AbortController();
    this.controllers.set(requestId, controller);
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    this.state.busy = true;
    this.notify();
    try {
      const result = await this.dependencies.verify(
        { project: p, requestId, simulate: false },
        controller.signal,
      );
      if (this.project && buildKey(this.project) === key && circuitKey(this.project) === circuit)
        this.state.verification = {
          buildKey: key,
          circuitKey: circuit,
          checkedAt: this.dependencies.now(),
          result,
          issues: validateCircuit(p).map((d) => ({
            id: d.id,
            title: d.title,
            severity: d.severity,
            objectIds: d.objectIds,
          })),
        };
    } finally {
      signal.removeEventListener('abort', abort);
      this.controllers.delete(requestId);
      this.state.busy = false;
      this.notify();
    }
    return this.snapshot();
  }
  async request(raw: HardwareRequestInput): Promise<HardwareRequest> {
    const input = HardwareRequestInputSchema.parse(raw);
    const id = input.requestId ?? randomUUID(),
      controller = new AbortController();
    if (this.usedIds.has(id) || this.controllers.has(id)) throw new Error('Duplicate request ID.');
    this.usedIds.add(id);
    if (!this.project) throw new Error('Open a project first.');
    if (this.state.busy) throw new Error('Wait for the current hardware/build operation.');
    if (this.state.requests.filter((r) => r.status === 'pending').length >= 4)
      throw new Error('Resolve pending hardware approvals first.');
    const op = input.operation;
    this.controllers.set(id, controller);
    if (op.action === 'upload') this.state.busy = true;
    try {
      let device: DevicePort | undefined;
      if ('portKey' in op) {
        await this.discover();
        device = this.state.ports.find((p) => p.key === op.portKey);
        if (!device) throw new Error('Select an available physical serial port.');
      }
      if (op.action === 'disconnect') {
        device = this.dependencies.serial.state.port;
        if (!device || this.dependencies.serial.state.state !== 'connected')
          throw new Error('Monitoring is not connected.');
      }
      if (
        (op.action === 'transmit' || op.action === 'reset') &&
        (this.dependencies.serial.state.state !== 'connected' ||
          this.dependencies.serial.state.port?.identity !== device?.identity)
      )
        throw new Error('Start monitoring on this exact device first.');
      if (op.action === 'transmit') {
        if (op.encoding === 'hex' && !/^(?:[0-9a-fA-F]{2}\s*)+$/.test(op.payload))
          throw new Error('Hex payload must contain complete byte pairs.');
      }
      if (controller.signal.aborted) throw new Error('Preparation cancelled.');
      const p = structuredClone(this.project);
      const r: HardwareRequest = {
        id,
        ...input,
        status: 'pending',
        createdAt: this.dependencies.now(),
        expiresAt: this.dependencies.now() + 120000,
        device,
        ...(op.action === 'transmit' || op.action === 'reset' || op.action === 'disconnect'
          ? {
              serialConfig: {
                baud: this.dependencies.serial.state.baud!,
                delimiter: this.dependencies.serial.state.delimiter ?? 'lf',
              },
            }
          : {}),
      };
      if (op.action === 'upload') {
        targetConfiguration(p, true);
        this.state.busy = true;
        this.controllers.set(id, controller);
        this.notify();
        try {
          const build = await this.dependencies.prepare(p, controller.signal);
          if (
            controller.signal.aborted ||
            !this.project ||
            buildKey(this.project) !== buildKey(p) ||
            circuitKey(this.project) !== circuitKey(p)
          ) {
            await build.dispose();
            throw new Error(
              'Project changed or preparation cancelled. Request a fresh programming approval.',
            );
          }
          r.artifact = build.artifact;
          r.verification = this.state.verification ?? undefined;
          this.builds.set(id, build);
          this.requestCircuits.set(id, circuitKey(p));
          if (
            !r.verification ||
            r.verification.buildKey !== buildKey(p) ||
            r.verification.circuitKey !== circuitKey(p)
          )
            r.warning =
              "This version hasn't been verified. Run Verify to check the circuit and compile the firmware before programming.";
          else if (!r.verification.result.success)
            r.warning =
              'The matching verification did not pass. Review its build output; this prepared artifact compiled successfully.';
          else if (
            r.verification.issues.some((i) => i.severity === 'error' || i.severity === 'warning')
          )
            r.warning = 'Current checks contain issues. Review them before programming.';
          r.expiresAt = this.dependencies.now() + 120000;
        } finally {
          this.controllers.delete(id);
          this.state.busy = false;
          this.notify();
        }
      }
      if (op.action === 'connect')
        r.warning =
          'Opening the port can restart some boards. DTR and RTS are deasserted after opening; drivers may pulse them during open.';
      if (op.action === 'reset')
        r.warning = 'Pulse DTR for 100 ms. This may restart the board; effects cannot be undone.';
      this.state.requests.push(r);
      this.state.requests = this.state.requests.filter(
        (item, index, all) =>
          item.status === 'pending' || item.status === 'running' || index >= all.length - 30,
      );
      this.notify();
      return structuredClone(r);
    } finally {
      this.controllers.delete(id);
      if (op.action === 'upload') this.state.busy = false;
      this.notify();
    }
  }
  async approve(id: string, overrideVerification = false): Promise<HardwareRequest> {
    if (typeof id !== 'string' || typeof overrideVerification !== 'boolean')
      throw new Error('Invalid approval.');
    const r = this.state.requests.find((r) => r.id === id);
    if (!r || r.status !== 'pending')
      throw new Error('Request is not pending; approvals are one-use.');
    if (this.state.busy) throw new Error('Another operation is running.');
    if (r.expiresAt <= this.dependencies.now()) {
      this.invalidate(r, 'Approval expired.', 'expired');
      throw new Error('Approval expired.');
    }
    await this.discover();
    if (this.state.busy) throw new Error('Another hardware/build operation is running.');
    if (r.status !== 'pending') throw new Error(r.error);
    if (r.expiresAt <= this.dependencies.now()) {
      this.invalidate(r, 'Approval expired.', 'expired');
      throw new Error('Approval expired.');
    }
    const op = r.operation,
      p = this.project;
    if (!p) throw new Error('No project.');
    if (op.action === 'upload') {
      const prepared = this.builds.get(id);
      if (
        !prepared ||
        prepared.artifact.buildKey !== buildKey(p) ||
        r.artifact?.id !== prepared.artifact.id
      ) {
        this.invalidate(r, 'Artifact/source changed.');
        throw new Error('Prepare a new artifact.');
      }
      if (this.requestCircuits.get(id) !== circuitKey(p)) {
        this.invalidate(r, 'Circuit changed.');
        throw new Error('Prepare a new approval.');
      }
      if (r.warning && !overrideVerification)
        throw new Error('Review verification and explicitly choose Program Anyway, or run Verify.');
    }
    if (
      (op.action === 'transmit' || op.action === 'reset' || op.action === 'disconnect') &&
      (this.dependencies.serial.state.state !== 'connected' ||
        this.dependencies.serial.state.port?.identity !== r.device?.identity)
    )
      throw new Error('Start monitoring on this exact selected device first.');
    if (
      r.serialConfig &&
      (r.serialConfig.baud !== this.dependencies.serial.state.baud ||
        r.serialConfig.delimiter !== this.dependencies.serial.state.delimiter)
    ) {
      this.invalidate(r, 'Serial configuration changed; request a new approval.');
      throw new Error('Serial configuration changed.');
    }
    // Claim the request before awaiting any physical operation: replay cannot race execution.
    r.status = 'running';
    r.startedAt = this.dependencies.now();
    this.state.busy = true;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.notify();
    try {
      switch (op.action) {
        case 'connect':
          await this.dependencies.serial.connect(
            r.device!,
            op.baud,
            op.delimiter,
            controller.signal,
          );
          break;
        case 'disconnect':
          await this.dependencies.serial.disconnect(controller.signal);
          break;
        case 'transmit':
          await this.dependencies.serial.transmit(
            Buffer.from(
              op.encoding === 'hex' ? op.payload.replace(/\s/g, '') : op.payload,
              op.encoding === 'hex' ? 'hex' : 'utf8',
            ),
            controller.signal,
          );
          break;
        case 'reset':
          await this.dependencies.serial.reset(controller.signal);
          break;
        case 'upload': {
          const monitor = this.dependencies.serial.snapshot();
          if (monitor.state === 'connected')
            await this.dependencies.serial.disconnect(controller.signal);
          const build = this.builds.get(id)!;
          this.state.uploaded = null;
          const result = await this.dependencies.upload(build, r.device!, controller.signal);
          r.output = result.output;
          if (result.code !== 0 || result.cancelled || result.timedOut || result.truncated)
            throw new Error(
              result.cancelled
                ? 'Upload interrupted; device state is unknown.'
                : result.timedOut
                  ? 'Upload timed out.'
                  : `Upload failed. ${result.output.slice(-3000)}`,
            );
          this.state.uploaded = {
            artifact: build.artifact,
            device: r.device!,
            uploadedAt: this.dependencies.now(),
          };
          if (op.resumeMonitor && monitor.port?.identity === r.device!.identity && monitor.baud) {
            try {
              await this.discover();
              if (this.state.ports.some((port) => port.identity === r.device!.identity))
                await this.dependencies.serial.connect(
                  r.device!,
                  monitor.baud,
                  monitor.delimiter ?? 'lf',
                  controller.signal,
                );
              else r.warning = 'Programmed successfully; selected monitor device is unavailable.';
            } catch (error) {
              r.warning = `Programmed successfully; monitoring did not resume: ${error instanceof Error ? error.message : 'Connection failed'}`;
            }
          }
          break;
        }
      }
      if (controller.signal.aborted)
        throw new Error('Hardware operation cancelled; effects may already have occurred.');
      r.status = 'completed';
    } catch (e) {
      r.status = controller.signal.aborted ? 'cancelled' : 'failed';
      r.error = e instanceof Error ? e.message : 'Hardware operation failed.';
    } finally {
      r.finishedAt = this.dependencies.now();
      this.controllers.delete(id);
      if (r.artifact) r.artifact = { ...r.artifact, buildKey: '', files: [] };
      r.verification = undefined;
      this.state.busy = false;
      const build = this.builds.get(id);
      this.builds.delete(id);
      this.requestCircuits.delete(id);
      await build?.dispose();
      this.notify();
    }
    return structuredClone(r);
  }
  async cancel(id: string) {
    this.observations.get(id)?.abort();
    const r = this.state.requests.find((r) => r.id === id);
    this.controllers.get(id)?.abort();
    if (!r) {
      if (this.controllers.has(id) || this.observations.has(id)) return;
      throw new Error('Unknown hardware request.');
    }
    if (r.status === 'pending') this.invalidate(r, 'Cancelled by user.');
    this.notify();
    return structuredClone(r);
  }
  async observe(input: ObserveCondition, requestId: string) {
    const condition = ObserveSchema.parse(input);
    if (condition.operator !== 'change' && condition.value === undefined)
      throw new Error('Condition requires a value.');
    if (!/^[A-Za-z0-9_.-]{1,120}$/.test(requestId) || this.observations.has(requestId))
      throw new Error('Invalid or duplicate observation ID.');
    const controller = new AbortController();
    this.observations.set(requestId, controller);
    try {
      return await this.dependencies.serial.observe(condition, controller.signal);
    } finally {
      this.observations.delete(requestId);
    }
  }
  async dispose() {
    clearInterval(this.expiry);
    if (this.emission) clearTimeout(this.emission);
    for (const c of this.controllers.values()) c.abort();
    for (const c of this.observations.values()) c.abort();
    await this.dependencies.serial.disconnect();
    await Promise.all([...this.builds.values()].map((b) => b.dispose()));
    this.builds.clear();
  }
}
