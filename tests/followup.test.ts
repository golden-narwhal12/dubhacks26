import { describe, it, expect } from 'vitest';
import { exampleProject } from '../src/domain/example';
import { buildKey, circuitKey, targetConfiguration } from '../src/domain/semantics';
import {
  transact,
  parseProject,
  serializeProject,
  terminal,
  validateProject,
} from '../src/domain/project';
import { deriveNets, netFor } from '../src/domain/topology';
import { parseMeasurement, measurementStatus } from '../src/services/telemetry';
import { TelemetryMappingSchema } from '../src/domain/schema';
import { partById } from '../src/parts/catalog';
describe('semantic freshness and compatible projects', () => {
  it('layout/revision/label changes preserve compilation, connectivity invalidates only circuit checks', () => {
    const p = exampleProject(),
      b = buildKey(p),
      c = circuitKey(p);
    p.layouts.wiring.board.rotation = 90;
    p.revision++;
    expect(buildKey(p)).toBe(b);
    expect(circuitKey(p)).toBe(c);
    p.wires.pop();
    expect(buildKey(p)).toBe(b);
    expect(circuitKey(p)).not.toBe(c);
    p.files[0].content += '\n// edited';
    expect(buildKey(p)).not.toBe(b);
  });
  it('migrates old packages without reinterpretation; generic properties are undoable/persisted', () => {
    const old: any = exampleProject();
    old.schemaVersion = 1;
    delete old.telemetry;
    delete old.boardSettings;
    const migrated = parseProject(JSON.stringify(old));
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.components).toEqual(old.components);
    const p = transact(migrated, {
      expectedRevision: migrated.revision,
      summary: 'Add configurable resistor',
      commands: [
        {
          type: 'addComponent',
          component: {
            id: 'newres',
            ref: 'R2',
            partId: 'generic-resistor',
            partVersion: 1,
            config: { resistanceOhms: 4700 },
          },
          placement: { x: 0, y: 0, rotation: 0 },
        },
      ],
    });
    expect(parseProject(serializeProject(p)).components.at(-1)?.config.resistanceOhms).toBe(4700);
    expect(() =>
      transact(p, {
        expectedRevision: p.revision,
        summary: 'Invalid value',
        commands: [{ type: 'configureComponent', id: 'newres', config: { resistanceOhms: -1 } }],
      }),
    ).toThrow();
  });
  it('never equates resistor/LED pins; BB830 groups are exact continuous rails with isolated channel', () => {
    const p = exampleProject();
    for (const id of ['resistor', 'led']) {
      const part = partById(p.components.find((c) => c.id === id)!.partId);
      expect(
        netFor(deriveNets(p), { componentId: id, terminalId: part.terminals[0].id })?.id,
      ).not.toBe(netFor(deriveNets(p), { componentId: id, terminalId: part.terminals[1].id })?.id);
    }
    p.components.push({
      id: 'bb',
      ref: 'BB1',
      partId: 'breadboard-830',
      partVersion: 1,
      config: {},
    });
    for (const v of ['wiring', 'schematic'] as const) p.layouts[v].bb = { x: 0, y: 0, rotation: 0 };
    const nets = deriveNets(validateProject(p)),
      net = (id: string) => netFor(nets, { componentId: 'bb', terminalId: id })!.id;
    expect(partById('breadboard-830').terminals).toHaveLength(830);
    expect(net('a1')).toBe(net('e1'));
    expect(net('a1')).not.toBe(net('f1'));
    expect(net('a1')).not.toBe(net('a2'));
    expect(net('lp1')).toBe(net('lp50'));
    expect(net('lp25')).toBe(net('lp26'));
    expect(net('lp1')).not.toBe(net('ln1'));
  });
  it('requires explicit ESP module settings for physical programming', () => {
    const p = exampleProject();
    p.components[0].partId = 'esp32-s3-devkitc1-v11';
    expect(() => targetConfiguration(p, true)).toThrow('Confirm');
    p.boardSettings.esp32 = { flashMB: '8', psram: 'opi', confirmed: true };
    expect(targetConfiguration(p, true).fqbn).toContain('FlashSize=8M,PSRAM=opi');
  });
});
describe('honest telemetry extraction', () => {
  const mapping = TelemetryMappingSchema.parse({
    id: 'angle',
    label: 'Angle',
    parser: 'keyvalue',
    field: 'angle',
    units: 'deg',
    meaning: 'raw',
  });
  it('does not guess unlabeled numbers, convert missing to zero, or parse suffix units', () => {
    expect(parseMeasurement(mapping, '123')).toBeNull();
    expect(parseMeasurement(mapping, 'other=4')).toBeNull();
    expect(parseMeasurement(mapping, 'angle=0')?.value).toBe(0);
    expect(parseMeasurement(mapping, 'angle=4deg')).toBeNull();
    expect(measurementStatus(mapping, 'other=4')).toBe('missing');
    expect(measurementStatus(mapping, 'angle=NaN')).toBe('invalid');
    expect(parseMeasurement(mapping, 'angle=1 angle=2')).toBeNull();
  });
  it('extracts explicit JSON paths and timestamps; keeps timestamps separate from host receipt', () => {
    const m = {
      ...mapping,
      parser: 'json' as const,
      field: 'sensor.angle',
      deviceTimestampField: 't',
    };
    expect(parseMeasurement(m, '{"sensor":{"angle":12.5},"t":88}')).toEqual({
      value: 12.5,
      deviceTimestamp: 88,
    });
    expect(parseMeasurement(m, '{"sensor":{"angle":null}}')).toBeNull();
    expect(measurementStatus(m, '{"sensor":')).toBe('invalid');
  });
});
