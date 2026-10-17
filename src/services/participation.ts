export type ParticipationMode = 'request' | 'suggest' | 'proactive';
export const limits = {
  requests: 6,
  tools: 20,
  reportedTokens: 24000,
  outputTokens: 2048,
  durationMs: 90000,
  cooldownMs: 60000,
} as const;
export class TaskBudget {
  requests = 0;
  tools = 0;
  tokens = 0;
  cancelled = false;
  started: number;
  constructor(private now: () => number = Date.now) {
    this.started = now();
  }
  check() {
    if (this.cancelled) throw new Error('Task cancelled');
    if (this.now() - this.started >= limits.durationMs) throw new Error('Task time limit reached');
    if (this.requests >= limits.requests) throw new Error('Model request limit reached');
    if (this.tools >= limits.tools) throw new Error('Tool limit reached');
    if (this.tokens >= limits.reportedTokens)
      throw new Error('Reported token threshold reached; task paused');
  }
  request() {
    this.check();
    this.requests++;
  }
  tool() {
    if (this.cancelled) throw new Error('Task cancelled');
    if (this.now() - this.started >= limits.durationMs) throw new Error('Task time limit reached');
    if (this.tools >= limits.tools) throw new Error('Tool limit reached');
    this.tools++;
  }
  usage(input: number, output: number) {
    this.tokens += Math.max(0, input) + Math.max(0, output);
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
