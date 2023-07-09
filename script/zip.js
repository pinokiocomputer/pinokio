const { exec } = require('child_process');
const path = require('path')
const version = process.env.npm_package_version

// Replace "ls -l" with your desired terminal command
const command = 'ls -l';

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

