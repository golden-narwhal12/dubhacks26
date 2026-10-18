import { create } from 'zustand';
import {
  AgentLimitsSchema,
  migrateAgentSettings,
  agentSettingsStorageKey,
  type AgentLimits,
} from '../services/agentSettings';
import type { Project, View, Endpoint } from '../domain/schema';
import {
  emptyHistory,
  record,
  travel,
  transact,
  parseProject,
  serializeProject,
  type History,
  type Command,
  type Transaction,
} from '../domain/project';
import { exampleProject, blankProject } from '../domain/example';
import { validateCircuit, type Diagnostic } from '../domain/validation';
import type { RunResult, ProviderId, Connection } from '../services/bridge';
export type Selection =
  | { kind: 'component'; id: string }
  | { kind: 'terminal'; id: string; endpoint: Endpoint }
  | { kind: 'wire'; id: string }
  | { kind: 'diagnostic'; id: string; objectIds: string[] }
  | null;
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'activity';
  text: string;
  objectIds?: string[];
  details?: string;
  taskId?: string;
  requestId?: string;
  toolCallId?: string;
  toolName?: string;
  kind?: 'tool' | 'status' | 'change';
  status?: 'running' | 'completed' | 'failed' | 'pending';
  startedAt?: number;
  finishedAt?: number;
}
export interface Proposal {
  transaction: Transaction;
  origin: 'agent' | 'rule';
}
interface State {
  agentLimits: AgentLimits;
  agentTrace: Record<string, unknown>[];
  agentResumeAvailable: boolean;
  pendingDiagnostic: { id: string; action: 'explain' | 'fix' } | null;
  agentDraft: string;
  dismissedSuggestions: string[];
  workspace: 'prototype' | 'debug';
  project: Project;
  history: History;
  selection: Selection;
  view: View;
  activeFileId: string;
  diagnostics: Diagnostic[];
  checksPending: boolean;
  library: boolean;
  settings: boolean;
  outputOpen: boolean;
  outputTab: 'diagnostics' | 'build' | 'simulation';
  notice: string | null;
  result: RunResult | null;
  building: boolean;
  buildRequestId: string | null;
  buildOrigin: 'human' | 'agent';
  capabilities: { desktop: boolean; arduino: boolean; simavr: boolean; evaluation?: boolean };
  messages: Message[];
  agentBusy: boolean;
  agentStatus: string;
  connections: Connection[];
  provider: ProviderId;
  model: string;
  proposal: Proposal | null;
  participation: 'request' | 'suggest' | 'proactive';
  policy: 'preview' | 'apply';
  requests: number;
  toolCalls: number;
  tokens: number;
  changes: { revision: number; summary: string; origin: string }[];
  apply: (
    summary: string,
    commands: Command[],
    expectedRevision?: number,
    origin?: 'human' | 'agent' | 'rule',
  ) => boolean;
  undo: () => void;
  redo: () => void;
  select: (selection: Selection) => void;
  replaceProject: (p: Project, summary: string) => void;
  reset: (blank?: boolean) => void;
  save: () => Promise<void>;
  open: () => Promise<void>;
  run: (simulate?: boolean, origin?: 'human' | 'agent') => Promise<void>;
  cancelBuild: () => void;
  dismissNotice: () => void;
}
let recoveryNotice: string | null = null;
function load(): Project {
  try {
    const text = localStorage.getItem('trace.draft.v1');
    if (text) {
      try {
        return parseProject(text);
      } catch {
        localStorage.setItem('trace.recovery.v1', text);
        recoveryNotice =
          'The autosaved project could not be opened. Its original data is preserved as trace.recovery.v1 in local workspace storage.';
      }
    }
  } catch {}
  return exampleProject();
}
function loadSession(): Partial<State> {
  try {
    const raw = JSON.parse(localStorage.getItem('trace.session.v1') ?? 'null');
    if (!raw || typeof raw !== 'object') return {};
    return {
      messages: Array.isArray(raw.messages)
        ? raw.messages
            .filter(
              (m: any) =>
                ['user', 'assistant', 'activity'].includes(m.role) &&
                typeof m.id === 'string' &&
                typeof m.text === 'string',
            )
            .slice(-40)
        : [],
      participation: ['request', 'suggest', 'proactive'].includes(raw.participation)
        ? raw.participation
        : 'suggest',
      policy: raw.policy === 'preview' ? 'preview' : 'apply',
      provider: ['gemini', 'openai', 'anthropic', 'xai'].includes(raw.provider)
        ? raw.provider
        : 'gemini',
      changes: Array.isArray(raw.changes) ? raw.changes.slice(-30) : [],
    };
  } catch {
    return {};
  }
}
const initial = load();
try {
  localStorage.setItem('trace.draft.v1', serializeProject(initial));
} catch {}
const session = loadSession();
let savedLimits: unknown;
try {
  savedLimits = JSON.parse(
    localStorage.getItem(agentSettingsStorageKey) ??
      localStorage.getItem('trace.agent-limits.v1') ??
      'null',
  );
} catch {}
const agentLimits = migrateAgentSettings(savedLimits);
localStorage.setItem(agentSettingsStorageKey, JSON.stringify({ version: 2, limits: agentLimits }));
let lastEditTime = 0;
let checkTimer: ReturnType<typeof setTimeout> | undefined;
export const useWorkspace = create<State>((set, get) => ({
  agentDraft: '',
  dismissedSuggestions: [],
  agentLimits,
  agentTrace: [],
  agentResumeAvailable: false,
  pendingDiagnostic: null,
  workspace: 'prototype',
  project: initial,
  history: emptyHistory(),
  selection: null,
  view: 'wiring',
  activeFileId: initial.files[0].id,
  diagnostics: validateCircuit(initial),
  checksPending: false,
  library: false,
  settings: false,
  outputOpen: false,
  outputTab: 'diagnostics',
  notice: recoveryNotice,
  result: null,
  building: false,
  buildRequestId: null,
  buildOrigin: 'human',
  capabilities: { desktop: !!window.trace, arduino: false, simavr: false },
  messages: session.messages ?? [],
  agentBusy: false,
  agentStatus: '',
  connections: [],
  provider: session.provider ?? 'gemini',
  model: 'gemini-3.5-flash-lite',
  proposal: null,
  participation: session.participation ?? 'suggest',
  policy: session.policy ?? 'apply',
  requests: 0,
  toolCalls: 0,
  tokens: 0,
  changes: session.changes ?? [],
  apply: (summary, commands, expectedRevision, origin = 'human') => {
    const s = get();
    try {
      const project = transact(s.project, {
        expectedRevision: expectedRevision ?? s.project.revision,
        summary,
        commands,
      });
      const now = Date.now();
      const typing =
        commands.length === 1 && commands[0].type === 'writeFile' && origin === 'human';
      const coalesce =
        typing && now - lastEditTime < 900 && s.history.past.at(-1)?.summary === summary;
      clearTimeout(checkTimer);
      set({
        project,
        history: coalesce ? s.history : record(s.history, s.project, summary),
        diagnostics: typing ? s.diagnostics : validateCircuit(project),
        checksPending: typing,
        changes: [...s.changes, { revision: project.revision, summary, origin }].slice(-30),
        notice: null,
      });
      if (typing)
        checkTimer = setTimeout(
          () => set({ diagnostics: validateCircuit(get().project), checksPending: false }),
          650,
        );
      lastEditTime = typing ? now : 0;
      return true;
    } catch (e) {
      set({ notice: e instanceof Error ? e.message : 'Change rejected' });
      return false;
    }
  },
  undo: () => {
    clearTimeout(checkTimer);
    const s = get(),
      v = travel(s.project, s.history, 'undo');
    set({
      ...v,
      diagnostics: validateCircuit(v.project),
      checksPending: false,
      selection: null,
      proposal: null,
      changes: [
        ...s.changes,
        { revision: v.project.revision, summary: 'Undo', origin: 'human' },
      ].slice(-30),
    });
    lastEditTime = 0;
  },
  redo: () => {
    clearTimeout(checkTimer);
    const s = get(),
      v = travel(s.project, s.history, 'redo');
    set({
      ...v,
      diagnostics: validateCircuit(v.project),
      checksPending: false,
      selection: null,
      proposal: null,
      changes: [
        ...s.changes,
        { revision: v.project.revision, summary: 'Redo', origin: 'human' },
      ].slice(-30),
    });
    lastEditTime = 0;
  },
  select: (selection) => set({ selection }),
  replaceProject: (p, summary) => {
    clearTimeout(checkTimer);
    const s = get();
    const project = { ...p, revision: s.project.revision + 1 };
    set({
      project,
      history: record(s.history, s.project, summary),
      diagnostics: validateCircuit(project),
      checksPending: false,
      selection: null,
      proposal: null,
      activeFileId: project.files[0].id,
      result: null,
      changes: [{ revision: project.revision, summary, origin: 'human' }],
    });
  },
  reset: (blank) =>
    get().replaceProject(
      blank ? blankProject() : exampleProject(),
      blank ? 'New blank project' : 'Reset indicator example',
    ),
  save: async () => {
    try {
      if (window.trace) {
        const r = await window.trace.saveProject(get().project);
        if (!r.cancelled) set({ notice: `Saved ${r.name}` });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(
          new Blob([serializeProject(get().project)], { type: 'application/json' }),
        );
        a.download = 'project.trace.json';
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } catch (e) {
      set({ notice: `Save failed: ${String(e)}` });
    }
  },
  open: async () => {
    try {
      if (window.trace) {
        const r = await window.trace.openProject();
        if (r.project) get().replaceProject(r.project, 'Open project');
      } else {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async () => {
          try {
            const f = input.files?.[0];
            if (f) get().replaceProject(parseProject(await f.text()), 'Open project');
          } catch (e) {
            set({ notice: `Cannot open project: ${String(e)}` });
          }
        };
        input.click();
      }
    } catch (e) {
      set({ notice: `Cannot open project: ${String(e)}` });
    }
  },
  run: async (simulate = false, origin = 'human') => {
    const s = get();
    if (s.building) return;
    if (!window.trace) {
      set({ notice: 'Compile and execution require the desktop application.' });
      return;
    }
    const requestId = crypto.randomUUID();
    set({
      building: true,
      buildRequestId: requestId,
      buildOrigin: origin,
      outputOpen: true,
      outputTab: simulate ? 'simulation' : 'build',
    });
    try {
      const result = await window.trace.build({ project: s.project, requestId, simulate });
      set({ result });
    } catch (e) {
      set({
        result: {
          revision: s.project.revision,
          kind: simulate ? 'simulation' : 'build',
          success: false,
          output: String(e),
          durationMs: 0,
        },
      });
    } finally {
      set({ building: false, buildRequestId: null });
    }
  },
  cancelBuild: () => {
    const id = get().buildRequestId;
    if (id) void window.trace?.cancel(id);
  },
  dismissNotice: () => set({ notice: null }),
}));
useWorkspace.subscribe((s, previous) => {
  try {
    if (s.agentLimits !== previous.agentLimits)
      localStorage.setItem(
        agentSettingsStorageKey,
        JSON.stringify({ version: 2, limits: s.agentLimits }),
      );
    if (s.project !== previous.project)
      localStorage.setItem('trace.draft.v1', serializeProject(s.project));
    localStorage.setItem(
      'trace.session.v1',
      JSON.stringify({
        messages: s.messages
          .slice(-40)
          .map((m) => ({ ...m, text: m.text.slice(0, 8000), details: undefined })),
        provider: s.provider,
        participation: s.participation,
        policy: s.policy,
        changes: s.changes.slice(-30),
      }),
    );
  } catch {}
});
if (window.trace) {
  void window.trace
    .capabilities()
    .then((capabilities) => {
      useWorkspace.setState({ capabilities });
      if (capabilities.evaluation)
        (window as any).traceEvaluation = {
          reset(project: Project) {
            const p = parseProject(JSON.stringify(project));
            useWorkspace.getState().replaceProject(p, 'Evaluation seed');
            useWorkspace.setState({
              messages: [],
              policy: 'apply',
              provider: 'gemini',
              requests: 0,
              toolCalls: 0,
              tokens: 0,
              agentTrace: [],
            });
          },
          snapshot() {
            const s = useWorkspace.getState();
            return {
              project: s.project,
              messages: s.messages,
              result: s.result,
              busy: s.agentBusy,
              requests: s.requests,
              tools: s.toolCalls,
              tokens: s.tokens,
              trace: s.agentTrace,
              limits: s.agentLimits,
              connections: s.connections,
              model: s.model,
              resumeAvailable: s.agentResumeAvailable,
            };
          },
          configure(options: Partial<State>) {
            const allowed = {
              ...(options.model ? { model: options.model } : {}),
              ...(options.agentLimits
                ? { agentLimits: AgentLimitsSchema.parse(options.agentLimits) }
                : {}),
            };
            useWorkspace.setState(allowed);
          },
          start(goal: string) {
            window.dispatchEvent(new CustomEvent('trace:agent-request', { detail: goal }));
          },
        };
    })
    .catch(() => {});
  void window.trace
    .connections()
    .then((connections) =>
      useWorkspace.setState((s) => ({
        connections,
        model: connections.find((c) => c.provider === s.provider)?.model ?? s.model,
      })),
    )
    .catch(() =>
      useWorkspace.setState({
        notice:
          'AI connections could not be read; stored keys were preserved. Manual editing remains available.',
      }),
    );
}
export const uid = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
export const selectedIds = (s: Selection) =>
  !s
    ? []
    : s.kind === 'diagnostic'
      ? s.objectIds
      : s.kind === 'terminal'
        ? [s.endpoint.componentId, s.id]
        : [s.id];
