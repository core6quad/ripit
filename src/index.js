const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('node:path');
const fs = require('fs');
const https = require('https');
const os = require('os');
const extract = require('extract-zip'); // Ensure you install this package

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

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

ipcMain.handle('browse-for-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('browse-for-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
  });
  return canceled ? null : filePaths[0];
});

ipcMain.on('save-settings', (event, settings) => {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log('Settings saved:', settings);
});

ipcMain.handle('load-settings', async () => {
  if (fs.existsSync(settingsPath)) {
    return JSON.parse(fs.readFileSync(settingsPath));
  }
  return {
    downloadPathOption: 'ask',
    defaultDownloadPath: '',
    ytDlpOption: 'auto',
    ytDlpPath: '',
    ffmpegOption: 'auto',
    ffmpegPath: '',
    languageOption: 'system',
    customLanguage: 'en',
  };
});

ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url);
});

ipcMain.handle('get-translations', () => {
  const settings = fs.existsSync(settingsPath)
    ? JSON.parse(fs.readFileSync(settingsPath))
    : { languageOption: 'system', customLanguage: 'en' };

  const locale =
    settings.languageOption === 'custom' ? settings.customLanguage : app.getLocale();
  const localesPath = path.join(__dirname, 'locales');
  const defaultLocale = 'en';

  try {
    const translationsPath = path.join(localesPath, `${locale}.json`);
    if (fs.existsSync(translationsPath)) {
      return JSON.parse(fs.readFileSync(translationsPath, 'utf-8'));
    }
  } catch (error) {
    console.error(`Error loading translations for locale ${locale}:`, error);
  }

  // Fallback to English if locale not found
  return JSON.parse(fs.readFileSync(path.join(localesPath, `${defaultLocale}.json`), 'utf-8'));
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
    ipcMain.emit('yt-dlp-download');

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
        ipcMain.emit('download-complete');
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
  const ffprobePath = path.join(os.tmpdir(), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');

  if (!fs.existsSync(ffmpegPath) || !fs.existsSync(ffprobePath)) {
    ipcMain.emit('ffmpeg-download');

    const ffmpegUrl = process.platform === 'win32'
      ? 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip'
      : process.platform === 'darwin'
      ? 'https://evermeet.cx/ffmpeg/ffmpeg'
      : 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';

    console.log(`Downloading ffmpeg binaries from: ${ffmpegUrl}`);

    return new Promise((resolve, reject) => {
      downloadFile(ffmpegUrl, (err, data) => {
        if (err) {
          console.error(`Failed to download ffmpeg: ${err.message}`);
          dialog.showErrorBox('Error', 'Failed to download ffmpeg. Please check your internet connection or try again later.');
          reject(err);
          return;
        }

        if (process.platform === 'win32' || process.platform === 'linux') {
          const tempFilePath = path.join(os.tmpdir(), 'ffmpeg_download');
          fs.writeFileSync(tempFilePath, data);

          extract(tempFilePath, { dir: os.tmpdir() })
            .then(() => {
              const extractedPath = path.join(os.tmpdir(), 'ffmpeg-master-latest-win64-gpl', 'bin');
              fs.renameSync(path.join(extractedPath, 'ffmpeg.exe'), ffmpegPath);
              fs.renameSync(path.join(extractedPath, 'ffprobe.exe'), ffprobePath);
              fs.unlinkSync(tempFilePath);
              console.log(`ffmpeg binaries extracted to: ${os.tmpdir()}`);
              resolve({ ffmpeg: ffmpegPath, ffprobe: ffprobePath });
              ipcMain.emit('download-complete');
            })
            .catch((extractErr) => {
              console.error(`Failed to extract ffmpeg: ${extractErr.message}`);
              reject(extractErr);
            });
        } else {
          fs.writeFileSync(ffmpegPath, data);
          fs.chmodSync(ffmpegPath, 0o755);
          console.log(`ffmpeg downloaded to: ${ffmpegPath}`);
          resolve({ ffmpeg: ffmpegPath });
          ipcMain.emit('download-complete');
        }
      });
    });
  }

  console.log(`ffmpeg binaries resolved to: ${ffmpegPath}, ${ffprobePath}`);
  return Promise.resolve({ ffmpeg: ffmpegPath, ffprobe: ffprobePath });
}

ipcMain.handle('fetch-video-resolutions', async (event, url) => {
  const ytDlpPath = await ensureYtDlpExists();

  console.log(`Processing URL: ${url}`);
  console.log(`Using yt-dlp at: ${ytDlpPath}`);

  if (!fs.existsSync(ytDlpPath)) {
    throw new Error(`yt-dlp executable not found at: ${ytDlpPath}`);
  }

  const args = ['-F', url];

  return new Promise((resolve, reject) => {
    try {
      const ytDlpProcess = spawn(ytDlpPath, args, { shell: process.platform === 'win32' });
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

ipcMain.on('download-youtube-video', async (event, url, savePath, videoFormat, audioFormats, captionOptions) => {
  try {
    console.log('Download started with:', { url, savePath, videoFormat, audioFormats, captionOptions });
    const ytDlpPath = await ensureYtDlpExists();
    const { ffmpeg: ffmpegPath } = await ensureFfmpegExists();
    
    const formatString = [videoFormat, ...audioFormats].join('+');
    
    const args = [
      '-f', formatString,
      '--audio-multistream',
      '--ffmpeg-location', ffmpegPath
    ];

    // Add caption arguments if enabled
    if (captionOptions) {
      args.push('--write-subs', '--write-auto-subs');
      if (captionOptions.languages.length > 0) {
        args.push('--sub-lang', captionOptions.languages.join(','));
      }
      if (captionOptions.embed) {
        args.push('--embed-subs');
      }
    }

    args.push(
      '--newline',
      '--progress',
      '-o', savePath,
      url
    );
    
    console.log('Spawning yt-dlp with args:', args);
    const ytDlpProcess = spawn(ytDlpPath, args, { shell: process.platform === 'win32' });

    ytDlpProcess.stdout.on('data', data => {
      const output = data.toString();
      console.log('yt-dlp download output:', output);
      
      // Detect merging/encoding phase
      if (output.includes('[Merger]') || output.includes('[EmbedSubtitle]')) {
        event.sender.send('download-progress', {
          progress: 99,
          eta: '--',
          speed: '--',
          status: 'encoding'
        });
        return;
      }
      
      const progressMatch = output.match(/\[download\]\s*([0-9.]+)%/);
      if (progressMatch) {
        const progress = parseFloat(progressMatch[1]);
        const etaMatch = output.match(/ETA\s+([0-9:]+)/);
        const speedMatch = output.match(/at\s+([\d.]+[KMG]iB\/s)/);

        event.sender.send('download-progress', {
          progress: progress,
          eta: etaMatch ? etaMatch[1] : '--',
          speed: speedMatch ? speedMatch[1] : '--',
          status: 'downloading'
        });
      }
    });

    ytDlpProcess.stderr.on('data', data => {
      const error = data.toString();
      console.error('yt-dlp download error:', error);
      event.sender.send('download-error', error);
    });

    ytDlpProcess.on('close', code => {
      console.log('Download process exited with code:', code);
      if (code === 0) {
        event.sender.send('download-progress', { progress: 100, eta: '0s', speed: '0B/s' });
      } else {
        event.sender.send('download-error', 'Download failed');
      }
    });
  } catch (error) {
    console.error('Download error:', error);
    event.sender.send('download-error', error.message);
  }
});

function parseResolutions(output) {
  const lines = output.split('\n');
  const videoFormats = [];
  const audioFormats = [];
  let isHeaderPassed = false;

  lines.forEach((line) => {
    if (line.includes('ID') && line.includes('RESOLUTION')) {
      isHeaderPassed = true;
      return;
    }

    if (!isHeaderPassed) return;

    const match = line.match(/^\s*(\S+)\s+(\S+)\s+(\d+x\d+|\d+p|\d+k|audio only)?\s+(.*?)\s+(\S+)?$/);
    if (match) {
      const format = match[1];
      const extension = match[2];
      const resolution = match[3] || 'Unknown';
      const description = match[4] || '';
      const size = match[5] || 'Unknown';

      if (resolution === 'audio only' && extension === 'm4a') {
        audioFormats.push({ format, extension, resolution, description, size });
      } else if (resolution !== 'audio only' && 
                 extension === 'mp4' && 
                 description.includes('avc1')) {  // Only H.264/AVC video codec
        videoFormats.push({ format, extension, resolution, size });
      }
    }
  });

  // Sort video formats by quality (assuming resolution format like "1080p", "720p", etc.)
  videoFormats.sort((a, b) => {
    const getPixels = (res) => parseInt(res.resolution.match(/\d+/)[0]);
    return getPixels(b) - getPixels(a);
  });

  return { videoFormats, audioFormats };
}
