import { useState } from 'react';
import { ArrowUp, Square, Settings2, Sparkles, Check, X, ChevronRight } from 'lucide-react';
import { useWorkspace, uid } from './store';
import { Badge, IconButton } from './primitives';
import { providerDefaults } from '../services/bridge';
import { ChangeReview } from './ChangeReview';
import { buildKey } from '../domain/semantics';
import { buildIssueId } from '../services/participation';
export function Agent() {
  const s = useWorkspace();
  const prompt=s.agentDraft,setPrompt=(agentDraft:string)=>useWorkspace.setState({agentDraft});
  const dismissed=s.dismissedSuggestions,setDismissed=(dismissedSuggestions:string[])=>useWorkspace.setState({dismissedSuggestions});
  const pinIssue = s.diagnostics.find((d) => d.fix && d.revision === s.project.revision);
  const failedBuild =
    s.result &&
    !s.result.success &&
    !s.result.cancelled &&
    (s.result.buildKey
      ? s.result.buildKey === buildKey(s.project)
      : s.result.revision === s.project.revision)
      ? s.result
      : null;
  const suggestionKey = pinIssue
    ? `${s.project.id}:${pinIssue.id}:${pinIssue.detail}`
    : failedBuild
      ? buildIssueId(s.project, failedBuild)
      : null;
  const configured = s.connections.find((c) => c.provider === s.provider)?.configured;
  const begin = (goal: string) => {
    if (!configured) {
      setPrompt(goal);
      useWorkspace.setState({ settings: true });
      return;
    }
    window.dispatchEvent(new CustomEvent('trace:agent-request', { detail: goal }));
  };
  return (
    <div className="agent-panel">
      <div className="panel-toolbar">
        <select
          aria-label="Active AI provider"
          value={s.provider}
          disabled={s.agentBusy}
          onChange={(e) => {
            const provider = e.target.value as typeof s.provider;
            const c = s.connections.find((c) => c.provider === provider);
            useWorkspace.setState({
              provider,
              model: c?.model ?? providerDefaults[provider].model,
            });
          }}
        >
          {Object.entries(providerDefaults).map(([id, p]) => (
            <option key={id} value={id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          className="agent-model"
          title={s.model}
          onClick={() => useWorkspace.setState({ settings: true })}
        >
          {s.model}
        </button>
        <span className="spacer" />
        <IconButton
          title="AI connections and participation"
          onClick={() => useWorkspace.setState({ settings: true })}
        >
          <Settings2 />
        </IconButton>
      </div>
      <div className="conversation" aria-live="polite">
        {s.messages.length === 0 ? (
          <div className="agent-empty">
            <div className="agent-mark">
              <Sparkles size={21} />
            </div>
            {!configured ? (
              <>
                <span>No API key connected.</span>
                <button onClick={() => useWorkspace.setState({ settings: true })}>
                  Connect a provider
                </button>
              </>
            ) : null}
          </div>
        ) : (
          s.messages.map((m) => (
            <div key={m.id} className={`message ${m.role}`}>
              <div className="message-label">
                {m.role === 'user' ? 'You' : m.role === 'activity' ? 'Tool activity' : 'Trace'}
              </div>
              {m.role === 'activity' ? (
                <details>
                  <summary>{m.text.split('\n')[0]}</summary>
                  {m.details && <pre>{m.details}</pre>}
                </details>
              ) : (
                <p>{m.text}</p>
              )}
              {m.objectIds?.length && (
                <div className="row wrap">
                  {m.objectIds.map((id) => (
                    <button
                      key={id}
                      className="object-link"
                      onClick={() => s.select({ kind: 'component', id })}
                    >
                      {s.project.components.find((c) => c.id === id)?.ref ?? id}
                    </button>
                  ))}
                </div>
              )}
              {m.details && m.role !== 'activity' && (
                <details>
                  <summary>Details</summary>
                  <pre>{m.details}</pre>
                </details>
              )}
            </div>
          ))
        )}
        {s.agentBusy && (
          <div className="agent-working">
            <span className="working-dot" />
            {s.agentStatus}
          </div>
        )}
      </div>
      {s.proposal && (
        <div className="proposal">
          <div className="row">
            <strong>Proposed change</strong>
            <span className="spacer" />
            <Badge>r{s.proposal.transaction.expectedRevision}</Badge>
          </div>
          <p>{s.proposal.transaction.summary}</p>
          {s.proposal.transaction.expectedRevision !== s.project.revision ? (
            <p className="danger">
              Project changed since this proposal. Dismiss and regenerate it.
            </p>
          ) : (
            <ChangeReview transaction={s.proposal.transaction} project={s.project} />
          )}
          <div className="row">
            <button
              className="primary"
              disabled={s.proposal.transaction.expectedRevision !== s.project.revision}
              onClick={() => {
                if (
                  s.apply(
                    s.proposal!.transaction.summary,
                    s.proposal!.transaction.commands,
                    s.proposal!.transaction.expectedRevision,
                    s.proposal!.origin,
                  )
                ) {
                  useWorkspace.setState({
                    proposal: null,
                    messages: [
                      ...s.messages,
                      {
                        id: uid('msg'),
                        role: 'activity',
                        text: 'Applied grouped change. Undo is available.',
                      },
                    ],
                  });
                }
              }}
            >
              <Check size={13} /> Apply
            </button>
            <button onClick={() => useWorkspace.setState({ proposal: null })}>
              <X size={13} /> Dismiss
            </button>
          </div>
        </div>
      )}
      {s.participation !== 'request' &&
        suggestionKey &&
        !dismissed.includes(suggestionKey) &&
        !s.agentBusy && (
          <div className="context-suggestion-row">
            <button
              className="context-suggestion"
              onClick={() =>
                begin(
                  pinIssue
                    ? 'Investigate the current pin mismatch and propose a coordinated circuit and firmware correction.'
                    : 'Read the latest failed build output and relevant firmware, explain the compiler error, and propose a correction.',
                )
              }
            >
              <Sparkles size={13} />{' '}
              {pinIssue ? 'Investigate pin mismatch' : 'Explain failed build'}
            </button>
            <IconButton
              title="Dismiss suggestion"
              onClick={() => {
                setDismissed([...dismissed, suggestionKey]);
                window.dispatchEvent(
                  new CustomEvent('trace:dismiss-issue', { detail: suggestionKey }),
                );
              }}
            >
              <X />
            </IconButton>
          </div>
        )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (!prompt.trim()) return;
          if (!configured) {
            useWorkspace.setState({ settings: true });
            return;
          }
          window.dispatchEvent(new CustomEvent('trace:agent-request', { detail: prompt.trim() }));
          setPrompt('');
        }}
      >
        <textarea
          aria-label="Ask Trace"
          placeholder={
            configured
              ? 'Ask about your circuit or code…'
              : 'Ask Trace · connect a provider to send'
          }
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          rows={3}
        />
        <div className="row">
          <select
            aria-label="Participation mode"
            value={s.participation}
            onChange={(e) =>
              useWorkspace.setState({ participation: e.target.value as typeof s.participation })
            }
          >
            <option value="request">On request</option>
            <option value="suggest">Suggest</option>
            <option value="proactive">Proactive</option>
          </select>
          <span className="spacer" />
          {s.agentBusy ? (
            <IconButton
              title="Cancel agent task"
              onClick={() => window.dispatchEvent(new Event('trace:agent-cancel'))}
            >
              <Square />
            </IconButton>
          ) : (
            <button
              className="send-button"
              title="Send request"
              aria-label="Send request"
              type="submit"
              disabled={!prompt.trim()}
            >
              <ArrowUp size={17} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
