const { exec } = require('child_process');
const path = require('path')
const fs = require('fs')
const version = process.env.npm_package_version

// Windows
let exePath = path.resolve(__dirname, `../dist/Pinokio Setup ${version}.exe`)
let zipPath = path.resolve(__dirname, `../dist/Pinokio-${version}-win32.zip`)
exec(`zip -j "${zipPath}" "${exePath}"`, (error, stdout, stderr) => {
  if (error) {
    console.error(`Error executing command: ${error}`);
    return;
  }

  console.log('Command executed successfully.');
  console.log('stdout:', stdout);
  console.log('stderr:', stderr);
});

// Mac


// find dmg files
const macPaths = [{
  dmg: path.resolve(__dirname, `../dist/Pinokio-${version}-arm64.dmg`),
  //temp: path.resolve(__dirname, `../dist/Pinokio-${version}-darwin-arm64-temp`),
  temp: `Pinokio-${version}-darwin-arm64`,
  //zip: path.resolve(__dirname, `../dist/Pinokio-${version}-darwin-arm64.zip`),
  zip: `Pinokio-${version}-darwin-arm64.zip`
}, {
  dmg: path.resolve(__dirname, `../dist/Pinokio-${version}.dmg`),
  //temp: path.resolve(__dirname, `../dist/Pinokio-${version}-darwin-intel-temp`),
  temp: `Pinokio-${version}-darwin-intel`,
  //zip: path.resolve(__dirname, `../dist/Pinokio-${version}-darwin-intel.zip`)
  zip: `Pinokio-${version}-darwin-intel.zip`
}]
let sentinelPath = path.resolve(__dirname, `../assets/Sentinel.app`)
for(let macPath of macPaths) {
  const zipPath = macPath.zip
  try {
    console.log("mkdirSync", path.resolve(__dirname, "../dist", macPath.temp))
    fs.mkdirSync(path.resolve(__dirname, "../dist", macPath.temp), { recursive: true })
  } catch (e) {
    console.log("E1", e)
  }
  try {
    fs.cpSync(macPath.dmg, path.resolve(__dirname, "../dist", macPath.temp, "install.dmg"), { force: true, recursive: true })
  } catch (e) {
    console.log("E2", e)
  }
  try {
    fs.cpSync(sentinelPath, path.resolve(__dirname, "../dist", macPath.temp, "Sentinel.app"), { force: true, recursive: true })
  } catch (e) {
    console.log("E3", e)
  }
  const cmd = `zip -r "${zipPath}" "${macPath.temp}"`
  console.log({ cmd })
  exec(cmd, { cwd: path.resolve(__dirname, "../dist") }, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error executing command: ${error}`);
      return;
    }

    console.log('Command executed successfully.');
    console.log('stdout:', stdout);
    console.log('stderr:', stderr);
  });
//  try {
//    fs.rmSync(path.resolve(__dirname, "../dist", macPath.temp), { recursive: true })
//  } catch (e) {
//  }
}
let rmFiles = [
  `Pinokio-${version}-arm64-mac.zip`,
  `Pinokio-${version}-mac.zip`,
//  `Pinokio-${version}-darwin-arm64`,
//  `Pinokio-${version}-darwin-intel`,
]
for(let f of rmFiles) {
  try {
    fs.rmSync(path.resolve(__dirname, "../dist", f), { recursive: true })
  } catch (e) {
  }
}
