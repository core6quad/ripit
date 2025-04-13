// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  downloadYouTubeVideo: (url, savePath, videoFormat, audioFormats, captionOptions) => 
    ipcRenderer.send('download-youtube-video', url, savePath, videoFormat, audioFormats, captionOptions),
  promptSaveLocation: () => ipcRenderer.invoke('prompt-save-location'),
  onDownloadProgress: (callback) => {
    ipcRenderer.removeAllListeners('download-progress'); // Clean up any existing listeners
    ipcRenderer.on('download-progress', (_, data) => callback(data));
  },
  fetchVideoResolutions: (url) => ipcRenderer.invoke('fetch-video-resolutions', url),
  onDownloadError: (callback) => {
    ipcRenderer.on('download-error', (_, message) => callback(message));
  },
  saveSettings: (settings) => ipcRenderer.send('save-settings', settings),
  browseForFolder: () => ipcRenderer.invoke('browse-for-folder'),
  browseForFile: () => ipcRenderer.invoke('browse-for-file'),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  onYtDlpDownload: (callback) => ipcRenderer.on('yt-dlp-download', callback),
  onFfmpegDownload: (callback) => ipcRenderer.on('ffmpeg-download', callback),
  onDownloadComplete: (callback) => ipcRenderer.on('download-complete', callback),
  getTranslations: () => ipcRenderer.invoke('get-translations')
});
