const {app, screen, shell, BrowserWindow, BrowserView, ipcMain, dialog, clipboard, session, desktopCapturer } = require('electron')
const windowStateKeeper = require('electron-window-state');
const fs = require('fs')
const path = require("path")
const Pinokiod = require("pinokiod")
const os = require('os')
const Updater = require('./updater')
const is_mac = process.platform.startsWith("darwin")
const platform = os.platform()
var mainWindow;
var root_url;
var wins = {}
var pinned = {}
var launched
var theme
var colors
const setWindowTitleBarOverlay = (win, overlay) => {
  if (!win || !win.setTitleBarOverlay) {
    return
  }
  try {
    win.setTitleBarOverlay(overlay)
  } catch (e) {
    console.log("ERROR", e)
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


const attach = (event, webContents) => {
  let wc = webContents

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

  webContents.on('will-navigate', (event, url) => {
    if (!webContents.opened) {
      // The first time this view is being used, set the "opened" to true, and don't do anything
      // The next time the view navigates, "the "opened" is already true, so trigger the URL open logic
      //  - if the new URL has the same host as the app's url, open in app
      //  - if it's a remote host, open in external browser
      webContents.opened = true
    } else {
//      console.log("will-navigate", { event, url })
      let host = new URL(url).host
      let localhost = new URL(root_url).host
      if (host !== localhost) {
        event.preventDefault()
        shell.openExternal(url);
      }
    }
  })
//  webContents.session.defaultSession.loadExtension('path/to/unpacked/extension').then(({ id }) => {
//  })


  webContents.session.webRequest.onHeadersReceived((details, callback) => {
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

    let ua = details.requestHeaders['User-Agent']
//    console.log("User Agent Before", ua)
    if (ua) {
      ua = ua.replace(/ pinokio\/[0-9.]+/i, '');
      ua = ua.replace(/Electron\/.+ /i,'');
//      console.log("User Agent After", ua)
      details.requestHeaders['User-Agent'] = ua;
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
  webContents.setWindowOpenHandler((config) => {
    let url = config.url
    let features = config.features
    let params = new URLSearchParams(features.split(",").join("&"))
    let win = wc.getOwnerBrowserWindow()
    let [width, height] = win.getSize()
    let [x,y] = win.getPosition()


    let origin = new URL(url).origin
    console.log("config", { config, root_url, origin })

    // if the origin is the same as the pinokio host,
    // always open in new window

    // if not, check the features
    // if features exists and it's app or self, open in pinokio
    // otherwise if it's file, 

    if (features === "browser") {
      shell.openExternal(url);
      return { action: 'deny' };
    } else if (origin === root_url) {
      return {
        action: 'allow',
        outlivesOpener: true,
        overrideBrowserWindowOptions: {
          width: (params.get("width") ? parseInt(params.get("width")) : width),
          height: (params.get("height") ? parseInt(params.get("height")) : height),
          x: x + 30,
          y: y + 30,

          parent: null,
          titleBarStyle : "hidden",
          titleBarOverlay : titleBarOverlay(colors),
          webPreferences: {
            session: session.fromPartition('temp-window-' + Date.now()),
            webSecurity: false,
            nativeWindowOpen: true,
            contextIsolation: false,
            nodeIntegrationInSubFrames: true,
            preload: path.join(__dirname, 'preload.js')
          },
        }
      }
    } else {
      console.log({ features, url })
      if (features) {
        if (features.startsWith("app") || features.startsWith("self")) {
          return {
            action: 'allow',
            outlivesOpener: true,
            overrideBrowserWindowOptions: {
              width: (params.get("width") ? parseInt(params.get("width")) : width),
              height: (params.get("height") ? parseInt(params.get("height")) : height),
              x: x + 30,
              y: y + 30,

              parent: null,
              titleBarStyle : "hidden",
              titleBarOverlay : titleBarOverlay(colors),
              webPreferences: {
                session: session.fromPartition('temp-window-' + Date.now()),
                webSecurity: false,
                nativeWindowOpen: true,
                contextIsolation: false,
                nodeIntegrationInSubFrames: true,
                preload: path.join(__dirname, 'preload.js')
              },

            }
          }
        } else if (features.startsWith("file")) {
          let u = features.replace("file://", "")
          shell.showItemInFolder(u)
          return { action: 'deny' };
        } else {
          shell.openExternal(url);
          return { action: 'deny' };
        }
      } else {
        if (features.startsWith("file")) {
          let u = features.replace("file://", "")
          shell.showItemInFolder(u)
          return { action: 'deny' };
        } else {
          shell.openExternal(url);
          return { action: 'deny' };
        }
      }
    }

//    if (origin === root_url) {
//      // if the origin is the same as pinokio, open in pinokio
//      // otherwise open in external browser
//      if (features) {
//        if (features.startsWith("app") || features.startsWith("self")) {
//          return {
//            action: 'allow',
//            outlivesOpener: true,
//            overrideBrowserWindowOptions: {
//              width: (params.get("width") ? parseInt(params.get("width")) : width),
//              height: (params.get("height") ? parseInt(params.get("height")) : height),
//              x: x + 30,
//              y: y + 30,
//
//              parent: null,
//              titleBarStyle : "hidden",
//              titleBarOverlay : titleBarOverlay("default"),
//            }
//          }
//        } else if (features.startsWith("file")) {
//          let u = features.replace("file://", "")
//          shell.showItemInFolder(u)
//          return { action: 'deny' };
//        } else {
//          return { action: 'deny' };
//        }
//      } else {
//        if (features.startsWith("file")) {
//          let u = features.replace("file://", "")
//          shell.showItemInFolder(u)
//          return { action: 'deny' };
//        } else {
//          shell.openExternal(url);
//          return { action: 'deny' };
//        }
//      }
//    } else {
//      if (features.startsWith("file")) {
//        let u = features.replace("file://", "")
//        shell.showItemInFolder(u)
//        return { action: 'deny' };
//      } else {
//        shell.openExternal(url);
//        return { action: 'deny' };
//      }
//    }
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
      session: session.fromPartition('temp-window-' + Date.now()),
      webSecurity: false,
      nativeWindowOpen: true,
      contextIsolation: false,
      nodeIntegrationInSubFrames: true,
      enableRemoteModule: false,
      experimentalFeatures: true,
      preload: path.join(__dirname, 'preload.js')
    },
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
      session: session.fromPartition('temp-window-' + Date.now()),
      webSecurity: false,
      nativeWindowOpen: true,
      contextIsolation: false,
      nodeIntegrationInSubFrames: true,
      enableRemoteModule: false,
      experimentalFeatures: true,
      preload: path.join(__dirname, 'preload.js')
    },
  })

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

    if (mainWindow) {
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
  app.commandLine.appendSwitch('enable-experimental-web-platform-features');
  app.commandLine.appendSwitch('enable-features', 'GetDisplayMediaSet,GetDisplayMediaSetAutoSelectAllScreens');
  
  app.whenReady().then(async () => {
    console.log('App is ready, about to install inspector handlers...')
    app.userAgentFallback = "Pinokio"

    installInspectorHandlers()

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
          session: session.fromPartition('temp-window-' + Date.now()),
          webSecurity: false,
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


    await pinokiod.start({
      onquit: () => {
        app.quit()
      },
      onrestart: () => {
        app.relaunch();
        app.exit()
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
          
          console.log("cleared all sessions")
        }
      }
    })
    PORT = pinokiod.port
    app.on('web-contents-created', attach)
    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(PORT)
    })
    app.on('before-quit', function(e) {
      if (pinokiod.kernel.kill) {
        e.preventDefault()
        console.log('Cleaning up before quit', process.pid);
        pinokiod.kernel.kill()
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
    updater.run(mainWindow)
  })

}
