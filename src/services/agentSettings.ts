import { z } from 'zod';
export const AgentLimitsSchema = z
  .object({
    requests: z.number().int().min(1).max(100),
    tools: z.number().int().min(1).max(500),
    reportedTokens: z.number().int().min(1).max(100_000_000),
    outputTokens: z.number().int().min(256).max(32768),
    durationMs: z.number().int().min(1000).max(1800000),
  })
  .strict();
export type AgentLimits = z.infer<typeof AgentLimitsSchema>;
export const defaultLimits: AgentLimits = {
  requests: 32,
  tools: 120,
  reportedTokens: 1_000_000,
  outputTokens: 8192,
  durationMs: 600_000,
};
/** v1 never exposed limits in Settings. Migrate indistinguishable built-ins, retain non-defaults or explicitly marked values. */
export function migrateAgentSettings(raw: unknown): AgentLimits {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  const source = value.limits ?? value;
  const old = {
    requests: 6,
    tools: 20,
    reportedTokens: 24000,
    outputTokens: 2048,
    durationMs: 90000,
  };
  const result = { ...defaultLimits };
  for (const key of Object.keys(result) as (keyof AgentLimits)[]) {
    const n = source[key];
    if (n === undefined) continue;
    if (value.version !== 2 && !value.explicit?.includes(key) && n === old[key]) continue;
    if (AgentLimitsSchema.shape[key].safeParse(n).success) result[key] = n;
  }
  return result;
}
export const agentSettingsStorageKey = 'trace.agent-limits.v2';
