import { validateProject, terminal } from '../domain/project';
import { buildKey, stableKey } from '../domain/semantics';
import type { Component, Endpoint, Project } from '../domain/schema';
import { deriveNets, netFor } from '../domain/topology';
import { constantValue, validateCircuit } from '../domain/validation';
import { partById } from '../parts/catalog';
import type { RunResult } from '../services/bridge';
import type { EvaluationCase } from './cases';

export interface ArtifactCheck {
  name: string;
  passed: boolean;
  detail: string;
}
export interface ArtifactEvaluation {
  checks: ArtifactCheck[];
  outcome: 'pass' | 'fail' | 'clarification';
  reasons: string[];
}

/** Artifact predicates are deliberately independent of a model's self-assessment.
 * They check the supported subset, not arbitrary C++ or universal electrical safety.
 * A successful fixture build is still a fixture: the harness reports provenance.
 */
export function evaluateArtifacts(
  task: EvaluationCase,
  project: Project,
  build?: RunResult,
  transcript = '',
): ArtifactEvaluation {
  const checks: ArtifactCheck[] = [];
  const add = (name: string, passed: boolean, detail: string) =>
    checks.push({ name, passed, detail });
  let p: Project;
  try {
    p = validateProject(project);
    add(
      'valid-project',
      true,
      'Versioned package, endpoint, file, layout and mapping references validate.',
    );
  } catch (error) {
    add('valid-project', false, error instanceof Error ? error.message : 'Invalid project');
    return {
      checks,
      outcome: 'fail',
      reasons: checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`),
    };
  }
  const e = task.expectations,
    seed = task.seed;
  const code = p.files.map((f) => f.content).join('\n');
  const analysisCode = code.replace(
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (match) => (match.startsWith('/') ? ' '.repeat(match.length) : match),
  );
  const nets = deriveNets(p);
  const at = (c: Component, terminalId: string): Endpoint => ({ componentId: c.id, terminalId });
  const connected = (a: Endpoint, b: Endpoint) => netFor(nets, a)?.id === netFor(nets, b)?.id;
  const members = (endpoint: Endpoint) => netFor(nets, endpoint)?.terminals ?? [];
  const kind = (endpoint: Endpoint) => terminal(p, endpoint).kind;
  const hasGround = (endpoint: Endpoint) => members(endpoint).some((m) => kind(m) === 'ground');
  const hasPositiveSupply = (endpoint: Endpoint, max?: number) =>
    members(endpoint).some((m) => {
      const t = terminal(p, m);
      return (
        m.componentId !== endpoint.componentId &&
        t.kind === 'power' &&
        t.voltage !== undefined &&
        t.voltage > 0 &&
        (max === undefined || t.voltage <= max)
      );
    });
  const boardGpios = (endpoint: Endpoint, capability?: string) =>
    members(endpoint).filter((m) => {
      const c = p.components.find((c) => c.id === m.componentId)!;
      const t = terminal(p, m);
      return (
        partById(c.partId).kind === 'board' &&
        t.kind === 'gpio' &&
        (!capability || t.capabilities.includes(capability))
      );
    });
  const components = (name: ReturnType<typeof partById>['kind']) =>
    p.components.filter((c) => partById(c.partId).kind === name);
  const nonzeroResistors = p.components.filter(
    (c) =>
      partById(c.partId).kind === 'resistor' &&
      (c.config.resistanceOhms ?? partById(c.partId).resistance ?? 0) > 0,
  );
  const resistorPath = (
    endpoint: Endpoint,
    end: (opposite: Endpoint) => boolean,
    acceptable: (resistor: Component) => boolean = () => true,
  ) =>
    nonzeroResistors.some((r) => {
      if (!acceptable(r)) return false;
      const pins = partById(r.partId).terminals;
      return pins.some((t, index) => {
        const here = at(r, t.id),
          other = at(r, pins[1 - index].id);
        return connected(endpoint, here) && !connected(here, other) && end(other);
      });
    });
  const hasLiteralRead = (fn: 'analogRead' | 'digitalRead', endpoint: Endpoint) => {
    const aliases = boardGpios(endpoint).flatMap((pin) => {
      const alias = terminal(p, pin).firmwareAlias;
      return alias
        ? [alias, ...(/^A\d+$/.test(alias) ? [String(54 + Number(alias.slice(1)))] : [])]
        : [];
    });
    const calls = [
      ...analysisCode.matchAll(
        new RegExp(`\\b${fn}\\s*\\(\\s*([A-Za-z_][A-Za-z0-9_]*|\\d+)\\s*\\)`, 'g'),
      ),
    ];
    return calls.some((call) => {
      const argument = call[1];
      if (aliases.includes(argument)) return true;
      const declaration = new RegExp(
        `(?:\\b(?:const|constexpr)\\b[^;\\n]*\\b${argument}\\s*=\\s*|#define[ \\t]+${argument}[ \\t]+)(A\\d+|\\d+)\\b`,
      );
      return aliases.includes(analysisCode.match(declaration)?.[1] ?? '');
    });
  };
  if (e.preserveComponents)
    add(
      'preserved-components',
      seed.components.every((c) =>
        p.components.some(
          (after) =>
            after.id === c.id &&
            after.partId === c.partId &&
            after.partVersion === c.partVersion &&
            stableKey(after.config) === stableKey(c.config),
        ),
      ),
      'Existing component identity, version and properties remain.',
    );
  if (e.preserveWires)
    add(
      'preserved-wiring',
      seed.wires.every((w) =>
        p.wires.some(
          (after) =>
            after.id === w.id && stableKey([after.from, after.to]) === stableKey([w.from, w.to]),
        ),
      ),
      'Existing explicit wire endpoints remain.',
    );
  for (const fileId of e.preserveFiles ?? []) {
    const before = seed.files.find((f) => f.id === fileId);
    add(
      `preserved-file:${fileId}`,
      !!before &&
        p.files.some(
          (f) => f.id === fileId && f.path === before.path && f.content === before.content,
        ),
      'Unrelated file identity, path and exact source bytes remain.',
    );
  }
  for (const fragment of e.preserveFragments ?? [])
    add(
      `preserved-code:${fragment}`,
      code.includes(fragment),
      'Required existing logic fragment remains; runtime equivalence is not inferred.',
    );
  if (e.explainOnly) {
    add(
      'read-only',
      stableKey({ ...p, revision: 0 }) === stableKey({ ...seed, revision: 0 }),
      'Explain must preserve the complete project.',
    );
    add(
      'substantive-explanation',
      transcript.trim().length >= 35 &&
        /current|resistor|report|serial|firmware|telemetry/i.test(transcript),
      'A concise relevant explanation is present, not just a completion claim.',
    );
  }

  const beforeKinds = seed.components.length;
  const clarification = e.clarification;
  const matchedConcepts =
    clarification?.concepts.filter((alternatives) =>
      alternatives.some((s) => transcript.toLowerCase().includes(s.toLowerCase())),
    ).length ?? 0;
  const hasFocusedQuestion =
    /\?/.test(transcript) &&
    /confirm|which|what|can you|could you|do you|have you|is your|are your/i.test(transcript);
  const explicitLimitation =
    /unavailable|unsupported|not installed|not available|not report|does not report|no serial|no telemetry|no sensor/i.test(
      transcript,
    );
  const correctlyFocused =
    !!clarification &&
    matchedConcepts >= clarification.minimum &&
    (clarification.limitation ? explicitLimitation : hasFocusedQuestion);
  const preservationFailures = checks.some((c) => !c.passed);
  // Clarification is not a loophole for replacing an existing project or claiming completed work.
  // It may contain preparatory edits, but never a supply short or invented package/endpoint.
  const unsafeErrors = validateCircuit(p).filter(
    (d) => d.severity === 'error' && d.layer === 'electrical',
  );
  if (
    correctlyFocused &&
    !preservationFailures &&
    unsafeErrors.length === 0 &&
    p.components.length >= beforeKinds
  ) {
    add(
      'focused-clarification',
      true,
      `Identifies ${matchedConcepts} case-specific unknowns/limitations. No physical outcome is asserted by this oracle.`,
    );
    return {
      checks,
      outcome: 'clarification',
      reasons: [
        clarification!.limitation
          ? 'Specific unsupported/unreported capability identified; implementation is blocked honestly.'
          : 'Focused physical/interface clarification is needed; no completed hardware workflow is claimed.',
      ],
    };
  }
  if (clarification && !e.requiredKinds && !e.explainOnly)
    add(
      'focused-clarification',
      false,
      'Requires a specific missing fact or explicit limitation, not generic advice or an unsupported success claim.',
    );
  if (e.explainOnly)
    return {
      checks,
      outcome: checks.every((c) => c.passed) ? 'pass' : 'fail',
      reasons: checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`),
    };

  for (const expected of e.requiredKinds ?? [])
    add(
      `part:${expected}`,
      components(expected).length > 0,
      `At least one supported ${expected} instance exists.`,
    );
  if (e.requiredKinds?.includes('board')) {
    const boards = components('board');
    const megas = boards.filter((b) => b.partId === 'arduino-mega-r3');
    const seedBoards = seed.components.filter((c) => partById(c.partId).kind === 'board');
    add(
      'one-mega-target',
      megas.length === 1 &&
        boards.length <= Math.max(1, seedBoards.length) &&
        p.targetBoardId === megas[0].id,
      'Exactly one Mega 2560 is selected; only pre-existing auxiliary boards are allowed, and continuation must not duplicate the target.',
    );
  }
  const diagnostics = validateCircuit(p);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  add(
    'no-known-errors',
    errors.length === 0,
    errors.length
      ? errors.map((d) => `${d.id}: ${d.title}`).join('; ')
      : 'No error in the current scoped deterministic checks; unknown coverage remains unknown.',
  );
  for (const rule of e.resolveRules ?? [])
    add(
      `resolved:${rule}`,
      !diagnostics.some((d) => d.rule === rule && ['error', 'warning'].includes(d.severity)),
      'Targeted rule has no remaining error/warning in the actual current project.',
    );

  if (e.requiredKinds?.includes('led')) {
    const leds = components('led');
    add(
      'led-series-path',
      leds.length > 0 &&
        leds.every((c) => {
          const a = at(c, 'a'),
            k = at(c, 'k');
          if (connected(a, k)) return false;
          // Accept high-side or low-side limiting, but a bypassed resistor never counts.
          const highSide =
            !boardGpios(a).length &&
            !hasPositiveSupply(a) &&
            resistorPath(a, (other) => boardGpios(other).length > 0 || hasPositiveSupply(other)) &&
            hasGround(k);
          const lowSide =
            (boardGpios(a).length > 0 || hasPositiveSupply(a)) &&
            !hasGround(k) &&
            resistorPath(k, hasGround);
          return highSide || lowSide;
        }),
      'LED terminals are separate nets with a positive resistor in the drive/return path; a resistor merely nearby or bypassed does not count.',
    );
    add(
      'led-nominal-current',
      leds.length > 0 &&
        leds.every((c) => {
          const acceptable = (r: Component) => {
            const resistance = r.config.resistanceOhms ?? partById(r.partId).resistance!;
            const forward = c.config.forwardVoltageV ?? partById(c.partId).forwardV;
            const threshold = c.config.maxCurrentMa ?? partById(c.partId).maxCurrentMa ?? 10;
            // The target is Mega; this is a documented nominal 5 V calculation only.
            return (
              forward !== undefined &&
              Math.max(0, ((5 - forward) / resistance) * 1000) <= Math.min(20, threshold)
            );
          };
          return (
            resistorPath(
              at(c, 'a'),
              (other) => boardGpios(other).length > 0 || hasPositiveSupply(other),
              acceptable,
            ) || resistorPath(at(c, 'k'), hasGround, acceptable)
          );
        }),
      'The actual series resistor meets the configured LED analysis threshold and Mega 20 mA limit at assumed nominal 5 V; this is not a guaranteed measured current.',
    );
    add(
      'led-explicit-binding',
      leds.length > 0 &&
        leds.every((c) => {
          const drivePins = [...boardGpios(at(c, 'a'))];
          for (const r of nonzeroResistors) {
            const pins = partById(r.partId).terminals;
            for (let i = 0; i < pins.length; i++)
              if (connected(at(c, 'a'), at(r, pins[i].id)))
                drivePins.push(...boardGpios(at(r, pins[1 - i].id)));
          }
          return p.bindings.some((b) => {
            const file = p.files.find((f) => f.id === b.fileId)!;
            const pin = terminal(p, { componentId: b.boardId, terminalId: b.terminalId });
            return (
              (b.mode === 'output' || b.mode === 'pwm') &&
              drivePins.some(
                (ep) => ep.componentId === b.boardId && terminal(p, ep).gpio === pin.gpio,
              ) &&
              connected(b.target, { componentId: b.boardId, terminalId: b.terminalId }) &&
              constantValue(file.content, b.symbol) === Number(pin.firmwareAlias)
            );
          });
        }),
      'A supported literal firmware binding describes the actual LED drive GPIO, not merely an unrelated constant or wire.',
    );
    add(
      'led-visible-control',
      /digitalWrite\s*\(/.test(analysisCode) && /pinMode\s*\(/.test(analysisCode),
      'Visible source contains LED control/setup; actual compilation is checked independently.',
    );
  }
  if (e.requiredKinds?.includes('potentiometer')) {
    const pots = components('potentiometer');
    add(
      'potentiometer-divider',
      pots.length > 0 &&
        pots.every((c) => {
          const a = at(c, 'p1'),
            b = at(c, 'p2'),
            w = at(c, 'wiper');
          return (
            !connected(a, b) &&
            !connected(a, w) &&
            !connected(b, w) &&
            ((hasPositiveSupply(a, 5) && hasGround(b)) ||
              (hasPositiveSupply(b, 5) && hasGround(a))) &&
            boardGpios(w, 'adc').length === 1
          );
        }),
      'Opposite ends reach supply/ground and the isolated wiper reaches one documented ADC terminal.',
    );
    add(
      'analog-visible-read',
      pots.length > 0 && pots.every((c) => hasLiteralRead('analogRead', at(c, 'wiper'))),
      'A supported visible literal/constant analogRead refers to the actual wiper ADC pin; arbitrary C++ analysis is not claimed.',
    );
  }
  if (e.requiredKinds?.includes('photointerruptor')) {
    const optos = components('photointerruptor');
    add(
      'itr-emitter-detector',
      optos.length > 0 &&
        optos.every((c) => {
          if (c.partId !== 'itr9608-dip4') return false;
          const a = at(c, 'a'),
            k = at(c, 'k'),
            collector = at(c, 'c'),
            emitter = at(c, 'e');
          const emitterPath =
            resistorPath(
              a,
              (other) => hasPositiveSupply(other, 5) || boardGpios(other).length > 0,
            ) &&
            !hasPositiveSupply(a) &&
            !boardGpios(a).length &&
            hasGround(k);
          const pullup =
            resistorPath(collector, (other) => hasPositiveSupply(other, 5)) ||
            p.bindings.some((b) => b.mode === 'input_pullup' && connected(b.target, collector));
          return (
            emitterPath &&
            hasGround(emitter) &&
            pullup &&
            boardGpios(collector).length === 1 &&
            !connected(a, collector) &&
            !connected(collector, emitter)
          );
        }),
      'Bare DIP-4 has independent current-limited emitter and loaded phototransistor, with real collector GPIO connectivity.',
    );
    add(
      'digital-visible-read',
      optos.length > 0 && optos.every((c) => hasLiteralRead('digitalRead', at(c, 'c'))),
      'A supported visible literal/constant digitalRead refers to the actual collector GPIO, not an invented signal.',
    );
  }
  if (e.telemetry) {
    const relevant =
      e.telemetry === 'analog'
        ? components('potentiometer')
        : e.telemetry === 'digital'
          ? components('photointerruptor')
          : components('encoder');
    const reported = (component: Component, meanings: string[]) =>
      p.telemetry.some(
        (m) =>
          m.componentId === component.id &&
          meanings.includes(m.meaning) &&
          m.field.trim() &&
          m.units.trim() &&
          m.staleAfterMs >= 100 &&
          analysisCode.includes(m.field.split('.').at(-1)!) &&
          /Serial\.(?:print|write)/.test(analysisCode) &&
          /Serial\.begin\s*\(/.test(analysisCode),
      );
    add(
      'telemetry-source',
      relevant.length > 0 &&
        relevant.every((c) =>
          reported(
            c,
            e.telemetry === 'digital' ? ['state', 'count', 'raw'] : ['measurement', 'raw'],
          ),
        ),
      'Configured stable channels have an explicit parser/field, component association, declared units, stale threshold and visible serial field text. This is static evidence, not a physical sample.',
    );
    if (e.telemetry === 'encoder-servo') {
      const encoders = components('encoder'),
        servos = components('servo');
      add(
        'command-distinct-from-measurement',
        servos.length > 0 &&
          servos.every((c) => reported(c, ['command'])) &&
          encoders.every((c) => reported(c, ['measurement'])),
        'Servo channels are commands; encoder channels are measurements. No servo feedback terminal/measurement is invented.',
      );
      add(
        'encoder-interface',
        encoders.length > 0 &&
          encoders.every((c) => {
            const supplies = members(at(c, 'vcc'))
              .filter((ep) => ep.componentId !== c.id)
              .map((ep) => terminal(p, ep))
              .filter((t) => t.kind === 'power' && t.voltage !== undefined);
            const supplySafe =
              supplies.some((t) => t.voltage === 3.3) &&
              supplies.every((t) => t.voltage! <= 3.3) &&
              hasGround(at(c, 'gnd'));
            const analog =
              boardGpios(at(c, 'out'), 'adc').length === 1 &&
              hasLiteralRead('analogRead', at(c, 'out')) &&
              /analog|OUT|calibrat/i.test(transcript);
            const i2c =
              boardGpios(at(c, 'sda'), 'i2c').some((ep) =>
                ['sda', 'd20'].includes(ep.terminalId),
              ) &&
              boardGpios(at(c, 'scl'), 'i2c').some((ep) =>
                ['scl', 'd21'].includes(ep.terminalId),
              ) &&
              /Wire\.(?:requestFrom|read|beginTransmission)/.test(analysisCode) &&
              /pull.?up|level.?shift|3\.3/.test(transcript);
            return supplySafe && (analog || i2c);
          }),
        'Photo-matched module uses 3.3 V/reference and an explicit supported OUT/ADC or documented I²C path. Module pull-ups and conversion assumptions must be stated; no 5 V tolerance is assumed.',
      );
      add(
        'servo-signal',
        servos.length > 0 &&
          servos.every(
            (c) => boardGpios(at(c, 'signal')).length === 1 && hasGround(at(c, 'gnd')),
          ) &&
          ((/\.attach\s*\(/.test(analysisCode) &&
            /\.write(?:Microseconds)?\s*\(/.test(analysisCode)) ||
            (/digitalWrite\s*\(/.test(analysisCode) &&
              /delayMicroseconds\s*\(/.test(analysisCode))),
        'Servo control reaches one GPIO with common reference and visible pulse/control source.',
      );
      add(
        'external-servo-power-boundary',
        servos.length > 0 &&
          servos.every(
            (c) =>
              !members(at(c, 'power')).some(
                (ep) =>
                  p.components.find((x) => x.id === ep.componentId)?.partId === 'arduino-mega-r3',
              ),
          ) &&
          /external.{0,35}(?:power|supply)|(?:power|supply).{0,35}external/i.test(transcript),
        'Generic servo load is not silently assigned to an unverified Mega power budget; missing external equipment is explicit.',
      );
      add(
        'mechanical-calibration-boundary',
        /magnet/i.test(transcript) &&
          /align|coupl|shaft|mechanic/i.test(transcript) &&
          /zero|calibrat|direction/i.test(transcript),
        'Magnet/mechanical coupling and calibration/zero/direction assumptions are explicit.',
      );
    }
  }
  if (e.compile)
    add(
      'current-build',
      !!build?.success &&
        !build.cancelled &&
        (build.buildKey ? build.buildKey === buildKey(p) : build.revision === p.revision),
      build
        ? `Build ${build.success ? 'succeeded' : 'failed'}; semantic source/target freshness must match. ${build.output.slice(-350)}`
        : 'No build result was recorded. A claim of compilation is insufficient.',
    );
  const failed = checks.filter((c) => !c.passed);
  return {
    checks,
    outcome: failed.length ? 'fail' : 'pass',
    reasons: failed.map((c) => `${c.name}: ${c.detail}`),
  };
}
