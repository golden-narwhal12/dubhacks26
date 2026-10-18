import { SerialPort } from 'serialport';
import { StringDecoder } from 'node:string_decoder';
import { EventEmitter } from 'node:events';
import type { TelemetryMapping } from '../src/domain/schema';
import type {
  DevicePort,
  SerialSnapshot,
  ObserveCondition,
  TelemetrySample,
} from '../src/services/hardware';
import { parseMeasurement, measurementStatus } from '../src/services/telemetry';
export interface SerialTransport extends EventEmitter {
  isOpen: boolean;
  open(cb: (error: Error | null) => void): void;
  close(cb: (error: Error | null) => void): void;
  write(data: Buffer, cb: (error?: Error | null) => void): void;
  drain(cb: (error?: Error | null) => void): void;
  set(flags: { dtr: boolean; rts: boolean }, cb: (error?: Error | null) => void): void;
}
export type TransportFactory = (path: string, baud: number) => SerialTransport;
const factory: TransportFactory = (path, baud) =>
  new SerialPort({ path, baudRate: baud, autoOpen: false, lock: true });
export class SerialService extends EventEmitter {
  private transport: SerialTransport | null = null;
  private decoder = new StringDecoder('utf8');
  private buffer = '';
  private dropping = false;
  private mappings: TelemetryMapping[] = [];
  private generation = 0;
  state: SerialSnapshot = {
    state: 'disconnected',
    lines: [],
    channels: [],
    droppedLines: 0,
    parseErrors: 0,
    lastSequence: 0,
  };
  constructor(
    private create: TransportFactory = factory,
    private operationTimeoutMs = 5000,
  ) {
    super();
  }
  configure(mappings: TelemetryMapping[]) {
    const previous = this.mappings;
    this.mappings = structuredClone(mappings);
    this.state.channels = this.state.channels.filter((c) =>
      mappings.some(
        (m) =>
          m.id === c.mappingId &&
          JSON.stringify(m) === JSON.stringify(previous.find((old) => old.id === m.id)),
      ),
    );
  }
  snapshot(): SerialSnapshot {
    return structuredClone(this.state);
  }
  private check(signal: AbortSignal) {
    if (signal.aborted)
      throw new Error('Serial operation cancelled; effects may already have occurred.');
  }
  private callback(
    port: SerialTransport,
    operation: string,
    invoke: (cb: (error?: Error | null) => void) => void,
    signal: AbortSignal,
    late?: () => void,
  ): Promise<void> {
    this.check(signal);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error | null) => {
        if (settled) {
          late?.();
          return;
        }
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        port.off('error', failed);
        port.off('close', closed);
        error ? reject(error) : resolve();
      };
      const abort = () =>
        finish(new Error(`${operation} cancelled; effects may already have occurred.`));
      const failed = (error: Error) => finish(error);
      const closed = () => {
        if (operation !== 'Close port')
          finish(new Error('Device disconnected during serial operation.'));
      };
      const timer = setTimeout(
        () => finish(new Error(`${operation} exceeded the ${this.operationTimeoutMs} ms limit.`)),
        this.operationTimeoutMs,
      );
      signal.addEventListener('abort', abort, { once: true });
      port.on('error', failed);
      port.on('close', closed);
      try {
        invoke(finish);
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Serial operation failed.'));
      }
      if (signal.aborted) abort();
    });
  }
  private abandon(port: SerialTransport, error: string) {
    if (this.transport === port) {
      this.flushPartial();
      this.transport = null;
      this.generation++;
      this.state.state = 'error';
      this.state.error = error;
      this.emit('disconnect', new Error(error));
      this.emit('update');
    }
    // Best effort only: some native drivers finish open after its cancellation callback.
    try {
      if (port.isOpen) port.close(() => {});
    } catch {}
  }
  private current(port: SerialTransport, generation: number, signal: AbortSignal) {
    this.check(signal);
    if (this.transport !== port || this.generation !== generation || !port.isOpen)
      throw new Error('Serial connection changed or disconnected.');
  }
  async connect(
    device: DevicePort,
    baud: number,
    delimiter: 'lf' | 'cr' | 'crlf',
    signal = new AbortController().signal,
  ) {
    this.check(signal);
    if (this.transport)
      throw new Error('A port is already owned by monitoring. Stop monitoring first.');
    const port = this.create(device.path, baud),
      generation = ++this.generation;
    this.transport = port;
    this.decoder = new StringDecoder('utf8');
    this.buffer = '';
    this.dropping = false;
    this.state = {
      state: 'connecting',
      port: structuredClone(device),
      baud,
      delimiter,
      startedAt: Date.now(),
      lines: [],
      channels: [],
      droppedLines: 0,
      parseErrors: 0,
      lastSequence: 0,
    };
    this.emit('update');
    port.on('data', (data: Buffer) => {
      if (generation === this.generation) this.ingest(data);
    });
    port.on('error', (error: Error) => {
      if (generation === this.generation) this.abandon(port, error.message);
    });
    port.on('close', () => {
      if (generation === this.generation) {
        this.flushPartial();
        this.transport = null;
        this.generation++;
        this.state.state = 'disconnected';
        this.emit('disconnect', new Error('Device disconnected.'));
        this.emit('update');
      }
    });
    try {
      await this.callback(
        port,
        'Open port',
        (cb) => port.open(cb),
        signal,
        () => {
          if (this.transport !== port)
            try {
              if (port.isOpen) port.close(() => {});
            } catch {}
        },
      );
      this.current(port, generation, signal);
      await this.flags(port, generation, false, false, signal);
      this.current(port, generation, signal);
      this.state.state = 'connected';
      this.emit('update');
    } catch (error) {
      this.abandon(port, error instanceof Error ? error.message : 'Cannot open port.');
      throw error;
    }
  }
  async disconnect(signal = new AbortController().signal) {
    this.check(signal);
    this.flushPartial();
    const port = this.transport;
    if (!port) {
      this.state.state = 'disconnected';
      this.emit('update');
      return;
    }
    try {
      if (port.isOpen) await this.callback(port, 'Close port', (cb) => port.close(cb), signal);
      this.check(signal);
      if (this.transport === port) {
        this.transport = null;
        this.generation++;
      }
      this.state.state = 'disconnected';
      this.emit('disconnect', new Error('Monitoring stopped.'));
      this.emit('update');
    } catch (error) {
      this.abandon(port, error instanceof Error ? error.message : 'Cannot close port.');
      throw error;
    }
  }
  private flags(
    port: SerialTransport,
    generation: number,
    dtr: boolean,
    rts: boolean,
    signal: AbortSignal,
  ) {
    this.current(port, generation, signal);
    return this.callback(port, 'Set control lines', (cb) => port.set({ dtr, rts }, cb), signal);
  }
  async transmit(data: Buffer, signal = new AbortController().signal) {
    this.check(signal);
    const port = this.transport,
      generation = this.generation;
    if (!port?.isOpen) throw new Error('Start monitoring on this port before transmitting.');
    try {
      this.current(port, generation, signal);
      await this.callback(port, 'Write serial bytes', (cb) => port.write(data, cb), signal);
      this.current(port, generation, signal);
      await this.callback(port, 'Drain serial bytes', (cb) => port.drain(cb), signal);
      this.current(port, generation, signal);
    } catch (error) {
      this.abandon(port, error instanceof Error ? error.message : 'Serial transmit failed.');
      throw error;
    }
  }
  async reset(signal: AbortSignal) {
    this.check(signal);
    const port = this.transport,
      generation = this.generation;
    if (!port?.isOpen) throw new Error('Monitoring is not connected.');
    let asserted = false;
    try {
      asserted = true;
      await this.flags(port, generation, true, false, signal);
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new Error('Reset cancelled; effects may already have occurred.'));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', abort);
          resolve();
        }, 100);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
      this.current(port, generation, signal);
    } catch (error) {
      throw error;
    } finally {
      if (asserted && this.transport === port) {
        try {
          await this.flags(port, generation, false, false, new AbortController().signal);
        } catch (error) {
          this.abandon(port, error instanceof Error ? error.message : 'Reset cleanup failed.');
          throw error;
        }
      }
    }
  }
  private flushPartial() {
    const remainder = this.decoder.end();
    this.buffer += remainder;
    if (this.buffer && !this.dropping) this.line(this.buffer.slice(0, 8192), true);
    this.buffer = '';
    this.dropping = false;
    this.decoder = new StringDecoder('utf8');
  }
  ingest(chunk: Buffer) {
    const text = this.decoder.write(chunk),
      delimiter =
        this.state.delimiter === 'cr' ? '\r' : this.state.delimiter === 'crlf' ? '\r\n' : '\n';
    // Process by character so an enormous burst cannot create an unbounded intermediate line.
    for (const char of text) {
      this.buffer += char;
      if (this.buffer.endsWith(delimiter)) {
        const line = this.buffer
          .slice(0, -delimiter.length)
          .replace(this.state.delimiter === 'lf' ? /\r$/ : /$^/, '');
        if (!this.dropping) this.line(line, false);
        this.buffer = '';
        this.dropping = false;
      } else if (this.buffer.length > 8192) {
        if (!this.dropping) {
          this.line(this.buffer.slice(0, 8192), true);
          this.dropping = true;
        }
        this.buffer = this.buffer.slice(-Math.max(1, delimiter.length - 1));
      }
    }
  }
  private line(text: string, truncated: boolean) {
    const receivedAt = Date.now(),
      sequence = ++this.state.lastSequence;
    const record = {
      sequence,
      receivedAt,
      text,
      invalidEncoding: text.includes('\ufffd'),
      truncated,
    };
    this.state.lines.push(record);
    if (this.state.lines.length > 500) {
      this.state.lines.shift();
      this.state.droppedLines++;
    }
    if (!truncated && !record.invalidEncoding) {
      for (const mapping of this.mappings) {
        let channel = this.state.channels.find((c) => c.mappingId === mapping.id);
        if (!channel) {
          channel = {
            mappingId: mapping.id,
            latest: null,
            min: null,
            max: null,
            count: 0,
            invalid: 0,
            samples: [],
          };
          this.state.channels.push(channel);
        }
        try {
          const parsed = parseMeasurement(mapping, text);
          if (!parsed) {
            if (measurementStatus(mapping, text) === 'invalid') {
              channel.invalid++;
              this.state.parseErrors++;
            }
            continue;
          }
          const sample: TelemetrySample = {
            ...parsed,
            sequence,
            receivedAt,
            rawSequence: sequence,
          };
          channel.latest = sample;
          channel.min = channel.min === null ? sample.value : Math.min(channel.min, sample.value);
          channel.max = channel.max === null ? sample.value : Math.max(channel.max, sample.value);
          channel.count++;
          channel.samples.push(sample);
          if (channel.samples.length > 300) channel.samples.shift();
          this.emit('sample', mapping.id, sample);
        } catch {
          channel.invalid++;
          this.state.parseErrors++;
        }
      }
    }
    this.emit('update');
  }
  observe(
    input: ObserveCondition,
    signal: AbortSignal,
  ): Promise<{ mappingId: string; sample: TelemetrySample }> {
    if (this.state.state !== 'connected')
      return Promise.reject(new Error('Monitoring is not connected.'));
    if (!this.mappings.some((m) => m.id === input.mappingId))
      return Promise.reject(new Error('Unknown telemetry mapping.'));
    let previous = this.state.channels.find((c) => c.mappingId === input.mappingId)?.latest?.value;
    return new Promise((resolve, reject) => {
      const done = (error?: Error, sample?: TelemetrySample) => {
        clearTimeout(timer);
        this.off('sample', receive);
        this.off('disconnect', disconnected);
        signal.removeEventListener('abort', cancel);
        if (error) reject(error);
        else resolve({ mappingId: input.mappingId, sample: sample! });
      };
      const receive = (id: string, sample: TelemetrySample) => {
        if (id !== input.mappingId) return;
        if (input.operator === 'change' && previous === undefined) {
          previous = sample.value;
          return;
        }
        const matches =
          input.operator === 'change'
            ? previous !== undefined && sample.value !== previous
            : input.operator === 'eq'
              ? sample.value === input.value
              : input.operator === 'gt'
                ? sample.value > input.value!
                : sample.value < input.value!;
        if (matches) done(undefined, sample);
      };
      const disconnected = (e: Error) => done(e);
      const cancel = () => done(new Error('Observation cancelled.'));
      const timer = setTimeout(
        () => done(new Error('Observation deadline reached without matching evidence.')),
        input.timeoutMs,
      );
      this.on('sample', receive);
      this.on('disconnect', disconnected);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }
}
