import { expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error The packaging-only JavaScript helper is intentionally outside the app TS bundle.
import { collectThirdPartyNotices } from '../scripts/third-party-notices.mjs';

test('packaging retains actual bundled renderer transitive licenses and Monaco notices', async () => {
  const destination = await mkdtemp(join(tmpdir(), 'mudroom-notices-'));
  try {
    const packages = await collectThirdPartyNotices(resolve('.'), destination);
    for (const name of [
      'monaco-editor',
      '@monaco-editor/loader',
      'scheduler',
      'd3-ease',
      'd3-selection',
      'state-local',
      'dompurify',
      'marked',
      'use-sync-external-store',
    ]) {
      const entry = packages.find((item: { name: string }) => item.name === name);
      expect(entry, name).toBeDefined();
      expect(entry.notices.length, name).toBeGreaterThan(0);
      for (const notice of entry.notices) {
        expect((await readFile(join(destination, notice), 'utf8')).length).toBeGreaterThan(20);
      }
    }
    const monaco = packages.find((item: { name: string }) => item.name === 'monaco-editor');
    expect(monaco.notices.some((file: string) => file.endsWith('/ThirdPartyNotices.txt'))).toBe(
      true,
    );
    const manifest = JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8'));
    expect(manifest.packages).toEqual(packages);
    expect(
      manifest.packages.some((item: { path: string }) => item.path.includes('/node_modules/')),
    ).toBe(true);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});

test('collector distinguishes nested versions, excludes dev packages and tolerates absent optional ones', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mudroom-notice-fixture-'));
  try {
    const entries = {
      'node_modules/example': { version: '1.0.0', license: 'MIT' },
      'node_modules/example/node_modules/example': { version: '2.0.0', license: 'ISC' },
      'node_modules/dev-only': { version: '1.0.0', dev: true },
      'node_modules/other-platform': { version: '1.0.0', optional: true },
    };
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({ packages: entries }));
    for (const [path, entry] of Object.entries(entries).slice(0, 3)) {
      await mkdir(join(root, path), { recursive: true });
      await writeFile(
        join(root, path, 'package.json'),
        JSON.stringify({ name: 'example', ...entry }),
      );
      await writeFile(join(root, path, 'COPYING.txt'), 'Example retained notice');
    }
    const packages = await collectThirdPartyNotices(root, join(root, 'notices'));
    expect(packages.map((item: { version: string }) => item.version)).toEqual(['1.0.0', '2.0.0']);
    expect(packages[0].notices).not.toEqual(packages[1].notices);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
