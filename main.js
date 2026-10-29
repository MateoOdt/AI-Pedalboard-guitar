const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

let aiServer = null;

function startAIServer() {
  const script = path.join(__dirname, 'ai-server', 'server.py');
  try {
    aiServer = spawn('python3', [script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    aiServer.stderr.on('data', d => {
      const msg = d.toString().trim();
      if (msg) console.log('[AI]', msg);
    });
    aiServer.on('error', err => console.log('AI server error:', err.message));
    aiServer.on('exit', code => console.log('AI server exited with code', code));
  } catch (e) {
    console.log('Could not start AI server:', e.message);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 820,
    resizable: false,
    backgroundColor: '#0d0f14',
    title: 'Guitar Pedalboard',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.webContents.session.setPermissionRequestHandler((_, permission, callback) => {
    callback(permission === 'media');
  });

  win.loadFile('index.html');
}

app.whenReady().then(() => {
  startAIServer();
  createWindow();
});

app.on('window-all-closed', () => {
  if (aiServer) { aiServer.kill(); aiServer = null; }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (aiServer) { aiServer.kill(); aiServer = null; }
});

app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
