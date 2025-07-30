const { autoUpdater } = require("electron-updater");
const ProgressBar = require('electron-progressbar');
const { dialog } = require('electron');

class Updater {
  run(mainWindow) {
    let progressBar = null;
    autoUpdater.autoDownload = false;

    autoUpdater.on('checking-for-update', () => {
      console.log('Checking for update...');
    });

    autoUpdater.on('update-available', (info) => {
      console.log('Update available:', info.version);

      dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Yes', 'No'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update Available',
        message: `Version ${info.version} is available. Do you want to download it now?`
      }).then(result => {
        if (result.response === 0) {
          if (progressBar) {
            progressBar.close();
            progressBar = null;
          }
          progressBar = new ProgressBar({
            indeterminate: false,
            text: "Downloading update...",
            detail: "Please wait...",
            browserWindow: {
              parent: mainWindow,
              modal: true,
              closable: false,
              minimizable: false,
              maximizable: false,
              width: 400,
              height: 120
            }
          });
          autoUpdater.downloadUpdate();
        }
      });
    });

    autoUpdater.on('update-not-available', () => {
      console.log('No update available.');
    });

    autoUpdater.on("download-progress", (progress) => {
      console.log(`Downloaded ${Math.round(progress.percent)}%`);
      if (progressBar && !progressBar.isCompleted()) {
        progressBar.value = Math.floor(progress.percent);
        progressBar.detail = `Downloaded ${Math.round(progress.percent)}% (${(progress.transferred / 1024 / 1024).toFixed(2)} MB of ${(progress.total / 1024 / 1024).toFixed(2)} MB)`;
      }
    });

    autoUpdater.on("update-downloaded", (info) => {
      console.log("Update downloaded:", info.version);

      if (progressBar && !progressBar.isCompleted()) {
        progressBar.setCompleted();
        progressBar = null;
      }

      dialog.showMessageBox(mainWindow, {
        type: "info",
        buttons: ["Restart Now", "Later"],
        title: "Update Ready",
        message: "A new version has been downloaded. Restart the application to apply the updates?"
      }).then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
    });

    autoUpdater.on("error", (err) => {
      console.error("Update error:", err);
      if (progressBar && !progressBar.isCompleted()) {
        progressBar.close();
        progressBar = null;
      }
    });

    autoUpdater.checkForUpdates();
  }
}

module.exports = Updater;
