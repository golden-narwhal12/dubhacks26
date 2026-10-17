const { app, BrowserWindow } = require('electron');
const { mkdir, writeFile } = require('node:fs/promises');
const { resolve, join } = require('node:path');
const { spawnSync } = require('node:child_process');
app.whenReady().then(async () => {
  try {
    const folder = resolve('artifacts/trace.iconset');
    await mkdir(folder, { recursive: true });
    const win = new BrowserWindow({
      width: 1024,
      height: 1024,
      show: false,
      transparent: true,
      frame: false,
      webPreferences: { offscreen: true },
    });
    await win.loadFile(resolve('assets/trace.svg'));
    const icon = await win.webContents.capturePage();
    for (const size of [16, 32, 128, 256, 512])
      for (const scale of [1, 2])
        await writeFile(
          join(folder, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`),
          icon.resize({ width: size * scale, height: size * scale, quality: 'best' }).toPNG(),
        );
    const result = spawnSync(
      'iconutil',
      ['-c', 'icns', folder, '-o', resolve('assets/trace.icns')],
      { stdio: 'inherit', shell: false },
    );
    if (result.status !== 0) throw new Error('iconutil failed');
    app.quit();
  } catch (e) {
    console.error(e.message);
    app.exit(1);
  }
});
