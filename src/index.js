const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('node:path');
const fs = require('fs');
const https = require('https');
const os = require('os');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  //mainWindow.webContents.openDevTools();
};

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('prompt-save-location', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save Video As',
    defaultPath: 'video.mp4',
    filters: [{ name: 'Videos', extensions: ['mp4'] }],
  });
  return canceled ? null : filePath;
});

function ensureYtDlpExists() {
  const ytDlpPath = path.join(os.tmpdir(), process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  
  if (!fs.existsSync(ytDlpPath)) {
    const ytDlpUrl = process.platform === 'win32'
      ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
      : process.platform === 'darwin'
      ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
      : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

    return new Promise((resolve, reject) => {
      https.get(ytDlpUrl, response => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download yt-dlp: ${response.statusCode}`));
          return;
        }
        response.pipe(fs.createWriteStream(ytDlpPath))
          .on('finish', () => {
            if (process.platform !== 'win32') {
              fs.chmodSync(ytDlpPath, 0o755);
            }
            resolve(ytDlpPath);
          })
          .on('error', reject);
      }).on('error', reject);
    });
  }
  return Promise.resolve(ytDlpPath);
}

ipcMain.handle('fetch-video-resolutions', async (event, url) => {
  const ytDlpPath = await ensureYtDlpExists();
  const args = ['-F', url];
  
  return new Promise((resolve, reject) => {
    const process = spawn(ytDlpPath, args);
    let output = '';
    
    process.stdout.on('data', data => output += data);
    process.stderr.on('data', data => console.error(data.toString()));
    
    process.on('close', code => {
      if (code === 0) {
        const resolutions = parseResolutions(output);
        resolve(resolutions);
      } else {
        reject(new Error('Failed to fetch resolutions'));
      }
    });
  });
});

ipcMain.on('download-youtube-video', async (event, { url, savePath, quality }) => {
  try {
    const ytDlpPath = await ensureYtDlpExists();
    const args = ['-f', `${quality}+bestaudio`, '-o', savePath, url];
    const process = spawn(ytDlpPath, args);

    process.stdout.on('data', data => {
      const output = data.toString();
      const progress = output.match(/(\d+\.\d+)%/);
      if (progress) {
        event.sender.send('download-progress', {
          progress: parseFloat(progress[1]),
          eta: (output.match(/ETA\s+(\S+)/) || [])[1] || '--',
          speed: (output.match(/at\s+(\S+\/s)/) || [])[1] || '--'
        });
      }
    });

    process.stderr.on('data', data => console.error(data.toString()));

    process.on('close', code => {
      if (code === 0) {
        event.sender.send('download-progress', { progress: 100, eta: '0s', speed: '0B/s' });
      } else {
        event.sender.send('download-error', 'Download failed');
      }
    });
  } catch (error) {
    event.sender.send('download-error', error.message);
  }
});

function parseResolutions(output) {
  const lines = output.split('\n');
  const resolutions = [];
  let isHeaderPassed = false;

  lines.forEach((line) => {
    if (line.includes('ID') && line.includes('RESOLUTION')) {
      isHeaderPassed = true;
      return;
    }

    if (!isHeaderPassed) return;

    const match = line.match(/^\s*(\S+)\s+(\S+)\s+(\d+x\d+|\d+p|\d+k|audio only)?\s+.*?\s+(\S+)?$/);
    if (match) {
      const format = match[1];
      const extension = match[2];
      const resolution = match[3] || 'Unknown';
      const size = match[4] || 'Unknown';

      resolutions.push({ format, extension, resolution, size });
    }
  });

  return resolutions;
}
