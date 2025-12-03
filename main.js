const { app } = require('electron')
const Pinokiod = require("pinokiod")
const config = require('./config')
const pinokiod = new Pinokiod(config)

if (process.platform === 'linux') {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('ozone-platform', 'x11')
}

let mode = pinokiod.kernel.store.get("mode") || "full"
//iprocess.env.PINOKIO_MODE = process.env.PINOKIO_MODE || 'desktop';
if (mode === 'minimal' || mode === 'background') {
  require('./minimal');
} else {
  require('./full');
}
