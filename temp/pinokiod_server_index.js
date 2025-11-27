const express = require('express');
const querystring = require("querystring");
const diff = require('diff')
const kill = require('kill-sync')
const { isBinaryFile } = require("isbinaryfile");
const { glob, sync, hasMagic } = require('glob-gitignore')
const portfinder = require('portfinder-cp');
const proxy = require('express-http-proxy-cp');
const sudo = require("sudo-prompt-programfiles-x86");
const compressing = require('compressing');
const { rimraf } = require('rimraf')
const { createHttpTerminator } = require('http-terminator')
const cookieParser = require('cookie-parser');
const session = require('express-session');
const mime = require('mime-types')
const httpserver = require('http');
const cors = require('cors');
const path = require("path")
const fs = require('fs');
const os = require('os')
const { fork, exec } = require('child_process');
const semver = require('semver')
const fse = require('fs-extra')
const QRCode = require('qrcode')
const axios = require('axios')
const crypto = require('crypto')
const system = require('systeminformation')
const serveIndex = require('./serveIndex')
const registerFileRoutes = require('./routes/files')
const Git = require("../kernel/git")
const TerminalApi = require('../kernel/api/terminal')

const git = require('isomorphic-git')
const http = require('isomorphic-git/http/node')
const marked = require('marked')
const multer = require('multer');
const ini = require('ini')
//const localtunnel = require('localtunnel');
//const ngrok = require("@ngrok/ngrok");

const ejs = require('ejs');

const DEFAULT_PORT = 42000
const NOTIFICATION_SOUND_EXTENSIONS = new Set(['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.wav', '.webm'])
const LOG_STREAM_INITIAL_BYTES = 512 * 1024
const LOG_STREAM_KEEPALIVE_MS = 25000

const ex = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};




const Socket = require('./socket')
const Kernel = require("../kernel")
const packagejson = require("../package.json")
const Environment = require("../kernel/environment")
const Cloudflare = require("../kernel/api/cloudflare")
const Util = require("../kernel/util")
const Info = require("../kernel/info")

const Setup = require("../kernel/bin/setup")

    function normalize(str) {
      if (!str) return '';
      return (str.endsWith('\n') ? str : str + '\n').replace(/\r\n/g, '\n');
    }

    this.gitEnv = (repoPath) => {
      const gitBin = this.kernel.bin && this.kernel.bin.git ? this.kernel.bin.git : null
      if (gitBin && typeof gitBin.env === 'function') {
        const env = gitBin.env(repoPath)
        if (this.kernel.git && typeof this.kernel.git.clearStaleLock === "function" && repoPath) {
          this.kernel.git.clearStaleLock(repoPath).catch(() => {})
        }
        return env
      }
      return {}
    }

class Server {
  constructor(config) {
    this.tabs = {}
    this.agent = config.agent
    this.port = DEFAULT_PORT
//    this.port = config.port
    this.kernel = new Kernel(config.store)
//    this.tunnels = {}
    this.version = {
      pinokiod: packagejson.version,
      pinokio: config.version
    }

    this.newsfeed = config.newsfeed
    this.profile = config.profile
    this.discover_dark = config.discover_dark
    this.discover_light = config.discover_light
    this.site = config.site
    this.portal = config.portal
    this.install = config.install
    this.kernel.version = this.version
    this.upload = multer();
    this.cf = new Cloudflare()
    this.virtualEnvCache = new Map()
    this.gitStatusIgnorePatterns = [
      /(^|\/)node_modules\//,
//      /(^|\/)vendor\//,
      /(^|\/)__pycache__\//,
//      /(^|\/)build\//,
//      /(^|\/)dist\//,
//      /(^|\/)tmp\//,
      /(^|\/)\.cache\//,
      /(^|\/)\.ruff_cache\//,
      /(^|\/)\.tox\//,
      /(^|\/)\.terraform\//,
      /(^|\/)\.parcel-cache\//,
      /(^|\/)\.webpack\//,
      /(^|\/)\.mypy_cache\//,
      /(^|\/)\.pytest_cache\//,
      /(^|\/)\.git\//
    ]

    // sometimes the C:\Windows\System32 is not in PATH, need to add
    let platform = os.platform()
    if (platform === 'win32') {
      let PATH_KEY;
      if (process.env.Path) {
        PATH_KEY = "Path"
      } else if (process.env.PATH) {
        PATH_KEY = "PATH"
      }
      process.env[PATH_KEY] = [
        "C:\\Windows\\System32",
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
        process.env[PATH_KEY]
      ].join(path.delimiter)
    }
    if (platform === "linux") {
      process.env.WEBKIT_DISABLE_DMABUF_RENDERER = 1
    }

      
//    process.env.CONDA_LIBMAMBA_SOLVER_DEBUG_LIBSOLV = 1
    this.installFatalHandlers()
  }
  installFatalHandlers() {
    if (this.fatalHandlersInstalled) {
      return
    }
    const normalizeError = (value, origin) => {
      if (value instanceof Error) {
        return value
      }
      if (value && typeof value === 'object') {
        try {
          return new Error(`${origin || 'error'}: ${JSON.stringify(value)}`)
        } catch (_) {
          return new Error(String(value))
        }
      }
      if (typeof value === 'string') {
        return new Error(value)
      }
      return new Error(`${origin || 'error'}: ${String(value)}`)
    }
    const invoke = (value, origin) => {
      const error = normalizeError(value, origin)
      try {
        const maybePromise = this.handleFatalError(error, origin)
        if (maybePromise && typeof maybePromise.catch === 'function') {
          maybePromise.catch((fatalErr) => {
            console.error('Fatal handler rejection:', fatalErr)
            try {
              process.exit(1)
            } catch (_) {
              // ignore
            }
          })
        }
      } catch (fatalErr) {
        console.error('Fatal handler threw:', fatalErr)
        try {
          process.exit(1)
        } catch (_) {
          // ignore
        }
      }
    }
    process.on('uncaughtException', (error) => invoke(error, 'uncaughtException'))
    process.on('unhandledRejection', (reason) => invoke(reason, 'unhandledRejection'))
    this.fatalHandlersInstalled = true
  }

  async ensureGitconfigDefaults(home) {
    if (!this.kernel.git) {
      this.kernel.git = new Git(this.kernel)
    }
    await this.kernel.git.ensureDefaults(home)
  }
  async handleFatalError(error, origin) {
    if (this.handlingFatalError) {
      console.error(`[Pinokiod] Additional fatal (${origin})`, (error && error.stack) ? error.stack : error)
      return
    }
    this.handlingFatalError = true
    const timestamp = Date.now()
    const message = (error && error.message) ? error.message : 'Unexpected fatal error'
    const stack = (error && error.stack) ? error.stack : String(error || 'Unknown fatal error')
    console.error(`[Pinokiod] Fatal (${origin})`, stack)
    const fallbackHome = path.resolve(os.homedir(), 'pinokio')
    const homeDir = (this.kernel && this.kernel.homedir) ? this.kernel.homedir : fallbackHome
    const fatalFile = path.resolve(homeDir, 'logs', 'fatal.json')
    const payload = {
      id: `fatal-${timestamp}`,
      type: 'kernel.fatal',
      severity: 'fatal',
      title: 'Pinokio crashed',
      message,
      stack,
      origin,
      timestamp,
      version: this.version,
      pid: process.pid,
      logPath: fatalFile,
    }
    try {
      await fs.promises.mkdir(path.dirname(fatalFile), { recursive: true })
      await fs.promises.writeFile(fatalFile, JSON.stringify(payload, null, 2))
    } catch (err) {
      console.error('Failed to persist fatal error details:', err)
    }
    try {
      if (typeof Util.emitPushEvent === 'function') {
        Util.emitPushEvent(payload)
      } else {
        Util.push({ title: 'Pinokio crashed', message })
      }
    } catch (err) {
      console.error('Failed to emit fatal notification:', err)
    }
  }
  stop() {
    this.server.close()
  }
  killProcessTree(pid, label) {
    const numericPid = typeof pid === 'string' ? parseInt(pid, 10) : pid
    if (!Number.isInteger(numericPid) || numericPid <= 0) {
      return
    }
    if (label) {
      console.log(label, numericPid)
    }
    try {
      kill(numericPid, 'SIGKILL', true)
    } catch (error) {
      if (error && error.code === 'ESRCH') {
        return
      }
      console.error(`Failed to kill pid ${numericPid}`, error)
    }
  }
  killTrackedProcesses() {
    if (this.kernel && this.kernel.processes && this.kernel.processes.map) {
      for (const [pid, name] of Object.entries(this.kernel.processes.map)) {
        if (parseInt(pid, 10) === process.pid) {
          continue
        }
        this.killProcessTree(pid, `kill child ${name}`)
      }
    }
  }
  shutdown(signalLabel) {
    const label = signalLabel || 'Shutdown'
    console.log(`[${label} event] Kill`, process.pid)
    if (this.kernel && this.kernel.shell) {
      try {
        this.kernel.shell.reset()
      } catch (error) {
        console.error('Failed to reset shells', error)
      }
    }
//    this.killTrackedProcesses()
    if (this.kernel && this.kernel.processes && this.kernel.processes.caddy_pid) {
      this.killProcessTree(this.kernel.processes.caddy_pid, 'kill caddy')
    }
    this.killProcessTree(process.pid, 'kill self')
  }
  exists (s) {
    return new Promise(r=>fs.access(s, fs.constants.F_OK, e => r(!e)))
  }
  running_dynamic (name, menu, selected_query) {
    let cwd = this.kernel.path("api", name)
    const projectSlug = typeof name === 'string' ? name : ''
    const assignProjectSlug = (entry) => {
      if (!entry || !projectSlug) {
        return
      }
      entry.project_slug = projectSlug
    }
    let running_dynamic = []
    const traverse = (obj, indexPath) => {
      if (Array.isArray(obj)) {
        for(let i=0; i<obj.length; i++) {
          let item = obj[i]
          let newIndexPath
          if (indexPath) {
            newIndexPath = indexPath + "." + i
          } else {
            newIndexPath = "" + i
          }
          traverse(item, newIndexPath);
        }
      } else if (obj !== null && typeof obj === 'object') {
        for (const key in obj) {
          if (key === 'href') {
            let href = obj[key]
            if (href.startsWith("/api")) {
              let uri_path = new URL("http://localhost" + href).pathname
              let filepath = this.kernel.path(...uri_path.split("/"))

              let id = `${filepath}?cwd=${cwd}`
              //if (this.kernel.api.running[filepath]) {
              if (this.kernel.api.running[id] || selected_query.plugin === obj.src) {
                obj.running = true
                obj.display = "indent"
                if (selected_query.plugin === obj.src) {
                  obj.default = true
                  for(let key in selected_query) {
                    if (key !== "plugin") {
                      obj.href = obj.href + "&" + key + "=" + encodeURIComponent(selected_query[key])
                    }
                  }
                }
                assignProjectSlug(obj)
                running_dynamic.push(obj)
              }
            } else if (href.startsWith("/run")) {
              let uri_path = new URL("http://localhost" + href).pathname
              let _filepath = uri_path.split("/").filter(x=>x).slice(1)
              let filepath = this.kernel.path(..._filepath)
              let id = `${filepath}?cwd=${cwd}`
              obj.script_id = id
              //if (this.kernel.api.running[filepath]) {
              if (obj.src.startsWith("/run" + selected_query.plugin)) {
                obj.running = true
                obj.display = "indent"
                obj.default = true
                for(let key in selected_query) {
                  if (key !== "plugin") {
                    obj.href = obj.href + "&" + key + "=" + encodeURIComponent(selected_query[key])
                  }
                }
                assignProjectSlug(obj)
                running_dynamic.push(obj)
              } else {
                const normalizedFilepath = path.normalize(filepath)
                const hasMenuCwd = typeof cwd === 'string'
                const normalizedMenuCwd = hasMenuCwd ? (cwd.length === 0 ? '' : path.normalize(cwd)) : null
                const matchesRunningEntry = (runningKey) => {
                  if (typeof runningKey !== 'string' || runningKey.length === 0) {
                    return false
                  }
                  const questionIndex = runningKey.indexOf('?')
                  const runningPath = questionIndex >= 0 ? runningKey.slice(0, questionIndex) : runningKey
                  if (path.normalize(runningPath) !== normalizedFilepath) {
                    return false
                  }
                  if (!hasMenuCwd) {
                    return questionIndex === -1
                  }
                  if (questionIndex === -1) {
                    return normalizedMenuCwd === ''
                  }
                  const params = querystring.parse(runningKey.slice(questionIndex + 1))
                  const rawCwd = typeof params.cwd === 'string' ? params.cwd : null
                  if (normalizedMenuCwd === '') {
                    return rawCwd !== null && rawCwd.length === 0
                  }
                  if (!rawCwd || rawCwd.length === 0) {
                    return false
                  }
                  try {
                    return path.normalize(rawCwd) === normalizedMenuCwd
                  } catch (_) {
                    return false
                  }
                }
                for(let running_id in this.kernel.api.running) {
                  if (matchesRunningEntry(running_id)) {
                    let obj2 = structuredClone(obj)
                    obj2.running = true
                    obj2.display = "indent"

                    const query = running_id.split("?")[1];
                    const params = query ? querystring.parse(query) : {};

                    let queryStrippedHref = obj2.href.split("?")[0]
                    if (params && Object.keys(params).length > 0) {
                    obj2.href = queryStrippedHref + "?" + querystring.stringify(params)
                  } else {
                    obj2.href = queryStrippedHref
                  }

                  obj2.script_id = running_id
                  obj2.target = "@" + obj2.href
                  obj2.target_full = obj2.href

                  assignProjectSlug(obj2)
                  running_dynamic.push(obj2)
                  }
                }
              }
            }
          } else if (key === "shell") {
            const appendSession = (value, session) => {
              if (!value || !session) {
                return value
              }
              const hasPrefix = value.startsWith("@")
              const raw = hasPrefix ? value.slice(1) : value
              const [pathPart, queryPart] = raw.split("?")
              const parsed = queryPart ? querystring.parse(queryPart) : {}
              parsed.session = session
              const qs = querystring.stringify(parsed)
              const combined = qs ? `${pathPart}?${qs}` : pathPart
              return hasPrefix ? `@${combined}` : combined
            }

            let unix_path = Util.p2u(this.kernel.path("api", name))
            let shell_id = this.get_shell_id(unix_path, indexPath, obj[key])
            let decoded_shell_id = decodeURIComponent(shell_id)
            let id = "shell/" + decoded_shell_id

            const originalHref = obj.href
            const originalTarget = obj.target

            const activeShells = (this.kernel.shell && Array.isArray(this.kernel.shell.shells))
              ? this.kernel.shell.shells.filter((entry) => {
                  if (!entry || !entry.id) {
                    return false
                  }
                  return entry.id === id || entry.id.startsWith(`${id}?session=`)
                })
              : []

            if (activeShells.length > 0 || selected_query.plugin === id) {
              obj.running = true
              obj.display = "indent"
              if (selected_query.plugin === id) {
                obj.default = true
                for(let key in selected_query) {
                  if (key !== "plugin") {
                    obj.href = obj.href + "&" + key + "=" + encodeURIComponent(selected_query[key])
                  }
                }
              }

              if (activeShells.length === 0) {
                assignProjectSlug(obj)
                running_dynamic.push(obj)
              } else {
                activeShells.forEach((shellEntry) => {
                  const clone = structuredClone(obj)
                  clone.running = true
                  clone.display = "indent"
                  clone.shell_id = shellEntry.id
                  const sessionMatch = /[?&]session=([^&]+)/.exec(shellEntry.id)
                  if (sessionMatch && sessionMatch[1]) {
                    const sessionValue = sessionMatch[1]
                    clone.href = appendSession(originalHref, sessionValue)
                    const baseTarget = originalTarget || `@${originalHref}`
                    clone.target = appendSession(baseTarget, sessionValue)
                    clone.target_full = clone.href
                  } else {
                    clone.href = originalHref
                    clone.target = originalTarget ? originalTarget : `@${clone.href}`
                    clone.target_full = clone.href
                  }
                  assignProjectSlug(clone)
                  running_dynamic.push(clone)
                })
              }
            }
          }
          traverse(obj[key], indexPath);
        }
      }
    }
    traverse(menu)
    return running_dynamic
  }
  getMemory(filepath) {
    let localMem = this.kernel.memory.local[filepath]
    let globalMem = this.kernel.memory.global[filepath]

    let mem = []
    let localhosts = ["localhost", "127.0.0.1", "0.0.0.0"]
    for(let key in localMem) {
      let val = localMem[key]
      // check for localhost url
//      let localhost = false
//      let tunnel
//      try {
//        let url = new URL(val)
//        if (localhosts.includes(url.hostname)) {
//          localhost = true
//          if (this.tunnels[val]) {
//            tunnel = this.tunnels[val].url()
//            //tunnel = this.tunnels[val].url
//          }
//        }
//      } catch (e) { }
      mem.push({
        type: "local",
        key,
        val,
//        tunnel,
//        localhost,
      })
    }
    return mem
  }
  getItems(items, meta, p) {
    return items.map((x) => {
      let name
      let description
      let icon = "/pinokio-black.png"
      let uri
      let iconpath
      let apipath
      if (meta) {
        let m = meta[x.name]
        name = (m && m.title ? m.title : x.name)
        description = (m && m.description ? m.description : "")
        if (m && m.icon) {
          icon = m.icon
        } else {
          icon = "/pinokio-black.png"
          //icon = null
        }
        if (m && m.iconpath) {
          iconpath = m.iconpath
        }
        if (m && m.path) {
          apipath = m.path
        }
        uri = x.name
      } else {
        if (x.isDirectory()) {
          icon = "fa-solid fa-folder"
        } else {
          icon = "fa-regular fa-file"
        }
        name = x.name
        description = ""
      }


      let browser_url 
      let target

      if (x.run) {
        browser_url = "/env/api/" + x.name
      } else {
        //browser_url = "/pinokio/browser/" + x.name
        browser_url = "/p/" + x.name
      }
      let view_url = "/v/" + x.name
      let dev_url = browser_url + "/dev"
      let review_url = browser_url + "/review"
      let files_url = "/asset/api/" + x.name

      let dns = this.kernel.pinokio_configs[x.name].dns
      let routes = dns["@"]
      return {
        filepath: this.kernel.path("api", x.name),
        icon,
        iconpath,
        path: apipath,
        running: x.running ? true : false,
        run: x.run,
        menu: x.menu,
        shortcuts: x.shortcuts,
        index: x.index,
        running_scripts: x.running_scripts,
        //icon: (x.isDirectory() ? "fa-solid fa-folder" : "fa-regular fa-file"),
        name,
        uri,
        //description: x.path,
        description,
        url: p + "/" + x.name,
        browser_url,
        target,
        url: browser_url,
        path: uri,
        dev_url,
        view_url,
        review_url,
        files_url,
      }
    })
  }
  async processMenu(name, config) {
    let cfg = config
    if (cfg) {
      if (cfg.menu) {
        if (typeof cfg.menu === "function") {
          if (cfg.menu.constructor.name === "AsyncFunction") {
            cfg.menu = await cfg.menu(this.kernel, this.kernel.info)
          } else {
            cfg.menu = cfg.menu(this.kernel, this.kernel.info)
          }
        }
      } else {
        cfg = await this.renderIndex(name, cfg)
      }
    } else {
      cfg = await this.renderIndex(name, cfg)
    }
    return cfg
  }
  async renderIndex(name, cfg) {
    let p = this.kernel.path("api", name)
    let index_path = path.resolve(p, "index.html")
    let index_exists = await this.kernel.exists(index_path)
    let c = cfg
    let menu = []
    if (cfg.menu) {
      ({ menu, ...c } = cfg)
    }
    if (index_exists) {
      return Object.assign({
        title: name, 
        menu: [{
          default: true,
          icon: "fa-solid fa-link",
          text: "index.html",
          href: `/asset/api/${name}/index.html`,
        }].concat(menu)
      }, c)
    } else {
      return Object.assign({
        title: name, 
        menu: [{
          default: true,
          icon: "fa-solid fa-link",
          text: "Project Files",
          href: `/files/api/${name}`,
        }].concat(menu)
      }, c)
    }
  }
  async getGit(ref, filepath) {
    const dir = this.kernel.path("api", filepath)

    const gitDirPath = path.join(dir, '.git')
    let gitDirExists = false
    try {
      const gitStats = await fs.promises.stat(gitDirPath)
      gitDirExists = gitStats.isDirectory()
    } catch (_) {
      gitDirExists = false
    }

    let hasHead = false
    if (gitDirExists) {
      try {
        await git.resolveRef({ fs, dir, ref: 'HEAD' })
        hasHead = true
      } catch (_) {
        hasHead = false
      }
    }

    let branchList = []
    try {
      branchList = await git.listBranches({ fs, dir })
    } catch (_) {}

    const collectLog = async (targetRef) => {
      const entries = await git.log({ fs, dir, depth: 50, ref: targetRef })
      entries.forEach((item) => {
        item.info = `/gitcommit/${item.oid}/${filepath}`
      })
      return entries
    }

    let log = []
    let logError = null
    if (ref) {
      try {
        log = await collectLog(ref)
      } catch (error) {
        logError = error
      }
    }
    if (log.length === 0) {
      try {
        log = await collectLog('HEAD')
      } catch (error) {
        if (!logError) {
          logError = error
        }
      }
    }

    let currentBranch = null
    let isDetached = false
    try {
      currentBranch = await git.currentBranch({ fs, dir, fullname: false })
    } catch (_) {}
    if (!currentBranch) {
      isDetached = true
    }

    let branches = []
    if (branchList.length > 0) {
      branches = branchList.map((name) => ({
        branch: name,
        selected: currentBranch ? name === currentBranch : false
      }))
      if (!currentBranch && log.length > 0) {
        const headOid = log[0].oid
        branches = [{ branch: headOid, selected: true }, ...branches.map((entry) => ({ ...entry, selected: false }))]
        currentBranch = headOid
      }
    } else {
      if (currentBranch) {
        branches = [{ branch: currentBranch, selected: true }]
      } else if (log.length > 0) {
        const headOid = log[0].oid
        branches = [{ branch: headOid, selected: true }]
        currentBranch = headOid
      }
    }

    if (!currentBranch && log.length > 0) {
      currentBranch = log[0].oid
    }

    if (branches.length === 0) {
      branches = [{ branch: currentBranch || 'HEAD', selected: true }]
    }

    const config = await this.kernel.git.config(dir)

    let hosts = ""
    const hostsFile = this.kernel.path("config/gh/hosts.yml")
    if (await this.exists(hostsFile)) {
      hosts = await fs.promises.readFile(hostsFile, "utf8")
      if (hosts.startsWith("{}")) {
        hosts = ""
      }
    }
    const connected = hosts.length > 0

    let remote = null
    if (config && config["remote \"origin\""]) {
      remote = config["remote \"origin\""].url
    }

    let remotes = []
    try {
      remotes = await git.listRemotes({ fs, dir, verbose: true })
    } catch (_) {}

    if (!currentBranch) {
      currentBranch = 'HEAD'
    }

    return {
      ref,
      config,
      remote,
      remotes,
      connected,
      log,
      branch: currentBranch,
      branches,
      gitDirExists,
      hasHead,
      dir,
      detached: isDetached,
      logError: logError ? String(logError.message || logError) : null
    }
  }
  async init_env(env_dir_path, options) {
    let current = this.kernel.path(env_dir_path, "ENVIRONMENT")
      // if environment.json doesn't exist, 
    let exists = await this.exists(current)
    if (exists) {
      // if ENVIRONMENT already exists, don't do anything
    } else {
      // if ENVIRONMENT doesn't exist, need to create one
      // 1. if _ENVIRONMENT exists, create ENVIRONMENT by appending _ENVIRONMENT to ENVIRONMENT
      // 2. if _ENVIRONMENT doesn't exist, just write ENVIRONMENT
      // if _ENVIRONMENT exists, 
      let _environment = this.kernel.path(env_dir_path, "_ENVIRONMENT")
      let _exists = await this.exists(_environment)
      if (options && options.no_inherit) {
        if (_exists) {
          let _environmentStr = await fs.promises.readFile(_environment, "utf8")
          await fs.promises.writeFile(current, _environmentStr)
        }
      } else {
        let content = await Environment.ENV("app", this.kernel.homedir, this.kernel)
        if (_exists) {
          let _environmentStr = await fs.promises.readFile(_environment, "utf8")
          await fs.promises.writeFile(current, _environmentStr + "\n\n\n" + content)
        } else {
          await fs.promises.writeFile(current, content)
        }
      }
    }
  }
  async get_github_hosts() {
    let hosts = ""
    let hosts_file = this.kernel.path("config/gh/hosts.yml")
    let e = await this.exists(hosts_file)
    if (e) {
      hosts = await fs.promises.readFile(hosts_file, "utf8")
      if (hosts.startsWith("{}")) {
        hosts = ""
      }
    }
    return hosts
  }
  async current_urls(current_path) {
    return {}
//    let router_running = await this.check_router_up()
//    let u = new URL("http://localhost:42000")
//
//    let current_urls = {}
//
//    // http
//    if (current_path) {
//      u.pathname = current_path
//    }
//    current_urls.http = u.toString()
//
//    // https
//    if (router_running.success) {
//      let u = new URL("https://pinokio.localhost")
//      if (current_path) {
//        u.pathname = current_path
//      }
//      current_urls.https = u.toString()
//    }
//
//    return current_urls
  }

  async chrome(req, res, type, options) {

    let d = Date.now()
    let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
      bin: this.kernel.bin.preset("dev"),
    })
    if (!requirements_pending && install_required) {
      res.redirect(`/setup/dev?callback=${req.originalUrl}`)
      return
    }

    if (req.query.autolaunch === "1") {
      let fullpath = path.resolve(this.kernel.homedir, "ENVIRONMENT")
      await Util.update_env(fullpath, {
        PINOKIO_ONDEMAND_AUTOLAUNCH: "1"
      })
    } else if (req.query.autolaunch === "0") {
      let fullpath = path.resolve(this.kernel.homedir, "ENVIRONMENT")
      await Util.update_env(fullpath, {
        PINOKIO_ONDEMAND_AUTOLAUNCH: "0"
      })
    }

    let name = req.params.name
    let config = await this.kernel.api.meta(name)

    let err = null
    if (config && config.version) {
      let coerced = semver.coerce(config.version)
      if (semver.satisfies(coerced, this.kernel.schema)) {
//        console.log("semver satisfied", config.version, this.kernel.schema)
      } else {
        console.log("semver NOT satisfied", config.version, this.kernel.schema)
        err = `Please update to the latest Pinokio (current script version: ${config.version}, supported: ${this.kernel.schema})`
      }
    }

    let uri = this.kernel.path("api")
    try {
      let launcher = await this.kernel.api.launcher(name)
      req.launcher_root = launcher.launcher_root
      config = await this.processMenu(name, config)
    } catch(e) {
      config.menu = []
    }

    await this.renderMenu(req, uri, name, config, [])

    let platform = os.platform()

    await Environment.init({ name }, this.kernel)

  /*
  REPLACED OUT WITH using .git/info/exclude instead in order to not mess with 3rd party project .gitignore files but still exclude
  */
//    // copy gitignore from ~pinokio/prototype/system/gitignore if it doesn't exist
//
//
//    let gitignore_path = this.kernel.path("api/" + name + "/.gitignore")
//    let dot_path = this.kernel.path("api", name, "pinokio")
//    let gitignore_template_path = this.kernel.path("prototype/system/gitignore")
//    let template_exists = await this.exists(gitignore_template_path)
//    if (template_exists) {
//      let exists = await this.exists(dot_path)
//      if (exists) {
//        // 1. when importing existing projects (.pinokio exists), don't mess with .gitignore
//      } else {
//        // 2. otherwise, merge gitignore
//        await Util.mergeLines(
//          gitignore_path, // existing path
//          gitignore_template_path // overwrite with template
//        )
//      }
//    }




    let mode = "run"
    if (req.query && req.query.mode) {
      mode = req.query.mode
    }
    const env = await this.kernel.env("api/" + name)

//    // profile + feed
//    const repositoryPath = path.resolve(this.kernel.api.userdir, name)
//
//    try {
//      await git.resolveRef({ fs, dir: repositoryPath, ref: 'HEAD' });
//    } catch (err) {
//      // repo doesn't exist. initialize.
//      console.log(`repo doesn't exist at ${repositoryPath}. initialize`)
//      await git.init({ fs, dir: repositoryPath });
//    }
//
//    let gitRemote = await git.getConfig({ fs, http, dir: repositoryPath, path: 'remote.origin.url' })
//    let profile
//    let feed
//    if (gitRemote) {
//      gitRemote = gitRemote.replace(/\.git$/i, '')
//
//      let system_env = {}
//      if (this.kernel.homedir) {
//        system_env = await Environment.get(this.kernel.homedir, this.kernel)
//      }
//      profile = this.profile(gitRemote)
//      feed = this.newsfeed(gitRemote)
//    }

    // git

    let c = this.kernel.path("api", name)

//    await this.kernel.plugin.init()
//    let plugin = await this.getPlugin(name)
//    let plugin_menu = null
//    if (plugin && plugin.menu && Array.isArray(plugin.menu)) {
//      let running_dynamic = this.running_dynamic(name, plugin.menu)
//      plugin_menu = plugin.menu.concat(running_dynamic)
//    }


    let current_urls = await this.current_urls(req.originalUrl.slice(1))

    let plugin_menu = null
    let plugin_config = structuredClone(this.kernel.plugin.config)
    let plugin = await this.getPlugin(req, plugin_config, name)
    if (plugin && plugin.menu && Array.isArray(plugin.menu)) {
      plugin = structuredClone(plugin)
      let default_plugin_query
      if (req.query) {
        default_plugin_query = req.query
      }
      plugin_menu = this.running_dynamic(name, plugin.menu, default_plugin_query)
    }

    let posix_path = Util.p2u(this.kernel.path("api", name))
    let dev_link
    if (posix_path.startsWith("/")) {
      dev_link = "/d" + posix_path
    } else {
      dev_link = "/d/" + posix_path
    }

    let autoselect
    let run_tab
    if (type === "run") {
      if (options && options.no_autoselect) {
        run_tab = "/v/" + name
        autoselect = false
      } else {
        run_tab = "/p/" + name
        autoselect = true
      }
    } else {
      run_tab = "/p/" + name
      autoselect = false
    }
    let dev_tab = "/p/" + name + "/dev"
    let review_tab = "/p/" + name + "/review"
    let files_tab = "/p/" + name + "/files"

    let editor_tab = `/pinokio/fileview/${encodeURIComponent(name)}`
    let savedTabs = []
    if (Array.isArray(this.tabs[name])) {
      savedTabs = this.tabs[name].filter((url) => url !== editor_tab)
    }

    let dynamic_url = "/pinokio/dynamic/" + name;
    if (Object.values(req.query).length > 0) {
      let index = 0
      for(let key in req.query) {
        if (index === 0) {
          dynamic_url = dynamic_url + `?${key}=${encodeURIComponent(req.query[key])}`
        } else {
          dynamic_url = dynamic_url + `&${key}=${encodeURIComponent(req.query[key])}`
        }
        index++;
      }
    }

    const result = {
      dev_link,
//      repos,
      current_urls,
      path: this.kernel.path("api", name),
      log_path: this.kernel.path("api", name, "logs"),
      plugin_menu: plugin_menu,
      portal: this.portal,
      install: this.install,
      error: err,
      env,
      mode,
      port: this.port,
//      mem,
      type,
      autoselect,
      platform,
      running:this.kernel.api.running,
      memory: this.kernel.memory,
      sidebar: "/pinokio/sidebar/" + name,
      repos: "/pinokio/repos/" + name,
      ai: "/pinokio/ai/" + name,
      dynamic: dynamic_url,
//      dynamic: "/pinokio/dynamic/" + name,
      dynamic_content: null,
      name,
//      profile,
//      feed,
      tabs: savedTabs,
      editor_tab: editor_tab,
      config,
//        sidebar_url: "/pinokio/sidebar/" + name,
      home: req.originalUrl,
      run_tab,
      dev_tab,
      review_tab,
      files_tab,
//        paths,
      theme: this.theme,
      agent: req.agent,
      src: "/_api/" + name,
      //asset: "/asset/api/" + name,
      asset: "/files/api/" + name,
      logs: "/_api/" + name + "/logs",
      execUrl: "/api/" + name,
      git_monitor_url: `/gitcommit/HEAD/${name}`,
      git_history_url: `/info/git/HEAD/${name}`,
      git_status_url: `/info/gitstatus/${name}`,
      git_push_url: `/run/scripts/git/push.json?cwd=${encodeURIComponent(this.kernel.path('api', name))}`,
      git_create_url: `/run/scripts/git/create.json?cwd=${encodeURIComponent(this.kernel.path('api', name))}`,
      git_fork_url: `/run/scripts/git/fork.json?cwd=${encodeURIComponent(this.kernel.path('api', name))}`
//      rawpath,
    }
