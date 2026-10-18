import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const url = 'https://downloads.arduino.cc/libraries/github.com/arduino-libraries/Servo-1.3.0.zip';
const sha256 = 'd25b0d77f10a810d24876c570410f32cc3129f9cc3d0370c861a278b969b4b38';
await mkdir('artifacts', { recursive: true });
const archive = resolve('artifacts/servo-1.3.0.zip');
let data;
try {
  data = await readFile(archive);
} catch {
  const response = await fetch(url);
  if (!response.ok) throw Error(`Servo download HTTP ${response.status}`);
  data = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha256').update(data).digest('hex') !== sha256)
  throw Error('Servo archive checksum mismatch; nothing installed.');
await writeFile(archive, data);
const root = resolve('artifacts/tools/libraries');
await mkdir(root, { recursive: true });
const stage = join(root, 'servo-staging');
await mkdir(stage, { recursive: true });
const extracted = spawnSync('/usr/bin/unzip', ['-q', '-o', archive, '-d', stage], {
  stdio: 'inherit',
});
if (extracted.status !== 0) throw Error('Unable to unpack verified Servo archive');
await rm(join(root, 'Servo'), { recursive: true, force: true });
await rename(join(stage, 'Servo-1.3.0'), join(root, 'Servo'));
await rm(stage, { recursive: true, force: true });
await writeFile(
  join(root, 'SOURCE.json'),
  JSON.stringify(
    {
      libraries: [
        {
          name: 'Servo',
          version: '1.3.0',
          url,
          sha256,
          source: 'https://github.com/arduino-libraries/Servo/tree/1.3.0',
        },
      ],
    },
    null,
    2,
  ),
);
console.log('Installed pinned Servo 1.3.0. Source and license retained; no firmware modified.');
