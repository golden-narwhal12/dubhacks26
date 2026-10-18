import { it, expect } from 'vitest';
import { blankProject } from '../src/domain/example';
import { transact, parseProject, serializeProject, type Command } from '../src/domain/project';
import { validateCircuit } from '../src/domain/validation';
import { deriveNets, netFor } from '../src/domain/topology';
import { signalEndpoints } from '../src/domain/interfaces';
import { searchParts } from '../src/parts/catalog';
it('searches exact package IDs and punctuation-normalized board names', () => {
  expect(searchParts('external-dc-supply').some((p) => p.id === 'external-dc-supply')).toBe(true);
  expect(searchParts('arduino_mega_2560').some((p) => p.id === 'arduino-mega-r3')).toBe(true);
  expect(searchParts('')).toHaveLength(new Set(searchParts('').map((p) => p.id)).size);
  expect(searchParts('').length).toBeGreaterThan(30);
});
function supportedDesign() {
  const before = blankProject();
  const add = (id: string, partId: string, config: any = {}): Command => ({
    type: 'addComponent',
    component: { id, partId, partVersion: 1, ref: id.toUpperCase(), config },
    placement: { x: 0, y: 0, rotation: 0 },
  });
  let index = 0;
  const wire = (a: string, b: string): Command => {
    const ep = (s: string) => {
      const [componentId, terminalId] = s.split(':');
      return { componentId, terminalId };
    };
    return {
      type: 'connect',
      wire: { id: `w${index++}`, from: ep(a), to: ep(b), color: 'yellow' },
    };
  };
  const commands: Command[] = [
    add('mega', 'arduino-mega-r3'),
    add('servo', 'sg90-generic'),
    add('encoder', 'as5600-module-photo'),
    add('source', 'external-dc-supply', { supplyVoltageV: 5 }),
    add('translator', 'adafruit-757'),
    { type: 'setTarget', id: 'mega' },
    wire('source:positive', 'servo:power'),
    wire('source:negative', 'mega:gnd1'),
    wire('servo:gnd', 'mega:gnd1'),
    wire('servo:signal', 'mega:d9'),
    wire('encoder:vcc', 'mega:3v3'),
    wire('encoder:gnd', 'mega:gnd2'),
    wire('translator:lv', 'mega:3v3'),
    wire('translator:hv', 'mega:5v'),
    wire('translator:gnd', 'mega:gnd1'),
    wire('encoder:sda', 'translator:lv1'),
    wire('translator:hv1', 'mega:d20'),
    wire('encoder:scl', 'translator:lv2'),
    wire('translator:hv2', 'mega:d21'),
  ];
  return transact(before, {
    expectedRevision: 0,
    summary: 'Document complete signal and supply paths',
    commands,
  });
}
it('external supply and grounded I²C conversion resolve known source/bus issues without merging translated nets', () => {
  const p = supportedDesign();
  const relevant = validateCircuit(p).filter(
    (d) => d.severity === 'error' || d.severity === 'warning',
  );
  expect(relevant).toEqual([]);
  const nets = deriveNets(p);
  expect(netFor(nets, { componentId: 'encoder', terminalId: 'sda' })!.id).not.toBe(
    netFor(nets, { componentId: 'mega', terminalId: 'd20' })!.id,
  );
  expect(signalEndpoints(p, { componentId: 'encoder', terminalId: 'sda' })).toContainEqual({
    componentId: 'mega',
    terminalId: 'd20',
  });
  expect(parseProject(serializeProject(p))).toEqual(p);
});
it('removing encoder bus wires or servo power creates actionable missing-function errors', () => {
  const p = supportedDesign();
  p.wires = p.wires.filter(
    (w) =>
      !(
        [w.from, w.to].some(
          (e) => e.componentId === 'encoder' && ['sda', 'scl'].includes(e.terminalId),
        ) || [w.from, w.to].some((e) => e.componentId === 'servo' && e.terminalId === 'power')
      ),
  );
  const issues = validateCircuit(p);
  expect(issues).toContainEqual(
    expect.objectContaining({
      id: 'encoder-data-encoder',
      severity: 'error',
      requiresAgentResolution: true,
    }),
  );
  expect(issues).toContainEqual(
    expect.objectContaining({
      id: 'supply-servo',
      severity: 'error',
      requiresAgentResolution: true,
    }),
  );
});
it('a translator without reference power is not accepted as a valid interface', () => {
  const p = supportedDesign();
  p.wires = p.wires.filter(
    (w) => ![w.from, w.to].some((e) => e.componentId === 'translator' && e.terminalId === 'hv'),
  );
  expect(validateCircuit(p)).toContainEqual(
    expect.objectContaining({ id: 'translator-supply-translator', severity: 'error' }),
  );
});
it('an isolated external return does not supply a controller-referenced servo signal', () => {
  const p = supportedDesign();
  p.wires = p.wires.filter(
    (w) => ![w.from, w.to].some((e) => e.componentId === 'servo' && e.terminalId === 'gnd'),
  );
  p.wires.push({
    id: 'isolated-return',
    from: { componentId: 'servo', terminalId: 'gnd' },
    to: { componentId: 'encoder', terminalId: 'dir' },
    color: 'black',
  });
  expect(validateCircuit(p)).toContainEqual(
    expect.objectContaining({ id: 'reference-servo', severity: 'error' }),
  );
});
it('uses recommended sensor operating range rather than treating an unpowered input as a source', () => {
  const p = supportedDesign();
  p.components.push({
    id: 'temperature',
    partId: 'lm35dz-to92',
    partVersion: 1,
    ref: 'T1',
    config: {},
  });
  p.layouts.wiring.temperature = p.layouts.schematic.temperature = { x: 900, y: 600, rotation: 0 };
  p.wires.push(
    {
      id: 'temp-vcc',
      from: { componentId: 'mega', terminalId: '3v3' },
      to: { componentId: 'temperature', terminalId: 'vs' },
      color: 'red',
    },
    {
      id: 'temp-gnd',
      from: { componentId: 'mega', terminalId: 'gnd1' },
      to: { componentId: 'temperature', terminalId: 'gnd' },
      color: 'black',
    },
  );
  expect(validateCircuit(p)).toContainEqual(
    expect.objectContaining({ id: 'operating-supply-temperature', severity: 'error' }),
  );
  p.wires.find((w) => w.id === 'temp-vcc')!.from.terminalId = '5v';
  expect(validateCircuit(p).some((d) => d.id === 'operating-supply-temperature')).toBe(false);
});
it('does not label directly printed ADC counts as a blocked state', () => {
  const p = supportedDesign();
  p.files[0].content =
    'void setup(){Serial.begin(115200);}\nvoid loop(){int raw=analogRead(A0);Serial.print("blocked=");Serial.println(raw);}\n';
  p.telemetry = [
    {
      id: 'blocked',
      label: 'Blocked state',
      parser: 'keyvalue',
      field: 'blocked',
      componentId: 'encoder',
      meaning: 'measurement',
      units: 'counts',
      staleAfterMs: 1000,
    },
  ];
  expect(validateCircuit(p)).toContainEqual(
    expect.objectContaining({ id: 'telemetry-state-blocked', requiresAgentResolution: true }),
  );
  p.telemetry[0].meaning = 'state';
  p.telemetry[0].units = '0/1';
  expect(validateCircuit(p).some((d) => d.id === 'telemetry-state-blocked')).toBe(true);
  p.files[0].content =
    'void setup(){Serial.begin(115200);}\nvoid loop(){bool blocked=digitalRead(7)==HIGH;Serial.print("blocked=");Serial.println(blocked);}\n';
  expect(validateCircuit(p).some((d) => d.id === 'telemetry-state-blocked')).toBe(false);
});
