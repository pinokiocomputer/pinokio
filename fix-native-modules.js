/**
 * fix-native-modules.js
 *
 * electron-builder afterPack hook that fixes native module architectures
 * when cross-compiling Linux packages (e.g. building arm64 on x86-64 host).
 *
 * Problem: When building arm64 .deb/.rpm/.AppImage packages from an x86-64
 * Docker container, native .node modules are compiled/downloaded for x86-64
 * and then incorrectly bundled into the arm64 package.
 *
 * This hook runs after packing and replaces mismatched binaries with the
 * correct architecture from:
 *   1. Prebuilt binaries shipped in the package's prebuilds/ directory
 *   2. Platform-specific npm packages (e.g. @parcel/watcher-linux-arm64-glibc)
 */

const { execFileSync, execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

// electron-builder Arch enum to Node.js arch string
const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64' }

// Substrings returned by the `file` command for each architecture
const ELF_ARCH_ID = {
  x64: 'x86-64',
  arm64: 'ARM aarch64',
  ia32: '80386',
  armv7l: ', ARM,'
}

module.exports = async function fixNativeModules(context) {
  const { appOutDir, electronPlatformName, arch } = context

  if (electronPlatformName !== 'linux') return

  const targetArch = ARCH_NAMES[arch] || String(arch)
  const hostArch = os.arch() === 'x64' ? 'x64' : os.arch()

  if (targetArch === hostArch) return

  console.log(`[fix-native-modules] Cross-compiling detected: host=${hostArch} -> target=${targetArch}`)

  const unpackedDir = path.join(
    appOutDir, 'resources', 'app.asar.unpacked', 'node_modules'
  )
  if (!fs.existsSync(unpackedDir)) return

  // Determine Electron ABI version for prebuild selection
  const electronVersion = require('./package.json').devDependencies.electron
  const abiVersion = resolveAbi(electronVersion)
  console.log(`[fix-native-modules] Electron ${electronVersion}, ABI ${abiVersion || 'unknown'}`)

  const nodeFiles = findActiveNodeFiles(unpackedDir)
  const targetId = ELF_ARCH_ID[targetArch]

  let fixed = 0
  let failed = 0

  for (const file of nodeFiles) {
    if (matchesArch(file, targetId)) continue

    const rel = path.relative(unpackedDir, file)
    console.log(`[fix-native-modules] Architecture mismatch: ${rel}`)

    const ok =
      replaceFromPrebuilds(file, targetArch, abiVersion) ||
      replaceFromPlatformPackage(file, rel, targetArch)

    if (ok) {
      console.log(`[fix-native-modules] Fixed: ${rel}`)
      fixed++
    } else {
      console.warn(`[fix-native-modules] Could not fix: ${rel}`)
      failed++
    }
  }

  console.log(
    `[fix-native-modules] Complete: ${fixed} fixed, ${failed} failed out of ${nodeFiles.length} checked`
  )

  if (failed > 0) {
    console.warn(
      `[fix-native-modules] WARNING: ${failed} native module(s) could not be fixed for ${targetArch}.`
    )
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the Node ABI version for a given Electron version. */
function resolveAbi(electronVersion) {
  try {
    const nodeAbi = require('node-abi')
    return nodeAbi.getAbi(electronVersion, 'electron')
  } catch {
    return null
  }
}

/**
 * Find .node files that are actively loaded at runtime.
 * These live in build/Release/ directories or are top-level in platform
 * packages (e.g. @parcel/watcher-linux-x64-glibc/watcher.node).
 * Skip files inside prebuilds/ directories (source binaries, not active).
 */
function findActiveNodeFiles(dir) {
  const results = []

  function walk(current) {
    let entries
    try { entries = fs.readdirSync(current, { withFileTypes: true }) }
    catch { return }

    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'prebuilds') continue
        walk(full)
      } else if (entry.isFile() && entry.name.endsWith('.node')) {
        const parent = path.basename(path.dirname(full))
        // Active binaries: build/Release/*.node or platform-specific top-level
        if (parent === 'Release' || path.dirname(full).includes('watcher-linux-')) {
          results.push(full)
        }
      }
    }
  }

  walk(dir)
  return results
}

/** Check whether a .node file matches the expected ELF architecture. */
function matchesArch(filePath, expectedId) {
  try {
    const info = execFileSync('file', [filePath], { encoding: 'utf-8' })
    return info.includes(expectedId)
  } catch {
    return false
  }
}

/**
 * Strategy 1: Replace from prebuilds/ directory within the same package.
 *
 * Packages like @homebridge/node-pty-prebuilt-multiarch ship prebuilt
 * binaries for every platform in their prebuilds/ directory:
 *   prebuilds/linux-arm64/node.abi131.node
 */
