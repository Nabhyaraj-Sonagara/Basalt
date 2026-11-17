import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron';

export const SITE_URL = 'https://nabhyaraj-sonagara.github.io/Basalt/';
export const ISSUES_URL = 'https://github.com/Nabhyaraj-Sonagara/Basalt/issues';

interface MenuHooks {
  /** Runs a renderer command (by id from the command list) in the focused window. */
  command: (id: string) => void;
  checkForUpdates: () => void;
  isDev: boolean;
}

/** The native menu bar. Shortcuts are shown but handled by the renderer, so rebinding them keeps working. */
export function installMenu(h: MenuHooks): void {
  const isMac = process.platform === 'darwin';
  const cmd = (label: string, id: string, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    registerAccelerator: false,
    click: () => h.command(id),
  });
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { label: 'Check for Updates…', click: h.checkForUpdates },
              { type: 'separator' },
              cmd('Settings…', 'settings', 'CmdOrCtrl+,'),
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } as MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'File',
      submenu: [
        cmd('New Note', 'new-note', 'CmdOrCtrl+N'),
        cmd("Today's Daily Note", 'daily', 'CmdOrCtrl+Shift+D'),
        cmd('Open Note…', 'switcher', 'CmdOrCtrl+O'),
        cmd('Open in New Window', 'open-window'),
        { type: 'separator' },
        cmd('Open Another Folder…', 'open-hive'),
        cmd('Close Hive', 'close-hive'),
        ...(isMac ? [] : ([{ type: 'separator' }, cmd('Settings…', 'settings', 'Ctrl+,'), { type: 'separator' }, { role: 'quit' }] as MenuItemConstructorOptions[])),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        cmd('Command Palette…', 'palette', 'CmdOrCtrl+P'),
        cmd('Search', 'search', 'CmdOrCtrl+Shift+F'),
        { type: 'separator' },
        cmd('Toggle Left Sidebar', 'left'),
        cmd('Toggle Right Sidebar', 'right'),
        cmd('Toggle Reading View', 'toggle-reading', 'CmdOrCtrl+E'),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(h.isDev ? ([{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[]) : []),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Basalt Website', click: () => void shell.openExternal(SITE_URL) },
        { label: 'Report an Issue', click: () => void shell.openExternal(ISSUES_URL) },
        ...(isMac ? [] : ([{ type: 'separator' }, { label: 'Check for Updates…', click: h.checkForUpdates }, { role: 'about' }] as MenuItemConstructorOptions[])),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Right-click menu for editable text: spelling suggestions, clipboard, and note commands. */
export function editableContextMenu(
  wc: Electron.WebContents,
  params: Electron.ContextMenuParams,
  command: (id: string) => void,
): void {
  if (!params.isEditable) return;
  const items: MenuItemConstructorOptions[] = [];
  if (params.misspelledWord) {
    for (const s of params.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
    if (!params.dictionarySuggestions.length) items.push({ label: 'No suggestions', enabled: false });
    items.push({ label: `Add “${params.misspelledWord}” to Dictionary`, click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
    items.push({ type: 'separator' });
  }
  items.push({ role: 'cut', enabled: params.editFlags.canCut }, { role: 'copy', enabled: params.editFlags.canCopy }, { role: 'paste', enabled: params.editFlags.canPaste }, { type: 'separator' }, { role: 'selectAll' });
  // Only the note editor offers note commands.
  if (params.formControlType === 'none' && params.selectionText.trim()) {
    items.push({ type: 'separator' }, { label: 'Extract Selection to New Note', click: () => command('extract') });
  }
  Menu.buildFromTemplate(items).popup();
}
