import {
  CheckCircle2,
  AlertTriangle,
  Info,
  ChevronDown,
  Check,
  ArrowUpRight,
  X,
} from 'lucide-react';
import { useWorkspace } from './store';
import { Badge, IconButton } from './primitives';
export function Output() {
  const s = useWorkspace();
  return (
    <div className="output-area">
      <div className="output-tabs">
        <button
          className={s.outputTab === 'diagnostics' ? 'active' : ''}
          onClick={() => useWorkspace.setState({ outputTab: 'diagnostics' })}
        >
          Diagnostics{' '}
          <Badge>
            {s.diagnostics.filter((d) => d.severity !== 'info' && d.id !== 'coverage').length}
          </Badge>
        </button>
        <button
          className={s.outputTab === 'build' ? 'active' : ''}
          onClick={() => useWorkspace.setState({ outputTab: 'build' })}
        >
          Build
        </button>
        <button
          className={s.outputTab === 'simulation' ? 'active' : ''}
          onClick={() => useWorkspace.setState({ outputTab: 'simulation' })}
        >
          MCU execution
        </button>
        <span className="spacer" />
        <small>
          {s.checksPending
            ? 'Checking code… · previous results shown'
            : `Revision ${s.project.revision}`}
        </small>
        <IconButton
          title="Collapse output"
          onClick={() => useWorkspace.setState({ outputOpen: false })}
        >
          <ChevronDown />
        </IconButton>
      </div>
      <div className="output-content">
        {s.outputTab === 'diagnostics' ? (
          <div className="diagnostics">
            {s.diagnostics.map((d) => (
              <div className={`diagnostic ${d.severity}`} key={d.id}>
                <button
                  className="diagnostic-select"
                  onClick={() => s.select({ kind: 'diagnostic', id: d.id, objectIds: d.objectIds })}
                >
                  {d.severity === 'error' ? (
                    <AlertTriangle size={14} />
                  ) : d.severity === 'warning' ? (
                    <AlertTriangle size={14} />
                  ) : (
                    <Info size={14} />
                  )}
                  <strong>{d.title}</strong>
                  <Badge>{d.severity}</Badge>
                </button>
                <div className="diagnostic-detail">
                  <p>{d.detail}</p>
                  {d.fix && (
                    <button
                      className="secondary"
                      disabled={d.revision !== s.project.revision || s.checksPending}
                      onClick={() =>
                        useWorkspace.setState({
                          proposal: {
                            transaction: {
                              expectedRevision: d.revision,
                              summary: d.fix!.summary,
                              commands: d.fix!.commands,
                            },
                            origin: 'rule',
                          },
                        })
                      }
                    >
                      <Check size={12} /> Preview fix
                    </button>
                  )}
                  <small>{d.rule}</small>
                </div>
              </div>
            ))}
          </div>
        ) : s.building ? (
          <div className="empty">
            {s.outputTab === 'simulation'
              ? 'Compiling and running supported MCU…'
              : 'Compiling firmware…'}
            <button onClick={s.cancelBuild}>Stop</button>
          </div>
        ) : s.result &&
          s.result.kind === (s.outputTab === 'simulation' ? 'simulation' : 'build') ? (
          <>
            <div className="execution-summary row">
              <Badge tone={s.result.success ? 'accent' : 'error'}>
                {s.result.success ? 'Complete' : 'Failed'}
              </Badge>
              <span>
                {s.result.kind === 'simulation'
                  ? 'Compiled MCU execution · external simavr'
                  : 'Arduino CLI compile'}
              </span>
              <span className="muted">
                {(s.result.durationMs / 1000).toFixed(1)}s · r{s.result.revision}
                {s.result.revision !== s.project.revision ? ' · STALE' : ''}
              </span>
            </div>
            {s.result.observations ? (
              <div className="execution-observations">
                <div>
                  <small>Emulated UART · first 20 lines</small>
                  <pre className="uart-output">
                    {s.result.observations.uart || 'No UART text observed in this sample.'}
                  </pre>
                </div>
                <div className="execution-scope">
                  <p>
                    GPIO trace: {s.result.observations.digitalTransitions ?? 'unavailable'} sampled
                    transitions
                  </p>
                  <small>{s.result.observations.scope}</small>
                  <details>
                    <summary>Full build and execution log</summary>
                    <pre className="build-log">{s.result.output}</pre>
                  </details>
                </div>
              </div>
            ) : (
              <pre className="build-log">{s.result.output}</pre>
            )}
          </>
        ) : (
          <div className="empty">
            {s.outputTab === 'simulation'
              ? 'Run compiled Mega firmware using the external simavr tool. ESP32-S3 simulation is unavailable.'
              : 'Build the selected board’s firmware with Arduino CLI.'}
          </div>
        )}
      </div>
    </div>
  );
}
