import { it, expect } from 'vitest';
import { prepareConfinement } from '../desktop/confinement';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
it.skipIf(process.platform !== 'darwin')(
  'keeps device files excluded from builds and grants only an exact approved upload device',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'trace-device-policy-'));
    try {
      const compile = await prepareConfinement(root, join(root, 'tools'));
      const policy = await readFile(compile.prefix[1], 'utf8');
      expect(policy).toContain('(deny file-read* file-write* (require-all (subpath "/dev")');
      expect(policy).not.toContain('(subpath "/dev") (subpath');
      expect(policy).not.toContain('/dev/cu.fixture');
      const upload = await prepareConfinement(root, join(root, 'tools'), '/dev/cu.fixture');
      expect(await readFile(upload.prefix[1], 'utf8')).toContain('(literal "/dev/cu.fixture")');
      await expect(prepareConfinement(root, root, '/etc/passwd')).rejects.toThrow(
        'Invalid selected serial device',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
