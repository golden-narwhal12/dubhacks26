import { it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { SerialService, type SerialTransport } from '../desktop/serial';
import type { TelemetryMapping } from '../src/domain/schema';
const mapping: TelemetryMapping = {
  id: 'angle',
  label: 'Encoder angle',
  parser: 'json',
  field: 'angle',
  units: 'deg',
  meaning: 'measurement',
  deviceTimestampField: 'time',
  staleAfterMs: 3000,
};
class Port extends EventEmitter implements SerialTransport {
  isOpen = false;
  open(cb: (e: Error | null) => void) {
    this.isOpen = true;
    cb(null);
  }
  close(cb: (e: Error | null) => void) {
    this.isOpen = false;
    cb(null);
  }
  write(_b: Buffer, cb: () => void) {
    cb();
  }
  drain(cb: () => void) {
    cb();
  }
  set(_f: unknown, cb: () => void) {
    cb();
  }
}
const device = {
  key: '/dev/cu.fixture',
  path: '/dev/cu.fixture',
  label: 'Fixture',
  identity: 'fixture',
  weakIdentity: true,
};
it('frames fragmented UTF-8, bounds raw/channel history, retains malformed lines without invented samples', async () => {
  const port = new Port(),
    s = new SerialService(() => port);
  s.configure([mapping]);
  await s.connect(device, 115200, 'lf');
  port.emit('data', Buffer.from('{"angle":1,"time":4'));
  expect(s.snapshot().lines).toHaveLength(0);
  port.emit('data', Buffer.from('}\nnot telemetry\n{"angle":"bad"}\n'));
  expect(s.snapshot().channels[0].latest?.value).toBe(1);
  expect(s.snapshot().channels[0].latest?.deviceTimestamp).toBe(4);
  expect(s.snapshot().lines).toHaveLength(3);
  const utf = Buffer.from('café\n');
  port.emit('data', utf.subarray(0, 4));
  port.emit('data', utf.subarray(4));
  expect(s.snapshot().lines.at(-1)?.text).toBe('café');
  port.emit('data', Buffer.from('a'.repeat(20000) + '\n'));
  expect(s.snapshot().lines.at(-1)?.truncated).toBe(true);
  for (let i = 0; i < 600; i++) port.emit('data', Buffer.from(`{"angle":${i}}\n`));
  const state = s.snapshot();
  expect(state.lines).toHaveLength(500);
  expect(state.channels[0].samples).toHaveLength(300);
  expect(state.channels[0].count).toBe(601);
  expect(state.droppedLines).toBeGreaterThan(0);
  await s.disconnect();
});
it('subscribes immediately for future evidence and cancels/deadlines/disconnects without scraping', async () => {
  const port = new Port(),
    s = new SerialService(() => port);
  s.configure([mapping]);
  await s.connect(device, 115200, 'lf');
  const result = s.observe(
    { mappingId: 'angle', operator: 'gt', value: 10, timeoutMs: 1000 },
    new AbortController().signal,
  );
  port.emit('data', Buffer.from('{"angle":11}\n'));
  expect((await result).sample.value).toBe(11);
  const c = new AbortController(),
    cancel = s.observe(
      { mappingId: 'angle', operator: 'eq', value: 90, timeoutMs: 1000 },
      c.signal,
    );
  c.abort();
  await expect(cancel).rejects.toThrow('cancelled');
  const closed = s.observe(
    { mappingId: 'angle', operator: 'eq', value: 90, timeoutMs: 1000 },
    new AbortController().signal,
  );
  await s.disconnect();
  await expect(closed).rejects.toThrow('stopped');
});
it('bounds a stalled open and closes a cancelled late-open handle without taking ownership back', async () => {
  class Delayed extends Port {
    opened?: (e: Error | null) => void;
    closes = 0;
    override open(cb: (e: Error | null) => void) {
      this.opened = cb;
    }
    override close(cb: (e: Error | null) => void) {
      this.closes++;
      super.close(cb);
    }
    finish() {
      this.isOpen = true;
      this.opened?.(null);
    }
  }
  const stalled = new Delayed(),
    bounded = new SerialService(() => stalled, 15);
  await expect(bounded.connect(device, 115200, 'lf')).rejects.toThrow('limit');
  expect(bounded.state.state).toBe('error');
  stalled.finish();
  expect(stalled.isOpen).toBe(false);
  const old = new Delayed(),
    fresh = new Port();
  let calls = 0;
  const s = new SerialService(() => (calls++ === 0 ? old : fresh), 30),
    controller = new AbortController();
  const opening = s.connect(device, 115200, 'lf', controller.signal);
  controller.abort();
  await expect(opening).rejects.toThrow('cancelled');
  await s.connect(device, 9600, 'lf');
  old.finish();
  expect(old.isOpen).toBe(false);
  expect(fresh.isOpen).toBe(true);
  expect(s.state.baud).toBe(9600);
  expect(s.state.state).toBe('connected');
  await s.disconnect();
});
it('bounds stalled write/drain/control-line/close callbacks and aborts before sending bytes', async () => {
  class StalledWrite extends Port {
    override write(_b: Buffer, _cb: () => void) {}
  }
  const write = new StalledWrite(),
    s = new SerialService(() => write, 15);
  await s.connect(device, 115200, 'lf');
  await expect(s.transmit(Buffer.from('go'))).rejects.toThrow('limit');
  expect(write.isOpen).toBe(false);
  class StalledDrain extends Port {
    override drain(_cb: () => void) {}
  }
  const drain = new StalledDrain(),
    d = new SerialService(() => drain, 15);
  await d.connect(device, 115200, 'lf');
  await expect(d.transmit(Buffer.from('go'))).rejects.toThrow('limit');
  expect(drain.isOpen).toBe(false);
  class StalledFlags extends Port {
    override set(_f: unknown, _cb: () => void) {}
  }
  const flags = new StalledFlags(),
    f = new SerialService(() => flags, 15);
  await expect(f.connect(device, 115200, 'lf')).rejects.toThrow('limit');
  expect(flags.isOpen).toBe(false);
  class StalledClose extends Port {
    override close(_cb: (e: Error | null) => void) {}
  }
  const close = new StalledClose(),
    c = new SerialService(() => close, 15);
  await c.connect(device, 115200, 'lf');
  await expect(c.disconnect()).rejects.toThrow('limit');
  expect(c.state.state).toBe('error');
  const normal = new Port(),
    n = new SerialService(() => normal, 15);
  await n.connect(device, 115200, 'lf');
  const controller = new AbortController();
  controller.abort();
  await expect(n.transmit(Buffer.from('do not send'), controller.signal)).rejects.toThrow(
    'cancelled',
  );
  await expect(n.reset(controller.signal)).rejects.toThrow('cancelled');
  await n.disconnect();
});
it('flushes partial and invalid UTF8 input on a physical close without creating a measurement', async () => {
  const port = new Port(),
    s = new SerialService(() => port);
  s.configure([mapping]);
  await s.connect(device, 115200, 'lf');
  port.emit('data', Buffer.from([0x7b, 0x22, 0xc3]));
  port.isOpen = false;
  port.emit('close');
  const line = s.snapshot().lines.at(-1);
  expect(line?.truncated).toBe(true);
  expect(line?.invalidEncoding).toBe(true);
  expect(s.snapshot().channels).toHaveLength(0);
});
