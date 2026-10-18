import { useState } from 'react';
import { RefreshCw, ChevronDown } from 'lucide-react';
import { partById } from '../parts/catalog';
import { useWorkspace } from './store';
import { useHardware, hardwareError, requestHardware, verifyProject } from './hardwareClient';
import { Modal } from './Modal';
import { ChangeReview } from './ChangeReview';
import { buildKey, circuitKey } from '../domain/semantics';
export function BoardSelector() {
  const s = useWorkspace(),
    h = useHardware();
  const port = h.snapshot?.ports.find((p) => p.key === h.portKey),
    target = s.project.components.find((c) => c.id === s.project.targetBoardId);
  const variant = s.project.boardSettings.esp32;
  return (
    <details className="board-picker">
      <summary aria-label="Board and serial port">
        {target ? partById(target.partId).name : 'Select board'}
        <span className="muted">
          {port ? port.path.split('/').pop() : h.portKey ? 'Port unavailable' : 'No port'}
        </span>
        <ChevronDown size={12} />
      </summary>
      <div className="board-popover floating-surface stack">
        <label className="field">
          Project board
          <select
            aria-label="Build target"
            value={s.project.targetBoardId ?? ''}
            onChange={(e) =>
              s.apply('Choose project board', [{ type: 'setTarget', id: e.target.value || null }])
            }
          >
            <option value="">Select board</option>
            {s.project.components
              .filter((c) => partById(c.partId).firmware)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.ref} · {partById(c.partId).name}
                </option>
              ))}
          </select>
        </label>
        <div className="row">
          <label className="field spacer">
            Physical serial device
            <select
              aria-label="Serial port"
              value={h.portKey}
              onChange={(e) => h.setPort(e.target.value)}
            >
              <option value="">Select port</option>
              {h.portKey && !port && (
                <option value={h.portKey}>Unavailable — reselect device</option>
              )}
              {h.snapshot?.ports.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.path} · {p.boardName ?? p.label}
                </option>
              ))}
            </select>
          </label>
          <button
            aria-label="Refresh ports"
            title="Refresh ports"
            onClick={() => void window.trace?.hardware.discover().catch(hardwareError)}
          >
            <RefreshCw size={14} />
          </button>
        </div>
        {target?.partId === 'esp32-s3-devkitc1-v11' && (
          <details>
            <summary>ESP32-S3 variant</summary>
            <div className="row">
              <label>
                Flash
                <select
                  aria-label="ESP flash size"
                  value={variant?.flashMB ?? '4'}
                  onChange={(e) =>
                    s.apply('Configure ESP flash', [
                      {
                        type: 'setBoardSettings',
                        settings: {
                          esp32: {
                            flashMB: e.target.value as '4' | '8' | '16',
                            psram: variant?.psram ?? 'disabled',
                            confirmed: false,
                          },
                        },
                      },
                    ])
                  }
                >
                  {['4', '8', '16'].map((v) => (
                    <option key={v} value={v}>
                      {v} MB
                    </option>
                  ))}
                </select>
              </label>
              <label>
                PSRAM
                <select
                  aria-label="ESP PSRAM"
                  value={variant?.psram ?? 'disabled'}
                  onChange={(e) =>
                    s.apply('Configure ESP PSRAM', [
                      {
                        type: 'setBoardSettings',
                        settings: {
                          esp32: {
                            flashMB: variant?.flashMB ?? '4',
                            psram: e.target.value as 'disabled' | 'qspi' | 'opi',
                            confirmed: false,
                          },
                        },
                      },
                    ])
                  }
                >
                  {['disabled', 'qspi', 'opi'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              <input
                type="checkbox"
                checked={variant?.confirmed ?? false}
                onChange={(e) =>
                  s.apply('Confirm ESP module variant', [
                    {
                      type: 'setBoardSettings',
                      settings: {
                        esp32: {
                          flashMB: variant?.flashMB ?? '4',
                          psram: variant?.psram ?? 'disabled',
                          confirmed: e.target.checked,
                        },
                      },
                    },
                  ])
                }
              />{' '}
              Matches my module
            </label>
          </details>
        )}
        <label className="row">
          <input
            type="checkbox"
            checked={h.resume}
            onChange={(e) => useHardware.setState({ resume: e.target.checked })}
          />{' '}
          Resume this monitor after programming
        </label>
      </div>
    </details>
  );
}
export function HardwareDialogs() {
  const s = useWorkspace(),
    h = useHardware();
  const [busy, setBusy] = useState(false);
  const request =
    h.snapshot?.requests.find((r) => r.id === h.approvalId) ??
    h.snapshot?.requests.find((r) => r.status === 'pending');
  const pending = request?.status === 'pending';
  const close = () => {
    if (request) void window.trace?.hardware.cancel(request.id).catch(hardwareError);
    useHardware.setState({ approvalId: null });
  };
  if (h.warning)
    return (
      <Modal label="Verification required" onClose={() => useHardware.setState({ warning: false })}>
        <section className="settings-modal compact-dialog">
          <h2>Program Board</h2>
          <p>
            This version hasn't been verified. Run Verify to check the circuit and compile the
            firmware before programming.
          </p>
          <div className="row end">
            <button onClick={() => useHardware.setState({ warning: false })}>Cancel</button>
            <button
              className="secondary"
              onClick={() => {
                useHardware.setState({ warning: false });
                void verifyProject();
              }}
            >
              Verify
            </button>
            <button
              className="primary"
              onClick={() => {
                useHardware.setState({ warning: false });
                void requestHardware(
                  { action: 'upload', portKey: h.portKey, resumeMonitor: h.resume },
                  'Program without current verification.',
                ).catch(hardwareError);
              }}
            >
              Program Anyway
            </button>
          </div>
        </section>
      </Modal>
    );
  if (!request || !pending) return null;
  const artifact = request.artifact;
  const previousUpload = h.snapshot?.uploaded;
  const changed = artifact && artifact.buildKey !== buildKey(s.project);
  const verification = request.verification;
  const current =
    verification &&
    verification.buildKey === buildKey(s.project) &&
    verification.circuitKey === circuitKey(s.project);
  const issues =
    verification?.issues.filter((d) => d.severity === 'error' || d.severity === 'warning') ?? [];
  const title = {
    upload: 'Program Board',
    connect: 'Start monitoring',
    disconnect: 'Stop monitoring',
    transmit: 'Send serial command',
    reset: 'Reset board',
  }[request.operation.action];
  return (
    <Modal label={title} onClose={close}>
      <section className="settings-modal compact-dialog">
        <h2>{title}</h2>
        <p>
          {request.device?.boardName ?? request.device?.label}{' '}
          <span className="mono">{request.device?.path}</span>
        </p>
        <p>{request.reason}</p>
        {request.serialConfig && (
          <small>
            {request.serialConfig.baud} baud · {request.serialConfig.delimiter.toUpperCase()}
          </small>
        )}
        {request.warning && <p className="muted">{request.warning}</p>}
        {artifact && (
          <>
            <div className="artifact-facts">
              <span>Target</span>
              <strong>{artifact.target}</strong>
              <span>Configuration</span>
              <code>{artifact.configuration}</code>
              <span>Artifact</span>
              <code title={artifact.id}>{artifact.id.slice(0, 20)}</code>
              <span>Verification</span>
              <span>
                {current
                  ? verification!.result.success
                    ? `${issues.length} issues`
                    : 'Verify compilation failed'
                  : 'Not current'}
              </span>
            </div>
            {previousUpload &&
              previousUpload.device.identity === request.device?.identity &&
              previousUpload.artifact.files.length > 0 && (
                <details open>
                  <summary>Changes since last mudroom upload</summary>
                  <ChangeReview
                    project={{
                      ...s.project,
                      files: s.project.files.map((f) => ({
                        ...f,
                        content:
                          previousUpload.artifact.files.find((old) => old.path === f.path)
                            ?.content ?? '',
                      })),
                    }}
                    transaction={{
                      expectedRevision: s.project.revision,
                      summary: 'Firmware review',
                      commands: artifact.files
                        .filter(
                          (f) =>
                            previousUpload.artifact.files.find((old) => old.path === f.path)
                              ?.content !== f.content,
                        )
                        .map((f) => ({
                          type: 'writeFile',
                          file: {
                            id:
                              s.project.files.find((current) => current.path === f.path)?.id ??
                              'review',
                            path: f.path,
                            content: f.content,
                          },
                        })),
                    }}
                  />
                </details>
              )}
            <details>
              <summary>Firmware being programmed</summary>
              {artifact.files.map((f) => (
                <details key={f.path}>
                  <summary>{f.path}</summary>
                  <pre>{f.content}</pre>
                </details>
              ))}
            </details>
            {issues.length > 0 && (
              <details open>
                <summary>{issues.length} issues</summary>
                {issues.map((d) => (
                  <button
                    key={d.id}
                    className="issue-link"
                    onClick={() => {
                      close();
                      s.select({ kind: 'diagnostic', id: d.id, objectIds: d.objectIds });
                      useWorkspace.setState({ outputOpen: true, outputTab: 'diagnostics' });
                    }}
                  >
                    {d.title}
                  </button>
                ))}
              </details>
            )}
            <p className="muted">Programming closes monitoring and normally restarts the board.</p>
            {!current && <p>This version hasn't been verified.</p>}
          </>
        )}
        {request.operation.action === 'transmit' && (
          <pre>
            {request.operation.encoding === 'hex'
              ? request.operation.payload
              : JSON.stringify(request.operation.payload)}
          </pre>
        )}
        {request.operation.action === 'connect' && (
          <p>
            {request.operation.baud} baud · DTR/RTS held low after open. Opening may still reset the
            board.
          </p>
        )}
        {request.device?.weakIdentity && (
          <small>
            Device serial number unavailable. Disconnecting requires reselection and approval.
          </small>
        )}
        {changed && <p className="danger">Source or target changed. Cancel and prepare again.</p>}
        <div className="row end">
          <button onClick={close}>Cancel</button>
          {artifact && !current && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                close();
                void verifyProject();
              }}
            >
              Verify
            </button>
          )}
          <button
            className="primary"
            disabled={busy || !!changed}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await window.trace!.hardware.approve(
                  request.id,
                  !!artifact && (!current || issues.length > 0 || !verification?.result.success),
                );
                if (result.status === 'failed' || result.status === 'cancelled')
                  hardwareError(result.error ?? 'Operation did not complete.');
                useHardware.setState({ approvalId: null });
              } catch (e) {
                hardwareError(e);
                useHardware.setState({ approvalId: null });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? 'Running…'
              : artifact && (!current || issues.length > 0 || !verification?.result.success)
                ? 'Program Anyway'
                : 'Approve'}
          </button>
        </div>
      </section>
    </Modal>
  );
}
