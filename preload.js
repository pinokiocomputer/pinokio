// put this preload for main-window to give it prompt()
const { ipcRenderer, } = require('electron')
window.prompt = function(title, val){
  return ipcRenderer.sendSync('prompt', {title, val})
}
const sendPinokio = (action) => {
  console.log("window.parent == window.top?", window.parent === window.top, action, location.href)
  if (window.parent === window.top) {
    window.parent.postMessage({
      action
    }, "*")
  }
}


// ONLY WHEN IN CHILD FRAME
if (window.parent === window.top) {
  if (window.location !== window.parent.location) {
    let prevUrl = document.location.href
    sendPinokio({
      type: "location",
      url: prevUrl
    })
    setInterval(() => {
      const currUrl = document.location.href;
  //    console.log({ currUrl, prevUrl })
      if (currUrl != prevUrl) {
        // URL changed
        prevUrl = currUrl;
        console.log(`URL changed to : ${currUrl}`);
        sendPinokio({
          type: "location",
          url: currUrl
        })
      }
    }, 100);
    window.addEventListener("message", (event) => {
      if (event.data) {
        console.log("event.data = ", event.data)
        console.log("location.href = ", location.href)
        if (event.data.action === "back") {
          history.back()
        } else if (event.data.action === "forward") {
          history.forward()
        } else if (event.data.action === "refresh") {
          location.reload()
        }
      }
    })
  }
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
  startInspector: (payload) => ipcRenderer.invoke('pinokio:start-inspector', payload || {}),
  stopInspector: () => ipcRenderer.invoke('pinokio:stop-inspector'),
}

;(function initInspector() {
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
      zIndex: '2147483638',
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
    })
    htmlBlock.spellcheck = false


    const footer = document.createElement('div')
    Object.assign(footer.style, {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '8px',
    })

    const copyButton = document.createElement('button')
    copyButton.dataset.role = 'copy'
    copyButton.type = 'button'
    copyButton.textContent = 'Copy snippet'
    Object.assign(copyButton.style, {
      display: 'none',
      background: 'rgba(255,255,255,0.18)',
      border: 'none',
      borderRadius: '6px',
      padding: '4px 10px',
      fontSize: '11px',
      cursor: 'pointer',
      color: '#10131a',
      fontWeight: '600',
    })

    footer.append(copyButton)

    container.append(header, status, urlRow, htmlBlock, footer)
    document.body.appendChild(container)

    const overlay = {
      container,
      status,
      urlRow,
      htmlBlock,
      copyButton,
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

    state.overlay = overlay
    return overlay
  }

  const showOverlay = (message, frameUrl, html) => {
    const overlay = ensureOverlay()
    overlay.container.style.display = 'flex'
    overlay.status.textContent = message || ''
    overlay.urlRow.textContent = frameUrl ? `Page: ${frameUrl}` : ''
    state.displayUrl = frameUrl || null
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
      overlay.htmlBlock.style.display = 'block'
      overlay.htmlBlock.value = lines.join('\n')
      overlay.copyButton.style.display = 'inline-flex'
      overlay.copyButton.textContent = 'Copy snippet'
    } else {
      overlay.htmlBlock.style.display = 'none'
      overlay.htmlBlock.value = ''
      overlay.copyButton.style.display = 'none'
    }
  }

  const hideOverlay = () => {
    const overlay = state.overlay
    if (overlay && overlay.container) {
      overlay.container.style.display = 'none'
      overlay.status.textContent = ''
      overlay.urlRow.textContent = ''
      overlay.htmlBlock.value = ''
      overlay.htmlBlock.style.display = 'none'
      overlay.copyButton.style.display = 'none'
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
      if (Array.isArray(data.pathKeys) && data.pathKeys.length) {
        state.lastDomPath = data.pathKeys.join(' > ')
      }
      showOverlay('Element captured. Inspect again or close.', frameUrl || '', html)
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

  window.addEventListener('message', handleInspectorMessage)
  document.addEventListener('click', handleToggleClick, true)
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.active) {
      stopInspector()
    }
  })
})()
