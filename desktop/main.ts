import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { installMenu } from './menu';
import { HardwareService } from './hardware';
import { HardwareRequestInputSchema, ObserveSchema } from '../src/services/hardware';
import { join } from 'node:path';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { validateProject, parseProject, serializeProject } from '../src/domain/project';
import {
  listConnections,
  setConnection,
  keyFor,
  useReadOnlyEvaluationCredentials,
} from './credentials';
import { callProvider, ProviderSchema, ModelSchema } from './providers';
import { z } from 'zod';
import { parts } from '../src/parts/catalog';
import { runToolchain, toolchainCapabilities, configureToolRoot } from './toolchain';

let win: BrowserWindow;
const tasks = new Map<string, AbortController>();
const usedProviderRequests = new Set<string>();
const hardware = new HardwareService((snapshot) => {
  if (win && !win.isDestroyed()) win.webContents.send('hardware:snapshot', snapshot);
});
if (process.env.TRACE_TEST) (globalThis as any).__traceTestHardware = hardware;
// Keep the established profile/key store when changing the visible product name.
app.setPath('userData', join(app.getPath('appData'), 'Trace'));
// Electron binds macOS safeStorage to its startup name. Retain that identity,
// then set the visible name after readiness; encrypted keys stay in the same vault.
app.setName('Trace');
if (process.env.TRACE_EVALUATION && !process.env.TRACE_EVALUATION_FIXTURE) {
  app.commandLine.removeSwitch('use-mock-keychain');
  app.commandLine.removeSwitch('password-store');
}
if (process.env.TRACE_EVALUATION && !process.env.TRACE_EVALUATION_FIXTURE)
  useReadOnlyEvaluationCredentials(join(app.getPath('userData'), 'connections.v1.json'));
if (process.env.TRACE_TEST || process.env.TRACE_EVALUATION)
  app.setPath('userData', join(app.getPath('temp'), `trace-test-${process.pid}`));
