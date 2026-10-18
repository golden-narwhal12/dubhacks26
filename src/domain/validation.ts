import type { Project, Endpoint } from './schema';
import { endpointKey } from './schema';
import { deriveNets, netFor } from './topology';
import { terminal, type Command } from './project';
import { partById } from '../parts/catalog';

export interface Diagnostic {
  id: string;
  revision: number;
  severity: 'error' | 'warning' | 'unknown' | 'info';
  layer: 'electrical' | 'firmware' | 'coverage';
  title: string;
  detail: string;
  objectIds: string[];
  rule: string;
  evidenceIds: string[];
  source?: { fileId: string; start: number; end: number };
  nextAction?: string;
  fix?: { summary: string; commands: Command[] };
}
export function constantSpan(
  content: string,
  symbol: string,
): { value: number; start: number; end: number } | null {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(symbol)) return null;
  // Preserve offsets while masking comments and literals; replacement uses the analyzed span.
  const clean = content.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    (s) => s.replace(/[^\n]/g, ' '),
  );
  const expression = new RegExp(
    `(\\b(?:constexpr|const)\\s+(?:[A-Za-z_][A-Za-z0-9_]*\\s+)+${symbol}\\s*=\\s*)(\\d+)(\\s*;)|(^[ \\t]*#define[ \\t]+${symbol}[ \\t]+)(\\d+)([ \\t]*$)`,
    'gm',
  );
  const matches = [...clean.matchAll(expression)];
  if (matches.length !== 1) return null;
  const m = matches[0],
    literal = m[2] ?? m[5],
    start = m.index! + (m[1] ?? m[4]).length;
  return { value: Number(literal), start, end: start + literal.length };
}
export const constantValue = (content: string, symbol: string) =>
  constantSpan(content, symbol)?.value ?? null;
