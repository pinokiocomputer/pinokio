const exec = require('child_process').exec;
module.exports = async (context) => {
  const paths = [
    `${context.appOutDir}/resources/app.asar.unpacked/node_modules/go-get-folder-size/dist/go-get-folder-size_linux_386/go-get-folder-size`,
    `${context.appOutDir}/resources/app.asar.unpacked/node_modules/go-get-folder-size/dist/go-get-folder-size_linux_amd64_v1/go-get-folder-size`,
    `${context.appOutDir}/resources/app.asar.unpacked/node_modules/go-get-folder-size/dist/go-get-folder-size_linux_arm64/go-get-folder-size`,
  ]
  for(let p of paths) {
    await exec(`chmod +x "${p}"`);
  }
}
