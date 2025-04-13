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
    title: 'Ripit',
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

function downloadFile(url, callback) {
  https.get(url, (res) => {
    if (res.statusCode === 302 || res.statusCode === 301) {
      // Handle redirect
      const redirectUrl = res.headers.location;
      console.log(`Redirected to: ${redirectUrl}`);
      downloadFile(redirectUrl, callback); // Follow the redirect
    } else if (res.statusCode === 200) {
      // Handle successful response
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        callback(null, data);
      });
    } else {
      callback(new Error(`Failed to download file: ${res.statusCode}`));
    }
  }).on('error', (err) => {
    callback(err);
  });
}

function downloadYtDlp(url, callback) {
  https.get(url, (res) => {
    if (res.statusCode === 302 || res.statusCode === 301) {
      // Handle redirect
      const redirectUrl = res.headers.location;
      console.log(`Redirected to: ${redirectUrl}`);
      downloadYtDlp(redirectUrl, callback); // Follow the redirect
    } else if (res.statusCode === 200) {
      // Validate Content-Type
      const contentType = res.headers['content-type'];
      if (!contentType || !contentType.includes('application/octet-stream')) {
        callback(new Error(`Invalid Content-Type: ${contentType}`));
        return;
      }

      // Handle successful response
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        callback(null, data);
      });
    } else {
      callback(new Error(`Failed to download yt-dlp: ${res.statusCode}`));
    }
  }).on('error', (err) => {
    callback(err);
  });
}

function ensureYtDlpExists() {
  const ytDlpPath = path.join(os.tmpdir(), process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

  if (!fs.existsSync(ytDlpPath)) {
    // Determine the correct architecture
    const arch = os.arch();
    let ytDlpUrl;

    if (process.platform === 'win32') {
      ytDlpUrl = arch === 'x64'
        ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
        : arch === 'ia32'
        ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_win_x86.exe'
        : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_win_arm64.exe';
    } else if (process.platform === 'darwin') {
      ytDlpUrl = arch === 'arm64'
        ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos_arm64'
        : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
    } else {
      ytDlpUrl = arch === 'x64'
        ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'
        : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_arm';
    }

    console.log(`Downloading yt-dlp binary from: ${ytDlpUrl}`); // Debug log for URL

    return new Promise((resolve, reject) => {
      downloadYtDlp(ytDlpUrl, (err, data) => {
        if (err) {
          console.error(`Failed to download yt-dlp: ${err.message}`); // Log error
          dialog.showErrorBox('Error', 'Failed to download yt-dlp. Please check your internet connection or try again later.'); // Show error to user
          reject(err);
          return;
        }

        // Validate file size (e.g., ensure it's not too small or too large)
        if (data.length < 1_000_000) { // Example threshold: 1 MB
          console.error(`Downloaded file is too small: ${data.length} bytes`); // Debug log for file size
          dialog.showErrorBox('Error', 'Downloaded yt-dlp binary is invalid. Please try again later.'); // Show error to user
          reject(new Error('Downloaded file is too small to be a valid yt-dlp binary.'));
          return;
        }

        fs.writeFileSync(ytDlpPath, data);
        if (process.platform !== 'win32') {
          fs.chmodSync(ytDlpPath, 0o755); // Ensure executable permissions
        }
        console.log(`yt-dlp downloaded to: ${ytDlpPath}`); // Debug log for file path
        resolve(ytDlpPath);
      });
    });
  }

  // Ensure permissions for existing file
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(ytDlpPath, 0o755);
    } catch (err) {
      console.error(`Failed to set permissions for yt-dlp: ${err.message}`);
    }
  }

  console.log(`yt-dlp path resolved to: ${ytDlpPath}`);
  return Promise.resolve(ytDlpPath);
}

