import { describe, it, expect, vi } from 'vitest';
import { HardwareService } from '../desktop/hardware';
import { SerialService, type SerialTransport } from '../desktop/serial';
import { EventEmitter } from 'node:events';
import { exampleProject } from '../src/domain/example';
import { buildKey } from '../src/domain/semantics';
import type { DevicePort } from '../src/services/hardware';
const device: DevicePort = {
  key: '/dev/cu.fixture',
  path: '/dev/cu.fixture',
  label: 'Fixture',
  identity: 'usb:123:fixture',
  weakIdentity: false,
};
class Port extends EventEmitter implements SerialTransport {
  isOpen = false;
  writes: Buffer[] = [];
  flags: { dtr: boolean; rts: boolean }[] = [];
  open(cb: (e: Error | null) => void) {
    this.isOpen = true;
    cb(null);
  }
  close(cb: (e: Error | null) => void) {
    this.isOpen = false;
    this.emit('close');
    cb(null);
  }
  write(data: Buffer, cb: (e?: Error | null) => void) {
    this.writes.push(data);
    cb();
  }
  drain(cb: (e?: Error | null) => void) {
    cb();
  }
  set(f: { dtr: boolean; rts: boolean }, cb: (e?: Error | null) => void) {
    this.flags.push(f);
    cb();
  }
}
function fixture() {
  const p = exampleProject(),
    port = new Port(),
    serial = new SerialService(() => port),
    upload = vi.fn(async () => ({
      code: 0,
      output: 'Upload fixture',
      cancelled: false,
      timedOut: false,
      truncated: false,
    })),
    dispose = vi.fn(async () => {});
  let now = 100;
  const backend = new HardwareService(() => {}, {
    serial,
    discover: async () => [device],
    now: () => now,
    upload,
    prepare: async (project) => ({
      artifact: {
        id: 'sha256-fixture',
        buildKey: buildKey(project),
        target: 'arduino-mega-r3',
        configuration: 'arduino:avr:mega:cpu=atmega2560',
        createdAt: now,
        files: project.files.map((f) => ({ path: f.path, content: f.content })),
      },
      directory: '/private/tmp/fixture',
      result: {
        success: true,
        revision: project.revision,
        kind: 'build',
        output: 'compiled fixture',
        durationMs: 1,
      },
      dispose,
    }),
  });
  backend.syncProject(p);
  return { backend, p, port, serial, upload, dispose, advance: () => (now += 121000) };
}
describe('trusted physical approval service (fixtures only)', () => {
  it('prepares without executing, requires verification override and consumes once', async () => {
    const f = fixture();
    try {
      const r = await f.backend.request({
        origin: 'agent',
        reason: 'Install reviewed code',
        operation: { action: 'upload', portKey: device.key, resumeMonitor: false },
      });
      expect(f.upload).not.toHaveBeenCalled();
      expect(r.artifact?.files).toEqual(f.p.files.map(({ path, content }) => ({ path, content })));
      await expect(f.backend.approve(r.id)).rejects.toThrow('Verify');
      expect((await f.backend.approve(r.id, true)).status).toBe('completed');
      expect(f.upload).toHaveBeenCalledTimes(1);
      await expect(f.backend.approve(r.id, true)).rejects.toThrow('one-use');
    } finally {
      await f.backend.dispose();
    }
  });
  it('preserves approvals for layout edits, invalidates firmware and expired approvals', async () => {
    const f = fixture();
    try {
      const r = await f.backend.request({
        origin: 'agent',
        reason: 'test',
        operation: { action: 'upload', portKey: device.key, resumeMonitor: false },
      });
      const id = f.p.components[0].id;
      f.p.layouts.wiring[id].x += 20;
      f.p.revision++;
      f.backend.syncProject(f.p);
      expect(f.backend.snapshot().requests[0].status).toBe('pending');
      f.p.files[0].content += '\n// changed';
      f.backend.syncProject(f.p);
      await expect(f.backend.approve(r.id, true)).rejects.toThrow();
      expect(f.upload).not.toHaveBeenCalled();
      const next = await f.backend.request({
        origin: 'human',
        reason: 'test',
        operation: { action: 'upload', portKey: device.key, resumeMonitor: false },
      });
      f.advance();
      await expect(f.backend.approve(next.id, true)).rejects.toThrow('expired');
    } finally {
      await f.backend.dispose();
    }
  });
  it('connection, transmit, reset and disconnect each need new explicit approval', async () => {
    const f = fixture();
    try {
      const connect = await f.backend.request({
        origin: 'agent',
        reason: 'Read samples',
        operation: { action: 'connect', portKey: device.key, baud: 115200, delimiter: 'lf' },
      });
      expect(f.port.isOpen).toBe(false);
      await f.backend.approve(connect.id);
      expect(f.port.flags[0]).toEqual({ dtr: false, rts: false });
      const tx = await f.backend.request({
        origin: 'agent',
        reason: 'Exact payload',
        operation: { action: 'transmit', portKey: device.key, payload: '41 0a', encoding: 'hex' },
      });
      expect(f.port.writes).toHaveLength(0);
      await f.backend.approve(tx.id);
      expect(f.port.writes[0]).toEqual(Buffer.from([65, 10]));
      const reset = await f.backend.request({
        origin: 'agent',
        reason: 'Restart',
        operation: { action: 'reset', portKey: device.key, mechanism: 'dtr-pulse' },
      });
      expect(f.port.flags).toHaveLength(1);
      await f.backend.cancel(reset.id);
      await expect(f.backend.approve(reset.id)).rejects.toThrow();
      expect(f.port.flags).toHaveLength(1);
      const approvedReset = await f.backend.request({
        origin: 'human',
        reason: 'Restart selected board',
        operation: { action: 'reset', portKey: device.key, mechanism: 'dtr-pulse' },
      });
      expect((await f.backend.approve(approvedReset.id)).status).toBe('completed');
      expect(f.port.flags.slice(-2)).toEqual([
        { dtr: true, rts: false },
        { dtr: false, rts: false },
      ]);
      const disconnect = await f.backend.request({
        origin: 'human',
        reason: 'Stop',
        operation: { action: 'disconnect' },
      });
      expect(f.port.isOpen).toBe(true);
      await f.backend.approve(disconnect.id);
      expect(f.port.isOpen).toBe(false);
    } finally {
      await f.backend.dispose();
    }
  });
  it('upload failures cannot report successful programming', async () => {
    const f = fixture();
    try {
      const r = await f.backend.request({
        origin: 'agent',
        reason: 'test',
        operation: { action: 'upload', portKey: device.key, resumeMonitor: false },
      });
      f.upload.mockResolvedValueOnce({
        code: 1,
        output: 'busy port',
        cancelled: false,
        timedOut: false,
        truncated: false,
      });
      expect((await f.backend.approve(r.id, true)).status).toBe('failed');
      expect(f.backend.snapshot().uploaded).toBeNull();
    } finally {
      await f.backend.dispose();
    }
  });
  it('rejects model-supplied approved flag and arbitrary port path', async () => {
    const f = fixture();
    try {
      await expect(
        f.backend.request({
          origin: 'agent',
          reason: 'bad',
          operation: { action: 'connect', portKey: '/etc/passwd', baud: 115200, delimiter: 'lf' },
          approved: true,
        } as never),
      ).rejects.toThrow();
      expect(f.port.isOpen).toBe(false);
    } finally {
      await f.backend.dispose();
    }
  });
});

