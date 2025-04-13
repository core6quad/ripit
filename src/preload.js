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
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  notifyContentUpdated: () => ipcRenderer.send('content-updated'),
  openResolutionDialog: (url) => ipcRenderer.send('open-resolution-dialog', url),
  onResolutionSelected: (callback) => ipcRenderer.on('resolution-selected', (_, resolution) => callback(resolution)),
  send: (channel, data) => ipcRenderer.send(channel, data), // Expose the send method
  on: (channel, listener) => ipcRenderer.on(channel, listener), // Expose a generic 'on' method
});

// Suppress specific DevTools errors
const originalConsoleError = console.error;
console.error = (...args) => {
  if (
    args[0]?.includes("Request Autofill.enable failed") ||
    args[0]?.includes("Request Autofill.setAddresses failed")
  ) {
    return; // Suppress these specific errors
  }
  originalConsoleError(...args); // Log other errors normally
};
