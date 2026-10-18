import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const noticeName = /^(?:licen[cs]e|copying|notice|third[-_ ]?party[-_ ]?notices?)(?:[._-].*)?$/i;

/** Retain notices for installed production packages, including nested lockfile versions. */
export async function collectThirdPartyNotices(root, destination) {
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const packages = [];
  await mkdir(destination, { recursive: true });
  for (const [packagePath, entry] of Object.entries(lock.packages ?? {}).sort()) {
    if (!packagePath.startsWith('node_modules/') || entry.dev) continue;
    const packageRoot = join(root, packagePath);
    let metadata;
    try {
      metadata = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    } catch (error) {
      // Optional/platform-specific packages need not be installed on this host.
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const notices = [];
    const output = join(destination, 'packages', packagePath);
    for (const file of (await readdir(packageRoot, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!file.isFile() || !noticeName.test(file.name)) continue;
      await mkdir(output, { recursive: true });
      const target = join(output, file.name);
      await cp(join(packageRoot, file.name), target);
      notices.push(relative(destination, target).split('\\').join('/'));
    }
    packages.push({
      path: packagePath,
      name: metadata.name,
      version: metadata.version,
      license: metadata.license ?? entry.license ?? null,
      notices,
    });
  }
  await writeFile(
    join(destination, 'manifest.json'),
    JSON.stringify({ formatVersion: 1, packages }, null, 2) + '\n',
  );
  return packages;
}
