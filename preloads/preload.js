const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getUserJson: () => ipcRenderer.invoke('get-user-json'),
    openLoginWindow: () => ipcRenderer.send('open-login-window') // NEW IPC call
});