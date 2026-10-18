import { build } from 'esbuild';
await build({
  entryPoints: ['desktop/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist-desktop/main.cjs',
  external: ['electron', 'serialport'],
  sourcemap: true,
});
await build({
  entryPoints: ['desktop/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist-desktop/preload.cjs',
  external: ['electron'],
});
