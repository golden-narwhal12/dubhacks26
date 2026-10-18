import { describe, it, expect } from 'vitest';
import {
  TaskBudget,
  ParticipationController,
  limits,
  type ParticipationEvent,
  buildIssueId,
} from '../src/services/participation';
import { exampleProject } from '../src/domain/example';
describe('zero-call local participation and bounded active tasks', () => {
  const event: ParticipationEvent = {
    type: 'failed-build',
    revision: 4,
    issue: 'compile error',
    origin: 'tool',
    taskId: 'task',
  };
  it('ordinary edits, checks, suggestions, layout and idle cause zero requests', () => {
    const p = new ParticipationController(),
      b = new TaskBudget();
    for (const mode of ['request', 'suggest', 'proactive'] as const)
      for (const type of ['edit', 'selection', 'layout', 'idle', 'suggestion'] as const)
        expect(p.eligible({ ...event, type }, mode, true, 'task', b)).toBe(false);
    expect(b.requests).toBe(0);
  });
  it('requires explicit active task, settings, key and budget; deduplicates/cools down', () => {
    let now = 0;
    const p = new ParticipationController(() => now),
      b = new TaskBudget(() => now);
    expect(p.eligible(event, 'suggest', true, 'task', b)).toBe(false);
    expect(p.eligible(event, 'proactive', false, 'task', b)).toBe(false);
    expect(p.eligible(event, 'proactive', true, null, b)).toBe(false);
    expect(p.eligible({ ...event, origin: 'agent' }, 'proactive', true, 'task', b)).toBe(false);
    expect(p.eligible(event, 'proactive', true, 'task', b)).toBe(true);
    expect(p.eligible(event, 'proactive', true, 'task', b)).toBe(false);
    expect(p.eligible({ ...event, revision: 5 }, 'proactive', true, 'task', b)).toBe(false);
    now = 60001;
    expect(p.eligible({ ...event, revision: 5 }, 'proactive', true, 'task', b)).toBe(false);
    expect(
      p.eligible(
        { ...event, revision: 5, issue: 'changed compile error' },
        'proactive',
        true,
        'task',
        b,
      ),
    ).toBe(true);
    p.dismiss('other');
    now = 120002;
    const newBudget = new TaskBudget(() => now);
    expect(p.eligible({ ...event, issue: 'other' }, 'proactive', true, 'task', newBudget)).toBe(
      false,
    );
  });
  it('deduplicates build failures across layout-only revisions but invalidates firmware changes', () => {
    const p = exampleProject(),
      r = {
        revision: 0,
        success: false,
        kind: 'build' as const,
        output: 'error: missing symbol',
        durationMs: 10,
      };
    const before = buildIssueId(p, r);
    p.revision++;
    p.layouts.wiring.board.x += 100;
    expect(buildIssueId(p, { ...r, revision: p.revision })).toBe(before);
    p.files[0].content += '\n// new firmware';
    expect(buildIssueId(p, r)).not.toBe(before);
  });
  it('enforces request/tool/reported usage/time limits and cancellation', () => {
    const requests = new TaskBudget();
    for (let i = 0; i < limits.requests; i++) requests.request();
    expect(() => requests.request()).toThrow('request limit');
    const tools = new TaskBudget();
    for (let i = 0; i < limits.tools; i++) tools.tool();
    expect(() => tools.tool()).toThrow('Tool limit');
    const tokens = new TaskBudget();
    tokens.usage(limits.reportedTokens, 0);
    expect(() => tokens.request()).toThrow('token threshold');
    const cancelled = new TaskBudget();
    cancelled.cancel();
    expect(() => cancelled.request()).toThrow('cancelled');
    let now = 0;
    const time = new TaskBudget(() => now);
    now = limits.durationMs+1;
    expect(() => time.tool()).toThrow('time limit');
  });
});
