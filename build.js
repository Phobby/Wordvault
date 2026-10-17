#!/usr/bin/env node

// Builds dist/firefox and dist/chrome. There is no bundling or transpiling: src/ is copied as is
// and the browser-specific manifest is written next to it as manifest.json.
//
//   node build.js            build both targets
//   node build.js firefox    build one target
//   node build.js --watch    rebuild whenever src/ or a manifest changes
//   node build.js --release  a build for the stores: missing interface strings are not
//                            reported on the browser's console (shared/i18n.js: DEV)
//
// The interface translations are checked first (tools/i18n/check.js): a missing key is a
// warning (English is shown there), a broken one (placeholders, braces, JSON) stops the build.

import fs from 'node:fs';
import path from 'node:path';
import { checkRepository, report } from './tools/i18n/check.js';

const ROOT = import.meta.dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const TARGETS = ['firefox', 'chrome'];

const manifestPath = (target) => path.join(ROOT, `manifest.${target}.json`);

function readManifest(target) {
  return JSON.parse(fs.readFileSync(manifestPath(target), 'utf8'));
}

/** Every file a manifest points at; a typo here otherwise only shows up when the browser loads it. */
function referencedFiles(manifest) {
  const files = [
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    manifest.background?.service_worker,
    ...(manifest.background?.scripts || []),
  ];
  for (const entry of manifest.content_scripts || []) {
    files.push(...(entry.js || []), ...(entry.css || []));
  }
  if (manifest.default_locale) files.push(`_locales/${manifest.default_locale}/messages.json`);
  return files.filter(Boolean);
}

function check(manifests) {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const problems = [];
  for (const [target, manifest] of Object.entries(manifests)) {
    if (manifest.version !== version) {
      problems.push(`manifest.${target}.json is version ${manifest.version}, package.json is ${version}`);
    }
    for (const file of referencedFiles(manifest)) {
      if (!fs.existsSync(path.join(SRC, file))) {
        problems.push(`manifest.${target}.json references missing file src/${file}`);
      }
    }
  }
  // Both browsers run the same code, so everything except the background declaration and the
  // browser-specific keys has to stay in sync between the two manifests.
  // Exception: what only Chrome needs. Its service worker cannot run text recognition, so that
  // happens in an offscreen document.
  const CHROME_ONLY_PERMISSIONS = ['offscreen'];
  const shared = ['permissions', 'optional_permissions', 'host_permissions', 'optional_host_permissions', 'content_scripts', 'content_security_policy', 'commands'];
  if (manifests.firefox && manifests.chrome) {
    const comparable = (target, key) => {
      const value = manifests[target][key];
      return JSON.stringify(key === 'permissions' && target === 'chrome' ? value.filter((name) => !CHROME_ONLY_PERMISSIONS.includes(name)) : value);
    };
    for (const key of shared) {
      if (comparable('firefox', key) !== comparable('chrome', key)) {
        problems.push(`"${key}" differs between manifest.firefox.json and manifest.chrome.json`);
      }
    }
  }
  if (problems.length) throw new Error(`Build check failed:\n  - ${problems.join('\n  - ')}`);
}

/**
 * Client IDs of the cloud providers that are kept out of the repository: `oauth.local.json`
 * next to this file (ignored by git) may name them, and they are then written into the built
 * copy of sync/config.js in place of the placeholders. The source file is never changed.
 *   { "gdrive": "….apps.googleusercontent.com" }
 */
const LOCAL_OAUTH = path.join(ROOT, 'oauth.local.json');

function injectClientIds(out) {
  if (!fs.existsSync(LOCAL_OAUTH)) return [];
  const ids = JSON.parse(fs.readFileSync(LOCAL_OAUTH, 'utf8'));
  const file = path.join(out, 'sync/config.js');
  let source = fs.readFileSync(file, 'utf8');
  const used = [];
  for (const [provider, id] of Object.entries(ids)) {
    if (typeof id !== 'string' || id.trim() === '' || id.startsWith('YOUR_')) continue;
    if (!/^[\w.@-]+$/.test(id.trim())) throw new Error(`oauth.local.json: the value for "${provider}" does not look like a client ID`);
    const line = new RegExp(`(\\b${provider}: ')[^']*(')`);
    if (!line.test(source)) throw new Error(`oauth.local.json: sync/config.js has no provider "${provider}"`);
    source = source.replace(line, `$1${id.trim()}$2`);
    used.push(provider);
  }
  fs.writeFileSync(file, source);
  return used;
}

const RELEASE = process.argv.includes('--release');

function build(targets) {
  const manifests = Object.fromEntries(targets.map((target) => [target, readManifest(target)]));
  check(manifests);
  const locales = checkRepository(ROOT);
  if (locales.errors.length || locales.warnings.length) report({ ...locales, notes: [] });
  if (locales.errors.length) throw new Error('Build check failed: the interface translations have errors (npm run i18n:check)');
  for (const target of targets) {
    const out = path.join(DIST, target);
    fs.rmSync(out, { recursive: true, force: true });
    fs.cpSync(SRC, out, { recursive: true, filter: (file) => !path.basename(file).startsWith('.') });
    fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifests[target], null, 2)}\n`);
    if (RELEASE) {
      const loader = path.join(out, 'shared/i18n.js');
      const source = fs.readFileSync(loader, 'utf8');
      if (!source.includes('const DEV = true;')) throw new Error('shared/i18n.js: "const DEV = true;" not found');
      fs.writeFileSync(loader, source.replace('const DEV = true;', 'const DEV = false;'));
    }
    const ids = injectClientIds(out);
    console.log(`built dist/${target} (v${manifests[target].version})${ids.length ? `, client IDs from oauth.local.json: ${ids.join(', ')}` : ''}`);
  }
}

function watch(targets) {
  let timer = null;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        build(targets);
      } catch (error) {
        console.error(error.message);
      }
    }, 100);
  };
  fs.watch(SRC, { recursive: true }, rebuild);
  for (const target of targets) fs.watch(manifestPath(target), rebuild);
  if (fs.existsSync(LOCAL_OAUTH)) fs.watch(LOCAL_OAUTH, rebuild);
  console.log('watching src/ and manifests for changes…');
}

const args = process.argv.slice(2);
const requested = args.filter((arg) => !arg.startsWith('--'));
const unknown = requested.filter((target) => !TARGETS.includes(target));
if (unknown.length) {
  console.error(`Unknown target: ${unknown.join(', ')}. Expected one of: ${TARGETS.join(', ')}`);
  process.exit(1);
}
const targets = requested.length ? requested : TARGETS;

try {
  build(targets);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
if (args.includes('--watch')) watch(targets);
