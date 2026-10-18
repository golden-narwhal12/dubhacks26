import { useState } from 'react';
import { Modal } from './Modal';
import { AgentLimitsSchema, type AgentLimits } from '../services/agentSettings';
import { X, KeyRound, Check, Trash2 } from 'lucide-react';
import { useWorkspace } from './store';
import { providerDefaults, type ProviderId } from '../services/bridge';
import { IconButton, Badge } from './primitives';
export function Settings() {
  const s = useWorkspace();
  const [provider, setProvider] = useState<ProviderId>(s.provider),
    [key, setKey] = useState(''),
    [model, setModel] = useState(
      s.connections.find((c) => c.provider === s.provider)?.model ??
        providerDefaults[s.provider].model,
    ),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  const configured = s.connections.find((c) => c.provider === provider)?.configured;
  const save = async (remove = false) => {
    if (!window.trace) {
      setStatus('Provider connections require the desktop application.');
      return;
    }
    setBusy(true);
    try {
      const connections = await window.trace.setConnection({
        provider,
        model,
        key: key || undefined,
        remove,
      });
      setKey('');
      useWorkspace.setState({ connections, ...(provider === s.provider ? { model } : {}) });
      setStatus(
        remove ? 'Key removed.' : 'Connection saved locally. Test to verify provider access.',
      );
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal label="Settings" onClose={() => useWorkspace.setState({ settings: false })}>
      <section className="settings-modal">
        <div className="modal-header">
          <div>
            <h2>AI connections</h2>
          </div>
          <span className="spacer" />
          <IconButton
            title="Close settings"
            onClick={() => useWorkspace.setState({ settings: false })}
          >
            <X />
          </IconButton>
        </div>
        <div className="settings-body">
          <nav>
            {Object.entries(providerDefaults).map(([id, p]) => (
              <button
                className={provider === id ? 'active' : ''}
                key={id}
                onClick={() => {
                  setProvider(id as ProviderId);
                  setModel(s.connections.find((c) => c.provider === id)?.model ?? p.model);
                  setKey('');
                  setStatus('');
                }}
              >
                <KeyRound size={13} />
                {p.name}
                {s.connections.find((c) => c.provider === id)?.configured && <Check size={12} />}
              </button>
            ))}
          </nav>
          <div className="connection-form stack">
            <div className="row">
              <h3>{providerDefaults[provider].name}</h3>
              <Badge tone={configured ? 'accent' : 'muted'}>
                {configured ? 'Key stored' : 'Not connected'}
              </Badge>
            </div>
            <label className="field">
              Model
              <input
                aria-label="Provider model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                autoComplete="off"
              />
              <small>Editable model ID; availability depends on your API account.</small>
            </label>
            <label className="field">
              API key
              <input
                aria-label="Provider API key"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={configured ? 'Enter a new key to replace' : 'Enter provider API key'}
                autoComplete="off"
              />
              <small>Encrypted by macOS in desktop storage. Never saved in projects.</small>
            </label>
            <div className="row">
              <button
                className="primary"
                disabled={busy || !model || (!key && !configured)}
                onClick={() => void save()}
              >
                Save connection
              </button>
              <button
                className="secondary"
                disabled={busy || !configured}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await window.trace!.testConnection({ provider, model });
                    setStatus(r.message);
                  } catch (e) {
                    setStatus(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Test
              </button>
              <IconButton
                title="Remove provider key"
                disabled={!configured || busy}
                onClick={() => void save(true)}
              >
                <Trash2 />
              </IconButton>
            </div>
            {status && (
              <p className="settings-status" role="status">
                {status}
              </p>
            )}
          </div>
        </div>
        <div className="participation-settings stack">
          {s.pendingDiagnostic && (
            <button
              className="secondary"
              disabled={!s.connections.find((c) => c.provider === s.provider)?.configured}
              onClick={() => {
                const detail = s.pendingDiagnostic;
                useWorkspace.setState({ settings: false });
                window.dispatchEvent(new CustomEvent('trace:diagnostic-request', { detail }));
              }}
            >
              Continue {s.pendingDiagnostic.action === 'explain' ? 'explanation' : 'fix'}
            </button>
          )}
          <h3>Participation</h3>
          <div className="row">
            <select
              aria-label="Agent participation setting"
              value={s.participation}
              onChange={(e) =>
                useWorkspace.setState({ participation: e.target.value as typeof s.participation })
              }
            >
              <option value="request">On request</option>
              <option value="suggest">Suggest · default</option>
              <option value="proactive">Proactive</option>
            </select>
            <select
              aria-label="Change application policy"
              value={s.policy}
              onChange={(e) => useWorkspace.setState({ policy: e.target.value as typeof s.policy })}
            >
              <option value="preview">Preview changes</option>
              <option value="apply">Apply reversible edits</option>
            </select>
          </div>
          <details>
            <summary>Task limits and supported triggers</summary>
            <div className="limit-fields">
              {(
                [
                  ['reportedTokens', 'Reported token threshold', 1],
                  ['requests', 'Model requests', 1],
                  ['tools', 'Tool calls', 1],
                  ['durationMs', 'Time limit (seconds)', 1000],
                  ['outputTokens', 'Response output limit', 1],
                ] as [keyof AgentLimits, string, number][]
              ).map(([name, label, scale]) => (
                <label className="field" key={name}>
                  {label}
                  <input
                    aria-label={label}
                    type="number"
                    min={1}
                    value={s.agentLimits[name] / scale}
                    onChange={(e) => {
                      const next = { ...s.agentLimits, [name]: Number(e.target.value) * scale };
                      if (AgentLimitsSchema.safeParse(next).success)
                        useWorkspace.setState({ agentLimits: next });
                    }}
                  />
                </label>
              ))}
            </div>
            <small>
              Maximum per task, not a spending cap or context window. Reported usage is checked
              after each response; further tools and requests pause at the threshold. Resume uses
              current settings.
            </small>
            <p>
              Proactive only continues a requested task after a failed build; 60-second cooldown and
              issue deduplication apply. Editing and telemetry make no model calls.
            </p>
            <p>
              Usage: {s.requests} requests · {s.toolCalls} tools · {s.tokens.toLocaleString()}{' '}
              reported tokens this session. Account balance/quota unavailable.
            </p>
          </details>
        </div>
      </section>
    </Modal>
  );
}
