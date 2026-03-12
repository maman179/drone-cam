import { app, BrowserWindow } from "electron";
import path from "path";
import { fileURLToPath } from "url";

// pengganti __dirname di ES Module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3001;

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true, // ✅ sembunyikan menu bar
    webPreferences: {
      contextIsolation: true,
    }
  });

  // hilangkan menu bar total
  mainWindow.setMenu(null);

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // jalankan express (ES Module)
  await import("./app/server.js");

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