function ensureFfmpegExists() {
  const ffmpegPath = path.join(os.tmpdir(), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

  if (!fs.existsSync(ffmpegPath)) {
    const ffmpegUrl = process.platform === 'win32'
      ? 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip'
      : process.platform === 'darwin'
      ? 'https://evermeet.cx/ffmpeg/ffmpeg'
      : 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';

    console.log(`Downloading ffmpeg binary from: ${ffmpegUrl}`);

    return new Promise((resolve, reject) => {
      downloadFile(ffmpegUrl, (err, data) => {
        if (err) {
          console.error(`Failed to download ffmpeg: ${err.message}`);
          dialog.showErrorBox('Error', 'Failed to download ffmpeg. Please check your internet connection or try again later.');
          reject(err);
          return;
        }

        // Handle zip or tar.xz extraction for Windows/Linux
        if (process.platform === 'win32' || process.platform === 'linux') {
          const tempFilePath = path.join(os.tmpdir(), 'ffmpeg_download');
          fs.writeFileSync(tempFilePath, data);

          // Extract the binary
          const extract = require('extract-zip'); // Ensure you install this package
          extract(tempFilePath, { dir: os.tmpdir() })
            .then(() => {
              const extractedPath = path.join(os.tmpdir(), 'ffmpeg-master-latest-win64-gpl', 'bin', 'ffmpeg.exe');
              fs.renameSync(extractedPath, ffmpegPath);
              fs.unlinkSync(tempFilePath); // Clean up
              console.log(`ffmpeg downloaded to: ${ffmpegPath}`);
              resolve(ffmpegPath);
            })
            .catch((extractErr) => {
              console.error(`Failed to extract ffmpeg: ${extractErr.message}`);
              reject(extractErr);
            });
        } else {
          // For macOS, directly save the binary
          fs.writeFileSync(ffmpegPath, data);
          fs.chmodSync(ffmpegPath, 0o755); // Ensure executable permissions
          console.log(`ffmpeg downloaded to: ${ffmpegPath}`);
          resolve(ffmpegPath);
        }
      });
    });
  }

  console.log(`ffmpeg path resolved to: ${ffmpegPath}`);
  return Promise.resolve(ffmpegPath);
}

ipcMain.handle('fetch-video-resolutions', async (event, url) => {
  const ytDlpPath = await ensureYtDlpExists();

  // Log the resolved path for debugging
  console.log(`Using yt-dlp at: ${ytDlpPath}`);

  // Verify the file exists
  if (!fs.existsSync(ytDlpPath)) {
    throw new Error(`yt-dlp executable not found at: ${ytDlpPath}`);
  }

  const args = ['-F', url];

  return new Promise((resolve, reject) => {
    try {
      const ytDlpProcess = spawn(ytDlpPath, args, { shell: process.platform === 'win32' }); // Renamed to ytDlpProcess
      let output = '';
      let errorOutput = '';

      ytDlpProcess.stdout.on('data', (data) => {
        output += data;
        console.log(`yt-dlp stdout: ${data.toString()}`); // Log stdout
      });

      ytDlpProcess.stderr.on('data', (data) => {
        errorOutput += data;
        console.error(`yt-dlp stderr: ${data.toString()}`); // Log stderr
      });

      ytDlpProcess.on('close', (code) => {
        if (code === 0) {
          const resolutions = parseResolutions(output);
          resolve(resolutions);
        } else {
          console.error(`yt-dlp process exited with code ${code}`);
          console.error(`yt-dlp error output: ${errorOutput}`);
          reject(new Error('Failed to fetch resolutions'));
        }
      });
    } catch (err) {
      console.error(`Error spawning yt-dlp: ${err.message}`);
      reject(err);
    }
  });
});

ipcMain.on('download-youtube-video', async (event, { url, savePath, quality }) => {
  try {
    const ytDlpPath = await ensureYtDlpExists();
    const ffmpegPath = await ensureFfmpegExists(); // Ensure ffmpeg is available
    const args = ['-f', `${quality}+bestaudio`, '--ffmpeg-location', ffmpegPath, '-o', savePath, url];
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
