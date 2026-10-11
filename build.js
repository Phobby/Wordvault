#!/usr/bin/env node
'use strict';

// Builds dist/firefox and dist/chrome. There is no bundling or transpiling: src/ is copied as is
// and the browser-specific manifest is written next to it as manifest.json.
//
//   node build.js            build both targets
//   node build.js firefox    build one target
//   node build.js --watch    rebuild whenever src/ or a manifest changes

const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
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
  const shared = ['permissions', 'optional_permissions', 'host_permissions', 'optional_host_permissions', 'content_scripts'];
  if (manifests.firefox && manifests.chrome) {
    for (const key of shared) {
      if (JSON.stringify(manifests.firefox[key]) !== JSON.stringify(manifests.chrome[key])) {
        problems.push(`"${key}" differs between manifest.firefox.json and manifest.chrome.json`);
      }
    }
  }
  if (problems.length) throw new Error(`Build check failed:\n  - ${problems.join('\n  - ')}`);
}

function build(targets) {
  const manifests = Object.fromEntries(targets.map((target) => [target, readManifest(target)]));
  check(manifests);
  for (const target of targets) {
    const out = path.join(DIST, target);
    fs.rmSync(out, { recursive: true, force: true });
    fs.cpSync(SRC, out, { recursive: true, filter: (file) => !path.basename(file).startsWith('.') });
    fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifests[target], null, 2)}\n`);
    console.log(`built dist/${target} (v${manifests[target].version})`);
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