//    if (!this.kernel.proto.config) {
//      await this.kernel.proto.init()
//    }
    res.render("app", result)
  }
  getVariationUrls(req) {
    let edu = new URL("http://localhost" + req.originalUrl)
    edu.searchParams.set("mode", "source")
    let editorUrl = edu.pathname + edu.search

    let referer = req.get("Referer")
    let prevUrl = null
    try {
      if (/\/env\/api\/.+/.test(new URL(referer).pathname)) {
        prevUrl = referer 
      }
    } catch (e) {
    }
    return { editorUrl, prevUrl }
  }
  get_shell_id(name, i, rendered) {
    let shell_id
    if (rendered.id) {
      shell_id = encodeURIComponent(`${name}_${rendered.id}`)
    } else {
      let hash = crypto.createHash('md5').update(JSON.stringify(rendered)).digest('hex')
      //shell_id = encodeURIComponent(`${name}_${i}_session_${hash}`)
      shell_id = encodeURIComponent(`${name}_session_${hash}`)
    }
    return shell_id
  }
  is_subpath(parent, child) {
    const relative = path.relative(parent, child);
    let check = !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    return check
  }
  async discoverVirtualEnvDirs(dir) {
    const cacheKey = path.resolve(dir)
    const cached = this.virtualEnvCache.get(cacheKey)
    const now = Date.now()
    if (cached && cached.timestamp && (now - cached.timestamp) < 60000) {
      return cached.dirs
    }

    const normalizePath = (p) => p.replace(/\\/g, '/').replace(/\/+/g, '/')
    const ignored = new Set()
    const autoExclude = new Set()
    const seen = new Set()
    const stack = [{ abs: dir, rel: '', depth: 0 }]
    const maxDepth = 6

    const shouldIgnoreRelative = (relative) => {
      if (!relative) {
        return false
      }
      const normalized = normalizePath(relative)
      return this.gitStatusIgnorePatterns.some((regex) => regex.test(normalized) || regex.test(`${normalized}/`))
    }

    while (stack.length > 0) {
      const { abs, rel, depth } = stack.pop()
      const normalizedAbs = normalizePath(abs)
      if (seen.has(normalizedAbs)) {
        continue
      }
      seen.add(normalizedAbs)

      let stats
      try {
        stats = await fs.promises.stat(abs)
      } catch (err) {
        continue
      }
      if (!stats.isDirectory()) {
        continue
      }

      const relPath = rel ? normalizePath(rel) : ''
      if (relPath && shouldIgnoreRelative(relPath)) {
        ignored.add(relPath)
        const relSegments = relPath.split('/')
        const lastSegment = relSegments[relSegments.length - 1]
        if (lastSegment && ['node_modules', '.venv', 'venv', '.virtualenv', 'env'].includes(lastSegment)) {
          autoExclude.add(relPath)
        }
        continue
      }

      const entries = await fs.promises.readdir(abs, { withFileTypes: true }).catch(() => [])
      let hasPyvenvCfg = false
      let hasExecutables = false
      let hasSitePackages = false
      let hasInclude = false
      let hasNestedGit = false

      for (const entry of entries) {
        if (entry.name === '.git') {
          let treatAsGit = false
          if (entry.isDirectory && entry.isDirectory()) {
            treatAsGit = true
          } else if (entry.isFile && entry.isFile()) {
            treatAsGit = true
          } else if (entry.isSymbolicLink && entry.isSymbolicLink()) {
            treatAsGit = true
          }
          if (treatAsGit) {
            hasNestedGit = true
          }
        }
        if (entry.isFile() && entry.name === 'pyvenv.cfg') {
          hasPyvenvCfg = true
        }
        if (!entry.isDirectory()) {
          continue
        }
        const lower = entry.name.toLowerCase()
        if (lower === 'include') {
          hasInclude = true
        }
        if (lower === 'bin' || lower === 'scripts') {
          const execEntries = await fs.promises.readdir(path.join(abs, entry.name)).catch(() => [])
          if (execEntries.some((name) => /^activate(\..*)?$/i.test(name) || /^python(\d*(\.\d+)*)?(\.exe)?$/i.test(name))) {
            hasExecutables = true
          }
        }
        if (lower === 'site-packages') {
          hasSitePackages = true
        }
        if (lower === 'lib' || lower === 'lib64') {
          const libPath = path.join(abs, entry.name)
          const libEntries = await fs.promises.readdir(libPath, { withFileTypes: true }).catch(() => [])
          for (const libEntry of libEntries) {
            if (!libEntry.isDirectory()) {
              continue
            }
            if (/^python\d+(\.\d+)?$/i.test(libEntry.name)) {
              const sitePackages = path.join(libPath, libEntry.name, 'site-packages')
              try {
                const siteStats = await fs.promises.stat(sitePackages)
                if (siteStats.isDirectory()) {
                  hasSitePackages = true
                  break
                }
              } catch (err) {}
            }
            if (libEntry.name === 'site-packages') {
              hasSitePackages = true
              break
            }
          }
        }
      }

      const looksLikeVenv = hasPyvenvCfg || (hasExecutables && (hasSitePackages || hasInclude))
      if (looksLikeVenv && relPath) {
        ignored.add(relPath)
        autoExclude.add(relPath)
        continue
      }

      if (hasNestedGit && relPath) {
        ignored.add(relPath)
        autoExclude.add(relPath)
        continue
      }

      if (depth >= maxDepth) {
        continue
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue
        }
        const childRel = rel ? `${rel}/${entry.name}` : entry.name
        stack.push({ abs: path.join(abs, entry.name), rel: childRel, depth: depth + 1 })
      }
    }

    this.virtualEnvCache.set(cacheKey, { dirs: ignored, timestamp: now })
    if (autoExclude.size > 0) {
      try {
        await this.syncGitInfoExclude(dir, autoExclude)
      } catch (error) {
        console.warn('syncGitInfoExclude failed', dir, error)
      }
    }
    return ignored
  }
  async syncGitInfoExclude(dir, prefixes) {
    if (!prefixes || prefixes.size === 0) {
      return
    }

    const gitdir = path.join(dir, '.git')
    let gitStats
    try {
      gitStats = await fs.promises.stat(gitdir)
    } catch (error) {
      return
    }
    if (!gitStats.isDirectory()) {
      return
    }

    const infoDir = path.join(gitdir, 'info')
    await fs.promises.mkdir(infoDir, { recursive: true })

    const excludePath = path.join(infoDir, 'exclude')
    let existing = ''
    try {
      existing = await fs.promises.readFile(excludePath, 'utf8')
    } catch (error) {}

    const markerStart = '# >>> pinokiod auto-ignore >>>'
    const markerEnd = '# <<< pinokiod auto-ignore <<<'
    const lines = existing.split(/\r?\n/)
    const preserved = []
    const managed = new Set()
    let inBlock = false

    for (const rawLine of lines) {
      const line = rawLine.trimEnd()
      if (line === markerStart) {
        inBlock = true
        continue
      }
      if (line === markerEnd) {
        inBlock = false
        continue
      }
      if (inBlock) {
        const entry = rawLine.trim()
        if (entry && !entry.startsWith('#')) {
          managed.add(entry)
        }
        continue
      }
      preserved.push(rawLine)
    }

    const beforeSize = managed.size
    for (const prefix of prefixes) {
      if (!prefix) {
        continue
      }
      const normalized = prefix.replace(/\\/g, '/').replace(/\/+/g, '/')
      if (!normalized || normalized === '.git' || normalized.startsWith('.git/')) {
        continue
      }
      const withSlash = normalized.endsWith('/') ? normalized : `${normalized}/`
      managed.add(withSlash)
    }

    if (managed.size === beforeSize && existing.includes(markerStart)) {
      return
    }

    const sortedEntries = Array.from(managed)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))

    const blocks = []
    const preservedContent = preserved.join('\n').trimEnd()
    if (preservedContent) {
      blocks.push(preservedContent)
    }
    if (sortedEntries.length > 0) {
      blocks.push([markerStart, ...sortedEntries, markerEnd].join('\n'))
    }

    const finalContent = blocks.join('\n\n')
    await fs.promises.writeFile(excludePath, finalContent ? `${finalContent}\n` : '', 'utf8')
  }
  async getRepoHeadStatus(repoRelPath) {
    const repoParam = repoRelPath || ""
    const dir = repoParam ? this.kernel.path("api", repoParam) : this.kernel.path("api")

    if (!dir) {
      return { changes: [], git_commit_url: null }
    }

    const normalizePath = (p) => p.replace(/\\/g, '/').replace(/\/+/g, '/')
    const ignoredPrefixes = await this.discoverVirtualEnvDirs(dir)

    const shouldIncludePath = (relativePath) => {
      if (!relativePath) {
        return true
      }
      const normalized = normalizePath(relativePath)
      if (this.gitStatusIgnorePatterns && this.gitStatusIgnorePatterns.some((regex) => regex.test(normalized) || regex.test(`${normalized}/`))) {
        return false
      }
      for (const prefix of ignoredPrefixes) {
        if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
          return false
        }
      }
      if (normalized.includes('/site-packages/')) {
        return false
      }
      if (normalized.includes('/Scripts/')) {
        return false
      }
      if (normalized.includes('/bin/activate')) {
        return false
      }
      return true
    }

    let statusMatrix = await git.statusMatrix({ dir, fs })
    statusMatrix = statusMatrix.filter(Boolean)

    let headOid = null
    const getHeadOid = async () => {
      if (headOid) return headOid
      headOid = await git.resolveRef({ fs, dir, ref: 'HEAD' })
      return headOid
    }
    const readNormalized = async (source, filepath) => {
      if (source === 'head') {
        const oid = await getHeadOid()
        const { blob } = await git.readBlob({ fs, dir, oid, filepath })
        return normalize(Buffer.from(blob).toString('utf8'))
      } else {
        const content = await fs.promises.readFile(path.join(dir, filepath), 'utf8')
        return normalize(content)
      }
    }

    const changes = []
    for (const [filepath, head, workdir, stage] of statusMatrix) {
      if (!shouldIncludePath(filepath)) {
        continue
      }
      if (head === workdir && head === stage) {
        continue
      }
      const absolutePath = path.join(dir, filepath)
      let stats
      try {
        stats = await fs.promises.stat(absolutePath)
      } catch (error) {
        stats = null
      }
      if (stats && stats.isDirectory()) {
        continue
      }

      const status = Util.classifyChange(head, workdir, stage)
      if (!status) {
        continue
      }

      // Skip entries where HEAD and worktree match after normalization
      if (status && status.startsWith('modified')) {
        try {
          const headContent = await readNormalized('head', filepath)
          const worktreeContent = await readNormalized('worktree', filepath)
          if (headContent === worktreeContent) {
            continue
          }
        } catch (_) {
          // fall through if comparison fails
        }
      }

      const webpath = "/asset/" + path.relative(this.kernel.homedir, absolutePath)

      changes.push({
        ref: 'HEAD',
        webpath,
        file: normalizePath(filepath),
        path: absolutePath,
        diffpath: `/gitdiff/HEAD/${repoParam}/${normalizePath(filepath)}`,
        status,
      })
    }

    const repoHistoryUrl = repoParam ? `/info/git/HEAD/${repoParam}` : null

    const forkUrl = `/run/scripts/git/fork.json?cwd=${encodeURIComponent(dir)}`
    const pushUrl = `/run/scripts/git/push.json?cwd=${encodeURIComponent(dir)}`

    return {
      changes,
      git_commit_url: `/run/scripts/git/commit.json?cwd=${dir}&callback_target=parent&callback=$location.href`,
      git_history_url: repoHistoryUrl,
      git_fork_url: forkUrl,
      git_push_url: pushUrl,
    }
  }
  async computeWorkspaceGitStatus(workspaceName) {
    const workspacePath = this.kernel.path("api", workspaceName)
    const repos = await this.kernel.git.repos(workspacePath)

//    await Util.ignore_subrepos(workspacePath, repos)

    const statuses = []
    for (const repo of repos) {
      const repoParam = repo.gitParentRelPath || workspaceName
      try {
        const { changes, git_commit_url, git_history_url, git_fork_url, git_push_url } = await this.getRepoHeadStatus(repoParam)
        const historyUrl = git_history_url || (repoParam ? `/info/git/HEAD/${repoParam}` : `/info/git/HEAD/${workspaceName}`)
        statuses.push({
          name: repo.name,
          main: repo.main,
          gitParentRelPath: repo.gitParentRelPath,
          repoParam,
          changeCount: changes.length,
          changes,
          git_commit_url,
          git_history_url: historyUrl,
          git_fork_url,
          git_push_url,
          url: repo.url || null,
        })
      } catch (error) {
        console.error('computeWorkspaceGitStatus error', repoParam, error)
        const historyUrl = repoParam ? `/info/git/HEAD/${repoParam}` : `/info/git/HEAD/${workspaceName}`
        statuses.push({
          name: repo.name,
          main: repo.main,
          gitParentRelPath: repo.gitParentRelPath,
          repoParam,
          changeCount: 0,
          changes: [],
          git_commit_url: null,
          git_history_url: historyUrl,
          git_fork_url: `/run/scripts/git/fork.json?cwd=${encodeURIComponent(this.kernel.path('api', repoParam))}`,
          git_push_url: `/run/scripts/git/push.json?cwd=${encodeURIComponent(this.kernel.path('api', repoParam))}`,
          url: repo.url || null,
          error: error ? String(error.message || error) : 'unknown',
        })
      }
    }

    const totalChanges = statuses.reduce((sum, repo) => sum + (repo.changeCount || 0), 0)
    return { totalChanges, repos: statuses }
  }
  async render(req, res, pathComponents, meta) {
    let base_path = req.base || this.kernel.path("api")
    let full_filepath = path.resolve(base_path, ...pathComponents)

    let re = /^(.+\..+)(#.*)$/
    let match = re.exec(full_filepath)

    let filepath
    let hash
    if (match && match.length > 0) {
      filepath = match[1]
      hash = match[2].slice(1)
    } else {
      filepath = full_filepath
    }

    // check if it's a folder or a file
    let p = "/api"    // run mode
    let _p = "/_api"   // edit mode
    let paths = [{
      name: "<img src='/pinokio-black.png'>",
      //name: '<i class="fa-solid fa-house"></i>',
      path: "/",
    }, {
      id: "back",
      name: '<i class="fa-solid fa-arrow-left"></i>',
      action: "history.back()"
    }, {
      id: "forward",
      name: '<i class="fa-solid fa-arrow-right"></i>',
      action: "history.forward()"
    }]
    paths = []
    for(let pathComponent of pathComponents) {
      //p = p + "/" + pathComponent
      _p = _p + "/" + pathComponent
      //let pn = (pathComponent.startsWith("0x") ? Buffer.from(pathComponent.slice(2), "hex").toString() : "/ " + pathComponent)
      let pn =  "/ " + pathComponent
      paths.push({
        //name: "/ " + pathComponent,
        name: pn,
        //path: p
        path: _p
      })
    }
    let gitRemote = ""
    if (pathComponents.length > 0) {
      try {
        //const repositoryPath = this.kernel.path(pathComponents[0], pathComponents[1])
        //const repositoryPath = this.kernel.path(pathComponents[0])
        const repositoryPath = path.resolve(this.kernel.api.userdir, pathComponents[0])
        gitRemote = await git.getConfig({
          fs,
          http,
          dir: repositoryPath,
          path: 'remote.origin.url'
        })
      } catch (e) {
//        console.log("ERROR", e)
      }

    }

    if (path.basename(filepath) === "ENVIRONMENT") {
      // if environment.json doesn't exist, 
      let exists = await this.exists(filepath)
      if (!exists) {
        let content = await Environment.ENV("app", this.kernel.homedir, this.kernel)
        await fs.promises.writeFile(filepath, content)
      }
    }

    let stat = await fs.promises.stat(filepath)
    if (pathComponents.length === 0 && req.query.mode === "explore") {
      res.render("explore", {
        discover_dark: this.discover_dark,
        discover_light: this.discover_light,
        portal: this.portal,
        version: this.version,
        schema: this.kernel.schema,
        logo: this.logo,
        theme: this.theme,
        agent: req.agent,
        stars_selected: (req.query.sort === "stars" || !req.query.sort ? "selected" : ""),
        forks_selected: (req.query.sort === "forks" ? "selected" : ""),
        updated_selected: (req.query.sort === "updated" ? "selected" : ""),
        sort: (req.query.sort ? req.query.sort : "stars"),
        direction: "desc",
        paths,
        display: ["form"]
      })
    } else if (pathComponents.length === 0 && req.query.mode === "download") {
      let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
        bin: this.kernel.bin.preset("dev"),
      })
      let sanitizedPath = null
      if (typeof req.query.path === 'string') {
        let trimmed = req.query.path.trim()
        if (trimmed) {
          trimmed = trimmed.replace(/^~[\\/]?/, '').replace(/^[\\/]+/, '')
          if (trimmed) {
            const segments = trimmed.split(/[\\/]+/).filter(Boolean)
            if (segments.length > 0 && !segments.some((segment) => segment === '.' || segment === '..')) {
              sanitizedPath = segments.join('/')
              try {
                await fs.promises.mkdir(path.resolve(this.kernel.homedir, sanitizedPath), { recursive: true })
              } catch (mkdirErr) {
                console.warn('Failed to ensure download path exists', mkdirErr)
                sanitizedPath = null
              }
            }
          }
        }
      }
      res.render("download", {
        portal: this.portal,
        error,
        current: req.originalUrl,
        install_required,
        requirements,
        requirements_pending,
        logo: this.logo,
        theme: this.theme,
        agent: req.agent,
        userdir: this.kernel.api.userdir,
        display: ["form"],
        query: sanitizedPath ? { ...req.query, path: sanitizedPath } : req.query
      })
    } else if (pathComponents.length === 0 && req.query.mode === "settings") {
      let system_env = {}
      if (this.kernel.homedir) {
        system_env = await Environment.get(this.kernel.homedir, this.kernel)
      }
      const hasHome = !!this.kernel.homedir
      let configArray = [{
        key: "home",
        val: this.kernel.homedir,
        placeholder: "Enter the absolute path to use as your Pinokio home folder (D:\\pinokio, /Users/alice/pinokiofs, etc.)"
//      }, {
//        key: "drive",
//        val: path.resolve(this.kernel.homedir, "drive"),
//        placeholder: "Pinokio virtual drives folder"
      }, {
        key: "theme",
        val: this.theme,
        options: ["light", "dark"]
      }, {
        key: "mode",
        val: this.mode,
        options: ["desktop", "background"]
      }, {
        key: "HTTP_PROXY",
        val: (system_env.HTTP_PROXY || ""),
        show_on_click: "#proxy",
        placeholder: "(Advanced) Only set if you are behind a proxy"
      }, {
        key: "HTTPS_PROXY",
        val: (system_env.HTTPS_PROXY || ""),
        show_on_click: "#proxy",
        placeholder: "(Advanced) Only set if you are behind a proxy"
      }, {
        key: "NO_PROXY",
        val: (system_env.NO_PROXY || ""),
        show_on_click: "#proxy",
        placeholder: "(Advanced) Only set if you are behind a proxy"
      }]
      let folders = {}
      if (this.kernel.homedir) {
        folders = {
          bin: path.resolve(this.kernel.homedir, "bin"),
          cache: path.resolve(this.kernel.homedir, "cache"),
          drive: path.resolve(this.kernel.homedir, "drive"),
        }
      }
      const peerAccess = await this.composePeerAccessPayload()
      let list = this.getPeers()
      res.render("settings", {
        list,
        current_host: this.kernel.peer.host,
        hasHome,
        ...peerAccess,
        platform,
        version: this.version,
        logo: this.logo,
        theme: this.theme,
        agent: req.agent,
        paths,
        config: configArray,
        query: req.query,
        ...folders
      })
    } else if (stat.isFile()) {
      if (req.query && req.query.raw) {
        try {
//          res.setHeader('Content-Disposition', 'inline');
          if (req.query.frame) {
            let m = mime.lookup(filepath)
            res.type("text/plain")
          }
          res.sendFile(filepath)
        } catch (e) {
          res.status(404).send(e.message);
        }
        return
      }

      // if js or json, editor
      // otherwise, stream the file


//      let filename = pathComponents[pathComponents.length-1]

      // try loading json
      let mod;
      let json
      let js

      if (filepath.endsWith(".json")) {
        try {
          json = (await this.kernel.loader.load(filepath)).resolved
          mod = true
        } catch (e) {
          console.log("######### load error", filepath, e)
        }
      }
      if (filepath.endsWith(".js")) {
        try {
          js = (await this.kernel.loader.load(filepath)).resolved
          mod = true
        } catch (e) {
          console.log("######### load error", filepath, e)
        }
      }

      let editmode = false

      let m = mime.lookup(filepath)
      if (json || js) {
        editmode = true
      } else if (!m) {
        editmode = true
      } else if (m.startsWith("audio") || m.startsWith("video") || m.startsWith("image")) {
        editmode = false
      } else {
        editmode = true
      }

      let runner = json || js

      let rawpath = `/raw/${pathComponents.join('/')}` + "?frame=true"
      if (editmode) {
        let content
        try {
          content = await fs.promises.readFile(filepath, "utf8")
        } catch (e) {
          content = ""
          console.log(">>>>>>>>>> Error", e)
        }

        /********************************************************************
        *
        *   uri :=
        *     | <http uri>
        *     | <relative path in relation to ~/pinokio/api>
        *
        ********************************************************************/

        let uri
        //if (gitRemote) {
        //  uri = `${gitRemote}/${pathComponents.slice(1).join("/")}`
        //} else {
        //  uri = path.resolve(this.kernel.api.userdir, ...pathComponents)
        //}


        //uri = path.resolve(this.kernel.api.userdir, ...pathComponents)
        uri = full_filepath

        let pinokioPath
        if (gitRemote) {
          pinokioPath = `pinokio://?uri=${gitRemote}/${pathComponents.slice(1).join("/")}`
        }

        let filename = pathComponents[pathComponents.length-1]
        let schemaPath



        //if (filename.endsWith(".json") || filename.endsWith(".js")) {
        //  schemaPath = pathComponents.slice(0,-1).join("/") + "/_" + filename
        //  const schemaFullPath = path.resolve(this.kernel.api.userdir, schemaPath)
        //  let exists = await this.exists(schemaFullPath)
        //  if (!exists) {
        //    schemaPath = "" 
        //  }
        //} else {
        //  schemaPath = ""
        //}


        if (filename.endsWith(".json") || filename.endsWith(".js")) {
          let stem = filename.replace(/\.(json|js)$/, "")
          let stempath = pathComponents.slice(0,-1).join("/") + "/_" + stem
          for(let p of [stempath + ".json", stempath + ".js"]) {
            //const schemaFullPath = path.resolve(this.kernel.api.userdir, p)
            const schemaFullPath = path.resolve(this.kernel.api.userdir, p)
            let exists = await this.exists(schemaFullPath)
            if (exists) {
              schemaPath = p
              break;
            }
          }
          if (!schemaPath) schemaPath = ""
        } else {
          schemaPath = ""
        }

        const actionKey = req.action || 'run'
        let runnable
        let resolved
        if (typeof runner === "function") {
          if (runner.constructor.name === "AsyncFunction") {
            resolved = await runner(this.kernel, this.kernel.info)
          } else {
            resolved = runner(this.kernel, this.kernel.info)
          }
          runnable = resolved && Array.isArray(resolved[actionKey]) && resolved[actionKey].length > 0
        } else {
          runnable = runner && Array.isArray(runner[actionKey]) && runner[actionKey].length > 0
          resolved = runner
        }

        let template = "terminal"
        if (req.query && req.query.mode === "source") {
          template = "editor"
        }

        let requires_bundle = null
        if (resolved && resolved.requires && !Array.isArray(resolved.requires)) {
          const bundle = resolved.requires.bundle
          if (typeof bundle === "string" && typeof Setup[bundle] === "function") {
            requires_bundle = bundle
          }
        }

        const preset = requires_bundle ? this.kernel.bin.preset(requires_bundle) : this.kernel.bin.preset("dev")
        let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
          bin: preset,
          script: resolved
        })

        if (requires_bundle) {
          console.log({ requires_bundle, requirements_pending, install_required,  })
        }

        if (requires_bundle && !requirements_pending && install_required) {
          res.redirect(`/setup/${requires_bundle}?callback=${req.originalUrl}`)
          return
        }

        //let requirements = this.kernel.bin.requirements(resolved)
        //let requirements_pending = !this.kernel.bin.installed_initialized
        //let install_required = true
        //if (!requirements_pending) {
        //  install_required = false
        //  for(let i=0; i<requirements.length; i++) {
        //    let r = requirements[i]

        //    let relevant = this.relevant(r)
        //    requirements[i].relevant = relevant
        //    if (relevant) {
        //      let installed = await this.installed(r)
        //      requirements[i].installed = installed
        //      if (!installed) {
        //        install_required = true
        //      }
        //    }
        //  }
        //}

        //let error = null
        //try {
        //  this.kernel.bin.compatible()
        //} catch (e) {
        //  error = e.message
        //  install_required = true
        //}

        //requirements = requirements.filter((r) => {
        //  return r.relevant
        //})


        let mem = this.getMemory(filepath)

        let { editorUrl, prevUrl } = this.getVariationUrls(req)


        //let cwd = req.query.cwd ? req.query.cwd : path.dirname(filepath)
        let cwd = req.query.cwd ? req.query.cwd : filepath
        let env_requirements = await Environment.requirements(resolved, cwd, this.kernel)
        if (env_requirements.requires_instantiation) {
          //let p = Util.api_path(filepath, this.kernel)
          let api_path = Util.api_path(cwd, this.kernel)
          let root = await Environment.get_root({ path: api_path }, this.kernel)
          let root_path = root.root
          let platform = os.platform()
          if (platform === "win32") {
            root_path = root_path.replace(/\\/g, '\\\\')
          }
          res.render("required_env_editor", {
            portal: this.portal,
            agent: req.agent,
            theme: this.theme,
            filename,
            filepath: root_path,
            items: env_requirements.items
          })
        } else {
          // check if it's a prototype script
          let kill_message
          let callback
          let callback_target
          if (req.query.callback) {
            callback = req.query.callback
//            kill_message = "Done! Click to go to the project"
          }
          if (req.query.callback_target) {
            callback_target = req.query.callback_target
          }

          let logpath = encodeURIComponent(Util.log_path(filepath, this.kernel))
          const result = {
            portal: this.portal,
            projectName: (pathComponents.length > 0 ? pathComponents[0] : ''),
            kill_message,
            callback,
            callback_target,
            prev: prevUrl,
            error,
            memory: mem,
  //          memory: mem,
            logo: this.logo,
            theme: this.theme,
            //run: (req.query && req.query.run ? true : false),
            //run: true,    // run mode by default
            run: (req.query && req.query.mode === "source" ? false : true),
            stop: (req.query && req.query.stop ? true : false),
            pinokioPath,
            action: actionKey,
            runnable,
            agent: req.agent,
            rawpath,
            gitRemote,
            filename,
            filepath,
            logpath,
            encodedFilePath: encodeURIComponent(filepath),
            schemaPath,
            uri,
            mod,
            json,
            js,
            content,
            paths,
            requirements,
            requirements_pending,
            install_required,
            //current: encodeURIComponent(req.originalUrl),
            current: req.originalUrl,
            editorUrl,
            execUrl: "~" + req.originalUrl.replace(/^\/_api/, "\/api"),
            proxies: this.kernel.api.proxies[filepath],
            cwd: req.query.cwd,
            script_id: (req.base ? `${full_filepath}?cwd=${req.query.cwd}` : null),
            script_path: (req.base ? full_filepath : null),
          }

          res.render(template, result)
        }






      } else {
        res.render("frame", {
          portal: this.portal,
          logo: this.logo,
          theme: this.theme,
          agent: req.agent,
          rawpath: rawpath + "?frame=true",
          paths,
          filepath
        })
      }
    } else if (stat.isDirectory()) {
      if (req.query && req.query.mode === "browser") {
        return
      }


      let error
      let items
      let readme
//      if (pathComponents.length === 0) {
//        let files = await fs.promises.readdir(filepath, { withFileTypes: true })
//        items = files
//        //items = files.filter((f) => {
//        //  return f.name === "api"
//        //})
//      } else {
        let files = await fs.promises.readdir(filepath, { withFileTypes: true })
        let f = {
          files: [],
          folders: []
        }

        for(let file of files) {
          let type = await Util.file_type(filepath, file)
          if (type.directory) {
            f.folders.push(file)
          } else {
            f.files.push(file)
          }
        }

        // look for README.md

        let config
        for(let file of f.files) {
          if (file.name.toLowerCase() === "readme.md") {
            let p = path.resolve(filepath, file.name)
            let md = await fs.promises.readFile(p, "utf8")
            readme = marked.parse(md, {
              baseUrl: req._parsedUrl.pathname.replace(/^\/_api/, "/raw/") + "/"
              //baseUrl: req.originalUrl + "/"
            })
          }
          if (file.name === "pinokio.js") {
            let p = path.resolve(filepath, file.name)
            config  = (await this.kernel.loader.load(p)).resolved

            if (config && config.menu) {
              if (typeof config.menu === "function") {
                if (config.menu.constructor.name === "AsyncFunction") {
                  config.menu = await config.menu(this.kernel, this.kernel.info)
                } else {
                  config.menu = config.menu(this.kernel, this.kernel.info)
                }
              }

              await this.renderMenu(req, filepath.replace("/" + pathComponents[0], ""), pathComponents[0], config, pathComponents.slice(1))
              //for(let i=0; i<config.menu.length; i++) {
              //  let item = config.menu[i]
              //  if (item.href && !item.href.startsWith("http")) {
              //    let absolute = path.resolve(__dirname, ...pathComponents, item.href)
              //    let seed = path.resolve(__dirname)
              //    let p = absolute.replace(seed, "")
              //    let link = p.split(/[\/\\]/).filter((x) => { return x }).join("/")
              //    config.menu[i].href = "/api/" + link
              //  }
              //}

            }
            if (config && config.update) {
              if (typeof config.update === "function") {
                if (config.update.constructor.name === "AsyncFunction") {
                  config.update = await config.update(this.kernel, this.kernel.info)
                } else {
                  config.update = config.update(this.kernel, this.kernel.info)
                }
              }
              let absolute = path.resolve(__dirname, ...pathComponents, config.update)
              let seed = path.resolve(__dirname)
              let p = absolute.replace(seed, "")
              let link = p.split(/[\/\\]/).filter((x) => { return x }).join("/")
              config.update = "/api/" + link
            }
          }

          // override config
          if (file.name === "pinokio_meta.json" || file.name === "pinokio.json") {
            let p = path.resolve(filepath, file.name)
            let c  = (await this.kernel.loader.load(p)).resolved
            if (c.title) {
              if (!config) config = {}
              config.title = c.title
            }
            if (c.description) {
              if (!config) config = {}
              config.description = c.description
            }
            if (c.icon) {
              if (!config) config = {}
              config.icon = c.icon
            }
          }
        }
        if (!config) config = {}


  //      let folder = pathComponents[pathComponents.length - 1]
        if (meta) {
          // home => only show the folders
          items = f.folders
        } else {
          // app view file explorer => show all files and folders
          items = f.folders.concat(f.files)
        }
//      }
      let display = pathComponents.length === 0 ? ["form", "explore"] : []
      //let display = ["form"]

      if (pathComponents.length === 0 && items.length === 0) {
        display.push("onboarding")
      }

      if (gitRemote && pathComponents.length === 1) {
        display.push("pull")
      }

      if (config.install) {
        display.push("install")
      }
      if (config.menu) {
        display.push("menu")
      }


      if (config.dependencies && config.dependencies.length > 0) {
        // check if already installed 
        // 'downloaded' is null if the git_uri does not exist on the file system yet (kernel.api.gitPath)
        config.dependencies = config.dependencies.map((git_uri) => {
          let gitPath = this.kernel.api.gitPath[git_uri]
          let downloaded
          if (gitPath) {
            downloaded = path.basename(gitPath)
          } else {
            downloaded = null
          }
          return {
            uri: git_uri,
            //downloaded: (this.kernel.api.gitPath[git_uri] ? "0x" + Buffer.from(git_uri).toString("hex") : null)
            downloaded: downloaded
          }
        })
        display.push("dependencies")
      }

      let uri = path.resolve(this.kernel.api.userdir, ...pathComponents)

      let pinokioPath
      if (gitRemote) {
        pinokioPath = `pinokio://?uri=${gitRemote}/${pathComponents.slice(1).join("/")}`
      }

      let running = []
      let notRunning = []
      if (pathComponents.length === 0) {


        let index = 0
        for(let i=0; i<items.length; i++) {
          let item = items[i]
          let launcher = await this.kernel.api.launcher(item.name)
          let config = launcher.script
          await this.kernel.dns({
            name: item.name,
            config
          })


          if (config) {

            if (config.shortcuts) {
              if (typeof config.shortcuts === "function") {
                if (config.shortcuts.constructor.name === "AsyncFunction") {
                  config.shortcuts = await config.shortcuts(this.kernel, this.kernel.info)
                } else {
                  config.shortcuts = config.shortcuts(this.kernel, this.kernel.info)
                }
              }
              await this.renderShortcuts(uri, item.name, config, pathComponents)
              items[i].shortcuts = config.shortcuts
            }
          }

          // lib types should not be displayed on the home page
          if (config && config.type === "lib") {
            continue
          }
          // check if there is a running process with this folder name
          let runningApps = new Set()
          const item_path = this.kernel.path("api", items[i].name)
          const normalizedItemPath = path.normalize(item_path)
          const itemPathWithSep = normalizedItemPath.endsWith(path.sep)
            ? normalizedItemPath
            : normalizedItemPath + path.sep
          const unix_item_path = Util.p2u(item_path)
          const shellPrefix = "shell/" + unix_item_path + "_"
          const matchesShell = (candidate) => {
            if (!candidate) return false
            const idMatches = typeof candidate.id === "string" && candidate.id.startsWith(shellPrefix)
            const shellPath = typeof candidate.path === "string" ? path.normalize(candidate.path) : null
            const groupPath = typeof candidate.group === "string" ? path.normalize(candidate.group) : null
            const parentCwd = candidate.params && candidate.params.$parent && typeof candidate.params.$parent.cwd === "string"
              ? path.normalize(candidate.params.$parent.cwd)
              : null
            const paramsCwd = candidate.params && typeof candidate.params.cwd === "string"
              ? path.normalize(candidate.params.cwd)
              : null
            const pathMatches = shellPath && (shellPath === normalizedItemPath || shellPath.startsWith(itemPathWithSep))
            const groupMatches = groupPath && (groupPath === normalizedItemPath || groupPath.startsWith(itemPathWithSep))
            const parentMatches = parentCwd && (parentCwd === normalizedItemPath || parentCwd.startsWith(itemPathWithSep))
            const paramsMatches = paramsCwd && (paramsCwd === normalizedItemPath || paramsCwd.startsWith(itemPathWithSep))
            return idMatches || pathMatches || groupMatches || parentMatches || paramsMatches
          }
          const shellMatches = (this.kernel.shell && typeof this.kernel.shell.find === "function")
            ? this.kernel.shell.find({ filter: matchesShell })
            : []
          const addShellEntries = () => {
            if (!shellMatches || shellMatches.length === 0) {
              return
            }
            if (!items[i].running_scripts) {
              items[i].running_scripts = []
            }
            for (const sh of shellMatches) {
              if (!sh || !sh.id) continue
              const exists = items[i].running_scripts.some((entry) => entry && entry.id === sh.id)
              if (!exists) {
                items[i].running_scripts.push({ id: sh.id, name: sh.params.$title || "Shell", type: "shell" })
              }
            }
          }
          for(let key in this.kernel.api.running) {
            //let p = this.kernel.path("api", items[i].name) + path.sep
            let p = item_path

            // not only should include the pattern, but also end with it (otherwise can include similar patterns such as /api/qqqa, /api/qqqaaa, etc.

            let is_running
            let api_path = this.kernel.path("api")
            if (this.is_subpath(api_path, key)) {
              // normal api script at path p
              if (this.is_subpath(p, key)) {
                is_running = true
              }
            } else {
              if (key.endsWith(p)) {
                // global scripts that run in the path p
                is_running = true
              } else {
                // shell sessions
                if (key.startsWith("shell/")) {
                  let unix_path = key.slice(6)
                  let native_path = Util.u2p(unix_path)
                  let chunks = native_path.split("_")
                  if (chunks.length > 1) {
                    let folder = chunks[0]
                    /// if the folder name matches, it's running
                    if (item_path === folder) {
                      is_running = true
                    }
                  }
                }
              }
            }
            // 1. if the script path starts with api path => api script
            //    => check includes and startsWith

            // 2. if the script path starts with anything else => other scripts (prototype, plugin ,etc.)
            //    => check inlcludes and endsWith

            //if (key.includes(p) && key.endsWith(p)) {
            if (is_running) {
              // add to running
              if (!items[i].running) {
                running.push(items[i])
                items[i].running = true
                items[i].index = index
                index++
              }
              if (!items[i].running_scripts) {
                items[i].running_scripts = []
              }

              // add the running script to running_scripts array
              // 1. normal api script
              if (path.isAbsolute(key)) {
                // script
                if (this.is_subpath(api_path, key)) {
                  // scripts inside api folder
                  if (this.is_subpath(p, key)) {
                    items[i].running_scripts.push({ path: path.relative(this.kernel.homedir, key), name: path.relative(p, key) })
                  }
                } else {
                  // other global scripts
                  let chunks = key.split("?")
                  let dev = chunks[0]
                  let relpath = path.relative(this.kernel.homedir, dev)
                  let name_chunks = relpath.split(path.sep)
                  let name = "/" + relpath
                  items[i].running_scripts.push({ id: key, name })
                }
              } else {
                addShellEntries()
              }
            }
          }
          if (!items[i].running && shellMatches && shellMatches.length > 0) {
            running.push(items[i])
            items[i].running = true
            items[i].index = index
            addShellEntries()
            index++
          }
          if (!items[i].running) {
            items[i].index = index
            index++;
            notRunning.push(items[i])
          }
        }
      }

      running = this.getItems(running, meta, p)
      notRunning = this.getItems(notRunning, meta, p)

      // check running for each
      // running_items
      items = items.map((x) => {
        //let name = (x.name.startsWith("0x") ? Buffer.from(x.name.slice(2), "hex").toString() : x.name)
        let name
        let description
        let icon = "/pinokio-black.png"
        let iconpath
        let apipath
        let uri
        if (meta) {
          let m = meta[x.name]
          name = (m && m.title ? m.title : x.name)
          description = (m && m.description ? m.description : "")
          if (m && m.icon) {
            icon = m.icon
          } else {
            //icon = null
            icon = "/pinokio-black.png"
          }
          if (m && m.iconpath) {
            iconpath = m.iconpath
          }
          if (m && m.path) {
            apipath = m.path
          }
          uri = x.name
        } else {
          if (x.isDirectory()) {
            icon = "fa-solid fa-folder"
          } else {
            icon = "fa-regular fa-file"
          }
          name = x.name
          description = ""
        }
        return {
          icon,
          iconpath,
          path: apipath,
          menu: x.menu,
          run: x.run,
          shortcuts: x.shortcuts,
          //icon: (x.isDirectory() ? "fa-solid fa-folder" : "fa-regular fa-file"),
          name,
          uri,
          //description: x.path,
          description,
          //url: p + "/" + x.name,
          url: _p + "/" + x.name,
//            url: `${U}/${x.name}`,
          //browser_url: "/pinokio/browser/" + x.name
          browser_url: "/p/" + x.name
        }
      })


//      if (req.query && req.query.mode === "task") {
//        running = running.filter((x) => {
//          return x.run && Array.isArray(x.run)
//        })
//        notRunning = notRunning.filter((x) => {
//          return x.run && Array.isArray(x.run)
//        })
//      } else {
//        running = running.filter((x) => {
//          return !(x.run && Array.isArray(x.run))
//        })
//        notRunning = notRunning.filter((x) => {
//          return !(x.run && Array.isArray(x.run))
//        })
//      }


 //     let U = `${_p}/${pathComponents.join("/")}`
 //     console.log("*******", { filepath, pathComponents, U })

      let pinokio_proxy = this.kernel.api.proxies["/"]
      let pinokio_cloudflare = this.cloudflare_pub

      let qr = null
      let qr_cloudflare = null
      let home_proxy = null
      if (pinokio_proxy && pinokio_proxy.length > 0) {
        qr = await QRCode.toDataURL(pinokio_proxy[0].proxy)
        home_proxy = pinokio_proxy[0]
      }

      if (this.cloudflare_pub) {
        qr_cloudflare = await QRCode.toDataURL(this.cloudflare_pub)
      }

      const peerAccess = await this.composePeerAccessPayload()

      // custom theme
      let exists = await fse.pathExists(this.kernel.path("web"))
      if (exists) {
        let config_exists = await fse.pathExists(this.kernel.path("web/config.json"))
        if (config_exists) {
          let config = (await this.kernel.loader.load(this.kernel.path("web/config.json"))).resolved
          if (config) {
            if (this.colors) {
              if (config.color) this.colors.color = config.color
              if (config.symbolColor) this.colors.symbolColor = config.symbolColor
            }
            if (config.xterm) {
              this.xterm = config.xterm
            }
          }
        }
      }

      await this.kernel.peer.check_peers()
      let current_urls = await this.current_urls()

//      let list = this.getPeerInfo()
      let list = this.getPeers()

      if (meta) {
        items = running.concat(notRunning)
        res.render("index", {
          list,
          current_host: this.kernel.peer.host,
          ...peerAccess,
          current_urls,
          portal: this.portal,
          install: this.install,
          folders: null,
          launch_complete: this.kernel.launch_complete,
          home_url: `http://localhost:${this.port}`,
          proxy: home_proxy,
          cloudflare_pub: this.cloudflare_pub,
          qr,
          qr_cloudflare,
          error: error,
          logo: this.logo,
  //        memory: mem,
          theme: this.theme,
          pinokioPath,
          config,
          display,
          agent: req.agent,
  //        folder,
          paths,
          uri,
          gitRemote,
          userdir: this.kernel.api.userdir,
          ishome: meta,
          running,
          notRunning,
          readme,
          filepath,
          mode: null,
          kernel: this.kernel,
          //mode: (req.query && req.query.mode ? req.query.mode : null),
          items
        })
      } else {
        res.render("file_explorer", {
          docs: this.docs, 
          portal: this.portal,
          home_url: `http://localhost:${this.port}`,
          proxy: home_proxy,
          cloudflare_pub: this.cloudflare_pub,
          qr,
          qr_cloudflare,
          error: error,
          logo: this.logo,
  //        memory: mem,
          theme: this.theme,
          pinokioPath,
          config,
          display,
          agent: req.agent,
  //        folder,
          paths,
          uri,
          gitRemote,
          userdir: this.kernel.api.userdir,
          ishome: meta,
          running,
          notRunning,
          readme,
          filepath,
          mode: null,
          kernel: this.kernel,
          //mode: (req.query && req.query.mode ? req.query.mode : null),
          items
        })
      }

    }
  }
  async renderShortcuts(uri, name, config, pathComponents) {
    if (config.shortcuts) {
      for(let i=0; i<config.shortcuts.length; i++) {
        let shortcut = config.shortcuts[i]
        if (shortcut.action) {
          if (shortcut.action.method === "stop") {
            if (shortcut.action.uri) {
              let absolute = path.resolve(__dirname, ...pathComponents, shortcut.action.uri)
              let seed = path.resolve(__dirname)
              let p = absolute.replace(seed, "")
              let link = p.split(/[\/\\]/).filter((x) => { return x }).join("/")
              let uri = "~/api/" + name + "/" + link

              config.shortcuts[i].action.uri = uri


              if (shortcut.hasOwnProperty("text")) {
                if (shortcut.hasOwnProperty("icon")) {
                  config.shortcuts[i].html = `<i class="${shortcut.icon}"></i> ${shortcut.text}` 
                } else {
                  config.shortcuts[i].html = `${shortcut.text}` 
                }
                config.shortcuts[i].btn = shortcut.html
              }

            }
          }
        }
      }
    }
  }


  renderMenu2(config, base, keypath) {
    // when the config has not loaded yet
    if (!config) {
      return { menu: [] }
    }
    if (config.menu) {
      for(let i=0; i<config.menu.length; i++) {
        let item = config.menu[i]
        let new_keypath
        if (keypath) {
          new_keypath = keypath.concat(i)
        } else {
          new_keypath = [i]
        }
        let c = this.renderMenu2(item, base, new_keypath)
        config.menu[i] = c
      }
    }
    if (config.text) {
      if (config.hasOwnProperty("icon")) {
        config.html = `<i class="${config.icon}"></i> ${config.text}` 
      } else if (config.hasOwnProperty("image")) {
        let imagePath = `${base.web_path}/${config.image}`
        config.html = `<img class='menu-item-image' src='${imagePath}' /> ${config.text}`
      } else {
        config.html = `${config.text}` 
      }
      config.btn = config.html
      config.arrow = true
    }
    /*
    if (config.href && !config.href.startsWith("/")) {
      if (base.href) {
        config.href = base.href + "/" + config.href
      }
    }
    */
    if (keypath) {
      config.href = base.href + "/" + keypath.join("/") + "?path=" + base.cwd
      //config.script_id = this.kernel.path(keypath) + "?cwd=" + base.cwd
      config.script_id = path.resolve(base.path, config.href) + "?cwd=" + base.cwd
    }
    return config
  }
  renderShell(cwd, indexPath, subIndexPath, menuitem) {
    if (menuitem.shell) {
      /*
        shell :- {
          id (optional),
          path (required),    // api, bin, quick, network, api/
          message (optional), // if not specified, start an empty shell
          venv,
          input,              // input mode if true
          callback,           // callback url after shutting down
          kill,               // when to kill (regular expression)
        }
      */

      let rendered = this.kernel.template.render(menuitem.shell, {})
      let params = new URLSearchParams()
//          if (rendered.id) {
//            params.set("id", encodeURIComponent(rendered.id))
//          } else {
//            let shell_id = "sh_" + name + "_" + i
//            params.set("id", encodeURIComponent(shell_id))
//          }
      if (rendered.path) {
        params.set("path", encodeURIComponent(this.kernel.api.filePath(rendered.path, cwd)))
      } else {
        params.set("path", encodeURIComponent(cwd))
      }
      if (rendered.message) params.set("message", encodeURIComponent(rendered.message))
      if (rendered.venv) params.set("venv", encodeURIComponent(rendered.venv))
      if (rendered.input) params.set("input", true)
      if (rendered.callback) params.set("callback", encodeURIComponent(rendered.callback))
      if (rendered.callback_target) params.set("callback_target", rendered_callback_target)
      if (rendered.kill) params.set("kill", encodeURIComponent(rendered.kill))
      if (rendered.done) params.set("done", encodeURIComponent(rendered.done))
      if (rendered.env) {
        for(let key in rendered.env) {
          let env_key = "env." + key
          params.set(env_key, rendered.env[key])
        }
      }
      if (rendered.conda) {
        for(let key in rendered.conda) {
          let conda_key = "conda." + key
          params.set(conda_key, rendered.conda[key])
        }
      }

      // deterministic shell id generation
      // `${api_path}_${i}_${hash}`
      let currentIndexPath
      if (indexPath) {
        currentIndexPath = indexPath + "." + subIndexPath
      } else {
        currentIndexPath = "" + subIndexPath
      }
      let unix_path = Util.p2u(cwd)
      let shell_id = this.get_shell_id(unix_path, currentIndexPath, rendered)

//          let hash = crypto.createHash('md5').update(JSON.stringify(rendered)).digest('hex')
//          let shell_id
//          if (rendered.id) {
//            shell_id = encodeURIComponent(`${name}_${rendered.id}`)
//          } else {
//            shell_id = encodeURIComponent(`${name}_${i}_${hash}`)
//          }
      menuitem.href = "/shell/" + shell_id + "?" + params.toString()
      let decoded_shell_id = decodeURIComponent(shell_id)
      const shellPrefixId = "shell/" + decoded_shell_id
      let shell = this.kernel.shell.get(shellPrefixId)
      if (!shell && this.kernel.shell && Array.isArray(this.kernel.shell.shells)) {
        shell = this.kernel.shell.shells.find((entry) => {
          if (!entry || !entry.id) {
            return false
          }
          return entry.id === shellPrefixId || entry.id.startsWith(`${shellPrefixId}?session=`)
        })
      }
      menuitem.shell_id = shellPrefixId
      if (shell) {
        menuitem.running = true
      }
    }
    return menuitem
  }

  async renderMenu(req, uri, name, config, pathComponents, indexPath) {
    if (config.menu) {

//      config.menu = [{
//        base: "/",
//        text: "Configure",
//        href: `env/api/${name}/ENVIRONMENT`,
//        icon: "fa-solid fa-gear",
//        mode: "refresh"
////      }, {
////        base: "/",
////        text: "Public Share",
////        action: {
////          method: "env.set",
////          params: {
////            "PINOKIO_SHARE_CLOUDFLARE": true,
////            "PINOKIO_SHARE_LOCAL": true
////          }
////        },
////        href: `env/api/${name}/ENVIRONMENT`,
////        icon: "fa-solid fa-gear"
//      }].concat(config.menu)

      let launcher_root = req.launcher_root || ""

      for(let i=0; i<config.menu.length; i++) {
        let menuitem = config.menu[i]
        if (menuitem.menu) {
          let newIndexPath
          if (indexPath) {
            newIndexPath = indexPath + "." + i
          } else {
            newIndexPath = "" + i
          }
          let m = await this.renderMenu(req, uri, name, { menu: menuitem.menu }, pathComponents, newIndexPath)
          menuitem.menu = m.menu
        }

        if (menuitem.base && menuitem.base.startsWith("/")) {
          config.menu[i].href = menuitem.base + menuitem.href
        } else {
          if (menuitem.href && !menuitem.href.startsWith("http")) {

            // href resolution
            if (menuitem.fs) {
              // file explorer
              config.menu[i].href = path.resolve(this.kernel.homedir, "api", name, launcher_root, menuitem.href)
            } else if (menuitem.command) {
              // file explorer
              config.menu[i].href = path.resolve(this.kernel.homedir, "api", name, launcher_root, menuitem.href)
            } else {
              if (menuitem.href.startsWith("/")) {
                config.menu[i].href = menuitem.href
              } else {
                let absolute = path.resolve(__dirname, ...pathComponents, menuitem.href)
                let seed = path.resolve(__dirname)
                let p = absolute.replace(seed, "")
                let link = p.split(/[\/\\]/).filter((x) => { return x }).join("/")
                if (launcher_root) {
                  config.menu[i].href = "/api/" + name + "/" + launcher_root + "/" + link
                } else {
                  config.menu[i].href = "/api/" + name + "/" + link
                }
              }
            }
          } else if (menuitem.run) {
            let rendered = this.kernel.template.render(menuitem, {})
            // file explorer
            if (typeof rendered.run === "object") {
              let run = rendered.run
              config.menu[i].run = run.message
              if (launcher_root) {
                config.menu[i].cwd = run.path ? path.resolve(this.kernel.homedir, "api", name, launcher_root, run.path) : path.resolve(this.kernel.homedir, "api", name, launcher_root)
                config.menu[i].href = "/api/" + name + "/" + launcher_root
              } else {
                config.menu[i].cwd = run.path ? path.resolve(this.kernel.homedir, "api", name, run.path) : path.resolve(this.kernel.homedir, "api", name)
                config.menu[i].href = "/api/" + name
              }
            } else {
              config.menu[i].run = rendered.run
              config.menu[i].cwd = path.resolve(this.kernel.homedir, "api", launcher_root, name)
              if (launcher_root) {
                config.menu[i].href = "/api/" + name + "/" + launcher_root
              } else {
                config.menu[i].href = "/api/" + name
              }
            }
          }
        }

        if (menuitem.href && menuitem.params) {
          menuitem.href = menuitem.href + "?" + new URLSearchParams(menuitem.params).toString();
        }


        if (menuitem.shell) {
          if (launcher_root) {
            let basePath = this.kernel.path("api", name, launcher_root)
            this.renderShell(basePath, indexPath, i, menuitem)
          } else {
            let basePath = this.kernel.path("api", name)
            this.renderShell(basePath, indexPath, i, menuitem)
          }
        }

        if (menuitem.href) {
          let u
          let cwd
          if (menuitem.href.startsWith("http")) {
            menuitem.src = menuitem.href
          } else if (menuitem.href.startsWith("/")) {
            let run_path = "/run"
            if (menuitem.href.startsWith(run_path)) {
              menuitem.src = menuitem.href
//              u = new URL("http://localhost" + menuitem.href.slice(run_path.length))
//              cwd = u.searchParams.get("cwd")
//              u.search = ""
//              menuitem.src = u.pathname
            } else {
              u = new URL("http://localhost" + menuitem.href)
              cwd = u.searchParams.get("cwd")
              u.search = ""
              menuitem.src = u.pathname
            }
          } else {
            u = new URL("http://localhost/" + menuitem.href)
            cwd = u.searchParams.get("cwd")
            u.search = ""
            menuitem.src = u.pathname
          }

          // check running
          let fullpath = this.kernel.path(menuitem.src.slice(1))
          let relpath = path.relative(this.kernel.homedir, fullpath)
          if (relpath.startsWith("api")) {
            // api script
            if (this.kernel.api.running[fullpath]) {
              menuitem.running = true
            }
          } else {
            // prototype script
            let api_path
            if (launcher_root) {
              api_path = this.kernel.path("api", name, launcher_root)
            } else {
              api_path = this.kernel.path("api", name)
            }
            let id = `${fullpath}?cwd=${api_path}`
            if (this.kernel.api.running[id]) {
              menuitem.running = true
            }
          }

        }

        if (menuitem.action) {
          if (menuitem.action.method === "stop") {
            if (menuitem.action.uri) {
              let absolute = path.resolve(__dirname, ...pathComponents, menuitem.action.uri)
              let seed = path.resolve(__dirname)
              let p = absolute.replace(seed, "")
              let link = p.split(/[\/\\]/).filter((x) => { return x }).join("/")
              let uri = "~/api/" + name + "/" + link
              config.menu[i].action.uri = uri
            }
          }
        }






//        if (menuitem.href && menuitem.params) {
//          menuitem.href = menuitem.href + "?" + new URLSearchParams(menuitem.params).toString();
//        }



        // check on/off: if on/off exists => assume that it's a script
        // 1. check if the script is running
        if (menuitem.when) {
          let scriptPath = path.resolve(uri, name, menuitem.when)
          let filepath = scriptPath.replace(/\?.+/, "")
          let check = this.kernel.status(filepath)
          if (check) {
            // 2. if it's running, display the "on" HTML. If "on" doesn't exist, don't display anything
            if (menuitem.on) {
              if (menuitem.type === "label") {
                config.menu[i].label = menuitem.on
              } else {
                config.menu[i].btn = menuitem.on
              }
            }
          } else {
            // 3. If it's NOT running, display the "off" HTML, If "off" doesn't exist, don't display anything
            if (menuitem.off) {
              if (menuitem.type === "label") {
                config.menu[i].label = menuitem.off
              } else {
                config.menu[i].btn = menuitem.off
              }
            }
          }
        } else if (menuitem.filter) {
          if (menuitem.filter()) {
            if (menuitem.hasOwnProperty("html")) {
              if (menuitem.type === "label") {
                config.menu[i].label = menuitem.html
              } else {
                config.menu[i].btn = menuitem.html
              }
            }
          }
        } else {
          if (menuitem.hasOwnProperty("html")) {
            if (menuitem.type === "label") {
              config.menu[i].label = menuitem.html
            } else {
              config.menu[i].btn = menuitem.html
            }
          } else if (menuitem.hasOwnProperty("text")) {
            if (menuitem.hasOwnProperty("image")) {
              let imagePath
              if (menuitem.image.startsWith("/")) {
                imagePath = menuitem.image
              } else {
                if (launcher_root) {
                  imagePath = `/api/${name}/${launcher_root}/${menuitem.image}?raw=true`
                } else {
                  imagePath = `/api/${name}/${menuitem.image}?raw=true`
                }
              }
              menuitem.html = `<img class='menu-item-image' src='${imagePath}' /> ${menuitem.text}`
            } else if (menuitem.hasOwnProperty("icon")) {
              menuitem.html = `<i class="${menuitem.icon}"></i> ${menuitem.text}` 
            } else {
              menuitem.html = `${menuitem.text}` 
            }

            if (menuitem.href) {
              // button
              config.menu[i].btn = menuitem.html
            } else if (menuitem.action) {
              config.menu[i].btn = menuitem.html
            } else if (menuitem.menu) {
              config.menu[i].btn = menuitem.html
            } else {
              // label
              config.menu[i].label = menuitem.html
            }
          }
        }
        if (config.menu[i].popout) {
          config.menu[i].target = "_blank"
        } else {
          const targetBase = config.menu[i].id || config.menu[i].src || config.menu[i].href
          config.menu[i].target = targetBase ? "@" + targetBase : undefined
          if (config.menu[i].href) {
            config.menu[i].target_full = config.menu[i].href
          }
        }

        //if (config.menu[i].href && config.menu[i].href.startsWith("http")) {
        //  if (req.agent !== "electron") {
        //    config.menu[i].target = "_blank"
        //  }
        //}

        if (menuitem.shell_id) {
          config.menu[i].shell_id = menuitem.shell_id
        }


      }


      config.menu = config.menu.filter((item) => {
        return item.btn
      })


//      // get all proxies that belong to this repository
//      let childProxies = []
//      for(let scriptPath in this.kernel.api.proxies) {
//        let proxies = this.kernel.api.proxies[scriptPath]
//        for(let proxy of proxies) {
//          if (scriptPath.startsWith(this.kernel.path("api", name))) {
//            childProxies.push(proxy) 
//          }
//        }
//      }
//
//      let proxyMenu = []
//      for(let proxy of childProxies) {
//        proxyMenu.push({
//          btn: `<i class="fa-solid fa-wifi"></i> <strong>WiFi</strong>&nbsp;-&nbsp;${proxy.name}`,
//          target: "_blank",
//          href: proxy.proxy
//        })
//      }
//      config.menu = proxyMenu.concat(config.menu)
//
//      console.log("MENU", JSON.stringify(config.menu, null, 2))

//      if (!config.icon) {
//        if (this.theme === "light") {
//          config.icon = "/pinokio-black.png"
//        } else {
//          config.icon = "/pinokio-white.png"
//        }
//      }
      config = Util.rewrite_localhost(this.kernel, config, req.$source)
      return config
    } else {
      return config
    }
  }


  async _installed(name, type) {
    if (type === "conda") {
      return this.kernel.bin.installed.conda.has(name)
    } else if (type === "pip") {
      return this.kernel.bin.installed.pip && this.kernel.bin.installed.pip.has(name)
    } else if (type === "brew") {
      return this.kernel.bin.installed.brew.has(name)
    } else {
      // check kernel/bin/<module>.installed()
      let filepath = path.resolve(__dirname, "..", "kernel", "bin", name + ".js")
      let mod = this.kernel.bin.mod[name]
      let installed = false
      if (mod.installed) {
        installed = await mod.installed()
      }
      return installed
    }
  }
  async installed(r) {
    if (Array.isArray(r.name)) {
      for(let name of r.name) {
        let installed = await this._installed(name, r.type)
        if (!installed) return false
      }
      return true
    } else {
      let installed = await this._installed(r.name, r.type)
      return installed
    }
  }
  async sudo_exec(message, homedir) {
    // sudo-prompt uses TEMP
//    let TEMP = path.resolve(homedir, "cache", "TEMP")
//    await fs.promises.mkdir(TEMP, { recursive: true }).catch((e) => { })
    let response = await new Promise((resolve, reject) => {
//      let env = { TEMP }
      let env = {}
      if (process.env.path) env.path = process.env.path
      if (process.env.Path) env.Path = process.env.Path
      if (process.env.PATH) env.PATH = process.env.PATH
      sudo.exec(message, {
        name: "Pinokio",
        env,
      }, (err, stdout, stderr) => {
        if (err) {
          reject(err)
//        } else if (stderr) {
//          reject(stderr)
        } else {
          resolve(stdout)
        }
      });
    })
    return response
  }
  async mv(existing_home, new_home) {
    //// Next, empty the bin folder => need to reinitialize because of symlinks, etc. with the package managers
    console.log("RUNNING RM BIN")
    const path_to_delete = path.resolve(existing_home, "bin")
    let del_cmd
    if (this.kernel.platform === "win32") {
      del_cmd = `rd /s /q ${path_to_delete}`
    } else {
      del_cmd = `rm -rf ${path_to_delete}`
    }
    console.log("del_cmd", del_cmd)

    await this.sudo_exec(del_cmd, new_home)
    console.log("FINISHED RM BIN")

    console.log("RUNNING MV")
    let mv_cmd
    if (this.kernel.platform === "win32") {
      // robocoyp returns 1 when successful
      //mv_cmd = `start /wait (robocopy ${existing_home} ${new_home} /E /MOVE /NFL /NDL) ^& IF %ERRORLEVEL% LEQ 1 exit 0`
      //mv_cmd = `start /wait robocopy ${existing_home} ${new_home} /E /MOVE /NFL /NDL`
      mv_cmd = `start /wait robocopy ${existing_home} ${new_home} /E /MOVE /NFL`
      //mv_cmd = `start /wait robocopy ${existing_home} ${new_home} /E /MOVE /NFL`
    } else {
      mv_cmd = `mv ${existing_home} ${new_home}`
    }
    try {
      await this.sudo_exec(mv_cmd, existing_home)
    } catch (e) {
      console.log("ROBOCOPY RESULT", e)
    }
    console.log("FINISHED MV")
  }
  getPeerInfo() {
    let list = []
    let peers_info = {}
    if (this.kernel.peer.info) {
      peers_info = this.kernel.peer.info
      let remote_peers = Object.keys(this.kernel.peer.info).filter(x => x !== this.kernel.peer.host)
      let nodes = [this.kernel.peer.host].concat(remote_peers)
      for(let host of nodes) {
        let processes = []
        try {
          let procs = this.kernel.peer.info[host].proc
          let router = this.kernel.peer.info[host].router
          let port_mapping = this.kernel.peer.info[host].port_mapping
          for(let proc of procs) {
            let chunks = proc.ip.split(":")
            let internal_port = chunks[chunks.length-1]
            let internal_host = chunks.slice(0, chunks.length-1).join(":")
            let external_port = port_mapping[internal_port]

            let merged
            let external_ip
            if (external_port) {
              external_ip = `${host}:${external_port}`
//              merged = Array.from(new Set(router[external_ip].concat(router[proc.ip])))
            } else {
//              merged = router[proc.ip]
            }
            processes.push({
              external_router: router[external_ip] || [],
              internal_router: router[proc.ip] || [],
              //router: merged || [],
              external_ip,
              external_port: parseInt(external_port),
              internal_port: parseInt(internal_port),
              ...proc
            })
            //if (external_port) {
            //  let external_ip = `${host}:${external_port}`
            //  // merge router
            //  let merged = Array.from(new Set(router[external_ip].concat(router[proc.ip))
            //  processes.push({
            //    //proxy: this.kernel.caddy.mapping[item.ip] || [],
            //    //router: router[external_ip] || [],
            //    router: merged || [],
            //    external_ip,
            //    external_port: parseInt(external_port),
            //    internal_port: parseInt(internal_port),
            //    ...proc
            //  })
            //} else {
            //  processes.push({
            //    router: [],
            //    external_port: parseInt(external_port),
            //    internal_port: parseInt(internal_port),
            //    ...proc
            //  })
            //}
          }
          // merge processes
          // 1. 
          processes.sort((a, b) => {
            return b.external_port-a.external_port
          })
          list.push({
            host,
            name: this.kernel.peer.info[host].name,
            platform: this.kernel.peer.info[host].platform,
            processes
          })
        } catch (e) {
        }
      }
//      console.log("Loaded yet?", nodes.length, Object.keys(peers_info).length, nodes.length === Object.keys(peers_info).length)
    }
    return list
  }
  scopeLabelForAccessPoint(scope) {
    if (!scope || typeof scope !== 'string') {
      return ''
    }
    const normalized = scope.trim().toLowerCase()
    switch (normalized) {
      case 'lan':
        return 'LAN'
      case 'cgnat':
        return 'VPN'
      case 'public':
        return 'Public'
      case 'loopback':
        return 'Local'
      case 'linklocal':
        return 'Link-Local'
      default:
        return ''
    }
  }
  async buildPeerAccessPoints() {
    const hostMap = new Map()
    const addHost = (candidate = {}) => {
      const raw = candidate && candidate.host ? candidate.host : candidate.address
      if (!raw || typeof raw !== 'string') {
        return
      }
      const host = raw.trim()
      if (!host) {
        return
      }
      if (candidate.shareable === false) {
        return
      }
      const existing = hostMap.get(host)
      const classify = () => {
        if (candidate.scope) {
          return candidate.scope
        }
        if (this.kernel && this.kernel.peer && typeof this.kernel.peer.classifyAddress === 'function') {
          const classification = this.kernel.peer.classifyAddress(host, false)
          return classification && classification.scope ? classification.scope : undefined
        }
        return undefined
      }
      const mergedScope = existing && existing.scope ? existing.scope : classify() || 'unknown'
      const mergedInterface = existing && existing.interface ? existing.interface : (candidate.interface || null)
      hostMap.set(host, {
        host,
        scope: mergedScope,
        interface: mergedInterface
      })
    }

    addHost({ host: this.kernel.peer.host })
    const candidates = Array.isArray(this.kernel.peer.host_candidates) ? this.kernel.peer.host_candidates : []
    candidates.forEach((candidate) => addHost(candidate))

    const accessPoints = []
    for (const meta of hostMap.values()) {
      const url = `http://${meta.host}:${DEFAULT_PORT}`
      let qr = null
      try {
        qr = await QRCode.toDataURL(url)
      } catch (_) {}
      accessPoints.push({
        ...meta,
        url,
        qr,
        scope_label: this.scopeLabelForAccessPoint(meta.scope)
      })
    }
    return accessPoints
  }
  async composePeerAccessPayload() {
    let peer_access_points = []
    try {
      peer_access_points = await this.buildPeerAccessPoints()
    } catch (error) {
      peer_access_points = []
    }
    let peer_url = `http://${this.kernel.peer.host}:${DEFAULT_PORT}`
    let peer_qr = null
    if (peer_access_points.length > 0) {
      peer_url = peer_access_points[0].url
      peer_qr = peer_access_points[0].qr
    } else {
      try {
        peer_qr = await QRCode.toDataURL(peer_url)
      } catch (_) {}
    }
    return { peer_access_points, peer_url, peer_qr }
  }

  async ensureLogsRootDirectory() {
    const logsRoot = path.resolve(this.kernel.path("logs"))
    await fs.promises.mkdir(logsRoot, { recursive: true })
    return logsRoot
  }
  async resolveLogsRoot(options = {}) {
    const workspace = typeof options.workspace === 'string' ? options.workspace.trim() : ''
    if (workspace) {
      const apiRoot = path.resolve(this.kernel.path("api"))
      const segments = workspace.replace(/\\+/g, '/').split('/').map((segment) => segment.trim()).filter((segment) => segment.length > 0 && segment !== '.')
      if (segments.length === 0) {
        throw new Error('Workspace not found')
      }
      const normalized = segments.join('/')
      const workspacePath = path.resolve(apiRoot, normalized)
      const relative = path.relative(apiRoot, workspacePath)
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Invalid workspace path')
      }
      let workspaceStats
      try {
        workspaceStats = await fs.promises.stat(workspacePath)
      } catch (error) {
        if (error.code === 'ENOENT') {
          throw new Error('Workspace not found')
        }
        throw error
      }
      if (!workspaceStats.isDirectory()) {
        throw new Error('Workspace path is not a directory')
      }
      const candidate = path.resolve(workspacePath, 'logs')
      await fs.promises.mkdir(candidate, { recursive: true })
      return {
        logsRoot: candidate,
        displayPath: this.formatLogsDisplayPath(candidate),
        title: normalized
      }
    }
    const logsRoot = await this.ensureLogsRootDirectory()
    return {
      logsRoot,
      displayPath: this.formatLogsDisplayPath(logsRoot),
      title: null
    }
  }
  sanitizeWorkspaceForFilename(workspace) {
    if (!workspace || typeof workspace !== 'string') {
      return 'workspace'
    }
    const sanitized = workspace.replace(/[^a-zA-Z0-9._-]/g, '_')
    return sanitized.length > 0 ? sanitized : 'workspace'
  }
  async removeRouterSnapshots(targetDir) {
    try {
      const entries = await fs.promises.readdir(targetDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && /^router-default-\d+\.json$/.test(entry.name)) {
          await fs.promises.rm(path.join(targetDir, entry.name)).catch(() => {})
        }
      }
    } catch (_) {}
  }
  formatLogsDisplayPath(absolutePath) {
    if (!absolutePath) {
      return ''
    }
    const systemHome = os.homedir ? path.resolve(os.homedir()) : null
    if (systemHome) {
      const relativeToSystem = path.relative(systemHome, absolutePath)
      if (!relativeToSystem || (!relativeToSystem.startsWith('..') && !path.isAbsolute(relativeToSystem))) {
        if (!relativeToSystem) {
          return '~'
        }
        const normalized = relativeToSystem.split(path.sep).join('/')
        return `~/${normalized}`
      }
    }
    const configuredHome = this.kernel.homedir ? path.resolve(this.kernel.homedir) : null
    if (configuredHome) {
      const relativeToConfigured = path.relative(configuredHome, absolutePath)
      if (!relativeToConfigured || (!relativeToConfigured.startsWith('..') && !path.isAbsolute(relativeToConfigured))) {
        if (!relativeToConfigured) {
          return '~'
        }
        const normalized = relativeToConfigured.split(path.sep).join('/')
        return `~/${normalized}`
      }
    }
    return absolutePath
  }
  formatLogsRelativePath(relativePath = '') {
    if (!relativePath || relativePath === '.') {
      return ''
    }
    return relativePath.split(path.sep).join('/')
  }
  resolveLogsAbsolutePath(logsRoot, requestedPath = '') {
    const trimmed = typeof requestedPath === 'string' ? requestedPath.trim() : ''
    const normalizedRequest = trimmed ? path.normalize(trimmed) : '.'
    const absolutePath = path.resolve(logsRoot, normalizedRequest)
    const relativePath = path.relative(logsRoot, absolutePath)
    if (relativePath && (relativePath.startsWith('..') || path.isAbsolute(relativePath))) {
      throw new Error('INVALID_LOGS_PATH')
    }
    return {
      absolutePath,
      relativePath: relativePath === '.' ? '' : relativePath
    }
  }

  async syncConfig() {

    // 1. THEME
    this.theme = this.kernel.store.get("theme") || "light"
    this.mode = this.kernel.store.get("mode") || "desktop"

    // when loaded in electron but in minimal mode,
    // the app is loaded in the web so the agent should be "web"
//    if (this.agent === "electron") {
//      if (this.mode === "minimal" || this.mode === "background") {
//        this.agent = "web"
//      }
//    }

    if (this.theme === "dark") {
      this.colors = {
        color: "#252527",
//        symbolColor: "white"
        symbolColor: "#F4F4F4"
//        color: "rgb(31, 29, 39)",
//        symbolColor: "#b7a1ff"
      }
    } else {
      this.colors = {
        //color: "white",
        color: "#F4F4F4",
//        color: "#F5F4FA",
        symbolColor: "#000000",
      }
    }
    //this.logo = (this.theme === 'dark' ?  "<img class='icon' src='/pinokio-white.png'>" : "<img class='icon' src='/pinokio-black.png'>")
    //this.logo = '<i class="fa-solid fa-house"></i>'
    this.logo = "<img src='/pinokio-black.png' class='icon'>"

    // 4. existing home is set + new home is set + existing home does NOT exist => delete the "home" field and DO NOT go through with the move command
    // 5. existing home is NOT set + new home is set => go through with the "home" setting procedure
    // 6. existing home is NOT set + new home is NOT set => don't touch anything => the homedir will be the default home

//    // 2. HOME
//    // 2.1. Check if the config includes NEW_HOME => if so,
//    //    - move the HOME folder to NEW_HOME
//    //    - set HOME=NEW_HOME
//    //    - remove NEW_HOME
//    let existing_home = this.kernel.store.get("home")
//    let new_home = this.kernel.store.get("new_home")
//
//    if (existing_home) {
//      let exists = await fse.pathExists(existing_home)
//      if (exists) {
//        if (new_home) {
//          let new_home_exists = await fse.pathExists(new_home)
//          if (new_home_exists) {
//            // - existing home is set
//            // - existing home exists
//            // - new home is set
//            // - new home exists already
//            //    => delete store.new_home ==> will load at store.home
//            this.kernel.store.delete("new_home")
//          } else {
//            // - existing home is set
//            // - existing home exists
//            // - new home is set
//            // - new home does not exist
//            //    => run mv()
//            //    => update store.home
//            //    => delete store.new_home
//            await this.mv(existing_home, new_home)
//            this.kernel.store.set("home", new_home)
//            this.kernel.store.delete("new_home")
//          }
//        } else {
//          // - existing home is set
//          // - existing home exists
//          // - new home is not set
//          //    => This is most typical scenario => don't touch anything => the homedir will be the existing home
//        }
//      } else {
//        if (new_home) {
//          // - existing home is set
//          // - but the existing home path DOES NOT exist
//          // - new home is set
//          //    => This is an invalid scenario => Just to avoid disaster, just delete store.home and delete store.new_home
//          //    => the app will load at ~/pinokio
//          this.kernel.store.delete("home")
//          this.kernel.store.delete("new_home")
//        } else {
//          // - existing home is set
//          // - but the existing home path DOES NOT exist
//          // - new home is NOT set
//          //    => This is an invalid scenario => just delete store.home
//          //    => the app will load at ~/pinokio
//          this.kernel.store.delete("home")
//        }
//      }
//    } else {
//      if (new_home) {
//        // - existing home is NOT set
//        // - new home is set
//        //    => update store.home
//        //    => delete store.new_home
//        this.kernel.store.set("home", new_home)
//        this.kernel.store.delete("new_home")
//      } else {
//        // - existing home is NOT set
//        // - new home is NOT set
//        //    => don't touch anything => will load at ~/pinokio
//      }
//    }
  }
  async setConfig(config) {
    let home = this.kernel.store.get("home") || process.env.PINOKIO_HOME
    let theme = this.kernel.store.get("theme")
    let mode = this.kernel.store.get("mode")
//    let drive = this.kernel.store.get("drive")

    let theme_changed = false

    // 1. Handle THEME
    if (config.theme) {
      if (config.theme !== theme) {
        theme_changed = true
      }
      this.kernel.store.set("theme", config.theme)
      //this.theme = config.theme
    }
    // 2. Handle HOME
    if (config.home) {
      // set "new_home"

      // if the home is different from the existing home, go forward
      if (config.home !== home) {
        const logHomeCheck = (...args) => {
          try {
            console.log('[home-check]', ...args)
          } catch (_) {
            // ignore logging failures
          }
        }
        const basename = path.basename(config.home)
        // check for invalid path
        let isValidPath = (basename !== '' && basename !== config.home)
        if (!isValidPath) {
          throw new Error("Invalid path: " + config.home)
        }

        const findExistingAncestor = async (p) => {
          let current = p
          while (true) {
            if (await fse.pathExists(current)) {
              return current
            }
            const parent = path.dirname(current)
            if (!parent || parent === current) {
              return null
            }
            current = parent
          }
        }

        const normalizeMountPath = (p) => {
          if (!p) return null
          // on Windows, strip extended-length/UNC prefixes so mountpoint matching is consistent
          if (process.platform === 'win32') {
            const lower = p.toLowerCase()
            if (lower.startsWith('\\\\?\\unc\\')) {
              p = '\\\\' + p.slice(8)
            } else if (lower.startsWith('\\\\?\\') || lower.startsWith('\\\\.\\')) {
              p = p.slice(4)
            }
          }
          const normalized = path.normalize(p)
          const { root } = path.parse(normalized)
          let result
          if (normalized === root) {
            result = root.replace(/\\/g, '/')
          } else {
            result = normalized.replace(/[\\/]+$/g, '').replace(/\\/g, '/')
          }
          // on Windows, drive letters and UNC hostnames can differ in case between user input and systeminformation
          // normalize to lowercase for comparisons
          return process.platform === 'win32' ? result.toLowerCase() : result
        }

        const resolvedHome = path.resolve(config.home)
        const ancestor = await findExistingAncestor(resolvedHome)
        if (!ancestor) {
          throw new Error("Invalid path: unable to locate parent volume for " + config.home)
        }
        logHomeCheck({ step: 'resolved', resolvedHome, ancestor })

        logHomeCheck({ step: 'accept' })

//        // check if the destination already exists => throw error
//        let exists = await fse.pathExists(config.home)
//        if (exists) {
//          throw new Error(`The path ${config.home} already exists. Please remove the folder and retry`)
//        }

        //this.kernel.store.set("new_home", config.home)
        this.kernel.store.set("home", config.home)
      }

    }

    let mode_changed = false
    if (config.mode) {
      if (config.mode !== mode) {
        mode_changed = true
      }
      this.kernel.store.set("mode", config.mode)
    }
//    // 3. Handle Drive
//    if (config.drive) {
//      // if the home is different from the existing home, go forward
//      if (config.drive !== drive) {
//        const basename = path.basename(config.drive)
//        // check for invalid path
//        let isValidPath = (basename !== '' && basename !== config.drive)
//        if (!isValidPath) {
//          throw new Error("Invalid path: " + config.home)
//        }
//
//        // check if the destination already exists => throw error
//        let exists = await fse.pathExists(config.drive)
//        if (exists) {
//          throw new Error(`The path ${config.drive} already exists. Please remove the folder and retry`)
//        }
//
//        this.kernel.store.set("drive", config.drive)
//      }
//
//    }


    home = this.kernel.store.get("home") || process.env.PINOKIO_HOME
    theme = this.kernel.store.get("theme")
    let new_home = this.kernel.store.get("new_home") || process.env.PINOKIO_HOME

    // Handle environment variables
    // HTTP_PROXY
    // HTTPS_PROXY
//    const updated = { }
//    if (config.HTTP_PROXY) {
//      updated.HTTP_PROXY = config.HTTP_PROXY
//    }
//    if (config.HTTPS_PROXY) {
//      updated.HTTPS_PROXY = config.HTTPS_PROXY
//    }
    if (this.kernel.homedir) {
      const updated = {
        HTTP_PROXY: config.HTTP_PROXY,
        HTTPS_PROXY: config.HTTPS_PROXY,
        NO_PROXY: config.NO_PROXY,
      }
      let fullpath = path.resolve(this.kernel.homedir, "ENVIRONMENT")
      await Util.update_env(fullpath, updated)
    }

    this.kernel.store.set("HTTP_PROXY", config.HTTP_PROXY)
    this.kernel.store.set("HTTPS_PROXY", config.HTTPS_PROXY)
    this.kernel.store.set("NO_PROXY", config.NO_PROXY)

    if (theme_changed) {
      await this.syncConfig()
      if (this.onrefresh) {
        try {
          this.onrefresh({ theme: this.theme, colors: this.colors })
        } catch (err) {
          console.error('[Pinokiod] onrefresh error', err)
        }
      }
    }

    if (mode_changed) {
      return {
        title: "Restart Required",
        text: "Please restart the app"
      }
    }
  }
  async startLogging(homedir) {
    if (!this.debug) {
      if (this.logInterval) {
        clearInterval(this.logInterval)
      }
      if (homedir) {
        let logsdir = path.resolve(homedir, "logs")
        await fs.promises.mkdir(logsdir, { recursive: true }).catch((e) => { console.log(e) })
        if (!this.log) {
          this.log = fs.createWriteStream(path.resolve(homedir, "logs/stdout.txt"))
          process.stdout.write = process.stderr.write = this.log.write.bind(this.log)
          this.logInterval = setInterval(async () => {
            try {
              let file = path.resolve(homedir, "logs/stdout.txt")
              let data = await fs.promises.readFile(file, 'utf8')
              let lines = data.split('\n')
              if (lines.length > 100000) {
                let str = lines.slice(-100000).join("\n")
                await fs.promises.writeFile(file, str)
              }
            } catch (e) {
              console.log("Log Error", e)
            }
          }, 1000 * 60 * 10)  // 10 minutes
        }
      }
    }
  }
  async running(port) {
    let p = port || DEFAULT_PORT
    const available = await Util.is_port_available(p)
    if (available) {
      return false
    } else {
      return true
    }
  }
  add_extra_urls(info) {
    if (!this.kernel.peer || !this.kernel.peer.info) {
      return
    }

    const ensureArray = (value) => {
      if (!value) return []
      return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean)
    }

    const normalizeHttpUrl = (value) => {
      if (!value) return null
      const str = String(value).trim()
      if (!str) return null
      if (/^https?:\/\//i.test(str)) {
        return str.replace(/^https:/i, 'http:')
      }
      return `http://${str}`
    }

    const normalizeHttpsUrl = (value) => {
      if (!value) return null
      const str = String(value).trim()
      if (!str) return null
      if (/^https?:\/\//i.test(str)) {
        return str.replace(/^http:/i, 'https:')
      }
      return `https://${str}`
    }

    const seen = new Set()

    const pushEntry = ({ host, name, ip, httpUrl, httpsUrls, description, icon, online = true }) => {
      const normalizedHttp = normalizeHttpUrl(httpUrl)
      const hostNameForAlias = host && host.name ? String(host.name).trim() : ''
      const peerSuffix = hostNameForAlias ? `.${hostNameForAlias}.localhost` : null

      const normalizedHttpsSet = new Set(
        ensureArray(httpsUrls)
          .map(normalizeHttpsUrl)
          .filter(Boolean)
      )

      if (host && host.local && peerSuffix) {
        for (const originalUrl of normalizedHttpsSet) {
          try {
            const parsed = new URL(originalUrl)
            if (parsed.hostname.endsWith(peerSuffix)) {
              const aliasHost = `${parsed.hostname.slice(0, -peerSuffix.length)}.localhost`
              if (aliasHost && aliasHost !== parsed.hostname) {
                let pathname = parsed.pathname || ''
                if (pathname === '/' || pathname === '') {
                  pathname = ''
                }
                const aliasUrl = `${parsed.protocol}//${aliasHost}${pathname}${parsed.search}${parsed.hash}`
                normalizedHttpsSet.add(aliasUrl)
              }
            }
          } catch (_) {
            // continue
          }
        }
      }

      const normalizedHttps = Array.from(normalizedHttpsSet)
      const ipValue = typeof ip === 'string' ? ip : (normalizedHttp ? normalizedHttp.replace(/^https?:\/\//i, '') : null)
      const selectedUrl = normalizedHttps[0] || normalizedHttp || null
      const protocol = normalizedHttps.length > 0 ? 'https' : (normalizedHttp ? 'http' : undefined)
      const hostKey = host && (host.ip || host.name) ? `${host.ip || host.name}` : 'unknown'
      const uniquenessKey = `${hostKey}|${name}|${ipValue || ''}|${selectedUrl || ''}`
      if (seen.has(uniquenessKey)) {
        return
      }
      seen.add(uniquenessKey)

      const entry = {
        online,
        host: { ...host },
        name,
        ip: ipValue,
        url: selectedUrl,
        protocol,
        urls: {
          http: normalizedHttp,
          https: normalizedHttps
        }
      }
      if (description) {
        entry.description = description
      }
      if (icon) {
        entry.icon = icon
      }
      info.push(entry)
    }

    for (const host of Object.keys(this.kernel.peer.info)) {
      const hostInfo = this.kernel.peer.info[host]
      if (!hostInfo) {
        continue
      }

      const hostMeta = {
        ip: host,
        local: this.kernel.peer.host === host,
        name: hostInfo.name,
        platform: hostInfo.platform,
        arch: hostInfo.arch
      }

      const rewrites = hostInfo.rewrite_mapping
      if (rewrites && typeof rewrites === 'object') {
        for (const key of Object.keys(rewrites)) {
          const rewrite = rewrites[key]
          if (!rewrite) {
            continue
          }
          const externalIp = Array.isArray(rewrite.external_ip) ? rewrite.external_ip[0] : rewrite.external_ip
          const httpsSources = [
            ...ensureArray(rewrite.external_router),
            ...ensureArray(rewrite.internal_router)
          ]
          pushEntry({
            host: hostMeta,
            name: `[Website] ${rewrite.name || key}`,
            ip: externalIp || null,
            httpUrl: externalIp,
            httpsUrls: Array.from(new Set(httpsSources))
          })
        }
      }

      const hostRouters = Array.isArray(hostInfo.router_info) ? hostInfo.router_info : []
      for (const route of hostRouters) {
        if (!route) {
          continue
        }
        const externalIp = Array.isArray(route.external_ip) ? route.external_ip[0] : route.external_ip
        const httpUrl = externalIp || null
        const httpsCandidates = Array.from(new Set([
          ...ensureArray(route.external_router),
          ...ensureArray(route.internal_router)
        ]))
        if (httpsCandidates.length === 0 && !httpUrl) {
          continue
        }
        pushEntry({
          host: hostMeta,
          name: route.title || route.name,
          ip: externalIp || null,
          httpUrl,
          httpsUrls: httpsCandidates,
          description: route.description,
          icon: route.icon || route.https_icon || route.http_icon
        })
      }

//      const installedApps = Array.isArray(hostInfo.installed) ? hostInfo.installed : []
//      for (const app of installedApps) {
//        if (!app) {
//          continue
//        }
//        const httpHref = Array.isArray(app.http_href) ? app.http_href[0] : app.http_href
//        const httpsCandidates = Array.from(new Set([
//          ...ensureArray(app.app_href),
//          ...ensureArray(app.https_href)
//        ]))
//        pushEntry({
//          host: hostMeta,
//          name: app.title || app.name || app.folder,
//          ip: httpHref ? httpHref.replace(/^https?:\/\//i, '') : null,
//          httpUrl: httpHref || null,
//          httpsUrls: httpsCandidates,
//          description: app.description,
//          icon: app.https_icon || app.http_icon || app.icon
//        })
//      }
    }
  }
  async terminals(filepath) {
    let venvs = await Util.find_venv(filepath)
    let terminal
    if (venvs.length > 0) {
      let terminals = []
      try {
        for(let i=0; i<venvs.length; i++) {
          let venv = venvs[i]
          let parsed = path.parse(venv)
          terminals.push(this.renderShell(filepath, i, 0, {
            icon: "fa-brands fa-python",
            title: "Python virtual environment",
            subtitle: this.kernel.path("api", parsed.name),
            text: `[venv] ${parsed.name}`,
            type: "Start",
            shell: {
              venv: venv,
              input: true,
            }
          }))
        }
      } catch (e) {
        console.log(e)
      }
      terminal = {
        icon: "fa-solid fa-terminal",
        title: "Shell",
        subtitle: "Open an interactive terminal in the browser",
        menu: terminals
      }
    } else {
      terminal = {
        icon: "fa-solid fa-terminal",
        title: "User Terminal",
        subtitle: "Work with the terminal directly in the browser",
        menu: [this.renderShell(filepath, 0, 0, {
          icon: "fa-solid fa-terminal",
          title: "Terminal",
          subtitle: filepath,
          text: `Terminal`,
          type: "Start",
          shell: {
            input: true
          }
        })]
      }
    }
    return terminal
  }
  async getPluginGlobal(req, config, terminal, filepath) {
//    if (!this.kernel.plugin.config) {
//      await this.kernel.plugin.init()
//    }
    if (config) {
      
      let c = structuredClone(config)
      let menu = structuredClone(terminal.menu)
      c.menu = c.menu.concat(menu)
      try {
        let info = new Info(this.kernel)
        info.cwd = () => {
          return filepath
        }
        let menu = c.menu.map((item) => {
          return {
            params: {
              cwd: filepath
            },
            ...item
          }
        })
//        let menu = await this.kernel.plugin.config.menu(this.kernel, info)
        let plugin = { menu }
        let uri = filepath
        await this.renderMenu(req, uri, filepath, plugin, [])

        function setOnlineIfRunning(obj) {
          if (Array.isArray(obj)) {
            for (const item of obj) setOnlineIfRunning(item);
          } else if (obj && typeof obj === 'object') {
            if (obj.running === true) obj.online = true;
            for (const key in obj) setOnlineIfRunning(obj[key]);
          }
        }

        setOnlineIfRunning(plugin)

        return plugin
      } catch (e) {
        console.log("getPlugin ERROR", e)
        return null
      }
    } else {
      return null
    }
  }
  async getPlugin(req, config, name) {
    if (config) {
      let c = structuredClone(config)
      try {

        let filepath = this.kernel.path("api", name)
        let terminal = await this.terminals(filepath)
        c.menu = c.menu.concat(terminal.menu)
        let menu = c.menu.map((item) => {
          return {
            params: {
              cwd: filepath,
            },
            ...item
          }
        })
        let plugin = { menu }
        let uri = this.kernel.path("api")
        await this.renderMenu(req, uri, name, plugin, [])
        return plugin
      } catch (e) {
        console.log("getPlugin ERROR", e)
        return null
      }
    } else {
      return null
    }
  }
  getPeers() {
    let list = []
    if (this.kernel.peer.active) {
      for(let key in this.kernel.peer.info) {
        let info = this.kernel.peer.info[key]
        if (info.active) {
          list.push(info)
        }
      }
    }
    return list
  }
  async check_router_up() {
    // check if caddy is runnign properly
    //    try https://pinokio.localhost
    //    if it works, proceed
    //    if not, redirect
    let https_running = false
    try {
      let res = await axios.get(`http://127.0.0.1:2019/config/`, {
        timeout: 2000
      })
      let test = /pinokio\.localhost/.test(JSON.stringify(res.data))
      if (test) {
        https_running = true
      }
    } catch (e) {
//      console.log(e)
    }
//    console.log({ https_running })
    if (!https_running) {
      return { error: "pinokio.host not yet available" }
    }


    // check if pinokio.localhost router is running
    let router_running = false
    let router = this.kernel.router.published()
    for(let ip in router) {
      let domains = router[ip]
      if (domains.includes("pinokio.localhost")) {
        router_running = true
        break
      }
    }
    if (!router_running) {
      return { error: "pinokio.localhost not yet available" }
    }

    return { success: true }
  }

  async start(options) {
    this.debug = false
    if (options) {
      if (Object.prototype.hasOwnProperty.call(options, 'debug')) {
        this.debug = options.debug
      }
      if (Object.prototype.hasOwnProperty.call(options, 'browser')) {
        this.browser = options.browser
      }
      if (typeof options.onrestart === 'function') {
        this.onrestart = options.onrestart
      }
      if (typeof options.onquit === 'function') {
        this.onquit = options.onquit
      }
      if (typeof options.onrefresh === 'function') {
        this.onrefresh = options.onrefresh
      }
    }

    if (this.listening) {
      // stop proxies
      for(let scriptPath in this.kernel.api.proxies) {
        try {
          // Turn off local sharing
          await this.kernel.api.stopProxy({
            script: scriptPath
          })

          // Turn off cloudflare sharing
          await this.kernel.stopCloudflare({
            path: scriptPath
          })
        } catch (e) {
        }
      }
      try {
        await this.httpTerminator.terminate();
      } catch (e) {
      }
//      try {
//        await this.exposeTerminator.terminate();
//      } catch (e) {
//      }
    }

    // configure from kernel.store
    await this.syncConfig()
    if (this.onrefresh) {
      try {
        this.onrefresh({ theme: this.theme, colors: this.colors })
      } catch (err) {
        console.error('[Pinokiod] onrefresh error', err)
      }
    }

    try {
      let _home = this.kernel.store.get("home") || process.env.PINOKIO_HOME
      if (_home) {
        await this.startLogging(_home)
      }
    } catch (e) {
      console.log("start logging attempt", e)
    }

    // determine port if port is not passed in

    if (!this.port) {
      this.port = DEFAULT_PORT
//      let platform = os.platform()
//      if (platform === 'linux') {
//        // on linux you are not allowed to listen on ports below 1024
//        this.port = 42000
//      } else {
//        const primary_port = 80
//        const secondary_port = 42000
//        const available = await Util.is_port_available(primary_port)
//        //const running = await Util.is_port_running(primary_port)
////        const running1 = await Util.port_running("localhost", primary_port)
////        const running2 = await Util.port_running("127.0.0.1", primary_port)
////        const running = running1 || running2
////        const available = !running
//        //const available = await portfinder.isAvailablePromise({ host: "0.0.0.0", port: primary_port })
//        console.log("check available", { primary_port, available })
//        if (available) {
//          this.port = primary_port
//        } else {
//          this.port = secondary_port 
//        }
//      }
    }

    let version = this.kernel.store.get("version")
    let home = this.kernel.store.get("home") || process.env.PINOKIO_HOME

    let needInitHome = false
    if (home) {
      if (version === this.version.pinokiod) {
        console.log("version up to date")
      } else {
        // For every update, this gets triggered exactly once.
        // 1. first mkdir if it doesn't exist (this step is irrelevant since at this point the home dir will exist)
        
        let exists = await this.kernel.exists(home)
        if (!exists) {
          await fs.promises.mkdir(home, { recursive: true })
        }

        needInitHome = true
        console.log("not up to date. update py.")
        // remove ~/bin/miniconda/py
        let p = path.resolve(home, "bin/py")
        console.log(`[TRY] reset ${p}`)
        await fse.remove(p)
        console.log(`[DONE] reset ${p}`)

        let p2 = path.resolve(home, "prototype/system")
        await fse.remove(p2)

        let p3 = path.resolve(home, "plugin")
        await fse.remove(p3)

        let p4 = path.resolve(home, "network/system")
        await fse.remove(p4)

        await this.ensureGitconfigDefaults(home)

        let prototype_path = path.resolve(home, "prototype")
        await fse.remove(prototype_path)
        

        console.log("[TRY] Updating to the new version")
        this.kernel.store.set("version", this.version.pinokiod)
        console.log("[DONE] Updating to the new version")


      }
    }
    // initialize kernel


    await this.kernel.init({ port: this.port})
    this.kernel.server_port = this.port
    this.kernel.peer.start(this.kernel)


    if (needInitHome) {
      await this.kernel.initHome()
    }

    if (this.kernel.homedir) {
      let ex = await this.kernel.exists(this.kernel.homedir, "ENVIRONMENT")
      if (!ex) {
        let str = await Environment.ENV("system", this.kernel.homedir, this.kernel)
        await fs.promises.writeFile(path.resolve(this.kernel.homedir, "ENVIRONMENT"), str)
      }
    }



    // start proxy for Pinokio itself
//    await this.kernel.api.startProxy("/", `http://127.0.0.1:${this.port}`, "/")

//    if (!debug) {
//      let logsdir = path.resolve(this.kernel.homedir, "logs")
//      await fs.promises.mkdir(logsdir, { recursive: true }).catch((e) => { })
//      if (!this.log) {
//        this.log = fs.createWriteStream(path.resolve(this.kernel.homedir, "logs/stdout.txt"))
//        process.stdout.write = process.stderr.write = this.log.write.bind(this.log)
//        process.on('uncaughtException', (err) => {
//          console.error((err && err.stack) ? err.stack : err);
//        });
//      }
//    }



//    await this.startLogging()

//    // check version from this.store
//    //let version = this.kernel.store.get("version")
//    // if the version is different from package.json version, run update logic
//    console.log({_homedir: this.kernel.homedir, version, pinokiod: this.version.pinokiod })
//    if (this.kernel.homedir) {
//      if (version === this.version.pinokiod) {
//        console.log("version up to date")
//      } else {
//      // update the py module if it's already installed
//        console.log("not up to date")
//
////        // give full permission to pinokio folder on windows
////        if (this.kernel.platform === "win32") {
////          console.log("1 Give full permission")
////          await this.kernel.bin.exec({
////            sudo: true,
////            message: `icacls ${this.kernel.homedir} /grant Users:(OI)(CI)F /T`
////          }, (stream) => {
////            console.log({ stream })
////          })
////          console.log("1 Give full permission done")
////        }
//
//
//        await new Promise((resolve, reject) => {
//          let interval = setInterval(async () => {
//            console.log("checking mod.py")
//            if (this.kernel.bin.mod && this.kernel.bin.mod.py) {
//              console.log("mod.py initialized!")
//              let installed = await this.kernel.bin.mod.py.installed()
//              console.log("py installed", installed)
//              if (installed) {
//                // update
//                console.log("update py")
//                await this.kernel.exec({
//                  message: "git pull",
//                  path: this.kernel.path("bin/py")
//                }, (e) => {
//                  console.log(e)
//                })
//              }
//              // after updating, set the version
//              console.log("set the version", this.version.pinokiod)
//              this.kernel.store.set("version", this.version.pinokiod)
//              console.log("RESTART")
//              clearInterval(interval)
//              resolve()
//            } else {
//              console.log("mod.py not initialized yet")
//            }
//          }, 1000)
//        })
//        this.listening = true   // set this.listening = true so all http connections get reset when restarting
//        await this.start(options)
//        console.log("RESTARTED")
//        return
//      }
//    }

    

    //await this.configure()

    this.started = false
    this.app = express();
    this.app.use(cors({
      origin: '*'
    }));

    this.app.use((req, res, next) => {
      const userAgent = req.get('User-Agent') || '';
      if (userAgent.includes("Pinokio")) {
        req.agent = "electron"
      } else {
        req.agent = "web"
      }
      next();
    })

    if (this.kernel.homedir) {
      this.app.use(express.static(this.kernel.path("web/public")))
      this.app.use('/prototype', express.static(this.kernel.path("prototype")))
    }
    this.app.use(express.static(path.resolve(__dirname, 'public')));
    this.app.use("/web", express.static(path.resolve(__dirname, "..", "..", "web")))
    this.app.set('view engine', 'ejs');
    this.app.use((req, res, next) => {
      let protocol = req.get('X-Forwarded-Proto') || "http"
      req.$source = {
        protocol,
        host: req.get("host")
      }
      next()
    })
    if (this.kernel.homedir) {
      this.app.set("views", [
        this.kernel.path("web/views"),
        path.resolve(__dirname, "views")
      ])
      let serve = express.static(this.kernel.homedir, { fallthrough: true, })
      let serve2 = express.static(this.kernel.homedir, { index: false, fallthrough: true, })
      let http_serve = express.static(this.kernel.homedir, {
        redirect: true,
      })
      let https_serve = express.static(this.kernel.homedir, {
        redirect: false,
      })
      this.app.use('/asset', serve, serveIndex(this.kernel.homedir, {icons: true, hidden: true, theme: this.theme }))
//      this.app.use("/asset", async (req, res, next) => {
//        let asset_path = this.kernel.path(req.path.slice(1), "index.html")
//        let exists = await this.exists(asset_path)
//        if (exists) {
//          return res.sendFile(asset_path)
//        } else {
//          let chunks = req.path.slice(1).split("/")
//          let parent_path = chunks.slice(0, -1).join("/")
//          res.redirect("/asset/" + parent_path)
//        }
//      })
      this.app.use('/asset', (req, res, next) => {
        if (req.path.match(/\.(png|jpg|jpeg|gif|ico|svg)$/)) {
          res.sendFile(path.resolve(__dirname, 'public', 'pinokio-black.png'));
        } else {
          next();
        }
      });
      this.app.use('/files', serve2, serveIndex(this.kernel.homedir, {icons: true, hidden: true, theme: this.theme }))
    } else {
      this.app.set("views", [
        path.resolve(__dirname, "views")
      ])
    }
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(cookieParser());
    this.app.use(session({
      secret: "secret",
      resave: false,
      saveUninitialized: false
    }))
    this.app.use((req, res, next) => {
      const originalRedirect = res.redirect;
      res.redirect = function (url) {
        console.log(`Redirect triggered: ${req.method} ${req.originalUrl} -> ${url}`);
        return originalRedirect.call(this, url);
      };
      next();
    });
    registerFileRoutes(this.app, {
      kernel: this.kernel,
      getTheme: () => this.theme,
      exists: (target) => this.exists(target),
    });

    this.app.get('/pinokio/notification-sounds', ex(async (req, res) => {
      const soundRoot = path.resolve(__dirname, 'public', 'sound');
      let entries = [];
      try {
        const dirEntries = await fs.promises.readdir(soundRoot, { withFileTypes: true });
        entries = dirEntries
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name)
          .filter((name) => NOTIFICATION_SOUND_EXTENSIONS.has(path.extname(name).toLowerCase()))
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      } catch (error) {
        if (error && error.code === 'ENOENT') {
          return res.json({ sounds: [] });
        }
        return res.status(500).json({
          error: 'Failed to enumerate notification sounds',
          details: error && error.message ? error.message : String(error || ''),
        });
      }

      const normalizeLabel = (filename) => {
        const withoutExt = filename.replace(/\.[^.]+$/, '');
        return withoutExt
          .replace(/[-_]+/g, ' ')
          .replace(/\b\w/g, (char) => char.toUpperCase());
      };

      const sounds = entries.map((filename) => {
        const encoded = filename.split('/').map(encodeURIComponent).join('/');
        return {
          id: filename,
          label: normalizeLabel(filename),
          url: `/sound/${encoded}`,
          filename,
        };
      });

      res.json({ sounds });
    }));
    /*
    this.app.get("/asset/*", ex((req, res) => {
      let pathComponents = req.params[0].split("/")
      let filepath = this.kernel.path(...pathComponents)
      console.log("req.originalUrl", req.originalUrl)
      console.log("pathComponents", pathComponents)
//      if (pathComponents.length === 2 && pathComponents[0] === "api") {
//        // ex: /asset/api/comfy.git
//        filepath = path.resolve(filepath, "index.html")
//      }
      try {
        if (req.query.frame) {
          let m = mime.lookup(filepath)
          res.type("text/plain")
        }
        //res.setHeader('Content-Disposition', 'inline');
        res.sendFile(filepath)
      } catch (e) {
        res.status(404).send(e.message);
      }
    }))
    */
    this.app.get("/tools", ex(async (req, res) => {
      const peerAccess = await this.composePeerAccessPayload()
      let list = this.getPeers()
      let installs = []
      for(let key in this.kernel.bin.installed) {
        let installed = this.kernel.bin.installed[key]
        let modules = Array.from(installed)
        if (modules.length > 0) {
          installs.push({
            package_manager: key,
            modules,
          })
        }
      }
      // add minimal
      const bundle_names = ["dev", "advanced_dev", "ai", "network"]
      let bundles = []
      let pending
      for(let bundle_name of bundle_names) {
        let result = await this.kernel.bin.check({
          bin: this.kernel.bin.preset(bundle_name)
        })
        if (result.requirements_pending) {
          pending = true
        }
        bundles.push({
          name: bundle_name,
          setup: "/setup/" + bundle_name + "?callback=/tools",
          ...result
        })
      }
      res.render("tools", {
        current_host: this.kernel.peer.host,
        ...peerAccess,
        pending,
        installs,
        bundles,
        version: this.version,
        portal: this.portal,
        logo: this.logo,
        theme: this.theme,
        agent: req.agent,
        list,
      })
    }))
    this.app.get("/agents", ex(async (req, res) => {
      let pluginMenu = []
      try {
        if (!this.kernel.plugin.config) {
          await this.kernel.plugin.init()
        } else {
          // Refresh the plugin list so newly downloaded plugins show up immediately
          await this.kernel.plugin.setConfig()
        }
        if (this.kernel.plugin && this.kernel.plugin.config && Array.isArray(this.kernel.plugin.config.menu)) {
          pluginMenu = this.kernel.plugin.config.menu
        }
      } catch (err) {
        console.warn('Failed to initialize plugins', err)
      }

      const apps = []
      try {
        const apipath = this.kernel.path("api")
        const entries = await fs.promises.readdir(apipath, { withFileTypes: true })
        for (const entry of entries) {
          let type
          try {
            type = await Util.file_type(apipath, entry)
          } catch (typeErr) {
            console.warn('Failed to inspect api entry', entry.name, typeErr)
            continue
          }
          if (!type || !type.directory) {
            continue
          }
          try {
            const meta = await this.kernel.api.meta(entry.name)
            const absolutePath = meta && meta.path ? meta.path : this.kernel.path("api", entry.name)
            let displayPath = absolutePath
            if (this.kernel.homedir && absolutePath.startsWith(this.kernel.homedir)) {
              const relative = path.relative(this.kernel.homedir, absolutePath)
              if (!relative || relative === '.' || relative === '') {
                displayPath = '~'
              } else if (!relative.startsWith('..')) {
                const normalized = relative.split(path.sep).join('/')
                displayPath = `~/${normalized}`
              }
            }
            apps.push({
              name: entry.name,
              title: meta && meta.title ? meta.title : entry.name,
              description: meta && meta.description ? meta.description : '',
              icon: meta && meta.icon ? meta.icon : "/pinokio-black.png",
              cwd: absolutePath,
              displayPath
            })
          } catch (metaError) {
            console.warn('Failed to load app metadata', entry.name, metaError)
            const fallbackPath = this.kernel.path("api", entry.name)
            apps.push({
              name: entry.name,
              title: entry.name,
              description: '',
              icon: "/pinokio-black.png",
              cwd: fallbackPath,
              displayPath: fallbackPath
            })
          }
        }
      } catch (enumerationError) {
        console.warn('Failed to enumerate api apps for plugin modal', enumerationError)
      }

      apps.sort((a, b) => {
        const at = (a.title || a.name || '').toLowerCase()
        const bt = (b.title || b.name || '').toLowerCase()
        if (at < bt) return -1
        if (at > bt) return 1
        return (a.name || '').localeCompare(b.name || '')
      })

      const peerAccess = await this.composePeerAccessPayload()
      const list = this.getPeers()
      res.render("agents", {
        current_host: this.kernel.peer.host,
        ...peerAccess,
        pluginMenu,
        apps,
        portal: this.portal,
        logo: this.logo,
        theme: this.theme,
        agent: req.agent,
        list,
      })
    }))
    this.app.get("/api/plugin/menu", ex(async (req, res) => {
      try {
        if (!this.kernel.plugin.config) {
          await this.kernel.plugin.init()
        }
        const pluginMenu = this.kernel.plugin && this.kernel.plugin.config && Array.isArray(this.kernel.plugin.config.menu)
          ? this.kernel.plugin.config.menu
          : []
        res.json({ menu: pluginMenu })
      } catch (error) {
        console.warn('Failed to load plugin menu for create launcher modal', error)
        res.json({ menu: [] })
      }
    }))
    this.app.get("/plugins", (req, res) => {
      res.redirect(301, "/agents")
    })
    this.app.get("/terminals", (req, res) => {
      res.redirect(301, "/agents")
    })
    this.app.get("/screenshots", ex(async (req, res) => {
      const peerAccess = await this.composePeerAccessPayload()
      let list = this.getPeers()
      res.render("screenshots", {
        current_host: this.kernel.peer.host,
        ...peerAccess,
        version: this.version,
        portal: this.portal,
        logo: this.logo,
        theme: this.theme,
        agent: req.agent,
        list,
      })
    }))
    this.app.get("/logs", ex(async (req, res) => {
      const peerAccess = await this.composePeerAccessPayload()
      const list = this.getPeers()
      const workspace = typeof req.query.workspace === 'string' ? req.query.workspace.trim() : ''
      let context
      const downloadUrl = workspace ? `/pinokio/logs.zip?workspace=${encodeURIComponent(workspace)}` : '/pinokio/logs.zip'
      try {
        context = await this.resolveLogsRoot({ workspace })
      } catch (error) {
        res.status(404).render("logs", {
          current_host: this.kernel.peer.host,
          ...peerAccess,
          portal: this.portal,
          logo: this.logo,
          theme: this.theme,
          agent: req.agent,
          list,
          logsRootDisplay: '',
          logsWorkspace: workspace || null,
          logsTitle: workspace || null,
          logsError: error && error.message ? error.message : 'Workspace not found',
          logsDownloadUrl: downloadUrl,
        })
        return
      }
      res.render("logs", {
        current_host: this.kernel.peer.host,
        ...peerAccess,
        portal: this.portal,
        logo: this.logo,
        theme: this.theme,
        agent: req.agent,
        list,
        logsRootDisplay: context.displayPath,
        logsWorkspace: workspace || null,
        logsTitle: context.title,
        logsError: null,
        logsDownloadUrl: downloadUrl,
      })
    }))
    this.app.get("/api/logs/tree", ex(async (req, res) => {
      const workspace = typeof req.query.workspace === 'string' ? req.query.workspace.trim() : ''
      let context
      try {
        context = await this.resolveLogsRoot({ workspace })
      } catch (error) {
        res.status(404).json({ error: error && error.message ? error.message : 'Workspace not found' })
        return
      }
      const logsRoot = context.logsRoot
      let descriptor
      try {
        descriptor = this.resolveLogsAbsolutePath(logsRoot, req.query.path || '')
      } catch (_) {
        res.status(400).json({ error: "Invalid path" })
        return
      }
      let stats
      try {
        stats = await fs.promises.stat(descriptor.absolutePath)
      } catch (error) {
        res.status(404).json({ error: "Path not found" })
        return
      }
      if (!stats.isDirectory()) {
        res.status(400).json({ error: "Path is not a directory" })
        return
      }
      let dirents
      try {
        dirents = await fs.promises.readdir(descriptor.absolutePath, { withFileTypes: true })
      } catch (error) {
        res.status(500).json({ error: "Failed to read directory", detail: error.message })
        return
      }
      const entries = []
      for (const dirent of dirents) {
        if (dirent.name === '.' || dirent.name === '..') {
          continue
        }
        const entryPath = path.join(descriptor.absolutePath, dirent.name)
        let entryStats
        try {
          entryStats = await fs.promises.stat(entryPath)
        } catch (error) {
          continue
        }
        const relativePath = path.relative(logsRoot, entryPath)
        entries.push({
          name: dirent.name,
          path: this.formatLogsRelativePath(relativePath),
          type: entryStats.isDirectory() ? "directory" : "file",
          size: entryStats.isDirectory() ? null : entryStats.size,
          modified: entryStats.mtime
        })
      }
      entries.sort((a, b) => {
        if (a.type === b.type) {
          return a.name.localeCompare(b.name)
        }
        return a.type === "directory" ? -1 : 1
      })
      res.set("Cache-Control", "no-store")
      res.json({
        path: this.formatLogsRelativePath(descriptor.relativePath),
        entries
      })
    }))
    this.app.get("/api/logs/stream", ex(async (req, res) => {
      const workspace = typeof req.query.workspace === 'string' ? req.query.workspace.trim() : ''
      let context
      try {
        context = await this.resolveLogsRoot({ workspace })
      } catch (error) {
        res.status(404).json({ error: error && error.message ? error.message : 'Workspace not found' })
        return
      }
      const logsRoot = context.logsRoot
      let descriptor
      try {
        descriptor = this.resolveLogsAbsolutePath(logsRoot, req.query.path || '')
      } catch (_) {
        res.status(400).json({ error: "Invalid path" })
        return
      }
      let stats
      try {
        stats = await fs.promises.stat(descriptor.absolutePath)
      } catch (error) {
        res.status(404).json({ error: "File not found" })
        return
      }
      if (!stats.isFile()) {
        res.status(400).json({ error: "Path is not a file" })
        return
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      })
      if (res.flushHeaders) {
        res.flushHeaders()
      }
      if (req.socket && req.socket.setKeepAlive) {
        req.socket.setKeepAlive(true)
      }
      if (req.socket && req.socket.setNoDelay) {
        req.socket.setNoDelay(true)
      }

      const sendEvent = (eventName, payload) => {
        if (res.writableEnded) {
          return
        }
        res.write(`event: ${eventName}
`)
        res.write(`data: ${JSON.stringify(payload)}

`)
      }
      res.write(`retry: 2000

`)

      let watcher
      let keepAliveTimer
      let closed = false
      const cleanup = () => {
        if (closed) {
          return
        }
        closed = true
        if (keepAliveTimer) {
          clearInterval(keepAliveTimer)
        }
        if (watcher) {
          watcher.close()
        }
        if (!res.writableEnded) {
          res.end()
        }
      }

      req.on("close", cleanup)
      req.on("error", cleanup)

      keepAliveTimer = setInterval(() => {
        if (!res.writableEnded) {
          res.write(`: keep-alive ${Date.now()}

`)
        }
      }, LOG_STREAM_KEEPALIVE_MS)

      const streamRange = (start, end) => {
        return new Promise((resolve, reject) => {
          if (end <= start) {
            resolve()
            return
          }
          const reader = fs.createReadStream(descriptor.absolutePath, {
            encoding: "utf8",
            start,
            end: end - 1
          })
          reader.on("data", (chunk) => {
            sendEvent("chunk", { data: chunk })
          })
          reader.on("error", reject)
          reader.on("end", resolve)
        })
      }

      const initialStart = Math.max(0, stats.size - LOG_STREAM_INITIAL_BYTES)
      sendEvent("snapshot", {
        path: this.formatLogsRelativePath(descriptor.relativePath),
        size: stats.size,
        truncated: initialStart > 0
      })
      try {
        await streamRange(initialStart, stats.size)
      } catch (error) {
        sendEvent("server-error", { message: error.message || "Failed to read log file" })
        cleanup()
        return
      }
      let cursor = stats.size
      sendEvent("ready", { cursor })

      try {
        watcher = fs.watch(descriptor.absolutePath, async (eventType) => {
          if (eventType === "rename") {
            sendEvent("rotate", { message: "File rotated or removed" })
            cleanup()
            return
          }
          try {
            const nextStats = await fs.promises.stat(descriptor.absolutePath)
            if (nextStats.size < cursor) {
              cursor = 0
              sendEvent("reset", { reason: "truncate" })
            }
            if (nextStats.size > cursor) {
              await streamRange(cursor, nextStats.size)
              cursor = nextStats.size
            }
          } catch (error) {
            sendEvent("server-error", { message: error.message || "Streaming stopped" })
            cleanup()
          }
        })
      } catch (error) {
        sendEvent("server-error", { message: error.message || "Unable to watch file" })
        cleanup()
      }
    }))
    this.app.get("/columns", ex(async (req, res) => {
      const originSrc = req.query.origin || req.get('Referrer') || '/';
      const targetSrc = req.query.target || originSrc;
      res.render("columns", {
        theme: this.theme,
        agent: req.agent,
        originSrc,
        targetSrc,
        src: originSrc
      })
    }))
    this.app.get("/rows", ex(async (req, res) => {
      const originSrc = req.query.origin || req.get('Referrer') || '/';
      const targetSrc = req.query.target || originSrc;
      res.render("rows", {
        theme: this.theme,
        agent: req.agent,
        originSrc,
        targetSrc,
        src: originSrc
      })
    }))


    this.app.get("/container", ex(async (req, res) => {
      res.render("container", {
        theme: this.theme,
        agent: req.agent,
        src: req.query.url
      })
    }))

    this.app.get("/bookmarklet", ex(async (req, res) => {
      const protocol = (req.$source && req.$source.protocol) || req.protocol || 'http';
      const host = req.get('host') || `localhost:${this.port}`;
      const baseUrl = `${protocol}://${host}`;
      const targetBase = `${baseUrl}/create?prompt=`;
      const safeTargetBase = targetBase.replace(/'/g, "\\'");
      const bookmarkletHref = `javascript:(()=>{window.open('${safeTargetBase}'+encodeURIComponent(window.location.href),'_blank');})();`;

      res.render("bookmarklet", {
        theme: this.theme,
        agent: req.agent,
        baseUrl,
        targetBase,
        bookmarkletHref
      });
    }))

    //let home = this.kernel.homedir
    //let home = this.kernel.store.get("home")
    this.app.get("/launch", ex(async (req, res) => {
      // parse the url
      /*
      is it https://<name>.localhost ?
        - is <name> already installed?
          - yes: display
          - no: 404
      else: 404
      */
      let url = req.query.url
      let u = new URL(url)
      let host = u.host
      let env = await Environment.get(this.kernel.homedir, this.kernel)
      let autolaunch = false
      if (env && env.PINOKIO_ONDEMAND_AUTOLAUNCH === "1") {
        autolaunch = true
      }
      let chunks = host.split(".")
      if (chunks[chunks.length-1] === "localhost") {
        // if <...>.<kernel.peer.name>.localhost
        let nameChunks


        // if <app_name>.<host_name>.localhost
        // if <app_name>.localhost
        // otherwise => redirect

        console.log("Chunks", chunks)

        if (chunks.length >= 2) {

          let apipath = this.kernel.path("api")
          let files = await fs.promises.readdir(apipath, { withFileTypes: true })
          let folders = []
          for(let file of files) {
            let type = await Util.file_type(apipath, file)
            if (type.directory) {
              folders.push(file.name)
            } 
          }

          let matched = false
          for(let folder of folders) {
            let pattern1 = `${folder}.${this.kernel.peer.name}.localhost`
            let pattern2 = `${folder}.localhost`
            if (pattern1 === chunks.join(".")) {
              matched = true
              nameChunks = chunks.slice(0, -2)
              break
            } else if (pattern2 === chunks.join(".")) {
              matched = true
              nameChunks = chunks.slice(0, -1)
              break
            }
          }
          if (!matched) {
            let peer_names = Array.from(this.kernel.peer.peers).filter((host) => {
              return host !== this.kernel.peer.host
            }).map((host) => {
              return this.kernel.peer.info[host].name
            })

            // look for any matching peer names
            // if exists, redirect to that host
            for(let name of peer_names) {
              if (host.endsWith(`.${name}.localhost`)) {
                res.redirect(`https://pinokio.${name}.localhost/launch?url=${url}`)
                return
              }
            }
          }
        } else {
          nameChunks = chunks
        }
        if (nameChunks) {
          let name = nameChunks.join(".")
          let api_path = this.kernel.path("api", name)
          let exists = await this.exists(api_path)
          if (exists) {
            let meta = await this.kernel.api.meta(name)
            let launcher = await this.kernel.api.launcher(name)
            let pinokio = launcher.script
            let launchable = false
            if (pinokio && pinokio.menu && pinokio.menu.length > 0) {
              launchable = true
            }
            res.render("start", {
              url,
              launchable,
              autolaunch,
              logo: this.logo,
              theme: this.theme,
              agent: req.agent,
              name: meta.title,
              image: meta.icon,
              link: `/p/${name}?autolaunch=${autolaunch ? "1" : "0"}`,
            })
            return
          }
        }
      }
      res.render("start", {
        url,
        launchable: false,
        autolaunch,
        logo: this.logo,
        theme: this.theme,
        agent: req.agent,
        name: "Does not exist",
        image: "/pinokio-black.png",
        link: null
      })
    }))
    const renderHomePage = ex(async (req, res) => {
      if (Object.prototype.hasOwnProperty.call(req.query, 'create')) {
        const protocol = (req.$source && req.$source.protocol) || req.protocol || 'http'
        const host = req.get('host') || `localhost:${this.port}`
        const baseUrl = `${protocol}://${host}`
        const target = new URL('/create', baseUrl)
        for (const [key, value] of Object.entries(req.query)) {
          if (key === 'create' || key === 'session') {
            continue
          }
          if (Array.isArray(value)) {
            value.forEach((val) => target.searchParams.append(key, val))
          } else if (value != null) {
            target.searchParams.set(key, value)
          }
        }
        res.redirect(target.pathname + target.search + target.hash)
        return
      }
      // check bin folder
//      let bin_path = this.kernel.path("bin/miniconda")
//      let bin_exists = await this.exists(bin_path)
//      if (!bin_exists) {
//        res.redirect("/setup")
//        return
//      }
      
//      if (!this.kernel.proto.config) {
//        await this.kernel.proto.init()
//      }
//      if (!this.kernel.plugin.config) {
//        await this.kernel.plugin.init()
//      }

      if (req.query.mode !== "settings" && !home) {
        res.redirect("/home?mode=settings")
        return
      }
      if (req.query.mode === "help") {
        let folders = {}
        if (this.kernel.homedir) {
          folders = {
            bin: path.resolve(this.kernel.homedir, "bin"),
            cache: path.resolve(this.kernel.homedir, "cache"),
            drive: path.resolve(this.kernel.homedir, "drive"),
          }
        }
        res.render("help", {
          version: this.version,
          logo: this.logo,
          theme: this.theme,
          agent: req.agent,
          ...folders
        })
        return
      }

      if (req.query.mode === 'settings') {

        let platform = os.platform()
        let _home
        if (platform === "win32") {
          _home = path.resolve(path.parse(os.homedir()).root, "pinokio");
        } else {
          _home = path.resolve(os.homedir(), "pinokio")
        }
        let system_env = {}
        if (this.kernel.homedir) {
          system_env = await Environment.get(this.kernel.homedir, this.kernel)
        }
        const hasHome = !!this.kernel.homedir
        let configArray = [{
          key: "home",
          val: this.kernel.homedir ? this.kernel.homedir : _home,
          placeholder: "Enter the absolute path to use as your Pinokio home folder (D\\pinokio, /Users/alice/pinokiofs, etc.)"
//        }, {
//          key: "drive",
//          val: path.resolve(this.kernel.homedir, "drive"),
//          description: ["Virtual drive folder (Don't change it unless you know what you're doing)"],
//          placeholder: "Pinokio virtual drives folder"
        }, {
          key: "theme",
          val: this.theme,
          options: ["light", "dark"]
        }, {
          key: "mode",
          val: this.mode,
          options: ["desktop", "background"]
        }, {
          key: "HTTP_PROXY",
          val: (system_env.HTTP_PROXY || ""),
          show_on_click: "#proxy",
          placeholder: "(Advanced) Only set if you are behind a proxy"
        }, {
          key: "HTTPS_PROXY",
          val: (system_env.HTTPS_PROXY || ""),
          show_on_click: "#proxy",
          placeholder: "(Advanced) Only set if you are behind a proxy"
        }, {
          key: "NO_PROXY",
          val: (system_env.NO_PROXY || ""),
          show_on_click: "#proxy",
          placeholder: "(Advanced) Only set if you are behind a proxy"
        }]
        let folders = {}
        if (this.kernel.homedir) {
          folders = {
            bin: path.resolve(this.kernel.homedir, "bin"),
            cache: path.resolve(this.kernel.homedir, "cache"),
            env: path.resolve(this.kernel.homedir, "ENVIRONMENT"),
            drive: path.resolve(this.kernel.homedir, "drive"),
          }
        }
        const peerAccess = await this.composePeerAccessPayload()
        let list = this.getPeers()
        res.render("settings", {
          current_host: this.kernel.peer.host,
          hasHome,
          ...peerAccess,
          list,
          platform,
          version: this.version,
          portal: this.portal,
          logo: this.logo,
          theme: this.theme,
          agent: req.agent,
          paths: [],
          config: configArray,
          query: req.query,
          ...folders
        })

        return
      }

      let apipath = this.kernel.path("api")
      let files = await fs.promises.readdir(apipath, { withFileTypes: true })

      let folders = []
      for(let file of files) {
        let type = await Util.file_type(apipath, file)
        if (type.directory) {
          folders.push(file.name)
        } 
      }
      let meta = {}
      for(let folder of folders) {
        meta[folder] = await this.kernel.api.meta(folder)
      }
      await this.render(req, res, [], meta)
    })

    this.app.get("/", ex(async (req, res) => {
      const protocol = (req.$source && req.$source.protocol) || req.protocol || 'http'
      const host = req.get('host') || `localhost:${this.port}`
      const baseUrl = `${protocol}://${host}`

      const wantsCreatePage = Object.prototype.hasOwnProperty.call(req.query, 'create')
      const initialUrl = new URL(wantsCreatePage ? '/create/page' : '/home', baseUrl)
      const defaultUrl = new URL('/home', baseUrl)

      for (const [key, value] of Object.entries(req.query)) {
        if (key === 'session' || key === 'create') {
          continue
        }
        if (Array.isArray(value)) {
          value.forEach((val) => {
            initialUrl.searchParams.append(key, val)
          })
        } else if (value != null) {
          initialUrl.searchParams.set(key, value)
        }
      }

      if (!home) {
        defaultUrl.searchParams.set('mode', 'settings')
      }

      const initialPath = initialUrl.pathname + initialUrl.search + initialUrl.hash
      const defaultPath = defaultUrl.pathname + defaultUrl.search + defaultUrl.hash

      res.render('layout', {
        platform: this.kernel.platform,
        theme: this.theme,
        agent: req.agent,
        initialPath,
        defaultPath,
        sessionId: typeof req.query.session === 'string' ? req.query.session : null
      })
    }))

    this.app.get("/create", ex(async (req, res) => {
      const protocol = (req.$source && req.$source.protocol) || req.protocol || 'http'
      const host = req.get('host') || `localhost:${this.port}`
      const baseUrl = `${protocol}://${host}`

      const initialUrl = new URL('/create/page', baseUrl)
      const defaultUrl = new URL('/home', baseUrl)

      for (const [key, value] of Object.entries(req.query)) {
        if (key === 'session' || key === 'create') {
          continue
        }
        if (Array.isArray(value)) {
          value.forEach((val) => initialUrl.searchParams.append(key, val))
        } else if (value != null) {
          initialUrl.searchParams.set(key, value)
        }
      }

      if (!home) {
        defaultUrl.searchParams.set('mode', 'settings')
      }

      res.render('layout', {
        platform: this.kernel.platform,
        theme: this.theme,
        agent: req.agent,
        initialPath: initialUrl.pathname + initialUrl.search + initialUrl.hash,
        defaultPath: defaultUrl.pathname + defaultUrl.search + defaultUrl.hash,
        sessionId: typeof req.query.session === 'string' ? req.query.session : null
      })
    }))

    this.app.get("/create/page", ex(async (req, res) => {
      const defaults = {}
      const templateDefaults = {}

      if (typeof req.query.prompt === 'string' && req.query.prompt.trim()) {
        defaults.prompt = req.query.prompt.trim()
      }
      if (typeof req.query.folder === 'string' && req.query.folder.trim()) {
        defaults.folder = req.query.folder.trim()
      }
      if (typeof req.query.tool === 'string' && req.query.tool.trim()) {
        defaults.tool = req.query.tool.trim()
      }

      for (const [key, value] of Object.entries(req.query)) {
        if ((key.startsWith('template.') || key.startsWith('template_')) && typeof value === 'string') {
          const name = key.replace(/^template[._]/, '')
          if (name) {
            templateDefaults[name] = value.trim()
          }
        }
      }

      if (Object.keys(templateDefaults).length > 0) {
        defaults.templateValues = templateDefaults
      }

      res.render('create', {
        theme: this.theme,
        agent: req.agent,
        logo: this.logo,
        portal: this.portal,
        paths: [],
        defaults,
      })
    }))

    this.app.get("/home", renderHomePage)


    this.app.get("/bundle/:name", ex(async (req, res) => {
      let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
        bin: this.kernel.bin.preset(req.params.name),
      })
      if (!requirements_pending && install_required) {
        res.json({
          available: false,
        })
      } else {
        res.json({
          available: true,
        })
      }
    }))

    this.app.get("/init", ex(async (req, res) => {
      /*
        option 1: new vs. clone
        - new|clone
        
        option 2: type
          - empty
          - cli app
          - documentation
          - nodejs project
          - python project
            - gradio + torch

        option 3: ai vs. empty
          - prompt

      */

      let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
        bin: this.kernel.bin.preset("dev"),
      })
      if (!requirements_pending && install_required) {
        res.redirect(`/setup/dev?callback=${req.originalUrl}`)
        return
      }

      const peerAccess = await this.composePeerAccessPayload()
      let list = this.getPeers()
      let ai = await this.kernel.proto.ai()
      ai = [{
        title: "Use your own AI recipe",
        description: "Enter your own markdown instruction for AI",
        placeholder: "(example: 'build a launcher for https://github.com/comfyanonymous/ComfyUI)",
        meta: {},
        content: ""
      }].concat(ai)
      res.render("init/index", {
        list,
        ai,
        current_host: this.kernel.peer.host,
        ...peerAccess,
        cwd: this.kernel.path("api"),
        name: null,
//        name: req.params.name,
        portal: this.portal,
//        items,
        logo: this.logo,
        platform: this.kernel.platform,
        theme: this.theme,
        agent: req.agent,
        kernel: this.kernel,
      })
      /*
      let config = structuredClone(this.kernel.proto.config)
      console.log(config)
      config = this.renderMenu2(config, {
        cwd: req.query.path,
        href: "/prototype/show",
        path: this.kernel.path("prototype/system"),
        web_path: "/asset/prototype/system"
      })
      res.render("prototype/index", {
        config,
        path: req.query.path,
        portal: this.portal,
//        items,
        logo: this.logo,
        platform: this.kernel.platform,
        theme: this.theme,
        agent: this.agent,
        kernel: this.kernel,
      })
      */
    }))
    this.app.get("/check_router_up", ex(async (req, res) => {
      let response = await this.check_router_up()
      res.json(response)
    }))

    /*
    GET /connect => display connection options
    - github
    - x
    */
    this.app.get("/connect", ex(async (req, res) => {
      let list = this.getPeers()
      let current_urls = await this.current_urls(req.originalUrl.slice(1))
      let items = [{
//        image: "/pinokio-black.png",
//        name: "pinokio",
//        title: "pinokio.co",
//        description: "Connect with pinokio.co",
//        url: "/connect/pinokio"
//      }, {
        emoji: "🤗",
        name: "huggingface",
        title: "huggingface.co",
        description: "Connect with huggingface.co",
        url: "/connect/huggingface"
      }, {
        icon: "fa-brands fa-github",
        name: "github",
        title: "github.com",
        description: "Connect with GitHub.com",
        url: "/github"
      }, {
        icon: "fa-brands fa-square-x-twitter",
        name: "x",
        title: "x.com",
        description: "Connect with X.com",
        url: "/connect/x"
      }]
      let github_hosts = await this.get_github_hosts()
      for(let i=0; i<items.length; i++) {
        try {
          if (items[i].name === "github") {
            if (github_hosts.length > 0) {
              items[i].profile = {
                icon: "fa-brands fa-github",
                items: [{
                  key: "config",
                  val: github_hosts
                }]
              }
              items[i].description = `<i class="fa-solid fa-circle-check"></i> Connected with ${items[i].title}`
              items[i].connected = true
            }
          } else {
            const config = this.kernel.connect.config[items[i].name]
            if (config) {
              let profile = await this.kernel.connect.profile(items[i].name)
              if (profile) {
                items[i].profile = profile 
                items[i].description = `<i class="fa-solid fa-circle-check"></i> Connected with ${items[i].title}`
                items[i].connected = true
              }
            }
          }
        } catch (e) {
        }
      }
      const peerAccess = await this.composePeerAccessPayload()
      res.render(`connect`, {
        current_urls,
        current_host: this.kernel.peer.host,
        ...peerAccess,
        list,
        portal: this.portal,
        logo: this.logo,
        theme: this.theme,
        agent: req.agent,
        items,
      })
    }))
    /*
    *  GET /connect/x
    *  GET /connect/discord
    */
    this.app.get("/connect/:provider", ex(async (req, res) => {

      // check if all the connect related modules are installed
      let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
        bin: this.kernel.bin.preset("connect"),
      })
      if (!requirements_pending && install_required) {
        console.log("REDIRECT", req.params.provider)
        res.redirect("/setup/connect?callback=/connect/" + req.params.provider)
        return
      }

      let https_running = false
      try {
        let res = await axios.get(`http://127.0.0.1:2019/config/`, {
          timeout: 2000
        })
        let test = /pinokio\.localhost/.test(JSON.stringify(res.data))
        if (test) {
          https_running = true
        }
      } catch (e) {
        console.log(e)
      }
      if (!https_running) {
//        res.json({ error: "pinokio.host not yet available" })
        res.redirect("/setup/connect?callback=/connect/" + req.params.provider)
        return
      }


      // check if pinokio.localhost router is running
      let router_running = false
      let router = this.kernel.router.published()
      for(let ip in router) {
        let domains = router[ip]
        if (domains.includes("pinokio.localhost")) {
          router_running = true
          break
        }
      }
      if (!router_running) {
//        res.json({ error: "pinokio.localhost not yet available" })
        res.redirect("/setup/connect?callback=/connect/" + req.params.provider)
        return
      }


      let readme = ""
      let id = ""
      try {
        readme = await this.kernel.connect[req.params.provider].readme()
        id = this.kernel.connect[req.params.provider].id
      } catch (e) {
      }
      //res.render(`connect/${req.params.provider}`, {
      const config = this.kernel.connect.config[req.params.provider]
      const isPinokioHost = req.hostname === 'pinokio.localhost'
      const renderProtocol = isPinokioHost ? 'https' : 'http'
      res.render(`connect/index`, {
        protocol: renderProtocol,
        name: req.params.provider,
        config,
        portal: this.portal,
        logo: this.logo,
        theme: this.theme,
        agent: req.agent,
        id,
        readme
      })
    }))

    this.app.get("/connect/:provider/profile", ex(async (req, res) => {
      let response = await this.kernel.connect.profile(req.params.provider, req.body)
      res.send(response)
    }))
    /*
    *  POST /connect/x/login    => login and acquire auth token
    *  POST /connect/x/logout   => loout
    *  POST /connect/x/keys     => return the up-to-date token
    *  POST /connect/x/api      => make request
    *
    */
    this.app.post("/connect/:provider/login", ex(async (req, res) => {
      try {
        let response = await this.kernel.connect.login(req.params.provider, req.body)
        res.json(response)
      } catch (e) {
        res.json({ error: e.message })
      }
    }))
    this.app.post("/connect/:provider/logout", ex(async (req, res) => {
      try {
        await this.kernel.connect.logout(req.params.provider, req.body)
        res.json({ success: true })
      } catch (e) {
        res.json({ error: e.message })
      }
    }))
    this.app.post("/connect/:provider/keys", ex(async (req, res) => {
      try {
        let response = await this.kernel.connect.keys(req.params.provider)
        res.json(response)
      } catch (e) {
        res.json({ error: e.message })
      }
    }))
    this.app.post("/connect/:provider/api/:method", this.upload.any(), ex(async (req, res) => {
      try {
        let response = await this.kernel.connect.request(req.params.provider, req.params.method, req)
        res.json(response)
      } catch (e) {
        console.log("ERROR", e)
        res.json({ error: e.message })
      }
    }))
    this.app.post("/clipboard", ex(async (req, res) => {
      try {
        let r = await Util.clipboard(req.body)
        if (r) {
          res.json({ text: r })
        } else {
          res.json({ success: true })
        }
      } catch (e) {
        res.json({ error: e.stack })
      }
    }))
    this.app.post("/terminal/url-upload", ex(async (req, res) => {
      const payload = req.body || {}
      const id = typeof payload.id === 'string' ? payload.id.trim() : ''
      const cwd = typeof payload.cwd === 'string' ? payload.cwd : null
      const inputUrls = Array.isArray(payload.urls) ? payload.urls : []
      if (!id) {
        res.status(400).json({ error: 'terminal id is required' })
        return
      }
      if (inputUrls.length === 0) {
        res.status(400).json({ error: 'at least one url is required' })
        return
      }
      const normalized = []
      const hostHeader = typeof req.get === 'function' ? req.get('host') : null
      const baseOrigin = hostHeader ? `${req.protocol || 'http'}://${hostHeader}` : null
      const seen = new Set()
      for (const entry of inputUrls) {
        const rawHref = (entry && typeof entry === 'object') ? entry.href : entry
        const nameHint = entry && typeof entry === 'object' && typeof entry.name === 'string' ? entry.name : undefined
        if (typeof rawHref !== 'string') {
          continue
        }
        const trimmed = rawHref.trim()
        if (!trimmed) {
          continue
        }
        let resolved
        try {
          resolved = baseOrigin ? new URL(trimmed, baseOrigin) : new URL(trimmed)
        } catch (_) {
          try {
            resolved = new URL(trimmed)
          } catch (_) {
            continue
          }
        }
        if (!resolved || !/^https?:$/i.test(resolved.protocol)) {
          continue
        }
        const href = resolved.href
        if (seen.has(href)) {
          continue
        }
        seen.add(href)
        const item = { url: href }
        if (nameHint && nameHint.trim()) {
          item.name = nameHint.trim()
        }
        normalized.push(item)
      }
      if (normalized.length === 0) {
        res.status(400).json({ error: 'no valid urls' })
        return
      }
      const terminalApi = new TerminalApi()
      const requestPayload = {
        params: {
          id,
          cwd,
          files: normalized,
          buffers: {}
        }
      }
      try {
        const result = await terminalApi.upload(requestPayload, () => {}, this.kernel)
        const files = result && Array.isArray(result.files) ? result.files : []
        const errors = result && Array.isArray(result.errors) ? result.errors : []
        const shellEmit = result && typeof result.shellEmit === 'boolean' ? result.shellEmit : false
        const shellEmitAttempted = result && typeof result.shellEmitAttempted === 'boolean' ? result.shellEmitAttempted : false
        res.json({ files, errors, shellEmit, shellEmitAttempted })
      } catch (error) {
        res.status(500).json({ error: error && error.message ? error.message : 'remote upload failed' })
      }
    }))
    this.app.post("/push", ex(async (req, res) => {
      try {
        const payload = { ...(req.body || {}) }
        // Normalise audience and device targeting
        if (typeof payload.audience === 'string') {
          payload.audience = payload.audience.trim() || undefined
        }
        if (typeof payload.device_id === 'string') {
          payload.device_id = payload.device_id.trim() || undefined
        }
        const resolveAssetPath = (raw) => {
          if (typeof raw !== 'string') {
            return null
          }
          const trimmed = raw.trim()
          if (!trimmed) {
            return null
          }
          let candidate = trimmed
          if (/^https?:\/\//i.test(trimmed)) {
            try {
              const parsed = new URL(trimmed)
              candidate = parsed.pathname
            } catch (_) {
              return null
            }
          }
          if (!candidate.startsWith('/asset/')) {
            return null
          }
          const pathPart = candidate.split('?')[0].split('#')[0]
          const rel = pathPart.replace(/^\/asset\/+/, '')
          if (!rel) {
            return null
          }
          const parts = rel.split('/').filter(Boolean)
          if (!parts.length || parts.some((part) => part === '..')) {
            return null
          }
          try {
            return this.kernel.path(...parts)
          } catch (_) {
            return null
          }
        }
        const resolvePublicAsset = async (raw) => {
          if (typeof raw !== 'string') {
            return null
          }
          const trimmed = raw.trim()
          if (!trimmed || !trimmed.startsWith('/')) {
            return null
          }
          const relative = trimmed.replace(/^\/+/, '')
          if (!relative) {
            return null
          }
          const publicRoot = path.resolve(__dirname, 'public')
          const candidate = path.resolve(publicRoot, relative)
          if (!candidate.startsWith(publicRoot)) {
            return null
          }
          try {
            await fs.promises.access(candidate, fs.constants.R_OK)
            return candidate
          } catch (_) {
            return null
          }
        }
        const normaliseNotificationAsset = async (raw) => {
          const asset = resolveAssetPath(raw)
          if (asset) {
            return asset
          }
          const fallback = await resolvePublicAsset(raw)
          if (fallback) {
            return fallback
          }
          return null
        }
        if (typeof payload.image === 'string' && payload.image.trim()) {
          const resolvedImage = await normaliseNotificationAsset(payload.image)
          if (resolvedImage) {
            payload.image = resolvedImage
          }
        }
        if (typeof payload.sound === 'string') {
          const trimmedSound = payload.sound.trim()
          payload.sound = trimmedSound || undefined
        }
        delete payload.soundUrl
        delete payload.soundPath
        // For device-scoped notifications, suppress host OS notifier for remote origins,
        // but allow it when the request originates from the local machine
        if (payload.audience === 'device' && typeof payload.device_id === 'string' && payload.device_id) {
          try {
            if (this.socket && typeof this.socket.isLocalDevice === 'function') {
              payload.host = !!this.socket.isLocalDevice(payload.device_id)
            } else {
              payload.host = false
            }
          } catch (_) {
            payload.host = false
          }
        }
        Util.push(payload)
        res.json({ success: true })
      } catch (e) {
        res.json({ error: e.stack })
      }
    }))
    this.app.post("/runcmd", ex(async (req, res) => {
      //Util.openfs(req.body.path, req.body.mode)
      let cwd = req.body.cwd
      let cmd = req.body.run
      Util.run(cmd, cwd, this.kernel)
      res.json({ success: true })
    }))
    this.app.post("/go", ex(async (req, res) => {
      Util.openURL(req.body.url)
      res.json({ success: true })
    }))
    this.app.post("/openfs", ex(async (req, res) => {
      //Util.openfs(req.body.path, req.body.mode)
      if (req.body.name) {
        let filepath = this.kernel.path("api", req.body.name)
        Util.openfs(filepath, req.body, this.kernel)
      } else if (req.body.asset_path) {
        // asset_path : /asset/...
        // relpath : ...
        let relpath = req.body.asset_path.split("/").filter((x) => { return x }).slice(1).join("/")
        let filepath = this.kernel.path(relpath)
        Util.openfs(filepath, req.body, this.kernel)
      } else if (req.body.path) {
        Util.openfs(req.body.path, req.body, this.kernel)
      }
      res.json({ success: true })
    }))
    this.app.post("/keys", ex(async (req, res) => {
      let p = this.kernel.path("key.json")
      let keys  = (await this.kernel.loader.load(p)).resolved
      for(let host in req.body) {
        let updated = req.body[host]
        for(let indexStr in updated) {
          let index = parseInt(indexStr)
          keys[host][index] = updated[indexStr]
        }
      }
      await fs.promises.writeFile(p, JSON.stringify(keys, null, 2))
      res.json({ success: true })
    }))
    this.app.get("/keys", ex(async (req, res) => {
      let p = this.kernel.path("key.json")
      let keys  = (await this.kernel.loader.load(p)).resolved
      let items = []
      if (keys) {
        let sorted_keys = Object.keys(keys)
        sorted_keys.sort((a, b) => { return a > b })
        for(let key of sorted_keys) {
          items.push({
            host: key,
            vals: keys[key]
          })
        }
      }
      res.render("keys", {
        filepath: p,
        theme: this.theme,
        agent: req.agent,
        items
      })
    }))
    this.app.get("/docs", ex(async (req, res) => {
      let url = req.query.url
      const possiblePaths = [
        '/openapi.json',
        '/swagger.json',
        '/v1/openapi.json',
        '/v1/swagger.json',
        '/docs/openapi.json',
        '/api-docs',
        '/api-docs.json',
      ];
      let selected = null
      if (req.query.url) {
        const localHosts = ['localhost', '127.0.0.1', '::1'];
        const urlObj = new URL(req.query.url)
        const baseOrigins = [urlObj.origin];
        if (urlObj.hostname === 'localhost' || urlObj.hostname === '::1' || urlObj.hostname.startsWith('127.')) {
          for (const host of localHosts) {
            const origin = urlObj.origin.replace(urlObj.hostname, host);
            if (!baseOrigins.includes(origin)) {
              baseOrigins.push(origin);
            }
          }
        }

        for (const origin of baseOrigins) {
          for (const possiblePath of possiblePaths) {
            try {
              const url = new URL(possiblePath, origin).href;
              const res = await axios.get(url, { timeout: 500 });
              const contentType = res.headers['content-type'];
              if (contentType?.includes('application/json')) {
                const json = res.data;
                if (json.openapi || json.swagger) {
                  selected = json
                  break
                }
              }
            } catch (e) {
              console.log("error", e)
              // ignore errors
            }
          }
          if (selected) break
        }
      }
      let type = "redoc" // "swaggerui"
      if (req.query.type) {
        type = req.query.type
      }
      if (selected) {
        res.render(type, {
          spec: JSON.stringify(selected)
        })
      } else {
        res.render(type, {
          spec: null
        })
      }
    }))
    this.app.get("/github", ex(async (req, res) => {
      let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
        bin: this.kernel.bin.preset("connect"),
      })
      if (!requirements_pending && install_required) {
        res.redirect("/setup/connect?callback=/github")
        return
      }
      let md = await fs.promises.readFile(path.resolve(__dirname, "..", "kernel/connect/providers/github/README.md"), "utf8")
      let readme = marked.parse(md)

      let hosts = await this.get_github_hosts()

      let items
      if (hosts.length > 0) {
        // logged in => display logout
        items = [{
          icon: "fa-solid fa-circle-xmark",
          title: "Logout",
          description: "Log out of Github",
          url: "/github/logout"
        }]
      } else {
        // logged out => display login
        items = [{
          icon: "fa-solid fa-key",
          title: "Login",
          description: "Log into Github",
          url: "/github/login"
        }]
      }

      const gitConfigPath = this.kernel.path("gitconfig")
      const content = await fs.promises.readFile(gitConfigPath, 'utf-8');
      const gitconfig = ini.parse(content);
      res.render("github", {
        gitconfig,
        hosts,
        readme,
        portal: this.portal,
        logo: this.logo,
        theme: this.theme,
        agent: req.agent,
        items
//        items: [{
//          icon: "fa-solid fa-key",
//          title: "Login",
//          description: "Log into Github",
//          url: "/github/login"
////        }, {
////          icon: "fa-solid fa-check",
////          title: "Status",
////          description: "Check Github login status",
////          url: "/github/status"
//        }, {
//          icon: "fa-solid fa-circle-xmark",
//          title: "Logout",
//          description: "Log out of Github",
//          url: "/github/logout"
//        }]
      })
    }))
    this.app.post("/github/config", ex(async (req, res) => {
      const gitConfigPath = this.kernel.path("gitconfig")
      const content = await fs.promises.readFile(gitConfigPath, 'utf-8');
      const gitconfig = ini.parse(content);
      function set(obj, path, value) {
        const keys = path.split('.');
        let current = obj;
        for (let i = 0; i < keys.length - 1; i++) {
          const k = keys[i];
          if (!(k in current) || typeof current[k] !== 'object') {
            current[k] = {};
          }
          current = current[k];
        }
        current[keys[keys.length - 1]] = value;
      }
      for(let key in req.body) {
        set(gitconfig, key, req.body[key])
      }
      let text = ini.stringify(gitconfig)
      await fs.promises.writeFile(gitConfigPath, text)
      res.json({ success: true })

    }))
    this.app.get("/github/status", ex(async (req, res) => {
      let id = "gh_status"
      let params = new URLSearchParams()
      let message = "gh auth status"
      params.set("message", encodeURIComponent(message))
      params.set("path", this.kernel.homedir)
//      params.set("kill", "/Logged in/i")
      params.set("kill_message", "Click to return home")
      params.set("callback", encodeURIComponent("/github"))
      params.set("target", "_top")
      params.set("id", id)
      let url = `/shell/${id}?${params.toString()}`
      res.redirect(url)
    }))
    this.app.get("/github/logout", ex(async (req, res) => {
      let id = "gh_logout"
      let params = new URLSearchParams()
      let message = "gh auth logout"
      params.set("message", encodeURIComponent(message))
      params.set("path", this.kernel.homedir)
//      params.set("kill", "/Logged in/i")
//      params.set("kill_message", "Click to return home")
      params.set("callback", encodeURIComponent("/github"))
      params.set("id", id)
      params.set("target", "_top")
      let url = `/shell/${id}?${params.toString()}`
      res.redirect(url)
    }))
    this.app.get("/github/login", ex(async (req, res) => {
      let id = "gh_login"
      let params = new URLSearchParams()
      let delimiter
      if (this.kernel.platform === "win32") {
        delimiter = " && "; // must use &&. & doesn't necessariliy wait until the curruent command finishes
      } else {
        delimiter = " ; ";
      }
      let message = [
        "gh auth setup-git --hostname github.com --force",
        "gh auth login --web --clipboard --git-protocol https"
      ].join(delimiter)
      params.set("message", encodeURIComponent(message))
      params.set("input", true)
      params.set("path", this.kernel.homedir)
      params.set("kill", "/Logged in/i")
//      params.set("kill_message", "Your Github account is now connected.")
      params.set("callback", encodeURIComponent("/github"))
      params.set("id", id)
      params.set("target", "_top")
      let url = `/shell/${id}?${params.toString()}`
      res.redirect(url)
    }))
    this.app.get("/shell/:id", ex(async (req, res) => {
      /*
        req.query := {
          path (required),    // api, bin, prototype, network, api/
          message (optional), // if not specified, start an empty shell
          venv,
          callback,
          kill,               // regex for killing
          on.<regex1>: <key>,
          on.<regex2>: <key>,
          env.<key1>,
          env.<key2>,
          ...
        }
      */

      // create a new term from cwd

      /*
      GET /shell/:unix_path => shell id: 'shell/:unix_path'
      */

      let baseShellId = "shell/" + decodeURIComponent(req.params.id)
      const sessionId = typeof req.query.session === "string" && req.query.session.length > 0 ? req.query.session : null
      let id = baseShellId
      if (sessionId) {
        id = `${baseShellId}?session=${sessionId}`
      }
      let target = req.query.target ? req.query.target : null
      let cwd = this.kernel.path(this.kernel.api.filePath(decodeURIComponent(req.query.path)))
      let message = req.query.message ? decodeURIComponent(req.query.message) : null
      //let message = req.query.message ? req.query.message : null
      let venv = req.query.venv ? decodeURIComponent(req.query.venv) : null
      let input = req.query.input ? true : false
      let callback = req.query.callback ? decodeURIComponent(req.query.callback) : null
      let callback_target = req.query.callback_target ? decodeURIComponent(req.query.callback_target) : null
      let kill_message = req.query.kill_message ? decodeURIComponent(req.query.kill_message) : null
      let done_message = req.query.done_message ? decodeURIComponent(req.query.done_message) : null
      let kill = req.query.kill ? decodeURIComponent(req.query.kill) : null
      let done = req.query.done ? decodeURIComponent(req.query.done) : null
      let env = {}
      for(let env_key in req.query) {
        if (env_key.startsWith("env.")) {
          let chunks = env_key.split(".")
          let key = chunks.slice(1).join(".")
          env[key] = req.query[env_key]
        }
      }
      let conda = {}
      let conda_exists = false
      for(let conda_key in req.query) {
        if (conda_key.startsWith("conda.")) {
          let chunks = conda_key.split(".")
          let key = chunks.slice(1).join(".")
          conda[key] = req.query[conda_key]
          conda_exists = true
        }
      }
//      let pattern = {}
//      for(let pattern_key in req.query) {
//        if (pattern_key.startsWith("pattern.")) {
//          let chunks = pattern_key.split(".")
//          let key = chunks.slice(1).join(".")
//          pattern[key] = req.query[pattern_key]
//        }
//      }

      let shell = this.kernel.shell.get(id)
      res.render("shell", {
        target,
        filepath: cwd,
        theme: this.theme,
        agent: req.agent,
        id,
        cwd,
        message,
        venv,
        conda: (conda_exists ? conda: null),
        env,
//        pattern,
        input,
        kill,
        kill_message,
        done,
        done_message,
        callback,
        callback_target,
        running: (shell ? true : false)
      })
    }))
    this.app.get("/pro", ex(async (req, res) => {
      let target = req.query.target ? req.query.target : null
      let cwd = this.kernel.path("api")
      res.render("pro", {
        target,
        cwd,
        theme: this.theme,
        agent: req.agent,
      })
    }))
