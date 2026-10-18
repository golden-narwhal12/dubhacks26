import { it, expect } from 'vitest';
import { blankProject, exampleProject } from '../src/domain/example';
import { transact, type Transaction } from '../src/domain/project';
import { spaceAgentAdditions } from '../src/services/agentLayout';
import { illustrationSize } from '../src/parts/illustration';
import { partById } from '../src/parts/catalog';

it('spaces overlapping agent additions without changing nets, source or a single transaction revision', () => {
  const before = blankProject(),
    desired = exampleProject();
  const tx: Transaction = {
    expectedRevision: before.revision,
    summary: 'Create indicator',
    commands: [
      ...desired.components.map((component) => ({
        type: 'addComponent' as const,
        component,
        placement: { x: 50, y: 50, rotation: 0 as const },
      })),
      ...desired.wires.map((wire) => ({ type: 'connect' as const, wire })),
      { type: 'writeFile', file: desired.files[0] },
    ],
  };
  const unspaced = transact(before, tx);
  const result = spaceAgentAdditions(before, unspaced, tx);
  const spaced = transact(before, result.transaction);
  expect(result.adjusted).toHaveLength(2);
  expect(spaced.revision).toBe(unspaced.revision);
  expect(spaced.wires).toEqual(unspaced.wires);
  expect(spaced.files).toEqual(unspaced.files);
  for (const view of ['wiring', 'schematic'] as const) {
    const boxes = spaced.components.map((c) => ({
      ...spaced.layouts[view][c.id],
      ...illustrationSize(partById(c.partId), spaced.layouts[view][c.id].rotation),
    }));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i],
          b = boxes[j];
        expect(
          a.x >= b.x + b.width + 64 ||
            b.x >= a.x + a.width + 64 ||
            a.y >= b.y + b.height + 64 ||
            b.y >= a.y + a.height + 64,
        ).toBe(true);
      }
  }
});
it('preserves existing placements and respects rotated illustration bounds', () => {
  const before = exampleProject();
  const tx: Transaction = {
    expectedRevision: before.revision,
    summary: 'Add rotated resistor',
    commands: [
      {
        type: 'addComponent',
        component: {
          id: 'new-r',
          ref: 'R2',
          partId: 'generic-resistor',
          partVersion: 1,
          config: {},
        },
        placement: { ...before.layouts.wiring.board, rotation: 90 },
      },
    ],
  };
  const raw = transact(before, tx),
    spaced = transact(before, spaceAgentAdditions(before, raw, tx).transaction);
  for (const view of ['wiring', 'schematic'] as const)
    for (const c of before.components)
      expect(spaced.layouts[view][c.id]).toEqual(before.layouts[view][c.id]);
  expect(illustrationSize(partById('generic-resistor'), 90)).toEqual({ width: 54, height: 130 });
  expect(spaced.layouts.wiring['new-r'].rotation).toBe(90);
});
