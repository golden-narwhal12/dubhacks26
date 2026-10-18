import { describe, expect, it } from 'vitest';
import { exampleProject } from '../src/domain/example';
import { validateProject } from '../src/domain/project';
import { buildKey } from '../src/domain/semantics';
import type { Component, Project, Wire } from '../src/domain/schema';
import { evaluateArtifacts } from '../src/evaluation/oracles';
import { evaluationCases, freshSeed, getEvaluationCase } from '../src/evaluation/cases';
import type { RunResult } from '../src/services/bridge';

const build = (p: Project): RunResult => ({
  success: true,
  revision: p.revision,
  kind: 'build',
  output: 'Fixture compiler success (not a live toolchain test)',
  durationMs: 1,
  buildKey: buildKey(p),
});
const part = (p: Project, id: string, partId: string, ref: string) => {
  const c: Component = { id, partId, ref, partVersion: 1, config: {} };
  p.components.push(c);
  for (const v of ['wiring', 'schematic'] as const)
    p.layouts[v][id] = { x: p.components.length * 50, y: 200, rotation: 0 };
  return c;
};
const wire = (p: Project, a: string, b: string) => {
  const endpoint = (s: string) => {
    const [componentId, terminalId] = s.split(':');
    return { componentId, terminalId };
  };
  const w: Wire = {
    id: `wire-${p.wires.length}`,
    from: endpoint(a),
    to: endpoint(b),
    color: 'mint',
  };
  p.wires.push(w);
};
const pot = (p: Project) => {
  if (!p.files[0].content.includes('Serial.begin'))
    p.files[0].content = p.files[0].content.replace(
      'void setup() {',
      'void setup() { Serial.begin(115200);',
    );
  part(p, 'pot', 'potentiometer-generic', 'RV1');
  wire(p, 'pot:p1', 'board:5v');
  wire(p, 'pot:p2', 'board:gnd1');
  wire(p, 'pot:wiper', 'board:a1');
  p.files[0].content +=
    '\nvoid samplePot() { Serial.print("pot_raw="); Serial.println(analogRead(A1)); }\n';
  p.telemetry.push({
    id: 'pot-raw',
    label: 'Potentiometer ADC',
    parser: 'keyvalue',
    field: 'pot_raw',
    componentId: 'pot',
    terminalId: 'wiper',
    units: 'ADC counts',
    meaning: 'raw',
    staleAfterMs: 1000,
  });
};
const bareItr = () => {
  const p = freshSeed('itr9608');
  part(p, 'board', 'arduino-mega-r3', 'U1');
  p.targetBoardId = 'board';
  part(p, 'opto', 'itr9608-dip4', 'Q1');
  part(p, 'emitter-resistor', 'generic-resistor', 'R1');
  part(p, 'collector-resistor', 'generic-resistor', 'R2');
  wire(p, 'board:5v', 'emitter-resistor:p1');
  wire(p, 'emitter-resistor:p2', 'opto:a');
  wire(p, 'opto:k', 'board:gnd1');
  wire(p, 'opto:e', 'board:gnd1');
  wire(p, 'opto:c', 'collector-resistor:p1');
  wire(p, 'collector-resistor:p2', 'board:5v');
  wire(p, 'opto:c', 'board:d7');
  p.files[0].content =
    'void setup(){Serial.begin(115200);pinMode(7,INPUT);}\nvoid loop(){Serial.print("blocked=");Serial.println(digitalRead(7));delay(100);}\n';
  p.telemetry.push({
    id: 'blocked',
    label: 'Blocked state',
    parser: 'keyvalue',
    field: 'blocked',
    componentId: 'opto',
    terminalId: 'c',
    units: 'state',
    meaning: 'state',
    staleAfterMs: 1000,
  });
  return validateProject(p);
};
const encoderServo = () => {
  const p = freshSeed('servo-encoder');
  part(p, 'board', 'arduino-mega-r3', 'U1');
  p.targetBoardId = 'board';
  part(p, 'encoder', 'as5600-module-photo', 'U2');
  part(p, 'servo', 'sg90-generic', 'M1');
  wire(p, 'encoder:vcc', 'board:3v3');
  wire(p, 'encoder:gnd', 'board:gnd1');
  wire(p, 'encoder:out', 'board:a0');
  wire(p, 'servo:signal', 'board:d9');
  wire(p, 'servo:gnd', 'board:gnd1');
  p.files[0].content =
    '// Visible assumed analog OUT conversion requires physical calibration.\nvoid setup(){Serial.begin(115200);pinMode(9,OUTPUT);}\nvoid loop(){int servoCommand=90;digitalWrite(9,HIGH);delayMicroseconds(1500);digitalWrite(9,LOW);float encoderDeg=analogRead(A0)*360.0/1023;Serial.print("command_deg=");Serial.print(servoCommand);Serial.print(" encoder_deg=");Serial.println(encoderDeg);delay(20);}\n';
  p.telemetry.push(
    {
      id: 'encoder-angle',
      label: 'Encoder angle',
      parser: 'keyvalue',
      field: 'encoder_deg',
      componentId: 'encoder',
      units: 'deg',
      meaning: 'measurement',
      staleAfterMs: 1000,
    },
    {
      id: 'servo-command',
      label: 'Commanded position',
      parser: 'keyvalue',
      field: 'command_deg',
      componentId: 'servo',
      units: 'deg',
      meaning: 'command',
      staleAfterMs: 1000,
    },
  );
  return p;
};
const encoderReport =
  'Analog OUT behavior and scale must be confirmed/calibrated for this 3.3 V module. Use an external power supply sized for the actual servo; its power terminal is intentionally pending that supply. Align and couple the magnet to the servo shaft; calibrate zero and direction. Commanded position is not measured feedback.';

