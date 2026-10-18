import { mkdir, writeFile, realpath, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Fixed macOS process policy, inherited by compiler children. No model-supplied roots. */
export async function prepareConfinement(
  scratch: string,
  simulatorRoot: string,
  devicePath?: string,
) {
  if (process.platform !== 'darwin')
    throw new Error(
      'Confined compilation currently requires macOS sandbox-exec; no unrestricted fallback is enabled.',
    );
  await access('/usr/bin/sandbox-exec', constants.X_OK);
  const root = await realpath(scratch),
    data = join(homedir(), 'Library/Arduino15');
  for (const name of ['tmp', 'cache', 'downloads', 'user'])
    await mkdir(join(root, name), { recursive: true, mode: 0o700 });
  const config = join(root, 'arduino-cli.yaml');
  await writeFile(
    config,
    `directories:\n  data: ${JSON.stringify(data)}\n  downloads: ${JSON.stringify(join(root, 'downloads'))}\n  user: ${JSON.stringify(join(root, 'user'))}\nbuild_cache:\n  path: ${JSON.stringify(join(root, 'cache'))}\n`,
    { mode: 0o600 },
  );
  const readable = [
    '/System',
    '/usr',
    '/bin',
    '/sbin',
    '/Library',
    '/private/var/db',
    '/private/etc',
    '/opt/homebrew',
    '/Applications/Xcode.app',
    join(data, 'packages'),
    simulatorRoot,
    root,
  ];
  const indices = [
    'inventory.yaml',
    'library_index.json',
    'library_index.json.sig',
    'package_index.json',
    'package_index.json.sig',
    'package_esp32_index.json',
  ];
  const terms = [
    ...readable.map((path) => `(subpath ${JSON.stringify(path)})`),
    ...indices.map((name) => `(literal ${JSON.stringify(join(data, name))})`),
  ];
  // Restrict regular file data while retaining inherited pipes and required macOS runtime operations.
  if (devicePath && !/^\/dev\/(?:cu|tty)\.[A-Za-z0-9_.-]{1,180}$/.test(devicePath))
    throw new Error('Invalid selected serial device.');
  const deviceTerms = [
    '(literal "/dev/null")',
    '(literal "/dev/zero")',
    '(literal "/dev/random")',
    '(literal "/dev/urandom")',
    '(subpath "/dev/fd")',
    ...(devicePath ? [`(literal ${JSON.stringify(devicePath)})`] : []),
  ].join(' ');
  const devicePolicy = `(deny file-read* file-write* (require-all (subpath "/dev") (require-not (require-any ${deviceTerms}))))`;
  const policy = `(version 1)\n(allow default)\n(deny network*)\n${devicePolicy}\n(deny file-read-data (require-all (vnode-type REGULAR-FILE) (require-not (require-any ${terms.join(' ')}))))\n(deny file-write* (require-not (require-any (subpath ${JSON.stringify(root)}) (subpath "/dev"))))\n`;
  const profile = join(root, 'process.sb');
  await writeFile(profile, policy, { mode: 0o600 });
  return {
    launcher: '/usr/bin/sandbox-exec',
    prefix: ['-f', profile],
    config,
    tmp: join(root, 'tmp'),
  };
}
