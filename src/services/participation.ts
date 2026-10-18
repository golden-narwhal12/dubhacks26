export type ParticipationMode = 'request' | 'suggest' | 'proactive';
import { defaultLimits, type AgentLimits } from './agentSettings';
export const limits = { ...defaultLimits, cooldownMs: 60000 };
export class TaskBudget {
  requests = 0;
  tools = 0;
  tokens = 0;
  cancelled = false;
  started: number;
  readonly limits: AgentLimits;
  private now: () => number;
  private responses = new Set<string>();
  constructor(nowOrLimits: (() => number) | AgentLimits = Date.now, now: () => number = Date.now) {
    this.now = typeof nowOrLimits === 'function' ? nowOrLimits : now;
    this.limits = typeof nowOrLimits === 'function' ? { ...defaultLimits } : { ...nowOrLimits };
    this.started = this.now();
  }
  check() {
    this.checkTool();
    if (this.requests >= this.limits.requests) throw new Error('Model request limit reached');
  }
  private checkTool() {
    if (this.cancelled) throw new Error('Task cancelled');
    if (this.now() - this.started >= this.limits.durationMs)
      throw new Error('Task time limit reached');
    if (this.tools >= this.limits.tools) throw new Error('Tool limit reached');
    if (this.tokens >= this.limits.reportedTokens)
      throw new Error('Reported token threshold reached');
  }
  request() {
    this.check();
    this.requests++;
  }
  tool() {
    this.checkTool();
    this.tools++;
  }
  usage(input: number | null, output: number | null, responseId?: string, total?: number | null) {
    if (responseId && this.responses.has(responseId)) return false;
    if (responseId) this.responses.add(responseId);
    const valid = (v: number | null | undefined) =>
      typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0;
    this.tokens += total != null ? valid(total) : valid(input) + valid(output);
    return true;
  }
  cancel() {
    this.cancelled = true;
  }
}
export interface ParticipationEvent {
  type: 'failed-build' | 'edit' | 'selection' | 'layout' | 'idle' | 'suggestion';
  revision: number;
  issue: string;
  origin: 'human' | 'agent' | 'tool';
  taskId?: string;
}
export class ParticipationController {
  private seen = new Set<string>();
  private dismissed = new Set<string>();
  private last = -Infinity;
  constructor(private now: () => number = Date.now) {}
  dismiss(issue: string) {
    this.dismissed.add(issue);
  }
  eligible(
    event: ParticipationEvent,
    mode: ParticipationMode,
    configured: boolean,
    activeTaskId: string | null,
    budget: TaskBudget,
  ): boolean {
    if (
      mode !== 'proactive' ||
      !configured ||
      !activeTaskId ||
      event.taskId !== activeTaskId ||
      event.type !== 'failed-build' ||
      event.origin !== 'tool'
    )
      return false;
    const key = event.issue;
    if (
      this.seen.has(key) ||
      this.dismissed.has(event.issue) ||
      this.now() - this.last < limits.cooldownMs
    )
      return false;
    try {
      budget.check();
    } catch {
      return false;
    }
    this.seen.add(key);
    this.last = this.now();
    return true;
  }
}
import type { Project } from '../domain/schema';
import type { RunResult } from './bridge';
export function buildIssueId(project: Project, result: RunResult) {
  const reason = result.output
    .split('\n')
    .filter((line) => /error:|unavailable|failed|exceeded/i.test(line))
    .slice(0, 5)
    .map((line) => line.replace(/\/[^\s:]+/g, '<path>'))
    .join('\n');
  const content = JSON.stringify([
    project.targetBoardId,
    project.files.map((f) => [f.id, f.path, f.content]),
    result.kind,
    reason,
  ]);
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) hash = Math.imul(hash ^ content.charCodeAt(i), 16777619);
  return `build:${project.id}:${(hash >>> 0).toString(16)}`;
}
