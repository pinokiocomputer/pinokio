const Pinokiod = require("pinokiod")
const config = require('./config')
const pinokiod = new Pinokiod(config)
let mode = pinokiod.kernel.store.get("mode") || "full"
//iprocess.env.PINOKIO_MODE = process.env.PINOKIO_MODE || 'desktop';
if (mode === 'minimal') {
  require('./minimal');
} else {
  require('./full');
}
