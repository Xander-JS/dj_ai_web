// Proceso principal de Electron para SYSTEM DJ.
// Sirve el frontend compilado (dist/) mediante un protocolo propio `app://`
// en lugar de file://, para que las rutas absolutas (/assets/...) y fetch()
// funcionen igual que en la web (necesario para imágenes, disco y modelo 3D).
const { app, BrowserWindow, protocol, net, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');

// Debe registrarse antes de que la app esté lista.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Los enlaces externos se abren en el navegador del sistema.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  win.loadURL('app://local/');
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    let relPath = decodeURIComponent(pathname);
    // SPA fallback: cualquier ruta sin extensión (p. ej. /mixer) sirve index.html
    // para que React Router (BrowserRouter) resuelva la navegación.
    if (relPath === '/' || !path.extname(relPath)) relPath = '/index.html';
    const filePath = path.join(DIST, relPath);
    // Evita salir de dist/ con rutas tipo ../
    if (!filePath.startsWith(DIST)) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
