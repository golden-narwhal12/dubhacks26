import { z } from 'zod';
import { stableKey } from '../src/domain/semantics';
import { normalizeUsage, type NormalizedUsage } from '../src/services/usage';
import { toolDefinitions } from '../src/domain/tools';
import type {
  ProviderId,
  ProviderRequest,
  TurnResult,
  ChatTurn,
  ToolCall,
} from '../src/services/bridge';

export const ProviderSchema = z.enum(['gemini', 'openai', 'anthropic', 'xai']);
export const ModelSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9._:-]+$/);
export const ProviderRequestSchema = z
  .object({
    provider: ProviderSchema,
    model: ModelSchema,
    system: z.string().max(24000),
    messages: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant', 'tool']),
            text: z.string().max(120000).optional(),
            call: z.any().optional(),
            result: z.unknown().optional(),
            native: z.unknown().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(300),
    maxTokens: z.number().int().min(1).max(32768),
    requestId: z.string().uuid(),
  })
  .strict();
function mergeMessage(list: any[], role: string, content: any[]) {
  const last = list.at(-1);
  if (last?.role === role && Array.isArray(last.content)) last.content.push(...content);
  else list.push({ role, content });
}
export function providerPayload(req: ProviderRequest) {
  const tools = toolDefinitions;
  if (req.provider === 'gemini') {
    const contents: any[] = [];
    for (const m of req.messages) {
      if (m.role === 'assistant' && m.native) {
        contents.push(m.native);
        continue;
      }
      const role = m.role === 'assistant' ? 'model' : 'user';
      const parts =
        m.role === 'tool'
          ? [
              {
                functionResponse: {
                  name: m.call!.name,
                  id: m.call!.id,
                  response: { result: m.result },
                },
              },
            ]
          : [{ text: m.text ?? '' }];
      if (contents.at(-1)?.role === role) contents.at(-1).parts.push(...parts);
      else contents.push({ role, parts });
    }
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`,
      body: {
        systemInstruction: { parts: [{ text: req.system }] },
        contents,
        tools: [
          {
            functionDeclarations: tools
              .filter((t) => t.name !== 'project_changes')
              .map((t) => ({
                name: t.name,
                description: t.description,
                parametersJsonSchema: t.parameters,
              })),
          },
        ],
        toolConfig: { functionCallingConfig: { mode: 'VALIDATED' } },
        generationConfig: {
          maxOutputTokens: req.maxTokens,
          temperature: 0.25,
          ...(req.model === 'gemini-2.5-flash' ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      },
      header: 'x-goog-api-key',
    };
  }
  if (req.provider === 'anthropic') {
    const messages: any[] = [];
    for (const m of req.messages) {
      if (m.role === 'assistant' && m.native) {
        messages.push({ role: 'assistant', content: m.native });
        continue;
      }
      if (m.role === 'tool')
        mergeMessage(messages, 'user', [
          { type: 'tool_result', tool_use_id: m.call!.id, content: JSON.stringify(m.result) },
        ]);
      else mergeMessage(messages, m.role, [{ type: 'text', text: m.text ?? '' }]);
    }
    return {
      url: 'https://api.anthropic.com/v1/messages',
      body: {
        model: req.model,
        system: req.system,
        messages,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
        stream: true,
        max_tokens: req.maxTokens,
      },
      header: 'x-api-key',
    };
  }
  const messages: any[] = [{ role: 'system', content: req.system }];
  for (const m of req.messages) {
    if (m.role === 'assistant' && m.native) {
      messages.push(m.native);
      continue;
    }
    if (m.role === 'tool')
      messages.push({ role: 'tool', tool_call_id: m.call!.id, content: JSON.stringify(m.result) });
    else messages.push({ role: m.role, content: m.text ?? '' });
  }
  const base = {
    model: req.model,
    messages,
    tools: tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
    stream: true,
    stream_options: { include_usage: true },
  };
  return {
    url:
      req.provider === 'openai'
        ? 'https://api.openai.com/v1/chat/completions'
        : 'https://api.x.ai/v1/chat/completions',
    body:
      req.provider === 'openai'
        ? { ...base, max_completion_tokens: req.maxTokens }
        : { ...base, max_tokens: req.maxTokens },
    header: 'Authorization',
  };
}

export async function* readSSE(response: Response, signal: AbortSignal) {
  if (!response.body) throw new Error('Provider returned an empty stream');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  const seenEvents = new Set<string>();
  let buffer = '',
    bytes = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error('Task cancelled');
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1500000) throw new Error('Provider response exceeds the 1.5 MB bound');
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = block
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        const eventId = block
          .split('\n')
          .find((l) => l.startsWith('id:'))
          ?.slice(3)
          .trim();
        if (eventId && seenEvents.has(eventId)) continue;
        if (eventId) seenEvents.add(eventId);
        if (data && data !== '[DONE]') yield JSON.parse(data);
      }
    }
    if (buffer.trim()) {
      const data = buffer
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (data && data !== '[DONE]') yield JSON.parse(data);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export class StreamAccumulator {
  text = '';
  input: number | null = null;
  output: number | null = null;
  private usageRaw: Record<string, any> = {};
  private events = 0;
  private duplicateCalls = 0;
  private responseId: string | undefined;
  private finishReason: string | undefined;
  private geminiIdentities = new Map<string, string>();
  private calls = new Map<number, any>();
  private geminiParts: any[] = [];
  private blocks: any[] = [];
  private blocked = '';
  private complete = false;
  constructor(
    private provider: ProviderId,
    private onText: (text: string) => void = () => {},
    private requestId: string = crypto.randomUUID(),
  ) {}
  private append(text: string) {
    this.text += text;
    if (text) this.onText(text);
  }
  push(chunk: any) {
    this.events++;
    this.responseId = chunk.responseId ?? chunk.id ?? this.responseId;
    if (chunk.error) throw new Error('Provider stream failed');
    if (this.provider === 'gemini') {
      const candidate = chunk.candidates?.[0];
      if (candidate?.finishReason) {
        this.complete = true;
        this.finishReason = candidate.finishReason;
      }
      if (chunk.promptFeedback?.blockReason) this.blocked = 'Request blocked by provider';
      if (candidate?.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason))
        this.blocked = `Provider stopped: ${candidate.finishReason}`;
      if (candidate?.finishReason === 'MAX_TOKENS')
        this.blocked = 'Response reached output limit; reduce scope and retry';
      for (const part of candidate?.content?.parts ?? []) {
        if (part.functionCall) {
          const f = part.functionCall,
            signature = stableKey([f.name, f.args ?? {}]);
          const identity = f.id ? `id:${f.id}` : `content:${signature}`;
          const previous = this.geminiIdentities.get(identity);
          if (previous !== undefined) {
            if (previous !== signature) throw new Error('Conflicting replayed Gemini tool-call ID');
            this.duplicateCalls++;
            continue;
          }
          this.geminiIdentities.set(identity, signature);
          const i = this.calls.size;
          this.calls.set(i, {
            id: f.id ?? `${this.requestId}:call-${i}`,
            name: f.name,
            args: f.args ?? {},
          });
        }
        this.geminiParts.push(part);
        if (part.text && !part.thought) this.append(part.text);
      }
      if (chunk.usageMetadata) this.usageRaw = { ...this.usageRaw, ...chunk.usageMetadata };
    } else if (this.provider === 'anthropic') {
      if (chunk.type === 'message_stop') this.complete = true;
      if (chunk.type === 'message_start') {
        this.usageRaw = { ...this.usageRaw, ...chunk.message?.usage };
      }
      if (chunk.type === 'content_block_start') {
        this.blocks[chunk.index] = { ...chunk.content_block };
        if (chunk.content_block.type === 'tool_use')
          this.calls.set(chunk.index, {
            id: chunk.content_block.id,
            name: chunk.content_block.name,
            raw: '',
            args: chunk.content_block.input,
          });
      }
      if (chunk.type === 'content_block_delta') {
        const d = chunk.delta,
          b = this.blocks[chunk.index];
        if (d.type === 'text_delta') {
          this.append(d.text);
          if (b) b.text = (b.text ?? '') + d.text;
        }
        if (d.type === 'input_json_delta') {
          const call = this.calls.get(chunk.index);
          if (call) call.raw += d.partial_json;
        }
      }
      if (chunk.type === 'message_delta') {
        this.usageRaw = { ...this.usageRaw, ...chunk.usage };
        if (chunk.delta?.stop_reason === 'max_tokens')
          this.blocked = 'Response reached output limit; reduce scope and retry';
      }
    } else {
      const choice = chunk.choices?.[0],
        d = choice?.delta;
      if (d?.content) this.append(d.content);
      for (const t of d?.tool_calls ?? []) {
        const existing = this.calls.get(t.index) ?? { id: '', name: '', raw: '' };
        if (t.id) existing.id = t.id;
        if (t.function?.name) existing.name += t.function.name;
        if (t.function?.arguments) existing.raw += t.function.arguments;
        this.calls.set(t.index, existing);
      }
      if (chunk.usage) {
        this.usageRaw = { ...this.usageRaw, ...chunk.usage };
      }
      if (choice?.finish_reason) this.complete = true;
      if (choice?.finish_reason === 'length')
        this.blocked = 'Response reached output limit; reduce scope and retry';
    }
  }
  finish(): TurnResult {
    if (this.blocked.includes('MALFORMED_FUNCTION_CALL'))
      return {
        text: '',
        calls: [],
        native: undefined,
        usage: normalizeUsage(this.provider, this.usageRaw),
        recovery: {
          code: 'MALFORMED_FUNCTION_CALL',
          message: 'Provider generated an invalid tool call. No tools from this response executed.',
        },
        metadata: {
          requestId: this.requestId,
          responseId: this.responseId,
          events: this.events,
          duplicateCalls: this.duplicateCalls,
          finishReason: this.finishReason,
        },
      };
    if (this.blocked) throw new Error(this.blocked);
    if (!this.complete)
      throw new Error(
        'Provider stream ended before its completion event; pending tools were not executed',
      );
    const calls: ToolCall[] = [...this.calls.values()].map((c) => ({
      id: c.id,
      name: c.name,
      arguments: c.raw ? JSON.parse(c.raw) : (c.args ?? {}),
    }));
    if (calls.length > 20) throw new Error('Too many provider tool calls');
    let native: unknown;
    if (this.provider === 'gemini') native = { role: 'model', parts: this.geminiParts };
    else if (this.provider === 'anthropic') {
      for (const [i, c] of this.calls) {
        this.blocks[i].input = c.raw ? JSON.parse(c.raw) : (c.args ?? {});
      }
      native = this.blocks;
    } else
      native = {
        role: 'assistant',
        content: this.text || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.arguments) },
              })),
            }
          : {}),
      };
    const usage = normalizeUsage(this.provider, this.usageRaw);
    return {
      text: this.text,
      calls,
      usage,
      native,
      metadata: {
        requestId: this.requestId,
        responseId: this.responseId,
        events: this.events,
        duplicateCalls: this.duplicateCalls,
        finishReason: this.finishReason,
      },
    };
  }
}
export async function callProvider(
  request: ProviderRequest,
  key: string,
  signal: AbortSignal,
  onText: (s: string) => void,
  fetcher: typeof fetch = fetch,
): Promise<TurnResult> {
  const req = ProviderRequestSchema.parse(request),
    payload = providerPayload(req),
    headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [payload.header]: payload.header === 'Authorization' ? `Bearer ${key}` : key,
    };
  if (req.provider === 'anthropic') headers['anthropic-version'] = '2023-06-01';
  const combined = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
  let response: Response;
  try {
    response = await fetcher(payload.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload.body),
      signal: combined,
    });
  } catch {
    throw new Error(
      signal.aborted ? 'Task cancelled' : 'Provider network request failed or timed out',
    );
  }
  if (!response.ok) {
    let detail = '';
    if (
      (response.status === 400 || response.status === 422 || response.status === 429) &&
      response.body
    ) {
      const reader = response.body.getReader();
      let raw = '';
      try {
        while (raw.length < 16000) {
          const { done, value } = await reader.read();
          if (done) break;
          raw += new TextDecoder().decode(value);
        }
        const error = JSON.parse(raw)?.error;
        if (response.status === 429) {
          const retry = error?.details?.find((d: any) =>
            String(d['@type'] ?? '').endsWith('RetryInfo'),
          )?.retryDelay;
          if (typeof retry === 'string' && /^\d+(?:\.\d+)?s$/.test(retry))
            detail = `Provider retry delay: ${retry}. No automatic quota retry.`;
        } else if (typeof error?.message === 'string')
          detail = error.message
            .split(key)
            .join('[redacted]')
            .replace(/[\u0000-\u001f]/g, ' ')
            .slice(0, 400);
      } catch {
      } finally {
        await reader.cancel().catch(() => {});
      }
    } else await response.body?.cancel();
    const message =
      response.status === 401 || response.status === 403
        ? 'Key rejected or model access denied'
        : response.status === 429
          ? 'Rate limit or API quota reached'
          : response.status === 404
            ? 'Model not available'
            : 'Provider request failed';
    throw new Error(
      `${req.provider}: ${message} (HTTP ${response.status}).${detail ? ` ${detail}` : ''} No provider fallback was used.`,
    );
  }
  const accumulator = new StreamAccumulator(req.provider, onText, req.requestId);
  try {
    for await (const chunk of readSSE(response, combined)) accumulator.push(chunk);
    return accumulator.finish();
  } catch (e) {
    if (signal.aborted) throw new Error('Task cancelled');
    throw new Error(
      e instanceof Error && !e.message.includes(key)
        ? e.message
        : 'Provider response could not be processed',
    );
  }
}
