import { Menu, app, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
export function installMenu(window: () => BrowserWindow) {
  const action = (
    label: string,
    key: string,
    accelerator?: string,
  ): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => window().webContents.send('menu:action', key),
  });
  const menu: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        action('Settings…', 'settings', 'CmdOrCtrl+,'),
        { type: 'separator' },
        { role: 'services' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        action('New Project', 'new', 'CmdOrCtrl+N'),
        action('Open…', 'open', 'CmdOrCtrl+O'),
        action('Save As…', 'save', 'CmdOrCtrl+Shift+S'),
        action('Save', 'save', 'CmdOrCtrl+S'),
        action('Export Sketch…', 'export'),
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        action('Undo', 'undo', 'CmdOrCtrl+Z'),
        action('Redo', 'redo', 'CmdOrCtrl+Shift+Z'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        action('Prototype', 'prototype', 'CmdOrCtrl+1'),
        action('Debug', 'debug', 'CmdOrCtrl+2'),
        action('Issues and Output', 'output', 'CmdOrCtrl+J'),
        action('Reset Workspace Layout', 'layout'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Project',
      submenu: [
        action('Verify', 'verify', 'CmdOrCtrl+R'),
        action('Simulate Mega Firmware', 'simulate'),
        action('Reset Indicator Example', 'example'),
        { type: 'separator' },
        action('Undo Project Change', 'undo-project'),
        action('Redo Project Change', 'redo-project'),
      ],
    },
    {
      label: 'Board',
      submenu: [
        action('Select Board and Port…', 'board'),
        action('Refresh Ports', 'refresh'),
        action('Program Board…', 'program', 'CmdOrCtrl+U'),
        action('Start / Stop Monitoring…', 'monitor'),
        action('Reset Board…', 'reset'),
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
    { label: 'Help', submenu: [action('Execution Scope and Dependencies', 'help')] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
}
