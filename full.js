const {app, screen, shell, BrowserWindow, BrowserView, ipcMain, dialog, clipboard, session } = require('electron')
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
let PORT
//let PORT = 42000
//let PORT = (platform === 'linux' ? 42000 : 80)

let config = require('./config')

const filter = function (item) {
  return item.browserName === 'Chrome';
};

const updater = new Updater()
const pinokiod = new Pinokiod(config)
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
    theme = pinokiod.theme
    colors = pinokiod.colors
    let win = webContents.getOwnerBrowserWindow()
    if (win && win.setTitleBarOverlay && typeof win.setTitleBarOverlay === "function") {
      const overlay = titleBarOverlay(colors)
      win.setTitleBarOverlay(overlay)
    }
    launched = true

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
      webSecurity: false,
      nativeWindowOpen: true,
      contextIsolation: false,
      nodeIntegrationInSubFrames: true,
      preload: path.join(__dirname, 'preload.js')
    },
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
      webSecurity: false,
      nativeWindowOpen: true,
      contextIsolation: false,
      nodeIntegrationInSubFrames: true,
      preload: path.join(__dirname, 'preload.js')
    },
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
    let url = argv.pop()
    //let u = new URL(url).search
    let u = url.replace(/pinokio:[\/]+/, "")
    loadNewWindow(`${root_url}/pinokio/${u}`, PORT)
//    if (BrowserWindow.getAllWindows().length === 0 || !mainWindow) createWindow(PORT)
//    mainWindow.focus()
//    mainWindow.loadURL(`${root_url}/pinokio/${u}`)
  })

  // Create mainWindow, load the rest of the app, etc...
  app.whenReady().then(async () => {

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
      browser: {
        clearCache: async () => {
          console.log('clear cache', session.defaultSession)
          await session.defaultSession.clearStorageData()
          console.log("cleared")
        }
      }
    })
    PORT = pinokiod.port

    theme = pinokiod.theme
    colors = pinokiod.colors


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
        if (win.setTitleBarOverlay) {
          const overlay = titleBarOverlay(colors)
          try {
            win.setTitleBarOverlay(overlay)
          } catch (e) {
  //          console.log("ERROR", e)
          }
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
        if (win.setTitleBarOverlay) {
          const overlay = titleBarOverlay(colors)
          win.setTitleBarOverlay(overlay)
        }
      } catch (e) {
  //      console.log("E2", e)
      }
    }
    createWindow(PORT)
    updater.run(mainWindow)
  })

}
