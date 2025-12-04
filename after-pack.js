module.exports = async (context) => {
  const chmodHandler = require('./chmod')
  const wrapLinuxLauncher = require('./wrap-linux-launcher')

  await chmodHandler(context)
  await wrapLinuxLauncher(context)
}

