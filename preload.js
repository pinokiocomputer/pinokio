// put this preload for main-window to give it prompt()
const { ipcRenderer, } = require('electron')
const PINOKIO_INSPECTOR_ENABLED = false
const inspectorDisabled = () => Promise.reject(new Error('Pinokio inspector is disabled.'))
window.prompt = function(title, val){
  return ipcRenderer.sendSync('prompt', {title, val})
}
try {
} catch (_) {
}
const sendPinokio = (action) => {
  if (!action) {
    return
  }
  try {
    if (window.parent === window.top) {
      window.parent.postMessage({ action }, "*")
    }
  } catch (_) {
  }
}

// Only apply frame bridge hooks inside embedded pages.
let isEmbeddedFrame = false
let isDirectChildFrame = false
try {
  isEmbeddedFrame = window.parent !== window
  isDirectChildFrame = isEmbeddedFrame && window.parent === window.top
} catch (_) {
  isEmbeddedFrame = false
  isDirectChildFrame = false
}
let previousFrameUrl = isEmbeddedFrame ? document.location.href : ''
const publishFrameLocation = () => {
  if (!isEmbeddedFrame) {
    return
  }
  const currentUrl = document.location.href
  if (currentUrl === previousFrameUrl) {
    return
  }
  previousFrameUrl = currentUrl
  if (isDirectChildFrame) {
    sendPinokio({
      type: 'location',
      url: currentUrl
    })
  }
  syncPinokioInjectors('location').catch(() => {})
}
if (isEmbeddedFrame) {
  if (isDirectChildFrame) {
    sendPinokio({
      type: 'location',
      url: previousFrameUrl
    })
  }
  const originalPushState = history.pushState
  history.pushState = function pushStateWithPinokioLocation(...args) {
    const result = originalPushState.apply(this, args)
    publishFrameLocation()
    return result
  }
  const originalReplaceState = history.replaceState
  history.replaceState = function replaceStateWithPinokioLocation(...args) {
    const result = originalReplaceState.apply(this, args)
    publishFrameLocation()
    return result
  }
  window.addEventListener('popstate', publishFrameLocation)
  window.addEventListener('hashchange', publishFrameLocation)
  window.addEventListener('beforeunload', () => {
    resetPinokioInjectors('unload').catch(() => {})
  }, { once: true })
  window.addEventListener('message', (event) => {
    if (event.data) {
      if (event.data.action === 'back') {
        history.back()
      } else if (event.data.action === 'forward') {
        history.forward()
      } else if (event.data.action === 'refresh') {
        location.reload()
      }
    }
  })
}