export function validateCircuit(p: Project): Diagnostic[] {
  const result: Diagnostic[] = [];
  const nets = deriveNets(p);
  const add = (d: Omit<Diagnostic, 'revision'>) => result.push({ ...d, revision: p.revision });
  for (const c of p.components) {
    const part = partById(c.partId);
    if (!part.verifiedMapping)
      add({
        id: `mapping-${c.id}`,
        severity: 'unknown',
        layer: 'coverage',
        title: `${c.ref}: mapping needs review`,
        detail:
          'The package is provisional. Inspect source evidence before relying on physical connections.',
        objectIds: [c.id],
        rule: 'part.evidence',
        evidenceIds: part.evidence.map((e) => e.id),
      });
    if (part.id === 'esp32-s3-devkitc1-v11' && !p.boardSettings.esp32?.confirmed)
      add({
        id: `variant-${c.id}`,
        severity: 'unknown',
        layer: 'coverage',
        title: `${c.ref}: module variant unconfirmed`,
        detail:
          'GPIO35–37 can be occupied by octal flash/PSRAM. Build defaults are 4 MB flash, no PSRAM; confirm module marking before physical upload.',
        objectIds: [c.id],
        rule: 'esp32.variant',
        evidenceIds: ['esp-header'],
      });
  }
  for (const net of nets) {
    const terminals = net.terminals.map((e) => ({ e, t: terminal(p, e) }));
    const powers = terminals.filter((x) => x.t.kind === 'power' && x.t.voltage && x.t.voltage > 0);
    const ground = terminals.some((x) => x.t.kind === 'ground');
    if (ground && powers.length)
      add({
        id: `short-${net.id}`,
        severity: 'error',
        layer: 'electrical',
        title: 'Supply connected directly to ground',
        detail:
          'Explicit wires or internal equivalences put a known positive supply and ground on the same net.',
        objectIds: [...net.wireIds, ...net.terminals.map((t) => t.componentId)],
        rule: 'supply.short',
        evidenceIds: [],
      });
    for (const power of powers) {
      const incompatible = terminals.filter(
        (x) => x.t.kind === 'gpio' && x.t.voltage !== undefined && power.t.voltage! > x.t.voltage,
      );
      if (incompatible.length)
        add({
          id: `voltage-${net.id}-${power.e.terminalId}`,
          severity: 'error',
          layer: 'electrical',
          title: `${power.t.voltage} V supply on ${incompatible[0].t.voltage} V GPIO`,
          detail:
            'A direct positive supply connection exceeds the documented GPIO logic supply. Use an appropriate interface circuit.',
          objectIds: [...net.wireIds, ...incompatible.map((x) => x.e.componentId)],
          rule: 'voltage.supply-gpio',
          evidenceIds: incompatible.flatMap((x) => x.t.evidenceIds),
        });
    }
    const gpios = terminals.filter((x) => x.t.kind === 'gpio');
    if (new Set(gpios.map((x) => x.t.voltage)).size > 1)
      add({
        id: `logic-${net.id}`,
        severity: 'warning',
        layer: 'electrical',
        title: 'Mixed 5 V / 3.3 V logic',
        detail:
          'Direction and actual drive levels are not inferred from bidirectional pin types. Check configured direction and level translation before connecting boards.',
        objectIds: [...net.wireIds, ...gpios.map((x) => x.e.componentId)],
        rule: 'logic.mixed',
        evidenceIds: gpios.flatMap((x) => x.t.evidenceIds),
      });
    const outputs = p.bindings.filter(
      (b) =>
        (b.mode === 'output' || b.mode === 'pwm') &&
        net.terminals.some((e) => e.componentId === b.boardId && e.terminalId === b.terminalId),
    );
    if (outputs.length > 1)
      add({
        id: `outputs-${net.id}`,
        severity: 'warning',
        layer: 'electrical',
        title: 'Multiple configured outputs share a net',
        detail:
          'Explicit firmware bindings configure multiple output-capable drivers. Runtime drive levels are unknown.',
        objectIds: outputs.map((b) => b.boardId),
        rule: 'outputs.configured',
        evidenceIds: [],
      });
    for (const x of terminals.filter(
      (x) => x.t.capabilities.includes('variant-dependent') && net.wireIds.length,
    ))
      add({
        id: `reserved-${endpointKey(x.e)}`,
        severity: 'warning',
        layer: 'electrical',
        title: `${x.t.gpio} depends on module variant`,
        detail:
          'This GPIO may be connected to flash/PSRAM. Confirm the installed module variant before using it.',
        objectIds: [x.e.componentId, ...net.wireIds],
        rule: 'esp32.reserved',
        evidenceIds: ['esp-header'],
      });
  }
  for (const b of p.bindings) {
    const file = p.files.find((f) => f.id === b.fileId)!;
    const t = terminal(p, { componentId: b.boardId, terminalId: b.terminalId });
    const n = netFor(nets, b.target);
    const candidates = [
      ...new Map(
        (
          n?.terminals.filter(
            (e) => e.componentId === b.boardId && terminal(p, e).kind === 'gpio',
          ) ?? []
        ).map((e) => [terminal(p, e).gpio ?? e.terminalId, e]),
      ).values(),
    ];
    const observed = candidates.length === 1 ? candidates[0] : undefined;
    const value = constantValue(file.content, b.symbol);
    const actual = observed ? terminal(p, observed) : undefined;
    if (!observed)
      add({
        id: `binding-wire-${b.id}`,
        severity: candidates.length ? 'warning' : 'error',
        layer: 'firmware',
        title: `${b.symbol}: ${candidates.length ? 'ambiguous GPIO net' : 'signal is disconnected'}`,
        detail:
          'The bound signal must share an explicit net with exactly one board GPIO. No automatic pin choice is safe here.',
        objectIds: [b.boardId, b.target.componentId],
        rule: 'binding.connectivity',
        evidenceIds: [],
        nextAction: 'Connect the signal to one GPIO, then review the binding.',
      });
    else if (actual?.gpio !== t.gpio || value !== Number(actual?.firmwareAlias)) {
      const alias = actual?.firmwareAlias;
      const canFix = value !== null && alias !== undefined && /^\d+$/.test(alias);
      const span = constantSpan(file.content, b.symbol);
      const replacement =
        canFix && span
          ? file.content.slice(0, span.start) + alias + file.content.slice(span.end)
          : file.content;
      const fix =
        (canFix && replacement !== file.content) || (canFix && observed.terminalId !== b.terminalId)
          ? {
              summary: `Align ${b.symbol} with ${actual?.gpio} (${actual?.label})`,
              commands: [
                { type: 'setBinding' as const, binding: { ...b, terminalId: observed.terminalId } },
                { type: 'writeFile' as const, file: { ...file, content: replacement } },
              ],
            }
          : undefined;
      add({
        id: `mismatch-${b.id}`,
        ...(span ? { source: { fileId: file.id, start: span.start, end: span.end } } : {}),
        severity: 'error',
        layer: 'firmware',
        title: `${b.symbol} does not match the wiring`,
        detail: `Signal is wired to ${actual?.gpio} (firmware ${alias}); binding points to ${t.gpio}; ${b.symbol} is ${value ?? 'not a supported literal constant'}. Only simple named integer constants are analyzed.`,
        objectIds: [b.boardId, b.target.componentId, ...(n?.wireIds ?? [])],
        rule: 'binding.constant',
        evidenceIds: actual?.evidenceIds ?? [],
        nextAction: fix
          ? 'Preview a coordinated binding and code fix.'
          : 'Review the explicit pin binding and firmware.',
        fix,
      });
    }
    if (b.mode === 'pwm' && !t.capabilities.includes('pwm'))
      add({
        id: `pwm-${b.id}`,
        severity: 'error',
        layer: 'firmware',
        title: `${t.label} has no documented PWM capability`,
        detail: 'The binding requests PWM on a terminal without a documented PWM function.',
        objectIds: [b.boardId],
        rule: 'binding.capability',
        evidenceIds: t.evidenceIds,
      });
    if (value === null)
      add({
        id: `analysis-${b.id}`,
        severity: 'unknown',
        layer: 'firmware',
        title: `${b.symbol}: dynamic value not analyzed`,
        detail:
          'Only a literal const/constexpr or #define integer is supported. This check does not analyze arbitrary C++ control flow or macros.',
        objectIds: [b.boardId],
        rule: 'analysis.coverage',
        evidenceIds: [],
      });
  }
  for (const c of p.components.filter((c) => partById(c.partId).kind === 'led')) {
    const anode = netFor(nets, { componentId: c.id, terminalId: 'a' })!,
      cathode = netFor(nets, { componentId: c.id, terminalId: 'k' })!;
    const cathodeGround = cathode.terminals.some((e) => terminal(p, e).kind === 'ground');
    const resistor = p.components.find(
      (r) =>
        partById(r.partId).kind === 'resistor' &&
        anode.terminals.some((e) => e.componentId === r.id),
    );
    if (!resistor)
      add({
        id: `led-resistor-${c.id}`,
        severity: 'warning',
        layer: 'electrical',
        title: `${c.ref}: no series resistor identified`,
        detail:
          'The simple low-side-ground LED check cannot identify a resistor connected to the anode. Current is unknown. Other driver topologies are outside this rule.',
        objectIds: [c.id],
        rule: 'led.series-resistor',
        evidenceIds: partById(c.partId).evidence.map((e) => e.id),
      });
    if (!cathodeGround)
      add({
        id: `led-return-${c.id}`,
        severity: 'warning',
        layer: 'electrical',
        title: `${c.ref}: ground return not identified`,
        detail:
          'The example rule expects the cathode to share a net with board ground. Other topologies require manual review.',
        objectIds: [c.id],
        rule: 'led.return',
        evidenceIds: partById(c.partId).evidence.map((e) => e.id),
      });
    const bypassed =
      resistor &&
      (anode.terminals.filter((e) => e.componentId === resistor.id).length !== 1 ||
        anode.terminals.some((e) => ['gpio', 'power', 'ground'].includes(terminal(p, e).kind)));
    if (bypassed)
      add({
        id: `led-bypass-${c.id}`,
        severity: 'error',
        layer: 'electrical',
        title: `${c.ref}: resistor bypassed or unsupported drive path`,
        detail:
          'The anode net has a direct drive/supply path or shorts both resistor leads. A resistor-limited current estimate is invalid.',
        objectIds: [c.id, resistor!.id],
        rule: 'led.resistor-bypass',
        evidenceIds: [...partById(c.partId).evidence, ...partById(resistor!.partId).evidence].map(
          (e) => e.id,
        ),
      });
    if (resistor && cathodeGround && !bypassed) {
      const rpart = partById(resistor.partId);
      const rt = anode.terminals.find((e) => e.componentId === resistor.id)!;
      const other: Endpoint = {
        componentId: resistor.id,
        terminalId: rt.terminalId === 'p1' ? 'p2' : 'p1',
      };
      const drive = netFor(nets, other)?.terminals.find((e) => terminal(p, e).kind === 'gpio');
      const resistance = resistor.config.resistanceOhms ?? rpart.resistance;
      const forwardV = c.config.forwardVoltageV ?? partById(c.partId).forwardV;
      if (drive && resistance && forwardV !== undefined) {
        const voltage = terminal(p, drive).voltage!;
        const ma = Math.max(0, ((voltage - forwardV) / resistance) * 1000);
        const threshold = c.config.maxCurrentMa ?? (c.partId === 'generic-led' ? 10 : 20);
        add({
          id: `led-estimate-${c.id}`,
          severity: ma > threshold ? 'warning' : 'info',
          layer: 'electrical',
          title: `${c.ref}: ≈${ma.toFixed(1)} mA nominal estimate`,
          detail: `(${voltage} V − ${forwardV} V assumed/typical) / ${resistance} Ω. Assumes GPIO high at nominal supply, 25 °C and the documented simple series path. GPIO drop, tolerance, thermal behavior and load dynamics are not simulated; this is not a guaranteed current or power budget.`,
          objectIds: [c.id, resistor.id, drive.componentId],
          rule: 'led.nominal-estimate',
          evidenceIds: [...partById(c.partId).evidence, ...rpart.evidence].map((e) => e.id),
        });
      }
    }
  }
  for (const component of p.components.filter((c) =>
    ['itr9608-dip4', 'as5600-module-photo', 'sg90-generic'].includes(c.partId),
  )) {
    const part = partById(component.partId),
      connected = (id: string) =>
        netFor(nets, { componentId: component.id, terminalId: id })?.terminals.filter(
          (e) => e.componentId !== component.id,
        ) ?? [];
    if (part.kind === 'photointerruptor') {
      if (
        !connected('a').some(
          (e) =>
            partById(p.components.find((c) => c.id === e.componentId)!.partId).kind === 'resistor',
        )
      )
        add({
          id: `emitter-${component.id}`,
          severity: 'warning',
          layer: 'electrical',
          title: `${component.ref}: emitter current limiting not documented`,
          detail:
            'The bare IR emitter needs a suitable series current-limiting path. No direct-series resistor was identified on its anode net; alternative circuits require review.',
          objectIds: [component.id],
          rule: 'opto.emitter-path',
          evidenceIds: ['itr-pinout'],
        });
      if (
        !connected('c').some(
          (e) =>
            partById(p.components.find((c) => c.id === e.componentId)!.partId).kind === 'resistor',
        ) &&
        !p.bindings.some(
          (b) =>
            b.mode === 'input_pullup' &&
            netFor(nets, b.target)?.id ===
              netFor(nets, { componentId: component.id, terminalId: 'c' })?.id,
        )
      )
        add({
          id: `detector-${component.id}`,
          severity: 'warning',
          layer: 'electrical',
          title: `${component.ref}: detector load not documented`,
          detail:
            'Collector/emitter is a phototransistor, not a comparator output. A load or explicitly configured input pull-up is needed for a voltage signal. Dynamic firmware pull-ups are not inferred.',
          objectIds: [component.id],
          rule: 'opto.detector-load',
          evidenceIds: ['itr-pinout'],
        });
    } else {
      const supply = part.kind === 'encoder' ? 'vcc' : 'power';
      if (!connected(supply).length || !connected('gnd').length)
        add({
          id: `supply-${component.id}`,
          severity: 'warning',
          layer: 'electrical',
          title: `${component.ref}: supply wiring incomplete`,
          detail:
            part.kind === 'servo'
              ? 'Servo supply/current ratings and power distribution need review on the actual unit. No power budget is guaranteed.'
              : 'Document VCC and ground; module regulator/pull-ups and supply circuitry remain provisional.',
          objectIds: [component.id],
          rule: 'part.supply-documentation',
          evidenceIds: part.evidence.map((e) => e.id),
        });
    }
  }
  add({
    id: 'coverage',
    severity: 'unknown',
    layer: 'coverage',
    title: 'Scoped checks · no analog simulation',
    detail:
      'Structural references are validated on every command. Electrical rules cover known supply shorts, mixed logic, explicit bindings and a simple LED path. Dynamic firmware, total load current and arbitrary analog behavior remain unchecked.',
    objectIds: [],
    rule: 'coverage',
    evidenceIds: [],
  });
  return result;
}
