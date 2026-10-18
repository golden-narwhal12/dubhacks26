import type { Message } from './store';
import { ArrowUp, Square, Settings2, Sparkles, Check, X } from 'lucide-react';
import { useWorkspace, uid } from './store';
import { Badge, IconButton } from './primitives';
import { providerDefaults } from '../services/bridge';
import { ChangeReview } from './ChangeReview';
import { buildKey } from '../domain/semantics';
import { buildIssueId } from '../services/participation';
type Activity = { key: string; tools: Message[] };
type ConversationEntry = { message: Message } | { activity: Activity };
const callIdentity = (message: Message) =>
  `${message.requestId ?? ''}:${message.toolCallId ?? message.id}`;
/** Stable call identity deduplicates replayed activity, never distinct provider calls. */
function conversationEntries(messages: Message[]): ConversationEntry[] {
  const entries: ConversationEntry[] = [];
  const groups = new Map<string, Activity>();
  let segment = 0;
  for (const message of messages) {
    if (message.role === 'user') segment++;
    if (message.role !== 'activity' || message.kind === 'status' || message.kind === 'change') {
      entries.push({ message });
      continue;
    }
    const key = message.taskId ?? message.requestId ?? `legacy-${segment}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, tools: [] };
      groups.set(key, group);
      entries.push({ activity: group });
    }
    const identity = callIdentity(message);
    const duplicate = group.tools.findIndex((tool) => callIdentity(tool) === identity);
    if (duplicate >= 0) group.tools[duplicate] = { ...group.tools[duplicate], ...message };
    else group.tools.push(message);
  }
  return entries;
}
function ActivityGroup({ activity, busy }: { activity: Activity; busy: boolean }) {
  const running = activity.tools.find(
    (tool) => tool.status === 'running' || tool.status === 'pending',
  );
  const failures = activity.tools.filter((tool) => tool.status === 'failed');
  const pending = activity.tools.filter(
    (tool) => tool.status === 'running' || tool.status === 'pending',
  );
  const active = busy && !!running;
  const label = active
    ? `${running.toolName?.replaceAll('_', ' ') ?? running.text.split('\n')[0]} · ${activity.tools.length} tools`
    : `${activity.tools.length} ${activity.tools.length === 1 ? 'step' : 'steps'}${failures.length || pending.length ? '' : ' completed'}`;
  return (
    <div className="activity-group" data-task-id={activity.key}>
      <details>
        <summary>
          {active && <span className="working-dot" />}
          <span>{label}</span>
          {failures.length > 0 && <span className="danger">{failures.length} failed</span>}
          {!active && pending.length > 0 && <span>{pending.length} pending</span>}
        </summary>
        <ol className="activity-steps">
          {activity.tools.map((tool) => (
            <li
              key={callIdentity(tool)}
              data-tool-call-id={tool.toolCallId ?? tool.id}
              data-request-id={tool.requestId}
            >
              <div className="row">
                <span>{tool.toolName?.replaceAll('_', ' ') ?? tool.text.split('\n')[0]}</span>
                <span className="spacer" />
                <small className={tool.status === 'failed' ? 'danger' : ''}>
                  {tool.status ?? 'completed'}
                </small>
                {tool.startedAt && tool.finishedAt && (
                  <small>{((tool.finishedAt - tool.startedAt) / 1000).toFixed(1)}s</small>
                )}
              </div>
              {tool.text && tool.toolName && <p>{tool.text}</p>}
              {tool.details && <pre>{tool.details}</pre>}
            </li>
          ))}
        </ol>
      </details>
      {failures.map((tool) => (
        <p key={callIdentity(tool)} className="activity-error" role="status">
          {tool.toolName?.replaceAll('_', ' ')}: {tool.text.split('\n')[0]}
        </p>
      ))}
    </div>
  );
}
export function Agent() {
  const s = useWorkspace();
  const entries = conversationEntries(s.messages);
  const hasActiveGroup =
    s.agentBusy &&
    entries.some(
      (entry) =>
        'activity' in entry &&
        entry.activity.tools.some((tool) => tool.status === 'running' || tool.status === 'pending'),
    );
  const prompt = s.agentDraft,
    setPrompt = (agentDraft: string) => useWorkspace.setState({ agentDraft });
  const dismissed = s.dismissedSuggestions,
    setDismissed = (dismissedSuggestions: string[]) =>
      useWorkspace.setState({ dismissedSuggestions });
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
          entries.map((entry) => {
            if ('activity' in entry)
              return (
                <ActivityGroup
                  key={entry.activity.key}
                  activity={entry.activity}
                  busy={s.agentBusy}
                />
              );
            const m = entry.message;
            return (
              <div key={m.id} className={`message ${m.role} ${m.kind ?? ''}`}>
                {m.role !== 'activity' && (
                  <div className="message-label">{m.role === 'user' ? 'You' : 'Trace'}</div>
                )}
                <p>{m.text}</p>
                {!!m.objectIds?.length && (
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
                {m.details && (
                  <details>
                    <summary>Details</summary>
                    <pre>{m.details}</pre>
                  </details>
                )}
              </div>
            );
          })
        )}
        {s.agentBusy && !hasActiveGroup && (
          <div className="agent-working">
            <span className="working-dot" />
            {s.agentStatus}
          </div>
        )}
      </div>
      {s.agentResumeAvailable && !s.agentBusy && (
        <div className="agent-resume">
          <button onClick={() => window.dispatchEvent(new Event('trace:agent-resume'))}>
            Resume task
          </button>
        </div>
      )}
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
                        kind: 'change',
                        status: 'completed',
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
                    ? `Fix diagnostic ${pinIssue.id}: ${pinIssue.title}. Use its established deterministic quick fix if available, preserve unrelated work, recheck and compile; no hardware operation.`
                    : 'Read the latest failed build output and relevant firmware, explain the compiler error, and propose a correction.',
                )
              }
            >
              <Sparkles size={13} /> {pinIssue ? 'Fix issue with Agent' : 'Explain failed build'}
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
