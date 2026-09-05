const {app, screen, shell, BrowserWindow, ipcMain, dialog, clipboard, session, desktopCapturer, systemPreferences, Menu } = require('electron')
const windowStateKeeper = require('electron-window-state');
const fs = require('fs')
const path = require("path")
const Pinokiod = require("pinokiod")
const os = require('os')
const Updater = require('./updater')
const {
  configurePinokioUserAgent,
  sanitizeUserAgentForRequests
} = require('./user-agent')
const is_mac = process.platform.startsWith("darwin")
const platform = os.platform()
var mainWindow;
var root_url;
var wins = {}
var pinned = {}
var launched
var theme
var colors
var splashWindow
var splashIcon
var updateBannerPayload
var updateBannerDismissed = false
var updateInfo = null
var updateDownloadInFlight = false
const updateTestMode = (() => {
  const value = process.env.PINOKIO_TEST_UPDATE_BANNER
  if (!value) {
    return false
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
})()
let updateTestInterval = null
let updateTestTimeout = null
const UPDATE_RELEASES_URL = 'https://github.com/pinokiocomputer/pinokio/releases'
const setWindowTitleBarOverlay = (win, overlay) => {
  if (!win || !win.setTitleBarOverlay) {
    return
  }
  try {
    win.setTitleBarOverlay(overlay)
  } catch (e) {
//    console.log("ERROR", e)
  }
}
const applyTitleBarOverlayToAllWindows = () => {
  if (!colors) {
    return
  }
  const overlay = titleBarOverlay(colors)
  const browserWindows = BrowserWindow.getAllWindows()
  for (const win of browserWindows) {
    setWindowTitleBarOverlay(win, overlay)
  }
}
const updateThemeColors = (payload = {}) => {
  console.log("updateThemeColors", payload)
  const nextTheme = payload.theme
  const nextColors = payload.colors
  if (nextTheme) {
    theme = nextTheme
  }
  if (nextColors) {
    colors = nextColors
  }
  applyTitleBarOverlayToAllWindows()
}
const stripHtmlTags = (value) => {
  if (!value) {
    return ''
  }
  return String(value).replace(/<[^>]*>/g, '')
}
const buildReleaseNotesPreview = (notes) => {
  if (!notes) {
    return ''
  }
  let text = ''
  if (Array.isArray(notes)) {
    text = notes.map((note) => note && (note.note || note.releaseNotes || note.title || '')).join('\n')
  } else if (typeof notes === 'string') {
    text = notes
  } else {
    text = String(notes)
  }
  const cleaned = stripHtmlTags(text).replace(/\r/g, '')
  const lines = cleaned.split('\n').map((line) => line.trim()).filter(Boolean)
  if (!lines.length) {
    return ''
  }
  const firstLine = lines[0]
  if (firstLine.length > 140) {
    return `${firstLine.slice(0, 137)}...`
  }
  return firstLine
}
const buildProgressLabel = (progress) => {
  if (!progress || typeof progress.percent !== 'number') {
    return ''
  }
  const percent = Math.round(progress.percent)
  if (typeof progress.transferred === 'number' && typeof progress.total === 'number' && progress.total > 0) {
    const transferred = (progress.transferred / 1024 / 1024).toFixed(1)
    const total = (progress.total / 1024 / 1024).toFixed(1)
    return `${percent}% (${transferred} MB of ${total} MB)`
  }
  return `${percent}%`
}
const buildUpdateBannerPayload = (state, info, extra = {}) => {
  const resolved = info || {}
  return {
    state,
    version: resolved.version || '',
    notesPreview: buildReleaseNotesPreview(resolved.releaseNotes),
    releaseUrl: UPDATE_RELEASES_URL,
    ...extra
  }
}
const clearUpdateTestTimers = () => {
  if (updateTestInterval) {
    clearInterval(updateTestInterval)
    updateTestInterval = null
  }
  if (updateTestTimeout) {
    clearTimeout(updateTestTimeout)
    updateTestTimeout = null
  }
}
const showUpdateBannerTestAvailable = () => {
  updateInfo = {
    version: '99.9.9-test',
    releaseNotes: 'Simulated update for banner testing.'
  }
  updateDownloadInFlight = false
  updateBannerDismissed = false
  showUpdateBanner(buildUpdateBannerPayload('available', updateInfo))
}
const startUpdateBannerTestDownload = () => {
  if (!updateInfo) {
    showUpdateBannerTestAvailable()
  }
  clearUpdateTestTimers()
  updateDownloadInFlight = true
  let progress = 0
  const tick = () => {
    progress = Math.min(100, progress + 6 + Math.random() * 12)
    showUpdateBanner(buildUpdateBannerPayload('downloading', updateInfo, {
      progressPercent: progress,
      notesPreview: `${Math.round(progress)}%`
    }))
    if (progress >= 100) {
      clearUpdateTestTimers()
      updateDownloadInFlight = false
      showUpdateBanner(buildUpdateBannerPayload('ready', updateInfo))
    }
  }
  tick()
  updateTestInterval = setInterval(tick, 320)
}
const simulateUpdateBannerRestart = () => {
  clearUpdateTestTimers()
  hideUpdateBanner()
  updateTestTimeout = setTimeout(() => {
    showUpdateBannerTestAvailable()
  }, 800)
}
const dispatchUpdateBanner = (payload) => {
  updateBannerPayload = payload
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }
  if (payload && payload.state === 'available' && updateBannerDismissed) {
    return
  }
  if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    if (!mainWindow.webContents.isLoading()) {
      mainWindow.webContents.send('pinokio:update-banner', payload)
    }
  }
}
const showUpdateBanner = (payload) => {
  if (payload && payload.state === 'available' && updateBannerDismissed) {
    updateBannerPayload = payload
    return
  }
  dispatchUpdateBanner(payload || updateBannerPayload)
}
const hideUpdateBanner = () => {
  dispatchUpdateBanner({ state: 'hidden' })
}
let PORT
//let PORT = 42000
//let PORT = (platform === 'linux' ? 42000 : 80)

let config = require('./config')

const filter = function (item) {
  return item.browserName === 'Chrome';
};

