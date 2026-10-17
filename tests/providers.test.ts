import { describe, it, expect } from 'vitest';
import { StreamAccumulator, providerPayload, readSSE, callProvider } from '../desktop/providers';
import type { ProviderId, ProviderRequest } from '../src/services/bridge';
const req = (provider: ProviderId): ProviderRequest => ({
  provider,
  model: 'fixture-model',
  system: 'system',
  messages: [{ role: 'user', text: 'inspect' }],
  maxTokens: 100,
  requestId: 'e15653fa-2af9-4357-8c40-8da741ba1a28',
});
describe('real provider protocol contracts (fixtures, not live verification)', () => {
  it('preserves Gemini thought signatures and tool responses', () => {
    const a = new StreamAccumulator('gemini');
    a.push({
      candidates: [
        {
          content: {
            parts: [
              { text: 'Inspecting.' },
              {
                functionCall: { id: 'g1', name: 'inspect_project', args: { section: 'summary' } },
                thoughtSignature: 'opaque-signature',
              },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 12, thoughtsTokenCount: 8 },
    });
    a.push({ candidates: [{ finishReason: 'STOP' }] });
    const r = a.finish();
    expect(r.usage).toEqual({ input: 30, output: 20 });
    expect(r.calls[0].arguments).toEqual({ section: 'summary' });
    const p = providerPayload({
      ...req('gemini'),
      messages: [
        { role: 'user', text: 'inspect' },
        { role: 'assistant', native: r.native },
        { role: 'tool', call: r.calls[0], result: { revision: 1 } },
      ],
    });
    expect(JSON.stringify(p.body)).toContain('opaque-signature');
    expect(JSON.stringify(p.body)).toContain('functionResponse');
    expect(p.header).toBe('x-goog-api-key');
  });
  it('assembles Claude partial JSON and translates tool_result as user content', () => {
    const a = new StreamAccumulator('anthropic');
    a.push({ type: 'message_start', message: { usage: { input_tokens: 24 } } });
    a.push({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'a1', name: 'run_checks', input: {} },
    });
    a.push({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{' },
    });
    a.push({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '}' },
    });
    a.push({ type: 'message_delta', usage: { output_tokens: 10 } });
    a.push({ type: 'message_stop' });
    const r = a.finish();
    const p = providerPayload({
      ...req('anthropic'),
      messages: [
        { role: 'user', text: 'check' },
        { role: 'assistant', native: r.native },
        { role: 'tool', call: r.calls[0], result: { ok: true } },
      ],
    });
    expect((p.body as any).messages.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'a1', content: '{"ok":true}' }],
    });
    expect(r.usage).toEqual({ input: 24, output: 10 });
  });
  for (const provider of ['openai', 'xai'] as const)
    it(`${provider} reconstructs fragmented tool calls and usage`, () => {
      const a = new StreamAccumulator(provider);
      a.push({
        choices: [
          {
            delta: {
              content: 'Checking ',
              tool_calls: [
                {
                  index: 0,
                  id: 'o1',
                  function: { name: 'inspect_project', arguments: '{"section":' },
                },
              ],
            },
          },
        ],
      });
      a.push({
        choices: [
          {
            delta: {
              content: 'now.',
              tool_calls: [{ index: 0, function: { arguments: '"summary"}' } }],
            },
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 9 },
      });
      a.push({ choices: [{ finish_reason: 'tool_calls' }] });
      const r = a.finish();
      expect(r.text).toBe('Checking now.');
      expect(r.calls[0]).toEqual({
        id: 'o1',
        name: 'inspect_project',
        arguments: { section: 'summary' },
      });
      const p = providerPayload({
        ...req(provider),
        messages: [
          { role: 'user', text: 'check' },
          { role: 'assistant', native: r.native },
          { role: 'tool', call: r.calls[0], result: { revision: 2 } },
        ],
      });
      expect((p.body as any).messages.at(-1).tool_call_id).toBe('o1');
      expect(p.url).toContain(provider === 'openai' ? 'api.openai.com' : 'api.x.ai');
    });
  it('reads SSE split across network chunks', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"n":'));
        c.enqueue(new TextEncoder().encode('1}\n\ndata: [DONE]\n\n'));
        c.close();
      },
    });
    const values = [];
    for await (const v of readSSE(new Response(stream), new AbortController().signal))
      values.push(v);
    expect(values).toEqual([{ n: 1 }]);
  });
  it('keeps API keys in headers for one selected provider and sanitizes errors', async () => {
    let captured: any;
    const fetcher = async (url: any, options: any) => {
      captured = { url, options };
      return new Response('DO NOT EXPOSE SECRET_FIXTURE', { status: 401 });
    };
    await expect(
      callProvider(
        req('anthropic'),
        'SECRET_FIXTURE',
        new AbortController().signal,
        () => {},
        fetcher as typeof fetch,
      ),
    ).rejects.toThrow('Key rejected');
    expect(captured.options.headers['x-api-key']).toBe('SECRET_FIXTURE');
    expect(captured.options.body).not.toContain('SECRET_FIXTURE');
    expect(captured.options.headers.Authorization).toBeUndefined();
  });
  it('passes cancellation to the request without fallback', async () => {
    const c = new AbortController();
    c.abort();
    let count = 0;
    const fetcher = async (_url: any, options: any) => {
      count++;
      expect(options.signal.aborted).toBe(true);
      throw new Error('secret transport details');
    };
    await expect(
      callProvider(req('gemini'), 'SECRET_FIXTURE', c.signal, () => {}, fetcher as typeof fetch),
    ).rejects.toThrow('cancelled');
    expect(count).toBe(1);
  });
  it('rejects truncated tool output before mutation', () => {
    const a = new StreamAccumulator('gemini');
    a.push({
      candidates: [
        {
          finishReason: 'MAX_TOKENS',
          content: { parts: [{ functionCall: { name: 'project_changes', args: {} } }] },
        },
      ],
    });
    expect(() => a.finish()).toThrow('output limit');
  });
});
