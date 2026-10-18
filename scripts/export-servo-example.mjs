import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
await mkdir('artifacts/example-modules', { recursive: true });
await build({
  entryPoints: ['src/domain/servoExample.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: 'artifacts/example-modules/servo.js',
});
const { servoEncoderProject } = await import('../artifacts/example-modules/servo.js');
const firmware = await readFile('examples/servo-encoder/sketch.ino', 'utf8');
await writeFile(
  'examples/servo-encoder/servo-encoder.trace.json',
  JSON.stringify(servoEncoderProject(firmware), null, 2) + '\n',
);
console.log(
  'Generated the validated manual servo/encoder example. No inference or hardware operation.',
);