const updater = new Updater()
const pinokiod = new Pinokiod(config)
const ENABLE_BROWSER_CONSOLE_LOG = process.env.PINOKIO_BROWSER_LOG === '1'
const browserConsoleState = new WeakMap()
const attachedConsoleListeners = new WeakSet()
const consoleLevelLabels = ['log', 'info', 'warn', 'error', 'debug']
let browserLogFilePath
let browserLogFileReady = false
let browserLogBuffer = []
let browserLogWritePromise = Promise.resolve()
let permissionHandlersInstalled = false
let injectorHandlersInstalled = false
const frameInjectorSyncState = new Map()
const frameInjectTargetRegistry = new Map()
const PINOKIO_INJECT_ISOLATED_WORLD_ID = 42000
const permissionPrompted = new Set()
const permissionPromptInFlight = new Set()
const safeParseUrl = (value, base) => {
  if (!value) {
    return null
  }
  try {
    if (base) {
      return new URL(value, base)
    }
    return new URL(value)
  } catch (err) {
    return null
  }
}
const externalNavigationGuards = new Map()
const PINOKIO_NAVIGATION_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  'pinokio.co',
  'pinokio.computer'
])
const PINOKIO_CO_HOST_PATTERN = /(^|\.)pinokio\.co$/
const isPinokioNavigationHost = (value) => {
  const hostname = String(value || '').trim().toLowerCase()
  if (!hostname) {
    return false
  }
  return PINOKIO_NAVIGATION_HOSTS.has(hostname)
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.pinokio.co')
    || hostname.endsWith('.pinokio.computer')
}
const unwrapContainerTarget = (target, rootParsed) => {
  let next = target
  while (next && next.pathname === '/container') {
    const innerUrl = next.searchParams.get('url')
    if (!innerUrl) {
      break
    }
    const unwrapped = safeParseUrl(innerUrl, rootParsed ? rootParsed.origin : undefined)
    if (!unwrapped || (unwrapped.protocol !== 'http:' && unwrapped.protocol !== 'https:') || unwrapped.href === next.href) {
      break
    }
    next = unwrapped
  }
  return next
}
const isPinokioWindowUrl = (value, rootUrl) => {
  const rootParsed = safeParseUrl(rootUrl)
  const target = unwrapContainerTarget(
    safeParseUrl(value, rootParsed ? rootParsed.origin : undefined),
    rootParsed
  )
  if (!rootParsed || !target || (target.protocol !== 'http:' && target.protocol !== 'https:')) {
    return false
  }
  return target.origin === rootParsed.origin
}
const isPinokioNavigationUrl = (value, base) => {
  const target = safeParseUrl(value, base || (root_url || undefined))
  if (!target || (target.protocol !== 'http:' && target.protocol !== 'https:')) {
    return false
  }
  return isPinokioWindowUrl(target.href, root_url) || isPinokioNavigationHost(target.hostname)
}
const isPinokioCommunityHandoffUrl = (value, base) => {
  const target = safeParseUrl(value, base || (root_url || undefined))
  if (!target || target.protocol !== 'https:') {
    return false
  }
  const hostname = normalizeRequestHostname(target.hostname)
  if (!PINOKIO_CO_HOST_PATTERN.test(hostname)) {
    return false
  }
  const origin = target.searchParams.get('origin')
  return isPinokiodServerRequestUrl(origin, root_url)
}
const getCommunityHandoffWindowBounds = (owner) => {
  let display
  try {
    display = owner && !owner.isDestroyed()
      ? screen.getDisplayMatching(owner.getBounds())
      : screen.getPrimaryDisplay()
  } catch (_) {
    display = null
  }
  const workArea = display && display.workArea ? display.workArea : { x: 0, y: 0, width: 1200, height: 820 }
  const width = Math.max(720, Math.floor(workArea.width || 1200))
  const height = Math.max(640, Math.floor(workArea.height || 820))
  return {
    x: Number.isFinite(workArea.x) ? workArea.x : 0,
    y: Number.isFinite(workArea.y) ? workArea.y : 0,
    width,
    height,
    minWidth: Math.min(720, width),
    minHeight: Math.min(520, height)
  }
}
const normalizeRequestHostname = (value) => String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '')
const isPinokiodRouterHost = (hostname) => hostname === 'pinokio.localhost'
const getRequestPort = (target) => {
  if (!target) {
    return ''
  }
  return target.port || (target.protocol === 'https:' ? '443' : target.protocol === 'http:' ? '80' : '')
}
const getLocalRequestHosts = () => {
  const hosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])
  try {
    const interfaces = os.networkInterfaces() || {}
    for (const entries of Object.values(interfaces)) {
      for (const entry of entries || []) {
        if (entry && entry.address) {
          hosts.add(normalizeRequestHostname(entry.address))
        }
      }
    }
  } catch (_) {
  }
  return hosts
}
const isLocalPinokioAppUrl = (value, base) => {
  const target = safeParseUrl(value, base || (root_url || undefined))
  if (!target || (target.protocol !== 'http:' && target.protocol !== 'https:')) {
    return false
  }
  const rootTarget = safeParseUrl(root_url)
  if (rootTarget && target.origin === rootTarget.origin) {
    return true
  }
  const pinokiodPort = rootTarget ? getRequestPort(rootTarget) : (PORT ? String(PORT) : '')
  if (!pinokiodPort || getRequestPort(target) !== pinokiodPort) {
    return false
  }
  const hostname = normalizeRequestHostname(target.hostname)
  return isPinokiodRouterHost(hostname) || hostname.endsWith('.localhost') || getLocalRequestHosts().has(hostname)
}
const isPinokiodServerRequestUrl = (value, base) => {
  const target = safeParseUrl(value, base || (root_url || undefined))
  if (!target || (target.protocol !== 'http:' && target.protocol !== 'https:')) {
    return false
  }

  const rootTarget = safeParseUrl(root_url)
  if (rootTarget && target.origin === rootTarget.origin) {
    return true
  }

  const hostname = normalizeRequestHostname(target.hostname)
  if (isPinokiodRouterHost(hostname)) {
    return true
  }

  const pinokiodPort = PORT ? String(PORT) : ''
  if (!pinokiodPort || getRequestPort(target) !== pinokiodPort) {
    return false
  }
  return hostname.endsWith('.localhost') || getLocalRequestHosts().has(hostname)
}
const getHttpNavigationTarget = (value, base) => {
  const target = safeParseUrl(value, base)
  if (!target || (target.protocol !== 'http:' && target.protocol !== 'https:')) {
    return null
  }
  return target
}
const resolveNavigationTarget = ({ url, openerWebContents, baseUrl } = {}) => {
  const openerUrl = (() => {
    if (typeof baseUrl === 'string' && baseUrl) {
      return baseUrl
    }
    try {
      return openerWebContents && !openerWebContents.isDestroyed()
        ? openerWebContents.getURL()
        : (root_url || '')
    } catch (_) {
      return root_url || ''
    }
  })()
  return getHttpNavigationTarget(url, openerUrl || (root_url || undefined))
}
const resolveTargetUrl = ({ url, openerWebContents, baseUrl } = {}) => {
  const target = resolveNavigationTarget({ url, openerWebContents, baseUrl })
  if (target) {
    return target.href
  }
  const raw = typeof url === 'string' ? url.trim() : ''
  if (!raw || raw === 'about:blank') {
    return ''
  }
  try {
    return new URL(raw).href
  } catch (_) {
    return raw
  }
}
const openHttpsInBrowser = ({ event, url, openerWebContents, baseUrl } = {}) => {
  const target = resolveNavigationTarget({ url, openerWebContents, baseUrl })
  if (target?.protocol !== 'https:') {
    return false
  }
  event?.preventDefault?.()
  shell.openExternal(target.href).catch(() => {})
  return true
}
const readFrameFieldSafely = (frame, field) => {
  if (!frame) {
    return undefined
  }
  try {
    return frame[field]
  } catch (_) {
    return undefined
  }
}
const openNonPinokioHttpsInBrowser = ({ event, owner, url, frame, openerWebContents, baseUrl } = {}) => {
  const target = resolveNavigationTarget({
    url,
    openerWebContents,
    baseUrl: baseUrl || readFrameFieldSafely(frame, 'url')
  })
  if (!target || !owner || owner.isDestroyed?.()) {
    return false
  }
  if (target.protocol !== 'https:' || isPinokioNavigationUrl(target.href)) {
    return false
  }
  if (event && typeof event.preventDefault === 'function') {
    event.preventDefault()
  }
  const frameId = readFrameFieldSafely(frame, 'frameToken')
    || readFrameFieldSafely(frame, 'frameTreeNodeId')
    || readFrameFieldSafely(frame, 'routingId')
  if (frameId) {
    const guardKey = `${owner.id}:${frameId}:${target.href}`
    const now = Date.now()
    const last = externalNavigationGuards.get(guardKey) || 0
    externalNavigationGuards.set(guardKey, now)
    setTimeout(() => {
      if (externalNavigationGuards.get(guardKey) === now) {
        externalNavigationGuards.delete(guardKey)
      }
    }, 1500)
    if (now - last < 1500) {
      return true
    }
  }
  shell.openExternal(target.href).catch(() => {})
  return true
}
const installForceDestroyOnClose = (win) => {
  if (!win || win.__pinokioCloseHandlerInstalled) {
    return
  }
  win.__pinokioCloseHandlerInstalled = true
  win.once('close', (event) => {
    if (win.isDestroyed()) {
      return
    }
    event.preventDefault()
    win.destroy()
  })
}
const resolveConsoleSourceUrl = (sourceId, pageUrl) => {
  const page = safeParseUrl(pageUrl)
  const source = safeParseUrl(sourceId, page ? page.href : undefined)
  if (source && (source.protocol === 'http:' || source.protocol === 'https:' || source.protocol === 'file:')) {
    return source.href
  }
  if (page) {
    return page.href
  }
  return null
}
const shouldLogUrl = (url) => {
  if (!ENABLE_BROWSER_CONSOLE_LOG) {
    return false
  }
  if (!url) {
    return false
  }
  const rootParsed = safeParseUrl(root_url)
  const target = safeParseUrl(url, rootParsed ? rootParsed.origin : undefined)
  if (!target) {
    return false
  }
  if (rootParsed) {
    if (target.origin !== rootParsed.origin) {
      return false
    }
    const normalizedTargetPath = (target.pathname || '').replace(/\/+$/, '')
    const normalizedRootPath = (rootParsed.pathname || '').replace(/\/+$/, '')
    if (normalizedTargetPath === normalizedRootPath) {
      return false
    }
  } else {
    const normalizedTargetPath = (target.pathname || '').replace(/\/+$/, '')
    if (!normalizedTargetPath) {
      return false
    }
  }
  return true
}
const getBrowserLogFile = () => {
  if (!ENABLE_BROWSER_CONSOLE_LOG) {
    return null
  }
  if (!browserLogFilePath) {
    if (!pinokiod || !pinokiod.kernel || !pinokiod.kernel.homedir) {
      return null
    }
    try {
      browserLogFilePath = pinokiod.kernel.path('logs/browser.log')
    } catch (err) {
      console.error('[BROWSER LOG] Failed to resolve browser log file path', err)
      return null
    }
  }
  return browserLogFilePath
}
const ensureBrowserLogFile = () => {
  if (!ENABLE_BROWSER_CONSOLE_LOG) {
    return null
  }
  const filePath = getBrowserLogFile()
  if (!filePath) {
    return null
  }
  if (browserLogFileReady) {
    return filePath
  }
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    if (fs.existsSync(filePath)) {
      try {
        const existingContent = fs.readFileSync(filePath, 'utf8')
        const existingLines = existingContent.split(/\r?\n/).filter((line) => line.length > 0)
        const filteredLines = []
        for (const line of existingLines) {
          const parts = line.split('\t')
          if (parts.length >= 2) {
            const urlPart = parts[1]
            if (!shouldLogUrl(urlPart)) {
              continue
            }
          }
          filteredLines.push(`${line}\n`)
          if (filteredLines.length > 100) {
            filteredLines.shift()
          }
        }
        browserLogBuffer = filteredLines
        fs.writeFileSync(filePath, browserLogBuffer.join(''))
      } catch (err) {
        console.error('[BROWSER LOG] Failed to prime existing browser log', err)
        browserLogBuffer = []
      }
    }
    browserLogFileReady = true
    return filePath
  } catch (err) {
    console.error('[BROWSER LOG] Failed to prepare browser log file', err)
    return null
  }
}
const titleBarOverlay = (colors) => {
  if (is_mac) {
    return false
  } else {
    return colors
  }
}
const getLogFileHint = () => {
  try {
    if (pinokiod && pinokiod.kernel && pinokiod.kernel.homedir) {
      return path.resolve(pinokiod.kernel.homedir, "logs", "stdout.txt")
    }
  } catch (err) {
  }
  return path.resolve(os.homedir(), ".pinokio", "logs", "stdout.txt")
}
const getSplashIcon = () => {
  if (splashIcon) {
    return splashIcon
  }
  const candidates = [
    path.join('assets', 'icon.png'),
    path.join('assets', 'icon_small@2x.png'),
    path.join('assets', 'icon_small.png'),
    'icon2.png'
  ]
  for (const relative of candidates) {
    const absolute = path.join(__dirname, relative)
    if (fs.existsSync(absolute)) {
      splashIcon = relative.split(path.sep).join('/')
      return splashIcon
    }
  }
  splashIcon = path.join('assets', 'icon_small.png').split(path.sep).join('/')
  return splashIcon
}
const getSplashVersion = () => {
  try {
    if (app && typeof app.getVersion === 'function') {
      const version = app.getVersion()
      if (version) {
        return version
      }
    }
  } catch (err) {
  }
  return config && config.version ? config.version : ''
}
const ensureSplashWindow = () => {
  if (splashWindow && !splashWindow.isDestroyed()) {
    return splashWindow
  }
  splashWindow = new BrowserWindow({
    width: 420,
    height: 320,
    frame: false,
    resizable: false,
    backgroundColor: '#ffffff',
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      spellcheck: false,
      backgroundThrottling: false
    }
  })
  splashWindow.on('closed', () => {
    splashWindow = null
  })
  return splashWindow
}
const updateSplashWindow = ({ state = 'loading', message, detail, logPath, icon } = {}) => {
  const win = ensureSplashWindow()
  const query = { state }
  if (message) {
    query.message = message
  }
  if (detail) {
    const trimmed = detail.length > 800 ? `${detail.slice(0, 800)}…` : detail
    query.detail = trimmed
  }
  if (logPath) {
    query.log = logPath
  }
  if (icon) {
    query.icon = icon
  }
  const version = getSplashVersion()
  if (version) {
    query.version = version
  }
  win.loadFile(path.join(__dirname, 'splash.html'), { query }).finally(() => {
    if (!win.isDestroyed()) {
      win.show()
    }
  })
}
const closeSplashWindow = () => {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close()
  }
}
const showStartupError = ({ message, detail, error } = {}) => {
  const formatted = detail || formatStartupError(error)
  updateSplashWindow({
    state: 'error',
    message: message || 'Pinokio could not start',
    detail: formatted,
    logPath: getLogFileHint(),
    icon: getSplashIcon()
  })
}
const formatStartupError = (error) => {
  if (!error) {
    return ''
  }
  if (error.stack) {
    return `${error.message || 'Unknown error'}\n\n${error.stack}`
  }
  if (error.message) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error, null, 2)
  } catch (err) {
    return String(error)
  }
}
const SESSION_COOKIE_TTL_DAYS = 90
const SESSION_COOKIE_TTL_SEC = SESSION_COOKIE_TTL_DAYS * 24 * 60 * 60
const SESSION_COOKIE_JAR_FILENAME = 'session-cookies.json'
let sessionCookieSavePromise = null
let isQuitting = false
const getSessionCookieJarPath = () => path.join(app.getPath('userData'), SESSION_COOKIE_JAR_FILENAME)
const buildCookieUrl = (cookie) => {
  if (!cookie || !cookie.domain) {
    return null
  }
  const host = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain
  if (!host) {
    return null
  }
  const scheme = cookie.secure ? 'https://' : 'http://'
  const cookiePath = cookie.path && cookie.path.startsWith('/') ? cookie.path : '/'
  return `${scheme}${host}${cookiePath}`
}
const serializeSessionCookie = (cookie) => {
  const url = buildCookieUrl(cookie)
  if (!url || typeof cookie.name !== 'string') {
    return null
  }
  const entry = {
    url,
    name: cookie.name,
    value: typeof cookie.value === 'string' ? cookie.value : '',
    path: cookie.path && cookie.path.startsWith('/') ? cookie.path : '/',
    secure: !!cookie.secure,
    httpOnly: !!cookie.httpOnly
  }
  if (cookie.hostOnly !== true && cookie.domain) {
    entry.domain = cookie.domain
  }
  if (cookie.sameSite) {
    entry.sameSite = cookie.sameSite
  }
  if (cookie.priority) {
    entry.priority = cookie.priority
  }
  if (cookie.sameParty != null) {
    entry.sameParty = cookie.sameParty
  }
  if (cookie.sourceScheme) {
    entry.sourceScheme = cookie.sourceScheme
  }
  if (Number.isInteger(cookie.sourcePort)) {
    entry.sourcePort = cookie.sourcePort
  }
  return entry
}
const persistSessionCookies = () => {
  if (sessionCookieSavePromise) {
    return sessionCookieSavePromise
  }
  sessionCookieSavePromise = (async () => {
    try {
      const cookies = await session.defaultSession.cookies.get({})
      const sessionCookies = cookies.filter((cookie) => cookie && cookie.session)
      const entries = sessionCookies.map(serializeSessionCookie).filter(Boolean)
      const jarPath = getSessionCookieJarPath()
      if (!entries.length) {
        await fs.promises.unlink(jarPath).catch((err) => {
          if (err && err.code !== 'ENOENT') {
            console.warn('[Session Cookies] Failed to remove jar', err)
          }
        })
        return
      }
      const payload = {
        version: 1,
        savedAt: Date.now(),
        cookies: entries
      }
      await fs.promises.mkdir(path.dirname(jarPath), { recursive: true }).catch(() => {})
      await fs.promises.writeFile(jarPath, JSON.stringify(payload), 'utf8')
    } catch (err) {
      console.warn('[Session Cookies] Failed to persist', err)
    } finally {
      sessionCookieSavePromise = null
    }
  })()
  return sessionCookieSavePromise
}
const restoreSessionCookies = async () => {
  const jarPath = getSessionCookieJarPath()
  let raw
  try {
    raw = await fs.promises.readFile(jarPath, 'utf8')
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.warn('[Session Cookies] Failed to read jar', err)
    }
    return
  }
  let data
  try {
    data = JSON.parse(raw)
  } catch (err) {
    console.warn('[Session Cookies] Failed to parse jar', err)
    return
  }
  const entries = Array.isArray(data.cookies) ? data.cookies : []
  if (!entries.length) {
    return
  }
  const expirationDate = Math.floor(Date.now() / 1000) + SESSION_COOKIE_TTL_SEC
  for (const entry of entries) {
    if (!entry || !entry.url || !entry.name) {
      continue
    }
    const details = {
      url: entry.url,
      name: entry.name,
      value: typeof entry.value === 'string' ? entry.value : '',
      path: entry.path || '/',
      secure: !!entry.secure,
      httpOnly: !!entry.httpOnly,
      expirationDate
    }
    if (entry.domain) {
      details.domain = entry.domain
    }
    if (entry.sameSite) {
      details.sameSite = entry.sameSite
    }
    if (entry.priority) {
      details.priority = entry.priority
    }
    if (entry.sameParty != null) {
      details.sameParty = entry.sameParty
    }
    if (entry.sourceScheme) {
      details.sourceScheme = entry.sourceScheme
    }
    if (Number.isInteger(entry.sourcePort)) {
      details.sourcePort = entry.sourcePort
    }
    try {
      await session.defaultSession.cookies.set(details)
    } catch (err) {
      console.warn('[Session Cookies] Failed to restore cookie', entry.name, err)
    }
  }
}
const clearPersistedSessionCookies = async () => {
  const jarPath = getSessionCookieJarPath()
  try {
    await fs.promises.unlink(jarPath)
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.warn('[Session Cookies] Failed to remove jar', err)
    }
  }
}
const clearSessionCaches = async () => {
  try {
    await session.defaultSession.clearCache()
  } catch (err) {
    console.warn('[Session Cache] Failed to clear http cache', err)
  }
  try {
    await session.defaultSession.clearStorageData({
      storages: ['serviceworkers', 'cachestorage']
    })
  } catch (err) {
    console.warn('[Session Cache] Failed to clear service worker/cache storage', err)
  }
}
function UpsertKeyValue(obj, keyToChange, value) {
  const keyToChangeLower = keyToChange.toLowerCase();
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === keyToChangeLower) {
      // Reassign old key
      obj[key] = value;
      // Done
      return;
    }
  }
  // Insert at end instead
  obj[keyToChange] = value;
}

const clearBrowserConsoleState = (webContents) => {
  if (browserConsoleState.has(webContents)) {
    browserConsoleState.delete(webContents)
  }
}

const updateBrowserConsoleTarget = (webContents, url) => {
  if (!ENABLE_BROWSER_CONSOLE_LOG) {
    return
  }
  if (!root_url) {
    clearBrowserConsoleState(webContents)
    return
  }
  let parsed
  try {
    parsed = new URL(url)
  } catch (e) {
    clearBrowserConsoleState(webContents)
    return
  }
  if (parsed.origin !== root_url) {
    clearBrowserConsoleState(webContents)
    return
  }
  const existing = browserConsoleState.get(webContents)
  if (existing && existing.url === parsed.href) {
    return
  }
  browserConsoleState.set(webContents, { url: parsed.href })
}

const inspectorSessions = new Map()
let inspectorHandlersInstalled = false

const inspectorLogFile = path.join(os.tmpdir(), 'pinokio-inspector.log')

const inspectorMainLog = (label, payload) => {
  try {
    const serialized = payload === undefined ? '' : ' ' + JSON.stringify(payload)
    const line = `[InspectorMain] ${label}${serialized}\n`
    try {
      fs.appendFileSync(inspectorLogFile, line)
    } catch (_) {}
    process.stdout.write(line)
  } catch (_) {
    try {
      fs.appendFileSync(inspectorLogFile, `[InspectorMain] ${label}\n`)
    } catch (_) {}
    process.stdout.write(`[InspectorMain] ${label}\n`)
  }
}

const normalizeInspectorUrl = (value) => {
  if (!value) {
    return null
  }
  try {
    return new URL(value).href
  } catch (_) {
    return value
  }
}

const urlsRoughlyMatch = (expected, candidate) => {
  if (!expected) {
    return true
  }
  if (!candidate) {
    return false
  }
  if (candidate === expected) {
    return true
  }
  return candidate.startsWith(expected) || expected.startsWith(candidate)
}

const flattenFrameTree = (frame, acc = [], depth = 0) => {
  if (!frame) {
    return acc
  }
  let frameName = null
  try {
    frameName = typeof frame.name === 'string' && frame.name.length ? frame.name : null
  } catch (_) {
    frameName = null
  }
  acc.push({ frame, depth, url: normalizeInspectorUrl(frame.url || ''), name: frameName })
  const children = Array.isArray(frame.frames) ? frame.frames : []
  for (const child of children) {
    flattenFrameTree(child, acc, depth + 1)
  }
  return acc
}

const findDescendantByUrl = (frame, targetUrl) => {
  if (!frame || !targetUrl) {
    return null
  }
  const normalizedTarget = normalizeInspectorUrl(targetUrl)
  if (!normalizedTarget) {
    return null
  }
  const stack = [frame]
  while (stack.length) {
    const current = stack.pop()
    try {
      const currentUrl = normalizeInspectorUrl(current.url || '')
      if (currentUrl && urlsRoughlyMatch(normalizedTarget, currentUrl)) {
        return current
      }
    } catch (_) {}
    const children = Array.isArray(current.frames) ? current.frames : []
    for (const child of children) {
      if (child) {
        stack.push(child)
      }
    }
  }
  return null
}

