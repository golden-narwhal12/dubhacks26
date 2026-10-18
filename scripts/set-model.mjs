import { spawn } from 'node:child_process';
import electron from 'electron';
const model = process.argv[2];
if (!model || !/^gemini-[A-Za-z0-9._-]{1,90}$/.test(model))
  throw Error('Supply a Gemini model ID.');
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, TRACE_SET_GEMINI_MODEL: model },
});
child.on('exit', (code) => process.exit(code ?? 1));
