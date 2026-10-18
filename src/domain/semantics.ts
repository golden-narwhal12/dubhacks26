import type { Project } from './schema';
import { partById } from '../parts/catalog';
export function stableKey(value: unknown) {
  const stable = (v: any): any =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, stable(v[k])]),
          )
        : v;
  return JSON.stringify(stable(value));
}
/** Keys describe semantic input equality, not authorization or cryptographic identity. */
export function buildKey(p: Project) {
  const board = p.components.find((c) => c.id === p.targetBoardId);
  return stableKey({
    supportedLibrarySet: 'Servo@1.3.0',
    part: board ? [board.partId, board.partVersion] : null,
    settings: p.boardSettings,
    files: [...p.files]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((f) => ({ path: f.path, content: f.content })),
  });
}
export function circuitKey(p: Project) {
  return stableKey({
    targetBoardId: p.targetBoardId,
    components: p.components
      .map((c) => ({
        id: c.id,
        partId: c.partId,
        partVersion: c.partVersion,
        config: Object.fromEntries(Object.entries(c.config).filter(([key]) => key !== 'label')),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    wires: p.wires
      .map((w) => [w.from, w.to])
      .sort((a, b) => stableKey(a).localeCompare(stableKey(b))),
    bindings: p.bindings,
    build: buildKey(p),
  });
}
export function targetConfiguration(p: Project, physical = false) {
  const board = p.components.find((c) => c.id === p.targetBoardId);
  if (!board) throw new Error('Choose a project board.');
  const part = partById(board.partId);
  if (!part.firmware) throw new Error('Unsupported compile target.');
  let fqbn = part.firmware.fqbn;
  if (part.id === 'esp32-s3-devkitc1-v11') {
    const v = p.boardSettings.esp32;
    if (physical && !v?.confirmed)
      throw new Error('Confirm ESP32-S3 flash/PSRAM variant before programming.');
    if (v) fqbn += `:FlashSize=${v.flashMB}M,PSRAM=${v.psram}`;
  }
  return { boardId: board.id, partId: part.id, name: part.name, fqbn };
}