const selectTargetFrame = (webContents, payload = {}) => {
  if (!webContents || !webContents.mainFrame) {
    inspectorMainLog('no-webcontents', {})
    return null
  }
  const frames = flattenFrameTree(webContents.mainFrame, [])
  if (!frames.length) {
    inspectorMainLog('no-frames', { webContentsId: webContents.id })
    return null
  }
  inspectorMainLog('incoming', {
    frameUrl: payload.frameUrl || null,
    frameName: payload.frameName || null,
    frameNodeId: payload.frameNodeId || null,
    frameCount: frames.length,
  })

  const canonicalUrl = normalizeInspectorUrl(payload.frameUrl)
  const relativeOrdinal = typeof payload.candidateRelativeOrdinal === 'number' ? payload.candidateRelativeOrdinal : null
  const globalOrdinal = typeof payload.frameIndex === 'number' ? payload.frameIndex : null
  const canonicalFrameName = typeof payload.frameName === 'string' && payload.frameName.trim() ? payload.frameName.trim() : null
  const canonicalFrameNodeId = typeof payload.frameNodeId === 'string' && payload.frameNodeId.trim() ? payload.frameNodeId.trim() : null

  if (canonicalFrameName || canonicalFrameNodeId) {
    inspectorMainLog('identifier-search', {
      frameName: canonicalFrameName || null,
      frameNodeId: canonicalFrameNodeId || null,
      names: frames.map((entry) => entry.name || null).slice(0, 12),
    })

    let identifierMatch = null
    if (canonicalFrameNodeId) {
      identifierMatch = frames.find((entry) => entry && entry.name === canonicalFrameNodeId) || null
      if (identifierMatch) {
        const normalizedUrl = normalizeInspectorUrl(identifierMatch.url || '')
        if (canonicalUrl && (!normalizedUrl || !urlsRoughlyMatch(canonicalUrl, normalizedUrl))) {
          const descendant = findDescendantByUrl(identifierMatch.frame, canonicalUrl)
          if (descendant) {
            inspectorMainLog('identifier-match-node-descendant', {
              index: frames.indexOf(identifierMatch),
              name: identifierMatch.name || null,
              url: identifierMatch.url || null,
              descendantUrl: normalizeInspectorUrl(descendant.url || ''),
            })
            return descendant
          }
        }
        inspectorMainLog('identifier-match-node', {
          index: frames.indexOf(identifierMatch),
          name: identifierMatch.name || null,
          url: identifierMatch.url || null,
        })
        return identifierMatch.frame
      }
    }

    if (canonicalFrameName) {
      identifierMatch = frames.find((entry) => entry && entry.name === canonicalFrameName) || null
      if (identifierMatch) {
        const normalizedUrl = normalizeInspectorUrl(identifierMatch.url || '')
        if (canonicalUrl && (!normalizedUrl || !urlsRoughlyMatch(canonicalUrl, normalizedUrl))) {
          const descendant = findDescendantByUrl(identifierMatch.frame, canonicalUrl)
          if (descendant) {
            inspectorMainLog('identifier-match-name-descendant', {
              index: frames.indexOf(identifierMatch),
              name: identifierMatch.name || null,
              url: identifierMatch.url || null,
              descendantUrl: normalizeInspectorUrl(descendant.url || ''),
            })
            return descendant
          }
        }
        inspectorMainLog('identifier-match-name', {
          index: frames.indexOf(identifierMatch),
          name: identifierMatch.name || null,
          url: identifierMatch.url || null,
        })
        return identifierMatch.frame
      }
    }

    inspectorMainLog('identifier-miss', {})
  }

  let matches = frames
  if (canonicalUrl) {
    matches = frames.filter(({ url }) => urlsRoughlyMatch(canonicalUrl, url))
  }

  if (matches.length) {
    if (relativeOrdinal !== null) {
      const filtered = matches.slice().sort((a, b) => a.depth - b.depth || frames.indexOf(a) - frames.indexOf(b))
      const targetEntry = filtered[Math.min(Math.max(relativeOrdinal, 0), filtered.length - 1)]
      if (targetEntry) {
        inspectorMainLog('relative-ordinal-match', {
          index: frames.indexOf(targetEntry),
          name: targetEntry.name || null,
          url: targetEntry.url || null,
        })
        return targetEntry.frame
      }
    }
    const fallbackEntry = matches[0]
    if (fallbackEntry) {
      inspectorMainLog('fallback-match', {
        index: frames.indexOf(fallbackEntry),
        name: fallbackEntry.name || null,
        url: fallbackEntry.url || null,
      })
      return fallbackEntry.frame
    }
  }

  if (globalOrdinal !== null && frames[globalOrdinal]) {
    inspectorMainLog('global-ordinal-match', {
      index: globalOrdinal,
      name: frames[globalOrdinal].name || null,
      url: frames[globalOrdinal].url || null,
    })
    return frames[globalOrdinal].frame
  }

  inspectorMainLog('default-match', {
    name: frames[0]?.name || null,
    url: frames[0]?.url || null,
  })

  return frames[0]?.frame || null
}

const buildInspectorInjection = () => {
  const source = function () {
    try {
      if (window.__PINOKIO_INSPECTOR__ && typeof window.__PINOKIO_INSPECTOR__.stop === 'function') {
        window.__PINOKIO_INSPECTOR__.stop()
      }

      const overlay = document.createElement('div')
      overlay.style.position = 'fixed'
      overlay.style.pointerEvents = 'none'
      overlay.style.border = '2px solid rgba(77,163,255,0.9)'
      overlay.style.background = 'rgba(77,163,255,0.2)'
      overlay.style.boxShadow = '0 0 0 1px rgba(23,52,92,0.45)'
      overlay.style.zIndex = '2147483647'
      overlay.style.display = 'none'
      document.documentElement.appendChild(overlay)

      let active = true

      const post = (type, payload) => {
        try {
          window.parent.postMessage({ pinokioInspector: { type, frameUrl: window.location.href, ...payload } }, '*')
        } catch (err) {
          // ignore
        }
      }

      const updateBox = (target) => {
        if (!active || !target) {
          overlay.style.display = 'none'
          return
        }
        const rect = target.getBoundingClientRect()
        if (!rect || rect.width <= 0 || rect.height <= 0) {
          overlay.style.display = 'none'
          return
        }
        overlay.style.display = 'block'
        overlay.style.left = `${rect.left}px`
        overlay.style.top = `${rect.top}px`
        overlay.style.width = `${rect.width}px`
        overlay.style.height = `${rect.height}px`
      }

      const buildPathKeys = (node) => {
        if (!node) {
          return []
        }
        const keys = []
        let current = node
        let depth = 0
        while (current && current.nodeType === Node.ELEMENT_NODE && depth < 8) {
          const tag = current.tagName ? current.tagName.toLowerCase() : 'element'
          let descriptor = tag
          if (current.id) {
            descriptor += `#${current.id}`
          } else if (current.classList && current.classList.length) {
            descriptor += `.${Array.from(current.classList).slice(0, 2).join('.')}`
          }
          keys.push(descriptor)
          current = current.parentElement
          depth += 1
        }
        return keys.reverse()
      }

      const handleMove = (event) => {
        if (!active) {
          return
        }
        const target = event.target
        updateBox(target)
        post('update', {
          nodeName: target && target.tagName ? target.tagName.toLowerCase() : '',
          pathKeys: buildPathKeys(target),
        })
      }

      const preventClick = (event) => {
        if (!active) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
      }

      const handleClick = async (event) => {
        if (!active) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        
        const target = event.target
        const html = target && target.outerHTML ? target.outerHTML : ''
        let screenshot = null
        
        // Hide the overlay before taking screenshot to avoid capturing it
        if (overlay && overlay.style) {
          overlay.style.display = 'none'
        }
        
        // Small delay to ensure overlay is hidden before screenshot
        await new Promise(resolve => setTimeout(resolve, 50))
        
        try {
          // Use html2canvas-like approach to capture actual element rendering
          const rect = target.getBoundingClientRect()
          
          // Send element bounds for screenshot capture
          const screenshotRequest = {
            type: 'screenshot',
            bounds: {
              x: Math.round(rect.left),
              y: Math.round(rect.top),
              width: Math.max(1, Math.round(rect.width)),
              height: Math.max(1, Math.round(rect.height))
            },
            devicePixelRatio: window.devicePixelRatio || 1,
            frameUrl: window.location.href,
            __pinokioRelayStage: 0,
            __pinokioRelayComplete: window === window.top
          }
          
          // Post screenshot request via postMessage to main page
          try {
            console.log('Attempting screenshot capture...')
            console.log('electronAPI available in iframe:', !!window.electronAPI)
            console.log('Screenshot request:', screenshotRequest)
            
            // Send screenshot request to parent page via postMessage
            const response = await new Promise((resolve, reject) => {
              const messageId = 'screenshot_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
              
              const handleResponse = (event) => {
                if (event.data && event.data.pinokioScreenshotResponse && event.data.messageId === messageId) {
                  window.removeEventListener('message', handleResponse)
                  if (event.data.success) {
                    resolve(event.data.screenshot)
                  } else {
                    reject(new Error(event.data.error || 'Screenshot failed'))
                  }
                }
              }
              
              window.addEventListener('message', handleResponse)
              
              // Send request to parent page
              window.parent.postMessage({
                pinokioScreenshotRequest: screenshotRequest,
                messageId: messageId
              }, '*')
              
              // Timeout after 3 seconds
              setTimeout(() => {
                window.removeEventListener('message', handleResponse)
                reject(new Error('Screenshot timeout'))
              }, 3000)
            })
            
            screenshot = response
            console.log('Screenshot captured successfully via parent page')
          } catch (screenshotError) {
            console.error('Screenshot capture failed:', screenshotError)
            screenshot = null
          }
        } catch (error) {
          console.warn('Screenshot capture failed:', error)
          screenshot = null
        }
        
        post('complete', {
          outerHTML: html,
          pathKeys: buildPathKeys(target),
          screenshot: screenshot
        })
        stop()
      }

      const handleKey = (event) => {
        if (!active) {
          return
        }
        if (event.key === 'Escape') {
          post('cancelled', {})
          stop()
        }
      }

      const stop = () => {
        if (!active) {
          return
        }
        active = false
        document.removeEventListener('mousemove', handleMove, true)
        document.removeEventListener('mouseover', handleMove, true)
        document.removeEventListener('mousedown', preventClick, true)
        document.removeEventListener('click', handleClick, true)
        window.removeEventListener('keydown', handleKey, true)
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay)
        }
        window.__PINOKIO_INSPECTOR__ = null
      }

      document.addEventListener('mousemove', handleMove, true)
      document.addEventListener('mouseover', handleMove, true)
      document.addEventListener('mousedown', preventClick, true)
      document.addEventListener('click', handleClick, true)
      window.addEventListener('keydown', handleKey, true)

      window.__PINOKIO_INSPECTOR__ = {
        stop,
      }

      post('started', {})
    } catch (error) {
      try {
        window.parent.postMessage({ pinokioInspector: { type: 'error', frameUrl: window.location.href, message: error && error.message ? error.message : String(error) } }, '*')
      } catch (_) {}
    }
  }
  return `(${source.toString()})();`
}

const buildScreenshotRelayInjection = () => {
  const source = function () {
    try {
      if (window.__PINOKIO_SCREENSHOT_RELAY__) {
        return
      }
      window.__PINOKIO_SCREENSHOT_RELAY__ = true

      const pending = new Map()
      const EXPIRATION_MS = 5000

      const rememberSource = (messageId, sourceWindow) => {
        if (!messageId || !sourceWindow) {
          return
        }
        pending.set(messageId, sourceWindow)
        setTimeout(() => {
          pending.delete(messageId)
        }, EXPIRATION_MS)
      }

      const safeStringify = (value) => {
        try {
          return JSON.stringify(value)
        } catch (_) {
          return '"[unserializable]"'
        }
      }

      const log = (label, payload) => {
        try {
          console.log('[Pinokio Screenshot Relay] ' + label + ' ' + safeStringify(payload))
        } catch (_) {
          // ignore logging failures
        }
      }

      log('relay-installed', { href: window.location.href })

      window.addEventListener('message', (event) => {
        const data = event && event.data
        log('message-event', {
          href: window.location.href,
          hasData: Boolean(data),
          messageId: data && data.messageId ? data.messageId : null,
          hasRequest: Boolean(data && data.pinokioScreenshotRequest),
          hasResponse: Boolean(data && data.pinokioScreenshotResponse)
        })
        if (!data) {
          return
        }

        if (data.pinokioScreenshotRequest) {
          if (!event.source || event.source === window) {
            log('request-ignored-no-source', {
              href: window.location.href,
              messageId: data.messageId || null
            })
            return
          }

          rememberSource(data.messageId, event.source)
          log('request-processing', {
            href: window.location.href,
            messageId: data.messageId || null,
            originalBounds: data.pinokioScreenshotRequest && data.pinokioScreenshotRequest.bounds ? data.pinokioScreenshotRequest.bounds : null,
            originalDevicePixelRatio: data.pinokioScreenshotRequest ? data.pinokioScreenshotRequest.devicePixelRatio : null
          })

          let offsetX = 0
          let offsetY = 0
          let matchedFrame = false
          try {
            for (let index = 0; index < window.frames.length; index += 1) {
              const childWindow = window.frames[index]
              if (childWindow === event.source) {
                log('matching-window-frames', {
                  href: window.location.href,
                  messageId: data.messageId || null,
                  frameIndex: index
                })
                try {
                  const frameElement = childWindow.frameElement
                  if (frameElement) {
                    const rect = frameElement.getBoundingClientRect()
                    offsetX = rect ? rect.left || 0 : 0
                    offsetY = rect ? rect.top || 0 : 0
                    matchedFrame = true
                    log('matched-window-frames', {
                      href: window.location.href,
                      messageId: data.messageId || null,
                      frameIndex: index,
                      rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null
                    })
                    break
                  }
                } catch (error) {
                  log('frame-element-access-error', {
                    href: window.location.href,
                    messageId: data.messageId || null,
                    frameIndex: index,
                    error: error && error.message ? error.message : String(error)
                  })
                }
              }
            }

            if (!matchedFrame) {
              const FRAME_SELECTOR = 'iframe, frame'
              const frames = document.querySelectorAll ? document.querySelectorAll(FRAME_SELECTOR) : []
              log('matching-query-selector', {
                href: window.location.href,
                messageId: data.messageId || null,
                selector: FRAME_SELECTOR,
                count: frames ? frames.length : 0
              })
              for (const frameEl of frames) {
                if (!frameEl) {
                  continue
                }
                try {
                  if (frameEl.contentWindow === event.source) {
                    const rect = frameEl.getBoundingClientRect()
                    offsetX = rect ? rect.left || 0 : 0
                    offsetY = rect ? rect.top || 0 : 0
                    matchedFrame = true
                    log('matched-query-selector', {
                      href: window.location.href,
                      messageId: data.messageId || null,
                      selector: FRAME_SELECTOR,
                      rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null
                    })
                    break
                  }
                } catch (error) {
                  log('query-selector-access-error', {
                    href: window.location.href,
                    messageId: data.messageId || null,
                    selector: FRAME_SELECTOR,
                    error: error && error.message ? error.message : String(error)
                  })
                }
              }
            }
          } catch (error) {
            log('frame-enumeration-error', {
              href: window.location.href,
              messageId: data.messageId || null,
              error: error && error.message ? error.message : String(error)
            })
          }

          if (!matchedFrame) {
            log('frame-match-failed', {
              href: window.location.href,
              messageId: data.messageId || null,
              offsetX,
              offsetY
            })
          }

          const request = data.pinokioScreenshotRequest || {}
          const originalBounds = request.bounds || {}
          const parentDpr = window.devicePixelRatio || 1
          const currentDpr = request.devicePixelRatio && request.devicePixelRatio > 0 ? request.devicePixelRatio : 1
          const nextStage = (typeof request.__pinokioRelayStage === 'number' ? request.__pinokioRelayStage : 0) + 1
          request.__pinokioRelayStage = nextStage
          request.__pinokioRelayComplete = window.parent === window

          if (matchedFrame) {
            const adjustedBounds = {
              x: (originalBounds.x || 0) + offsetX,
              y: (originalBounds.y || 0) + offsetY,
              width: originalBounds.width || 0,
              height: originalBounds.height || 0,
            }

            request.bounds = adjustedBounds
            request.devicePixelRatio = Math.max(currentDpr, parentDpr)
            request.__pinokioAdjusted = true

            log('request-adjusted', {
              href: window.location.href,
              messageId: data.messageId || null,
              offsetX,
              offsetY,
              parentDpr,
              resultingBounds: adjustedBounds,
              originalBounds,
              resultingDevicePixelRatio: request.devicePixelRatio,
              relayStage: request.__pinokioRelayStage,
              relayComplete: request.__pinokioRelayComplete
            })
          } else {
            log('request-forward-unadjusted', {
              href: window.location.href,
              messageId: data.messageId || null,
              relayStage: request.__pinokioRelayStage,
              relayComplete: request.__pinokioRelayComplete
            })
          }

          data.pinokioScreenshotRequest = request

          log('request-forward', {
            href: window.location.href,
            messageId: data.messageId || null,
            matchedFrame,
            hasParent: Boolean(window.parent && window.parent !== window)
          })

          if (window.parent && window.parent !== window) {
            window.parent.postMessage(data, '*')
            if (event && typeof event.stopImmediatePropagation === 'function') {
              event.stopImmediatePropagation()
            }
            return
          }

          const targetSource = event.source
          const messageId = data.messageId
          const captureRequest = data.pinokioScreenshotRequest
          log('top-level-capture', {
            href: window.location.href,
            messageId,
            relayStage: captureRequest.__pinokioRelayStage,
            relayComplete: captureRequest.__pinokioRelayComplete,
            adjustedFlag: captureRequest.__pinokioAdjusted,
            bounds: captureRequest.bounds || null
          })

          const captureApi = window.electronAPI && typeof window.electronAPI.captureScreenshot === 'function'
            ? window.electronAPI.captureScreenshot
            : null

          if (!captureApi) {
            log('top-level-capture-missing-api', { href: window.location.href })
            return
          }

          Promise.resolve()
            .then(() => captureApi(captureRequest))
            .then((screenshot) => {
              log('top-level-capture-success', { href: window.location.href, messageId })
              try {
                targetSource.postMessage({
                  pinokioScreenshotResponse: true,
                  messageId,
                  success: true,
                  screenshot
                }, '*')
              } catch (error) {
                log('top-level-response-error', {
                  href: window.location.href,
                  messageId,
                  error: error && error.message ? error.message : String(error)
                })
              }
            })
            .catch((error) => {
              log('top-level-capture-error', {
                href: window.location.href,
                messageId,
                error: error && error.message ? error.message : String(error)
              })
              try {
                targetSource.postMessage({
                  pinokioScreenshotResponse: true,
                  messageId,
                  success: false,
                  error: error && error.message ? error.message : String(error)
                }, '*')
              } catch (responseError) {
                log('top-level-response-error', {
                  href: window.location.href,
                  messageId,
                  error: responseError && responseError.message ? responseError.message : String(responseError)
                })
              }
            })
          return
        }

        if (data.pinokioScreenshotResponse && data.messageId) {
          log('response-processing', {
            href: window.location.href,
            messageId: data.messageId
          })
          const target = pending.get(data.messageId)
          if (target && target !== event.source) {
            pending.delete(data.messageId)
            try {
              log('response-forwarding-down', {
                href: window.location.href,
                messageId: data.messageId
              })
              target.postMessage(data, '*')
              return
            } catch (error) {
              log('response-forwarding-error', {
                href: window.location.href,
                messageId: data.messageId,
                error: error && error.message ? error.message : String(error)
              })
            }
          }

          log('response-forwarding-up', {
            href: window.location.href,
            messageId: data.messageId,
            hasParent: Boolean(window.parent && window.parent !== window)
          })
          if (window.parent && window.parent !== window) {
            window.parent.postMessage(data, '*')
          }
        }
      }, true)
    } catch (error) {
      try {
        console.warn('[Pinokio Screenshot Relay] relay-install-error ' + (error && error.message ? error.message : String(error)))
      } catch (_) {
        // ignore logging failures
      }
    }
  }
  return `(${source.toString()})();`
}

