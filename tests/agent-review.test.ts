import { describe, expect, it } from 'vitest';
import { callProvider, readSSE } from '../desktop/providers';
import { TaskBudget, limits } from '../src/services/participation';
import type { ProviderRequest } from '../src/services/bridge';

describe('agent review regressions', () => {
  it('reads SSE when CRLF boundaries are split between network chunks', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of ['data: {"n":1}\r', '\n\r', '\ndata: {"n":2}\r', '\n\r', '\n']) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
    const values: unknown[] = [];
    for await (const value of readSSE(new Response(stream), new AbortController().signal))
      values.push(value);
    expect(values).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('pauses further model requests when the task tool allowance is exhausted', () => {
    const budget = new TaskBudget();
    budget.request();
    for (let i = 0; i < limits.tools; i++) budget.tool();
    expect(() => budget.request()).toThrow(/tool limit/i);
    expect(budget.requests).toBe(1);
  });

  it('rejects an unterminated provider stream before returning actionable tool calls', async () => {
    const request: ProviderRequest = {
      provider: 'openai',
      model: 'fixture-model',
      system: 'system',
      maxTokens: 100,
      messages: [{ role: 'user', text: 'Inspect the project' }],
      requestId: 'e15653fa-2af9-4357-8c40-8da741ba1a28',
    };
    const event = {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call-1',
                function: { name: 'inspect_project', arguments: '{"section":"summary"}' },
              },
            ],
          },
        },
      ],
    };
    const fetcher = async () => new Response(`data: ${JSON.stringify(event)}\n\n`);
    await expect(
      callProvider(
        request,
        'FIXTURE_SECRET',
        new AbortController().signal,
        () => {},
        fetcher as typeof fetch,
      ),
    ).rejects.toThrow(/incomplete|terminat|finish|stream/i);
  });
});
