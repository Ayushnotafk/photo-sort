#!/usr/bin/env node
'use strict';
/**
 * build.js – cross-platform build wrapper.
 *
 *   node scripts/build.js [--win|--mac|--linux]
 *
 * Uses electron-builder's JS API so no shell-spawning headaches on any OS.
 *
 * Windows note: electron-builder downloads a winCodeSign archive via 7zip.
 * That archive contains macOS symlinks that 7zip can't create on Windows
 * without Developer Mode, so extraction always produces a partial directory.
 * This script detects that, promotes the partial dir to the expected cache
 * path, and then electron-builder finds the tools on its own.
 */

process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');

// ── 1. Generate icons ─────────────────────────────────────────────────────────
console.log('Generating icons...');
require('./gen-icon.js');
console.log('');

// ── 2. Fix winCodeSign cache (Windows only) ───────────────────────────────────
if (process.platform === 'win32') {
  const cacheRoot = process.env.ELECTRON_BUILDER_CACHE
    || path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache');
  const cacheDir  = path.join(cacheRoot, 'winCodeSign');
  const finalDir  = path.join(cacheDir, 'winCodeSign-2.6.0');

  if (!fs.existsSync(finalDir)) {
    console.log('Seeding winCodeSign cache...');
    const appBuilder = path.join(
      root, 'node_modules', 'app-builder-bin', 'win', 'x64', 'app-builder.exe'
    );

    // Trigger the download – will fail at symlink creation, which is expected.
    try {
      require('node:child_process').execFileSync(
        appBuilder, ['download-artifact', '--name', 'winCodeSign'],
        { stdio: 'pipe', cwd: root }
      );
    } catch { /* symlink error – all Windows files were still extracted */ }

    // Promote the best partial extraction to the expected final path.
    if (!fs.existsSync(finalDir) && fs.existsSync(cacheDir)) {
      let best = null;
      for (const entry of fs.readdirSync(cacheDir)) {
        if (/^\d+$/.test(entry)) {
          const candidate = path.join(cacheDir, entry);
          if (fs.existsSync(path.join(candidate, 'rcedit-x64.exe'))) {
            const mtime = fs.statSync(candidate).mtimeMs;
            if (!best || mtime > best.mtime) best = { dir: candidate, mtime };
          }
        }
      }
      if (best) {
        fs.cpSync(best.dir, finalDir, { recursive: true });
        console.log(`  Cached from ${path.basename(best.dir)}`);
      } else {
        console.warn('  No partial extraction found — build may fail.');
        console.warn('  Try enabling Windows Developer Mode for symlink support.');
      }
    }
    console.log('');
  }
}

// ── 3. Build via electron-builder JS API ──────────────────────────────────────
const { build, Platform } = require('electron-builder');

const arg   = process.argv[2]; // --win | --mac | --linux | undefined
const targets = arg === '--win'   ? Platform.WINDOWS.createTarget()
              : arg === '--mac'   ? Platform.MAC.createTarget()
              : arg === '--linux' ? Platform.LINUX.createTarget()
              : undefined; // build for current platform

console.log('Building...');
build({ targets, config: require(path.join(root, 'package.json')).build })
  .then(outputs => {
    console.log('\nDone:');
    outputs.forEach(f => console.log(' ', f));
  })
  .catch(err => {
    console.error('\nBuild failed:', err.message || err);
    process.exit(1);
  });