const installScreenshotRelays = async (frame) => {
  if (!frame) {
    return
  }

  const topFrame = frame.top || frame
  const frames = flattenFrameTree(topFrame, [])
  for (const entry of frames) {
    const candidate = entry && entry.frame
    if (!candidate || candidate.isDestroyed && candidate.isDestroyed()) {
      continue
    }
    try {
      await candidate.executeJavaScript(buildScreenshotRelayInjection(), true)
    } catch (error) {
      console.warn('Screenshot relay injection failed:', error && error.message ? error.message : error)
    }
  }
}

const startInspectorSession = async (webContents, payload = {}) => {
  const existing = inspectorSessions.get(webContents.id)
  if (existing) {
    await stopInspectorSession(webContents)
  }

  const targetFrame = selectTargetFrame(webContents, payload)
  if (!targetFrame) {
    throw new Error('Unable to locate iframe to inspect.')
  }

  await installScreenshotRelays(targetFrame)
  await targetFrame.executeJavaScript(buildInspectorInjection(), true)


  const navigationHandler = () => {
    const resultPromise = stopInspectorSession(webContents)
    Promise.resolve(resultPromise).then((outcome) => {
      if (!webContents.isDestroyed()) {
        webContents.send('pinokio:inspector-cancelled', { frameUrl: (outcome && outcome.frameUrl) || targetFrame.url || payload.frameUrl || '' })
      }
    })
  }

  if (!webContents.isDestroyed()) {
    webContents.on('did-navigate', navigationHandler)
    webContents.on('did-navigate-in-page', navigationHandler)
  }

  inspectorSessions.set(webContents.id, {
    frame: targetFrame,
    navigationHandler,
  })

  return {
    frameUrl: targetFrame.url || payload.frameUrl || '',
  }
}

const stopInspectorSession = async (webContents) => {
  const session = inspectorSessions.get(webContents.id)
  if (!session) {
    return { frameUrl: '' }
  }
  inspectorSessions.delete(webContents.id)
  if (session.navigationHandler && !webContents.isDestroyed()) {
    webContents.removeListener('did-navigate', session.navigationHandler)
    webContents.removeListener('did-navigate-in-page', session.navigationHandler)
  }
  const frameUrl = session.frame && session.frame.url ? session.frame.url : ''
  try {
    await session.frame.executeJavaScript('window.__PINOKIO_INSPECTOR__ && window.__PINOKIO_INSPECTOR__.stop()', true)
  } catch (_) {}
  return { frameUrl }
}

const safeCaptureStringify = (value) => {
  try {
    return JSON.stringify(value)
  } catch (_) {
    return '"[unserializable]"'
  }
}

const captureLog = (label, payload) => {
  try {
    console.log('[Pinokio Capture] ' + label + ' ' + safeCaptureStringify(payload))
  } catch (_) {
    console.log('[Pinokio Capture] ' + label)
  }
}

const installInspectorHandlers = () => {
  console.log('Installing inspector handlers...')
  if (inspectorHandlersInstalled) {
    console.log('Inspector handlers already installed, skipping')
    return
  }
  inspectorHandlersInstalled = true
  console.log('Installing pinokio:capture-screenshot handler')

  ipcMain.handle('pinokio:start-inspector', async (event, payload = {}) => {
    try {
      const result = await startInspectorSession(event.sender, payload)
      event.sender.send('pinokio:inspector-started', { frameUrl: result.frameUrl })
      return { ok: true }
    } catch (error) {
      const message = error && error.message ? error.message : 'Unable to start inspect mode.'
      event.sender.send('pinokio:inspector-error', { message })
      throw new Error(message)
    }
  })

  ipcMain.handle('pinokio:stop-inspector', async (event) => {
    try {
      const result = await stopInspectorSession(event.sender)
      event.sender.send('pinokio:inspector-cancelled', { frameUrl: result.frameUrl || '' })
      return { ok: true }
    } catch (error) {
      const message = error && error.message ? error.message : 'Unable to stop inspect mode.'
      event.sender.send('pinokio:inspector-error', { message })
      throw new Error(message)
    }
  })

  ipcMain.handle('pinokio:capture-screenshot-debug', async (event, payload) => {
    const { screenshotRequest } = payload

    const emitDebug = (label, data) => {
      captureLog(label, data)
      try {
        event.sender.send('pinokio:capture-debug-log', {
          label,
          payload: data
        })
      } catch (_) {
        // ignore renderer emit errors
      }
    }

    emitDebug('handler-invoked', {
      senderId: event && event.sender ? event.sender.id : null,
      hasRequest: Boolean(screenshotRequest),
      bounds: screenshotRequest && screenshotRequest.bounds ? {
        x: screenshotRequest.bounds.x,
        y: screenshotRequest.bounds.y,
        width: screenshotRequest.bounds.width,
        height: screenshotRequest.bounds.height,
      } : null,
      devicePixelRatio: screenshotRequest ? screenshotRequest.devicePixelRatio : null,
      adjustedFlag: Boolean(screenshotRequest && screenshotRequest.__pinokioAdjusted),
      relayStage: screenshotRequest && typeof screenshotRequest.__pinokioRelayStage !== 'undefined' ? screenshotRequest.__pinokioRelayStage : null,
      relayComplete: screenshotRequest && typeof screenshotRequest.__pinokioRelayComplete !== 'undefined' ? screenshotRequest.__pinokioRelayComplete : null,
      frameOffset: screenshotRequest && screenshotRequest.frameOffset ? {
        x: screenshotRequest.frameOffset.x,
        y: screenshotRequest.frameOffset.y,
      } : null
    })
    if (!screenshotRequest || !screenshotRequest.bounds) {
      throw new Error('Invalid screenshot request')
    }
    
    // Get the inspector session to access the target frame
    const session = inspectorSessions.get(event.sender.id)
    if (!session || !session.frame) {
      throw new Error('No inspector session or frame found')
    }
    
    try {
      const bounds = screenshotRequest.bounds
      const dpr = screenshotRequest.devicePixelRatio || 1
      const alreadyAdjusted = Boolean(screenshotRequest.__pinokioAdjusted)

      emitDebug('incoming-bounds', {
        senderId: event && event.sender ? event.sender.id : null,
        bounds,
        devicePixelRatio: dpr,
        alreadyAdjusted,
        relayStage: screenshotRequest && typeof screenshotRequest.__pinokioRelayStage !== 'undefined' ? screenshotRequest.__pinokioRelayStage : null,
        relayComplete: screenshotRequest && typeof screenshotRequest.__pinokioRelayComplete !== 'undefined' ? screenshotRequest.__pinokioRelayComplete : null
      })

      let framePosition = { x: 0, y: 0 }

      if (!alreadyAdjusted) {
        try {
          framePosition = await session.frame.executeJavaScript(`
            (function() {
              let x = 0, y = 0;
              let currentWindow = window;

              while (currentWindow !== window.top) {
                try {
                  const frameElement = currentWindow.frameElement;
                  if (frameElement) {
                    const rect = frameElement.getBoundingClientRect();
                    x += rect.left;
                    y += rect.top;
                  }
                } catch (error) {
                  return { x, y, crossOriginBlocked: true };
                }
                currentWindow = currentWindow.parent;
              }

              return { x, y };
            })();
          `)
          if (framePosition && framePosition.crossOriginBlocked) {
            framePosition = { x: framePosition.x || 0, y: framePosition.y || 0 }
          }
        } catch (error) {
          console.warn('Unable to determine frame offset via DOM script:', error)
          framePosition = { x: 0, y: 0 }
          emitDebug('frame-position-fallback', {
            senderId: event && event.sender ? event.sender.id : null,
            error: error && error.message ? error.message : String(error)
          })
        }
      }

      emitDebug('frame-position-computed', {
        senderId: event && event.sender ? event.sender.id : null,
        alreadyAdjusted,
        framePosition,
        bounds,
        devicePixelRatio: dpr,
        relayStage: screenshotRequest && typeof screenshotRequest.__pinokioRelayStage !== 'undefined' ? screenshotRequest.__pinokioRelayStage : null,
        relayComplete: screenshotRequest && typeof screenshotRequest.__pinokioRelayComplete !== 'undefined' ? screenshotRequest.__pinokioRelayComplete : null
      })
      
      // Capture full page and crop to element bounds
      const fullImage = await event.sender.capturePage()
      const fullSize = fullImage.getSize()
      emitDebug('capture-page-size', {
        senderId: event && event.sender ? event.sender.id : null,
        fullSize
      })
      
      // Calculate crop bounds with frame position and device pixel ratio
      const cropBounds = {
        x: Math.round((bounds.x + framePosition.x) * dpr),
        y: Math.round((bounds.y + framePosition.y) * dpr),  
        width: Math.round(bounds.width * dpr),
        height: Math.round(bounds.height * dpr)
      }
      
      // Validate crop bounds
      cropBounds.x = Math.max(0, Math.min(cropBounds.x, fullSize.width - 1))
      cropBounds.y = Math.max(0, Math.min(cropBounds.y, fullSize.height - 1))
      cropBounds.width = Math.min(cropBounds.width, fullSize.width - cropBounds.x)
      cropBounds.height = Math.min(cropBounds.height, fullSize.height - cropBounds.y)
      emitDebug('crop-bounds', {
        senderId: event && event.sender ? event.sender.id : null,
        framePosition,
        dpr,
        validatedCropBounds: cropBounds,
        fullSize
      })
      
      const croppedImage = fullImage.crop(cropBounds)
      const buffer = croppedImage.toPNG()
      emitDebug('capture-success', {
        senderId: event && event.sender ? event.sender.id : null,
        cropWidth: cropBounds.width,
        cropHeight: cropBounds.height
      })
      
      return 'data:image/png;base64,' + buffer.toString('base64')
    } catch (error) {
      console.error('Screenshot capture failed:', error)
      emitDebug('capture-error', {
        senderId: event && event.sender ? event.sender.id : null,
        error: error && error.message ? error.message : String(error)
      })
      throw error
    }
  })
}

const getFrameInjectorKey = (frame) => {
  if (!frame) {
    return ''
  }
  if (typeof frame.frameTreeNodeId === 'number') {
    return `frame:${frame.frameTreeNodeId}`
  }
  const processId = typeof frame.processId === 'number' ? frame.processId : 'unknown'
  const token = typeof frame.frameToken === 'string' && frame.frameToken
    ? frame.frameToken
    : String(typeof frame.routingId === 'number' ? frame.routingId : 'unknown')
  return `${processId}:${token}`
}

const getPinokioInjectWebContentsKey = (sender, frame = null) => {
  if (sender && typeof sender.id === 'number') {
    return `wc:${sender.id}`
  }
  if (frame && frame.hostWebContents && typeof frame.hostWebContents.id === 'number') {
    return `wc:${frame.hostWebContents.id}`
  }
  return ''
}

const serializeForJavaScript = (value) => JSON.stringify(value)
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029')

const normalizePinokioInjectDescriptor = (descriptor) => {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    return null
  }
  const src = typeof descriptor.src === 'string' ? descriptor.src.trim() : ''
  if (!src) {
    return null
  }
  const match = Array.isArray(descriptor.match) && descriptor.match.length
    ? descriptor.match.filter((item) => typeof item === 'string' && item.trim())
    : ['*']
  const world = typeof descriptor.world === 'string' && descriptor.world.trim().toLowerCase() === 'isolated'
    ? 'isolated'
    : 'main'
  const whenValue = typeof descriptor.when === 'string' ? descriptor.when.trim().toLowerCase() : ''
  const when = (whenValue === 'start' || whenValue === 'end') ? whenValue : 'idle'
  const frameValue = typeof descriptor.frame === 'string' ? descriptor.frame.trim().toLowerCase() : ''
  const frame = frameValue === 'all' ? 'all' : 'self'
  return {
    src,
    match,
    world,
    when,
    frame
  }
}

const normalizePinokioInjectTargetRegistrations = (targets) => {
  const values = Array.isArray(targets) ? targets : []
  const normalized = []
  for (const target of values) {
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      continue
    }
    const name = typeof target.name === 'string' ? target.name.trim() : ''
    const src = normalizeInspectorUrl(typeof target.src === 'string' ? target.src.trim() : '')
    if (!name && !src) {
      continue
    }
    normalized.push({
      name,
      src,
      inject: Array.isArray(target.inject)
        ? target.inject.map((entry) => normalizePinokioInjectDescriptor(entry)).filter(Boolean)
        : []
    })
  }
  return normalized
}

