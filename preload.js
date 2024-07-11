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
  }
}
