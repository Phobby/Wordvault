#!/usr/bin/env node

// Builds both targets and zips each for its store:
//   web-ext-artifacts/wordvault-<version>-chrome.zip
//   web-ext-artifacts/wordvault-<version>-firefox.zip
// manifest.json is at the root of each zip. Uses the system's `zip` (macOS, Linux).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'web-ext-artifacts');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

function sizeOf(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? sizeOf(full) : fs.statSync(full).size;
  }
  return total;
}

execFileSync(process.execPath, [path.join(ROOT, 'build.js')], { stdio: 'inherit' });
fs.mkdirSync(OUT, { recursive: true });
for (const target of ['chrome', 'firefox']) {
  const source = path.join(ROOT, 'dist', target);
  const config = fs.readFileSync(path.join(source, 'config.js'), 'utf8');
  // A package that still points at a placeholder or at this computer is not one to publish.
  for (const [name, bad] of [['SUPPORT_URL', /SUPPORT_URL = '[^']*YOUR_/], ['FEEDBACK_ENDPOINT', /FEEDBACK_ENDPOINT = '(?:[^']*YOUR_|http:)/]]) {
    if (bad.test(config)) console.warn(`warning: ${name} in src/config.js is a placeholder or a local address`);
  }
  const zip = path.join(OUT, `wordvault-${version}-${target}.zip`);
  fs.rmSync(zip, { force: true });
  // -X: no extra file attributes; -r: recursive; hidden files are left out
  execFileSync('zip', ['-q', '-r', '-X', zip, '.', '-x', '.*', '-x', '*/.*'], { cwd: source });
  console.log(`${path.relative(ROOT, zip)}: ${mb(fs.statSync(zip).size)} (unpacked ${mb(sizeOf(source))})`);
}