const findFramePath = (frame, target, trail = []) => {
  if (!frame || !target) {
    return null
  }
  const nextTrail = trail.concat(frame)
  if (frame === target) {
    return nextTrail
  }
  const children = Array.isArray(frame.frames) ? frame.frames : []
  for (const child of children) {
    const result = findFramePath(child, target, nextTrail)
    if (result) {
      return result
    }
  }
  return null
}

const resolvePinokioRelativeMatchTarget = (href) => {
  try {
    const parsed = new URL(href)
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/'
  } catch (_) {
    return href || ''
  }
}

const escapePinokioPattern = (value) => String(value || '').replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
const pinokioPatternToExpression = (value) => {
  const input = String(value || '')
  let expression = ''
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (char === '*') {
      while (input[index + 1] === '*') {
        index += 1
      }
      expression += '.*'
      continue
    }
    expression += escapePinokioPattern(char)
  }
  return `^${expression}$`
}

const matchesPinokioInjectPattern = (pattern, currentUrl) => {
  if (typeof pattern !== 'string') {
    return false
  }
  const normalizedPattern = pattern.trim()
  if (!normalizedPattern) {
    return false
  }
  const sourceValue = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(normalizedPattern)
    ? currentUrl
    : resolvePinokioRelativeMatchTarget(currentUrl)
  const expression = pinokioPatternToExpression(normalizedPattern)
  try {
    return new RegExp(expression).test(sourceValue)
  } catch (_) {
    return false
  }
}

const matchPinokioInjectTargetToFrame = (targets, frame, hints = {}) => {
  if (!Array.isArray(targets) || !targets.length) {
    return null
  }
  const frameName = (frame && typeof frame.name === 'string' ? frame.name.trim() : '')
    || (typeof hints.frameName === 'string' ? hints.frameName.trim() : '')
  const frameUrl = normalizeInspectorUrl((frame && frame.url) || '')
    || normalizeInspectorUrl(typeof hints.frameUrl === 'string' ? hints.frameUrl.trim() : '')

  let matched = null
  if (frameName) {
    matched = targets.find((entry) => entry.name && entry.name === frameName && (!entry.src || urlsRoughlyMatch(entry.src, frameUrl)))
      || targets.find((entry) => entry.name && entry.name === frameName)
  }
  if (!matched && frameUrl) {
    matched = targets.find((entry) => entry.src && urlsRoughlyMatch(entry.src, frameUrl)) || null
  }
  return matched
}

const resolvePinokioInjectTargetMatch = ({ registry, frame, currentUrl, targetHints, descendantDepth = 0 }) => {
  if (!registry || !Array.isArray(registry.targets) || registry.targets.length === 0) {
    return null
  }
  const target = matchPinokioInjectTargetToFrame(registry.targets, frame, targetHints)
  if (!target) {
    return null
  }
  const inject = target.inject.filter((descriptor) => {
    if (descriptor && descriptor.frame !== 'all' && descendantDepth !== 0) {
      return false
    }
    const matches = Array.isArray(descriptor.match) && descriptor.match.length
      ? descriptor.match
      : ['*']
    return matches.some((pattern) => matchesPinokioInjectPattern(pattern, currentUrl))
  })
  return {
    target,
    inject
  }
}

const resolvePinokioInjectorsForFrame = (frame, payload = {}, sender = null) => {
  if (!frame) {
    return {
      inject: [],
      context: null
    }
  }
  const requestedContext = payload && payload.context && typeof payload.context === 'object'
    ? payload.context
    : {}
  const currentUrl = typeof requestedContext.currentUrl === 'string' && requestedContext.currentUrl.trim()
    ? requestedContext.currentUrl.trim()
    : (normalizeInspectorUrl(frame.url || '') || '')
  let ownerFrame = frame.parent || null
  let directChildFrame = frame
  let descendantDepth = 0
  const targetHints = {
    frameName: typeof requestedContext.frameName === 'string' ? requestedContext.frameName.trim() : '',
    frameUrl: currentUrl
  }

  while (ownerFrame) {
    const ownerKey = getFrameInjectorKey(ownerFrame)
    const registry = frameInjectTargetRegistry.get(ownerKey)
    if (!registry || !Array.isArray(registry.targets) || registry.targets.length === 0) {
      directChildFrame = ownerFrame
      ownerFrame = ownerFrame.parent || null
      descendantDepth += 1
      continue
    }
    const match = resolvePinokioInjectTargetMatch({
      registry,
      frame: directChildFrame,
      currentUrl,
      targetHints,
      descendantDepth
    })
    if (!match) {
      directChildFrame = ownerFrame
      ownerFrame = ownerFrame.parent || null
      descendantDepth += 1
      continue
    }
    return {
      inject: match.inject,
      context: {
        frameUrl: normalizeInspectorUrl(ownerFrame.url || '') || '',
        rootFrameUrl: normalizeInspectorUrl(directChildFrame.url || '') || '',
        currentUrl,
        pageUrl: normalizeInspectorUrl(frame.url || '') || currentUrl
      }
    }
  }

  const webContentsKey = getPinokioInjectWebContentsKey(sender, frame)
  if (webContentsKey) {
    const registries = Array.from(frameInjectTargetRegistry.entries())
      .map(([ownerKey, registry]) => ({ ownerKey, registry }))
      .filter(({ registry }) => registry && registry.webContentsKey === webContentsKey && Array.isArray(registry.targets) && registry.targets.length > 0)
      .sort((left, right) => (right.registry.updatedAt || 0) - (left.registry.updatedAt || 0))
    for (const entry of registries) {
      const match = resolvePinokioInjectTargetMatch({
        registry: entry.registry,
        frame,
        currentUrl,
        targetHints,
        descendantDepth: 0
      })
      if (!match) {
        continue
      }
      return {
        inject: match.inject,
        context: {
          frameUrl: entry.registry.pageUrl || '',
          rootFrameUrl: normalizeInspectorUrl(frame.url || '') || currentUrl,
          currentUrl,
          pageUrl: entry.registry.pageUrl || currentUrl
        }
      }
    }
  }

  return {
    inject: [],
    context: null
  }
}

const PINOKIO_ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/

const resolvePinokioInjectSourceUrl = (value) => {
  if (typeof value !== 'string') {
    return ''
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }
  if (!PINOKIO_ABSOLUTE_URL_PATTERN.test(trimmed) && !trimmed.startsWith('/')) {
    return ''
  }
  const baseUrl = root_url || 'http://localhost'
  const parsed = safeParseUrl(trimmed, baseUrl)
  if (!parsed) {
    return ''
  }
  if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) {
    return ''
  }
  return parsed.href
}

const buildPinokioInjectRuntimeBootstrap = () => {
  const source = function() {
    const resolveTargetWindow = () => {
      try {
        if (window.parent && window.parent !== window) {
          return window.parent
        }
      } catch (_) {
      }
      try {
        if (window.top && window.top !== window) {
          return window.top
        }
      } catch (_) {
      }
      return window
    }

    const ensureApi = () => {
      if (!window.$pinokio || typeof window.$pinokio !== 'object') {
        window.$pinokio = {}
      }
      if (typeof window.$pinokio.trigger !== 'function') {
        window.$pinokio.trigger = function(eventName, payload = {}, context = {}) {
          if (typeof eventName !== 'string' || !eventName.trim()) {
            return { ok: false, handled: false, reason: 'invalid_event_name' }
          }
          const nextContext = (context && typeof context === 'object') ? { ...context } : {}
          if (!nextContext.frameUrl) {
            nextContext.frameUrl = window.location.href
          }
          resolveTargetWindow().postMessage({
            e: 'pinokio:event',
            event: eventName.trim(),
            payload: (payload && typeof payload === 'object') ? payload : {},
            context: nextContext
          }, '*')
          return { ok: true, handled: true, event: eventName.trim() }
        }
      }
      window.$pinokio.inject = function(definition) {
        return window.__PINOKIO_INJECT_RUNTIME__.register(definition)
      }
      return window.$pinokio
    }

    const buildMountContext = (descriptor, sourceContext) => {
      const currentUrl = (window && window.location && window.location.href) ? window.location.href : ''
      const baseContext = (sourceContext && typeof sourceContext === 'object') ? { ...sourceContext } : {}
      if (!baseContext.frameUrl) {
        baseContext.frameUrl = currentUrl
      }
      if (!baseContext.currentUrl) {
        baseContext.currentUrl = currentUrl
      }
      if (!baseContext.rootFrameUrl) {
        baseContext.rootFrameUrl = currentUrl
      }
      return {
        ...baseContext,
        descriptor,
        trigger(eventName, payload = {}, context = {}) {
          const nextContext = (context && typeof context === 'object')
            ? { ...baseContext, ...context }
            : { ...baseContext }
          return window.$pinokio.trigger(eventName, payload, nextContext)
        }
      }
    }

    if (!window.__PINOKIO_INJECT_RUNTIME__) {
      const state = {
        current: null,
        cleanups: new Map()
      }
      window.__PINOKIO_INJECT_RUNTIME__ = {
        register(definition) {
          const current = state.current
          if (!current) {
            throw new Error('window.$pinokio.inject() must be called while an injector is loading.')
          }
          if (!definition || typeof definition !== 'object' || typeof definition.mount !== 'function') {
            throw new Error('Pinokio injectors must provide a mount(ctx) function.')
          }
          if (current.registered) {
            throw new Error('Injector registered more than once during a single mount.')
          }
          const cleanup = definition.mount(buildMountContext(current.descriptor, current.context))
          current.registered = true
          if (typeof cleanup === 'function') {
            state.cleanups.set(current.descriptor.runtimeId, cleanup)
          } else {
            state.cleanups.delete(current.descriptor.runtimeId)
          }
          return { ok: true, id: current.descriptor.runtimeId || '' }
        },
        run(descriptor, context, runSource) {
          ensureApi()
          state.current = {
            descriptor: descriptor || {},
            context: (context && typeof context === 'object') ? context : {},
            registered: false
          }
          try {
            if (typeof runSource === 'function') {
              runSource()
            }
            if (!state.current.registered) {
              throw new Error('Injector did not call window.$pinokio.inject(...).')
            }
          } finally {
            state.current = null
          }
        },
        unmountAll() {
          for (const cleanup of state.cleanups.values()) {
            if (typeof cleanup !== 'function') {
              continue
            }
            try {
              cleanup()
            } catch (error) {
              try {
                console.warn('[pinokio][inject] cleanup failed', error && error.message ? error.message : String(error))
              } catch (_) {
              }
            }
          }
          state.cleanups.clear()
        }
      }
    }

    ensureApi()
  }
  return `(${source.toString()})();`
}

const buildPinokioInjectUnmountScript = () => `(() => {
  const runtime = window.__PINOKIO_INJECT_RUNTIME__
  if (runtime && typeof runtime.unmountAll === 'function') {
    runtime.unmountAll()
  }
})();`

const buildPinokioInjectExecution = ({ descriptor, context, source }) => {
  const bootstrap = buildPinokioInjectRuntimeBootstrap()
  return `(() => {
${bootstrap}
window.__PINOKIO_INJECT_RUNTIME__.run(${serializeForJavaScript(descriptor)}, ${serializeForJavaScript(context || {})}, () => {
${source}
})
})();
//# sourceURL=${descriptor.src}`
}

const resetPinokioInjectorsInFrame = async (frame) => {
  if (!frame || (typeof frame.isDestroyed === 'function' && frame.isDestroyed())) {
    return
  }
  const code = buildPinokioInjectUnmountScript()
  const tasks = []
  if (typeof frame.executeJavaScript === 'function') {
    tasks.push(frame.executeJavaScript(code, false))
  }
  if (typeof frame.executeJavaScriptInIsolatedWorld === 'function') {
    tasks.push(frame.executeJavaScriptInIsolatedWorld(
      PINOKIO_INJECT_ISOLATED_WORLD_ID,
      [{ code }],
      false
    ))
  }
  await Promise.allSettled(tasks)
}

const executePinokioInjectDescriptor = async (frame, descriptor, context) => {
  if (!frame || (typeof frame.isDestroyed === 'function' && frame.isDestroyed())) {
    throw new Error('Target frame is not available.')
  }
  const sourceDescriptor = descriptor
  const sourceUrl = resolvePinokioInjectSourceUrl(descriptor.src)
  if (!sourceUrl) {
    throw new Error(`Invalid injector source URL: ${descriptor.src}`)
  }
  const response = await fetch(sourceUrl, { cache: 'no-store' })
  if (!response || !response.ok) {
    const status = response ? response.status : 'unknown'
    throw new Error(`Unable to load injector source: ${status}`)
  }
  const source = await response.text()
  const resolvedDescriptor = {
    ...sourceDescriptor,
    src: sourceUrl
  }
  const code = buildPinokioInjectExecution({ descriptor: resolvedDescriptor, context, source })
  if (descriptor.world === 'isolated') {
    if (typeof frame.executeJavaScriptInIsolatedWorld !== 'function') {
      throw new Error('Isolated-world frame injection is not supported by this Electron frame API.')
    }
    return frame.executeJavaScriptInIsolatedWorld(
      PINOKIO_INJECT_ISOLATED_WORLD_ID,
      [{ code, url: sourceUrl }],
      false
    )
  }
  return frame.executeJavaScript(code, false)
}

const installInjectorHandlers = () => {
  if (injectorHandlersInstalled) {
    return
  }
  injectorHandlersInstalled = true

  const updatePinokioInjectTargets = (ownerFrame, sender, payload = {}) => {
    if (!ownerFrame || (typeof ownerFrame.isDestroyed === 'function' && ownerFrame.isDestroyed())) {
      return { ok: false, reason: 'missing_frame', targets: [] }
    }
    const ownerKey = getFrameInjectorKey(ownerFrame)
    const webContentsKey = getPinokioInjectWebContentsKey(sender, ownerFrame)
    const targets = normalizePinokioInjectTargetRegistrations(payload && payload.targets)
    frameInjectTargetRegistry.set(ownerKey, {
      targets,
      pageUrl: payload && payload.pageUrl ? payload.pageUrl : '',
      webContentsKey,
      updatedAt: Date.now()
    })
    return { ok: true, targets }
  }

  ipcMain.on('pinokio:update-inject-targets', (event, payload = {}) => {
    updatePinokioInjectTargets(event.senderFrame, event.sender, payload)
  })

  ipcMain.on('pinokio:update-inject-targets-sync', (event, payload = {}) => {
    event.returnValue = updatePinokioInjectTargets(event.senderFrame, event.sender, payload)
  })

  ipcMain.handle('pinokio:resolve-injectors', async (event, payload = {}) => {
    const frame = event.senderFrame
    if (!frame || (typeof frame.isDestroyed === 'function' && frame.isDestroyed())) {
      return { ok: false, reason: 'missing_frame', inject: [], context: null }
    }
    const resolved = resolvePinokioInjectorsForFrame(frame, payload, event.sender)
    return {
      ok: true,
      inject: resolved.inject,
      context: resolved.context
    }
  })

  ipcMain.handle('pinokio:reset-injectors', async (event, payload = {}) => {
    const frame = event.senderFrame
    if (!frame || (typeof frame.isDestroyed === 'function' && frame.isDestroyed())) {
      return { ok: false, reason: 'missing_frame' }
    }
    const frameKey = getFrameInjectorKey(frame)
    const syncId = typeof payload.syncId === 'number' ? payload.syncId : 0
    frameInjectorSyncState.set(frameKey, syncId)
    await resetPinokioInjectorsInFrame(frame)
    return { ok: true, syncId }
  })

  ipcMain.handle('pinokio:mount-injectors', async (event, payload = {}) => {
    const frame = event.senderFrame
    if (!frame || (typeof frame.isDestroyed === 'function' && frame.isDestroyed())) {
      return { ok: false, reason: 'missing_frame', applied: [], failed: [] }
    }
    const frameKey = getFrameInjectorKey(frame)
    const syncId = typeof payload.syncId === 'number' ? payload.syncId : 0
    if (syncId && frameInjectorSyncState.get(frameKey) !== syncId) {
      return { ok: true, skipped: true, reason: 'stale_sync', applied: [], failed: [], syncId }
    }
    const baseContext = payload && payload.context && typeof payload.context === 'object'
      ? { ...payload.context }
      : {}
    const injectList = Array.isArray(payload.inject) ? payload.inject : []
    const applied = []
    const failed = []

    for (let index = 0; index < injectList.length; index += 1) {
      if (syncId && frameInjectorSyncState.get(frameKey) !== syncId) {
        return { ok: true, skipped: true, reason: 'stale_sync', applied, failed, syncId }
      }
      const normalizedDescriptor = normalizePinokioInjectDescriptor(injectList[index])
      if (!normalizedDescriptor) {
        continue
      }
      const descriptor = {
        ...normalizedDescriptor,
        runtimeId: `${frameKey}:${syncId}:${index}:${normalizedDescriptor.src}`
      }
      try {
        await executePinokioInjectDescriptor(frame, descriptor, baseContext)
        applied.push({
          src: descriptor.src,
          world: descriptor.world,
          runtimeId: descriptor.runtimeId
        })
      } catch (error) {
        const message = error && error.message ? error.message : String(error)
        failed.push({
          src: descriptor.src,
          world: descriptor.world,
          error: message
        })
        console.warn('[pinokio][main] injector mount failed', {
          src: descriptor.src,
          world: descriptor.world,
          error: message
        })
      }
    }

    return {
      ok: failed.length === 0,
      applied,
      failed,
      syncId
    }
  })
}

