import { describe, it, expect } from 'vitest';
import { migrateAgentSettings, defaultLimits } from '../src/services/agentSettings';
import { TaskBudget } from '../src/services/participation';
import { normalizeUsage } from '../src/services/usage';
import { StreamAccumulator, readSSE } from '../desktop/providers';
import { inspectTool, toolDefinitions } from '../src/domain/tools';
import { blankProject } from '../src/domain/example';
import { transact } from '../src/domain/project';
import { agentInstructions, instructionVersion } from '../src/services/instructions';
describe('task settings, accounting and compact tool protocol', () => {
  it('retains reported usage on a malformed Gemini response without executing partial calls', () => {
    const stream = new StreamAccumulator('gemini');
    stream.push({
      candidates: [
        {
          content: {
            parts: [{ functionCall: { id: 'incomplete', name: 'project_changes', args: {} } }],
          },
          finishReason: 'MALFORMED_FUNCTION_CALL',
        },
      ],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 25, totalTokenCount: 125 },
    });
    expect(stream.finish()).toMatchObject({
      calls: [],
      recovery: { code: 'MALFORMED_FUNCTION_CALL' },
      usage: { total: 125 },
    });
  });
  it('migrates new profiles and indistinguishable old built-ins, preserving explicit custom values', () => {
    expect(migrateAgentSettings(null)).toEqual(defaultLimits);
    expect(migrateAgentSettings({ reportedTokens: 24000, requests: 6 })).toEqual(defaultLimits);
    expect(migrateAgentSettings({ reportedTokens: 55000, requests: 12 })).toMatchObject({
      reportedTokens: 55000,
      requests: 12,
    });
    expect(
      migrateAgentSettings({ version: 2, limits: { reportedTokens: 24000 } }).reportedTokens,
    ).toBe(24000);
    expect(
      migrateAgentSettings({ explicit: ['reportedTokens'], reportedTokens: 24000 }).reportedTokens,
    ).toBe(24000);
    expect(migrateAgentSettings({ reportedTokens: NaN }).reportedTokens).toBe(1_000_000);
  });
  it('counts cumulative Gemini usage once and keeps cached/reasoning components separate', () => {
    const a = new StreamAccumulator('gemini', () => {}, 'request-a');
    const usage = {
      promptTokenCount: 100,
      candidatesTokenCount: 20,
      thoughtsTokenCount: 10,
      totalTokenCount: 130,
      cachedContentTokenCount: 80,
    };
    a.push({ usageMetadata: usage });
    a.push({ usageMetadata: usage });
    a.push({ candidates: [{ finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 130 } });
    const r = a.finish();
    expect(r.usage).toMatchObject({
      input: 100,
      output: 30,
      total: 130,
      reasoning: 10,
      cachedInput: 80,
    });
    const b = new TaskBudget();
    expect(b.usage(r.usage.input, r.usage.output, 'request-a', r.usage.total)).toBe(true);
    expect(b.usage(100, 30, 'request-a', 130)).toBe(false);
    expect(b.tokens).toBe(130);
  });
  it('does not add OpenAI/xAI reasoning/cache breakdown twice or ignore Claude cache input', () => {
    expect(
      normalizeUsage('openai', {
        prompt_tokens: 50,
        completion_tokens: 30,
        total_tokens: 80,
        prompt_tokens_details: { cached_tokens: 20 },
        completion_tokens_details: { reasoning_tokens: 10 },
      }),
    ).toMatchObject({ input: 50, output: 30, total: 80 });
    expect(
      normalizeUsage('anthropic', {
        input_tokens: 5,
        cache_creation_input_tokens: 12,
        cache_read_input_tokens: 25,
        output_tokens: 8,
      }),
    ).toMatchObject({ input: 42, output: 8, total: 50 });
    expect(
      normalizeUsage('gemini', { promptTokenCount: -1, candidatesTokenCount: '500' }),
    ).toMatchObject({ input: null, output: null, total: null });
  });
  it('stops tools after a crossed threshold, independently of request limit', () => {
    const b = new TaskBudget({ ...defaultLimits, reportedTokens: 100 });
    b.request();
    b.usage(110, 20, 'r', 130);
    expect(() => b.tool()).toThrow('token threshold');
    const tools = new TaskBudget({ ...defaultLimits, requests: 1 });
    tools.request();
    expect(() => tools.tool()).not.toThrow();
    expect(() => tools.request()).toThrow('request limit');
  });
  it('deduplicates replayed Gemini call IDs, rejects conflicting IDs, preserves genuinely distinct IDs and signatures', () => {
    const a = new StreamAccumulator('gemini', () => {}, 'req');
    const part = {
      functionCall: { id: 'g1', name: 'inspect_project', args: { section: 'summary' } },
      thoughtSignature: 'signed',
    };
    a.push({ candidates: [{ content: { parts: [part] } }] });
    a.push({
      candidates: [
        {
          content: { parts: [part, { ...part, functionCall: { ...part.functionCall, id: 'g2' } }] },
          finishReason: 'STOP',
        },
      ],
    });
    const r = a.finish();
    expect(r.calls.map((c) => c.id)).toEqual(['g1', 'g2']);
    expect((r.native as any).parts).toHaveLength(2);
    expect(r.metadata?.duplicateCalls).toBe(1);
    const bad = new StreamAccumulator('gemini');
    bad.push({ candidates: [{ content: { parts: [part] } }] });
    expect(() =>
      bad.push({
        candidates: [
          {
            content: {
              parts: [{ functionCall: { ...part.functionCall, name: 'project_changes' } }],
            },
          },
        ],
      }),
    ).toThrow('Conflicting');
  });
  it('deduplicates SSE event identities while retaining distinct events', async () => {
    const stream = new Response(
      'id: 1\ndata: {"n":1}\n\nid: 1\ndata: {"n":1}\n\nid: 2\ndata: {"n":1}\n\n',
    );
    const out = [];
    for await (const e of readSSE(stream, new AbortController().signal)) out.push(e);
    expect(out).toHaveLength(2);
  });
  it('keeps part summaries bounded and numeric terminal IDs valid without relaxing component identities', () => {
    const summary = inspectTool('inspect_part', { partId: 'breadboard-830' }, blankProject());
    expect(JSON.stringify(summary).length).toBeLessThan(3000);
    expect((summary as any).assets).toBeUndefined();
    expect((summary as any).terminals).toBeUndefined();
    const p = transact(blankProject(), {
      expectedRevision: 0,
      summary: 'power terminals',
      commands: [
        {
          type: 'addComponent',
          component: {
            id: 'board',
            partId: 'arduino-mega-r3',
            partVersion: 1,
            ref: 'U1',
            config: {},
          },
          placement: { x: 0, y: 0, rotation: 0 },
        },
        {
          type: 'addComponent',
          component: {
            id: 'encoder',
            partId: 'as5600-module-photo',
            partVersion: 1,
            ref: 'U2',
            config: {},
          },
          placement: { x: 800, y: 0, rotation: 0 },
        },
        {
          type: 'connect',
          wire: {
            id: 'supply',
            from: { componentId: 'board', terminalId: '3v3' },
            to: { componentId: 'encoder', terminalId: 'vcc' },
          },
        },
      ],
    });
    expect(p.wires).toHaveLength(1);
    expect(
      inspectTool('inspect_part', { partId: 'arduino-mega-r3', terminalId: '5v' }, p),
    ).toMatchObject({ terminals: [{ id: '5v' }] });
  });
  it('exposes complete local contracts and a versioned implementation prompt', () => {
    for (const name of ['project_changes', 'inspect_diagnostics', 'run_verify', 'navigate'])
      expect(toolDefinitions.some((t) => t.name === name)).toBe(true);
    expect(agentInstructions).toContain(instructionVersion);
    expect(agentInstructions).toContain('IMPLEMENT');
    expect(agentInstructions).toContain('setTelemetry');
    expect(agentInstructions).toContain('No tool can approve itself');
  });
});
it('retains distinct calls without provider IDs while rejecting replayed identical function records within a response', () => {
  const a = new StreamAccumulator('gemini', () => {}, 'req-a');
  const p = { functionCall: { name: 'search_parts', args: { query: 'led' } } };
  a.push({ candidates: [{ content: { parts: [p] } }] });
  a.push({
    candidates: [
      {
        content: {
          parts: [p, { functionCall: { name: 'search_parts', args: { query: 'resistor' } } }],
        },
        finishReason: 'STOP',
      },
    ],
  });
  expect(a.finish().calls.map((c) => c.id)).toEqual(['req-a:call-0', 'req-a:call-1']);
});
it('validates explicit Mega analog aliases without treating A0 as a literal digital0', async () => {
  const { exampleProject } = await import('../src/domain/example');
  const { validateCircuit, pinConstantSpan } = await import('../src/domain/validation');
  const p = exampleProject();
  p.wires = p.wires.filter((w) => w.id !== 'signal');
  p.components.push({
    id: 'pot',
    partId: 'potentiometer-generic',
    partVersion: 1,
    ref: 'RV1',
    config: {},
  });
  for (const view of ['wiring', 'schematic'] as const)
    p.layouts[view].pot = { x: 900, y: 200, rotation: 0 };
  p.wires.push({
    id: 'wiper',
    from: { componentId: 'board', terminalId: 'a0' },
    to: { componentId: 'pot', terminalId: 'wiper' },
    color: 'mint',
  });
  p.files[0].content += '\nconst uint8_t POT_PIN = A0;\n';
  p.bindings = [
    {
      id: 'pot-bind',
      boardId: 'board',
      terminalId: 'a0',
      target: { componentId: 'pot', terminalId: 'wiper' },
      fileId: 'main',
      symbol: 'POT_PIN',
      mode: 'input',
    },
  ];
  expect(pinConstantSpan(p.files[0].content, 'POT_PIN')?.literal).toBe('A0');
  expect(validateCircuit(p).filter((d) => d.rule === 'binding.constant')).toHaveLength(0);
  p.files[0].content = p.files[0].content.replace('POT_PIN = A0', 'POT_PIN = A1');
  expect(validateCircuit(p).some((d) => d.id === 'mismatch-pot-bind')).toBe(true);
});
it('batches independent searches and supplies real small-part IDs instead of forcing pin guesses', () => {
  const parts = inspectTool(
    'search_parts',
    { queries: ['LED', 'resistor'] },
    blankProject(),
  ) as any[];
  expect(parts.find((p) => p.id === 'generic-led').terminals.map((t: any) => t.id)).toEqual([
    'a',
    'k',
  ]);
  expect(parts.find((p) => p.id === 'generic-resistor').terminals.map((t: any) => t.id)).toEqual([
    'p1',
    'p2',
  ]);
  expect(new Set(parts.map((p) => p.id)).size).toBe(parts.length);
});
it('surfaces unverified servo power, encoder logic and literal telemetry mismatches without claiming physical proof', async () => {
  const { exampleProject } = await import('../src/domain/example');
  const { validateCircuit } = await import('../src/domain/validation');
  const p = exampleProject();
  for (const [id, partId] of [
    ['servo', 'sg90-generic'],
    ['encoder', 'as5600-module-photo'],
  ]) {
    p.components.push({ id, partId, partVersion: 1, ref: id, config: {} });
    for (const v of ['wiring', 'schematic'] as const)
      p.layouts[v][id] = { x: 900, y: 500, rotation: 0 };
  }
  for (const [id, a, b] of [
    ['servo-supply', 'board:5v', 'servo:power'],
    ['enc-data', 'board:sda', 'encoder:sda'],
    ['cmd', 'board:d9', 'servo:signal'],
  ]) {
    const ep = (s: string) => {
      const [componentId, terminalId] = s.split(':');
      return { componentId, terminalId };
    };
    p.wires.push({ id, from: ep(a), to: ep(b), color: 'mint' });
  }
  p.files[0].content +=
    '\nvoid reportCommand(){Serial.print("command_deg:");Serial.println(90);}\n';
  p.telemetry = [
    {
      id: 'command',
      label: 'Commanded position',
      parser: 'keyvalue',
      field: 'command_deg',
      componentId: 'board',
      terminalId: 'd9',
      units: 'deg',
      meaning: 'command',
      staleAfterMs: 3000,
    },
  ];
  const rules = validateCircuit(p);
  for (const rule of [
    'servo.supply-capacity',
    'encoder.bus-interface',
    'telemetry.literal-format',
    'telemetry.component-association',
  ])
    expect(rules.some((d) => d.rule === rule)).toBe(true);
  p.files[0].content = p.files[0].content.replace('command_deg:', 'command_deg=');
  expect(validateCircuit(p).some((d) => d.rule === 'telemetry.literal-format')).toBe(false);
  expect(rules.find((d) => d.rule === 'servo.supply-capacity')?.severity).toBe('warning');
});
it('requests Gemini constrained function schema decoding while retaining natural answers', async () => {
  const { providerPayload } = await import('../desktop/providers');
  const { systemInstructions } = await import('../src/services/instructions');
  const p = providerPayload({
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    system: systemInstructions,
    messages: [{ role: 'user', text: 'Explain the project' }],
    maxTokens: 8192,
    requestId: crypto.randomUUID(),
  });
  expect(p.body).toMatchObject({ toolConfig: { functionCallingConfig: { mode: 'VALIDATED' } } });
});
it('offers an atomic source-assumption-based LED limiting fix and leaves unrelated topologies alone', async () => {
  const { freshSeed } = await import('../src/evaluation/cases');
  const { validateCircuit } = await import('../src/domain/validation');
  const p = freshSeed('repair-led');
  const d = validateCircuit(p).find((d) => d.id === 'led-resistor-led')!;
  expect(d.fix).toBeDefined();
  const next = transact(p, {
    expectedRevision: p.revision,
    summary: d.fix!.summary,
    commands: d.fix!.commands,
  });
  expect(next.components.find((c) => c.partId === 'generic-resistor')?.config.resistanceOhms).toBe(
    330,
  );
  expect(
    validateCircuit(next).filter(
      (d) =>
        d.rule === 'led.series-resistor' ||
        d.rule === 'led.resistor-bypass' ||
        (d.rule === 'led.nominal-estimate' && d.severity === 'warning'),
    ),
  ).toHaveLength(0);
  expect(next.files).toEqual(p.files);
  const unrelated = freshSeed('repair-led');
  unrelated.wires = unrelated.wires.filter((w) => w.id !== 'return');
  expect(validateCircuit(unrelated).find((d) => d.id === 'led-resistor-led')?.fix).toBeUndefined();
});
