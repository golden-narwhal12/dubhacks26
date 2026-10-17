import { packager } from '@electron/packager';
import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const root = resolve('.'),
  stage = resolve('artifacts/package-source'),
  tools = resolve('artifacts/trace-tools');
await mkdir(stage, { recursive: true });
for (const dir of ['dist', 'dist-desktop']) await cp(dir, join(stage, dir), { recursive: true });
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
const paths = await packager({
  dir: stage,
  name: 'Trace',
  out: 'release',
  overwrite: true,
  platform: 'darwin',
  arch: process.arch,
  electronVersion: pkg.devDependencies.electron.replace(/^[^\d]*/, ''),
  asar: true,
  prune: false,
  appBundleId: 'dev.trace.workbench',
  appCategoryType: 'public.app-category.developer-tools',
  icon: resolve('assets/trace.icns'),
  extraResource: includeTools ? [tools] : [],
  osxSign: false,
});
console.log(paths.join('\n'));