function handle(channel: string, fn: (arg: any) => unknown) {
  ipcMain.handle(channel, (event, arg) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
      throw new Error('Untrusted IPC sender');
    if (
      process.env.TRACE_EVALUATION &&
      [
        'hardware:request',
        'hardware:approve',
        'project:save',
        'project:open',
        'project:export',
      ].includes(channel)
    )
      throw new Error(
        'Physical operations and user files are disabled during software evaluation.',
      );
    if (
      process.env.TRACE_EVALUATION &&
      !process.env.TRACE_EVALUATION_FIXTURE &&
      channel === 'connections:set'
    )
      throw new Error('Evaluation credentials are read-only.');
    return fn(arg);
  });
}
function createWindow() {
  win = new BrowserWindow({
    width: 1540,
    height: 980,
    minWidth: 960,
    minHeight: 640,
    show: !process.env.TRACE_TEST && !process.env.TRACE_EVALUATION,
    title: 'mudroom',
    backgroundColor: '#0c0f0d',
    titleBarStyle: 'default',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    const sourceHosts = new Set(
      parts.flatMap((p) =>
        p.evidence.map((e) => {
          try {
            return new URL(e.url).hostname;
          } catch {
            return '';
          }
        }),
      ),
    );
    let documentedSource = false;
    try {
      const target = new URL(url);
      documentedSource =
        target.protocol === 'https:' &&
        !target.username &&
        !target.password &&
        sourceHosts.has(target.hostname);
    } catch {}
    if (
      documentedSource ||
      /^https:\/\/(docs\.arduino\.cc|www\.kingbrightusa\.com|www\.vishay\.com|documentation\.espressif\.com|docs\.espressif\.com|busboard\.com|www\.busboard\.com|everlightamericas\.com|towerpro\.com\.tw|look\.ams-osram\.com)\//.test(
        url,
      )
    )
      void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => {
    for (const task of tasks.values()) task.abort();
  });
  if (process.env.TRACE_DEV_URL) void win.loadURL(process.env.TRACE_DEV_URL);
  else void win.loadFile(join(__dirname, '../dist/index.html'));
}
app.whenReady().then(async () => {
  app.setName('mudroom');
  if (process.env.TRACE_SET_GEMINI_MODEL) {
    try {
      const model = ModelSchema.parse(process.env.TRACE_SET_GEMINI_MODEL);
      await setConnection({ provider: 'gemini', model });
      console.log(`Gemini model saved: ${model}`);
      app.quit();
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Model configuration failed');
      app.exit(1);
    }
    return;
  }
  configureToolRoot(
    app.isPackaged
      ? join(process.resourcesPath, 'trace-tools')
      : join(__dirname, '../artifacts/tools'),
  );
  createWindow();
  installMenu(() => win);
  handle('project:title', (input) => {
    win.setTitle(z.string().min(1).max(100).parse(input));
  });
  handle('hardware:sync', (input) => hardware.syncProject(validateProject(input)));
  handle('hardware:discover', () => hardware.discover());
  handle('hardware:snapshot', () => hardware.snapshot());
  handle('hardware:verify', (input) => {
    const a = z
      .object({ project: z.unknown(), requestId: z.string().uuid() })
      .strict()
      .parse(input);
    return hardware.verify(validateProject(a.project), a.requestId);
  });
  handle('hardware:request', (input) => hardware.request(HardwareRequestInputSchema.parse(input)));
  handle('hardware:approve', (input) => {
    const a = z
      .object({ id: z.string().uuid(), overrideVerification: z.boolean().optional() })
      .strict()
      .parse(input);
    return hardware.approve(a.id, a.overrideVerification);
  });
  handle('hardware:cancel', (input) => hardware.cancel(z.string().uuid().parse(input)));
  handle('hardware:observe', (input) => {
    const a = z
      .object({ input: ObserveSchema, requestId: z.string().uuid() })
      .strict()
      .parse(input);
    return hardware.observe(a.input, a.requestId);
  });
  handle('project:export', async (input) => {
    const p = validateProject(input);
    const d = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Export sketch into folder',
    });
    if (d.canceled) return;
    const root = join(d.filePaths[0], `mudroom-sketch-${Date.now()}`),
      sketch = join(root, 'sketch');
    await mkdir(sketch, { recursive: true });
    const main =
      p.files.find((f) => f.path === 'sketch.ino') ?? p.files.find((f) => f.path.endsWith('.ino'));
    for (const f of p.files)
      await writeFile(join(sketch, f.id === main?.id ? 'sketch.ino' : f.path), f.content, 'utf8');
    await writeFile(
      join(root, 'configuration.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          targetBoardId: p.targetBoardId,
          boardSettings: p.boardSettings,
          dependencies: [
            'Selected Arduino core libraries',
            'Servo 1.3.0 when used; install the same official version in Arduino IDE',
          ],
          sourcePolicy: 'Exact visible source; no hidden transformations.',
        },
        null,
        2,
      ),
    );
  });
  handle('project:save', async (input) => {
    const p = validateProject(input);
    const d = await dialog.showSaveDialog(win, {
      defaultPath: `${p.name.replace(/[^a-zA-Z0-9-]/g, '-')}.trace.json`,
      filters: [{ name: 'mudroom project', extensions: ['trace.json'] }],
    });
    if (d.canceled || !d.filePath) return { cancelled: true };
    await writeFile(d.filePath, serializeProject(p), 'utf8');
    return { cancelled: false, name: d.filePath.split('/').at(-1) };
  });
  handle('project:open', async () => {
    const d = await dialog.showOpenDialog(win, {
      filters: [{ name: 'mudroom project', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (d.canceled) return { cancelled: true };
    if ((await stat(d.filePaths[0])).size > 4000000)
      throw new Error('Project exceeds the 4 MB local format limit.');
    const raw = await readFile(d.filePaths[0], 'utf8');
    return { cancelled: false, project: parseProject(raw), name: d.filePaths[0].split('/').at(-1) };
  });
  handle('connections:list', () => listConnections());
  handle('connections:set', (input) => setConnection(input));
  handle('connections:test', async (input) => {
    const a = z.object({ provider: ProviderSchema, model: ModelSchema }).strict().parse(input);
    const c = new AbortController();
    await callProvider(
      {
        ...a,
        system: 'Reply briefly.',
        messages: [{ role: 'user', text: 'Reply OK.' }],
        maxTokens: 256,
        requestId: crypto.randomUUID(),
      },
      await keyFor(a.provider),
      c.signal,
      () => {},
    );
    return {
      ok: true,
      message: 'Connection verified with a real API request. Small provider usage incurred.',
    };
  });
  handle('provider:turn', async (input) => {
    if (tasks.size >= 2) throw new Error('Task concurrency limit reached');
    const controller = new AbortController();
    const id = z.string().uuid().parse(input?.requestId);
    if (usedProviderRequests.has(id))
      throw new Error('Provider request ID already used; do not replay a response.');
    usedProviderRequests.add(id);
    tasks.set(id, controller);
    try {
      return await callProvider(
        input,
        await keyFor(ProviderSchema.parse(input?.provider)),
        controller.signal,
        (text) => win.webContents.send('provider:text', { requestId: id, text }),
      );
    } finally {
      tasks.delete(id);
    }
  });
  handle('task:cancel', (id) => {
    const key = z.string().uuid().parse(id);
    if (tasks.has(key)) tasks.get(key)!.abort();
    else return hardware.cancel(key).catch(() => undefined);
  });
  handle('toolchain:build', async (input) => {
    const a = z
      .object({ project: z.unknown(), requestId: z.string().uuid(), simulate: z.boolean() })
      .strict()
      .parse(input);
    const project = validateProject(a.project);
    if (tasks.size >= 2) throw new Error('Task concurrency limit reached');
    const c = new AbortController();
    tasks.set(a.requestId, c);
    try {
      return await runToolchain({ ...a, project }, c.signal);
    } finally {
      tasks.delete(a.requestId);
    }
  });
  handle('capabilities', async () => ({
    desktop: true,
    evaluation: !!process.env.TRACE_EVALUATION,
    ...(await toolchainCapabilities()),
  }));
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (win && !win.isDestroyed()) win.show();
  else createWindow();
});

app.on('before-quit', () => {
  void hardware.dispose();
  for (const task of tasks.values()) task.abort();
});
