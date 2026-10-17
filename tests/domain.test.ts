import { describe, it, expect } from 'vitest';
import { exampleProject } from '../src/domain/example';
import {
  transact,
  validateProject,
  parseProject,
  serializeProject,
  emptyHistory,
  record,
  travel,
} from '../src/domain/project';
import { deriveNets, netFor } from '../src/domain/topology';
import { validateCircuit } from '../src/domain/validation';
import { partById } from '../src/parts/catalog';
describe('shared project semantics', () => {
  it('preserves electrical nets when moving and serializing', () => {
    const p = exampleProject();
    const before = deriveNets(p);
    const moved = transact(p, {
      expectedRevision: 0,
      summary: 'Move board',
      commands: [
        {
          type: 'moveComponent',
          id: 'board',
          view: 'wiring',
          placement: { x: 400, y: 300, rotation: 90 },
        },
      ],
    });
    expect(deriveNets(moved)).toEqual(before);
    expect(parseProject(serializeProject(moved))).toEqual(moved);
  });
  it('connects duplicate ground headers internally, never resistor terminals', () => {
    const p = exampleProject(),
      nets = deriveNets(p);
    expect(netFor(nets, { componentId: 'board', terminalId: 'gnd1' })).toBe(
      netFor(nets, { componentId: 'board', terminalId: 'gnd5' }),
    );
    expect(netFor(nets, { componentId: 'resistor', terminalId: 'p1' })).not.toBe(
      netFor(nets, { componentId: 'resistor', terminalId: 'p2' }),
    );
  });
  it('rejects invalid terminal IDs and rolls back a whole transaction', () => {
    const p = exampleProject();
    expect(() =>
      transact(p, {
        expectedRevision: 0,
        summary: 'Invalid group',
        commands: [
          { type: 'disconnect', id: 'signal' },
          {
            type: 'connect',
            wire: {
              id: 'bad',
              from: { componentId: 'board', terminalId: 'label-13' },
              to: { componentId: 'led', terminalId: 'a' },
              color: 'mint',
            },
          },
        ],
      }),
    ).toThrow('Unknown terminal');
    expect(p.wires.length).toBe(3);
  });
  it('cascades delete and advances revisions on undo to reject stale edits', () => {
    const p = exampleProject(),
      tx = {
        expectedRevision: 0,
        summary: 'Delete board',
        commands: [{ type: 'removeComponent', id: 'board' }],
      };
    const next = transact(p, tx);
    expect(next.wires).toHaveLength(1);
    expect(next.bindings).toHaveLength(0);
    expect(next.targetBoardId).toBeNull();
    const restored = travel(next, record(emptyHistory(), p, 'Delete board'), 'undo').project;
    expect(restored.wires).toHaveLength(3);
    expect(restored.revision).toBe(2);
    expect(() => transact(restored, tx)).toThrow('Project changed');
  });
  it('detects manually moved pin and provides one coordinated undoable fix', () => {
    const p = exampleProject();
    const moved = transact(p, {
      expectedRevision: 0,
      summary: 'Rewire',
      commands: [
        { type: 'disconnect', id: 'signal' },
        {
          type: 'connect',
          wire: { ...p.wires[0], from: { componentId: 'board', terminalId: 'd12' } },
        },
      ],
    });
    const issue = validateCircuit(moved).find((d) => d.id === 'mismatch-indicator-pin')!;
    expect(issue.fix).toBeDefined();
    const fixed = transact(moved, { expectedRevision: moved.revision, ...issue.fix });
    expect(fixed.files[0].content).toContain('LED_PIN = 12');
    expect(fixed.bindings[0].terminalId).toBe('d12');
    expect(validateCircuit(fixed).filter((d) => d.severity === 'error')).toHaveLength(0);
  });
  it('rejects incompatible project versions and dangling layout references', () => {
    expect(() => validateProject({ ...exampleProject(), schemaVersion: 2 })).toThrow();
    const p = exampleProject();
    p.layouts.wiring.ghost = { x: 0, y: 0, rotation: 0 };
    expect(() => validateProject(p)).toThrow('Unknown layout');
  });
  it('maps the requested board revisions to official documented terminals', () => {
    const mega = partById('arduino-mega-r3');
    expect(mega.terminals.find((t) => t.id === 'd13')?.gpio).toBe('PB7');
    expect(mega.terminals.find((t) => t.id === 'd53')?.gpio).toBe('PB0');
    expect(mega.terminals.find((t) => t.id === 'a15')?.gpio).toBe('PK7');
    const esp = partById('esp32-s3-devkitc1-v11');
    expect(esp.terminals.filter((t) => t.header === 'J1')).toHaveLength(22);
    expect(esp.terminals.find((t) => t.header === 'J3' && t.physicalPin === 10)?.gpio).toBe(
      'GPIO38',
    );
  });
});
