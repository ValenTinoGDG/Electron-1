const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

contextBridge.exposeInMainWorld('electronAPI', {
    createCameraFolder: (cameraData) => ipcRenderer.invoke('create-camera-folder', cameraData)
});