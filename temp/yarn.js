"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rebuild = exports.nodeGypRebuild = exports.getGypEnv = exports.installOrRebuild = void 0;
const builder_util_1 = require("builder-util");
const fs_extra_1 = require("fs-extra");
const os_1 = require("os");
const path = require("path");
const electronVersion_1 = require("../electron/electronVersion");
const electronRebuild = require("@electron/rebuild");
const searchModule = require("@electron/rebuild/lib/src/search-module");
async function installOrRebuild(config, appDir, options, forceInstall = false) {
console.log("install or rebuild", { config, options })
    let isDependenciesInstalled = false;
    for (const fileOrDir of ["node_modules", ".pnp.js"]) {
        if (await (0, fs_extra_1.pathExists)(path.join(appDir, fileOrDir))) {
            isDependenciesInstalled = true;
            break;
        }
    }
    if (forceInstall || !isDependenciesInstalled) {
        const effectiveOptions = {
            buildFromSource: config.buildDependenciesFromSource === true,
            additionalArgs: (0, builder_util_1.asArray)(config.npmArgs),
            ...options,
        };
        await installDependencies(appDir, effectiveOptions);
    }
    else {
        await rebuild(appDir, config.buildDependenciesFromSource === true, options);
    }
}
exports.installOrRebuild = installOrRebuild;
function getElectronGypCacheDir() {
    return path.join((0, os_1.homedir)(), ".electron-gyp");
}
function getGypEnv(frameworkInfo, platform, arch, buildFromSource) {
    const npmConfigArch = arch === "armv7l" ? "arm" : arch;
    const common = {
        ...process.env,
        npm_config_arch: npmConfigArch,
        npm_config_target_arch: npmConfigArch,
        npm_config_platform: platform,
        npm_config_build_from_source: buildFromSource,
        // required for node-pre-gyp
        npm_config_target_platform: platform,
        npm_config_update_binary: true,
        npm_config_fallback_to_build: true,
    };
    if (platform !== process.platform) {
        common.npm_config_force = "true";
    }
    if (platform === "win32" || platform === "darwin") {
        common.npm_config_target_libc = "unknown";
    }
    if (!frameworkInfo.useCustomDist) {
        return common;
    }
    // https://github.com/nodejs/node-gyp/issues/21
    return {
        ...common,
        npm_config_disturl: "https://electronjs.org/headers",
        npm_config_target: frameworkInfo.version,
        npm_config_runtime: "electron",
        npm_config_devdir: getElectronGypCacheDir(),
    };
}
exports.getGypEnv = getGypEnv;
function checkYarnBerry() {
    var _a;
    const npmUserAgent = process.env["npm_config_user_agent"] || "";
    const regex = /yarn\/(\d+)\./gm;
    const yarnVersionMatch = regex.exec(npmUserAgent);
    const yarnMajorVersion = Number((_a = yarnVersionMatch === null || yarnVersionMatch === void 0 ? void 0 : yarnVersionMatch[1]) !== null && _a !== void 0 ? _a : 0);
    return yarnMajorVersion >= 2;
}
function installDependencies(appDir, options) {
    const platform = options.platform || process.platform;
    const arch = options.arch || process.arch;
    const additionalArgs = options.additionalArgs;
    builder_util_1.log.info({ platform, arch, appDir }, `installing production dependencies`);
    let execPath = process.env.npm_execpath || process.env.NPM_CLI_JS;
    const execArgs = ["install"];
    const isYarnBerry = checkYarnBerry();
    if (!isYarnBerry) {
        if (process.env.NPM_NO_BIN_LINKS === "true") {
            execArgs.push("--no-bin-links");
        }
        execArgs.push("--production");
    }
    if (!isRunningYarn(execPath)) {
        execArgs.push("--prefer-offline");
    }
    if (execPath == null) {
        execPath = getPackageToolPath();
    }
    else if (!isYarnBerry) {
        execArgs.unshift(execPath);
        execPath = process.env.npm_node_execpath || process.env.NODE_EXE || "node";
    }
    if (additionalArgs != null) {
        execArgs.push(...additionalArgs);
    }
    return (0, builder_util_1.spawn)(execPath, execArgs, {
        cwd: appDir,
        env: getGypEnv(options.frameworkInfo, platform, arch, options.buildFromSource === true),
    });
}
async function nodeGypRebuild(arch) {
    return rebuild(process.cwd(), false, arch);
}
exports.nodeGypRebuild = nodeGypRebuild;
function getPackageToolPath() {
    if (process.env.FORCE_YARN === "true") {
        return process.platform === "win32" ? "yarn.cmd" : "yarn";
    }
    else {
        return process.platform === "win32" ? "npm.cmd" : "npm";
    }
}
function isRunningYarn(execPath) {
    const userAgent = process.env.npm_config_user_agent;
    return process.env.FORCE_YARN === "true" || (execPath != null && path.basename(execPath).startsWith("yarn")) || (userAgent != null && /\byarn\b/.test(userAgent));
}
/** @internal */
async function rebuild(appDir, buildFromSource, options) {
    builder_util_1.log.info({ appDir, arch: options.arch, platform: options.platform }, "executing @electron/rebuild");
    const effectiveOptions = {
        buildPath: appDir,
        electronVersion: await (0, electronVersion_1.getElectronVersion)(appDir),
        arch: options.arch,
        platform: options.platform,
        force: true,
        debug: builder_util_1.log.isDebugEnabled,
        projectRootPath: await searchModule.getProjectRootPath(appDir),
    };
    if (buildFromSource) {
        effectiveOptions.prebuildTagPrefix = "totally-not-a-real-prefix-to-force-rebuild";
    }
    return electronRebuild.rebuild(effectiveOptions);
}
exports.rebuild = rebuild;
//# sourceMappingURL=yarn.js.map