describe('evaluation seeds and artifact oracles', () => {
  it('seeds cover the ladder and are independently valid and reproducible', () => {
    expect(evaluationCases.length).toBeGreaterThanOrEqual(10);
    expect(new Set(evaluationCases.map((c) => c.id)).size).toBe(evaluationCases.length);
    for (const task of evaluationCases) expect(validateProject(freshSeed(task))).toEqual(task.seed);
    const seed = freshSeed('led');
    seed.files[0].content = 'changed';
    expect(freshSeed('led').files[0].content).not.toBe('changed');
    expect(() => getEvaluationCase('invented')).toThrow('Unknown evaluation');
  });
  it('accepts equivalent LED pin/resistance choices and rejects prose-only completion', () => {
    const p = exampleProject();
    p.wires[0].from.terminalId = 'd12';
    p.bindings[0].terminalId = 'd12';
    p.files[0].content = p.files[0].content.replace('LED_PIN = 13', 'LED_PIN = 12');
    p.components.find((c) => c.id === 'resistor')!.config.resistanceOhms = 470;
    expect(evaluateArtifacts(getEvaluationCase('led'), p, build(p)).outcome).toBe('pass');
    expect(
      evaluateArtifacts(
        getEvaluationCase('led'),
        freshSeed('led'),
        undefined,
        'I built and verified the LED circuit.',
      ).outcome,
    ).toBe('fail');
  });
  it('does not count a bypassed or disconnected resistor as current limiting', () => {
    const p = exampleProject();
    wire(p, 'board:d13', 'led:a');
    const result = evaluateArtifacts(getEvaluationCase('led'), p, build(p));
    expect(result.outcome).toBe('fail');
    expect(result.checks.find((c) => c.name === 'led-series-path')?.passed).toBe(false);
    p.wires = p.wires.filter((w) => w.id !== 'signal');
    expect(evaluateArtifacts(getEvaluationCase('led'), p, build(p)).outcome).toBe('fail');
  });
  it('rejects a dangerously small resistor and missing firmware binding', () => {
    const p = exampleProject();
    p.components.find((c) => c.id === 'resistor')!.config.resistanceOhms = 1;
    expect(
      evaluateArtifacts(getEvaluationCase('led'), p, build(p)).checks.find(
        (c) => c.name === 'led-nominal-current',
      )?.passed,
    ).toBe(false);
    p.components.find((c) => c.id === 'resistor')!.config.resistanceOhms = 330;
    p.bindings = [];
    expect(
      evaluateArtifacts(getEvaluationCase('led'), p, build(p)).checks.find(
        (c) => c.name === 'led-explicit-binding',
      )?.passed,
    ).toBe(false);
  });
  it('requires a matching successful build and accepts layout-only freshness', () => {
    const p = exampleProject(),
      result = build(p);
    p.revision++;
    p.layouts.wiring.led.x += 40;
    expect(evaluateArtifacts(getEvaluationCase('led'), p, result).outcome).toBe('pass');
    p.files[0].content += '// source changed';
    expect(
      evaluateArtifacts(getEvaluationCase('led'), p, result).checks.find(
        (c) => c.name === 'current-build',
      )?.passed,
    ).toBe(false);
    expect(
      evaluateArtifacts(getEvaluationCase('led'), p, { ...build(p), success: false }).outcome,
    ).toBe('fail');
  });
  it('checks potentiometer net separation, declared reporting and actual ADC capability', () => {
    const p = freshSeed('potentiometer');
    part(p, 'board', 'arduino-mega-r3', 'U1');
    p.targetBoardId = 'board';
    pot(p);
    expect(evaluateArtifacts(getEvaluationCase('potentiometer'), p, build(p)).outcome).toBe('pass');
    p.wires.find((w) => w.from.terminalId === 'wiper')!.to.terminalId = 'd4';
    expect(
      evaluateArtifacts(getEvaluationCase('potentiometer'), p, build(p)).checks.find(
        (c) => c.name === 'potentiometer-divider',
      )?.passed,
    ).toBe(false);
  });
  it('continuation preserves unrelated work and rejects duplicate target boards', () => {
    const task = getEvaluationCase('continue-circuit'),
      p = freshSeed(task);
    pot(p);
    expect(evaluateArtifacts(task, p, build(p)).outcome).toBe('pass');
    p.files.find((f) => f.id === 'unrelated')!.content += '// unwanted';
    expect(evaluateArtifacts(task, p, build(p)).outcome).toBe('fail');
    const duplicate = freshSeed(task);
    pot(duplicate);
    part(duplicate, 'second-board', 'arduino-mega-r3', 'U2');
    expect(
      evaluateArtifacts(task, duplicate, build(duplicate)).checks.find(
        (c) => c.name === 'one-mega-target',
      )?.passed,
    ).toBe(false);
  });
  it('Explain is read-only while Fix requires real net repair and compilation', () => {
    const p = freshSeed('explain-led'),
      text =
        'The GPIO drives the LED anode directly without a current-limiting resistor; actual current is unknown.';
    expect(evaluateArtifacts(getEvaluationCase('explain-led'), p, undefined, text).outcome).toBe(
      'pass',
    );
    p.files[0].content += '// edited';
    expect(evaluateArtifacts(getEvaluationCase('explain-led'), p, undefined, text).outcome).toBe(
      'fail',
    );
    expect(
      evaluateArtifacts(getEvaluationCase('repair-led'), freshSeed('repair-led'), undefined, text)
        .outcome,
    ).toBe('fail');
    const fixed = exampleProject();
    fixed.files.push(...freshSeed('repair-led').files.filter((f) => f.id === 'unrelated'));
    expect(evaluateArtifacts(getEvaluationCase('repair-led'), fixed, build(fixed)).outcome).toBe(
      'pass',
    );
  });
  it('bare ITR9608 requires separate emitter and detector support', () => {
    const p = bareItr();
    expect(evaluateArtifacts(getEvaluationCase('itr9608'), p, build(p)).outcome).toBe('pass');
    p.wires = p.wires.filter(
      (w) => !(w.from.componentId === 'emitter-resistor' && w.from.terminalId === 'p2'),
    );
    const result = evaluateArtifacts(getEvaluationCase('itr9608'), p, build(p));
    expect(result.outcome).toBe('fail');
    expect(result.checks.find((c) => c.name === 'itr-emitter-detector')?.passed).toBe(false);
  });
  it('voltage and pin-capability repair require actually resolving the applicable rule', () => {
    const voltage = getEvaluationCase('repair-voltage'),
      p = freshSeed(voltage);
    expect(evaluateArtifacts(voltage, p, build(p)).outcome).toBe('fail');
    p.wires = p.wires.filter((w) => w.id !== 'unsafe-5v');
    expect(evaluateArtifacts(voltage, p, build(p)).outcome).toBe('pass');
    const pin = getEvaluationCase('repair-pin-capability'),
      q = freshSeed(pin);
    expect(evaluateArtifacts(pin, q, build(q)).outcome).toBe('fail');
    q.bindings[0].mode = 'output';
    expect(evaluateArtifacts(pin, q, build(q)).outcome).toBe('pass');
  });
  it('encoder/servo checks require honest telemetry, power and mechanical boundaries', () => {
    const p = encoderServo();
    expect(
      evaluateArtifacts(getEvaluationCase('servo-encoder'), p, build(p), encoderReport).outcome,
    ).toBe('pass');
    p.telemetry.find((m) => m.componentId === 'servo')!.meaning = 'measurement';
    expect(
      evaluateArtifacts(getEvaluationCase('servo-encoder'), p, build(p), encoderReport).outcome,
    ).toBe('fail');
    p.telemetry.find((m) => m.componentId === 'servo')!.meaning = 'command';
    wire(p, 'servo:power', 'board:5v');
    expect(
      evaluateArtifacts(getEvaluationCase('servo-encoder'), p, build(p), encoderReport).checks.find(
        (c) => c.name === 'external-servo-power-boundary',
      )?.passed,
    ).toBe(false);
  });
  it('does not count encoder VCC metadata as a real connected power source', () => {
    const p = encoderServo();
    p.wires = p.wires.filter(
      (w) => !(w.from.componentId === 'encoder' && w.from.terminalId === 'vcc'),
    );
    expect(
      evaluateArtifacts(getEvaluationCase('servo-encoder'), p, build(p), encoderReport).checks.find(
        (c) => c.name === 'encoder-interface',
      )?.passed,
    ).toBe(false);
  });
  it('permits focused necessary clarification but rejects generic advice and fictitious parts', () => {
    const task = getEvaluationCase('servo-encoder'),
      p = freshSeed(task);
    expect(
      evaluateArtifacts(
        task,
        p,
        undefined,
        'Can you confirm the AS5600 pull-up rail/3.3 V routing and which external power supply will power the servo?',
      ).outcome,
    ).toBe('clarification');
    expect(
      evaluateArtifacts(
        task,
        p,
        undefined,
        'Connect your sensor and servo carefully and read the datasheet.',
      ).outcome,
    ).toBe('fail');
    part(p, 'invented', 'imaginary-level-shifter', 'U1');
    expect(
      evaluateArtifacts(
        task,
        p,
        undefined,
        'Can you confirm the 3.3 V pull-ups and external power supply?',
      ).outcome,
    ).toBe('fail');
  });
  it('unsupported dependencies and absent telemetry are explicit limitations', () => {
    const dependency = getEvaluationCase('unsupported-dependency');
    expect(
      evaluateArtifacts(
        dependency,
        freshSeed(dependency),
        undefined,
        'The BNO055 breakout package and library are unavailable in the supported catalog/toolchain; please supply its exact datasheet and dependency.',
      ).outcome,
    ).toBe('clarification');
    expect(
      evaluateArtifacts(dependency, freshSeed(dependency), undefined, 'Everything is ready.')
        .outcome,
    ).toBe('fail');
    const telemetry = getEvaluationCase('no-telemetry');
    expect(
      evaluateArtifacts(
        telemetry,
        freshSeed(telemetry),
        undefined,
        'This firmware does not report sensor values over serial, so no telemetry is available; missing readings are not zero.',
      ).outcome,
    ).toBe('clarification');
  });
});