const normalizePermissionList = (value) => {
  if (!value) return []
  const list = Array.isArray(value) ? value : [value]
  return list.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)
}

const permissionLabels = {
  microphone: 'Microphone',
  camera: 'Camera',
  screen: 'Screen Recording',
  screen_capture: 'Screen Recording'
}

const logPermission = (...args) => {
  console.log('[PERMISSION]', ...args)
}

const permissionHints = {
  darwin: {
    microphone: 'System Settings → Privacy & Security → Microphone',
    camera: 'System Settings → Privacy & Security → Camera',
    screen: 'System Settings → Privacy & Security → Screen Recording',
    screen_capture: 'System Settings → Privacy & Security → Screen Recording'
  },
  win32: {
    microphone: 'Settings → Privacy & security → Microphone (allow desktop apps)',
    camera: 'Settings → Privacy & security → Camera (allow desktop apps)',
    screen: 'Settings → Privacy & security → Screen recording',
    screen_capture: 'Settings → Privacy & security → Screen recording'
  },
  linux: {
    microphone: 'Check your sound settings (PipeWire/PulseAudio) and app permissions.',
    camera: 'Check your video device permissions in system settings.',
    screen: 'Check your desktop portal or compositor screen capture permissions.',
    screen_capture: 'Check your desktop portal or compositor screen capture permissions.'
  }
}

const getMediaAccessStatusSafe = (mediaType) => {
  if (!systemPreferences || typeof systemPreferences.getMediaAccessStatus !== 'function') {
    return 'unsupported'
  }
  try {
    return systemPreferences.getMediaAccessStatus(mediaType)
  } catch (_) {
    return 'unknown'
  }
}

const requestMediaPermission = async (permission) => {
  const platform = process.platform
  if (permission === 'microphone' || permission === 'camera') {
    const preStatus = getMediaAccessStatusSafe(permission)
    const canAsk = platform === 'darwin' && systemPreferences && typeof systemPreferences.askForMediaAccess === 'function'
    logPermission('requestMediaPermission', permission, { platform, preStatus, canAsk })
    let granted = false
    if (platform === 'darwin' && systemPreferences && typeof systemPreferences.askForMediaAccess === 'function') {
      granted = await systemPreferences.askForMediaAccess(permission)
    }
    const status = getMediaAccessStatusSafe(permission)
    if (status === 'granted') {
      granted = true
    }
    logPermission('requestMediaPermission result', permission, { status, granted })
    return { status, granted }
  }
  if (permission === 'screen' || permission === 'screen_capture') {
    const status = getMediaAccessStatusSafe('screen')
    logPermission('requestMediaPermission screen', permission, { status })
    return { status, granted: status === 'granted' }
  }
  logPermission('requestMediaPermission unsupported', permission)
  return { status: 'unsupported', granted: false }
}

const buildPermissionMessage = (platform, denied) => {
  if (!denied.length) return ''
  const items = denied.map((permission) => permissionLabels[permission] || permission)
  const label = items.length === 1 ? items[0] : items.join(', ')
  const hints = permissionHints[platform] || permissionHints.linux
  const hint = denied.length === 1
    ? (hints[denied[0]] || '')
    : ''
  if (hint) {
    return `Pinokio needs ${label} access. Enable it in ${hint}.`
  }
  return `Pinokio needs ${label} access. Please enable it in your OS privacy settings.`
}

const installPermissionHandlers = () => {
  if (permissionHandlersInstalled) {
    return
  }
  permissionHandlersInstalled = true
  ipcMain.handle('pinokio:request-permissions', async (event, payload = {}) => {
    const permissions = normalizePermissionList(payload.permissions)
    if (permissions.length === 0) {
      return { ok: true, permissions: [], results: {}, denied: [] }
    }
    const results = {}
    const denied = []
    for (const permission of permissions) {
      const result = await requestMediaPermission(permission)
      results[permission] = result
      if (!result.granted) {
        denied.push(permission)
      }
    }
    return {
      ok: denied.length === 0,
      permissions,
      denied,
      results,
      platform: process.platform,
      message: denied.length ? buildPermissionMessage(process.platform, denied) : ''
    }
  })
}

const canRequestPermission = (permission) => {
  if (process.platform !== 'darwin') {
    return false
  }
  return permission === 'microphone' || permission === 'camera'
}

const promptForProjectPermissions = async (webContents, project, permissions) => {
  if (!permissions.length) {
    return
  }
  const promptKey = `${project}:${permissions.join(',')}`
  if (permissionPromptInFlight.has(promptKey) || permissionPrompted.has(promptKey)) {
    logPermission('prompt skipped (already prompted)', { project, permissions })
    return
  }
  logPermission('prompt start', { project, permissions })
  const pending = []
  const blocked = []
  const statusInfo = []
  for (const permission of permissions) {
    const statusTarget = (permission === 'screen' || permission === 'screen_capture') ? 'screen' : permission
    const status = getMediaAccessStatusSafe(statusTarget)
    if (status === 'granted') {
      statusInfo.push({ permission, status, action: 'skip' })
      continue
    }
    if (status === 'denied') {
      blocked.push(permission)
      statusInfo.push({ permission, status, action: 'blocked' })
    } else if (canRequestPermission(permission)) {
      pending.push(permission)
      statusInfo.push({ permission, status, action: 'pending' })
    } else {
      blocked.push(permission)
      statusInfo.push({ permission, status, action: 'blocked' })
    }
  }
  logPermission('prompt status', statusInfo)
  logPermission('prompt lists', { pending, blocked })
  if (pending.length === 0 && blocked.length === 0) {
    return
  }
  permissionPromptInFlight.add(promptKey)
  try {
    const owner = webContents && !webContents.isDestroyed()
      ? BrowserWindow.fromWebContents(webContents)
      : null
    const denied = blocked.slice()
    if (pending.length > 0) {
      const label = pending.map((permission) => permissionLabels[permission] || permission).join(', ')
      const { response } = await dialog.showMessageBox(owner, {
        type: 'info',
        buttons: ['Allow', 'Not now'],
        defaultId: 0,
        cancelId: 1,
        title: 'Permission required',
        message: `Allow ${label} access?`,
        detail: `This app requests ${label} access. Click "Allow" to show the OS permission prompt.`,
        noLink: true
      })
      logPermission('prompt response', { project, permissions: pending, response })
      if (response === 0) {
        for (const permission of pending) {
          const result = await requestMediaPermission(permission)
          if (!result.granted) {
            denied.push(permission)
          }
        }
      }
    }
    if (denied.length > 0) {
      logPermission('prompt denied', { project, denied })
      const message = buildPermissionMessage(process.platform, denied)
      if (message) {
        await dialog.showMessageBox(owner, {
          type: 'warning',
          buttons: ['OK'],
          defaultId: 0,
          message,
          noLink: true
        })
      }
    }
  } finally {
    permissionPromptInFlight.delete(promptKey)
    permissionPrompted.add(promptKey)
  }
}

// Screenshot capture function for inspect mode
const captureScreenshotRegion = async (bounds) => {
  try {
    const { nativeImage } = require('electron')
    
    // Get all displays to find the correct one
    const displays = screen.getAllDisplays()
    const primaryDisplay = screen.getPrimaryDisplay()
    
    // Get desktop capturer sources with full resolution
    const sources = await desktopCapturer.getSources({ 
      types: ['screen'],
      thumbnailSize: {
        width: primaryDisplay.bounds.width * primaryDisplay.scaleFactor,
        height: primaryDisplay.bounds.height * primaryDisplay.scaleFactor
      }
    })
    
    if (sources.length === 0) {
      throw new Error('No screen sources available')
    }
    
    // Find the screen source that matches our primary display
    let screenSource = sources[0] // fallback to first source
    
    // Try to find the exact screen source by name or use the first one
    for (const source of sources) {
      if (source.name.includes('Entire Screen') || source.name.includes('Screen 1')) {
        screenSource = source
        break
      }
    }
    
    // Get the full resolution screenshot from thumbnail
    const thumbnailImage = screenSource.thumbnail
    const fullScreenshotBuffer = thumbnailImage.toPNG()
    const fullScreenshot = nativeImage.createFromBuffer(fullScreenshotBuffer)
    
    // Calculate the actual pixel bounds accounting for device pixel ratio
    const scaleFactor = primaryDisplay.scaleFactor
    const actualBounds = {
      x: Math.max(0, Math.round(bounds.x * scaleFactor)),
      y: Math.max(0, Math.round(bounds.y * scaleFactor)),
      width: Math.min(
        Math.round(bounds.width * scaleFactor),
        fullScreenshot.getSize().width - Math.round(bounds.x * scaleFactor)
      ),
      height: Math.min(
        Math.round(bounds.height * scaleFactor),
        fullScreenshot.getSize().height - Math.round(bounds.y * scaleFactor)
      )
    }
    
    // Ensure minimum size
    actualBounds.width = Math.max(1, actualBounds.width)
    actualBounds.height = Math.max(1, actualBounds.height)
    
    // Crop the screenshot to the element bounds
    const croppedImage = fullScreenshot.crop(actualBounds)
    
    // Convert to PNG buffer and then to data URL
    const croppedBuffer = croppedImage.toPNG()
    const dataUrl = 'data:image/png;base64,' + croppedBuffer.toString('base64')
    
    console.log(`Screenshot captured: ${actualBounds.width}x${actualBounds.height} at (${actualBounds.x},${actualBounds.y})`)
    
    return dataUrl
  } catch (error) {
    console.warn('Screenshot capture failed:', error)
    throw error
  }
}


//function enable_cors(win) {
//  win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
//    details.requestHeaders['Origin'] = null;
//    details.headers['Origin'] = null;
//    callback({ requestHeaders: details.requestHeaders })
//  });
////  win.webContents.session.webRequest.onBeforeSendHeaders(
////    (details, callback) => {
////      const { requestHeaders } = details;
////      UpsertKeyValue(requestHeaders, 'Access-Control-Allow-Origin', ['*']);
////      callback({ requestHeaders });
////    },
////  );
////
////  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
////    const { responseHeaders } = details;
////    UpsertKeyValue(responseHeaders, 'Access-Control-Allow-Origin', ['*']);
////    UpsertKeyValue(responseHeaders, 'Access-Control-Allow-Headers', ['*']);
////    callback({
////      responseHeaders,
////    });
////  });
//}