//    this.app.get("/terminal/:api/:id", ex(async (req, res) => {
//      res.render("shell", {
//        theme: this.theme,
//        agent: this.agent,
//        cwd: this.kernel.path("api/" + req.params.api),
//        id: req.params.id
//      })
//    }))
    this.app.get("/peer_check", ex(async (req, res) => {
      if (this.kernel.peer.refreshing) {
        res.json({ updated: false })
      } else {
        let list = this.getPeerInfo()
        if (JSON.stringify(this.last_list) !== JSON.stringify(list)) {
          this.last_list = list
          res.json({ updated: true })
        } else {
          res.json({ updated: false })
        }
      }
    }))
    this.app.get("/setup", ex(async (req, res) => {
      let items = []
      for(let id in Setup) {
        let item = Setup[id](this.kernel)
        items.push({
          id,
          ...item
        })
      }
      res.render("setup_home", {
        filepath: path.resolve(this.kernel.homedir, "api"),
        items,
        portal: this.portal,
        logo: this.logo,
        theme: this.theme,
        agent: req.agent,
      })
    }))
    this.app.get("/setup/:mode", ex(async (req, res) => {
      /*
      1. mode:ai => all
      2. mode:coding => conda, nodejs, git
      3. mode:network => conda, git, caddy
      4. mode:connect => conda, git, caddy
      */

      let bin = this.kernel.bin.preset(req.params.mode)

      let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
        bin
      })
      // set dependencies for conda
      let cr = new Set()
      for(let i=0; i<requirements.length; i++) {
        let r = requirements[i]
        if (r.name === "conda") {
          requirements[i].dependencies = bin.conda_requirements
          if (bin.conda_requirements) {
            for(let r of bin.conda_requirements) {
              cr.add(r)
            }
          }
        }
      }

      // if the setup mode includes caddy, wait
      let wait = null
      if (cr.has("caddy")) {
        wait = "caddy"
      }

      let current = req.query.callback || req.originalUrl

//      console.log("2", { requirements_pending, install_required })
//      if (!requirements_pending && !install_required) {
//        console.log("redirect", current)
//        res.redirect(current)
//        return
//      }
//
      res.render("setup", {
        wait,
        error,
        current,
        install_required,
        requirements,
        requirements_pending,
        logo: this.logo,
        theme: this.theme,
        agent: req.agent,
      })
    }))
    this.app.post("/plugin/update_spec", ex(async (req, res) => {
      try {
        let filepath = req.body.filepath
        let content = req.body.spec
        let spec_path = path.resolve(filepath, "SPEC.md")
        await fs.promises.writeFile(spec_path, content)
        res.json({
          success: true
        })
      } catch (e) {
        res.error({
          error: e.stack
        })
      }
    }))
    this.app.post("/plugin/update", ex(async (req, res) => {
      try {
        await this.kernel.exec({
          message: "git pull",
          path: this.kernel.path("plugin/code")
        }, (e) => {
          console.log(e)
        })
        res.json({
          success: true
        })
      } catch (e) {
        res.json({
          error: e.stack
        })
      }
    }))
    this.app.post("/network/reset", ex(async (req, res) => {
      let caddy_path = this.kernel.path("cache/XDG_DATA_HOME/caddy")
      await rimraf(caddy_path)
      let caddy_path2 = this.kernel.path("cache/XDG_CONFIG_HOME/caddy")
      await rimraf(caddy_path2)

      let custom_network_path = path.resolve(home, "network/system")
      await fse.remove(custom_network_path)

      res.json({ success: true })
    }))
    this.app.get("/requirements_check/:name", ex(async (req, res) => {
      let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
        bin: this.kernel.bin.preset(req.params.name)
      })
      res.json({
        requirements,
        install_required,
        requirements_pending,
      })
    }))
    this.app.get("/net/:name/diff", ex(async (req, res) => {
      try {
        let processes = this.kernel.peer.info[this.kernel.peer.host].router_info
        let last_proc = JSON.stringify(this.kernel.last_processes)
        let current_proc = JSON.stringify(processes)
        this.kernel.last_processes = processes
        res.json({ diff: last_proc !== current_proc })
      } catch (e) {
        console.log("ERROR", e)
        res.json({ diff: true })
      }
    }))
    this.app.get("/net/:name", ex(async (req, res) => {
      let protocol = req.get('X-Forwarded-Proto') || "http"
      let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
        bin: this.kernel.bin.preset("network"),
      })

      if (!requirements_pending && install_required) {
        console.log("redirect to /setup/network")
        res.redirect("/setup/network?callback=/network")
        return
      }

      await this.kernel.peer.check_peers()

      let list = this.getPeers()

//      let list = this.getPeerInfo()
      let processes = []
      let host
      let peer
      for(let item of list) {
        if (item.name === req.params.name) {
          processes = item.processes
          host = item.host
          peer = item
        }
      }
      try {
        processes = this.kernel.peer.info[host].router_info
        for(let i=0; i<processes.length; i++) {
          if (!processes[i].icon) {
            if (protocol === "https") {
              processes[i].icon = processes[i].https_icon
            } else {
              // http
              processes[i].icon = processes[i].http_icon
            }
          }
        }
      } catch (e) {
      }
      let installed = this.kernel.peer.info[host].installed
      let serverless_mapping = this.kernel.peer.info[host].rewrite_mapping
      let serverless = Object.keys(serverless_mapping).map((name) => {
        return serverless_mapping[name]
      })
      let current_urls = await this.current_urls(req.originalUrl.slice(1))
      let static_routes = Object.keys(this.kernel.router.rewrite_mapping).map((key) => {
        return this.kernel.router.rewrite_mapping[key]
      })
      const peerAccess = await this.composePeerAccessPayload()
      const allow_dns_creation = req.params.name === this.kernel.peer.name
      res.render("net", {
        static_routes,
        selected_name: req.params.name,
        current_urls,
        docs: this.docs,
        portal: this.portal,
        install: this.install,
        agent: req.agent,
        theme: this.theme,
        processes,
        installed,
        serverless,
        error: null,
        list,
        host,
        peer,
        protocol,
        current_host: this.kernel.peer.host,
        ...peerAccess,
        cwd: this.kernel.path("api"),
        allow_dns_creation,
      })
    }))
    this.app.get("/network", ex(async (req, res) => {
      let protocol = req.get('X-Forwarded-Proto')
      let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
        bin: this.kernel.bin.preset("network"),
      })

      if (!requirements_pending && install_required) {
        console.log("redirect to /setup/network")
        res.redirect("/setup/network?callback=/network")
        return
      }

//      let list = this.getPeerInfo()
//      console.log("peeerInfo", JSON.stringify(list, null, 2))
      await this.kernel.peer.check_peers()


      let peers = []
      for(let host in this.kernel.peer.info) {
        let peer_info = this.kernel.peer.info[host]
        peers.push({
          host,
          name: peer_info.name,
          domain: `https://pinokio.${peer_info.name}.localhost`,
          router: `https://pinokio.${peer_info.name}.localhost/proxy`
        })
      }

//      if (peers.length === 0) {
//        console.log("network not yet ready")
//        res.redirect("/")
//        return
//      }


      let live_proxies = this.kernel.api.proxies["/proxy"]
      if (!live_proxies) live_proxies = []
      let proxies = []
//      let proxies = [{
//        icon: "ollama.webp",
//        name: "Ollama",
//        target: 'http://127.0.0.1:11434',
//        port: 44002
//      }, {
//        icon: "lmstudio.jpg",
//        name: "LMStudio",
//        target: 'http://127.0.0.1:1234',
//        port: 44003
//      }]
      for(let i=0; i<proxies.length; i++) {
        proxies[i].running = false
        for(let live_proxy of live_proxies) {
          if (live_proxy.name === proxies[i].name) {
            proxies[i].running = true 
            proxies[i].proxy = live_proxy.proxy
            proxies[i].qr = await QRCode.toDataURL(live_proxy.proxy)
          }
        }
      }

      let pinokio_proxy = this.kernel.api.proxies["/"]
      let pinokio_cloudflare = this.cloudflare_pub

      let qr = null
      let qr_cloudflare = null
      let home_proxy = null
      if (pinokio_proxy && pinokio_proxy.length > 0) {
        qr = await QRCode.toDataURL(pinokio_proxy[0].proxy)
        home_proxy = pinokio_proxy[0]
      }

      let icon
      if (this.theme === "dark") {
        icon = "pinokio-white.png"
      } else {
        icon = "pinokio-black.png"
      }


      // App sharing
      let apipath = this.kernel.path("api")
      let files = await fs.promises.readdir(apipath, { withFileTypes: true })
      let folders = []
      for(let file of files) {
        let type = await Util.file_type(apipath, file)
        if (type.directory) {
          folders.push(file.name)
        } 
      }
      let apps = []
      for(let folder of folders) {
        let meta = await this.kernel.api.meta(folder)
//        meta.link = `/pinokio/browser/${folder}/browse#n1`,
//        meta.icon = meta.icon ? `/api/${folder}/${meta.icon}?raw=true` : null
//        meta.name = meta.title
        apps.push(meta)
      }


      let current_urls = await this.current_urls(req.originalUrl.slice(1))
      let current_peer = this.kernel.peer.info ? this.kernel.peer.info[this.kernel.peer.host] : null
      let host = null
      if (current_peer) {
        host = current_peer.host
      }
      let peer = current_peer

      let processes = []
      try {
        if (current_peer) {
          processes = current_peer.router_info
          for(let i=0; i<processes.length; i++) {
            if (!processes[i].icon) {
              if (protocol === "https") {
                processes[i].icon = processes[i].https_icon
              } else {
                // http
                processes[i].icon = processes[i].http_icon
              }
            }
          }
        }
      } catch (e) {
        console.log("ERROR", e)
      }

  //      let processes = current_peer.processes

      let favicons = {}
      let titles = {}
      let descriptions = {}


      let list = this.getPeers()
      let installed = this.kernel.peer.info && this.kernel.peer.info[host] ? this.kernel.peer.info[host].installed : []

      let static_routes = Object.keys(this.kernel.router.rewrite_mapping).map((key) => {
        return this.kernel.router.rewrite_mapping[key]
      })
      const peerAccess = await this.composePeerAccessPayload()
      res.render("network", {
        static_routes,
        host,
        favicons,
        titles,
        descriptions,
        processes,
        installed,
        error: null,


        current_urls,
        requirements_pending,
        install_required,
        docs: this.docs,
        portal: this.portal,
        install: this.install,
        current_host: this.kernel.peer.host,
        peers,
        list,
        name: this.kernel.peer.name,
        https_active: this.kernel.router.active,
        peer_active: this.kernel.peer.active,
        port_mapping: this.kernel.router.port_mapping,
//        port_mapping: this.kernel.caddy.port_mapping,
        ...peerAccess,
//        ip_mapping: this.kernel.caddy.ip_mapping,
        lan: this.kernel.router.local_network_mapping,
        agent: req.agent,
        theme: this.theme,
        items: proxies,
        qr,
        proxy: home_proxy,
        localhost: `http://localhost:${this.port}`,
        icon,
        apps
      })
    }))
    this.app.get("/getlog", ex(async (req, res) => {
      let str = await fs.promises.readFile(req.query.logpath, "utf8")
      res.send(str)
    }))
    this.app.post("/mkdir", ex(async (req, res) => {
      let folder = req.body.folder
      let folder_path = path.resolve(this.kernel.api.userdir, req.body.folder)
      try {
        // mkdir
        await fs.promises.mkdir(folder_path)
        let default_icon_path = path.resolve(__dirname, "public/pinokio-black.png")
        let icon_path = path.resolve(folder_path, "icon.png")
        await fs.promises.cp(default_icon_path, icon_path)
        res.json({
          success: "/init/"+folder
        })
      } catch (e) {
        res.json({
          error: e.message
        })
      }
    }))
    this.app.post("/copy", ex(async (req, res) => {
      let src_path = path.resolve(this.kernel.api.userdir, req.body.src)
      let dest_path = path.resolve(this.kernel.api.userdir, req.body.dest)
      try {
        await fs.promises.cp(src_path, dest_path, { recursive: true })
        res.json({
          //success: "/pinokio/browser/"+ req.body.dest + "/dev"
          success: "/p/"+ req.body.dest + "/dev"
        })
      } catch (e) {
        res.json({
          error: e.message
        })
      }
    }))
    this.app.post("/proxy", ex(async (req, res) => {
      /*
        req.body := {
          action: "start"|"stop",
          name: <name>,
          target: <target url>,
          port: <proxy port>
        }
      */
      if (req.body && req.body.target && req.body.action && req.body.name) {
        //let port = new URL(req.body.target).port
        //let port = await this.kernel.port()
        if (req.body.action === "start") {
          let port = req.body.port
          console.log("start proxy")
          await this.kernel.api.startProxy("/proxy", req.body.target, req.body.name, { port })
          console.log(this.kernel.api.proxies)
        } else if (req.body.action === "stop") {
          await this.kernel.api.stopProxy({
            uri: req.body.target
          })
        }
      }
      res.json({ success: true })
    }))
    this.app.post("/unpublish", ex(async (req, res) => {
      /*
        req.body := {
          type: "local"|"cloudflare"
        }
      */
      if (req.body.type) {
        if (req.body.type === "local") {
          await this.kernel.api.stopProxy({
            uri: `http://127.0.0.1:${this.port}`
          })
        } else if (req.body.type === "cloudflare") {
          await this.cf.stop({
            params: {
              uri: `http://127.0.0.1:${this.port}`
            }
          }, (e) => {
            process.stdout.write(e.raw)
          }, this.kernel)
          this.cloudflare_pub = null
        }
        res.json({ success: true })
      } else {
        res.json({ error: "type must be 'local' or 'cloudflare'" })
      }
    }))
    this.app.post("/publish", ex(async (req, res) => {
      /*
        req.body := {
          type: "local"|"cloudflare"
        }
      */
      if (req.body.type) {
        if (req.body.type === "local") {
          let env = await Environment.get(this.kernel.homedir, this.kernel)
          if (env && env.PINOKIO_SHARE_LOCAL_PORT) {
            let port = env.PINOKIO_SHARE_LOCAL_PORT.trim()
            if (port.length > 0) {
              await this.kernel.api.startProxy("/", `http://127.0.0.1:${this.port}`, "/", { port })
            } else {
              await this.kernel.api.startProxy("/", `http://127.0.0.1:${this.port}`, "/")
            }
          } else {
            //await this.kernel.api.startProxy("/", `http://127.0.0.1:${this.port}`, "/", { port: 44001 })
            await this.kernel.api.startProxy("/", `http://127.0.0.1:${this.port}`, "/", { port: 42002 })
          }
          console.log("started proxy")
        } else if (req.body.type === "cloudflare") {
          let { uri } = await this.cf.tunnel({
            params: {
              uri: `http://127.0.0.1:${this.port}`
            }
          }, (e) => {
            process.stdout.write(e.raw)
          }, this.kernel)
          console.log("cloudflare started at " + uri)
          this.cloudflare_pub = uri
        }
        res.json({ success: true })
      } else {
        res.json({ error: "type must be 'local' or 'cloudflare'" })
      }
    }))
