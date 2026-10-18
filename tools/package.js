#!/usr/bin/env node

// Builds both targets and zips each for its store:
//   web-ext-artifacts/wordvault-<version>-chrome.zip
//   web-ext-artifacts/wordvault-<version>-firefox.zip
//   web-ext-artifacts/wordvault-<version>-source.zip      for addons.mozilla.org's reviewers (BUILD.md)
//   web-ext-artifacts/wordvault-<version>-SHA256SUMS.txt  every file of the two packages
// manifest.json is at the root of each zip. Uses the system's `zip` and `git` (macOS, Linux).

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
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

/** "<sha256>  ./<path>" for every file under dir, sorted by path: the format of `sha256sum` (BUILD.md). */
function checksums(dir) {
  const lines = [];
  const walk = (folder, prefix) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      const name = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(full, name);
      else lines.push([name, crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')]);
    }
  };
  walk(dir, '.');
  return lines.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, hash]) => `${hash}  ${name}`);
}

// The source package is what git has, so it has to be committed first.
if (execFileSync('git', ['status', '--porcelain'], { cwd: ROOT }).toString().trim()) {
  console.warn('warning: the working tree has uncommitted changes; the source zip holds only what is committed');
}

execFileSync(process.execPath, [path.join(ROOT, 'build.js'), '--release'], { stdio: 'inherit' });
fs.mkdirSync(OUT, { recursive: true });
const sums = [];
for (const target of ['chrome', 'firefox']) {
  const source = path.join(ROOT, 'dist', target);
  const config = fs.readFileSync(path.join(source, 'config.js'), 'utf8');
  // A package that still points at a placeholder or at this computer is not one to publish.
  for (const [name, bad] of [['SUPPORT_URL', /SUPPORT_URL = '[^']*YOUR_/], ['FEEDBACK_ENDPOINT', /FEEDBACK_ENDPOINT = '(?:[^']*YOUR_|http:)/]]) {
    if (bad.test(config)) console.warn(`warning: ${name} in src/config.js is a placeholder or a local address`);
  }
  // The Chrome Web Store assigns the item's own ID: the `key` that fixes the ID of the unpacked
  // copy (developer mode) is left out of the store package (SETUP-OAUTH.md, section 2).
  let packed = source;
  if (target === 'chrome') {
    packed = path.join(ROOT, 'dist', 'chrome-store');
    fs.rmSync(packed, { recursive: true, force: true });
    fs.cpSync(source, packed, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(packed, 'manifest.json'), 'utf8'));
    delete manifest.key;
    fs.writeFileSync(path.join(packed, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const zip = path.join(OUT, `wordvault-${version}-${target}.zip`);
  fs.rmSync(zip, { force: true });
  // -X: no extra file attributes; -r: recursive; hidden files are left out
  execFileSync('zip', ['-q', '-r', '-X', zip, '.', '-x', '.*', '-x', '*/.*'], { cwd: packed });
  console.log(`${path.relative(ROOT, zip)}: ${mb(fs.statSync(zip).size)} (unpacked ${mb(sizeOf(packed))})`);
  sums.push(`# ${path.basename(zip)}`, ...checksums(packed), '');
}

// The source for reviewers: the committed files, without the store images and the developer's
// specifications (SPEC*.md). oauth.local.json (the Google client ID, which is in every copy of the
// extension anyway) is added so that the rebuilt sync/config.js is the same as the one in the package.
const sourceZip = path.join(OUT, `wordvault-${version}-source.zip`);
fs.rmSync(sourceZip, { force: true });
execFileSync('git', ['archive', '--format=zip', `--output=${sourceZip}`, 'HEAD', '--', '.', ':(exclude)docs/store/screenshots', ':(exclude)docs/store/*.png', ':(exclude)SPEC*.md'], { cwd: ROOT });
if (fs.existsSync(path.join(ROOT, 'oauth.local.json'))) execFileSync('zip', ['-q', '-X', sourceZip, 'oauth.local.json'], { cwd: ROOT });
console.log(`${path.relative(ROOT, sourceZip)}: ${mb(fs.statSync(sourceZip).size)}`);

const list = path.join(OUT, `wordvault-${version}-SHA256SUMS.txt`);
fs.writeFileSync(list, sums.join('\n'));
console.log(path.relative(ROOT, list));
