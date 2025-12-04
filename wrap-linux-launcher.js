const fs = require('fs')
const path = require('path')

module.exports = async (context) => {
  const { appOutDir, electronPlatformName, packager } = context

  if (electronPlatformName !== 'linux') {
    return
  }

  const exeName = packager.executableName || packager.appInfo.productFilename
  const exePath = path.join(appOutDir, exeName)
  const wrappedExePath = path.join(appOutDir, `${exeName}-bin`)

  if (!fs.existsSync(exePath)) {
    console.warn(`[wrap-linux-launcher] Executable not found at ${exePath}, skipping wrapper`)
    return
  }

  const originalStat = fs.statSync(exePath)

  fs.renameSync(exePath, wrappedExePath)

  const wrapperScript = `#!/usr/bin/env sh
export ELECTRON_OZONE_PLATFORM_HINT=x11
export ELECTRON_DISABLE_GPU=1
exec "$(dirname "$0")/${exeName}-bin" --ozone-platform=x11 --disable-gpu --disable-gpu-sandbox "$@"
`

  fs.writeFileSync(exePath, wrapperScript, { mode: originalStat.mode || 0o755 })
}
