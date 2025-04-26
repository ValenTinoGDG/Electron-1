const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const WebSocket = require('ws');
const mime = require('mime-types');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { ipcMain } = require('electron');

let ws;
let watchers = {};
let userInfo = {};
let connected = false;

function connectWebSocket(userId, token) {
    if (connected) {
        console.log('🔌 WebSocket already connected');
        return;
    }

    console.log('🔄 Connecting to WebSocket server...');
    ws = new WebSocket('ws://localhost:3000/');

    ws.on('open', () => {
        console.log('📡 WebSocket connected. Sending auth...');
        connected = true;
        try {
            ws.send(JSON.stringify({
                type: 'auth',
                data: { userId, token }
            }));
        } catch (err) {
            console.warn('⚠️ Failed to send auth:', err.message);
        }
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
    });

    ws.on('close', () => {
        console.log('❎ WebSocket connection closed.');
        connected = false;
        setTimeout(() => connectWebSocket(userId, token), 5000);
    });

    ws.on('message', async (msg) => {
        try {
            const message = JSON.parse(msg);
            if (message.type === 'restart') {
                console.log('🔁 Received restart signal from server');
                await restartWatching();
            }
        } catch (err) {
            console.error('Invalid message from WebSocket:', msg);
        }
    });
}

function stopWatching() {
    Object.values(watchers).forEach(w => w.close());
    watchers = {};
    console.log('🛑 All watchers stopped.');
}

async function restartWatching() {
    if (!userInfo || !userInfo.token || !userInfo.userId) {
        console.warn('⚠️ Cannot restart: missing user info');
        return;
    }

    try {
        console.log('📩 Sending IPC to main for user refresh...');
        ipcMain.emit('refresh-user-data', null, userInfo.userId);
    } catch (err) {
        console.error('❌ IPC refresh failed:', err.message);
    }
}

function watchUserCameraFolders(userFolder, userId, camsArray, token) {
    userInfo = { userFolder, userId, cams: camsArray, token };

    connectWebSocket(userId, token);
    stopWatching();

    camsArray.forEach((cam) => {
        const camFolder = path.join(userFolder, cam.id);
        console.log(`👁️ Watching ${camFolder}`);
        watchers[cam.id] = startWatching(camFolder, cam.id, userId);
    });
}

function startWatching(camFolder, camId, userId) {
    const watcher = chokidar.watch(camFolder, {
        persistent: true,
        ignoreInitial: false,
        awaitWriteFinish: true
    });

    watcher.on('add', (filePath) => {
        console.log(`🆕 File added: ${filePath}`);
        sendFile(filePath, camId, userId);
    });

    watcher.on('change', (filePath) => {
        console.log(`✏️ File changed: ${filePath}`);
        sendFile(filePath, camId, userId);
    });

    watcher.on('unlink', (filePath) => {
        console.log(`❌ File deleted: ${filePath}`);
        const fileName = path.basename(filePath);
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify({
                    type: 'delete',
                    data: { fileName, userId, camId }
                }));
            } catch (err) {
                console.warn('⚠️ Failed to send delete:', err.message);
            }
        }
    });

    return watcher;
}

function sendFile(filePath, camId, userId) {
    const fileName = path.basename(filePath);
    const mimeType = mime.lookup(fileName) || 'application/octet-stream';
    const fileSize = fs.statSync(filePath).size;
    const fileId = uuidv4();

    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                const data = {
                    fileId,
                    userId,
                    camId,
                    fileName,
                    mimeType,
                    fileSize,
                    chunk: chunk.toString('base64')
                };
                ws.send(JSON.stringify({ type: 'chunk', data }));
            } catch (err) {
                console.warn(`⚠️ Failed to send chunk: ${err.message}`);
            }
        }
    });

    stream.on('end', () => console.log(`✅ Finished sending ${fileName}`));
    stream.on('error', err => console.error(`❗ Read error on ${fileName}:`, err));
}

module.exports = watchUserCameraFolders;