//    this.app.get("/prototype/run/*", ex(async (req, res) => {
//      let pathComponents = req.params[0].split("/").concat("pinokio.js")
//      let config = await this.kernel.api.meta({ path: req.query.path })
//      let pinokiojson_path = path.resolve(req.query.path, "pinokio.json")
//      let pinokiojson = await this.kernel.require(pinokiojson_path)
//      if (pinokiojson) {
//        if (pinokiojson.plugin) {
//          if (pinokiojson.plugin.menu) {
//          } else {
//            pinokiojson.plugin.menu = []
//            await fs.promises.writeFile(pinokiojson_path, JSON.stringify(pinokiojson, null, 2))
//          }
//        } else {
//          pinokiojson.plugin = { menu: [] }
//          await fs.promises.writeFile(pinokiojson_path, JSON.stringify(pinokiojson, null, 2))
//        }
//      } else {
//        pinokiojson = {
//          plugin: {
//            menu: []
//          }
//        }
//        await fs.promises.writeFile(pinokiojson_path, JSON.stringify(pinokiojson, null, 2))
//      }
//      req.base = this.kernel.path("prototype")
//      req.query.callback = config.ui
//      //req.query.callback = config.browse
//      req.query.cwd = req.query.path
//      await this.render(req, res, pathComponents, null)
//    }))
//    this.app.get("/prototype/show/*", ex(async (req, res) => {
//      let name = req.params[0].split("/").filter((x) => { return x }).join("/")
//
//      // print readme
//
//      
//
//
//      let paths = req.params[0].split("/")
//      let item
//      let config = this.kernel.proto.config
//      for(let key of paths) {
//        config = config.menu[key] 
//      }
//      console.log("config.shell", config.shell)
//      if (config.shell) {
//
//        let rendered = this.kernel.template.render(config.shell, {})
//        let params = new URLSearchParams()
//        if (rendered.path) params.set("path", encodeURIComponent(rendered.path))
//        if (rendered.message) params.set("message", encodeURIComponent(rendered.message))
//        if (rendered.venv) params.set("venv", encodeURIComponent(rendered.venv))
//        if (rendered.input) params.set("input", true)
//        if (rendered.callback) params.set("callback", encodeURIComponent(rendered.callback))
//        if (rendered.kill) params.set("kill", encodeURIComponent(rendered.kill))
//        if (rendered.done) params.set("done", encodeURIComponent(rendered.done))
//        if (rendered.env) {
//          for(let key in rendered.env) {
//            let env_key = "env." + key
//            params.set(env_key, rendered.env[key])
//          }
//        }
//        if (rendered.conda) {
//          for(let key in rendered.conda) {
//            let conda_key = "conda." + key
//            params.set(conda_key, rendered.conda[key])
//          }
//        }
//        let shell_id = Math.floor("SH_" + 1000000000000 * Math.random())
//        let href = "/shell/" + shell_id + "?" + params.toString()
//        res.redirect(href)
//      } else {
//        let run_path = "/run/prototype/system/" + config.href + "?cwd=" + req.query.path
//        let readme_path = this.kernel.path("prototype/system", config.readme)
//        let md = await fs.promises.readFile(readme_path, "utf8")
//        let baseUrl = "/asset/prototype/system/" + (config.readme.split("/").slice(0, -1).join("/")) + "/"
//        let readme = marked.parse(md, {
//          baseUrl
//        })
//        res.render("prototype/show", {
//          run_path,
//          portal: this.portal,
//          readme,
//          logo: this.logo,
//          theme: this.theme,
//          agent: this.agent,
//          kernel: this.kernel,
//        })
//      }
//
//    }))
//    this.app.get("/prototype", ex(async (req, res) => {
//      let title
//      let description
//      if (req.query.type === "init") {
//        title = "Initialize"
//        description = "Select an option to intitialize the project with. This may overwrite the folder if you already have existing files"
//      } else if (req.query.type === "extension") {
//        title = "Extensions"
//        description = "Add extension modules to the current folder"
//      }
//
//      let config = structuredClone(this.kernel.proto.config)
//      config = this.renderMenu2(config, {
//        cwd: req.query.path,
//        href: "/prototype/show",
//        path: this.kernel.path("prototype/system"),
//        web_path: "/asset/prototype/system"
//      })
//      res.render("prototype/index", {
//        title,
//        description,
//        config,
//        path: req.query.path,
//        portal: this.portal,
//        logo: this.logo,
//        platform: this.kernel.platform,
//        theme: this.theme,
//        agent: this.agent,
//        kernel: this.kernel,
//      })
//    }))
//    this.app.post("/prototype", this.upload.any(), ex(async (req, res) => {
//      try {
//        /*
//          {
//            title,
//            description,
//            path,
//            id
//          }
//        */
//        let formData = req.body
//        for(let key in req.files) {
//          let file = req.files[key]
//          formData[file.fieldname] = file.buffer
//        }
//        console.log({ formData })
//
//
//        // check if the path exists. if it does, return error
//        let api_path = this.kernel.path("api", formData.path)
//        let e = await this.exists(api_path)
//        if (e) {
//          console.log("e", e)
//          console.log("e.message", e.message)
//          res.status(500).json({ error: `The path ${api_path} already exists` })
//        } else {
//          await this.kernel.api.createMeta(formData)
//
//          // run 
//
//          res.json({ success: true })
//        }
//      } catch (e) {
//        console.log("e", e)
//        console.log("e.message", e.message)
//        res.status(500).json({ error: e.message })
//      }
//    }))
//    this.app.post("/new", this.upload.any(), ex(async (req, res) => {
//      try {
//        /*
//          {
//            title,
//            description,
//            path,
//            id
//          }
//        */
//        let formData = req.body
//        for(let key in req.files) {
//          let file = req.files[key]
//          formData[file.fieldname] = file.buffer
//        }
//        console.log({ formData })
//
//
//        // check if the path exists. if it does, return error
//        let api_path = this.kernel.path("api", formData.path)
//        let e = await this.exists(api_path)
//        if (e) {
//          console.log("e", e)
//          console.log("e.message", e.message)
//          res.status(500).json({ error: `The path ${api_path} already exists` })
//        } else {
//          await this.kernel.api.createMeta(formData)
//          res.json({ success: true })
//        }
//      } catch (e) {
//        console.log("e", e)
//        console.log("e.message", e.message)
//        res.status(500).json({ error: e.message })
//      }
//    }))
    this.app.post("/env", ex(async (req, res) => {
      let fullpath = path.resolve(this.kernel.homedir, req.body.filepath, "ENVIRONMENT")
      let updated = req.body.vals
      let hosts = req.body.hosts
      await Util.update_env(fullpath, updated)
      // for all environment variables that have hosts, save the key as well
      // hosts := { env_key: host }
      for(let env in hosts) {
        let host = hosts[env]
        let val = updated[env]
        await this.kernel.kv.set(host.value, val, host.index)
      }
      res.json({})
    }))
    this.app.get("/env", ex(async (req, res) => {
      await Environment.init({}, this.kernel)
      let filepath = path.resolve(this.kernel.homedir, "ENVIRONMENT")
      let editorpath = "/edit/ENVIRONMENT"

      const items = await Util.parse_env_detail(filepath)

      res.render("env_editor", {
        home: true,
        config: null,
        name: null,
        init: null,
        editorpath,
        items,
        theme: this.theme,
        filepath,
        agent: req.agent,
      })
    }))
    this.app.get("/env/*", ex(async (req, res) => {
      let env_path = req.params[0]
      let api_path
      if (env_path.startsWith("api/")) {
        api_path = env_path.slice(4) 
      }
      let config = await this.kernel.api.meta(api_path)
      let env_result
      if (config.run) {
        env_result = await Environment.init({
          name: api_path,
          no_inherit: true
        }, this.kernel)
      } else {
        env_result = await Environment.init({
          name: api_path,
        }, this.kernel)
      }


      let filepath = env_result.env_path

//      let pathComponents = req.params[0].split("/")
//      let filepath = path.resolve(this.kernel.homedir, req.params[0], "ENVIRONMENT")

      let items = []
      let e = await this.exists(filepath)
      if (e) {
        items = await Util.parse_env_detail(filepath)
      }

      let name
      if (env_path.startsWith("api")) {
        name = env_path.split("/")[1]
      }

      let editorpath
      if (env_result.relpath) {
        editorpath = "/edit/" + req.params[0] + "/" + env_result.relpath + "/ENVIRONMENT"
      } else {
        editorpath = "/edit/" + req.params[0] + "/ENVIRONMENT"
      }
      if (config.run) {
        let configStr = await fs.promises.readFile(p, "utf8")
        res.render("task", {
          home: null,
          config,
          name,
          init: true,
//          init: req.query ? req.query.init : null,
          editorpath,
          items,
          theme: this.theme,
          filepath,
          agent: req.agent,
          path: "/api/" + name + "/pinokio.js",
          _path: "/_api/" + name,
          str: configStr
        })
      } else {

        let gitRemote = null
        try {
          //const repositoryPath = this.kernel.path(pathComponents[0], pathComponents[1])
          //const repositoryPath = this.kernel.path(pathComponents[0])
          const repositoryPath = path.resolve(this.kernel.api.userdir, api_path)
          gitRemote = await git.getConfig({
            fs,
            http,
            dir: repositoryPath,
            path: 'remote.origin.url'
          })
        } catch (e) {
          console.log("ERROR", e)
        }
        res.render("env_editor", {
          gitRemote,
          home: null,
          config,
          name,
          init: req.query ? req.query.init : null,
          editorpath,
          items,
          theme: this.theme,
          filepath,
          agent: req.agent,
        })
      }
      //res.render("env_editor", {
      //  home: null,
      //  config,
      //  name,
      //  init: req.query ? req.query.init : null,
      //  editorpath,
      //  items,
      //  theme: this.theme,
      //  filepath,
      //  agent: this.agent,
      //})
    }))
    this.app.get("/pre/api/:name", ex(async (req, res) => {
      let launcher = await this.kernel.api.launcher(req.params.name)
      let config = launcher.script
      if (config && config.pre) {
        config.pre.forEach((item) => {
          if (item.icon) {
            item.icon = `/api/${req.params.name}/${item.icon}?raw=true`
          } else {
            item.icon = "/pinokio-black.png"
          }
          if (!item.href.startsWith("http")) {
            item.href = path.resolve(this.kernel.homedir, "api", req.params.name, item.href)
          }
        })
        let p2 = launcher.root
        let env = await Environment.get2(p2, this.kernel)
        res.render("pre", {
          name: req.params.name,
          theme: this.theme,
          agent: req.agent,
          name: req.params.name,
          items: config.pre,
          env
        })
      } else {
        res.redirect("/env/" + req.params.name + "?init=true")
      }
    }))
    this.app.get("/initialize/:name", ex(async (req, res) => {
      let launcher = await this.kernel.api.launcher(req.params.name)
      let config = launcher.script
      if (config) {
        // if pinokio.js exists
        if (config.pre && Array.isArray(config.pre)) {
          // if pre exists, redirect to /pre/:name
          res.redirect(`/pre/api/${req.params.name}`)
        } else {
          // if pre doesn't exist, redirect to /env/:name
          res.redirect(`/env/api/${req.params.name}?init=true`)
        }
      } else {
        // if pinokio.js doesn't exist, send to /browser/:name
        //res.redirect(`/pinokio/browser/${req.params.name}`)
        res.redirect(`/p/${req.params.name}`)
      }
    }))
    this.app.get("/share/:name", ex(async (req, res) => {
      let filepath = path.resolve(this.kernel.homedir, "api", req.params.name, "ENVIRONMENT")
      //let filepath = path.resolve(this.kernel.homedir, req.params[0])
      const config = await Util.parse_env(filepath)
      const keys = [
        "PINOKIO_SHARE_CLOUDFLARE",
        "PINOKIO_SHARE_LOCAL",
        "PINOKIO_SHARE_LOCAL_PORT"
      ]
      for(let key of keys) {
        if (!config[key]) {
          config[key] = ""
        }
      }
      // find urls in the current app
      let app_path = path.resolve(this.kernel.homedir, "api", req.params.name)
      let scripts = Object.keys(this.kernel.memory.local).filter((x) => {
        return x.startsWith(app_path)
      })
      let cloudflare_links = []
      let local_links = []
      for(let script in this.kernel.memory.local) {
        let mem = this.kernel.memory.local[script]
        if (mem.$share) {
          if (mem.$share.cloudflare) {
            for(let key in mem.$share.cloudflare) {
              let val = mem.$share.cloudflare[key]
              let qr = await QRCode.toDataURL(val)
              cloudflare_links.push({
                url: val,
                qr
              })
            }
          }
          if (mem.$share.local) {
            for(let key in mem.$share.local) {
              let val = mem.$share.local[key]
              let qr = await QRCode.toDataURL(val)
              local_links.push({
                url: val,
                qr
              })
            }
          }
        }
      }
      res.render("share_editor", {
        cloudflare_links,
        local_links,
        keys,
        config,
        theme: this.theme,
        filepath,
        agent: req.agent,
      })
    }))
    this.app.get("/xterm_config", ex(async (req, res) => {
      let exists = await fse.pathExists(this.kernel.path("web"))
      if (exists) {
        let config_exists = await fse.pathExists(this.kernel.path("web/config.json"))
        if (config_exists) {
          let config = (await this.kernel.loader.load(this.kernel.path("web/config.json"))).resolved
          if (config) {
            if (config.xterm) {
              this.xterm = config.xterm
            }
          }
        }
      }
      res.json({ config: this.xterm })
    }))
    this.app.get("/du/*", ex(async (req, res) => {
      let p = this.kernel.path("api", req.params[0])
      try {
        let d1 = await Util.du(p)
        res.json({ du: d1 })
      } catch (e) {
        console.log("disk usage error", e)
        res.json({ du: 0 })
      }
    }))
    this.app.get("/edit/*", ex(async (req, res) => {
      let pathComponents = req.params[0].split("/")
      let filepath = path.resolve(this.kernel.homedir, req.params[0])
      const content = await fs.promises.readFile(filepath, "utf8")
      res.render("general_editor", {
        theme: this.theme,
        filepath,
        content,
        agent: req.agent,
      })
    }))
    this.app.get("/script/:name", ex((req, res) => {
      if (req.params.name === "start") {
        res.json(this.startScripts)
      }
    }))
    this.app.get("/gitcommit/:ref/*", ex(async (req, res) => {
      // return git log
      let dir = this.kernel.path("api", req.params[0])
      let d = Date.now()
      let changes = []
      if (req.params.ref === "HEAD") {
        const { changes: headChanges, git_commit_url } = await this.getRepoHeadStatus(req.params[0])
        return res.json({ git_commit_url, changes: headChanges })
      } else {
        try {
          let ref = req.params.ref
          const commitOid = await this.kernel.git.resolveCommitOid(dir, ref);
          const parentOid = await this.kernel.git.getParentCommit(dir, commitOid);
          let entries
          if (parentOid !== commitOid) {
            entries = await git.walk({
              fs,
              dir,
              trees: [git.TREE({ ref: parentOid }), git.TREE({ ref: commitOid })],
              map: async (filepath, [A, B]) => {
                if (filepath === ".") return; // skip root

                if (!A && B) return { filepath, type: "added" };
                if (A && !B) return { filepath, type: "deleted" };
                if (A && B) {
                  const Aoid = await A.oid();
                  const Boid = await B.oid();
                  if (Aoid !== Boid) return { filepath, type: "modified" };
                }
              },
            });
          } else {
            // First commit: treat all files as added
            entries = await git.walk({
              fs,
              dir,
              trees: [git.TREE({ ref: commitOid })],
              map: async (filepath, [B]) => {
                if (filepath === ".") return; // skip root
                return { filepath, type: "added" };
              },
            });

          }
          // Filter out undefined (unchanged files)
          const diffFiles = entries.filter(Boolean);
          // Load diffs only for changed files
          for (const { filepath, type } of diffFiles) {
            const fullPath = path.join(dir, filepath);
            const webpath = "/asset/" + path.relative(this.kernel.homedir, fullPath);
            let rel_filepath = path.relative(this.kernel.path("api"), fullPath)
            const stats = await fs.promises.stat(fullPath)
            if (stats.isDirectory()) {
              continue
            }
            changes.push({
              ref: req.params.ref,
              webpath,
              file: filepath,
              path: fullPath,
              diffpath: `/gitdiff/${req.params.ref}/${req.params[0]}/${filepath}`,
              status: type,
            });
          }
        } catch (err) {
          console.log("git diff error 2", err);
        }
      }
      let git_commit_url = `/run/scripts/git/commit.json?cwd=${dir}&callback_target=parent&callback=$location.href`
      res.json({ git_commit_url, changes })
    }))
    this.app.get("/gitdiff/:ref/*", ex(async (req, res) => {
      let fullpath = this.kernel.path("api", req.params[0])
      let dir
      let dirs = Array.from(this.kernel.git.dirs)
      dirs.sort((x, y) => {
        return y.length - x.length
      })
      for(let d of dirs) {
        if (fullpath.startsWith(d)) {
          dir = d
          break
        }
      }
      let filepath = path.relative(dir, fullpath)
      let binary = false;
      try {
        binary = await isBinaryFile(fullpath)
      } catch {
        binary = false; // fallback
      }

      let oldContent = "";
      let newContent = "";
      let change = null
      if (!binary) {
        if (req.params.ref === "HEAD") {
          try {
            const commitOid = await git.resolveRef({ fs, dir, ref: req.params.ref });
            const { blob } = await git.readBlob({ fs, dir, oid: commitOid, filepath });
            oldContent = Buffer.from(blob).toString("utf8");
          } catch (e) {
            oldContent = "";
          }

          // Working directory version
          try {
            newContent = await fs.promises.readFile(fullpath, "utf8");
          } catch (e) {
            newContent = "";
          }
          const diffs = diff.diffLines(normalize(oldContent), normalize(newContent));
          change = Util.diffLinesWithContext(diffs, 5);
        } else {
          const commitOid = await this.kernel.git.resolveCommitOid(dir, req.params.ref);
          const parentOid = await this.kernel.git.getParentCommit(dir, commitOid);
          if (commitOid === parentOid) {
            oldContent = ""
          } else {
            try {
              const { blob } = await git.readBlob({ fs, dir, oid: parentOid, filepath });
              oldContent = Buffer.from(blob).toString("utf8");
            } catch (e) {
              console.log("E1", e)
            } // File might not exist

          }
          try {
            const { blob } = await git.readBlob({ fs, dir, oid: commitOid, filepath });
            newContent = Buffer.from(blob).toString("utf8");
          } catch (e) {
            console.log("E1", e)
          } // File might not exist
          const diffs = diff.diffLines(normalize(oldContent), normalize(newContent));
          change = Util.diffLinesWithContext(diffs, 5);
        }
      }
      const relpath = path.relative(this.kernel.homedir, fullpath)
      const webpath = "/asset/" + relpath
      let response = {
        webpath,
        file: filepath,
        path: fullpath,
//        status: Util.classifyChange(head, workdir, stage),
        diff: change,
        binary,
      }
      res.json(response)
    }))
    this.app.get("/info/git/:ref/*", ex(async (req, res) => {
      const repoParam = req.params[0]
      const ref = req.params.ref || 'HEAD'
      const summary = await this.getGit(ref, repoParam)

      const repoDir = summary && summary.dir ? summary.dir : this.kernel.path('api', repoParam)

      if (ref === 'HEAD') {
        try {
          const { changes: headChanges, git_commit_url } = await this.getRepoHeadStatus(repoParam)
          summary.changes = headChanges || []
          summary.git_commit_url = git_commit_url || null
        } catch (error) {
          console.error('[git-info] head status error', repoParam, error)
          summary.changes = []
        }
      } else {
        let changes = []
        try {
          const commitOid = await this.kernel.git.resolveCommitOid(repoDir, ref)
          const parentOid = await this.kernel.git.getParentCommit(repoDir, commitOid)
          let entries
          if (parentOid !== commitOid) {
            entries = await git.walk({
              fs,
              dir: repoDir,
              trees: [git.TREE({ ref: parentOid }), git.TREE({ ref: commitOid })],
              map: async (filepath, [A, B]) => {
                if (filepath === '.') return
                if (!A && B) return { filepath, type: 'added' }
                if (A && !B) return { filepath, type: 'deleted' }
                if (A && B) {
                  const Aoid = await A.oid()
                  const Boid = await B.oid()
                  if (Aoid !== Boid) return { filepath, type: 'modified' }
                }
              },
            })
          } else {
            entries = await git.walk({
              fs,
              dir: repoDir,
              trees: [git.TREE({ ref: commitOid })],
              map: async (filepath, [B]) => {
                if (filepath === '.') return
                return { filepath, type: 'added' }
              },
            })
          }
          const diffFiles = (entries || []).filter(Boolean)
          for (const { filepath, type } of diffFiles) {
            const fullPath = path.join(repoDir, filepath)
            const stats = await fs.promises.stat(fullPath).catch(() => null)
            if (!stats || stats.isDirectory()) {
              continue
            }
            const relpath = path.relative(this.kernel.path('api'), fullPath)
            changes.push({
              ref,
              webpath: "/asset/" + path.relative(this.kernel.homedir, fullPath),
              file: filepath,
              path: fullPath,
              diffpath: `/gitdiff/${ref}/${repoParam}/${filepath}`,
              status: type,
              relpath,
            })
          }
        } catch (error) {
          console.error('[git-info] diff error', repoParam, ref, error)
        }
        summary.changes = changes
      }

      if (!summary.git_commit_url) {
        summary.git_commit_url = `/run/scripts/git/commit.json?cwd=${repoDir}&callback_target=parent&callback=$location.href`
      }
      summary.dir = repoDir

      res.json(summary)
    }))
    this.app.get("/info/gitstatus/:name", ex(async (req, res) => {
      try {
        const data = await this.computeWorkspaceGitStatus(req.params.name)
        res.json(data)
      } catch (error) {
        console.error('[git-status] compute error', req.params.name, error)
        res.status(500).json({ totalChanges: 0, repos: [], error: error ? String(error.message || error) : 'unknown' })
      }
    }))
    this.app.get("/git/:ref/*", ex(async (req, res) => {

      let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
        bin: this.kernel.bin.preset("dev"),
      })
      if (!requirements_pending && install_required) {
        res.redirect(`/setup/dev?callback=${req.originalUrl}`)
        return
      }


      let response = await this.getGit(req.params.ref, req.params[0])

      res.render("git", {
        path: req.params[0],
//        changes,
        theme: this.theme,
        platform: this.kernel.platform,
        agent: req.agent,
        ...response
      })
    }))
    this.app.get("/d/*", ex(async (req, res) => {
      let filepath = Util.u2p(req.params[0])
      let terminal = await this.terminals(filepath)
      let plugin = await this.getPluginGlobal(req, this.kernel.plugin.config, terminal, filepath)
      let html = ""
      let plugin_menu
      try {
        plugin_menu = plugin.menu
        //plugin_menu = plugin.menu[0].menu
      } catch (e) {
        plugin_menu = []
      }
      let current_urls = await this.current_urls(req.originalUrl.slice(1))
      let retry = false
      // if plugin_menu is empty, try again in 1 sec
      if (plugin_menu.length === 0) {
        retry = true
      }

      let exec_menus = []
      let shell_menus = []
      let href_menus = []
      const normalizeForSort = (value) => {
        if (typeof value !== 'string') {
          return ''
        }
        return value.trim().toLocaleLowerCase()
      }
      const compareMenuItems = (a = {}, b = {}) => {
        const titleDiff = normalizeForSort(a.title).localeCompare(normalizeForSort(b.title))
        if (titleDiff !== 0) {
          return titleDiff
        }
        const subtitleDiff = normalizeForSort(a.subtitle).localeCompare(normalizeForSort(b.subtitle))
        if (subtitleDiff !== 0) {
          return subtitleDiff
        }
        return normalizeForSort(a.href || a.link).localeCompare(normalizeForSort(b.href || b.link))
      }
      const sortMenuEntries = (menuArray) => {
        if (!Array.isArray(menuArray) || menuArray.length < 2) {
          return
        }
        menuArray.sort(compareMenuItems)
      }
      const sortNestedMenus = (menuArray) => {
        if (!Array.isArray(menuArray)) {
          return
        }
        sortMenuEntries(menuArray)
        for (const entry of menuArray) {
          if (entry && Array.isArray(entry.menu)) {
            sortNestedMenus(entry.menu)
          }
        }
      }
      if (plugin_menu.length > 0) {
        for(let item of plugin_menu) {
          // if shell.run method exists
          // if exec method exists 
          let mode
          if (item.run) {
            for(let step of item.run) {
              if (step.method === "exec") {
                mode = "exec" 
                break
              }
              if (step.method === "shell.run") {
                mode = "shell"
                break
              }
              if (step.method === "app.launch") {
                mode = "launch"
                break
              }
            }
            if (mode === "exec" || mode === "launch") {
              item.type = "Open"
              exec_menus.push(item)
            } else if (mode === "shell") {
              item.type = "Start"
              shell_menus.push(item)
            }
          } else {
            href_menus.push(item)
          }
        }
        sortNestedMenus(exec_menus)
        sortNestedMenus(shell_menus)
        sortNestedMenus(href_menus)
      }

//      let terminal = await this.terminals(filepath)
//      let online_terminal = await this.getPluginGlobal(req, terminal, filepath)
//      console.log("online_terminal", online_terminal)
      terminal.menus = href_menus
      sortNestedMenus(terminal.menu)
      sortNestedMenus(terminal.menus)
      let dynamic = [
        terminal,
        {
          icon: "fa-solid fa-robot",
          title: "Terminal Agents",
          subtitle: "Start a session in Pinokio",
          menu: shell_menus
        },
        {
          icon: "fa-solid fa-arrow-up-right-from-square",
          title: "IDE Agents",
          subtitle: "Open the project in external IDEs",
          menu: exec_menus
        },
      ]
      for (const item of dynamic) {
        if (item && Array.isArray(item.menu)) {
          sortNestedMenus(item.menu)
        }
      }

      let spec = ""
      try {
        spec = await fs.promises.readFile(path.resolve(filepath, "SPEC.md"), "utf8")
      } catch (e) {
      }
      res.render("d", {
        filepath,
        spec,
        retry,
        current_urls,
        docs: this.docs,
        portal: this.portal,
        install: this.install,
        agent: req.agent,
        theme: this.theme,
        //dynamic: plugin_menu
        dynamic,
      })
    }))
    this.app.get("/dev/*", ex(async (req, res) => {
      let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
        bin: this.kernel.bin.preset("dev"),
      })
      if (!requirements_pending && install_required) {
        res.redirect(`/setup/dev?callback=${req.originalUrl}`)
        return
      }
      let platform = os.platform()
//      await this.kernel.plugin.init()
      let filepath = Util.u2p(req.params[0])
//      let plugin = await this.getPluginGlobal(filepath)
      let current_urls = await this.current_urls(req.originalUrl.slice(1))
//      let plugin_menu
//      try {
//        plugin_menu = plugin.menu[0].menu
//      } catch (e) {
//        plugin_menu = []
//      }
      const result = {
        current_urls,
        plugin_menu: null,
        portal: this.portal,
        install: this.install,
        port: this.port,
        platform,
        running:this.kernel.api.running,
        memory: this.kernel.memory,
        dynamic: "/pinokio/dynamic_global/" + req.params[0],
        dynamic_content: null,
        home: req.originalUrl,
        theme: this.theme,
        agent: req.agent,
      }
      res.render("mini", result)
    }))
    this.app.get("/raw/*", ex((req, res) => {
      let pathComponents = req.params[0].split("/")
      let filepath = this.kernel.path("api", ...pathComponents)
      try {
        if (req.query.frame) {
          let m = mime.lookup(filepath)
          res.type("text/plain")
        }
        //res.setHeader('Content-Disposition', 'inline');
        res.sendFile(filepath)
      } catch (e) {
        res.status(404).send(e.message);
      }
    }))
    this.app.get("/_api/*", ex(async (req, res) => {
      let pathComponents = req.params[0].split("/")
      req.query.mode = "source"
      try {
        await this.render(req, res, pathComponents)
      } catch (e) {
        res.status(404).send(e.message)
      }
    }))
    this.app.get("/action/:action/*", ex(async (req, res) => {
      const action = typeof req.params.action === 'string' ? req.params.action : ''
      const pathComponents = req.params[0] ? req.params[0].split("/") : []
      req.base = this.kernel.homedir
      req.action = action
      try {
        await this.render(req, res, pathComponents)
      } catch (e) {
        res.status(404).send(e.message)
      }
    }))
    this.app.get("/run/*", ex(async (req, res) => {
      let pathComponents = req.params[0].split("/")
      req.base = this.kernel.homedir
      try {
        await this.render(req, res, pathComponents)
      } catch (e) {
        res.status(404).send(e.message)
      }
    }))
    this.app.get("/api/*", ex(async (req, res) => {
      let pathComponents = req.params[0].split("/")
      if (req.query && 'command' in req.query) {
        let full_filepath = this.kernel.path("api", ...pathComponents)
        Util.openfs(full_filepath, { command: req.query.command })
        res.render("fs", {
          path: full_filepath
        })
      } else if (req.query && 'fs' in req.query) {
        // open in file system
        let full_filepath = this.kernel.path("api", ...pathComponents)
        if (req.query.fs) {
          if (req.query.fs === 'open') {
            // open
            Util.openfs(full_filepath, { mode: "open" })
          } else if (req.query.fs === 'view') {
            // view
            Util.openfs(full_filepath, { mode: "view" })
          } else {
            // view
            Util.openfs(full_filepath, { mode: "view" })
          }
          res.render("fs", {
            path: full_filepath
          })
        }
      } else {
        try {
          await this.render(req, res, pathComponents)
        } catch (e) {
          res.status(404).send(e.message)
        }
      }
    }))
    this.app.get("/pinokio/dynamic_global/*", ex(async (req, res) => {
      let filepath = Util.u2p(req.params[0])
      let terminal = await this.terminals(filepath)
      let plugin = await this.getPluginGlobal(req, this.kernel.plugin.config, terminal, filepath)
      if (plugin) {
        let html = ""
        if (plugin && plugin.menu) {
          let plugin_menu
          try {
            plugin_menu = plugin.menu[0].menu
          } catch (e) {
            plugin_menu = []
          }
          html = await new Promise((resolve, reject) => {
            ejs.renderFile(path.resolve(__dirname, "views/partials/dynamic.ejs"), { dynamic: plugin_menu }, (err, html) => {
              resolve(html)
            })
          })
        }
        res.send(html)
      } else {
        res.send("")
      }
    }))
    this.app.get("/pinokio/dynamic/:name", ex(async (req, res) => {
  //    await this.kernel.plugin.init()

      let plugin = await this.getPlugin(req, this.kernel.plugin.config, req.params.name)
      let html = ""
      let plugin_menu
      if (plugin) {
        if (plugin && plugin.menu && Array.isArray(plugin.menu)) {
          plugin = structuredClone(plugin)
          let default_plugin_query
          if (req.query) {
            default_plugin_query = req.query
          }
          plugin_menu = this.running_dynamic(req.params.name, plugin.menu, default_plugin_query)
          html = await new Promise((resolve, reject) => {
            ejs.renderFile(path.resolve(__dirname, "views/partials/dynamic.ejs"), { dynamic: plugin_menu }, (err, html) => {
              resolve(html)
            })
          })
        }
      }
      res.send(html)
    }))
    this.app.get("/pinokio/ai/:name", ex(async (req, res) => {
      /*
        link to
          README.md
          AGENTS.md
          CLAUDE.md
          GEMINI.md
      */
      let filenames = [
          "README.md",
          "AGENTS.md",
          "CLAUDE.md",
          "GEMINI.md"
      ]
      let files = []
      for(let filename of filenames) {
        let c = this.kernel.path("api", req.params.name, filename)
        let exists = await this.exists(c)
        if (exists) {
          files.push(filename)
        }
      }

      let items = files.map((item) => {
        return {
          text: item,
          href: `/_api/${req.params.name}/${item}`
        }
      })
      let html = await new Promise((resolve, reject) => {
        ejs.renderFile(path.resolve(__dirname, "views/partials/ai.ejs"), { items }, (err, html) => {
          resolve(html)
        })
      })
      res.send(html)
    }))
    this.app.get("/repos/:name", ex(async (req, res) => {
  //    await this.kernel.plugin.init()
      let c = this.kernel.path("api", req.params.name)
      let repos = await this.kernel.git.repos(c)
      let repos_with_remote = repos.filter((repo) => {
        return repo.url
      })
      res.json(repos_with_remote)
    }))
    this.app.get("/pinokio/repos/:name", ex(async (req, res) => {
  //    await this.kernel.plugin.init()
      let c = this.kernel.path("api", req.params.name)
      let repos = await this.kernel.git.repos(c)

//      await Util.ignore_subrepos(c, repos)

      // check if these are in the existing .git
      // 


      // add all the repos folder to .gitignore (except for the root)
      let html = await new Promise((resolve, reject) => {
        ejs.renderFile(path.resolve(__dirname, "views/partials/repos.ejs"), { repos, ref: "HEAD" }, (err, html) => {
          resolve(html)
        })
      })
      res.send(html)
    }))
    this.app.get("/pinokio/sidebar/:name", ex(async (req, res) => {

      let uri = this.kernel.path("api")
      let name = req.params.name
      let launcher = await this.kernel.api.launcher(name)
      let config = launcher.script
      try {
        let rawpath = "/api/" + name
        req.launcher_root = launcher.launcher_root
        config = await this.processMenu(name, config)
      } catch(e) {
        config.menu = []
        err = e.stack
      }
      await this.renderMenu(req, uri, name, config, [])

      ejs.renderFile(path.resolve(__dirname, "views/partials/menu.ejs"), { menu: config.menu }, (err, html) => {
        res.send(html)
      })


/*
      res.json({
        config,
        home: req.originalUrl,
//        paths,
        theme: this.theme,
        agent: this.agent,
        rawpath
      })
      */

    }))
    this.app.post("/pinokio/peer/announce_kill", ex(async (req, res) => {
      this.kernel.peer.kill(req.body.host)
    }))
    this.app.post("/pinokio/peer/refresh", ex(async (req, res) => {
      // refresh and broadcast
      let new_config = JSON.stringify(req.body)
      let old_config = JSON.stringify(this.kernel.peer.info[req.body.host])
      let changed
      if (old_config !== new_config) {
        changed = true
      } else {
        changed = false
      }
      this.kernel.peer.refresh_info(req.body)
      await this.kernel.refresh()
      // if the submitted info is the same, do not refresh
      if (changed) {
        await this.kernel.peer.notify_refresh()
      }
      res.json({ changed })
    }))