//document.addEventListener("DOMContentLoaded", (e) => {
//  if (window.parent === window.top) {
//    window.parent.postMessage({
//      action: {
//        type: "title",
//        text: document.title
//      }
//    }, "*")
//  }
//})
window.electronAPI = {
  send: (type, msg) => {
    ipcRenderer.send(type, msg)
  },
  sendSync: (type, msg) => ipcRenderer.sendSync(type, msg),
  requestPermissions: (payload) => ipcRenderer.invoke('pinokio:request-permissions', payload || {}),
  startInspector: (payload) => PINOKIO_INSPECTOR_ENABLED
    ? ipcRenderer.invoke('pinokio:start-inspector', payload || {})
    : inspectorDisabled(),
  stopInspector: () => PINOKIO_INSPECTOR_ENABLED
    ? ipcRenderer.invoke('pinokio:stop-inspector')
    : Promise.resolve({ ok: false, disabled: true }),
  captureScreenshot: (screenshotRequest) => {
    if (!PINOKIO_INSPECTOR_ENABLED) {
      return inspectorDisabled()
    }
    return ipcRenderer.invoke('pinokio:capture-screenshot-debug', { screenshotRequest })
  }
}
const resolvePinokioTargetWindow = () => {
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
const postPinokioEvent = (eventName, payload = {}, context = {}) => {
  const target = resolvePinokioTargetWindow()
  const nextContext = (context && typeof context === 'object') ? { ...context } : {}
  if (!nextContext.frameUrl) {
    nextContext.frameUrl = window.location.href
  }
  if (!nextContext.workspace) {
    const workspaceHint = resolvePinokioWorkspaceHint()
    if (workspaceHint) {
      nextContext.workspace = workspaceHint
    }
  }
  target.postMessage({
    e: 'pinokio:event',
    event: eventName,
    payload: (payload && typeof payload === 'object') ? payload : {},
    context: nextContext
  }, '*')
}
const ensurePinokioApi = () => {
  const api = (window.$pinokio && typeof window.$pinokio === 'object')
    ? window.$pinokio
    : {}
  api.trigger = (eventName, payload = {}, context = {}) => {
    if (typeof eventName !== 'string' || !eventName.trim()) {
      return { ok: false, handled: false, reason: 'invalid_event_name' }
    }
    const normalizedEvent = eventName.trim()
    postPinokioEvent(
      normalizedEvent,
      (payload && typeof payload === 'object') ? payload : {},
      (context && typeof context === 'object') ? context : {}
    )
    return { ok: true, handled: true, event: normalizedEvent }
  }
  window.$pinokio = api
  return api
}
ensurePinokioApi()
const extractWorkspaceFromPathname = (pathname) => {
  if (typeof pathname !== 'string') {
    return ''
  }
  const value = pathname.trim()
  if (!value) {
    return ''
  }
  const patterns = [
    /^\/pinokio\/([^/?#]+)/i,
    /^\/p\/([^/?#]+)/i,
    /^\/api\/([^/?#]+)/i,
    /^\/_api\/([^/?#]+)/i,
    /^\/raw\/api\/([^/?#]+)/i,
    /^\/asset\/api\/([^/?#]+)/i,
    /^\/files\/api\/([^/?#]+)/i,
    /^\/env\/api\/([^/?#]+)/i,
    /^\/run\/api\/([^/?#]+)/i,
  ]
  for (const pattern of patterns) {
    const match = value.match(pattern)
    if (!match || !match[1]) {
      continue
    }
    try {
      return decodeURIComponent(match[1]).trim()
    } catch (_) {
      return String(match[1] || '').trim()
    }
  }
  return ''
}
const resolvePinokioWorkspaceHint = () => {
  const candidates = []
  try {
    const ref = (typeof document !== 'undefined' && document.referrer) ? document.referrer : ''
    if (ref) {
      candidates.push(ref)
    }
  } catch (_) {
  }
  try {
    candidates.push(window.location.href)
  } catch (_) {
  }
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) {
      continue
    }
    try {
      const parsed = new URL(candidate, 'http://localhost')
      const workspaceQueryHint = (parsed.searchParams.get('__pinokio_workspace') || parsed.searchParams.get('workspace') || '').trim()
      if (workspaceQueryHint) {
        return workspaceQueryHint
      }
      const workspace = extractWorkspaceFromPathname(parsed.pathname || '')
      if (workspace) {
        return workspace
      }
    } catch (_) {
      const workspace = extractWorkspaceFromPathname(candidate)
      if (workspace) {
        return workspace
      }
    }
  }
  return ''
}
let pinokioInjectSyncId = 0

const buildPinokioContext = (reason = 'load', responseContext = {}) => {
  const currentUrl = window.location.href
  const referrerUrl = (typeof document !== 'undefined' && document.referrer) ? document.referrer : ''
  const workspaceHint = resolvePinokioWorkspaceHint()
  const frameName = typeof window.name === 'string' ? window.name.trim() : ''
  const rootFrameUrl = responseContext && typeof responseContext.frameUrl === 'string' && responseContext.frameUrl.trim()
    ? responseContext.frameUrl.trim()
    : currentUrl
  return {
    frameUrl: currentUrl,
    rootFrameUrl,
    currentUrl,
    pageUrl: referrerUrl || rootFrameUrl,
    referrerUrl,
    frameName: frameName || undefined,
    workspace: workspaceHint || undefined,
    reason
  }
}

const waitForPinokioDocumentEnd = () => {
  if (document.readyState === 'loading') {
    return new Promise((resolve) => {
      window.addEventListener('DOMContentLoaded', resolve, { once: true })
    })
  }
  return Promise.resolve()
}

const waitForPinokioDocumentIdle = async () => {
  await waitForPinokioDocumentEnd()
  await new Promise((resolve) => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => resolve(), { timeout: 120 })
      return
    }
    setTimeout(resolve, 32)
  })
}

const requestPinokioInjectDescriptors = (reason = 'load') => {
  if (!isEmbeddedFrame) {
    return Promise.resolve(null)
  }
  const context = buildPinokioContext(reason)
  return ipcRenderer.invoke('pinokio:resolve-injectors', {
    reason,
    context
  }).then((result) => result && typeof result === 'object' ? result : null).catch(() => null)
}

const resetPinokioInjectors = async (reason = 'sync', syncId = pinokioInjectSyncId) => {
  if (!isEmbeddedFrame) {
    return
  }
  try {
    await ipcRenderer.invoke('pinokio:reset-injectors', {
      syncId,
      reason,
      context: buildPinokioContext(reason)
    })
  } catch (error) {
    try {
      console.warn('[pinokio][preload] injector reset failed', {
        reason,
        error: error && error.message ? error.message : String(error)
      })
    } catch (_) {
    }
  }
}

const mountPinokioInjectGroup = async (syncId, descriptors, responseContext, reason) => {
  if (!descriptors.length || syncId !== pinokioInjectSyncId) {
    return
  }
  try {
    await ipcRenderer.invoke('pinokio:mount-injectors', {
      syncId,
      reason,
      inject: descriptors,
      context: buildPinokioContext(reason, responseContext)
    })
  } catch (error) {
    try {
      console.warn('[pinokio][preload] injector mount failed', {
        reason,
        descriptors: descriptors.map((item) => item && item.src).filter(Boolean),
        error: error && error.message ? error.message : String(error)
      })
    } catch (_) {
    }
  }
}

async function syncPinokioInjectors(reason = 'load') {
  if (!isEmbeddedFrame) {
    return
  }
  const syncId = ++pinokioInjectSyncId
  const response = await requestPinokioInjectDescriptors(reason)
  if (syncId !== pinokioInjectSyncId) {
    return
  }
  const descriptors = Array.isArray(response && response.inject) ? response.inject : []
  const groups = {
    start: [],
    end: [],
    idle: []
  }
  for (const descriptor of descriptors) {
    const when = descriptor && (descriptor.when === 'start' || descriptor.when === 'end')
      ? descriptor.when
      : 'idle'
    groups[when].push(descriptor)
  }
  await resetPinokioInjectors(reason, syncId)
  if (syncId !== pinokioInjectSyncId) {
    return
  }
  await mountPinokioInjectGroup(syncId, groups.start, response && response.context, reason)
  await waitForPinokioDocumentEnd()
  await mountPinokioInjectGroup(syncId, groups.end, response && response.context, reason)
  await waitForPinokioDocumentIdle()
  await mountPinokioInjectGroup(syncId, groups.idle, response && response.context, reason)
}

if (isEmbeddedFrame) {
  syncPinokioInjectors('load').catch(() => {})
}

;(function initUpdateBanner() {
  if (typeof document === 'undefined') {
    return
  }
  if (window !== window.top) {
    return
  }

  const BANNER_HEIGHT = 72
  const state = {
    payload: null,
    banner: null,
    style: null,
    layoutActive: false,
    layoutTick: null,
    ready: false
  }

  const ensureStyle = () => {
    if (state.style) {
      return
    }
    const style = document.createElement('style')
    style.id = 'pinokio-update-banner-style'
    style.textContent = `
      body.pinokio-update-banner-active[data-pinokio-update-layout-root="1"] #layout-root {
        height: calc(100% - var(--layout-dragger-height, 0px) - var(--pinokio-update-banner-height, 0px));
      }
      body.pinokio-update-banner-active:not([data-pinokio-update-layout-root="1"]) {
        padding-bottom: var(--pinokio-update-banner-height, 0px) !important;
      }
      #pinokio-update-banner {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        height: var(--pinokio-update-banner-height, 72px);
        display: none;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 10px 16px 12px;
        box-sizing: border-box;
        background: linear-gradient(90deg, rgba(24, 24, 30, 0.94), rgba(30, 30, 38, 0.98));
        border-top: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 -12px 26px rgba(0, 0, 0, 0.35);
        z-index: 2147483646;
        color: #f5f5f7;
        font-family: "SF Pro Text", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        border-radius: 0;
      }
      #pinokio-update-banner .pinokio-update-left {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      #pinokio-update-banner .pinokio-update-title {
        font-size: 15px;
        font-weight: 600;
        letter-spacing: 0.1px;
      }
      #pinokio-update-banner .pinokio-update-title.danger {
        color: #ff7b72;
      }
      #pinokio-update-banner .pinokio-update-details {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.68);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 520px;
      }
      #pinokio-update-banner .pinokio-update-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }
      #pinokio-update-banner button {
        appearance: none;
        border: 1px solid transparent;
        border-radius: 0;
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
      }
      #pinokio-update-banner button:disabled {
        opacity: 0.6;
        cursor: default;
      }
      #pinokio-update-banner .pinokio-update-primary {
        color: #1b1b1f;
        background: #f6c251;
      }
      #pinokio-update-banner .pinokio-update-primary:hover:not(:disabled) {
        background: #ffcc66;
        transform: translateY(-1px);
      }
      #pinokio-update-banner .pinokio-update-ghost {
        color: #f5f5f7;
        background: transparent;
        border-color: rgba(255, 255, 255, 0.18);
      }
      #pinokio-update-banner .pinokio-update-ghost:hover:not(:disabled) {
        border-color: rgba(255, 255, 255, 0.35);
      }
      #pinokio-update-banner .pinokio-update-progress {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 3px;
        background: rgba(255, 255, 255, 0.15);
      }
      #pinokio-update-banner .pinokio-update-progress-bar {
        height: 100%;
        width: 0%;
        background: #f6c251;
        transition: width 150ms ease;
      }
      #pinokio-update-banner .pinokio-update-hidden {
        display: none !important;
      }
    `
    const target = document.head || document.documentElement
    target.appendChild(style)
    state.style = style
  }

  const ensureBanner = () => {
    if (state.banner) {
      return state.banner
    }
    if (!document.body) {
      return null
    }
    ensureStyle()
    const container = document.createElement('div')
    container.id = 'pinokio-update-banner'
    container.innerHTML = `
      <div class="pinokio-update-left">
        <div class="pinokio-update-title">Update available</div>
        <div class="pinokio-update-details"></div>
      </div>
      <div class="pinokio-update-actions">
        <button class="pinokio-update-primary" data-action="update">Update now</button>
        <button class="pinokio-update-primary pinokio-update-hidden" data-action="restart">Restart now</button>
        <button class="pinokio-update-ghost pinokio-update-hidden" data-action="release-notes">Release notes</button>
        <button class="pinokio-update-ghost" data-action="dismiss">Later</button>
      </div>
      <div class="pinokio-update-progress pinokio-update-hidden">
        <div class="pinokio-update-progress-bar"></div>
      </div>
    `
    container.addEventListener('click', (event) => {
      const button = event.target.closest('button')
      if (!button) {
        return
      }
      const action = button.getAttribute('data-action')
      if (!action) {
        return
      }
      if (action === 'release-notes' && state.payload && state.payload.releaseUrl) {
        ipcRenderer.send('pinokio:update-banner-action', { action, releaseUrl: state.payload.releaseUrl })
        return
      }
      ipcRenderer.send('pinokio:update-banner-action', { action })
    })
    document.body.appendChild(container)
    state.banner = container
    return container
  }

  const notifyLayoutResize = () => {
    if (state.layoutTick) {
      cancelAnimationFrame(state.layoutTick)
    }
    state.layoutTick = requestAnimationFrame(() => {
      state.layoutTick = null
      try {
        window.dispatchEvent(new CustomEvent('pinokio:viewport-change', {
          detail: { height: window.innerHeight }
        }))
      } catch (_) {
        window.dispatchEvent(new Event('resize'))
      }
    })
  }

  const applyLayoutOffset = (active) => {
    if (!document.body) {
      return
    }
    const hasLayoutRoot = Boolean(document.getElementById('layout-root'))
    if (hasLayoutRoot) {
      document.body.setAttribute('data-pinokio-update-layout-root', '1')
    } else {
      document.body.removeAttribute('data-pinokio-update-layout-root')
    }
    document.documentElement.style.setProperty('--pinokio-update-banner-height', `${BANNER_HEIGHT}px`)
    document.body.classList.toggle('pinokio-update-banner-active', Boolean(active))
    if (state.layoutActive !== Boolean(active)) {
      state.layoutActive = Boolean(active)
      notifyLayoutResize()
    }
  }

  const setHidden = (node, hidden) => {
    if (!node) return
    node.classList.toggle('pinokio-update-hidden', Boolean(hidden))
  }

  const render = (payload) => {
    state.payload = payload
    if (!payload || payload.state === 'hidden') {
      if (state.banner) {
        state.banner.style.display = 'none'
      }
      applyLayoutOffset(false)
      return
    }
    const banner = ensureBanner()
    if (!banner) {
      return
    }
    banner.style.display = 'flex'
    applyLayoutOffset(true)

    const title = banner.querySelector('.pinokio-update-title')
    const details = banner.querySelector('.pinokio-update-details')
    const updateNow = banner.querySelector('[data-action="update"]')
    const restartNow = banner.querySelector('[data-action="restart"]')
    const releaseNotes = banner.querySelector('[data-action="release-notes"]')
    const progress = banner.querySelector('.pinokio-update-progress')
    const progressBar = banner.querySelector('.pinokio-update-progress-bar')

    const stateKey = payload.state || 'available'
    const version = payload.version ? `Version ${payload.version}` : ''
    const notes = payload.notesPreview || ''
    const detail = [version, notes].filter(Boolean).join(' - ')

    let titleText = 'Update available'
    if (stateKey === 'downloading') titleText = 'Downloading update'
    if (stateKey === 'ready') titleText = 'Update ready'
    if (stateKey === 'error') titleText = 'Update failed'

    if (title) {
      title.textContent = titleText
      if (stateKey === 'error') {
        title.classList.add('danger')
      } else {
        title.classList.remove('danger')
      }
    }
    if (details) {
      details.textContent = detail
    }

    if (updateNow) {
      updateNow.textContent = stateKey === 'error' ? 'Retry' : 'Update now'
      updateNow.disabled = stateKey === 'downloading'
    }

    setHidden(updateNow, stateKey === 'ready')
    setHidden(restartNow, stateKey !== 'ready')
    setHidden(progress, stateKey !== 'downloading')
    setHidden(releaseNotes, !payload.releaseUrl)

    if (progressBar) {
      if (stateKey === 'downloading' && typeof payload.progressPercent === 'number') {
        const percent = Math.max(0, Math.min(100, payload.progressPercent))
        progressBar.style.width = `${percent}%`
      } else {
        progressBar.style.width = '0%'
      }
    }
  }

  ipcRenderer.on('pinokio:update-banner', (_event, payload) => {
    render(payload)
  })

  const ready = () => {
    state.ready = true
    if (state.payload) {
      render(state.payload)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready, { once: true })
  } else {
    ready()
  }
})()

;(function initInspector() {
  if (!PINOKIO_INSPECTOR_ENABLED) {
    return
  }
  if (typeof document === 'undefined') {
    return
  }

  const log = (message) => {
    try {
      console.log(`[Inspector] ${message}`)
    } catch (_) {
      // ignore
    }
  }

  const state = {
    active: false,
    button: null,
    lastFrameOrdinal: null,
    lastRelativeOrdinal: null,
    lastUrl: null,
    lastDomPath: null,
    displayUrl: null,
    overlay: null,
    instructionsVisible: false,
    closing: false,
  }

  const normalizeUrl = (value) => {
    if (!value) {
      return null
    }
    try {
      return new URL(value, window.location.href).toString()
    } catch (err) {
      return value
    }
  }

  const findIframeCandidates = () => {
    const list = Array.from(document.querySelectorAll('iframe')).map((iframe, index) => {
      const style = window.getComputedStyle ? window.getComputedStyle(iframe) : null
      const rect = iframe.getBoundingClientRect()
      const area = rect ? Math.max(rect.width, 0) * Math.max(rect.height, 0) : 0
      const visible = Boolean(
        rect &&
        rect.width > 2 &&
        rect.height > 2 &&
        !iframe.classList.contains('hidden') &&
        !iframe.hasAttribute('hidden') &&
        (!style || (style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0))
      )
      return {
        element: iframe,
        index,
        rect,
        area,
        visible,
        src: normalizeUrl(iframe.getAttribute('src') || iframe.src || ''),
      }
    })
    return list
  }

  const selectVisibleIframe = () => {
    const candidates = findIframeCandidates()
    if (!candidates.length) {
      log('no iframe candidates discovered')
      return null
    }
    candidates.slice(0, 3).forEach((candidate) => {
      const rect = candidate.rect || { width: 0, height: 0 }
      log(`candidate[${candidate.index}] src=${candidate.src || '<empty>'} visible=${candidate.visible ? 'yes' : 'no'} size=${Math.round(rect.width)}x${Math.round(rect.height)}`)
    })
    const visible = candidates.filter((candidate) => candidate.visible)
    const ranked = (visible.length ? visible : candidates).slice().sort((a, b) => {
      if (b.area === a.area) {
        return (b.rect ? b.rect.width : 0) - (a.rect ? a.rect.width : 0)
      }
      return b.area - a.area
    })
    const chosen = ranked[0]
    if (!chosen) {
      log('no suitable iframe found after ranking')
      return null
    }
    log(`selected iframe src=${chosen.src || '<empty>'} visible=${chosen.visible ? 'yes' : 'no'} size=${Math.round(chosen.rect?.width || 0)}x${Math.round(chosen.rect?.height || 0)}`)
    const siblingsWithSameUrl = candidates.filter((candidate) => candidate.src === chosen.src)
    const relativeOrdinal = siblingsWithSameUrl.indexOf(chosen)
    return {
      element: chosen.element,
      index: chosen.index,
      relativeOrdinal: relativeOrdinal >= 0 ? relativeOrdinal : null,
      url: chosen.src,
    }
  }

  const ensureOverlay = () => {
    if (state.overlay && state.overlay.container && document.body.contains(state.overlay.container)) {
      return state.overlay
    }

    // Remove stale overlays left over from previous script executions
    const orphaned = Array.from(document.querySelectorAll('.pinokio-inspector-overlay'))
    for (const node of orphaned) {
      if (!state.overlay || node !== state.overlay.container) {
        node.remove()
      }
    }

    const container = document.createElement('div')
    container.className = 'pinokio-inspector-overlay'
    Object.assign(container.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      maxWidth: 'min(420px, 92vw)',
      maxHeight: '70vh',
      padding: '12px 14px',
      borderRadius: '10px',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      background: 'rgba(9, 12, 20, 0.92)',
      color: '#fefefe',
      boxShadow: '0 20px 42px rgba(0,0,0,0.45)',
      display: 'none',
      flexDirection: 'column',
      gap: '8px',
      zIndex: '2147483646',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: '12px',
    })

    const header = document.createElement('div')
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
    })

    const title = document.createElement('strong')
    title.textContent = 'Inspect Mode'
    Object.assign(title.style, {
      fontSize: '12px',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
    })

    const closeButton = document.createElement('button')
    closeButton.type = 'button'
    closeButton.textContent = '×'
    closeButton.dataset.role = 'close'
    Object.assign(closeButton.style, {
      background: 'transparent',
      border: 'none',
      color: '#fefefe',
      fontSize: '18px',
      lineHeight: '1',
      cursor: 'pointer',
    })

    header.append(title, closeButton)

    const status = document.createElement('div')
    status.dataset.role = 'status'
    status.style.color = '#ccd5ff'

    const urlRow = document.createElement('div')
    urlRow.dataset.role = 'url'
    Object.assign(urlRow.style, {
      color: '#9aa7c2',
      fontSize: '11px',
      wordBreak: 'break-all',
    })

    const htmlSection = document.createElement('div')
    htmlSection.dataset.role = 'html-container'
    Object.assign(htmlSection.style, {
      display: 'none',
      margin: '8px 0',
      padding: '8px',
      borderRadius: '8px',
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.12)',
    })

    const htmlHeader = document.createElement('div')
    Object.assign(htmlHeader.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      marginBottom: '6px',
    })

    const htmlLabel = document.createElement('div')
    htmlLabel.textContent = 'Element Snippet'
    Object.assign(htmlLabel.style, {
      fontSize: '11px',
      color: '#9aa7c2',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
    })

    const buttonBaseStyle = {
      display: 'none',
      background: 'rgba(77,163,255,0.2)',
      border: '1px solid rgba(77,163,255,0.4)',
      borderRadius: '6px',
      padding: '4px 12px',
      fontSize: '11px',
      cursor: 'pointer',
      color: '#ccd5ff',
      fontWeight: '600',
    }

    const copyButton = document.createElement('button')
    copyButton.dataset.role = 'copy'
    copyButton.type = 'button'
    copyButton.textContent = 'Copy snippet'
    Object.assign(copyButton.style, buttonBaseStyle)

    htmlHeader.append(htmlLabel, copyButton)

    const htmlBlock = document.createElement('textarea')
    htmlBlock.dataset.role = 'html'
    Object.assign(htmlBlock.style, {
      margin: '0',
      padding: '10px',
      maxHeight: '28vh',
      overflow: 'auto',
      borderRadius: '8px',
      background: 'rgba(255,255,255,0.08)',
      display: 'none',
      fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
      fontSize: '11px',
      border: '1px solid rgba(255,255,255,0.18)',
      color: '#fefefe',
      resize: 'vertical',
      minHeight: '140px',
      width: '100%',
      boxSizing: 'border-box',
    })
    htmlBlock.spellcheck = false

    htmlSection.append(htmlHeader, htmlBlock)

    const screenshotBlock = document.createElement('div')
    screenshotBlock.dataset.role = 'screenshot-container'
    Object.assign(screenshotBlock.style, {
      margin: '8px 0',
      padding: '8px',
      borderRadius: '8px',
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.12)',
      display: 'none',
      textAlign: 'center',
    })

    const screenshotHeader = document.createElement('div')
    Object.assign(screenshotHeader.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      marginBottom: '8px',
    })

    const screenshotImg = document.createElement('img')
    screenshotImg.dataset.role = 'screenshot'
    Object.assign(screenshotImg.style, {
      maxWidth: '100%',
      maxHeight: '200px',
      borderRadius: '4px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    })

    const screenshotLabel = document.createElement('div')
    screenshotLabel.textContent = 'Element Screenshot'
    Object.assign(screenshotLabel.style, {
      fontSize: '11px',
      color: '#9aa7c2',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
    })

    const copyScreenshotButton = document.createElement('button')
    copyScreenshotButton.dataset.role = 'copy-screenshot'
    copyScreenshotButton.type = 'button'
    copyScreenshotButton.textContent = 'Copy screenshot'
    Object.assign(copyScreenshotButton.style, buttonBaseStyle)

    screenshotHeader.append(screenshotLabel, copyScreenshotButton)
    screenshotBlock.append(screenshotHeader, screenshotImg)

    container.append(header, status, urlRow, htmlSection, screenshotBlock)
    document.body.appendChild(container)

    const overlay = {
      container,
      status,
      urlRow,
      htmlSection,
      htmlBlock,
      screenshotBlock,
      screenshotImg,
      copyButton,
      copyScreenshotButton,
      closeButton,
    }

    closeButton.addEventListener('click', () => {
      stopInspector()
    })

    copyButton.addEventListener('click', async () => {
      const text = overlay.htmlBlock.value || ''
      if (!text) {
        return
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text)
        } else {
          const textarea = document.createElement('textarea')
          textarea.value = text
          textarea.setAttribute('readonly', '')
          textarea.style.position = 'absolute'
          textarea.style.left = '-9999px'
          document.body.appendChild(textarea)
          textarea.select()
          document.execCommand('copy')
          document.body.removeChild(textarea)
        }
        overlay.copyButton.textContent = 'Copied'
        setTimeout(() => {
          overlay.copyButton.textContent = 'Copy snippet'
        }, 1500)
      } catch (err) {
        overlay.copyButton.textContent = 'Copy failed'
        setTimeout(() => {
          overlay.copyButton.textContent = 'Copy snippet'
        }, 1500)
      }
    })

    copyScreenshotButton.addEventListener('click', async () => {
      const img = overlay.screenshotImg
      if (!img.src) {
        return
      }
      try {
        // Convert data URL to blob
        const response = await fetch(img.src)
        const blob = await response.blob()
        
        if (navigator.clipboard && navigator.clipboard.write) {
          const clipboardItem = new ClipboardItem({ 'image/png': blob })
          await navigator.clipboard.write([clipboardItem])
        } else {
          throw new Error('Clipboard API not available')
        }
        
        overlay.copyScreenshotButton.textContent = 'Copied'
        setTimeout(() => {
          overlay.copyScreenshotButton.textContent = 'Copy screenshot'
        }, 1500)
      } catch (err) {
        console.warn('Screenshot copy failed:', err)
        overlay.copyScreenshotButton.textContent = 'Copy failed'
        setTimeout(() => {
          overlay.copyScreenshotButton.textContent = 'Copy screenshot'
        }, 1500)
      }
    })

    state.overlay = overlay
    return overlay
  }

  const showOverlay = (message, frameUrl, html, screenshot) => {
    const overlay = ensureOverlay()
    if (overlay.container.parentNode) {
      overlay.container.parentNode.appendChild(overlay.container)
    }
    for (const node of document.querySelectorAll('.pinokio-inspector-overlay')) {
      if (node !== overlay.container) {
        node.style.display = 'none'
      }
    }
    overlay.container.style.display = 'flex'
    overlay.status.textContent = message || ''
    overlay.urlRow.textContent = frameUrl ? `Page: ${frameUrl}` : ''
    state.displayUrl = frameUrl || null
    
    // Handle HTML content
    if (html) {
      const pageUrl = frameUrl || state.displayUrl || state.lastUrl || ''
      const domPath = state.lastDomPath || ''
      const lines = []
      if (pageUrl) {
        lines.push(`Page: ${pageUrl}`)
      }
      if (domPath) {
        lines.push(`DOM: ${domPath}`)
      }
      lines.push(`HTML: ${html}`)
      overlay.htmlSection.style.display = 'block'
      overlay.htmlBlock.style.display = 'block'
      overlay.htmlBlock.value = lines.join('\n')
      overlay.copyButton.style.display = 'inline-flex'
      overlay.copyButton.textContent = 'Copy snippet'
    } else {
      overlay.htmlSection.style.display = 'none'
      overlay.htmlBlock.style.display = 'none'
      overlay.htmlBlock.value = ''
      overlay.copyButton.style.display = 'none'
    }
    
    // Handle screenshot content
    if (screenshot) {
      overlay.screenshotImg.src = screenshot
      overlay.screenshotBlock.style.display = 'block'
      overlay.copyScreenshotButton.style.display = 'inline-flex'
      overlay.copyScreenshotButton.textContent = 'Copy screenshot'
    } else {
      overlay.screenshotImg.src = ''
      overlay.screenshotBlock.style.display = 'none'
      overlay.copyScreenshotButton.style.display = 'none'
    }
  }

  const hideOverlay = () => {
    const overlay = state.overlay
    if (overlay && overlay.container) {
      overlay.container.style.display = 'none'
      overlay.status.textContent = ''
      overlay.urlRow.textContent = ''
      overlay.htmlBlock.value = ''
      overlay.htmlSection.style.display = 'none'
      overlay.htmlBlock.style.display = 'none'
      overlay.copyButton.style.display = 'none'
      overlay.screenshotImg.src = ''
      overlay.screenshotBlock.style.display = 'none'
      overlay.copyScreenshotButton.style.display = 'none'
    }
    state.instructionsVisible = false
    state.closing = false
    state.displayUrl = null
  }

  const startInspector = async (button) => {
    if (state.active) {
      log('inspector already active')
      return
    }
    const target = selectVisibleIframe()
    if (!target) {
      showOverlay('No visible iframe found to inspect.', '', null)
      log('startInspector aborted: no target iframe')
      return
    }

    hideOverlay()

    state.active = true
    state.button = button || null
    state.lastFrameOrdinal = target.index
    state.lastRelativeOrdinal = target.relativeOrdinal
    state.lastUrl = target.url
    state.lastDomPath = null

    if (state.button) {
      state.button.classList.add('inspector-active')
      state.button.setAttribute('aria-pressed', 'true')
    }

    showOverlay('Inspect mode enabled – hover items and click to capture.', target.url || '', null)

    try {
      await window.electronAPI.startInspector({
        frameIndex: target.index,
        frameUrl: target.url,
        candidateOrdinal: target.index,
        candidateRelativeOrdinal: target.relativeOrdinal,
      })
      log('startInspector IPC resolved')
    } catch (error) {
      const message = error && error.message ? error.message : 'Unable to start inspect mode.'
      showOverlay(message, target.url || '', null)
      log(`startInspector IPC error: ${message}`)
      resetState()
    }
  }

  const stopInspector = () => {
    if (!state.active) {
      hideOverlay()
      return
    }
    window.electronAPI.stopInspector().catch(() => {})
    resetState()
    hideOverlay()
  }

  const resetState = () => {
    state.active = false
    state.lastFrameOrdinal = null
    state.lastRelativeOrdinal = null
    state.lastUrl = null
    state.lastDomPath = null
    if (state.button) {
      state.button.classList.remove('inspector-active')
      state.button.removeAttribute('aria-pressed')
      state.button = null
    }
  }

  const handleToggleClick = (event) => {
    const button = event.target.closest('button')
    if (!button) {
      return
    }
    const isTrigger = (
      button.id === 'inspector' ||
      button.hasAttribute('data-pinokio-inspector') ||
      button.classList.contains('pinokio-inspector-button') ||
      (button.dataset && button.dataset.tippyContent === 'Switch to inspect mode')
    )
    if (!isTrigger) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (state.active) {
      stopInspector()
    } else {
      startInspector(button)
    }
  }

  const handleInspectorMessage = (event) => {
    const data = event && event.data && event.data.pinokioInspector
    if (!data) {
      return
    }

    const frameUrl = typeof data.frameUrl === 'string' ? data.frameUrl : state.lastUrl

    if (data.type === 'started') {
      showOverlay('Inspect mode enabled – hover items and click to capture.', frameUrl || '', null)
      return
    }

    if (data.type === 'update') {
      const label = data.nodeName ? `<${String(data.nodeName).toLowerCase()}>` : ''
      if (Array.isArray(data.pathKeys) && data.pathKeys.length) {
        state.lastDomPath = data.pathKeys.join(' > ')
      }
      showOverlay(label ? `Hovering ${label}` : 'Inspect mode enabled – hover items and click to capture.', frameUrl || '', null)
      return
    }

    if (data.type === 'complete') {
      const html = typeof data.outerHTML === 'string' ? data.outerHTML : ''
      const screenshot = typeof data.screenshot === 'string' ? data.screenshot : null
      if (Array.isArray(data.pathKeys) && data.pathKeys.length) {
        state.lastDomPath = data.pathKeys.join(' > ')
      }
      showOverlay('Element captured. Inspect again or close.', frameUrl || '', html, screenshot)
      state.closing = true
      window.electronAPI.stopInspector().catch(() => {}).finally(() => {
        state.closing = false
      })
      resetState()
      return
    }

    if (data.type === 'cancelled') {
      window.electronAPI.stopInspector().catch(() => {})
      resetState()
      hideOverlay()
      return
    }

    if (data.type === 'error') {
      const message = data.message || 'Failed to inspect element.'
      if (Array.isArray(data.pathKeys) && data.pathKeys.length) {
        state.lastDomPath = data.pathKeys.join(' > ')
      }
      showOverlay(message, frameUrl || '', null)
      window.electronAPI.stopInspector().catch(() => {})
      resetState()
      return
    }
  }

  ipcRenderer.on('pinokio:inspector-cancelled', () => {
    if (state.closing) {
      state.closing = false
      return
    }
    resetState()
    hideOverlay()
  })

  ipcRenderer.on('pinokio:inspector-error', (_event, payload) => {
    const message = payload && payload.message ? payload.message : 'Inspect mode ended.'
    hideOverlay()
    showOverlay(message, payload && payload.frameUrl ? payload.frameUrl : '', null)
    resetState()
  })

  ipcRenderer.on('pinokio:inspector-started', (_event, payload) => {
    const url = payload && payload.frameUrl ? payload.frameUrl : state.lastUrl
    showOverlay('Inspect mode enabled – hover items and click to capture.', url || '', null)
  })

  ipcRenderer.on('pinokio:capture-debug-log', (_event, payload) => {
    try {
      const serialized = JSON.stringify(payload)
      console.log('[Pinokio Capture]', serialized)
    } catch (error) {
      console.log('[Pinokio Capture]', payload)
    }
  })

  const logCaptureEvent = (label, payload) => {
    try {
      console.log('[Pinokio Capture]', JSON.stringify({ label, payload }))
    } catch (error) {
      console.log('[Pinokio Capture]', label)
    }
  }

  const processScreenshotRequest = async (screenshotRequest, messageId, source) => {
    logCaptureEvent('renderer-process-start', {
      messageId,
      relayStage: screenshotRequest && screenshotRequest.__pinokioRelayStage,
      relayComplete: screenshotRequest && screenshotRequest.__pinokioRelayComplete,
      adjustedFlag: screenshotRequest && screenshotRequest.__pinokioAdjusted,
      bounds: screenshotRequest && screenshotRequest.bounds ? screenshotRequest.bounds : null
    })
    try {
      const screenshot = await window.electronAPI.captureScreenshot(screenshotRequest)

      source.postMessage({
        pinokioScreenshotResponse: true,
        messageId: messageId,
        success: true,
        screenshot: screenshot
      }, '*')
    } catch (error) {
      console.error('Screenshot capture failed:', error)

      source.postMessage({
        pinokioScreenshotResponse: true,
        messageId,
        success: false,
        error: error.message || 'Screenshot failed'
      }, '*')
    }
  }

  // Handle screenshot requests from iframes  
  const handleScreenshotMessage = async (event) => {
    if (event.data && event.data.pinokioScreenshotRequest) {
      if (window !== window.top) {
        logCaptureEvent('renderer-ignored-non-top', {
          currentHref: window.location.href
        })
        return
      }
      const screenshotRequest = event.data.pinokioScreenshotRequest
      const messageId = event.data.messageId
      const source = event.source

      logCaptureEvent('renderer-message-received', {
        messageId,
        relayStage: screenshotRequest.__pinokioRelayStage,
        relayComplete: screenshotRequest.__pinokioRelayComplete,
        adjustedFlag: screenshotRequest.__pinokioAdjusted,
        bounds: screenshotRequest && screenshotRequest.bounds ? screenshotRequest.bounds : null
      })
      logCaptureEvent('renderer-skip-delegated', {
        messageId
      })
      return
    }
  }

  window.addEventListener('message', handleInspectorMessage)
  window.addEventListener('message', handleScreenshotMessage)
  window.addEventListener('message', (event) => {
    if (!event || !event.data || event.source === window) {
      return
    }
    if (event.data.e !== 'pinokio-start-inspector') {
      return
    }

    try {
      console.log('[Inspector] start-request ' + JSON.stringify({
        url: event.data.frameUrl || null,
        name: event.data.frameName || null,
        nodeId: event.data.frameNodeId || null,
        active: state.active,
      }))
    } catch (_) {}

    const payload = {}
    if (typeof event.data.frameUrl === 'string' && event.data.frameUrl.trim()) {
      payload.frameUrl = event.data.frameUrl.trim()
    }
    if (typeof event.data.frameName === 'string' && event.data.frameName.trim()) {
      payload.frameName = event.data.frameName.trim()
    }
    if (typeof event.data.frameNodeId === 'string' && event.data.frameNodeId.trim()) {
      payload.frameNodeId = event.data.frameNodeId.trim()
    }

    if (!payload.frameUrl && !payload.frameName && !payload.frameNodeId) {
      return
    }

    if (state.active) {
      try {
        console.log('[Inspector] stopping-current-before-start')
      } catch (_) {}
      stopInspector()
    }

    hideOverlay()

    state.active = true
    state.button = null
    state.lastFrameOrdinal = null
    state.lastRelativeOrdinal = null
    state.lastUrl = payload.frameUrl || null
    state.lastDomPath = null

    showOverlay('Inspect mode enabled – hover items and click to capture.', payload.frameUrl || '', null)

    window.electronAPI.startInspector(payload).then(() => {
      try {
        console.log('[Inspector] ipc-start-success ' + JSON.stringify(payload))
      } catch (_) {}
    }).catch((error) => {
      const message = error && error.message ? error.message : 'Unable to start inspect mode.'
      showOverlay(message, payload.frameUrl || '', null)
      try {
        console.log('[Inspector] ipc-start-error ' + JSON.stringify({ message }))
      } catch (_) {}
      resetState()
    })
  })
  document.addEventListener('click', handleToggleClick, true)
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.active) {
      stopInspector()
    }
  })
})()
