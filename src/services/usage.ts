import type { ProviderId } from './bridge';
export interface NormalizedUsage {
  input: number | null;
  output: number | null;
  total?: number | null;
  reasoning?: number | null;
  cachedInput?: number | null;
  cacheWriteInput?: number | null;
  warnings?: string[];
}
/** One cumulative response snapshot. Subcategories are metadata, never added twice. */
export function normalizeUsage(provider: ProviderId, raw: Record<string, any>): NormalizedUsage {
  const warnings: string[] = [];
  const n = (key: string, obj: Record<string, any> = raw): number | null => {
    const v = obj[key];
    if (v === undefined || v === null) return null;
    if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return v;
    warnings.push(`Invalid ${key}`);
    return null;
  };
  let input: number | null,
    output: number | null,
    total: number | null,
    reasoning: number | null = null,
    cachedInput: number | null = null,
    cacheWriteInput: number | null = null;
  if (provider === 'gemini') {
    input = n('promptTokenCount');
    const candidate = n('candidatesTokenCount');
    reasoning = n('thoughtsTokenCount');
    output = candidate === null && reasoning === null ? null : (candidate ?? 0) + (reasoning ?? 0);
    cachedInput = n('cachedContentTokenCount');
    total = n('totalTokenCount');
  } else if (provider === 'anthropic') {
    const base = n('input_tokens');
    cachedInput = n('cache_read_input_tokens');
    cacheWriteInput = n('cache_creation_input_tokens');
    input = base === null ? null : base + (cachedInput ?? 0) + (cacheWriteInput ?? 0);
    output = n('output_tokens');
    total = null;
  } else {
    input = n('prompt_tokens');
    output = n('completion_tokens');
    total = n('total_tokens');
    reasoning = n('reasoning_tokens', raw.completion_tokens_details ?? {});
    cachedInput = n('cached_tokens', raw.prompt_tokens_details ?? {});
  }
  total ??= input !== null && output !== null ? input + output : null;
  if (total !== null && input !== null && output !== null && total < input + output) {
    warnings.push('Total is below reported components; using component sum');
    total = input + output;
  }
  return {
    input,
    output,
    total,
    reasoning,
    cachedInput,
    cacheWriteInput,
    ...(warnings.length ? { warnings } : {}),
  };
}
