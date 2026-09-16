const safeReadFrameField = (frame, field) => {
  if (!frame) {
    return undefined
  }
  try {
    return frame[field]
  } catch (_) {
    return undefined
  }
}

const isRootShellUrl = (value, rootUrl) => {
  if (!value || !rootUrl) {
    return false
  }
  try {
    const root = new URL(rootUrl)
    const target = new URL(value, root)
    return target.origin === root.origin && target.pathname === root.pathname
  } catch (_) {
    return false
  }
}

const isApplicationContainerFrame = ({ frame, mainFrame, currentUrl, rootUrl } = {}) => {
  const parentFrame = safeReadFrameField(frame, 'parent')
  const grandparentFrame = safeReadFrameField(parentFrame, 'parent')
  return Boolean(
    frame &&
    mainFrame &&
    parentFrame &&
    !grandparentFrame &&
    parentFrame === mainFrame &&
    isRootShellUrl(currentUrl, rootUrl)
  )
}

const handleFrameNavigation = ({ event, webContents, rootUrl, openExternalNavigation } = {}) => {
  if (!event || !webContents || typeof openExternalNavigation !== 'function') {
    return false
  }
  const frame = event.frame
  let currentUrl = ''
  try {
    currentUrl = webContents.getURL()
  } catch (_) {
  }
  if (!isApplicationContainerFrame({
    frame,
    mainFrame: webContents.mainFrame,
    currentUrl,
    rootUrl
  })) {
    return false
  }
  return Boolean(openExternalNavigation({
    event,
    frame,
    url: event.url,
    baseUrl: safeReadFrameField(frame, 'url') || currentUrl
  }))
}

module.exports = {
  handleFrameNavigation,
  isApplicationContainerFrame,
  isRootShellUrl
}
