import type { Project } from '../domain/schema';
import type { Transaction } from '../domain/project';
import { partById } from '../parts/catalog';
import { illustrationSize } from '../parts/illustration';

type Box = { x: number; y: number; width: number; height: number };
const gap = 64;
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width + gap &&
  a.x + a.width + gap > b.x &&
  a.y < b.y + b.height + gap &&
  a.y + a.height + gap > b.y;

/** Space newly created artwork only. Existing placements, endpoints and firmware are preserved. */
export function spaceAgentAdditions(before: Project, next: Project, transaction: Transaction) {
  const added = next.components.filter((c) => !before.components.some((old) => old.id === c.id));
  const commands = [...transaction.commands];
  const adjusted = new Set<string>();
  for (const view of ['wiring', 'schematic'] as const) {
    const boxes: Box[] = next.components
      .filter((c) => !added.includes(c))
      .map((c) => ({
        ...next.layouts[view][c.id],
        ...illustrationSize(partById(c.partId), next.layouts[view][c.id].rotation),
      }));
    for (const c of added) {
      const placement = next.layouts[view][c.id];
      const desired = { ...placement, ...illustrationSize(partById(c.partId), placement.rotation) };
      let chosen = desired;
      if (boxes.some((b) => overlaps(desired, b))) {
        const candidates = boxes
          .flatMap((b) => [
            { ...desired, x: b.x + b.width + gap },
            { ...desired, x: b.x - desired.width - gap },
            { ...desired, y: b.y + b.height + gap },
            { ...desired, y: b.y - desired.height - gap },
            { ...desired, x: b.x + b.width + gap, y: b.y + b.height + gap },
            { ...desired, x: b.x - desired.width - gap, y: b.y - desired.height - gap },
          ])
          .filter(
            (b) =>
              Math.abs(b.x) <= 10000 &&
              Math.abs(b.y) <= 10000 &&
              !boxes.some((old) => overlaps(b, old)),
          );
        candidates.sort(
          (a, b) =>
            Math.hypot(a.x - desired.x, a.y - desired.y) -
            Math.hypot(b.x - desired.x, b.y - desired.y),
        );
        if (!candidates.length)
          throw Error(
            'No clear placement for new components. Use a smaller transaction or move existing parts. No changes were applied.',
          );
        chosen = candidates[0];
        commands.push({
          type: 'moveComponent',
          id: c.id,
          view,
          placement: { x: chosen.x, y: chosen.y, rotation: placement.rotation },
        });
        adjusted.add(c.id);
      }
      boxes.push(chosen);
    }
  }
  return { transaction: { ...transaction, commands }, adjusted: [...adjusted] };
}