const pushContextMenuSeparator = (template) => {
  if (!template.length) {
    return
  }
  if (template[template.length - 1].type === 'separator') {
    return
  }
  template.push({ type: 'separator' })
}
const buildBrowserContextMenuTemplate = (webContents, params = {}) => {
  const template = []
  const linkURL = typeof params.linkURL === 'string' ? params.linkURL : ''
  const srcURL = typeof params.srcURL === 'string' ? params.srcURL : ''
  const selectionText = typeof params.selectionText === 'string' ? params.selectionText : ''
  const hasSelection = selectionText.trim().length > 0
  const editFlags = params.editFlags || {}
  const isEditable = Boolean(params.isEditable)
  const hasMediaSource = typeof params.mediaType === 'string' && params.mediaType !== 'none' && srcURL
  const canSuggestSpelling = Array.isArray(params.dictionarySuggestions) && params.dictionarySuggestions.length > 0
  const hasMisspelledWord = typeof params.misspelledWord === 'string' && params.misspelledWord.length > 0
  const owner = webContents && !webContents.isDestroyed() ? webContents.getOwnerBrowserWindow() : null
  const baseUrl = typeof params.frameURL === 'string' && params.frameURL
    ? params.frameURL
    : (typeof params.pageURL === 'string' ? params.pageURL : '')
  const canGoBack = Boolean(webContents && webContents.canGoBack && webContents.canGoBack())
  const canGoForward = Boolean(webContents && webContents.canGoForward && webContents.canGoForward())

  if (linkURL) {
    template.push({
      label: 'Open Link in New Window',
      click: () => {
        try {
          if (typeof loadNewWindow === 'function' && PORT) {
            if (openHttpsInBrowser({ url: linkURL, openerWebContents: webContents, baseUrl })) {
              return
            }
            if (openTargetWindow({ url: linkURL, openerWebContents: webContents, baseUrl })) {
              return
            }
          }
        } catch (error) {
        }
        shell.openExternal(linkURL).catch(() => {})
      }
    })
    template.push({
      label: 'Open Link in Browser',
      click: () => {
        shell.openExternal(linkURL).catch(() => {})
      }
    })
    template.push({
      label: 'Copy Link Address',
      click: () => clipboard.writeText(linkURL)
    })
    pushContextMenuSeparator(template)
  }

  if (hasMediaSource) {
    template.push({
      label: 'Open Media in Browser',
      click: () => {
        shell.openExternal(srcURL).catch(() => {})
      }
    })
    template.push({
      label: 'Copy Media Address',
      click: () => clipboard.writeText(srcURL)
    })
    pushContextMenuSeparator(template)
  }

  if (!isEditable) {
    template.push({
      label: 'Back',
      enabled: canGoBack,
      click: () => {
        if (webContents && !webContents.isDestroyed() && webContents.canGoBack()) {
          webContents.goBack()
        }
      }
    })
    template.push({
      label: 'Forward',
      enabled: canGoForward,
      click: () => {
        if (webContents && !webContents.isDestroyed() && webContents.canGoForward()) {
          webContents.goForward()
        }
      }
    })
    template.push({
      label: 'Reload',
      click: () => {
        if (webContents && !webContents.isDestroyed()) {
          webContents.reload()
        }
      }
    })
    pushContextMenuSeparator(template)
  }

  if (isEditable) {
    if (canSuggestSpelling && hasMisspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        template.push({
          label: suggestion,
          click: () => {
            if (webContents && !webContents.isDestroyed()) {
              webContents.replaceMisspelling(suggestion)
            }
          }
        })
      }
      template.push({
        label: 'Add to Dictionary',
        click: () => {
          try {
            if (webContents && !webContents.isDestroyed() && webContents.session && typeof webContents.session.addWordToSpellCheckerDictionary === 'function') {
              webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
            }
          } catch (error) {
          }
        }
      })
      pushContextMenuSeparator(template)
    }
    template.push({ role: 'undo', enabled: editFlags.canUndo !== false })
    template.push({ role: 'redo', enabled: editFlags.canRedo !== false })
    pushContextMenuSeparator(template)
    template.push({ role: 'cut', enabled: editFlags.canCut !== false })
    template.push({ role: 'copy', enabled: editFlags.canCopy !== false })
    template.push({ role: 'paste', enabled: editFlags.canPaste !== false })
    template.push({ role: 'delete', enabled: editFlags.canDelete !== false })
    pushContextMenuSeparator(template)
    template.push({ role: 'selectAll' })
  } else {
    if (hasSelection) {
      template.push({ role: 'copy' })
    }
    template.push({ role: 'selectAll' })
  }

  pushContextMenuSeparator(template)
  template.push({
    label: 'Inspect Element',
    click: () => {
      if (!webContents || webContents.isDestroyed()) {
        return
      }
      if (!webContents.isDevToolsOpened()) {
        webContents.openDevTools({ mode: 'detach' })
      }
      const x = typeof params.x === 'number' ? params.x : null
      const y = typeof params.y === 'number' ? params.y : null
      if (x !== null && y !== null) {
        webContents.inspectElement(x, y)
      }
    }
  })

  if (template.length && template[template.length - 1].type === 'separator') {
    template.pop()
  }

  if (owner && owner.isDestroyed()) {
    return []
  }
  return template
}
const handleWindowsZoomInAlias = (event, input, webContents) => {
  if (process.platform !== 'win32' || !input || input.type !== 'keyDown') {
    return false
  }
  if (!input.control || input.alt || input.meta) {
    return false
  }
  if (input.key !== '=' && input.key !== '+') {
    return false
  }
  if (!webContents || webContents.isDestroyed()) {
    return false
  }
  // Match the generated character so the alias works across keyboard layouts.
  event.preventDefault()
  webContents.setZoomLevel(webContents.getZoomLevel() + 1)
  return true
}
const handleWindowsZoomOutAlias = (event, input, webContents) => {
  if (process.platform !== 'win32' || !input || input.type !== 'keyDown') {
    return false
  }
  if (!input.control || input.alt || input.meta) {
    return false
  }
  if (input.key !== '-' && input.key !== '_') {
    return false
  }
  if (!webContents || webContents.isDestroyed()) {
    return false
  }
  // Match the generated character so the alias works across keyboard layouts.
  event.preventDefault()
  webContents.setZoomLevel(webContents.getZoomLevel() - 1)
  return true
}
const attach = (event, webContents) => {
  let wc = webContents

  webContents.on('before-input-event', (event, input) => {
    if (handleWindowsZoomInAlias(event, input, webContents)) {
      return
    }
    handleWindowsZoomOutAlias(event, input, webContents)
  })

  if (ENABLE_BROWSER_CONSOLE_LOG && !attachedConsoleListeners.has(webContents)) {
    attachedConsoleListeners.add(webContents)
    webContents.on('console-message', (event, level, message, line, sourceId) => {
      if (!root_url) {
        return
      }
      const state = browserConsoleState.get(webContents)
      let pageUrl = state && state.url ? state.url : ''
      if (!pageUrl) {
        try {
          pageUrl = webContents.getURL()
        } catch (err) {
          pageUrl = ''
        }
      }
      if (!pageUrl || !pageUrl.startsWith(root_url)) {
        return
      }
      const targetFile = ensureBrowserLogFile()
      if (!targetFile) {
        return
      }
      const logUrl = resolveConsoleSourceUrl(sourceId, pageUrl)
      if (!logUrl || !shouldLogUrl(logUrl)) {
        return
      }
      const timestamp = new Date().toISOString()
      const levelLabel = consoleLevelLabels[level] || 'log'
      let location = ''
      if (sourceId) {
        location = ` (${sourceId}${line ? `:${line}` : ''})`
      } else if (line) {
        location = ` (:${line})`
      }
      const entry = `[${timestamp}]\t${logUrl}\t[${levelLabel}] ${message}${location}\n`
      browserLogBuffer.push(entry)
      if (browserLogBuffer.length > 100) {
        browserLogBuffer.shift()
      }
      browserLogWritePromise = browserLogWritePromise.then(() => fs.promises.writeFile(targetFile, browserLogBuffer.join(''))).catch((err) => {
        console.error('[BROWSER LOG] Failed to persist console output', err)
      })
    })
    webContents.once('destroyed', () => {
      clearBrowserConsoleState(webContents)
    })
  }
  // Enable screen capture permissions for all webContents
  webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true)
    //console.log(`[PERMISSION DEBUG] Permission requested: "${permission}" from webContents`)
    //if (permission === 'media' || permission === 'display-capture' || permission === 'desktopCapture') {
    //  console.log(`[PERMISSION DEBUG] Granting permission: "${permission}"`)
    //  callback(true)
    //} else {
    //  console.log(`[PERMISSION DEBUG] Denying permission: "${permission}"`)
    //  callback(false)
    //}
  })

  webContents.session.setPermissionCheckHandler((webContents, permission) => {
    return true
    //console.log(`[PERMISSION DEBUG] Permission check for: "${permission}"`)
    //return permission === 'media' || permission === 'display-capture' || permission === 'desktopCapture'
  })

  webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    console.log('[DISPLAY MEDIA DEBUG] Display media request received')
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      console.log('[DISPLAY MEDIA DEBUG] Available sources:', sources.length)
      if (sources.length > 0) {
        callback({ video: sources[0], audio: 'loopback' })
      } else {
        callback({})
      }
    }).catch(err => {
      console.error('[DISPLAY MEDIA DEBUG] Error getting sources:', err)
      callback({})
    })
  })

  webContents.on('will-prevent-unload', (event) => {
    event.preventDefault()
  })
  webContents.once('did-finish-load', () => {
    webContents.opened = true
  })

  webContents.on('will-navigate', (event, url) => {
    if (!webContents.opened) {
      // The first time this view is being used, set the "opened" to true, and don't do anything
      // The next time the view navigates, "the "opened" is already true, so trigger the URL open logic
      //  - if the new URL has the same host as the app's url, open in app
      //  - if it's a remote host, open in external browser
      webContents.opened = true
    } else {
//      console.log("will-navigate", { event, url })
      const owner = webContents.getOwnerBrowserWindow()
      if (openNonPinokioHttpsInBrowser({ event, owner, url, openerWebContents: webContents })) {
        return
      }
      const target = safeParseUrl(url, root_url || undefined)
      if (target && !isPinokioWindowUrl(target.href, root_url) && target.protocol !== 'http:' && target.protocol !== 'https:') {
        event.preventDefault()
        shell.openExternal(target.href)
      }
    }
  })
  webContents.on('will-frame-navigate', (event) => {
    const owner = webContents.getOwnerBrowserWindow()
    const frame = event && event.frame
    const frameUrl = readFrameFieldSafely(frame, 'url') || (() => {
      try {
        return webContents.getURL()
      } catch (_) {
        return ''
      }
    })()
    openNonPinokioHttpsInBrowser({
      event,
      owner,
      url: event && event.url,
      frame,
      openerWebContents: webContents,
      baseUrl: frameUrl
    })
  })
//  webContents.session.defaultSession.loadExtension('path/to/unpacked/extension').then(({ id }) => {
//  })


  const filter = { urls: ['*://*/*'], types: ['main_frame', 'sub_frame'] };
  webContents.session.webRequest.onHeadersReceived(filter, (details, callback) => {
//    console.log("details", details)
//    console.log("responseHeaders", JSON.stringify(details.responseHeaders, null, 2))



    // 1. Remove X-Frame-Options
    if (details.responseHeaders["X-Frame-Options"]) {
      delete details.responseHeaders["X-Frame-Options"] 
    } else if (details.responseHeaders["x-frame-options"]) {
      delete details.responseHeaders["x-frame-options"] 
    }

    // 2. Remove Content-Security-Policy "frame-ancestors" attribute
    let csp
    let csp_type;
    if (details.responseHeaders["Content-Security-Policy"]) {
      csp = details.responseHeaders["Content-Security-Policy"]
      csp_type = 0
    } else if (details.responseHeaders['content-security-policy']) {
      csp = details.responseHeaders["content-security-policy"]
      csp_type = 1
    }

    if (details.responseHeaders["cross-origin-opener-policy-report-only"]) {
      delete details.responseHeaders["cross-origin-opener-policy-report-only"]
    } else if (details.responseHeaders["Cross-Origin-Opener-Policy-Report-Only"]) {
      delete details.responseHeaders["Cross-Origin-Opener-Policy-Report-Only"]
    }


    if (csp) {
//      console.log("CSP", csp)
      // find /frame-ancestors ;$/
      let new_csp = csp.map((c) => {
        return c.replaceAll(/frame-ancestors[^;]+;?/gi, "")
      })

//      console.log("new_csp = ", new_csp)

      const r = {
        responseHeaders: details.responseHeaders
      }
      if (csp_type === 0) {
        r.responseHeaders["Content-Security-Policy"] = new_csp
      } else if (csp_type === 1) {
        r.responseHeaders["content-security-policy"] = new_csp
      }
//      console.log("R", JSON.stringify(r, null, 2))

      callback(r)
    } else {
//      console.log("RH", details.responseHeaders)
      callback({
        responseHeaders: details.responseHeaders
      })
    }
  })



  webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {

    const userAgentHeader = Object.keys(details.requestHeaders || {}).find((key) => key.toLowerCase() === 'user-agent')
    let ua = userAgentHeader ? details.requestHeaders[userAgentHeader] : null
//    console.log("User Agent Before", ua)
    const preservePinokioUserAgent = isPinokiodServerRequestUrl(details.url, root_url || undefined)
    if (ua) {
      ua = sanitizeUserAgentForRequests(ua, {
        preservePinokio: preservePinokioUserAgent
      })
//      console.log("User Agent After", ua)
      details.requestHeaders[userAgentHeader] = ua;
    }


//    console.log("REQ", details)
//    console.log("HEADER BEFORE", details.requestHeaders)
//    // Remove all sec-fetch-* headers
//    for(let key in details.requestHeaders) {
//      if (key.toLowerCase().startsWith("sec-")) {
//        delete details.requestHeaders[key]
//      }
//    }
//    console.log("HEADER AFTER", details.requestHeaders)
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });


//  webContents.session.webRequest.onBeforeSendHeaders(
//    (details, callback) => {
//      const { requestHeaders } = details;
//      UpsertKeyValue(requestHeaders, 'Access-Control-Allow-Origin', ['*']);
//      callback({ requestHeaders });
//    },
//  );
//
//  webContents.session.webRequest.onHeadersReceived((details, callback) => {
//    const { responseHeaders } = details;
//    UpsertKeyValue(responseHeaders, 'Access-Control-Allow-Origin', ['*']);
//    UpsertKeyValue(responseHeaders, 'Access-Control-Allow-Headers', ['*']);
//    callback({
//      responseHeaders,
//    });
//  });

//  webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
//    //console.log("Before", { details })
//    if (details.requestHeaders) details.requestHeaders['Origin'] = null;
//    if (details.requestHeaders) details.requestHeaders['Referer'] = null;
//    if (details.requestHeaders) details.requestHeaders['referer'] = null;
//    if (details.headers) details.headers['Origin'] = null;
//    if (details.headers) details.headers['Referer'] = null;
//    if (details.headers) details.headers['referer'] = null;
//
//    if (details.referrer) details.referrer = null
//    //console.log("After", { details })
//    callback({ requestHeaders: details.requestHeaders })
//  });

//  webContents.on("did-create-window", (parentWindow, details) => {
//    const view = new BrowserView();
//    parentWindow.setBrowserView(view);
//    view.setBounds({ x: 0, y: 30, width: parentWindow.getContentBounds().width, height: parentWindow.getContentBounds().height - 30 });
//    view.setAutoResize({ width: true, height: true });
//    view.webContents.loadURL(details.url);
//  })
  webContents.on('did-navigate', (event, url) => {
    let win = webContents.getOwnerBrowserWindow()
    if (win && typeof win.setTitleBarOverlay === "function") {
      const overlay = titleBarOverlay(colors)
      setWindowTitleBarOverlay(win, overlay)
    }
    launched = true

    updateBrowserConsoleTarget(webContents, url)

  })
  webContents.on('did-navigate-in-page', (event, url) => {
    updateBrowserConsoleTarget(webContents, url)
  })
  webContents.on('context-menu', (event, params) => {
    const template = buildBrowserContextMenuTemplate(webContents, params)
    if (!template.length) {
      return
    }
    const menu = Menu.buildFromTemplate(template)
    const win = webContents.getOwnerBrowserWindow()
    if (win && !win.isDestroyed()) {
      menu.popup({ window: win })
      return
    }
    menu.popup()
  })
  webContents.setWindowOpenHandler((config) => {
    const url = config.url
    const features = config.features || ""
    let referrerUrl = config.referrer && typeof config.referrer.url === 'string' ? config.referrer.url : ''
    if (features.startsWith("file")) {
      let u = features.replace("file://", "")
      shell.showItemInFolder(u)
      return { action: 'deny' };
    }

    const targetUrl = resolveTargetUrl({
      url,
      openerWebContents: wc,
      baseUrl: referrerUrl || (root_url || undefined)
    })
    if (!targetUrl) {
      return { action: 'deny' };
    }
    if (features === "browser") {
      shell.openExternal(targetUrl).catch(() => {})
      return { action: 'deny' };
    }
    if (isPinokioCommunityHandoffUrl(targetUrl, referrerUrl || (root_url || undefined))) {
      const owner = webContents && !webContents.isDestroyed() ? webContents.getOwnerBrowserWindow() : null
      const communityWindowBounds = getCommunityHandoffWindowBounds(owner)
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          ...communityWindowBounds,
          autoHideMenuBar: true,
          title: 'Pinokio Community',
          webPreferences: {
            session: session.defaultSession,
            webSecurity: true,
            spellcheck: false,
            nativeWindowOpen: true,
            contextIsolation: true,
            nodeIntegration: false,
            nodeIntegrationInSubFrames: false,
            enableRemoteModule: false,
            sandbox: true
          }
        }
      }
    }
    if (isLocalPinokioAppUrl(targetUrl, referrerUrl || (root_url || undefined))) {
      if (PORT) {
        loadNewWindow(targetUrl, PORT)
      }
      return { action: 'deny' };
    }
    shell.openExternal(targetUrl).catch(() => {})
    return { action: 'deny' };
  });
}
const getWinState = (url, options) => {
  let filename
  try {
    let pathname = new URL(url).pathname.slice(1)
    filename = pathname.slice("/").join("-")
  } catch {
    filename = "index.json"
  }
  let state = windowStateKeeper({
    file: filename,
    ...options
  });
  return state
}
const createWindow = (port) => {


  let mainWindowState = windowStateKeeper({
//    file: "index.json",
    defaultWidth: 1000,
    defaultHeight: 800
  });

  mainWindow = new BrowserWindow({
    titleBarStyle : "hidden",
    titleBarOverlay : titleBarOverlay(colors),
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 190,
    webPreferences: {
      session: session.defaultSession,
      webSecurity: false,
      spellcheck: false,
      nativeWindowOpen: true,
      contextIsolation: false,
      nodeIntegrationInSubFrames: true,
      enableRemoteModule: false,
      experimentalFeatures: true,
      preload: path.join(__dirname, 'preload.js')
    },
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Debug media device availability
  mainWindow.webContents.once('did-finish-load', () => {
    console.log('[MEDIA DEBUG] Main window loaded, checking media devices availability...')
    mainWindow.webContents.executeJavaScript(`
      console.log('[MEDIA DEBUG] navigator.mediaDevices available:', !!navigator.mediaDevices);
      console.log('[MEDIA DEBUG] getDisplayMedia available:', !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia));
      console.log('[MEDIA DEBUG] getUserMedia available:', !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia));
      if (navigator.mediaDevices && navigator.mediaDevices.getSupportedConstraints) {
        console.log('[MEDIA DEBUG] Supported constraints:', navigator.mediaDevices.getSupportedConstraints());
      }
    `).catch(err => console.error('[MEDIA DEBUG] Error checking media devices:', err))
    if (updateBannerPayload && !(updateBannerPayload.state === 'available' && updateBannerDismissed)) {
      mainWindow.webContents.send('pinokio:update-banner', updateBannerPayload)
    }
  })

  // Enable screen capture permissions
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true)
    //console.log(`[PERMISSION DEBUG] MainWindow permission requested: "${permission}"`)
    //if (permission === 'media' || permission === 'display-capture' || permission === 'desktopCapture') {
    //  console.log(`[PERMISSION DEBUG] MainWindow granting permission: "${permission}"`)
    //  callback(true)
    //} else {
    //  console.log(`[PERMISSION DEBUG] MainWindow denying permission: "${permission}"`)
    //  callback(false)
    //}
  })
