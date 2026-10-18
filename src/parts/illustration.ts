import type { Part } from '../domain/schema';

// View dimensions only; never used to infer electrical connectivity or physical dimensions.
export function illustrationSize(part: Part, rotation = 0) {
  const size =
    part.kind === 'resistor'
      ? { width: 130, height: 54 }
      : part.kind === 'led'
        ? { width: 56, height: 100 }
        : part.kind === 'breadboard'
          ? { width: 212, height: 870 }
          : part.kind !== 'board'
            ? {
                width:
                  part.kind === 'level-shifter'
                    ? 180
                    : ['encoder', 'servo', 'potentiometer', 'photointerruptor'].includes(part.kind)
                      ? 130
                      : 150,
                height: Math.max(130, Math.ceil(part.terminals.length / 2) * 26 + 32),
              }
            : part.id === 'esp32-s3-devkitc1-v11'
              ? { width: 186, height: 560 }
              : { width: 704, height: 310 };
  return rotation % 180 ? { width: size.height, height: size.width } : size;
}
