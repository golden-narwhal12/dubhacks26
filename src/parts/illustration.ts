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
            ? { width: 130, height: 130 }
            : part.id === 'esp32-s3-devkitc1-v11'
              ? { width: 186, height: 560 }
              : { width: 704, height: 310 };
  return rotation % 180 ? { width: size.height, height: size.width } : size;
}
