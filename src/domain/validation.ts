import type { Project, Endpoint } from './schema';
import { endpointKey } from './schema';
import { deriveNets, netFor } from './topology';
import { terminal, type Command } from './project';
import { partById } from '../parts/catalog';
import { signalEndpoints, netVoltage } from './interfaces';

export interface Diagnostic {
  id: string;
  revision: number;
  severity: 'error' | 'warning' | 'unknown' | 'info';
  layer: 'electrical' | 'firmware' | 'coverage';
  requiresPhysicalFacts?: boolean;
  requiresAgentResolution?: boolean;
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
/** Narrow Arduino pin constants, including visible A0–A15 aliases. No arbitrary C++ evaluation. */
export function pinConstantSpan(
  content: string,
  symbol: string,
): { literal: string; start: number; end: number } | null {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(symbol)) return null;
  const clean = content.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    (s) => s.replace(/[^\n]/g, ' '),
  );
  const re = new RegExp(
    `(\\b(?:constexpr|const)\\s+(?:[A-Za-z_][A-Za-z0-9_]*\\s+)+${symbol}\\s*=\\s*)(A\\d+|\\d+)(\\s*;)|(^[ \\t]*#define[ \\t]+${symbol}[ \\t]+)(A\\d+|\\d+)([ \\t]*$)`,
    'gm',
  );
  const matches = [...clean.matchAll(re)];
  if (matches.length !== 1) return null;
  const m = matches[0],
    literal = m[2] ?? m[5],
    start = m.index! + (m[1] ?? m[4]).length;
  return { literal, start, end: start + literal.length };
}
export function validateCircuit(p: Project): Diagnostic[] {
  const result: Diagnostic[] = [];
  const nets = deriveNets(p);
  const add = (d: Omit<Diagnostic, 'revision'>) => result.push({ ...d, revision: p.revision });
  for (const c of p.components) {
    const part = partById(c.partId);
    if (part.operatingSupply) {
      const requirement = part.operatingSupply,
        voltage = netVoltage(p, { componentId: c.id, terminalId: requirement.terminalId });
      if (voltage === undefined || voltage < requirement.minV || voltage > requirement.maxV)
        add({
          id: `operating-supply-${c.id}`,
          severity: 'error',
          requiresAgentResolution: true,
          layer: 'electrical',
          title: `${c.ref}: ${voltage === undefined ? 'supply source missing' : `${voltage} V outside operating range`}`,
          detail: `Document a ${requirement.minV}–${requirement.maxV} V source. ${requirement.conditions}. Recommended operation is distinct from absolute maximum ratings; logic/load/power are separate checks.`,
          objectIds: [c.id],
          rule: 'part.operating-supply',
          evidenceIds: part.evidence.map((e) => e.id),
        });
      const grounds = part.terminals.filter((t) => t.kind === 'ground');
      if (
        grounds.length &&
        !grounds.some((t) =>
          netFor(nets, { componentId: c.id, terminalId: t.id })?.terminals.some(
            (e) => e.componentId !== c.id && terminal(p, e).kind === 'ground',
          ),
        )
      )
        add({
          id: `required-ground-${c.id}`,
          severity: 'error',
          requiresAgentResolution: true,
          layer: 'electrical',
          title: `${c.ref}: ground reference missing`,
          detail: 'Document the device ground return; visual proximity is not connectivity.',
          objectIds: [c.id],
          rule: 'part.required-ground',
          evidenceIds: part.evidence.map((e) => e.id),
        });
    }
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
    const terminals = net.terminals.map((e) => {
      const c = p.components.find((c) => c.id === e.componentId)!;
      return {
        e,
        t: {
          ...terminal(p, e),
          ...(partById(c.partId).kind === 'supply' && e.terminalId === 'positive'
            ? { voltage: c.config.supplyVoltageV }
            : {}),
        },
      };
    });
    const powers = terminals.filter(
      (x) =>
        x.t.kind === 'power' &&
        x.t.voltage &&
        x.t.voltage > 0 &&
        ['board', 'supply'].includes(
          partById(p.components.find((c) => c.id === x.e.componentId)!.partId).kind,
        ),
    );
    const ground = terminals.some((x) => x.t.kind === 'ground');
    if (new Set(powers.map((x) => x.t.voltage)).size > 1)
      add({
        id: `rails-${net.id}`,
        severity: 'error',
        requiresAgentResolution: true,
        layer: 'electrical',
        title: 'Different supply rails connected directly',
        detail:
          'Known source voltages share one explicit net. Separate the supplies and use a suitable interface; wire color does not establish voltage.',
        objectIds: [...net.wireIds, ...net.terminals.map((e) => e.componentId)],
        rule: 'supply.conflicting-rails',
        evidenceIds: [],
      });
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
        signalEndpoints(p, b.target)
          .filter((e) => e.componentId === b.boardId && terminal(p, e).kind === 'gpio')
          .map((e) => [terminal(p, e).gpio ?? e.terminalId, e]),
      ).values(),
    ];
    const observed = candidates.length === 1 ? candidates[0] : undefined;
    const pinSpan = pinConstantSpan(file.content, b.symbol);
    const value = pinSpan?.literal ?? null;
    const actual = observed ? terminal(p, observed) : undefined;
    if (!observed)
      add({
        id: `binding-wire-${b.id}`,
        severity: candidates.length ? 'warning' : 'error',
        layer: 'firmware',
        title: `${b.symbol}: ${candidates.length ? 'ambiguous GPIO net' : 'signal is disconnected'}`,
        detail:
          'The bound signal must reach exactly one board GPIO through explicit wiring or a documented translator channel. No automatic pin choice is safe here.',
        objectIds: [b.boardId, b.target.componentId],
        rule: 'binding.connectivity',
        evidenceIds: [],
        nextAction: 'Connect the signal to one GPIO, then review the binding.',
      });
    else if (
      actual?.gpio !== t.gpio ||
      !(
        value === actual?.firmwareAlias ||
        (p.components.find((c) => c.id === b.boardId)?.partId === 'arduino-mega-r3' &&
          /^A\d+$/.test(actual?.firmwareAlias ?? '') &&
          Number(value) === 54 + Number(actual!.firmwareAlias!.slice(1)))
      )
    ) {
      const alias = actual?.firmwareAlias;
      const canFix = value !== null && alias !== undefined && /^(?:A\d+|\d+)$/.test(alias);
      const span = pinSpan;
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
        ...(() => {
          const direct = p.wires.filter(
            (w) =>
              (w.from.componentId === c.id && w.from.terminalId === 'a') ||
              (w.to.componentId === c.id && w.to.terminalId === 'a'),
          );
          const other =
            direct.length === 1
              ? direct[0].from.componentId === c.id
                ? direct[0].to
                : direct[0].from
              : null;
          const id = `limit-${c.id.slice(0, 82)}`,
            rf = `R-${c.ref}`.slice(0, 48);
          const board = other ? p.components.find((x) => x.id === other.componentId) : null;
          const voltage = other ? terminal(p, other).voltage : undefined,
            forward = c.config.forwardVoltageV ?? partById(c.partId).forwardV,
            current = c.config.maxCurrentMa ?? partById(c.partId).maxCurrentMa ?? 10;
          if (
            !cathodeGround ||
            !other ||
            !board ||
            partById(board.partId).kind !== 'board' ||
            terminal(p, other).kind !== 'gpio' ||
            voltage === undefined ||
            forward === undefined ||
            p.components.some((x) => x.id === id || x.ref === rf)
          )
            return {};
          const min = Math.max(1, (voltage - forward) / (Math.min(current, 20) / 1000));
          const resistance = Math.ceil(min / 330) * 330;
          if (
            resistance > 1e12 ||
            p.components.length >= 100 ||
            p.wires.length >= 500 ||
            p.wires.some((w) => w.id === `${id}-in` || w.id === `${id}-out`)
          )
            return {};
          const led = p.layouts.wiring[c.id];
          return {
            fix: {
              summary: `Add ${resistance} Ω series current limiting for ${c.ref}`,
              commands: [
                { type: 'disconnect' as const, id: direct[0].id },
                {
                  type: 'addComponent' as const,
                  component: {
                    id,
                    partId: 'generic-resistor',
                    partVersion: 1 as const,
                    ref: rf,
                    config: { resistanceOhms: resistance },
                  },
                  placement: {
                    x: Math.max(-10000, led.x - 180),
                    y: Math.min(10000, led.y + 40),
                    rotation: 0 as const,
                  },
                },
                {
                  type: 'connect' as const,
                  wire: {
                    id: `${id}-in`,
                    from: other,
                    to: { componentId: id, terminalId: 'p1' },
                    color: 'mint' as const,
                  },
                },
                {
                  type: 'connect' as const,
                  wire: {
                    id: `${id}-out`,
                    from: { componentId: id, terminalId: 'p2' },
                    to: { componentId: c.id, terminalId: 'a' },
                    color: 'mint' as const,
                  },
                },
                ...p.bindings
                  .filter(
                    (b) =>
                      b.target.componentId === c.id &&
                      b.target.terminalId === 'a' &&
                      b.boardId === board.id,
                  )
                  .map((b) => ({
                    type: 'setBinding' as const,
                    binding: { ...b, target: { componentId: id, terminalId: 'p1' } },
                  })),
              ],
            },
          };
        })(),
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
          requiresAgentResolution: ma > threshold,
          ...(ma > threshold && resistor.partId === 'generic-resistor'
            ? {
                fix: {
                  summary: `Increase ${resistor.ref} to meet the configured current assumption`,
                  commands: [
                    {
                      type: 'configureComponent' as const,
                      id: resistor.id,
                      config: {
                        resistanceOhms:
                          Math.ceil(
                            Math.max(1, (voltage - forwardV) / (Math.min(threshold, 20) / 1000)) /
                              330,
                          ) * 330,
                      },
                    },
                  ],
                },
              }
            : {}),
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
      if (
        part.kind === 'servo' &&
        connected('power').some(
          (e) =>
            partById(p.components.find((c) => c.id === e.componentId)!.partId).kind === 'board' &&
            terminal(p, e).kind === 'power',
        )
      )
        add({
          id: `servo-power-${component.id}`,
          requiresAgentResolution: true,
          severity: 'warning',
          layer: 'electrical',
          title: `${component.ref}: board supply capacity unverified`,
          detail:
            'This generic servo is connected to a board supply rail. Its transient/stall current and this power path capacity are not documented. Do not assume USB/board power is adequate; document an appropriate external supply or confirm the actual load and distribution.',
          objectIds: [component.id, ...connected('power').map((e) => e.componentId)],
          rule: 'servo.supply-capacity',
          evidenceIds: ['sg90-reference'],
          nextAction:
            'Add external-dc-supply with declared intended voltage, preserve common ground and servo control. Actual supply/load capacity still requires physical confirmation.',
        });
      if (
        part.kind === 'encoder' &&
        ['scl', 'sda'].some((id) =>
          connected(id).some(
            (e) => terminal(p, e).kind === 'gpio' && (terminal(p, e).voltage ?? 0) > 3.3,
          ),
        )
      )
        add({
          id: `encoder-bus-${component.id}`,
          requiresAgentResolution: true,
          severity: 'warning',
          layer: 'electrical',
          title: `${component.ref}: I²C logic and pull-ups need review`,
          detail:
            'A 3.3 V-listed module bus is directly connected to a higher-voltage board GPIO. Module pull-up rails/routing and logic compatibility are not verified. A chip datasheet alone does not verify this breakout; identify appropriate level conversion/pull-ups or confirm the actual interface before physical use.',
          objectIds: [component.id, ...connected('sda').map((e) => e.componentId)],
          rule: 'encoder.bus-interface',
          evidenceIds: ['as-photo'],
          nextAction:
            'Add an appropriate documented I²C level shifter with both reference supplies and common ground; preserve both data paths. Never assume 5 V tolerance.',
        });
      const supply = part.kind === 'encoder' ? 'vcc' : 'power';
      const hasSource = connected(supply).some((e) => {
        const c = p.components.find((c) => c.id === e.componentId)!,
          kind = partById(c.partId).kind;
        return (
          (kind === 'board' && terminal(p, e).kind === 'power') ||
          (kind === 'supply' &&
            e.terminalId === 'positive' &&
            c.config.supplyVoltageV !== undefined)
        );
      });
      if (!hasSource || !connected('gnd').length)
        add({
          id: `supply-${component.id}`,
          severity: 'error',
          requiresAgentResolution: true,
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
      if (part.kind === 'encoder') {
        const analog = signalEndpoints(p, { componentId: component.id, terminalId: 'out' }).some(
          (e) => terminal(p, e).kind === 'gpio',
        );
        const connectedBus = (pin: string) =>
          signalEndpoints(p, { componentId: component.id, terminalId: pin }).some(
            (e) => e.componentId !== component.id && terminal(p, e).kind === 'gpio',
          );
        if (!analog && (!connectedBus('sda') || !connectedBus('scl')))
          add({
            id: `encoder-data-${component.id}`,
            severity: 'error',
            requiresAgentResolution: true,
            layer: 'electrical',
            title: `${component.ref}: encoder data path incomplete`,
            detail:
              'Power alone does not report angle. Document both I²C lines through a suitable interface, or an explicitly configured OUT path. Removing bus wires does not repair a logic mismatch.',
            objectIds: [component.id],
            rule: 'encoder.data-path',
            evidenceIds: ['as-photo'],
          });
      }
      if (
        part.kind === 'servo' &&
        !signalEndpoints(p, { componentId: component.id, terminalId: 'signal' }).some(
          (e) => terminal(p, e).kind === 'gpio',
        )
      )
        add({
          id: `servo-control-${component.id}`,
          severity: 'error',
          requiresAgentResolution: true,
          layer: 'electrical',
          title: `${component.ref}: servo control is disconnected`,
          detail:
            'A powered servo still needs an explicit controller signal and common ground. A software command is not measured feedback.',
          objectIds: [component.id],
          rule: 'servo.control-path',
          evidenceIds: ['sg90-reference'],
        });
      const board = p.components.find((c) => c.id === p.targetBoardId);
      const boardGround =
        board && partById(board.partId).terminals.find((t) => t.kind === 'ground');
      if (
        board &&
        boardGround &&
        connected('gnd').length &&
        netFor(nets, { componentId: component.id, terminalId: 'gnd' })?.id !==
          netFor(nets, { componentId: board.id, terminalId: boardGround.id })?.id
      )
        add({
          id: `reference-${component.id}`,
          severity: 'error',
          requiresAgentResolution: true,
          layer: 'electrical',
          title: `${component.ref}: controller ground reference missing`,
          detail:
            'External supply negative, controller ground and peripheral reference must be explicitly documented as common for this non-isolated interface.',
          objectIds: [component.id, board.id],
          rule: 'part.common-reference',
          evidenceIds: part.evidence.map((e) => e.id),
        });
    }
  }
  for (const c of p.components.filter((c) => c.partId === 'adafruit-757')) {
    const low = netVoltage(p, { componentId: c.id, terminalId: 'lv' }),
      high = netVoltage(p, { componentId: c.id, terminalId: 'hv' });
    const grounds = netFor(nets, { componentId: c.id, terminalId: 'gnd' })?.terminals ?? [];
    const grounded = grounds.some(
      (e) => e.componentId !== c.id && terminal(p, e).kind === 'ground',
    );
    if (
      low === undefined ||
      high === undefined ||
      !grounded ||
      low >= high ||
      low < 1.8 ||
      high > 10
    )
      add({
        id: `translator-supply-${c.id}`,
        severity: 'error',
        requiresAgentResolution: true,
        layer: 'electrical',
        title: `${c.ref}: level-shifter supplies need wiring`,
        detail:
          'Connect LV to the low-voltage reference, HV to the higher-voltage reference, and ground to both systems. These open-drain channels have onboard pull-ups; they are not supply or motor drivers. Declared 1.8–10 V operating scope does not verify an unknown module.',
        objectIds: [c.id],
        rule: 'translator.references',
        evidenceIds: partById(c.partId).evidence.map((e) => e.id),
      });
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
  const literals = p.files.flatMap((f) =>
    [
      ...f.content
        .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"/g, (m) =>
          m.startsWith('/') ? ' '.repeat(m.length) : m,
        )
        .matchAll(/Serial\.(?:print|println)\s*\(\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g),
    ].map((m) => m[1]),
  );
  for (const mapping of p.telemetry) {
    if (!mapping.units.trim() && ['raw', 'measurement', 'command'].includes(mapping.meaning))
      add({
        id: `telemetry-units-${mapping.id}`,
        requiresAgentResolution: true,
        severity: 'warning',
        layer: 'firmware',
        title: `${mapping.label}: units not declared`,
        detail:
          'Declare the actual reported units (ADC counts, degrees, microseconds, or explicitly unitless as appropriate). The parser cannot infer physical units or turn a command into measured feedback.',
        objectIds: [mapping.id, ...(mapping.componentId ? [mapping.componentId] : [])],
        rule: 'telemetry.units',
        evidenceIds: [],
        nextAction:
          'Set the channel units from visible firmware semantics; leave physical interpretation unknown when needed.',
      });
    if (
      mapping.parser === 'keyvalue' &&
      literals.some((t) => t.includes(`${mapping.field}:`)) &&
      !literals.some((t) => t.includes(`${mapping.field}=`))
    )
      add({
        id: `telemetry-format-${mapping.id}`,
        requiresAgentResolution: true,
        severity: 'warning',
        layer: 'firmware',
        title: `${mapping.label}: reporting delimiter mismatch`,
        detail:
          'The visible literal Serial label uses a colon, but this channel parser requires key=value. Change visible reporting or choose an actually supported parser; missing values must not become zero.',
        objectIds: [...(mapping.componentId ? [mapping.componentId] : []), mapping.id],
        rule: 'telemetry.literal-format',
        evidenceIds: [],
        nextAction: 'Align the channel field/parser with visible firmware output.',
      });
    const component = p.components.find((c) => c.id === mapping.componentId);
    const stateLabel = /\b(state|blocked|pressed|closed|open)\b/i.test(
      mapping.label + ' ' + mapping.field.replace(/_/g, ' '),
    );
    const fieldPattern = mapping.field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const literalRawState =
      stateLabel &&
      p.files.some((file) => {
        const variables = [
          ...file.content.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*analogRead\s*\([^;]+\)\s*;/g),
        ].map((m) => m[1]);
        return variables.some((name) =>
          new RegExp(
            `["']${fieldPattern}=["']\\s*\\)\\s*;\\s*Serial\\.(?:print|println)\\s*\\(\\s*${name}\\s*\\)`,
          ).test(file.content),
        );
      });
    if (
      stateLabel &&
      mapping.meaning !== 'count' &&
      (/counts?/i.test(mapping.units) ||
        ['measurement', 'raw'].includes(mapping.meaning) ||
        literalRawState)
    )
      add({
        id: `telemetry-state-${mapping.id}`,
        severity: 'warning',
        requiresAgentResolution: true,
        layer: 'firmware',
        title: `${mapping.label}: raw reading is not a discrete state`,
        detail:
          'A state/blocked readout must report the actual derived state with declared semantics. Raw ADC counts are not automatically a blocked/pressed boolean. Use visible digitalRead or a documented threshold/calibration, publish that state, and map it as state; keep a separate raw channel if useful. This check only recognizes simple literal reporting, not arbitrary code.',
        objectIds: [mapping.id, ...(mapping.componentId ? [mapping.componentId] : [])],
        rule: 'telemetry.state-semantics',
        evidenceIds: [],
      });
    if (component && partById(component.partId).kind === 'board' && mapping.terminalId) {
      const related =
        netFor(nets, {
          componentId: component.id,
          terminalId: mapping.terminalId,
        })?.terminals.filter(
          (e) =>
            e.componentId !== component.id &&
            ['servo', 'encoder', 'potentiometer', 'photointerruptor'].includes(
              partById(p.components.find((c) => c.id === e.componentId)!.partId).kind,
            ),
        ) ?? [];
      if (related.length === 1)
        add({
          id: `telemetry-component-${mapping.id}`,
          requiresAgentResolution: true,
          severity: 'warning',
          layer: 'firmware',
          title: `${mapping.label}: associate the reporting component`,
          detail: `The mapped board terminal connects to ${related[0].componentId}. The readout is currently associated with the board; explicitly associate the sensor/actuator so its provenance and meaning remain clear. This does not imply mechanical linkage or measured feedback.`,
          objectIds: [component.id, related[0].componentId, mapping.id],
          rule: 'telemetry.component-association',
          evidenceIds: [],
          fix: {
            summary: `Associate ${mapping.label} with ${related[0].componentId}`,
            commands: [
              {
                type: 'setTelemetry',
                mapping: {
                  ...mapping,
                  componentId: related[0].componentId,
                  terminalId: related[0].terminalId,
                },
              },
            ],
          },
        });
    }
  }
  return result;
}
