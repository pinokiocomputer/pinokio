const { autoUpdater } = require("electron-updater");
const { dialog } = require('electron')

class Updater {
  run() {
    // Called when checking for an update
    autoUpdater.on('checking-for-update', () => {
      console.log('Checking for update...');
    });

    // Called when an update is available
    autoUpdater.on('update-available', (info) => {
      console.log('Update available:', info.version);
    });

    // Called when no update is found
    autoUpdater.on('update-not-available', () => {
      console.log('No update available.');
    });

    // Called on download progress
    autoUpdater.on('download-progress', (progress) => {
      console.log(`Download speed: ${progress.bytesPerSecond}`);
      console.log(`Downloaded ${Math.round(progress.percent)}%`);
    });

    // Called when the update has been downloaded
    autoUpdater.on('update-downloaded', (info) => {
      console.log('Update downloaded:', info.version);

      // Ask user if they want to install now
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['Restart Now', 'Later'],
        title: 'Update Available',
        message: 'A new version has been downloaded. Restart the application to apply the updates?'
      }).then(result => {
        if (result.response === 0) { // Restart Now
          autoUpdater.quitAndInstall();
        }
      });
    });
    autoUpdater.checkForUpdatesAndNotify();

  }
}
module.exports = Updater
