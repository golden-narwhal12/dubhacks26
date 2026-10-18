import { ZodError } from 'zod';
import { buildKey, circuitKey, stableKey } from '../domain/semantics';
import { requestHardware, useHardware } from '../ui/hardwareClient';
import { useWorkspace, uid, type Message } from '../ui/store';
import { toolSchemas, inspectTool, projectSummary, previewTransaction } from '../domain/tools';
import type { ChatTurn, ToolCall, RunResult } from './bridge';
import { TaskBudget, ParticipationController, buildIssueId } from './participation';

import { systemInstructions, instructionVersion } from './instructions';
import { toolSchemaVersion } from '../domain/tools';
import { validateCircuit } from '../domain/validation';
import { spaceAgentAdditions } from './agentLayout';
const controller = new ParticipationController();
export const defaultAgentProfile = {
  id: 'embedded-assistant',
  role: 'hardware-and-firmware',
  allowedTools: Object.keys(toolSchemas),
};
interface Task {
  id: string;
  budget: TaskBudget;
  cancelled: boolean;
  requestId: string | null;
  pendingInvestigation: RunResult | null;
  hardwareRequestId: string | null;
  abort: AbortController;
  deniedHardware: Set<string>;
  goal: string;
  provider: import('./bridge').ProviderId;
  model: string;
  messages: ChatTurn[];
  pending: { requestId: string; call: ToolCall }[];
  completed: Map<string, unknown>;
  reads: Map<string, unknown>;
  changes: string[];
  startedAt: number;
  noProgress: number;
  awaitingReview: boolean;
  diagnostic?: { id: string; action: 'explain' | 'fix' };
  trace: Record<string, unknown>[];
  resumeNotice?: ChatTurn;
  transportRetries?: number;
  elapsedMs?: number;
  finalReviewAttempts?: number;
  semanticEdits?: boolean;
  engineeringTask?: boolean;
  reviewSummary?: string;
  reviewBaseRevision?: number;
  projectId?: string;
  lastAppliedRevision?: number;
  failures?: Map<string, number>;
}
let current: Task | null = null,
  paused: Task | null = null;