//    this.app.post("/pinokio/peer/refresh", ex(async (req, res) => {
//      // refresh and broadcast
//      await this.kernel.refresh()
//      res.json({ success: true })
//    }))


    this.app.get("/info/scripts", ex(async (req, res) => {
    /*
      returns something like this by using the this.kernel.memory.local variable, extracting the api name and adding all running scripts in each associated array, setting the uri as the script path, and the local variables as the local attribute
      the api name in the following examples are "comfyui" and "gradio", therefore there are two top level attributes "comfyui" and "gradio", each of which has an array value made up of all scripts running under that api
      {
        “comfyui”: [{
          “uri”: “/data/pinokio/api/comfyui/start.js”,
          “local”: {
              "port": 42008,
              "url": "http://127.0.0.1:42008"	
          }
        }],
        “gradio”: [{
          “uri”: “/data/pinokio/api/gradio/start.js”,
          “local”: {
              "port": 7860,
              "url": "http://127.0.0.1:7860"
          }
        }]
      }
      */
      if (!this.kernel || !this.kernel.info || typeof this.kernel.info.scriptsByApi !== 'function') {
        res.json({})
        return
      }

      const scriptsByApi = this.kernel.info.scriptsByApi()
      res.json(scriptsByApi)
    }))
    this.app.get("/info/local", ex(async (req, res) => {
      if (this.kernel && this.kernel.memory && this.kernel.memory.local) {
        res.json(this.kernel.memory.local)
      } else {
        res.json({})
      }
    }))


    this.app.get("/info/procs", ex(async (req, res) => {
      await this.kernel.processes.refresh()

      const requestedProtocol = ((req.$source && req.$source.protocol) || req.protocol || '').toLowerCase()
      const preferHttps = requestedProtocol === 'https'

      const routerInfo = (preferHttps && this.kernel.router && this.kernel.router.info && this.kernel.peer)
        ? (this.kernel.router.info[this.kernel.peer.host] || {})
        : null

      const resolveHttpsHosts = (proc) => {
        if (!routerInfo) {
          return []
        }
        const possibleKeys = new Set()
        if (proc.ip) {
          possibleKeys.add(proc.ip)
        }
        if (proc.port) {
          possibleKeys.add(`127.0.0.1:${proc.port}`)
          possibleKeys.add(`localhost:${proc.port}`)
          possibleKeys.add(`0.0.0.0:${proc.port}`)
        }

        const hosts = new Set()
        for (const key of possibleKeys) {
          const matches = routerInfo[key]
          if (!matches || matches.length === 0) {
            continue
          }
          for (const match of matches) {
            if (typeof match === 'string' && match.trim().length > 0) {
              hosts.add(match.trim())
            }
          }
        }
        return Array.from(hosts)
      }

      const preferFriendlyHost = (hosts) => {
        if (!hosts || hosts.length === 0) {
          return null
        }
        for (const host of hosts) {
          if (!/^\d+\.localhost$/i.test(host)) {
            return host
          }
        }
        return hosts[0]
      }

      const processes = Array.isArray(this.kernel.processes.info) ? this.kernel.processes.info : []
      const serverPid = Number(process.pid)
      const filteredProcesses = Number.isFinite(serverPid)
        ? processes.filter((item) => Number(item && item.pid) !== serverPid)
        : processes.slice()

      let info = filteredProcesses.map((item) => {
        const httpUrl = item.ip ? `http://${item.ip}` : null
        let httpsHosts = []
        if (preferHttps) {
          httpsHosts = resolveHttpsHosts(item)
        }
        const httpsUrls = httpsHosts.map((host) => {
          if (!host) {
            return null
          }
          const trimmed = host.trim()
          if (/^https?:\/\//i.test(trimmed)) {
            return trimmed.replace(/^http:\/\//i, 'https://')
          }
          return `https://${trimmed}`
        }).filter(Boolean)

        const preferredHttpsUrl = preferFriendlyHost(httpsHosts)
        const displayHttpsUrl = preferredHttpsUrl
          ? (preferredHttpsUrl.startsWith('http') ? preferredHttpsUrl.replace(/^http:/i, 'https:') : `https://${preferredHttpsUrl}`)
          : (httpsUrls[0] || null)

        const selectedUrl = (preferHttps && displayHttpsUrl) ? displayHttpsUrl : httpUrl
        const protocol = (preferHttps && displayHttpsUrl) ? 'https' : 'http'

        return {
          online: true,
          host: {
            ip: this.kernel.peer.host,
            local: true,
            name: this.kernel.peer.name,
            platform: this.kernel.platform,
            arch: this.kernel.arch,
          },
          ...item,
          url: selectedUrl,
          protocol,
          urls: {
            http: httpUrl,
            https: httpsUrls
          }
        }
      })

      this.add_extra_urls(info)

      if (Array.isArray(this.kernel.selfOrigins) && this.kernel.selfOrigins.length > 0) {
        info = info.filter((entry) => {
          return !this.kernel.selfOrigins.includes(entry.ip)
        })
      }

      const toArray = (value) => {
        if (!value) return []
        return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean)
      }

      const uniqueUrls = (urls) => {
        const seen = new Set()
        const result = []
        for (const url of urls) {
          if (typeof url !== 'string') continue
          const trimmed = url.trim()
          if (!trimmed || seen.has(trimmed)) {
            continue
          }
          seen.add(trimmed)
          result.push(trimmed)
        }
        return result
      }

      const isLoopbackHost = (url) => {
        try {
          const hostname = new URL(url).hostname.toLowerCase()
          return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
        } catch (error) {
          return false
        }
      }

      const stripPeerFromHostname = (url, peerName) => {
        if (!url || !peerName) {
          return url
        }
        try {
          const parsed = new URL(url)
          const suffix = `.${peerName}.localhost`
          if (parsed.hostname.toLowerCase().endsWith(suffix.toLowerCase())) {
            const prefix = parsed.hostname.slice(0, -suffix.length)
            if (!prefix) {
              return url
            }
            const sanitizedHostname = `${prefix}.localhost`
            const portPart = parsed.port ? `:${parsed.port}` : ''
            return `${parsed.protocol}//${sanitizedHostname}${portPart}${parsed.pathname}${parsed.search}${parsed.hash}`
          }
          return url
        } catch (error) {
          return url
        }
      }

      const urlContainsPeerName = (url, peerName) => {
        if (!url || !peerName) {
          return false
        }
        try {
          const hostname = new URL(url).hostname.toLowerCase()
          const needle = `.${peerName.toLowerCase()}.`
          return hostname.includes(needle)
        } catch (error) {
          return false
        }
      }

      const selectPrimaryUrl = (entry) => {
        const hostMeta = entry.host || {}
        const isLocalHost = hostMeta.local === true
        const peerName = typeof hostMeta.name === 'string' ? hostMeta.name : ''

        const httpCandidates = toArray(entry.urls && entry.urls.http)
        const httpsCandidates = toArray(entry.urls && entry.urls.https)

        let sanitizedHttpsCandidates = httpsCandidates.slice()
        if (preferHttps && isLocalHost) {
          sanitizedHttpsCandidates = uniqueUrls(sanitizedHttpsCandidates.map((url) => {
            return stripPeerFromHostname(url, peerName)
          }))
        }

        let primaryUrl

        if (preferHttps) {
          let candidates = sanitizedHttpsCandidates.slice()

          if (!isLocalHost && peerName) {
            const withPeer = candidates.filter((url) => urlContainsPeerName(url, peerName))
            if (withPeer.length > 0) {
              candidates = withPeer
            }
          }

          primaryUrl = candidates[0]

          if (!primaryUrl && httpCandidates.length > 0) {
            primaryUrl = httpCandidates[0]
          }
        } else {
          let candidates = httpCandidates.slice()

          if (isLocalHost) {
            const loopbackCandidate = candidates.find((url) => isLoopbackHost(url))
            if (loopbackCandidate) {
              candidates = [loopbackCandidate]
            }
          } else {
            const nonLoopback = candidates.filter((url) => !isLoopbackHost(url))
            if (nonLoopback.length > 0) {
              candidates = nonLoopback
            }
          }

          primaryUrl = candidates[0]

          if (!primaryUrl) {
            let httpsFallback = sanitizedHttpsCandidates.slice()

            if (isLocalHost) {
              httpsFallback = uniqueUrls(httpsFallback.map((url) => stripPeerFromHostname(url, peerName)))
            } else if (peerName) {
              const withPeer = httpsFallback.filter((url) => urlContainsPeerName(url, peerName))
              if (withPeer.length > 0) {
                httpsFallback = withPeer
              }
            }

            primaryUrl = httpsFallback[0]
          }
        }

        if (!primaryUrl) {
          primaryUrl = entry.url || httpCandidates[0] || sanitizedHttpsCandidates[0] || httpsCandidates[0] || null
        }

        if (primaryUrl) {
          entry.url = primaryUrl
          entry.protocol = primaryUrl.startsWith('https://') ? 'https' : 'http'

          entry.urls = {
            http: primaryUrl.startsWith('http://') ? [primaryUrl] : [],
            https: primaryUrl.startsWith('https://') ? [primaryUrl] : []
          }
        } else {
          entry.urls = {
            http: [],
            https: []
          }
        }
      }

      for (const entry of info) {
        selectPrimaryUrl(entry)
      }

      res.json({
        info
      })
    }))

    this.app.get("/info/system", ex(async (req,res) => {
      let current_peer_info = await this.kernel.peer.current_host()
      res.json(current_peer_info)
    }))
    this.app.get("/info/router", ex(async (req, res) => {
      try {
        // Lightweight router mapping without favicon or installed scans
        const https_active = this.kernel.peer.https_active
        const router_info = await this.kernel.peer.router_info_lite()
        const rewrite_mapping = this.kernel.router.rewrite_mapping
        const router = this.kernel.router.published()
        res.json({ https_active, router_info, rewrite_mapping, router })
      } catch (err) {
        res.json({ https_active: false, router_info: [], rewrite_mapping: {}, router: {} })
      }
    }))
    this.app.get("/qr", ex(async (req, res) => {
      try {
        const data = typeof req.query.data === 'string' ? req.query.data : ''
        if (!data) {
          res.status(400).json({ error: 'Missing data parameter' })
          return
        }
        const scale = Math.max(2, Math.min(10, parseInt(req.query.s || '4', 10) || 4))
        const margin = Math.max(0, Math.min(4, parseInt(req.query.m || '0', 10) || 0))
        const buf = await QRCode.toBuffer(data, { type: 'png', scale, margin })
        res.setHeader('Content-Type', 'image/png')
        res.setHeader('Cache-Control', 'no-store')
        res.send(buf)
      } catch (err) {
        res.status(500).json({ error: 'Failed to generate QR' })
      }
    }))
    this.app.get("/info/api", ex(async (req,res) => {
      // api related info
      let repo = this.kernel.git.find(req.query.git)
      if (repo) {
        let repos = await this.kernel.git.repos(repo.path)
        repos = repos.filter((r) => {
          return r.main
        })
        let repos_with_remote = []
        let main_repo
        for(let repo of repos) {
          if (repo.url) {
            repo.commit = await this.kernel.git.getHead(repo.gitParentPath)
            let du = await Util.du(repo.gitParentPath)
            repo.du = du
            repos_with_remote.push(repo)
          }
          if (repo.main) {
            main_repo = repo
          }
        }
        res.json({
          repos: repos_with_remote
        })
      } else {
        res.json({
          repos: []
        })
      }
    }))
    this.app.get("/info/shells", ex(async (req,res) => {
      let shells = this.kernel.shell.info()
      res.json(shells)
    }))
    this.app.get("/info/api/:name", ex(async (req,res) => {
      // api related info
      let c = this.kernel.path("api", req.params.name)
      let repos = await this.kernel.git.repos(c)
      let repos_with_remote = []
      let main_repo
      for(let repo of repos) {
        if (repo.url) {
          repo.commit = await this.kernel.git.getHead(repo.gitParentPath)
          repos_with_remote.push(repo)
        }
        if (repo.main) {
          main_repo = repo
        }
      }
      res.json({
        repos: repos_with_remote
      })
    }))


    this.app.get("/pinokio/peer", ex(async (req, res) => {
      let current_peer_info = await this.kernel.peer.current_host()
      res.json(current_peer_info)
    }))
    this.app.get("/pinokio/memory", ex((req, res) => {
      let filepath = req.query.filepath
      let mem = this.getMemory(filepath)
      res.json(mem)
    }))
    this.app.post("/pinokio/tabs", ex(async (req, res) => {
      this.tabs[req.body.name] = req.body.tabs
      res.json({ success: true })
    }))
    this.app.get("/pinokio/browser", ex(async (req, res) => {
      if (req.query && req.query.uri) {
        let uri = req.query.uri
        let p = this.kernel.api.resolveBrowserPath(uri)
        res.redirect(p)
      } else {
        res.redirect("/")
      }
    }))
    this.app.get("/pinokio/launch/:name", ex(async (req, res) => {
      await this.chrome(req, res, "launch")
    }))
    this.app.get("/pinokio/browser/:name/dev", ex(async (req, res) => {
      await this.chrome(req, res, "browse")
    }))
    this.app.get("/pinokio/browser/:name/browse", ex(async (req, res) => {
      await this.chrome(req, res, "browse")
    }))
    this.app.get("/pinokio/browser/:name", ex(async (req, res) => {
      await this.chrome(req, res, "run")
    }))
    this.app.get("/v/:name", ex(async (req, res) => {
      await this.chrome(req, res, "run", { no_autoselect: true })
    }))

    this.app.get("/p/:name/review", ex(async (req, res) => {
      let gitRemote = null
      try {
        const repositoryPath = path.resolve(this.kernel.api.userdir, req.params.name)
        gitRemote = await git.getConfig({
          fs,
          http,
          dir: repositoryPath,
          path: 'remote.origin.url'
        })
      } catch (e) {
        console.log("ERROR", e)
      }
      let name = req.params.name
      let run_tab = "/p/" + name
      let dev_tab = "/p/" + name + "/dev"
      let review_tab = "/p/" + name + "/review"
      let files_tab = "/p/" + name + "/files"
      res.render("review", {
        run_tab,
        dev_tab,
        review_tab,
        files_tab,
        name: req.params.name,
        type: "review",
        title: name,
        url: gitRemote,
        //redirect_uri: "http://localhost:3001/apps/redirect?git=" + gitRemote,
        redirect_uri: "https://pinokio.co/apps/redirect?git=" + gitRemote,
        platform: this.kernel.platform,
        theme: this.theme,
        agent: req.agent,
      })
    }))
    this.app.get("/p/:name/dev", ex(async (req, res) => {
      await this.chrome(req, res, "browse")
    }))
    this.app.get("/p/:name/files", ex(async (req, res) => {
      await this.chrome(req, res, "files")
    }))
    this.app.get("/p/:name/browse", ex(async (req, res) => {
      await this.chrome(req, res, "browse")
    }))
    this.app.get("/p/:name", ex(async (req, res) => {
      await this.chrome(req, res, "run")
    }))
    this.app.post("/pinokio/delete", ex(async (req, res) => {
      try {
        if (req.body.type === 'bin') {
          let folderPath = this.kernel.path("bin")
          await fse.remove(folderPath)
          await fs.promises.mkdir(folderPath, { recursive: true }).catch((e) => { })
          res.json({ success: true })
        } else if (req.body.type === 'cache') {
          let folderPath = this.kernel.path("cache")
          await fse.remove(folderPath)
          await fs.promises.mkdir(folderPath, { recursive: true }).catch((e) => { })
          res.json({ success: true })
        } else if (req.body.type === 'env') {
          let envpath = this.kernel.path("ENVIRONMENT")
          let str = await Environment.ENV("system", this.kernel.homedir, this.kernel)
          await fs.promises.writeFile(path.resolve(this.kernel.homedir, "ENVIRONMENT"), str)
          res.json({ success: true })
        } else if (req.body.type === 'browser-cache') {
          if (this.browser) {
            await this.browser.clearCache()
          }
          res.json({ success: true })
        } else if (req.body.name) {
          let folderPath = this.kernel.path("api", req.body.name)
          await fse.remove(folderPath)
//          await fs.promises.mkdir(folderPath, { recursive: true }).catch((e) => { })
          await new Promise((resolve, reject) => {
            setTimeout(() => {
              resolve()
            }, 2000)
          })
          res.json({ success: true })
        }
      } catch(err) {
        res.json({ error: err.stack })
      }
    }))
    this.app.get("/pinokio/logs.zip", ex(async (req, res) => {
      const workspace = typeof req.query.workspace === 'string' ? req.query.workspace.trim() : ''
      if (workspace) {
        const safeName = this.sanitizeWorkspaceForFilename(workspace)
        const zipPath = this.kernel.path(`logs-${safeName}.zip`)
        try {
          await fs.promises.access(zipPath, fs.constants.F_OK)
        } catch (_) {
          res.status(404).send('Workspace archive not found. Generate a new archive and try again.')
          return
        }
        res.download(zipPath, `${safeName}-logs.zip`)
        return
      }
      let zipPath = this.kernel.path("logs.zip")
      res.download(zipPath)
    }))
    this.app.post("/pinokio/log", ex(async (req, res) => {
      const workspace = typeof req.query.workspace === 'string' ? req.query.workspace.trim() : ''
      if (workspace) {
        try {
          const context = await this.resolveLogsRoot({ workspace })
          const safeName = this.sanitizeWorkspaceForFilename(workspace)
          const zipPath = this.kernel.path(`logs-${safeName}.zip`)
          await fs.promises.rm(zipPath, { force: true }).catch(() => {})
          await compressing.zip.compressDir(context.logsRoot, zipPath)
          res.json({ success: true, download: `/pinokio/logs.zip?workspace=${encodeURIComponent(workspace)}` })
        } catch (error) {
          res.status(404).json({ error: error && error.message ? error.message : 'Workspace not found' })
        }
        return
      }

      let states = this.kernel.shell.shells.map((s) => {
        return {
          state: s.state,
          id: s.id,
          group: s.group,
          env: s.env,
          path: s.path,
          cmd: s.cmd,
          done: s.done,
          ready: s.ready,
        }
      })

      let info = {
        platform: this.kernel.platform,
        arch: this.kernel.arch,
        running: this.kernel.api.running,
        home: this.kernel.homedir,
        vars: this.kernel.vars,
        memory: this.kernel.memory,
        procs: this.kernel.procs,
        gpu: this.kernel.gpu,
        gpus: this.kernel.gpus,
        version: this.version,
        ...this.kernel.sysinfo
      }
      await fs.promises.writeFile(this.kernel.path("logs/system.json"), JSON.stringify(info, null, 2))
      await fs.promises.writeFile(this.kernel.path("logs/state.json"), JSON.stringify(states, null, 2))


      await fs.promises.cp(
        this.kernel.path("logs"),
        this.kernel.path("exported_logs")
      , { recursive: true })
      await this.removeRouterSnapshots(this.kernel.path("exported_logs"))
      await this.kernel.shell.logs()


      let folder = this.kernel.path("exported_logs")
      let zipPath = this.kernel.path("logs.zip")
      await compressing.zip.compressDir(folder, zipPath)
      res.json({ success: true, download: '/pinokio/logs.zip' })
    }))
    this.app.get("/pinokio/version", ex(async (req, res) => {
      let version = this.version
      version.script = this.kernel.schema.replace(/[^0-9.]+/,'')
      res.json(version)
    }))
    this.app.get("/pinokio/info", ex(async (req, res) => {
      await this.kernel.getInfo(true)
      let info = Object.assign({}, this.kernel.i)
      info.launch_complete = this.kernel.launch_complete
      console.log("kernel.launch_complete", this.kernel.launch_complete)
      delete info.vars
      delete info.shell_env
      delete info.memory
      res.json(info)
    }))
    this.app.get("/pinokio/port", ex(async (req, res) => {
      let port = await this.kernel.port()
      res.json({ result: port })
    }))
    this.app.get("/pinokio/download", ex((req, res) => {
      let queryStr = new URLSearchParams(req.query).toString()
      res.redirect("/home?mode=download&" + queryStr)
    }))
    this.app.post("/pinokio/install", ex((req, res) => {
      req.session.requirements = req.body.requirements
      req.session.callback = req.body.callback
      res.redirect("/pinokio/install")
    }))
    this.app.get("/pinokio/install", ex((req, res) => {
      let requirements = req.session.requirements
      let callback = req.session.callback
      req.session.requirements = null
      req.session.callback = null
      res.render("install", {
        logo: this.logo,
        theme: this.theme,
        agent: req.agent,
        userdir: this.kernel.api.userdir,
        display: ["form"],
//        query: req.query,
        requirements,
        callback
      })
    }))
    this.app.get("/pinokio", ex((req, res) => {
      // parse the uri & path
      let {uri, ...query} = req.query
      let querystring = new URLSearchParams(query).toString()
      let webpath = this.kernel.api.webPath(req.query.uri)
      if (querystring && querystring.length > 0) {
        webpath = webpath + "?" + querystring
      }
      res.redirect(webpath)
    }))
    this.app.post("/pinokio/upload", this.upload.any(), ex(async (req, res) => {
      try {


        /*
          1. edit
          2. copy
          3. copy + edit
          4. move
          5. move + edit
              
        */

        let formData = req.body
        for(let key in req.files) {
          let file = req.files[key]
          formData[file.fieldname] = file.buffer
        }

        if (formData.edit) {
          if (formData.copy) {
            if (formData.old_path !== formData.new_path) {

              // 1. copy first
              let old_path = this.kernel.path("api", formData.old_path)
              let new_path = this.kernel.path("api", formData.new_path)

              await fs.promises.cp(old_path, new_path, { recursive: true })

              // 2. edit meta in the new_path
              await this.kernel.api.updateMeta(formData, formData.new_path)

            }
          } else if (formData.move) {

            // 1. move first
            if (formData.old_path !== formData.new_path) {
              let old_path = this.kernel.path("api", formData.old_path)
              let new_path = this.kernel.path("api", formData.new_path)
              await fs.promises.rename(old_path, new_path)
            }

            // 2. edit meta in the new_path
            await this.kernel.api.updateMeta(formData, formData.new_path)
          } else {
            // 1. edit only
            if (formData.old_path === formData.new_path) {
              await this.kernel.api.updateMeta(formData, formData.new_path)
            }
          }
        } else {
          if (formData.copy) {
            // 1. copy only
            let old_path = this.kernel.path("api", formData.old_path)
            let new_path = this.kernel.path("api", formData.new_path)
            await fs.promises.cp(old_path, new_path, { recursive: true })
          } else if (formData.move) {
            // 2. move only
            let old_path = this.kernel.path("api", formData.old_path)
            let new_path = this.kernel.path("api", formData.new_path)
            await fs.promises.rename(old_path, new_path)
          } else {
            // nothing
          }
        }
        res.json({
          success: true,
          reload: formData.new_path,
          new_path: formData.new_path,
        })
      } catch (e) {
        console.log("e", e)
        res.status(500).json({ error: e.message })
      }

    }))
    /*
      SYNTAX
      fs.uri(<bin|api>, path)

      EXAMPLES
      fs.uri("api", "sfsdfs")
      fs.uri("api", "https://github.com/cocktailpeanut/llamacpp.pinokio.git/icon.png")
      fs.uri("bin", "python/bin")

      1. Git URI: http://localhost/pinokio/fs?drive=api&path=https://github.com/cocktailpeanut/llamacpp.pinokio.git/icon.png
      2. Local path: http://localhost/pinokio/fs?drive=api&path=test/icon.png
    */
    this.app.get("/pinokio/fs", ex((req, res) => {
      // serve reaw files
      if (req.query && req.query.drive && req.query.path) {
        let p
        if (req.query.drive === "bin") {
          p = path.resolve(this.kernel.homedir, "bin", req,query.path)
        } else if (req.query.drive === "api") {
          p = this.kernel.api.filePath(req.query.path, this.kernel.api.userdir)
        }
        try {
          if (p) {
            res.sendFile(p)
          } else {
            res.status(404).send("Path doesn't exist")
          }
        } catch (e) {
          console.log("ERROR" ,e)
          res.status(404).send(e.message);
        }
      } else {
        res.status(404).send("Missing attribute: path")
      }
    }))
    const ensureCaptureDir = async () => {
      await fs.promises.mkdir(this.kernel.path("screenshots"), { recursive: true }).catch(() => {});
    };

    const saveCaptureFiles = async (files, fallbackExt = '.png') => {
      await ensureCaptureDir();
      const saved = [];
      if (Array.isArray(files)) {
        for (const file of files) {
          if (!file || !file.buffer) continue;
          const origName = file.originalname || '';
          let ext = path.extname(origName);
          if (!ext && file.mimetype) {
            const mapped = mime.extension(file.mimetype);
            if (mapped) ext = `.${mapped}`;
          }
          if (!ext) ext = fallbackExt;
          const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
          await fs.promises.writeFile(this.kernel.path("screenshots", name), file.buffer);
          saved.push({ name, url: `/asset/screenshots/${name}` });
        }
      }
      return saved;
    };

    this.app.get("/snapshots", ex(async (req, res) => {
      let files = []
      try {
        files = await fs.promises.readdir(this.kernel.path("screenshots"))
        files = files.map((file) => {
          return `/asset/screenshots/${file}`
        })
      } catch (e) {
      }
      res.json({ files })
    }))
    
    this.app.post("/snapshots", ex(async (req, res) => {
      const { filename } = req.body
      
      if (!filename) {
        return res.status(400).json({ error: "Missing filename parameter" })
      }
      
      try {
        // Extract just the filename from the path (security measure)
        const baseFilename = path.basename(filename.replace('/asset/screenshots/', ''))
        const fullPath = this.kernel.path("screenshots", baseFilename)
        
        // Check if file exists before attempting to delete
        try {
          await fs.promises.access(fullPath)
        } catch (e) {
          return res.status(404).json({ error: "File not found" })
        }
        
        // Delete the file
        await fs.promises.unlink(fullPath)
        
        res.json({ success: true, message: "File deleted successfully" })
        
      } catch (e) {
        console.log("Error deleting screenshot:", e)
        res.status(500).json({ error: "Failed to delete file: " + e.message })
      }
    }))
    this.app.post("/capture", this.upload.any(), ex(async (req, res) => {
      const saved = await saveCaptureFiles(req.files);
      res.json({ saved });
    }))
    this.app.post("/screenshot", this.upload.any(), ex(async (req, res) => {
      const saved = await saveCaptureFiles(req.files);
      res.json({ saved });
    }))
    this.app.post("/pinokio/fs", this.upload.any(), ex(async (req, res) => {
      /*
        Packet format:
          types: <argument types>
          drive: <api|bin>,
          path: <file system path>,
          method: <method name>,
          "arg0": <arg0>
          "arg1": <arg1>
          ...


        Argument serialization
          array => JSON
          object => JSON
          primitive => string ("false", "null", etc)
          file,blob,uintarray,arraybuffer => blob

        types:
          file,blob,uintarray,arraybuffer => Blob
          array => Array
          object that's not (array, file, blob, uint8array, arraybuffer) => Object
          the rest => typeof(value)
      */
      let formData = req.body
      for(let key in req.files) {
        let file = req.files[key]
        formData[file.fieldname] = file.buffer
      }

      const drive = formData.drive
      const home = formData.path
      const method = formData.method
      const types = JSON.parse(formData.types)
      if (drive && home && types && method) {
        let deserializedArgs = []
        for(let i=0; i<types.length; i++) {
          let type = types[i]
          let arg = formData[`arg${i}`]
          // deserialize
          let val
          if (type === 'Blob') {
            //val = Buffer.from(arg.data) // blob => buffer
            val = arg
          } else if (type === "Array") {
            val = JSON.parse(arg)
          } else if (type === "Object") {
            val = JSON.parse(arg)
          } else {
            if (type === 'number') {
              val = Number(arg) 
            } else if (type === 'boolean') {
              val = Boolean(arg)
            } else if (type === 'string') {
              val = String(arg)
            } else if (type === 'function') {
              val = new Function(arg)
            } else if (type === 'null') {
              val = null
            } else if (type === 'undefined') {
              val = undefined
            } else {
              val = arg
            }
          }
          deserializedArgs.push(val)
        }

        let cwd
        if (drive === "api") {
          cwd = this.kernel.api.filePath(home, this.kernel.api.userdir)

          // 1. exists
          // 2. clone
          // 3. pull
          if (method === "clone") {
            // clone(dest)
            if (types.length === 1) {
              await this.kernel.bin.sh({
                message: `git clone ${home} "${formData.arg0}"`,
                path: this.kernel.api.userdir
              }, (stream) => {
              })
              res.json({
                result: "success"
              })
            } else {
              res.json({
                error: "Required argument: clone destination folder name"
              })
            }
            return
          } else if (method === "pull") {
            // pull()
            if (cwd) {
              await this.kernel.bin.sh({
                message: `git pull`,
                path: cwd,
              }, (stream) => {
              })
            } else {
              res.json({
                error: "Couldn't resolve path"
              })
            }
            return
          } else if (method === "exists") {
            // exists()
            if (types.length === 0 || types.length === 1 && formData.arg0 === ".") {
              // fs.exists() or fs.exists(".")
              if (!cwd) {
                // doesn't exist
                res.json({ result: false })
                return
              }
            }
          }

          if (!cwd) {
            res.json({ error: `file system for ${home} does not exist yet. try fs.clone(<desired_folder_name>)` })
          }

        } else if (drive === "bin") {
          cwd = path.resolve(this.kernel.homedir, "bin", home)
        }


        if (cwd) {
          try {
            let result = await new Promise((resolve, reject) => {
              const child = fork(path.resolve(__dirname, "..", "worker.js"), null, { cwd })
              child.on('message', (message) => {
                if (message.hasOwnProperty("error")) {
                  reject(message.error)
                } else {
                  resolve(message.result);
                }
                child.kill()
              });
              child.send({
                method,
                args: deserializedArgs,
              })
            })
            res.json({result})
          } catch (e) {
            console.log("### e", e)
            res.json({ error: e })
          }
        } else {
          res.json({ error: "Missing attribute: drive" })
        }
      } else {
        res.json({ error: "Required attributes: path, method, types" })
      }

    }))
    this.app.get("/pinokio/requirements_ready", ex((req, res) => {
      let requirements_pending = !this.kernel.bin.installed_initialized
      res.json({ requirements_pending })
    }))
    this.app.get("/check_peer", ex((req, res) => {
      if (this.kernel.peer.active) {
        // if network is active, return success only if the router is up for all of its peers (including itself)
        let ready = true
        if (this.kernel.peer.info) {
          let info = this.kernel.peer.info[this.kernel.peer.host]
          if (info) {
            if (info.router && Object.keys(info.router).length > 0) {
              ready = true 
            } else {
              ready = false
            }
          } else {
            ready = false 
          }
        } else {
          ready = false;
        }
        if (ready) {
          res.json({ success: true, peer_name: this.kernel.peer.name  })
        } else {
          res.json({ success: false })
        }
      } else {
        // if network is not active, return success immediately (just checking if the server is up)
        res.json({ success: true })
      }
    }))
    this.app.get("/bin_ready", ex(async (req, res) => {
      if (this.kernel.bin && !this.kernel.bin.requirements_pending) {
        let code_exists = await this.kernel.exists("plugin/code")
        if (code_exists) {
          res.json({ success: true })
        } else {
          res.json({ success: false })
        }
      } else {
        res.json({ success: false })
      }
    }))

    this.app.get("/check", ex((req, res) => {
      res.json({ success: true })
    }))
    this.app.post("/onrestart", ex(async (req, res) => {
      console.log("post /onrestart")
      if (this.onrestart) {
        console.log("onrestart exists")
        this.onrestart()
      } else {
        await this.start({ debug: this.debug, browser: this.browser })
        res.json({ success: true })
      }
    }))
    this.app.post("/restart", ex(async (req, res) => {
      console.log("post /restart")
      this.start({ debug: this.debug, browser: this.browser })
    }))
    this.app.post("/network", ex(async (req, res) => {
      if (this.kernel.homedir) {
        let fullpath = path.resolve(this.kernel.homedir, "ENVIRONMENT")
        console.log("POST /network", req.body)
        await Util.update_env(fullpath, req.body)
        res.json({ success: true })
      } else {
        res.json({ error: "homedir doesn't exist" })
      }
    }))

    this.app.post("/config", ex(async (req, res) => {
      try {
        let message = await this.setConfig(req.body)
        res.json({ success: true, message })
      } catch (e) {
        res.json({ error: e && e.message ? e.message : e })
      }

      // update homedir
    }))

    this.app.use((err, req, res, next) => {
      process.stdout.write("\r\n>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>")
      process.stdout.write("\r\n> ERROR\r\n")
      process.stdout.write(err.stack)
      process.stdout.write("\r\n>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>\r\n")
      res.status(500).render("500", {
        install: this.install,
        stack: err.stack
      })
    });
    process.on('SIGINT', () => {
      this.shutdown('SigInt')
    })

    process.on('SIGTERM', () => {
      this.shutdown('SigTerm')
    })
//    process.on('exit', () => {
//      console.log("[Exit event]")
//      kill(process.pid, 'SIGKILL', true)
//      //let map = this.kernel.processes.map || {}
//      //kill(process.pid, map, 'SIGKILL', () => {
//      //  console.log("child procs killed for", process.pid)
//      //  process.exit()
//      //});
//    })
//    process.on('exit', () => {
//      console.log("exit Event")
//      if (this.kernel && this.kernel.shell) {
//        console.log("this.kernel.shell.reset")
//        this.kernel.shell.reset()
//      }
//      process.exit()
//    })



    // install
    this.server = httpserver.createServer(this.app);
    this.socket = new Socket(this)
    await new Promise((resolve, reject) => {
      this.listening = this.server.listen(this.port, () => {
        console.log(`Server listening on port ${this.port}`)
        this.kernel.server_running = true
        resolve()
      });
      this.httpTerminator = createHttpTerminator({
        server: this.listening
      });
    })
//    this.kernel.peer.start(this.kernel)


  }
}
module.exports = Server
