const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const STORE_PATH = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return { width: 1280, height: 800 };
  }
}

function saveWindowState(win) {
  if (win.isMaximized()) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ maximized: true }));
  } else {
    const b = win.getBounds();
    fs.writeFileSync(STORE_PATH, JSON.stringify({ width: b.width, height: b.height, x: b.x, y: b.y }));
  }
}

function createWindow() {
  const state = loadWindowState();

  const win = new BrowserWindow({
    width: state.width || 1280,
    height: state.height || 800,
    x: state.x,
    y: state.y,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0d0d0d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hidden',
    frame: false,
  });

  if (state.maximized) win.maximize();

  win.loadFile(path.join(__dirname, 'index.html'));

  win.on('close', () => saveWindowState(win));

  return win;
}

app.whenReady().then(() => {
  const win = createWindow();

  ipcMain.handle('pick-folder', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select photo folder',
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('read-folder', (_, folderPath) => {
    const EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.heic', '.avif']);
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile() && EXTS.has(path.extname(e.name).toLowerCase()))
      .map(e => {
        const full = path.join(folderPath, e.name);
        const stat = fs.statSync(full);
        return { path: full, name: e.name, size: stat.size };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
    return files;
  });

  ipcMain.handle('read-image', (_, filePath) => {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return `data:image/${mime};base64,${data.toString('base64')}`;
  });

  ipcMain.handle('copy-script', (_, script) => {
    clipboard.writeText(script);
    return true;
  });

  ipcMain.handle('save-script', async (_, script) => {
    const result = await dialog.showSaveDialog(win, {
      title: 'Save delete script',
      defaultPath: path.join(os.homedir(), 'delete-photos.sh'),
      filters: [{ name: 'Shell Script', extensions: ['sh'] }],
    });
    if (result.canceled) return false;
    fs.writeFileSync(result.filePath, script, 'utf8');
    return result.filePath;
  });

  ipcMain.handle('minimize-window', () => win.minimize());
  ipcMain.handle('maximize-window', () => {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle('close-window', () => win.close());
});

app.on('window-all-closed', () => app.quit());