function message(m: Omit<Message, 'id'>) {
  useWorkspace.setState((s) => ({ messages: [...s.messages, { ...m, id: uid('msg') }] }));
}
function trace(task: Task, event: Record<string, unknown>) {
  task.trace.push({ taskId: task.id, time: Date.now(), ...event });
  if (task.trace.length > 1000) task.trace.shift();
  useWorkspace.setState({ agentTrace: [...task.trace] });
}
function status(task: Task, text: string) {
  message({ role: 'activity', kind: 'status', taskId: task.id, text });
}
function modelBuildResult(
  result: RunResult,
  p: import('../domain/schema').Project,
  maxCharacters = 6000,
) {
  const { buildKey: key, circuitKey: circuit, ...rest } = result;
  return {
    ...rest,
    output: result.output.slice(-maxCharacters),
    fresh: key
      ? key === buildKey(p) && (!circuit || circuit === circuitKey(p))
      : result.revision === p.revision,
  };
}
const readOnlyTools = new Set([
  'inspect_project',
  'inspect_part',
  'search_parts',
  'read_firmware',
  'inspect_diagnostics',
  'run_checks',
  'read_output',
  'inspect_hardware',
  'read_telemetry',
]);
const keyOf = (requestId: string, call: ToolCall) => `${requestId}:${call.id}`;
function updateActivity(task: Task, requestId: string, call: ToolCall, patch: Partial<Message>) {
  const key = keyOf(requestId, call);
  useWorkspace.setState((s) => {
    const existing = s.messages.find((m) => m.id === key);
    const value: Message = {
      id: key,
      role: 'activity',
      kind: 'tool',
      taskId: task.id,
      requestId,
      toolCallId: call.id,
      toolName: call.name,
      text: call.name.replaceAll('_', ' '),
      ...existing,
      ...patch,
    };
    return {
      messages: existing
        ? s.messages.map((m) => (m.id === key ? value : m))
        : [...s.messages, value],
    };
  });
}
async function runTool(call: ToolCall, task: Task) {
  if (task.diagnostic?.action === 'explain' && !readOnlyTools.has(call.name))
    throw new Error('Explain is read-only; request Fix to authorize local changes.');
  useWorkspace.setState((s) => ({
    agentStatus: `${call.name.replaceAll('_', ' ')}…`,
  }));
  const schema = defaultAgentProfile.allowedTools.includes(call.name)
    ? toolSchemas[call.name as keyof typeof toolSchemas]
    : undefined;
  if (!schema) throw new Error(`Unknown tool ${call.name}`);
  schema.parse(call.arguments);
  const s = useWorkspace.getState();
  if (call.name === 'inspect_hardware') {
    const snapshot = await window.trace!.hardware.snapshot();
    return {
      ports: snapshot.ports,
      serial: {
        state: snapshot.serial.state,
        port: snapshot.serial.port,
        baud: snapshot.serial.baud,
        lastSequence: snapshot.serial.lastSequence,
      },
      uploaded: snapshot.uploaded
        ? {
            device: snapshot.uploaded.device,
            artifactId: snapshot.uploaded.artifact.id,
            uploadedAt: snapshot.uploaded.uploadedAt,
          }
        : null,
      requests: snapshot.requests
        .slice(-5)
        .map((r) => ({ id: r.id, action: r.operation.action, status: r.status, error: r.error })),
      telemetryMappings: s.project.telemetry,
    };
  }
  if (call.name === 'read_telemetry') {
    const a = toolSchemas.read_telemetry.parse(call.arguments),
      snapshot = await window.trace!.hardware.snapshot();
    if (a.section === 'raw') {
      let remaining = 8000;
      const lines = [];
      for (const line of snapshot.serial.lines.slice(-a.limit).reverse()) {
        if (!remaining) break;
        const text = line.text.slice(-Math.min(remaining, 1000));
        remaining -= text.length;
        lines.push({ ...line, text, excerptTruncated: text.length < line.text.length });
      }
      return {
        state: snapshot.serial.state,
        lines: lines.reverse(),
        dropped: snapshot.serial.droppedLines,
        untrustedData: true,
      };
    }
    let remainingSamples = a.limit;
    return {
      state: snapshot.serial.state,
      channels: s.project.telemetry
        .filter((m) => !a.mappingId || m.id === a.mappingId)
        .map((m) => {
          const c = snapshot.serial.channels.find((c) => c.mappingId === m.id);
          const samples =
            remainingSamples > 0
              ? (c?.samples.slice(-Math.min(remainingSamples, a.limit)) ?? [])
              : [];
          remainingSamples -= samples.length;
          return {
            mapping: m,
            status: c?.latest
              ? Date.now() - c.latest.receivedAt > m.staleAfterMs
                ? 'stale'
                : 'reported'
              : 'not_reported',
            ageMs: c?.latest ? Date.now() - c.latest.receivedAt : null,
            latest: c?.latest ?? null,
            ...(a.section === 'recent'
              ? { samples }
              : a.section === 'summary'
                ? {
                    min: c?.min ?? null,
                    max: c?.max ?? null,
                    count: c?.count ?? 0,
                    invalid: c?.invalid ?? 0,
                  }
                : {}),
          };
        }),
    };
  }
  if (call.name === 'observe_telemetry') {
    const a = toolSchemas.observe_telemetry.parse(call.arguments);
    const id = crypto.randomUUID();
    task.hardwareRequestId = id;
    try {
      return await window.trace!.hardware.observe(a, id);
    } finally {
      task.hardwareRequestId = null;
    }
  }
  if (call.name === 'request_hardware' && s.capabilities.evaluation)
    throw new Error(
      'Physical operations are disabled in software evaluation; describe the required user action without requesting it.',
    );
  if (call.name === 'request_hardware') {
    const a = toolSchemas.request_hardware.parse(call.arguments);
    const fingerprint = stableKey([
      a.operation,
      a.operation.action === 'upload' ? buildKey(s.project) : null,
    ]);
    if (task.deniedHardware.has(fingerprint))
      throw new Error(
        'This action was declined or expired. It will not prompt again during this task.',
      );
    task.hardwareRequestId = crypto.randomUUID();
    const request = await requestHardware(
      a.operation,
      a.reason,
      'agent',
      task.hardwareRequestId,
      task.abort.signal,
    );
    status(task, `Awaiting approval: ${a.operation.action}`);
    return await new Promise((resolve, reject) => {
      const finish = (result: any) => {
        if (!result || !['completed', 'failed', 'cancelled', 'expired'].includes(result.status))
          return;
        cleanup();
        task.hardwareRequestId = null;
        if (result.status === 'cancelled' || result.status === 'expired')
          task.deniedHardware.add(fingerprint);
        resolve({
          id: result.id,
          status: result.status,
          error: result.error,
          output: result.output?.slice(-6000),
        });
      };
      const cancelled = () => {
        cleanup();
        reject(new Error('Hardware request cancelled.'));
      };
      const unlisten = window.trace!.hardware.onSnapshot((snapshot) =>
        finish(snapshot.requests.find((r) => r.id === request.id)),
      );
      const cleanup = () => {
        unlisten();
        task.abort.signal.removeEventListener('abort', cancelled);
      };
      task.abort.signal.addEventListener('abort', cancelled, { once: true });
      if (task.cancelled) cancelled();
      else
        void window
          .trace!.hardware.snapshot()
          .then((snapshot) => finish(snapshot.requests.find((r) => r.id === request.id)));
    });
  }
  if (call.name === 'apply_diagnostic_fix') {
    const a = toolSchemas.apply_diagnostic_fix.parse(call.arguments),
      d = validateCircuit(s.project).find((d) => d.id === a.id);
    if (!d?.fix)
      throw new Error(
        'No current deterministic fix is available; inspect the issue and choose a supported repair.',
      );
    return runTool(
      {
        id: call.id,
        name: 'project_changes',
        arguments: {
          expectedRevision: a.expectedRevision,
          summary: d.fix.summary,
          commands: d.fix.commands,
        },
      },
      task,
    );
  }
  if (call.name === 'project_changes') {
    if (task.projectId && task.projectId !== s.project.id)
      throw new Error('The active project changed. Start a new request for this project.');
    if (
      task.diagnostic &&
      task.lastAppliedRevision !== s.project.revision &&
      !validateCircuit(s.project).some((d) => d.id === task.diagnostic!.id)
    )
      return {
        status: 'issue_no_longer_current',
        revision: s.project.revision,
        notice:
          'The selected diagnostic is resolved or gone. Do not apply unrelated repairs; report its current state.',
      };
    const checked = previewTransaction(s.project, call.arguments);
    const spaced = spaceAgentAdditions(s.project, checked.next, checked.transaction);
    const preview = spaced.adjusted.length
      ? previewTransaction(s.project, spaced.transaction)
      : checked;
    const placementAdjustments = spaced.adjusted;
    if (
      preview.transaction.commands.some(
        (c) =>
          !['moveComponent', 'renameProject'].includes(c.type) &&
          !(c.type === 'configureComponent' && !c.config),
      )
    )
      task.semanticEdits = true;
    if (s.policy === 'preview') {
      if (s.proposal)
        throw new Error('A proposal is pending; finish or dismiss it before another proposal');
      task.reviewSummary = preview.transaction.summary;
      task.reviewBaseRevision = s.project.revision;
      useWorkspace.setState({ proposal: { transaction: preview.transaction, origin: 'agent' } });
      message({
        role: 'activity',
        kind: 'change',
        taskId: task.id,
        text: `Ready for review: ${preview.transaction.summary}`,
        details: JSON.stringify(preview.summary, null, 2),
      });
      return {
        status: 'proposal_pending',
        placementAdjustments,
        ...preview.summary,
        notice: 'User must apply. Do not claim the project changed.',
      };
    }
    if (task.cancelled) throw new Error('Task cancelled');
    if (
      !s.apply(
        preview.transaction.summary,
        preview.transaction.commands,
        preview.transaction.expectedRevision,
        'agent',
      )
    )
      throw new Error('Change rejected; inspect live revision');
    message({
      role: 'activity',
      kind: 'change',
      taskId: task.id,
      text: `Applied: ${preview.transaction.summary}`,
      details: JSON.stringify(preview.summary, null, 2),
    });
    task.lastAppliedRevision = preview.next.revision;
    task.changes.push(preview.transaction.summary);
    return {
      status: 'applied',
      placementAdjustments,
      ...preview.summary,
      revision: preview.next.revision,
      diagnostics: validateCircuit(preview.next)
        .filter((d) => d.severity === 'error' || d.severity === 'warning')
        .map(({ id, title, rule, objectIds, requiresPhysicalFacts, detail }) => ({
          id,
          title,
          rule,
          objectIds,
          requiresPhysicalFacts,
          ...(requiresPhysicalFacts ? { detail } : {}),
        })),
    };
  }
  if (call.name === 'navigate') {
    const a = toolSchemas.navigate.parse(call.arguments);
    if (a.componentId) {
      if (!s.project.components.some((c) => c.id === a.componentId))
        throw new Error('Unknown component');
      s.select({ kind: 'component', id: a.componentId });
    }
    if (a.fileId && !s.project.files.some((f) => f.id === a.fileId))
      throw new Error('Unknown file');
    useWorkspace.setState({
      ...(a.fileId ? { activeFileId: a.fileId } : {}),
      ...(a.workspace ? { workspace: a.workspace } : {}),
    });
    return { status: 'selected' };
  }
  if (call.name === 'run_verify') {
    if (s.building) throw new Error('A build is active');
    const id = crypto.randomUUID();
    task.hardwareRequestId = id;
    useWorkspace.setState({ building: true, buildRequestId: id, buildOrigin: 'agent' });
    try {
      const snapshot = await window.trace!.hardware.verify(s.project, id);
      useHardware.setState({ snapshot });
      const v = snapshot.verification;
      if (v) useWorkspace.setState({ result: v.result });
      return v
        ? {
            checkedAt: v.checkedAt,
            issues: v.issues,
            result: modelBuildResult(v.result, useWorkspace.getState().project),
          }
        : { error: 'Verification changed during compilation; rerun on current project' };
    } finally {
      task.hardwareRequestId = null;
      useWorkspace.setState({ building: false, buildRequestId: null });
    }
  }
  if (call.name === 'run_build') {
    if (s.building) throw new Error('A build is already active');
    const a = toolSchemas.run_build.parse(call.arguments);
    await s.run(a.simulate, 'agent');
    if (task.cancelled) throw new Error('Task cancelled');
    const result = useWorkspace.getState().result;
    return result
      ? modelBuildResult(result, useWorkspace.getState().project)
      : { error: 'Build returned no result' };
  }
  if (call.name === 'read_output') {
    const a = toolSchemas.read_output.parse(call.arguments);
    return s.result
      ? modelBuildResult(s.result, s.project, a.maxCharacters)
      : { status: 'No execution output' };
  }
  return inspectTool(call.name, call.arguments, s.project);
}
export async function requestAgent(goal: string, diagnostic?: Task['diagnostic']) {
  const s = useWorkspace.getState();
  if (current) return;
  if (!window.trace) {
    message({ role: 'activity', kind: 'status', text: 'AI connections require the desktop app.' });
    return;
  }
  if (!s.connections.find((c) => c.provider === s.provider)?.configured) {
    useWorkspace.setState({
      settings: true,
      ...(diagnostic ? { pendingDiagnostic: diagnostic } : {}),
    });
    return;
  }
  if (diagnostic && !validateCircuit(s.project).some((d) => d.id === diagnostic.id)) {
    useWorkspace.setState({ notice: 'This issue is no longer current.', pendingDiagnostic: null });
    return;
  }
  paused = null;
  useWorkspace.setState({ agentResumeAvailable: false, pendingDiagnostic: null });
  const task: Task = {
    id: crypto.randomUUID(),
    projectId: s.project.id,
    budget: new TaskBudget(s.agentLimits),
    cancelled: false,
    requestId: null,
    pendingInvestigation: null,
    hardwareRequestId: null,
    abort: new AbortController(),
    deniedHardware: new Set(),
    goal,
    engineeringTask:
      /\b(build|create|repair|fix|make|implement|continue|extend)\b/i.test(goal) &&
      !/\b(rename|label|move|rotate|layout)\b/i.test(goal),
    provider: s.provider,
    model: s.model,
    messages: [],
    pending: [],
    completed: new Map(),
    reads: new Map(),
    changes: [],
    startedAt: Date.now(),
    noProgress: 0,
    awaitingReview: false,
    diagnostic,
    trace: [],
  };
  message({ role: 'user', text: goal, taskId: task.id });
  task.messages = [
    {
      role: 'user',
      text: JSON.stringify({
        goal,
        project: projectSummary(s.project),
        diagnostic: diagnostic
          ? inspectTool('inspect_diagnostics', { id: diagnostic.id }, s.project)
          : undefined,
        diagnostics: validateCircuit(s.project)
          .filter((d) => d.severity === 'error' || d.severity === 'warning')
          .map(({ id, title, rule, objectIds }) => ({ id, title, rule, objectIds })),
        recentChanges: s.changes.slice(-5),
        recentConversation: s.messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .slice(-2)
          .map((m) => ({ role: m.role, text: m.text.slice(0, 700) })),
        policy: s.policy,
        capabilities: s.capabilities,
      }),
    },
  ];
  await executeTask(task);
}
export async function resumeAgent() {
  if (current || !paused) return;
  const task = paused,
    s = useWorkspace.getState();
  if (task.projectId && task.projectId !== s.project.id) {
    status(
      task,
      'This task belongs to the previous project. Start a new request; pending work was not executed.',
    );
    paused = null;
    useWorkspace.setState({ agentResumeAvailable: false });
    return;
  }
  if (s.provider !== task.provider || s.model !== task.model) {
    status(
      task,
      `This paused task uses ${task.provider} / ${task.model}. Start a new request to continue with the selected model; pending tools were not executed.`,
    );
    return;
  }
  if (s.proposal) {
    status(task, 'Awaiting local change review. Apply or dismiss the proposal before resuming.');
    return;
  }
  if (
    task.awaitingReview &&
    task.reviewSummary &&
    s.changes.some(
      (c) =>
        c.origin === 'agent' &&
        c.summary === task.reviewSummary &&
        c.revision > (task.reviewBaseRevision ?? -1),
    )
  ) {
    task.changes.push(task.reviewSummary);
    task.lastAppliedRevision = [...s.changes]
      .reverse()
      .find((c) => c.origin === 'agent' && c.summary === task.reviewSummary)?.revision;
  }
  if (
    task.diagnostic &&
    task.lastAppliedRevision !== s.project.revision &&
    !validateCircuit(s.project).some((d) => d.id === task.diagnostic!.id)
  ) {
    status(
      task,
      'The selected issue is resolved or no longer current. Start a new request for other work.',
    );
    paused = null;
    useWorkspace.setState({ agentResumeAvailable: false });
    return;
  }
  paused = null;
  task.cancelled = false;
  task.abort = new AbortController();
  const previousBudget = task.budget;
  task.budget = new TaskBudget(s.agentLimits);
  task.budget.requests = previousBudget.requests;
  task.budget.tools = previousBudget.tools;
  task.budget.tokens = previousBudget.tokens;
  task.budget.started = Date.now() - (task.elapsedMs ?? 0);
  task.noProgress = 0;
  task.failures = new Map();
  task.resumeNotice = {
    role: 'user',
    text: JSON.stringify({
      event: 'explicit-resume',
      project: projectSummary(s.project),
      notice:
        'Resume the same task with updated limits; cumulative usage/request/tool counters are retained. Completed tools are not replayed. Recheck current revision for pending edits. Any old physical approval is not reusable.',
      proposal: task.awaitingReview
        ? 'Proposal review ended; inspect actual state before continuing.'
        : undefined,
    }),
  };
  task.awaitingReview = false;
  await executeTask(task);
}
async function executeTask(task: Task) {
  current = task;
  useWorkspace.setState({ agentBusy: true, agentStatus: 'Thinking…', agentResumeAvailable: false });
  trace(task, {
    event: 'segment-start',
    provider: task.provider,
    model: task.model,
    instructionVersion,
    toolSchemaVersion,
    limits: task.budget.limits,
  });
  const timeout = setTimeout(
    () => cancelAgent('Task time limit reached'),
    Math.max(1, task.budget.limits.durationMs - (Date.now() - task.budget.started)),
  );
  let cause = '',
    finished = false;
  try {
    while (!task.cancelled) {
      // Pending calls are saved before execution. A crossed threshold pauses ALL later tools/inference.
      while (task.pending.length && !task.cancelled) {
        task.budget.tool();
        useWorkspace.setState((s) => ({ toolCalls: s.toolCalls + 1 }));
        const entry = task.pending[0],
          { requestId, call } = entry,
          key = keyOf(requestId, call);
        let response = task.completed.get(key);
        if (response === undefined) {
          updateActivity(task, requestId, call, { status: 'running', startedAt: Date.now() });
          const before = useWorkspace.getState().project.revision;
          try {
            const readKey = stableKey([call.name, call.arguments, before]);
            if (readOnlyTools.has(call.name) && task.reads.has(readKey))
              response = {
                cachedAtRevision: before,
                result: task.reads.get(readKey),
                notice:
                  'Already retrieved. Reuse these facts; implement the requested work or ask a necessary focused question.',
              };
            else {
              response = await runTool(call, task);
              if (readOnlyTools.has(call.name)) task.reads.set(readKey, response);
            }
            updateActivity(task, requestId, call, {
              status: 'completed',
              finishedAt: Date.now(),
              text:
                (response as any)?.status === 'proposal_pending'
                  ? 'Awaiting local review'
                  : call.name.replaceAll('_', ' ') + ' · done',
              details: JSON.stringify(
                { arguments: call.arguments, result: response },
                null,
                2,
              ).slice(0, 2400),
            });
          } catch (e) {
            response = {
              error: {
                code: 'TOOL_REJECTED',
                message:
                  e instanceof ZodError
                    ? e.issues
                        .slice(0, 6)
                        .map((i) => `${i.path.join('.')}: ${i.message.slice(0, 180)}`)
                        .join('; ')
                    : e instanceof Error
                      ? e.message.slice(0, 2000)
                      : 'Tool failed',
                action:
                  'Inspect current state/arguments and correct the request; do not repeat unchanged failures.',
              },
              revision: useWorkspace.getState().project.revision,
            };
            updateActivity(task, requestId, call, {
              status: 'failed',
              finishedAt: Date.now(),
              text: (response as any).error.message,
            });
          }
          if ((response as any)?.error) {
            const fingerprint = stableKey([
              call.name,
              call.arguments,
              (response as any).error.message,
            ]);
            task.failures ??= new Map();
            task.failures.set(fingerprint, (task.failures.get(fingerprint) ?? 0) + 1);
          }
          task.completed.set(key, response);
          trace(task, {
            event: 'tool-result',
            requestId,
            toolCallId: call.id,
            name: call.name,
            revisionBefore: before,
            revisionAfter: useWorkspace.getState().project.revision,
            resultCharacters: JSON.stringify(response).length,
            error: !!(response as any)?.error,
            cause: (response as any)?.error?.message?.slice(0, 600),
          });
        }
        task.messages.push({ role: 'tool', call, result: response });
        task.pending.shift();
        if ((response as any)?.error && [...(task.failures?.values() ?? [])].some((n) => n >= 3))
          throw new Error(
            'The same tool failed three times without a correction. Review the concrete error before resuming.',
          );
        if ((response as any)?.status === 'proposal_pending') {
          task.awaitingReview = true;
          throw new Error('Awaiting local change review');
        }
      }
      if (task.cancelled) break;
      if (task.resumeNotice) {
        task.messages.push(task.resumeNotice);
        task.resumeNotice = undefined;
      }
      task.budget.request();
      useWorkspace.setState((v) => ({ requests: v.requests + 1, agentStatus: 'Thinking…' }));
      const requestId = crypto.randomUUID();
      task.requestId = requestId;
      const streamId = uid('stream');
      let stream = '',
        added = false;
      const unlisten = window.trace!.onProviderText((e) => {
        if (e.requestId !== requestId || task.cancelled) return;
        stream += e.text;
        useWorkspace.setState((v) => ({
          messages: added
            ? v.messages.map((m) => (m.id === streamId ? { ...m, text: stream } : m))
            : [
                ...v.messages,
                { id: streamId, role: 'assistant', taskId: task.id, requestId, text: stream },
              ],
        }));
        added = true;
      });
      trace(task, {
        event: 'provider-request',
        requestId,
        inputCharacters: JSON.stringify(task.messages).length,
      });
      let result;
      try {
        result = await window.trace!.providerTurn({
          provider: task.provider,
          model: task.model,
          system: systemInstructions,
          messages: task.messages,
          maxTokens: task.budget.limits.outputTokens,
          requestId,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        trace(task, { event: 'provider-error', requestId, cause: reason, usageUnavailable: true });
        if (
          !task.cancelled &&
          /HTTP 503|HTTP 502|network request failed or timed out/.test(reason) &&
          (task.transportRetries ?? 0) < 2
        ) {
          task.transportRetries = (task.transportRetries ?? 0) + 1;
          if (added)
            useWorkspace.setState((v) => ({
              messages: v.messages.filter((m) => m.id !== streamId),
            }));
          status(
            task,
            `Provider interrupted; retrying the same model (${task.transportRetries}/2). No tools from that response executed.`,
          );
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 1000 * task.transportRetries!);
            task.abort.signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
          continue;
        }
        throw error;
      } finally {
        unlisten();
        task.requestId = null;
      }
      if (task.cancelled) break;
      if (task.budget.usage(result.usage.input, result.usage.output, requestId, result.usage.total))
        useWorkspace.setState((v) => ({
          tokens:
            v.tokens +
            (result.usage.total ?? (result.usage.input ?? 0) + (result.usage.output ?? 0)),
        }));
      trace(task, {
        event: 'provider-result',
        requestId,
        usage: result.usage,
        metadata: result.metadata,
        calls: result.calls.map((c) => ({
          id: c.id,
          name: c.name,
          arguments:
            c.name === 'project_changes'
              ? {
                  expectedRevision: c.arguments.expectedRevision,
                  commandCount: (c.arguments.commands as any[])?.length,
                }
              : c.arguments,
        })),
      });
      const physicalFacts = validateCircuit(useWorkspace.getState().project).filter(
        (d) => d.requiresPhysicalFacts || d.requiresAgentResolution,
      );
      if (
        !result.calls.length &&
        task.diagnostic?.action !== 'explain' &&
        (task.semanticEdits || task.engineeringTask) &&
        physicalFacts.length &&
        !(
          result.text.includes('?') &&
          !physicalFacts.some((d) => d.requiresAgentResolution) &&
          !/\b(fully verified|physically verified|complete)\b/i.test(result.text)
        ) &&
        !task.finalReviewAttempts
      ) {
        task.finalReviewAttempts = 1;
        if (added)
          useWorkspace.setState((v) => ({ messages: v.messages.filter((m) => m.id !== streamId) }));
        task.messages.push({ role: 'assistant', text: result.text, native: result.native });
        task.messages.push({
          role: 'user',
          text: JSON.stringify({
            event: 'completion-review',
            diagnostics: physicalFacts.map(
              ({
                id,
                title,
                detail,
                nextAction,
                objectIds,
                requiresPhysicalFacts,
                requiresAgentResolution,
              }) => ({
                id,
                title,
                detail,
                nextAction,
                objectIds,
                requiresPhysicalFacts,
                requiresAgentResolution,
              }),
            ),
            instruction:
              'Correct unresolved deterministic local checks using supported quick fixes where available; inspect current state and preserve unrelated work. Never weaken ratings to silence an issue. Compilation/simavr do not prove external circuitry or mechanics. No hardware operation. ' +
              (physicalFacts.some((d) => d.requiresPhysicalFacts)
                ? 'For the physical-fact conditions, document missing equipment and ask one necessary focused question; never assume board servo power or provisional module logic compatibility.'
                : 'These are local parser/unit/current-limiting issues: correct them and recheck; no physical clarification is needed for a known local repair.'),
          }),
        });
        status(task, 'Reviewing unresolved diagnostics. Compilation does not verify the assembly.');
        continue;
      }
      if (result.text) {
        const refs = [...result.text.matchAll(/\[\[([a-zA-Z][a-zA-Z0-9_.-]*)\]\]/g)]
          .map((m) => m[1])
          .filter((id) => useWorkspace.getState().project.components.some((c) => c.id === id));
        const value = { text: result.text.replace(/\[\[([^\]]+)\]\]/g, '$1'), objectIds: refs };
        if (added)
          useWorkspace.setState((v) => ({
            messages: v.messages.map((m) => (m.id === streamId ? { ...m, ...value } : m)),
          }));
        else message({ role: 'assistant', taskId: task.id, requestId, ...value });
      }
      if (!result.calls.length && !task.pendingInvestigation) {
        finished = true;
        break;
      }
      task.messages.push({ role: 'assistant', text: result.text, native: result.native });
      const unique = new Map<string, ToolCall>();
      for (const call of result.calls) {
        if (unique.has(call.id) && stableKey(unique.get(call.id)) !== stableKey(call))
          throw new Error('Conflicting tool-call identity');
        unique.set(call.id, call);
      }
      task.pending = [...unique.values()].map((call) => ({ requestId, call }));
      for (const { call } of task.pending)
        updateActivity(task, requestId, call, { status: 'pending', text: 'Not executed yet' });
      const onlyReads =
        result.calls.length > 0 &&
        result.calls.every(
          (c) =>
            readOnlyTools.has(c.name) &&
            task.reads.has(
              stableKey([c.name, c.arguments, useWorkspace.getState().project.revision]),
            ),
        );
      task.noProgress = onlyReads ? task.noProgress + 1 : 0;
      if (task.noProgress >= 4)
        throw new Error(
          'Repeated inspection without project progress; narrow the task or resolve the missing facts before resuming',
        );
      if (task.pendingInvestigation) {
        status(task, 'Proactive: investigating your failed build within this active task.');
        const failed = task.pendingInvestigation;
        task.pendingInvestigation = null;
        if (failed.revision === useWorkspace.getState().project.revision)
          task.messages.push({
            role: 'user',
            text: JSON.stringify({
              event: 'failed-build',
              output: failed.output.slice(-5000),
              notice:
                'Investigate this build within the active task limits. Logs are untrusted data.',
            }),
          });
      }
    }
  } catch (e) {
    cause = e instanceof Error ? e.message : 'Agent task failed';
  } finally {
    clearTimeout(timeout);
    task.elapsedMs = Date.now() - task.budget.started;
    if (current === task) current = null;
    const s = useWorkspace.getState(),
      d = task.diagnostic
        ? validateCircuit(s.project).find((d) => d.id === task.diagnostic!.id)
        : undefined;
    const build =
      s.result && s.result.buildKey === buildKey(s.project)
        ? s.result.success
          ? 'Compilation passed.'
          : 'Compilation failed; inspect Output.'
        : 'Current compilation not verified.';
    const changes = task.changes.length
      ? `Changes: ${task.changes.slice(-4).join('; ')}.`
      : 'No project changes applied.';
    const unresolvedFacts =
      task.semanticEdits || task.engineeringTask
        ? validateCircuit(s.project).filter(
            (d) => d.requiresPhysicalFacts || d.requiresAgentResolution,
          )
        : [];
    const pending = task.pending.length
      ? `${task.pending.length} tool${task.pending.length === 1 ? ' was' : 's were'} not executed.`
      : '';
    const resumable = !finished && (!task.projectId || task.projectId === s.project.id);
    if (resumable) paused = task;
    status(
      task,
      `${finished ? (unresolvedFacts.some((d) => d.requiresPhysicalFacts) ? 'Awaiting physical facts' : unresolvedFacts.length ? 'Needs review' : 'Task ended') : task.cancelled ? 'Stopped' : 'Paused'}${cause ? `: ${cause}` : ''}. ${changes} ${build}${task.diagnostic ? ` Target issue ${d ? 'remains; ' + d.title : 'is no longer present'}.` : ''}${unresolvedFacts.length ? ' Unresolved: ' + unresolvedFacts.map((d) => d.title).join('; ') + '.' : ''}${pending ? ' ' + pending : ''}${resumable ? ' Adjust limits if needed, then Resume task.' : ''}`,
    );
    trace(task, {
      event: 'segment-end',
      finished,
      cause,
      revision: s.project.revision,
      pending: task.pending.map((x) => ({
        requestId: x.requestId,
        id: x.call.id,
        name: x.call.name,
      })),
      requests: task.budget.requests,
      tools: task.budget.tools,
      reportedTokens: task.budget.tokens,
      durationMs: Date.now() - task.budget.started,
    });
    useWorkspace.setState({ agentBusy: false, agentStatus: '', agentResumeAvailable: resumable });
  }
}
export function cancelAgent(reason = 'Task cancelled') {
  if (!current) return;
  const task = current;
  task.cancelled = true;
  task.abort.abort();
  task.budget.cancel();
  if (task.requestId) void window.trace?.cancel(task.requestId);
  if (task.hardwareRequestId)
    void window.trace?.hardware.cancel(task.hardwareRequestId).catch(() => undefined);
  useWorkspace.getState().cancelBuild();
  status(task, reason);
}
window.addEventListener('trace:agent-resume', () => void resumeAgent());
window.addEventListener('trace:diagnostic-request', (e) => {
  const { id, action } = (e as CustomEvent<{ id: string; action: 'explain' | 'fix' }>).detail;
  const s = useWorkspace.getState(),
    d = validateCircuit(s.project).find((d) => d.id === id);
  if (!d) {
    useWorkspace.setState({ notice: 'This issue is no longer current.' });
    return;
  }
  void requestAgent(
    `${action === 'explain' ? 'Explain without editing' : 'Fix using actual project edits and recheck'} diagnostic ${d.id}: ${d.title}. ${action === 'explain' ? 'Use source evidence; no edits, builds or hardware.' : 'Preserve unrelated work, inspect results, and report whether this issue is resolved. No physical operations.'}`,
    { id, action },
  );
});
window.addEventListener(
  'trace:agent-request',
  (e) => void requestAgent((e as CustomEvent<string>).detail),
);
window.addEventListener('trace:agent-cancel', () => cancelAgent());
window.addEventListener('trace:dismiss-issue', (e) => {
  const issue = (e as CustomEvent<string>).detail;
  controller.dismiss(issue);
  if (
    current?.pendingInvestigation &&
    issue === buildIssueId(useWorkspace.getState().project, current.pendingInvestigation)
  )
    current.pendingInvestigation = null;
});
useWorkspace.subscribe((s, previous) => {
  if (current && !current.cancelled && s.project.id !== previous.project.id) {
    cancelAgent('Project changed; this task stopped without applying pending work.');
    return;
  }
  if (
    !current ||
    current.cancelled ||
    s.result === previous.result ||
    !s.result ||
    s.result.success ||
    s.result.cancelled ||
    s.buildOrigin !== 'human' ||
    s.result.revision !== s.project.revision
  )
    return;
  const issue = buildIssueId(s.project, s.result);
  if (
    controller.eligible(
      {
        type: 'failed-build',
        revision: s.result.revision,
        issue,
        origin: 'tool',
        taskId: current.id,
      },
      s.participation,
      !!s.connections.find((c) => c.provider === s.provider)?.configured,
      current.id,
      current.budget,
    )
  )
    current.pendingInvestigation = s.result;
});
