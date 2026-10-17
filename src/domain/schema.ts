import { z } from 'zod';

export const Id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,95}$/);
export const EndpointSchema = z.object({ componentId: Id, terminalId: Id }).strict();
export type Endpoint = z.infer<typeof EndpointSchema>;
export const ComponentSchema = z.object({
  id: Id, partId: Id, partVersion: z.literal(1), ref: z.string().min(1).max(48),
  config: z.object({ label: z.string().max(80).optional() }).strict().default({}),
}).strict();
export type Component = z.infer<typeof ComponentSchema>;
export const PlacementSchema = z.object({ x: z.number().finite().min(-10000).max(10000), y: z.number().finite().min(-10000).max(10000), rotation: z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)]).default(0) }).strict();
export const WireSchema = z.object({ id: Id, from: EndpointSchema, to: EndpointSchema, color: z.enum(['mint','copper','blue','red','gray']).default('mint') }).strict();
export const FileSchema = z.object({ id: Id, path: z.string().regex(/^[a-zA-Z0-9_-]+\.(ino|h|cpp|c)$/), content: z.string().max(200000) }).strict();
export const BindingSchema = z.object({ id: Id, boardId: Id, terminalId: Id, target: EndpointSchema, fileId: Id, symbol: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), mode: z.enum(['input','output','input_pullup','pwm']), }).strict();
export type Binding = z.infer<typeof BindingSchema>;
export const ProjectSchema = z.object({
  schemaVersion: z.literal(1), id: Id, name: z.string().min(1).max(100), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1000),
  components: z.array(ComponentSchema).max(100), wires: z.array(WireSchema).max(500),
  layouts: z.object({ wiring: z.record(Id, PlacementSchema), schematic: z.record(Id, PlacementSchema) }).strict(),
  files: z.array(FileSchema).min(1).max(32), bindings: z.array(BindingSchema).max(100),
  targetBoardId: Id.nullable(),
}).strict();
export type Project = z.infer<typeof ProjectSchema>;
export type Wire = z.infer<typeof WireSchema>;
export type View = 'wiring' | 'schematic';
export const endpointKey = (e: Endpoint) => `${e.componentId}:${e.terminalId}`;
export const sameEndpoint = (a: Endpoint, b: Endpoint) => endpointKey(a) === endpointKey(b);

export interface Evidence { id: string; title: string; url: string; revision: string; location: string; fact: string; value?: number; units?: string; status: 'verified' | 'provisional' }
export interface Terminal { id: string; label: string; kind: 'gpio'|'ground'|'power'|'passive'|'anode'|'cathode'|'control'|'nc'; gpio?: string; firmwareAlias?: string; packagePin?: string; capabilities: string[]; voltage?: number; evidenceIds: string[]; header?: string; physicalPin?: number }
export interface Part { id: string; version: 1; name: string; manufacturer: string; mpn: string; revision: string; kind: 'board'|'resistor'|'led'; description: string; terminals: Terminal[]; internalGroups: string[][]; evidence: Evidence[]; verifiedMapping: boolean; constraints: boolean; firmware?: { fqbn: string; logicV: number }; simulation: 'simavr-external'|'none'; resistance?: number; forwardV?: number; maxCurrentMa?: number; ratedPowerW?: number; assets: { renderer: string; geometry: 'illustrative' } }
