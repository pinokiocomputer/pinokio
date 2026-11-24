const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  handleFrameNavigation,
  isApplicationContainerFrame,
  isRootShellUrl
} = require('../frame-navigation')

const fullPath = process.argv[2] || path.resolve(__dirname, '..', 'full.js')
const fullSource = fs.readFileSync(fullPath, 'utf8')
assert.ok(
  /webContents\.on\('will-frame-navigate',[\s\S]*?handleFrameNavigation\(\{[\s\S]*?openExternalNavigation:/.test(fullSource),
  'full.js must apply the tested frame-navigation policy to will-frame-navigate'
)
assert.ok(
  /setWindowOpenHandler\([\s\S]*?features === "browser"[\s\S]*?shell\.openExternal\(targetUrl\)/.test(fullSource),
  'explicit Open in Browser window actions must remain external'
)

const rootUrl = 'http://localhost:42000/'
const mainFrame = { parent: null }
const applicationFrame = { parent: mainFrame, url: 'http://127.0.0.1:7860/app' }
const visibleMediaFrame = { parent: applicationFrame, url: 'https://media.example/embed' }
const hiddenPreloadFrame = { parent: applicationFrame, url: 'https://media.example/preload' }
const nestedProviderFrame = { parent: visibleMediaFrame, url: 'https://nested.example/player' }

assert.strictEqual(isRootShellUrl('http://localhost:42000/', rootUrl), true)
assert.strictEqual(isRootShellUrl('http://localhost:42000/app', rootUrl), false)
assert.strictEqual(isApplicationContainerFrame({
  frame: applicationFrame,
  mainFrame,
  currentUrl: rootUrl,
  rootUrl
}), true)
assert.strictEqual(isApplicationContainerFrame({
  frame: visibleMediaFrame,
  mainFrame,
  currentUrl: rootUrl,
  rootUrl
}), false)
assert.strictEqual(isApplicationContainerFrame({
  frame: hiddenPreloadFrame,
  mainFrame,
  currentUrl: rootUrl,
  rootUrl
}), false)
assert.strictEqual(isApplicationContainerFrame({
  frame: nestedProviderFrame,
  mainFrame,
  currentUrl: rootUrl,
  rootUrl
}), false)
assert.strictEqual(isApplicationContainerFrame({
  frame: applicationFrame,
  mainFrame,
  currentUrl: 'http://localhost:42000/app',
  rootUrl
}), false)

const webContents = {
  mainFrame,
  getURL: () => rootUrl
}
const externalLaunches = []
const openExternalNavigation = ({ url }) => {
  let target
  try {
    target = new URL(url)
  } catch (_) {
    return false
  }
  if (target.protocol !== 'https:' || target.hostname.endsWith('.localhost')) {
    return false
  }
  externalLaunches.push(target.href)
  return true
}
const navigate = (frame, url) => handleFrameNavigation({
  event: { frame, url },
  webContents,
  rootUrl,
  openExternalNavigation
})

assert.strictEqual(navigate(visibleMediaFrame, 'https://media.example/video'), false)
assert.strictEqual(navigate(hiddenPreloadFrame, 'https://media.example/preload'), false)
assert.strictEqual(navigate(visibleMediaFrame, 'https://redirect.example/landing'), false)
assert.strictEqual(navigate(nestedProviderFrame, 'https://nested.example/playback'), false)
assert.strictEqual(navigate(visibleMediaFrame, 'https://redirect.example/landing'), false)
assert.strictEqual(externalLaunches.length, 0)

assert.strictEqual(navigate(applicationFrame, 'http://app.localhost:42000/page'), false)
assert.strictEqual(navigate(applicationFrame, 'file:///not-allowed'), false)
assert.strictEqual(navigate(applicationFrame, 'javascript:alert(1)'), false)
assert.strictEqual(externalLaunches.length, 0)

assert.strictEqual(navigate(applicationFrame, 'https://external.example/docs'), true)
assert.deepStrictEqual(externalLaunches, ['https://external.example/docs'])

console.log('Navigation policy checks passed')
