import { endpointKey, type Endpoint, type Project } from './schema';
import { partById } from '../parts/catalog';
export interface Net {
  id: string;
  terminals: Endpoint[];
  wireIds: string[];
}
export function deriveNets(project: Project): Net[] {
  const parent = new Map<string, string>(),
    endpoints = new Map<string, Endpoint>();
  const find = (s: string): string => {
    const p = parent.get(s);
    if (!p) {
      parent.set(s, s);
      return s;
    }
    if (p === s) return s;
    const root = find(p);
    parent.set(s, root);
    return root;
  };
  const join = (a: string, b: string) => {
    const ra = find(a),
      rb = find(b);
    parent.set(ra, rb);
  };
  for (const c of project.components) {
    const part = partById(c.partId);
    for (const t of part.terminals) {
      const e = { componentId: c.id, terminalId: t.id };
      endpoints.set(endpointKey(e), e);
      find(endpointKey(e));
    }
    for (const group of part.internalGroups)
      for (const id of group.slice(1)) join(`${c.id}:${group[0]}`, `${c.id}:${id}`);
  }
  for (const w of project.wires) join(endpointKey(w.from), endpointKey(w.to));
  const nets = new Map<string, Endpoint[]>();
  for (const [key, e] of endpoints) {
    const root = find(key);
    nets.set(root, [...(nets.get(root) ?? []), e]);
  }
  return [...nets.values()].map((terminals) => {
    terminals.sort((a, b) => endpointKey(a).localeCompare(endpointKey(b)));
    return {
      id: `net-${endpointKey(terminals[0])}`,
      terminals,
      wireIds: project.wires
        .filter((w) => terminals.some((t) => endpointKey(t) === endpointKey(w.from)))
        .map((w) => w.id),
    };
  });
}
export const netFor = (nets: Net[], e: Endpoint) =>
  nets.find((n) => n.terminals.some((t) => endpointKey(t) === endpointKey(e)));