//  enable_cors(mainWindow)
  if("" + port === "80") {
    root_url = `http://localhost`
  } else {
    root_url = `http://localhost:${port}`
  }
  mainWindow.loadURL(root_url)
//  mainWindow.maximize();
  mainWindowState.manage(mainWindow);

}
const loadNewWindow = (url, port) => {


  let winState = windowStateKeeper({
//    file: "index.json",
    defaultWidth: 1000,
    defaultHeight: 800
  });

  let win = new BrowserWindow({
    titleBarStyle : "hidden",
    titleBarOverlay : titleBarOverlay(colors),
    x: winState.x,
    y: winState.y,
    width: winState.width,
    height: winState.height,
    minWidth: 190,
    webPreferences: {
      session: session.defaultSession,
      webSecurity: false,
      spellcheck: false,
      nativeWindowOpen: true,
      contextIsolation: false,
      nodeIntegrationInSubFrames: true,
      enableRemoteModule: false,
      experimentalFeatures: true,
      preload: path.join(__dirname, 'preload.js')
    },
  })
  installForceDestroyOnClose(win)

  // Enable screen capture permissions
  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true)
    //console.log(`[PERMISSION DEBUG] New window permission requested: "${permission}"`)
    //if (permission === 'media' || permission === 'display-capture' || permission === 'desktopCapture') {
    //  console.log(`[PERMISSION DEBUG] New window granting permission: "${permission}"`)
    //  callback(true)
    //} else {
    //  console.log(`[PERMISSION DEBUG] New window denying permission: "${permission}"`)
    //  callback(false)
    //}
  })

//  enable_cors(win)
  win.focus()
  win.loadURL(url)
  winState.manage(win)

}
const openTargetWindow = ({ url, openerWebContents, baseUrl } = {}) => {
  const targetUrl = resolveTargetUrl({ url, openerWebContents, baseUrl })
  if (!targetUrl) {
    return null
  }
  if (isLocalPinokioAppUrl(targetUrl, baseUrl || (root_url || undefined))) {
    if (!PORT) {
      return null
    }
    loadNewWindow(targetUrl, PORT)
    return 'window'
  }
  shell.openExternal(targetUrl).catch(() => {})
  return 'browser'
}


if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('pinokio', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('pinokio')
}

const gotTheLock = app.requestSingleInstanceLock()


if (!gotTheLock) {
  app.quit()
} else {
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    
      // Prevent having error
      event.preventDefault()
      // and continue
      callback(true)

  })

  app.on('second-instance', (event, argv) => {

    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow(PORT)
    } else {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    const url = [...argv].reverse().find(arg => typeof arg === 'string' && arg.startsWith('pinokio:'))
    if (!url) {
      return
    }
    //let u = new URL(url).search
    let u = url.replace(/pinokio:[\/]+/, "")
    loadNewWindow(`${root_url}/pinokio/${u}`, PORT)
//    if (BrowserWindow.getAllWindows().length === 0 || !mainWindow) createWindow(PORT)
//    mainWindow.focus()
//    mainWindow.loadURL(`${root_url}/pinokio/${u}`)
  })

  // Create mainWindow, load the rest of the app, etc...
  // Enable desktop capture for getDisplayMedia support (must be before app ready)
  app.commandLine.appendSwitch('disable-features', 'LazyImageLoading')
  app.commandLine.appendSwitch('enable-experimental-web-platform-features');
  app.commandLine.appendSwitch('enable-features', 'GetDisplayMediaSet,GetDisplayMediaSetAutoSelectAllScreens');
  
  app.whenReady().then(async () => {
    console.log('App is ready, about to install inspector handlers...')
    configurePinokioUserAgent({ app, session: session.defaultSession })

    installInspectorHandlers()
    installInjectorHandlers()
    installPermissionHandlers()

    ipcMain.on('pinokio:update-banner-action', (_event, payload = {}) => {
      const action = payload && payload.action
      if (!action) {
        return
      }
      if (updateTestMode) {
        if (action === 'update') {
          startUpdateBannerTestDownload()
          return
        }
        if (action === 'restart') {
          simulateUpdateBannerRestart()
          return
        }
        if (action === 'dismiss') {
          updateBannerDismissed = true
          hideUpdateBanner()
          return
        }
        if (action === 'release-notes') {
          const target = payload && payload.releaseUrl ? payload.releaseUrl : UPDATE_RELEASES_URL
          shell.openExternal(target)
          return
        }
      }
      if (action === 'update') {
        if (updateDownloadInFlight) {
          return
        }
        updateDownloadInFlight = true
        updateBannerDismissed = false
        showUpdateBanner(buildUpdateBannerPayload('downloading', updateInfo, { progressPercent: 0 }))
        updater.downloadUpdate().catch((err) => {
          updateDownloadInFlight = false
          const message = err && err.message ? err.message : 'Update failed'
          showUpdateBanner(buildUpdateBannerPayload('error', updateInfo, { errorMessage: message }))
        })
        return
      }
      if (action === 'restart') {
        updater.quitAndInstall()
        return
      }
      if (action === 'dismiss') {
        updateBannerDismissed = true
        hideUpdateBanner()
        return
      }
      if (action === 'release-notes') {
        const target = payload && payload.releaseUrl ? payload.releaseUrl : UPDATE_RELEASES_URL
        shell.openExternal(target)
      }
    })

    // PROMPT
    let promptResponse
    ipcMain.on('prompt', function(eventRet, arg) {
      promptResponse = null
      const point = screen.getCursorScreenPoint()
      const display = screen.getDisplayNearestPoint(point)
      const bounds = display.bounds

//      const bounds = focused.getBounds()
      let promptWindow = new BrowserWindow({
        x: bounds.x + bounds.width/2 - 200,
        y: bounds.y + bounds.height/2 - 60,
        width: 400,
        height: 120,
        //width: 1000,
        //height: 500,
        show: false,
        resizable: false,
//        movable: false,
//        alwaysOnTop: true,
        frame: false,
        webPreferences: {
          session: session.defaultSession,
          webSecurity: false,
          spellcheck: false,
          nativeWindowOpen: true,
          contextIsolation: false,
          nodeIntegrationInSubFrames: true,
          preload: path.join(__dirname, 'preload.js')
        },
      })
      arg.val = arg.val || ''
      const promptHtml = `<html><body><form><label for="val">${arg.title}</label>
<input id="val" value="${arg.val}" autofocus />
<button id='ok'>OK</button>
<button id='cancel'>Cancel</button></form>
<style>body {font-family: sans-serif;} form {padding: 5px; } button {float:right; margin-left: 10px;} label { display: block; margin-bottom: 5px; width: 100%; } input {margin-bottom: 10px; padding: 5px; width: 100%; display:block;}</style>
<script>
document.querySelector("#cancel").addEventListener("click", (e) => {
  debugger
  e.preventDefault()
  e.stopPropagation()
  window.close()
})
document.querySelector("form").addEventListener("submit", (e) => {
  e.preventDefault()
  e.stopPropagation()
  debugger
  window.electronAPI.send('prompt-response', document.querySelector("#val").value)
  window.close()
})
</script></body></html>`

//      promptWindow.loadFile("prompt.html")
      promptWindow.loadURL('data:text/html,' + encodeURIComponent(promptHtml))
      promptWindow.show()
      promptWindow.on('closed', function() {
        console.log({ promptResponse })
        debugger
        eventRet.returnValue = promptResponse
        promptWindow = null
      })

    })
    ipcMain.on('prompt-response', function(event, arg) {
      if (arg === ''){ arg = null }
      console.log("prompt-response", { arg})
      promptResponse = arg
    })


    updateSplashWindow({
      state: 'loading',
      message: 'Starting Pinokio…',
      icon: getSplashIcon()
    })
    try {
      await restoreSessionCookies()
      await clearSessionCaches()
      try {
        const portInUse = await pinokiod.running(pinokiod.port)
        if (portInUse) {
          showStartupError({
            message: 'Pinokio is already running',
            detail: `Pinokio detected another instance listening on port ${pinokiod.port}. Please close the other instance before launching a new one.`
          })
          return
        }
      } catch (checkError) {
        console.warn('Failed to verify pinokio port availability', checkError)
      }
      await pinokiod.start({
        onquit: () => {
          app.quit()
        },
        onrestart: () => {
          persistSessionCookies().finally(() => {
            app.relaunch()
            app.exit()
          })
        },
        onrefresh: (payload) => {
          try {
            updateThemeColors(payload || { theme: pinokiod.theme, colors: pinokiod.colors })
          } catch (err) {
            console.error('Failed to sync title bar theme', err)
          }
        },
        browser: {
          clearCache: async () => {
            console.log('clear cache from all sessions')
            
            // Clear default session
            await session.defaultSession.clearStorageData()
            
            // Clear all custom sessions from active windows
            const windows = BrowserWindow.getAllWindows()
            for (const window of windows) {
              if (window.webContents && window.webContents.session) {
                await window.webContents.session.clearStorageData()
              }
            }

            await clearPersistedSessionCookies()

            console.log("cleared all sessions")
          },
          open: async (payload = {}) => {
            const url = typeof payload.url === 'string' ? payload.url.trim() : ''
            if (!url) {
              return { ok: false, error: 'missing-url', surface_used: 'browser' }
            }
            const surface = String(payload.surface || '').trim().toLowerCase()
            if (surface !== 'browser') {
              const surfaceUsed = openTargetWindow({ url })
              if (surfaceUsed) {
                return {
                  ok: true,
                  surface_used: surfaceUsed
                }
              }
            }
            await Promise.resolve(shell.openExternal(url))
            return {
              ok: true,
              surface_used: 'browser'
            }
          },
          requestPermissions: async (payload = {}) => {
            try {
              const project = typeof payload.name === 'string' ? payload.name.trim() : ''
              const permissions = normalizePermissionList(payload.permissions)
              logPermission('callback received', { project, permissions })
              if (!project || permissions.length === 0) {
                logPermission('callback skipped (missing project or permissions)', { project, permissions })
                return { ok: true, skipped: true }
              }
              const owner = BrowserWindow.getFocusedWindow() || mainWindow || BrowserWindow.getAllWindows()[0] || null
              const webContents = owner && owner.webContents ? owner.webContents : null
              if (!webContents || webContents.isDestroyed()) {
                logPermission('callback failed (no webContents)', { project, permissions })
                return { ok: false, error: 'no-webcontents' }
              }
              await promptForProjectPermissions(webContents, project, permissions)
              return { ok: true }
            } catch (err) {
              console.error('[PERMISSION] Failed to prompt via callback', err)
              return { ok: false, error: err && err.message ? err.message : String(err) }
            }
          }
        }
      })
    } catch (error) {
      console.error('Failed to start pinokiod', error)
      showStartupError({ error })
      return
    }
    closeSplashWindow()
    PORT = pinokiod.port
    app.on('web-contents-created', attach)
    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(PORT)
    })
    app.on('before-quit', function(e) {
      if (pinokiod.kernel.kill) {
        if (isQuitting) {
          return
        }
        e.preventDefault()
        isQuitting = true
        persistSessionCookies().finally(() => {
          console.log('Cleaning up before quit', process.pid)
          pinokiod.kernel.kill()
        })
      }
    });
    app.on('window-all-closed', function () {
      console.log("window-all-closed")
      if (process.platform !== 'darwin') {
        // Reset all shells before quitting
        pinokiod.kernel.shell.reset()
        // wait 1 second before quitting the app
        // otherwise the app.quit() fails because the subprocesses are running
        setTimeout(() => {
          console.log("app.quit()")
          app.quit()
        }, 1000)
      }
    })
    app.on('browser-window-created', (event, win) => {
      const parentWindow = (win && typeof win.getParentWindow === 'function') ? win.getParentWindow() : null
      if (parentWindow && !parentWindow.isDestroyed()) installForceDestroyOnClose(win)
      if (win.type !== "splash") {
        if (win && typeof win.setTitleBarOverlay === 'function') {
          const overlay = titleBarOverlay(colors)
          setWindowTitleBarOverlay(win, overlay)
        }
      }
    })
    app.on('open-url', (event, url) => {
      let u = url.replace(/pinokio:[\/]+/, "")
  //    let u = new URL(url).search
  //    console.log("u", u)
      loadNewWindow(`${root_url}/pinokio/${u}`, PORT)

//      if (BrowserWindow.getAllWindows().length === 0 || !mainWindow) createWindow(PORT)
//      const topWindow = BrowserWindow.getFocusedWindow();
//      console.log("top window", topWindow)
//      //mainWindow.focus()
//      //mainWindow.loadURL(`${root_url}/pinokio/${u}`)
//      topWindow.focus()
//      topWindow.loadURL(`${root_url}/pinokio/${u}`)
    })
//    app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')

    let all = BrowserWindow.getAllWindows()
    for(win of all) {
      try {
        if (win && typeof win.setTitleBarOverlay === 'function') {
          const overlay = titleBarOverlay(colors)
          setWindowTitleBarOverlay(win, overlay)
        }
      } catch (e) {
  //      console.log("E2", e)
      }
    }
    createWindow(PORT)
    if (updateTestMode) {
      setTimeout(() => {
        showUpdateBannerTestAvailable()
      }, 400)
    } else {
      updater.setHandlers({
        onUpdateAvailable: (info) => {
          updateInfo = info
          updateDownloadInFlight = false
          updateBannerDismissed = false
          showUpdateBanner(buildUpdateBannerPayload('available', info))
        },
        onUpdateNotAvailable: () => {
          updateInfo = null
          updateDownloadInFlight = false
          hideUpdateBanner()
        },
        onDownloadProgress: (progress) => {
          const payload = buildUpdateBannerPayload('downloading', updateInfo, {
            progressPercent: progress && typeof progress.percent === 'number' ? progress.percent : 0,
            notesPreview: buildProgressLabel(progress)
          })
          showUpdateBanner(payload)
        },
        onUpdateDownloaded: (info) => {
          updateInfo = info
          updateDownloadInFlight = false
          showUpdateBanner(buildUpdateBannerPayload('ready', info))
        },
        onError: (err) => {
          const wasDownloading = updateDownloadInFlight
          updateDownloadInFlight = false
          if (!wasDownloading) {
            console.warn('Update check error:', err)
            return
          }
          const message = err && err.message ? err.message : 'Update error'
          showUpdateBanner(buildUpdateBannerPayload('error', updateInfo, { notesPreview: message }))
        }
      })
      updater.run(mainWindow)
    }
  })

}
