const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, session } = require('electron');
const axios = require('axios');
const watchUserCameraFolders = require('./watcher-sender');
const { spawn } = require('child_process');

const host = 'http://localhost:3000';

let userDataDir;
let userDataPath;

function createFolderIfNeeded(folderPath) {
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }
}

function createMainWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preloads', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    win.loadFile('./pages/index.html');
}

function createLoginWindow() {
    const loginWin = new BrowserWindow({
        width: 1200,
        height: 800,
        alwaysOnTop: true,
        webPreferences: { contextIsolation: true }
    });

    loginWin.loadURL(host);
}

ipcMain.on('open-login-window', () => {
    createLoginWindow();
});

async function updateUserData(userJson, idToken) {
    const userFolder = path.join(userDataDir, userJson.id);
    createFolderIfNeeded(userFolder);

    const userJsonPath = path.join(userFolder, 'user.json');
    fs.writeFileSync(userJsonPath, JSON.stringify(userJson, null, 2));

    userJson.cams.forEach((cam) => {
        const camFolder = path.join(userFolder, cam.id);
        createFolderIfNeeded(camFolder);
    });

    watchUserCameraFolders(userFolder, userJson.id, userJson.cams, idToken);

    userJson.cams.forEach((cam) => {
        const rtspUrl = generateRtspUrl(cam);
        if (rtspUrl) {
            startFFmpegStream(rtspUrl, userJson.id, cam.id);
        }
    });
}

function generateRtspUrl(cam) {
    const { user, password, ip } = cam;
    if (user && password) return `rtsp://${user}:${password}@${ip}`;
    return `rtsp://${ip}`;
}

function startFFmpegStream(rtspUrl, userId, camId) {
    const userFolder = path.join(userDataDir, userId);
    const camFolder = path.join(userFolder, camId);
    createFolderIfNeeded(camFolder);

    const outputFile = path.join(camFolder, 'index.m3u8');

    const ffmpegArgs = [
        '-rtsp_transport', 'tcp',
        '-i', rtspUrl,
        '-fflags', '+flush_packets+genpts',
        '-max_delay', '0',
        '-flags', '-global_header',
        '-hls_time', '10',
        '-hls_list_size', '15',
        '-hls_flags', '+delete_segments+split_by_time',
        '-vcodec', 'copy',
        '-y',
        outputFile
    ];

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

    ffmpegProcess.stdout.on('data', (data) => console.log(`FFmpeg stdout: ${data}`));
    ffmpegProcess.stderr.on('data', (data) => console.error(`FFmpeg stderr: ${data}`));
    ffmpegProcess.on('close', (code) => {
        if (code === 0) console.log(`FFmpeg process for ${camId} completed.`);
        else console.error(`FFmpeg process for ${camId} exited with code ${code}`);
    });
}

ipcMain.handle('get-user-json', async () => {
    const cookies = await session.defaultSession.cookies.get({ url: host });

    const idToken = cookies.find(cookie => cookie.name === 'idToken')?.value;
    if (!idToken) return { error: 'No idToken cookie found' };

    console.log(idToken);

    try {
        const response = await axios.get(`${host}/user/json`, {
            headers: { Cookie: `idToken=${idToken}` }
        });

        console.log(response);
        await updateUserData(response.data, idToken);
        return response.data;
    } catch (error) {
        return { error: error.message || 'Request failed' };
    }
});

ipcMain.on('refresh-user-data', async (_event, userId) => {
    const cookies = await session.defaultSession.cookies.get({ url: host });
    const idToken = cookies.find(cookie => cookie.name === 'idToken')?.value;

    if (!idToken) {
        console.error('❌ No idToken found for refresh');
        return;
    }
    
    try {
        const response = await axios.get(`${host}/user/json`, {
            headers: { Cookie: `idToken=${idToken}` }
        });

        await updateUserData(response.data, idToken);
        console.log('✅ User data refreshed after restart');
    } catch (err) {
        console.error('⚠️ Failed to refresh user data on restart:', err.message);
    }
});

app.whenReady().then(() => {
    userDataPath = app.getPath('userData');
    userDataDir = path.join(userDataPath, 'user_data');
    createMainWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// Export only for testing or specific use
module.exports = {
    updateUserData
};