const { app, Tray, Menu, shell, nativeImage } = require('electron');
const path = require('path')
const Pinokiod = require("pinokiod")
const config = require('./config')
const Updater = require('./updater')
const pinokiod = new Pinokiod(config)
const updater = new Updater()
let tray
let hiddenWindow
app.whenReady().then(async () => {
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
  if (process.platform === 'darwin') app.dock.hide();
  let icon = nativeImage.createFromPath(path.resolve(process.resourcesPath, "assets/icon_small.png"))
  icon = icon.resize({
    height: 24,
    width: 24 
  });
  console.log('isEmpty:', icon.isEmpty()); // if true, image failed to load
  tray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open in Browser', click: () => shell.openExternal("http://localhost:42000") },
    { label: 'Restart', click: () => { app.relaunch(); app.exit(); } },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setToolTip('Pinokio');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    tray.popUpContextMenu(contextMenu);
  });
  shell.openExternal("http://localhost:42000");
  hiddenWindow = new BrowserWindow({ show: false });

  updater.run(hiddenWindow)
});
