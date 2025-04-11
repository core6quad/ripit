// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  downloadYouTubeVideo: (url, savePath, quality) => {
    ipcRenderer.send('download-youtube-video', { url, savePath, quality });
  },
  promptSaveLocation: () => ipcRenderer.invoke('prompt-save-location'),
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (_, data) => callback(data));
  },
  fetchVideoResolutions: (url) => ipcRenderer.invoke('fetch-video-resolutions', url),
  onDownloadError: (callback) => {
    ipcRenderer.on('download-error', (_, message) => callback(message));
  },
});
