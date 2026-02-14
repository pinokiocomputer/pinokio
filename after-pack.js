module.exports = async (context) => {
  const chmodHandler = require('./chmod')
  const wrapLinuxLauncher = require('./wrap-linux-launcher')
  const fixNativeModules = require('./fix-native-modules')

  await chmodHandler(context)
  await fixNativeModules(context)
  await wrapLinuxLauncher(context)
}

