// Build an external GPL-3.0-or-later simulator; no system installation or Electron linking.
import { spawnSync } from 'node:child_process';
import { mkdir, access, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const revision = '5b08da60497f7564f50941f74a549fe2851db030';
const tools = resolve('artifacts/tools'),
  source = join(tools, 'simavr-source');
await mkdir(source, { recursive: true });
function run(command, args, cwd = source) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false, timeout: 180000 });
  if (result.error || result.status !== 0)
    throw new Error(`${command} failed: ${result.error?.message ?? result.status}`);
}
try {
  await access(join(source, '.git'));
} catch {
  run('git', ['init']);
}
run('git', ['fetch', '--depth', '1', 'https://github.com/buserror/simavr.git', revision]);
run('git', ['checkout', '--detach', 'FETCH_HEAD']);
run('make', [
  '-C',
  'simavr',
  '-j4',
  'HOMEBREW_PREFIX=/private/tmp/trace-no-homebrew',
  'C_LIBELF=',
  'LD_LIBELF=',
  'C_LIBDWARF=',
  'LD_LIBDWARF=',
]);
await copyFile(join(source, 'simavr/run_avr'), join(tools, 'simavr'));
await copyFile(join(source, 'COPYING'), join(tools, 'simavr-COPYING'));
await writeFile(
  join(tools, 'simavr-source.json'),
  JSON.stringify(
    {
      repository: 'https://github.com/buserror/simavr',
      revision,
      license: 'GPL-3.0-or-later',
      build: 'Standalone HEX-only; ELF/DWARF disabled; source retained in simavr-source',
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Ready: ${join(tools, 'simavr')}\nSource and license retained beside executable. Mega >128 KB coverage is preliminary upstream.`,
);
