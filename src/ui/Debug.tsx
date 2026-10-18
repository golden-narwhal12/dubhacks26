import { useState, useEffect } from 'react';
import { Plus, X, Send, RotateCcw } from 'lucide-react';
import { useHardware, requestHardware, hardwareError } from './hardwareClient';
import { useWorkspace, uid } from './store';
import { TelemetryMappingSchema, type TelemetryMapping } from '../domain/schema';
import { parseMeasurement, formatMeasurement } from '../services/telemetry';
import { buildKey } from '../domain/semantics';
import { Modal } from './Modal';
export function Debug() {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const h = useHardware(),
    s = useWorkspace(),
    serial = h.snapshot?.serial;
  const [mapping, setMapping] = useState(false),
    [selectedExample, setSelectedExample] = useState<string | undefined>(),
    [payload, setPayload] = useState(''),
    [ending, setEnding] = useState('\n');
  const uploaded = h.snapshot?.uploaded;
  const selectedDevice = h.snapshot?.ports.find((p) => p.key === h.portKey);
  const matching = uploaded && selectedDevice?.identity === uploaded.device.identity;
  return (
    <div className="debug-panel">
      <div className="panel-toolbar">
        <span className={serial?.state === 'connected' ? 'accent' : 'muted'}>
          {serial?.state ?? 'Disconnected'}
        </span>
        <span className="mono muted">{serial?.port?.path}</span>
        <span className="spacer" />
        <label className="row muted">
          Baud
          <input
            aria-label="Serial baud"
            type="number"
            min="300"
            max="2000000"
            value={h.baud}
            onChange={(e) => useHardware.setState({ baud: Number(e.target.value) })}
          />
        </label>
        <select
          aria-label="Serial delimiter"
          value={h.delimiter}
          onChange={(e) =>
            useHardware.setState({ delimiter: e.target.value as typeof h.delimiter })
          }
        >
          <option value="lf">LF</option>
          <option value="crlf">CRLF</option>
          <option value="cr">CR</option>
        </select>
        <button
          title="Request board reset"
          aria-label="Request board reset"
          disabled={!h.portKey || serial?.state !== 'connected'}
          onClick={() =>
            void requestHardware(
              { action: 'reset', portKey: h.portKey, mechanism: 'dtr-pulse' },
              'Reset using a DTR control-line pulse.',
            ).catch(hardwareError)
          }
        >
          <RotateCcw size={13} />
        </button>
      </div>
      <div className="device-program-state">
        {matching
          ? uploaded.artifact.buildKey === buildKey(s.project)
            ? 'Matches last mudroom upload'
            : 'Local firmware changed since upload'
          : 'Device program identity unknown'}
        {matching && <small> · {uploaded.artifact.id.slice(0, 12)}</small>}
      </div>
      <div className="readout-heading row">
        <strong>Readings</strong>
        <span className="spacer" />
        <button onClick={() => setMapping(true)}>
          <Plus size={13} /> Map field
        </button>
      </div>
      <div className="channel-list">
        {s.project.telemetry.map((m) => {
          const c = serial?.channels.find((c) => c.mappingId === m.id),
            last = c?.latest;
          const stale = last && Date.now() - last.receivedAt > m.staleAfterMs;
          return (
            <section key={m.id} className="readout">
              <div className="row">
                <span>{m.label}</span>
                <span className="spacer" />
                <span className="muted">
                  {m.meaning === 'command'
                    ? 'Commanded position'
                    : m.meaning === 'measurement'
                      ? 'Reported measurement'
                      : m.meaning}
                </span>
                <button
                  aria-label={`Remove mapping ${m.label}`}
                  onClick={() =>
                    s.apply('Remove telemetry mapping', [{ type: 'removeTelemetry', id: m.id }])
                  }
                >
                  <X size={11} />
                </button>
              </div>
              <strong className={stale ? 'muted' : 'accent'}>
                {last ? formatMeasurement(last.value, m.units) : 'Not reported'}
              </strong>
              {last && (
                <small>
                  {stale ? 'Stale · ' : ''}Received {new Date(last.receivedAt).toLocaleTimeString()}{' '}
                  · raw #{last.rawSequence}
                  {last.deviceTimestamp !== undefined
                    ? ` · device time ${last.deviceTimestamp}`
                    : ''}
                </small>
              )}
              {c && c.samples.length > 1 && (
                <svg
                  className="history-plot"
                  viewBox="0 0 300 50"
                  role="img"
                  aria-label={`${m.label} history`}
                >
                  <polyline
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="1.5"
                    points={c.samples
                      .map(
                        (p, i) =>
                          `${(i * 300) / (c.samples.length - 1)},${45 - ((p.value - (c.min ?? 0)) * 40) / ((c.max ?? 1) - (c.min ?? 0) || 1)}`,
                      )
                      .join(' ')}
                  />
                </svg>
              )}
              {c && c.count > 0 && (
                <small>
                  Min {formatMeasurement(c.min!, m.units)} · Max{' '}
                  {formatMeasurement(c.max!, m.units)} · {c.count} samples
                  {c.invalid ? ` · ${c.invalid} invalid` : ''}
                </small>
              )}
            </section>
          );
        })}
        {!s.project.telemetry.length && (
          <button className="empty-map" onClick={() => setMapping(true)}>
            Map a reported field
          </button>
        )}
      </div>
      <details className="unreported">
        <summary>Unreported components</summary>
        {s.project.components
          .filter((c) => !s.project.telemetry.some((m) => m.componentId === c.id))
          .map((c) => (
            <div key={c.id}>{c.ref} · Not reported</div>
          ))}
      </details>
      {!!h.snapshot?.requests.length && (
        <details className="hardware-history">
          <summary>Hardware activity</summary>
          {h.snapshot.requests
            .slice(-10)
            .reverse()
            .map((r) => (
              <details key={r.id}>
                <summary>
                  {r.operation.action} · {r.status} · {r.device?.path} ·{' '}
                  {new Date(r.startedAt ?? r.createdAt).toLocaleTimeString()}
                </summary>
                <pre>{r.error ?? r.warning ?? r.output ?? r.reason}</pre>
              </details>
            ))}
        </details>
      )}
      <div className="raw-heading row">
        <strong>Serial output</strong>
        <span className="spacer" />
        <small>
          {serial?.droppedLines ? `${serial.droppedLines} older lines dropped · ` : ''}
          {serial?.parseErrors ? `${serial.parseErrors} parse misses` : ''}
        </small>
      </div>
      {serial?.error && <p className="danger">{serial.error}</p>}
      <div className="serial-log" role="log" aria-label="Physical serial output">
        {serial?.lines.map((line) => (
          <button
            key={line.sequence}
            title={`Host receipt ${new Date(line.receivedAt).toISOString()} · #${line.sequence}${line.invalidEncoding ? ' · invalid UTF-8' : ''}${line.truncated ? ' · truncated' : ''}`}
            onClick={() => {
              setSelectedExample(line.text);
              setMapping(true);
            }}
          >
            <span>{new Date(line.receivedAt).toLocaleTimeString()}</span>
            <code>{line.text}</code>
          </button>
        ))}
      </div>
      <form
        className="serial-transmit row"
        onSubmit={(e) => {
          e.preventDefault();
          void requestHardware(
            {
              action: 'transmit',
              portKey: serial?.port?.key ?? h.portKey,
              payload: payload + ending,
              encoding: 'text',
            },
            'Send the shown bytes; device-specific effects are not inferred.',
          ).catch(hardwareError);
        }}
      >
        <input
          aria-label="Serial command"
          placeholder="Serial command"
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
        />
        <select
          aria-label="Transmit line ending"
          value={ending}
          onChange={(e) => setEnding(e.target.value)}
        >
          <option value="">No ending</option>
          <option value={'\n'}>LF</option>
          <option value={'\r\n'}>CRLF</option>
        </select>
        <button
          type="submit"
          aria-label="Review serial command"
          disabled={!payload || serial?.state !== 'connected'}
        >
          <Send size={13} />
        </button>
      </form>
      {mapping && (
        <MappingEditor
          initialExample={selectedExample}
          close={() => {
            setMapping(false);
            setSelectedExample(undefined);
          }}
        />
      )}
    </div>
  );
}
function MappingEditor({ close, initialExample }: { close: () => void; initialExample?: string }) {
  const s = useWorkspace(),
    serial = useHardware((h) => h.snapshot?.serial);
  const [example, setExample] = useState(initialExample ?? serial?.lines.at(-1)?.text ?? ''),
    [label, setLabel] = useState(''),
    [field, setField] = useState(''),
    [parser, setParser] = useState<'json' | 'keyvalue'>('keyvalue'),
    [componentId, setComponent] = useState(''),
    [terminalId, setTerminal] = useState(''),
    [units, setUnits] = useState(''),
    [meaning, setMeaning] = useState<TelemetryMapping['meaning']>('raw'),
    [error, setError] = useState(''),
    [timestamp, setTimestamp] = useState('');
  const candidate = {
    id: 'preview',
    label: label || field || 'Reading',
    parser,
    field,
    componentId: componentId || undefined,
    terminalId: terminalId || undefined,
    units,
    meaning,
    deviceTimestampField: timestamp || undefined,
    staleAfterMs: 3000,
  };
  const preview = field ? parseMeasurement(candidate, example) : null;
  const component = s.project.components.find((c) => c.id === componentId);
  return (
    <Modal label="Map telemetry field" onClose={close}>
      <form
        className="settings-modal compact-dialog stack"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const mapping = TelemetryMappingSchema.parse({ ...candidate, id: uid('reading') });
            if (!preview) {
              setError('Choose a field present as a finite number in this example.');
              return;
            }
            if (s.apply('Map reported telemetry', [{ type: 'setTelemetry', mapping }])) close();
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        <h2>Map field</h2>
        <label className="field">
          Example line
          <input
            list="serial-examples"
            aria-label="Telemetry example"
            value={example}
            onChange={(e) => setExample(e.target.value)}
          />
          <datalist id="serial-examples">
            {serial?.lines.slice(-30).map((l) => (
              <option key={l.sequence} value={l.text} />
            ))}
          </datalist>
        </label>
        <div className="row">
          <label className="field">
            Format
            <select
              aria-label="Telemetry parser"
              value={parser}
              onChange={(e) => setParser(e.target.value as typeof parser)}
            >
              <option value="keyvalue">key=value</option>
              <option value="json">JSON object</option>
            </select>
          </label>
          <label className="field spacer">
            Field
            <input
              aria-label="Telemetry field"
              value={field}
              onChange={(e) => setField(e.target.value)}
              placeholder="angle or sensor.angle"
            />
          </label>
        </div>
        <div className="row">
          <label className="field spacer">
            Label
            <input
              aria-label="Telemetry label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label className="field">
            Declared units
            <input
              aria-label="Telemetry units"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
            />
          </label>
        </div>
        <div className="row">
          <label className="field">
            Meaning
            <select
              aria-label="Telemetry meaning"
              value={meaning}
              onChange={(e) => setMeaning(e.target.value as typeof meaning)}
            >
              {['raw', 'measurement', 'command', 'state', 'count'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="field spacer">
            Component
            <select
              aria-label="Telemetry component"
              value={componentId}
              onChange={(e) => {
                setComponent(e.target.value);
                setTerminal('');
              }}
            >
              <option value="">Unassigned</option>
              {s.project.components.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.ref}
                </option>
              ))}
            </select>
          </label>
        </div>
        {component && (
          <TerminalMapping
            partId={component.partId}
            terminalId={terminalId}
            setTerminal={setTerminal}
          />
        )}
        <details>
          <summary>Device timestamp</summary>
          <input
            aria-label="Device timestamp field"
            placeholder="Optional explicit timestamp field"
            value={timestamp}
            onChange={(e) => setTimestamp(e.target.value)}
          />
        </details>
        <div className="mapping-preview">
          {preview
            ? `Preview: ${formatMeasurement(preview.value, units)}`
            : 'No numeric value in this example'}
        </div>
        {error && <p className="danger">{error}</p>}
        <div className="row end">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={!preview}>
            Save mapping
          </button>
        </div>
      </form>
    </Modal>
  );
}
import { partById } from '../parts/catalog';
function TerminalMapping({
  partId,
  terminalId,
  setTerminal,
}: {
  partId: string;
  terminalId: string;
  setTerminal: (v: string) => void;
}) {
  return (
    <label className="field">
      Terminal (optional)
      <select
        aria-label="Telemetry terminal"
        value={terminalId}
        onChange={(e) => setTerminal(e.target.value)}
      >
        <option value="">Whole component</option>
        {partById(partId).terminals.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}
