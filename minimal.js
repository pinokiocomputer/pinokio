const { app, Tray, Menu, shell, nativeImage, BrowserWindow, session, Notification } = require('electron');
const path = require('path')
const os = require('os')
const fs = require('fs')
const Pinokiod = require("pinokiod")
const config = require('./config')
const Updater = require('./updater')
const pinokiod = new Pinokiod(config)
const updater = new Updater()
let tray
let hiddenWindow
let rootUrl
let splashWindow
let splashIcon

const getLogFileHint = () => {
  try {
    if (pinokiod && pinokiod.kernel && pinokiod.kernel.homedir) {
      return path.resolve(pinokiod.kernel.homedir, "logs", "stdout.txt")
    }
  } catch (err) {
  }
  return path.resolve(os.homedir(), ".pinokio", "logs", "stdout.txt")
}
const ensureSplashWindow = () => {
  if (splashWindow && !splashWindow.isDestroyed()) {
    return splashWindow
  }
  splashWindow = new BrowserWindow({
    width: 420,
    height: 320,
    frame: false,
    resizable: false,
    transparent: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      backgroundThrottling: false
    }
  })
  splashWindow.on('closed', () => {
    splashWindow = null
  })
  return splashWindow
}
const getSplashIcon = () => {
  if (splashIcon) {
    return splashIcon
  }
  const candidates = [
    path.join('assets', 'icon.png'),
    path.join('assets', 'icon_small@2x.png'),
    path.join('assets', 'icon_small.png'),
    'icon2.png'
  ]
  for (const relative of candidates) {
    const absolute = path.join(__dirname, relative)
    if (fs.existsSync(absolute)) {
      splashIcon = relative.split(path.sep).join('/')
      return splashIcon
    }
  }
  splashIcon = path.join('assets', 'icon_small.png').split(path.sep).join('/')
  return splashIcon
}
const updateSplashWindow = ({ state = 'loading', message, detail, logPath, icon } = {}) => {
  const win = ensureSplashWindow()
  const query = { state }
  if (message) {
    query.message = message
  }
  if (detail) {
    const trimmed = detail.length > 800 ? `${detail.slice(0, 800)}…` : detail
    query.detail = trimmed
  }
  if (logPath) {
    query.log = logPath
  }
  if (icon) {
    query.icon = icon
  }
  win.loadFile(path.join(__dirname, 'splash.html'), { query }).finally(() => {
    if (!win.isDestroyed()) {
      win.show()
    }
  })
}
const closeSplashWindow = () => {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close()
  }
}
const showStartupError = ({ message, detail, error } = {}) => {
  const formatted = detail || formatStartupError(error)
  updateSplashWindow({
    state: 'error',
    message: message || 'Pinokio could not start',
    detail: formatted,
    logPath: getLogFileHint(),
    icon: getSplashIcon()
  })
}
const formatStartupError = (error) => {
  if (!error) return ''
  if (error.stack) {
    return `${error.message || 'Unknown error'}\n\n${error.stack}`
  }
  if (error.message) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error, null, 2)
  } catch (err) {
    return String(error)
  }
}
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
}

app.on('second-instance', () => {
  if (rootUrl) {
    shell.openExternal(rootUrl)
  }
})

app.whenReady().then(async () => {
  if (!gotTheLock) {
    return
  }
  updateSplashWindow({
    state: 'loading',
    message: 'Starting Pinokio…',
    icon: getSplashIcon()
  })
  try {
    try {
      const portInUse = await pinokiod.running(pinokiod.port)
      if (portInUse) {
        showStartupError({
          message: 'Pinokio is already running',
          detail: `An existing Pinokio instance is using port ${pinokiod.port}. Please close it before launching another.`
        })
        return
      }
    } catch (checkError) {
      console.warn('Failed to verify pinokio port availability', checkError)
    }
    await pinokiod.start({
      onquit: () => {
        app.quit()
      },
      onrestart: () => {
        app.relaunch();
        app.exit()
      },
      browser: {
        clearCache: async () => {
          console.log('clear cache', session.defaultSession)
          await session.defaultSession.clearStorageData()
          console.log("cleared")
        }
      }
    })
  } catch (error) {
    console.error('Failed to start pinokiod', error)
    showStartupError({ error })
    return
  }
  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting) {
      return
    }
    if (pinokiod && pinokiod.kernel && typeof pinokiod.kernel.kill === 'function') {
      quitting = true
      e.preventDefault()
      try {
        pinokiod.kernel.kill()
      } catch (err) {
        console.warn('Failed to terminate pinokiod on quit', err)
      }
    }
  })
  closeSplashWindow()
  rootUrl = `http://localhost:${pinokiod.port}`
  if (process.platform === 'darwin') app.dock.hide();
  const assetsRoot = app.isPackaged ? process.resourcesPath : __dirname
  const iconPath = path.resolve(assetsRoot, "assets/icon_small.png")
  let icon = nativeImage.createFromPath(iconPath)
  icon = icon.resize({
    height: 24,
    width: 24 
  });
  console.log('Tray icon path:', iconPath, 'isEmpty:', icon.isEmpty()); // if true, image failed to load
  tray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open in Browser', click: () => shell.openExternal(rootUrl) },
    { label: 'Restart', click: () => { app.relaunch(); app.exit(); } },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setToolTip('Pinokio');
  tray.setContextMenu(contextMenu);
  const showNotification = (options = {}) => {
    try {
      new Notification({
        title: 'Pinokio',
        body: 'Running in background',
        ...options
      }).show()
    } catch (err) {
      console.warn('Failed to show background notification', err)
    }
  }
  const announceTray = () => {
    const platformHandlers = {
      darwin: () => {
        try {
          tray.setHighlightMode('always')
          tray.setTitle('Pinokio running')
          setTimeout(() => tray.setHighlightMode('selection'), 4000)
          setTimeout(() => tray.popUpContextMenu(contextMenu), 150)
        } catch (err) {
          console.warn('Failed to signal tray/notification on macOS', err)
        }
        showNotification()
      },
      win32: () => {
        try {
          app.setAppUserModelId('Pinokio')
        } catch (err) {
          console.warn('Failed to set AppUserModelID', err)
        }
        showNotification({ icon: iconPath })
      },
      default: () => {
        showNotification()
      }
    }
    const handler = platformHandlers[process.platform] || platformHandlers.default
    handler()
  }
  announceTray()
  tray.on('click', () => {
    tray.popUpContextMenu(contextMenu);
  });
  shell.openExternal(rootUrl);
  hiddenWindow = new BrowserWindow({ show: false });

  updater.run(hiddenWindow)
});