it('rejects replaced device identity after pending request', async () => {
  const f = fixture();
  let ports = [device];
  const service = new HardwareService(() => {}, { discover: async () => ports, serial: f.serial });
  service.syncProject(f.p);
  try {
    const request = await service.request({
      origin: 'agent',
      reason: 'Open selected board',
      operation: { action: 'connect', portKey: device.key, baud: 115200, delimiter: 'lf' },
    });
    ports = [{ ...device, identity: 'different-board' }];
    await expect(service.approve(request.id)).rejects.toThrow('no longer available');
    expect(f.port.isOpen).toBe(false);
  } finally {
    await service.dispose();
    await f.backend.dispose();
  }
});
it('cancels preparation by a known request ID and disposes a late artifact', async () => {
  const f = fixture();
  let release!: (value: any) => void;
  const prepared = new Promise<any>((resolve) => (release = resolve));
  const prepare = vi.fn(() => prepared);
  const service = new HardwareService(() => {}, { discover: async () => [device], prepare });
  service.syncProject(f.p);
  const id = crypto.randomUUID();
  try {
    const pending = service.request({
      requestId: id,
      origin: 'agent',
      reason: 'prepare',
      operation: { action: 'upload', portKey: device.key, resumeMonitor: false },
    });
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    await service.cancel(id);
    release({ artifact: { id: 'unused' }, dispose: f.dispose });
    await expect(pending).rejects.toThrow('cancelled');
    expect(f.dispose).toHaveBeenCalledOnce();
    expect(service.snapshot().requests).toHaveLength(0);
  } finally {
    await service.dispose();
    await f.backend.dispose();
  }
});
it('serializes competing approvals and retains only one execution', async () => {
  const f = fixture();
  try {
    const request = await f.backend.request({
      origin: 'agent',
      reason: 'prepare',
      operation: { action: 'upload', portKey: device.key, resumeMonitor: false },
    });
    const outcomes = await Promise.allSettled([
      f.backend.approve(request.id, true),
      f.backend.approve(request.id, true),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.upload).toHaveBeenCalledOnce();
  } finally {
    await f.backend.dispose();
  }
});
it('binds disconnect approval to the monitored device', async () => {
  const f = fixture();
  try {
    await f.serial.connect(device, 115200, 'lf');
    const request = await f.backend.request({
      origin: 'agent',
      reason: 'Stop this session',
      operation: { action: 'disconnect' },
    });
    await f.serial.disconnect();
    await f.serial.connect({ ...device, identity: 'replacement' }, 115200, 'lf');
    await expect(f.backend.approve(request.id)).rejects.toThrow();
    expect(f.serial.state.state).toBe('connected');
    expect(f.serial.state.port?.identity).toBe('replacement');
  } finally {
    await f.backend.dispose();
  }
});
it('binds payload approval to baud and framing and refuses a changed session', async () => {
  const f = fixture();
  try {
    await f.serial.connect(device, 115200, 'lf');
    const r = await f.backend.request({
      origin: 'agent',
      reason: 'exact serial payload',
      operation: { action: 'transmit', portKey: device.key, payload: 'x\n', encoding: 'text' },
    });
    expect(r.serialConfig).toEqual({ baud: 115200, delimiter: 'lf' });
    f.serial.state.baud = 9600;
    await expect(f.backend.approve(r.id)).rejects.toThrow('configuration changed');
    expect(f.port.writes).toHaveLength(0);
  } finally {
    await f.backend.dispose();
  }
});
it('cancels a running approved transmit without reporting completion', async () => {
  class DelayedWrite extends Port {
    override write(_data: Buffer, _cb: (e?: Error | null) => void) {}
  }
  const port = new DelayedWrite(),
    serial = new SerialService(() => port, 1000),
    service = new HardwareService(() => {}, { serial, discover: async () => [device] });
  service.syncProject(exampleProject());
  try {
    await serial.connect(device, 115200, 'lf');
    const r = await service.request({
      origin: 'agent',
      reason: 'send exact bytes',
      operation: { action: 'transmit', portKey: device.key, payload: 'x', encoding: 'text' },
    });
    const running = service.approve(r.id);
    await vi.waitFor(() => expect(service.snapshot().requests.at(-1)?.status).toBe('running'), {
      interval: 1,
    });
    await service.cancel(r.id);
    expect((await running).status).toBe('cancelled');
  } finally {
    await service.dispose();
  }
});

it('returns verification only after busy state clears', async () => {
  const f = fixture();
  const backend = new HardwareService(() => {}, {
    verify: async (input) => ({
      success: true,
      revision: input.project.revision,
      kind: 'build',
      output: 'fixture',
      durationMs: 1,
    }),
  });
  try {
    backend.syncProject(f.p);
    const result = await backend.verify(f.p, crypto.randomUUID());
    expect(result.busy).toBe(false);
    expect(result.verification?.result.success).toBe(true);
  } finally {
    await backend.dispose();
    await f.backend.dispose();
  }
});
