import { packager } from '@electron/packager';
import { cp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const root = resolve('.'),
  stage = resolve('artifacts/package-source'),
  tools = resolve('artifacts/trace-tools');
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
for (const dir of ['dist', 'dist-desktop']) await cp(dir, join(stage, dir), { recursive: true });
await mkdir(join(stage, 'licenses'), { recursive: true });
await cp('assets/fonts/OFL.txt', join(stage, 'licenses/JetBrainsMono-OFL.txt'));
await cp('assets/fonts/README.md', join(stage, 'licenses/JetBrainsMono-source.md'));
for (const name of [
  'react',
  'react-dom',
  'zustand',
  'zod',
  'lucide-react',
  '@monaco-editor/react',
  '@xyflow/react',
  '@xyflow/system',
  'dockview-react',
  'dockview',
  'dockview-core',
  'monaco-editor',
  'serialport',
]) {
  try {
    await cp(
      resolve('node_modules', name, 'LICENSE'),
      join(stage, 'licenses', name.replace('/', '-') + '.txt'),
    );
  } catch {
    try {
      await cp(
        resolve('node_modules', name, 'LICENSE.txt'),
        join(stage, 'licenses', name.replace('/', '-') + '.txt'),
      );
    } catch {
      await cp(
        resolve('node_modules', name, 'LICENCE.md'),
        join(stage, 'licenses', name.replace('/', '-') + '.txt'),
      );
    }
  }
}
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(
  join(stage, 'package.json'),
  JSON.stringify({
    name: pkg.name,
    productName: pkg.productName,
    version: pkg.version,
    main: pkg.main,
  }),
);
// Native N-API serial bindings retain their package-relative prebuild paths.
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const copied = new Set();
async function copyRuntime(name) {
  if (copied.has(name)) return;
  copied.add(name);
  const { dirname } = await import('node:path');
  let packageRoot = dirname(require.resolve(name));
  let data;
  for (;;) {
    try {
      const candidate = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
      if (candidate.name === name) {
        data = candidate;
        break;
      }
    } catch {}
    const parent = dirname(packageRoot);
    if (parent === packageRoot) throw new Error(`Cannot locate installed package ${name}`);
    packageRoot = parent;
  }
  await cp(packageRoot, join(stage, 'node_modules', name), { recursive: true });
  for (const child of Object.keys(data.dependencies ?? {})) await copyRuntime(child);
}
await copyRuntime('serialport');
let includeTools = false;
try {
  await access('artifacts/tools/simavr');
  includeTools = true;
} catch {}
if (includeTools) {
  await mkdir(tools, { recursive: true });
  await cp('artifacts/tools/simavr', join(tools, 'simavr'));
  await cp('artifacts/tools/simavr-COPYING', join(tools, 'COPYING'));
  await cp('artifacts/tools/simavr-source.json', join(tools, 'SOURCE.json'));
  const archived = spawnSync(
    'git',
    [
      '-C',
      resolve('artifacts/tools/simavr-source'),
      'archive',
      '--format=tar.gz',
      `--output=${join(tools, 'simavr-source.tar.gz')}`,
      'HEAD',
    ],
    { stdio: 'inherit', shell: false },
  );
  if (archived.status !== 0) throw new Error('Unable to retain simulator corresponding source');
}
try {
  await access('artifacts/tools/libraries/Servo/library.properties');
  await mkdir(tools, { recursive: true });
  await cp('artifacts/tools/libraries', join(tools, 'libraries'), { recursive: true });
  includeTools = true;
} catch {
  /* Library setup is optional; a missing dependency remains a clear compile error. */
}
const paths = await packager({
  dir: stage,
  name: 'mudroom',
  out: 'release',
  overwrite: true,
  platform: 'darwin',
  arch: process.arch,
  electronVersion: JSON.parse(await readFile('node_modules/electron/package.json', 'utf8')).version,
  asar: { unpack: '**/*.node' },
  prune: false,
  appBundleId: 'dev.trace.workbench',
  appCategoryType: 'public.app-category.developer-tools',
  icon: resolve('assets/mudroom.icns'),
  extraResource: includeTools ? [tools] : [],
  osxSign: false,
});
console.log(paths.join('\n'));
