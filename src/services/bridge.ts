import type { Project } from '../domain/schema';
export type ProviderId = 'gemini' | 'openai' | 'anthropic' | 'xai';
export interface Connection {
  provider: ProviderId;
  configured: boolean;
  model: string;
}
export interface RunResult {
  revision: number;
  success: boolean;
  cancelled?: boolean;
  kind: 'build' | 'simulation';
  output: string;
  durationMs: number;
  artifactId?: string;
  observations?: { uart: string; digitalTransitions: number | null; scope: string };
}
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
export interface TurnResult {
  text: string;
  calls: ToolCall[];
  usage: { input: number; output: number };
  native: unknown;
}
export interface ChatTurn {
  role: 'user' | 'assistant' | 'tool';
  text?: string;
  call?: ToolCall;
  result?: unknown;
  native?: unknown;
}
export interface ProviderRequest {
  provider: ProviderId;
  model: string;
  system: string;
  messages: ChatTurn[];
  maxTokens: number;
  requestId: string;
}
export interface DesktopBridge {
  saveProject(project: Project): Promise<{ cancelled: boolean; name?: string }>;
  openProject(): Promise<{ cancelled: boolean; project?: Project; name?: string }>;
  connections(): Promise<Connection[]>;
  setConnection(input: {
    provider: ProviderId;
    model: string;
    key?: string;
    remove?: boolean;
  }): Promise<Connection[]>;
  testConnection(input: {
    provider: ProviderId;
    model: string;
  }): Promise<{ ok: boolean; message: string }>;
  providerTurn(input: ProviderRequest): Promise<TurnResult>;
  build(input: { project: Project; requestId: string; simulate: boolean }): Promise<RunResult>;
  cancel(requestId: string): Promise<void>;
  capabilities(): Promise<{ desktop: boolean; arduino: boolean; simavr: boolean }>;
  onProviderText(callback: (event: { requestId: string; text: string }) => void): () => void;
}
declare global {
  interface Window {
    trace?: DesktopBridge;
  }
}
export const providerDefaults: Record<ProviderId, { name: string; model: string }> = {
  gemini: { name: 'Google Gemini', model: 'gemini-2.5-flash' },
  openai: { name: 'OpenAI', model: 'gpt-4.1-mini' },
  anthropic: { name: 'Anthropic Claude', model: 'claude-sonnet-4-5' },
  xai: { name: 'xAI Grok', model: 'grok-4-fast-non-reasoning' },
};
