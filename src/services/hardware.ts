import { z } from 'zod';
import type { Project } from '../domain/schema';
import type { RunResult } from './bridge';
export const PortKey = z.string().min(1).max(240);
export interface DevicePort {
  key: string;
  path: string;
  label: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
  identity: string;
  weakIdentity: boolean;
  boardName?: string;
}
export const HardwareActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('upload'),
      portKey: PortKey,
      resumeMonitor: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      action: z.literal('connect'),
      portKey: PortKey,
      baud: z.number().int().min(300).max(2000000),
      delimiter: z.enum(['lf', 'cr', 'crlf']).default('lf'),
    })
    .strict(),
  z.object({ action: z.literal('disconnect') }).strict(),
  z
    .object({
      action: z.literal('transmit'),
      portKey: PortKey,
      payload: z.string().min(1).max(2048),
      encoding: z.enum(['text', 'hex']).default('text'),
    })
    .strict(),
  z
    .object({ action: z.literal('reset'), portKey: PortKey, mechanism: z.literal('dtr-pulse') })
    .strict(),
]);
export type HardwareAction = z.infer<typeof HardwareActionSchema>;
export const HardwareRequestInputSchema = z
  .object({
    requestId: z.string().uuid().optional(),
    operation: HardwareActionSchema,
    reason: z.string().min(1).max(240),
    origin: z.enum(['human', 'agent']),
  })
  .strict();
export type HardwareRequestInput = z.infer<typeof HardwareRequestInputSchema>;
export interface VerificationRecord {
  circuitKey: string;
  buildKey: string;
  checkedAt: number;
  result: RunResult;
  issues: { id: string; title: string; severity: string; objectIds: string[] }[];
}
export interface PreparedArtifact {
  id: string;
  buildKey: string;
  target: string;
  configuration: string;
  createdAt: number;
  files: { path: string; content: string }[];
}
export interface HardwareRequest {
  id: string;
  operation: HardwareAction;
  reason: string;
  origin: 'human' | 'agent';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired';
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  expiresAt: number;
  device?: DevicePort;
  serialConfig?: { baud: number; delimiter: 'lf' | 'cr' | 'crlf' };
  artifact?: PreparedArtifact;
  verification?: VerificationRecord;
  warning?: string;
  output?: string;
  error?: string;
}
export interface RawSerialLine {
  sequence: number;
  receivedAt: number;
  text: string;
  invalidEncoding: boolean;
  truncated: boolean;
}
export interface TelemetrySample {
  sequence: number;
  receivedAt: number;
  value: number;
  deviceTimestamp?: string | number;
  rawSequence: number;
}
export interface ChannelSnapshot {
  mappingId: string;
  latest: TelemetrySample | null;
  min: number | null;
  max: number | null;
  count: number;
  invalid: number;
  samples: TelemetrySample[];
}
export interface SerialSnapshot {
  state: 'disconnected' | 'connecting' | 'connected' | 'error';
  port?: DevicePort;
  baud?: number;
  delimiter?: 'lf' | 'cr' | 'crlf';
  startedAt?: number;
  error?: string;
  lines: RawSerialLine[];
  channels: ChannelSnapshot[];
  droppedLines: number;
  parseErrors: number;
  lastSequence: number;
}
export interface UploadedProgram {
  artifact: PreparedArtifact;
  device: DevicePort;
  uploadedAt: number;
}
export interface HardwareSnapshot {
  ports: DevicePort[];
  requests: HardwareRequest[];
  serial: SerialSnapshot;
  verification: VerificationRecord | null;
  uploaded: UploadedProgram | null;
  busy: boolean;
}
export const ObserveSchema = z
  .object({
    mappingId: z.string().min(1).max(96),
    operator: z.enum(['eq', 'gt', 'lt', 'change']),
    value: z.number().finite().optional(),
    timeoutMs: z.number().int().min(1).max(30000),
  })
  .strict();
export type ObserveCondition = z.infer<typeof ObserveSchema>;
export interface HardwareBridge {
  syncProject(project: Project): Promise<HardwareSnapshot>;
  discover(): Promise<HardwareSnapshot>;
  snapshot(): Promise<HardwareSnapshot>;
  verify(project: Project, requestId: string): Promise<HardwareSnapshot>;
  request(input: HardwareRequestInput): Promise<HardwareRequest>;
  approve(id: string, overrideVerification?: boolean): Promise<HardwareRequest>;
  cancel(id: string): Promise<HardwareRequest>;
  observe(
    input: ObserveCondition,
    requestId: string,
  ): Promise<{ sample: TelemetrySample; mappingId: string }>;
  onSnapshot(callback: (snapshot: HardwareSnapshot) => void): () => void;
}
