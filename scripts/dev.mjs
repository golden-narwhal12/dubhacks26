import './desktop.mjs';
import { spawn } from 'node:child_process';
import electron from 'electron';
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], {
  stdio: 'inherit',
});
let app;
const stop = () => {
  app?.kill();
  vite.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch('http://127.0.0.1:5173');
    if (r.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
app = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, TRACE_DEV_URL: 'http://127.0.0.1:5173' },
});
app.on('exit', () => {
  vite.kill();
  process.exit(0);
});