function replaceFromPrebuilds(nodeFile, targetArch, abiVersion) {
  // Walk up from build/Release/<file>.node to find the package root
  let dir = path.dirname(nodeFile)
  for (let i = 0; i < 5; i++) {
    const prebuildsDir = path.join(dir, 'prebuilds', `linux-${targetArch}`)
    if (fs.existsSync(prebuildsDir)) {
      const candidates = fs.readdirSync(prebuildsDir)
        .filter(f => f.endsWith('.node') && !f.includes('musl'))
        .sort()

      // Prefer exact ABI match
      if (abiVersion) {
        const exact = candidates.find(f => f.includes(`abi${abiVersion}`))
        if (exact) {
          fs.copyFileSync(path.join(prebuildsDir, exact), nodeFile)
          return true
        }
      }

      // Fallback: highest ABI available
      if (candidates.length > 0) {
        fs.copyFileSync(
          path.join(prebuildsDir, candidates[candidates.length - 1]),
          nodeFile
        )
        return true
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return false
}

/**
 * Strategy 2: Download the correct platform-specific npm package.
 *
 * Packages like @parcel/watcher delegate to platform-specific optional
 * dependencies (e.g. @parcel/watcher-linux-arm64-glibc). When building on
 * x86-64, only the x86-64 variant is installed. This downloads the correct
 * variant for the target architecture.
 */
function replaceFromPlatformPackage(nodeFile, relPath, targetArch) {
  // @parcel/watcher
  if (relPath.includes('@parcel') && relPath.includes('watcher')) {
    const libc = isMusl() ? 'musl' : 'glibc'
    const pkgName = `@parcel/watcher-linux-${targetArch}-${libc}`
    return downloadAndReplace(pkgName, 'watcher.node', nodeFile)
  }

  // bufferutil (N-API module)
  if (relPath.startsWith('bufferutil')) {
    try {
      const pkgJson = path.join(path.dirname(path.dirname(nodeFile)), 'package.json')
      const version = JSON.parse(fs.readFileSync(pkgJson, 'utf-8')).version
      return downloadAndBuild('bufferutil', version, 'bufferutil.node', nodeFile, targetArch)
    } catch {
      return false
    }
  }

  return false
}

/**
 * Download an npm package to a temp directory and copy a specific binary.
 */
function downloadAndReplace(pkgName, binaryName, destFile) {
  let tmpDir
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-native-'))
    execSync(`npm pack ${pkgName} --pack-destination "${tmpDir}"`, {
      cwd: tmpDir,
      stdio: 'pipe',
      timeout: 60000
    })

    const tarball = fs.readdirSync(tmpDir).find(f => f.endsWith('.tgz'))
    if (!tarball) return false

    execSync(`tar xzf "${path.join(tmpDir, tarball)}" -C "${tmpDir}"`, {
      stdio: 'pipe'
    })

    const src = path.join(tmpDir, 'package', binaryName)
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, destFile)
      return true
    }
  } catch (e) {
    console.warn(`[fix-native-modules] Failed to download ${pkgName}: ${e.message}`)
  } finally {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
  }
  return false
}

/**
 * Download and build an N-API module for the target architecture using
 * a cross-compiler (if available) or prebuild-install.
 */
function downloadAndBuild(pkgName, version, binaryName, destFile, targetArch) {
  const compilers = { arm64: 'aarch64-linux-gnu-gcc', armv7l: 'arm-linux-gnueabihf-gcc' }
  const cc = compilers[targetArch]

  if (!cc || !commandExists(cc)) {
    console.warn(`[fix-native-modules] Cross-compiler ${cc} not found, cannot rebuild ${pkgName}`)
    return false
  }

  let tmpDir
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-native-'))

    const env = {
      ...process.env,
      CC: cc,
      CXX: cc.replace('gcc', 'g++'),
      CC_host: 'gcc',
      CXX_host: 'g++',
      npm_config_arch: targetArch,
      npm_config_target_arch: targetArch
    }

    execSync(`npm init -y && npm install ${pkgName}@${version} --build-from-source`, {
      cwd: tmpDir,
      stdio: 'pipe',
      timeout: 120000,
      env
    })

    const built = path.join(tmpDir, 'node_modules', pkgName, 'build', 'Release', binaryName)
    if (fs.existsSync(built)) {
      fs.copyFileSync(built, destFile)
      return true
    }
  } catch (e) {
    console.warn(`[fix-native-modules] Failed to cross-compile ${pkgName}: ${e.message}`)
  } finally {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
  }
  return false
}

function isMusl() {
  try {
    execFileSync('ldd', ['--version'], { stdio: 'pipe' })
    return false
  } catch (e) {
    const output = (e.stderr || '') + (e.stdout || '')
    return output.toLowerCase().includes('musl')
  }
}

function commandExists(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}
