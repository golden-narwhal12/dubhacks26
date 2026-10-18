import type { Endpoint, Project } from './schema';
import { deriveNets, netFor } from './topology';
import { terminal } from './project';
import { partById } from '../parts/catalog';

/** Signal reachability is separate from electrical equivalence: translators never merge nets. */
export function signalEndpoints(project: Project, endpoint: Endpoint) {
  const nets = deriveNets(project),
    first = netFor(nets, endpoint);
  if (!first) return [];
  const reached = new Set([first.id]),
    queue = [first];
  while (queue.length) {
    const net = queue.shift()!;
    for (const c of project.components.filter((c) => c.partId === 'adafruit-757'))
      for (let channel = 1; channel <= 4; channel++) {
        const low = netFor(nets, { componentId: c.id, terminalId: `lv${channel}` })!,
          high = netFor(nets, { componentId: c.id, terminalId: `hv${channel}` })!;
        const other = net.id === low.id ? high : net.id === high.id ? low : undefined;
        if (other && !reached.has(other.id)) {
          reached.add(other.id);
          queue.push(other);
        }
      }
  }
  return nets.filter((n) => reached.has(n.id)).flatMap((n) => n.terminals);
}
export function netVoltage(project: Project, endpoint: Endpoint) {
  const net = netFor(deriveNets(project), endpoint);
  const values =
    net?.terminals.flatMap((e) => {
      const c = project.components.find((c) => c.id === e.componentId)!,
        part = partById(c.partId),
        t = terminal(project, e);
      if (part.kind === 'supply' && e.terminalId === 'positive')
        return c.config.supplyVoltageV ? [c.config.supplyVoltageV] : [];
      return part.kind === 'board' && t.kind === 'power' && t.voltage ? [t.voltage] : [];
    }) ?? [];
  return values.length ? Math.max(...values) : undefined;
}
