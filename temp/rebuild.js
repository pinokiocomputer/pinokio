"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rebuild = exports.Rebuilder = void 0;
const debug_1 = __importDefault(require("debug"));
const events_1 = require("events");
const fs = __importStar(require("fs-extra"));
const nodeAbi = __importStar(require("node-abi"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const cache_1 = require("./cache");
const types_1 = require("./types");
const module_rebuilder_1 = require("./module-rebuilder");
const module_walker_1 = require("./module-walker");
const d = (0, debug_1.default)('electron-rebuild');
const defaultMode = 'sequential';
const defaultTypes = ['prod', 'optional'];
class Rebuilder {
    constructor(options) {
      console.log("options", options)
        var _a;
        this.platform = options.platform || process.platform;
        this.lifecycle = options.lifecycle;
        this.buildPath = options.buildPath;
        this.electronVersion = options.electronVersion;
        this.arch = options.arch || process.arch;
        this.force = options.force || false;
        this.headerURL = options.headerURL || 'https://www.electronjs.org/headers';
        this.mode = options.mode || defaultMode;
        this.debug = options.debug || false;
        this.useCache = options.useCache || false;
        this.useElectronClang = options.useElectronClang || false;
        this.cachePath = options.cachePath || path.resolve(os.homedir(), '.electron-rebuild-cache');
        this.prebuildTagPrefix = options.prebuildTagPrefix || 'v';
        this.msvsVersion = process.env.GYP_MSVS_VERSION;
        this.disablePreGypCopy = options.disablePreGypCopy || false;
        if (this.useCache && this.force) {
            console.warn('[WARNING]: Electron Rebuild has force enabled and cache enabled, force take precedence and the cache will not be used.');
            this.useCache = false;
        }
        if (typeof this.electronVersion === 'number') {
            if (`${this.electronVersion}`.split('.').length === 1) {
                this.electronVersion = `${this.electronVersion}.0.0`;
            }
            else {
                this.electronVersion = `${this.electronVersion}.0`;
            }
        }
        if (typeof this.electronVersion !== 'string') {
            throw new Error(`Expected a string version for electron version, got a "${typeof this.electronVersion}"`);
        }
        this.ABIVersion = (_a = options.forceABI) === null || _a === void 0 ? void 0 : _a.toString();
        const onlyModules = options.onlyModules || null;
        const extraModules = (options.extraModules || []).reduce((acc, x) => acc.add(x), new Set());
        const types = options.types || defaultTypes;
        this.moduleWalker = new module_walker_1.ModuleWalker(this.buildPath, options.projectRootPath, types, extraModules, onlyModules);
        this.rebuilds = [];
        d('rebuilding with args:', this.buildPath, this.electronVersion, this.arch, extraModules, this.force, this.headerURL, types, this.debug);
        console.log("THIS>PLATFORM", this.platform)
    }
    get ABI() {
        if (this.ABIVersion === undefined) {
            this.ABIVersion = nodeAbi.getAbi(this.electronVersion, 'electron');
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return this.ABIVersion;
    }
    get buildType() {
        return this.debug ? types_1.BuildType.Debug : types_1.BuildType.Release;
    }
    async rebuild() {
        if (!path.isAbsolute(this.buildPath)) {
            throw new Error('Expected buildPath to be an absolute path');
        }
        this.lifecycle.emit('start');
        await this.moduleWalker.walkModules();
        for (const nodeModulesPath of await this.moduleWalker.nodeModulesPaths) {
            await this.moduleWalker.findAllModulesIn(nodeModulesPath);
        }
        for (const modulePath of this.moduleWalker.modulesToRebuild) {
            this.rebuilds.push(() => this.rebuildModuleAt(modulePath));
        }
        this.rebuilds.push(() => this.rebuildModuleAt(this.buildPath));
        if (this.mode !== 'sequential') {
            await Promise.all(this.rebuilds.map(fn => fn()));
        }
        else {
            for (const rebuildFn of this.rebuilds) {
                await rebuildFn();
            }
        }
    }
    async rebuildModuleAt(modulePath) {
        if (!(await fs.pathExists(path.resolve(modulePath, 'binding.gyp')))) {
            return;
        }
        const moduleRebuilder = new module_rebuilder_1.ModuleRebuilder(this, modulePath);
        this.lifecycle.emit('module-found', path.basename(modulePath));
        if (!this.force && await moduleRebuilder.alreadyBuiltByRebuild()) {
            d(`skipping: ${path.basename(modulePath)} as it is already built`);
            this.lifecycle.emit('module-done');
            this.lifecycle.emit('module-skip');
            return;
        }
        if (await moduleRebuilder.prebuildInstallNativeModuleExists()) {
            d(`skipping: ${path.basename(modulePath)} as it was prebuilt`);
            return;
        }
        let cacheKey;
        if (this.useCache) {
            cacheKey = await (0, cache_1.generateCacheKey)({
                ABI: this.ABI,
                arch: this.arch,
                debug: this.debug,
                electronVersion: this.electronVersion,
                headerURL: this.headerURL,
                modulePath,
            });
            const applyDiffFn = await (0, cache_1.lookupModuleState)(this.cachePath, cacheKey);
            if (typeof applyDiffFn === 'function') {
                await applyDiffFn(modulePath);
                this.lifecycle.emit('module-done');
                return;
            }
        }
        if (await moduleRebuilder.rebuild(cacheKey)) {
            this.lifecycle.emit('module-done');
        }
    }
}
exports.Rebuilder = Rebuilder;
function rebuild(options) {
  console.log("(rebuild)", options)
    // eslint-disable-next-line prefer-rest-params
    d('rebuilding with args:', arguments);
    const lifecycle = new events_1.EventEmitter();
    const rebuilderOptions = { ...options, lifecycle };
    const rebuilder = new Rebuilder(rebuilderOptions);
    const ret = rebuilder.rebuild();
    ret.lifecycle = lifecycle;
    return ret;
}
exports.rebuild = rebuild;
//# sourceMappingURL=rebuild.js.map
