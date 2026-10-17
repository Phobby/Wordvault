// Where the content scripts run: every http(s) page, X (x.com, twitter.com) and their
// subdomains included, in every frame for the parts that translate.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const manifests = ['chrome', 'firefox'].map((name) => [name, JSON.parse(readFileSync(new URL(`../manifest.${name}.json`, import.meta.url), 'utf8'))]);

/** Whether a match pattern (developer.chrome.com/docs/extensions/develop/concepts/match-patterns) matches a URL. */
function matches(pattern, url) {
  if (pattern === '<all_urls>') return /^(https?|file|ftp|ws|wss):/.test(url);
  const [, scheme, host, path] = /^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)$/.exec(pattern) || [];
  const target = new URL(url);
  if (scheme === '*' ? !['http:', 'https:'].includes(target.protocol) : target.protocol !== `${scheme}:`) return false;
  if (host !== '*' && !(host.startsWith('*.') ? target.hostname === host.slice(2) || target.hostname.endsWith(host.slice(1)) : target.hostname === host)) return false;
  return new RegExp(`^${path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(target.pathname + target.search);
}

const X_PAGES = ['https://x.com/home', 'https://x.com/someone/status/1234567890', 'https://twitter.com/someone', 'https://mobile.x.com/home', 'https://mobile.twitter.com/explore', 'https://pro.x.com/'];

for (const [name, manifest] of manifests) {
  test(`${name}: the translating scripts run on X, in every frame`, () => {
    const main = manifest.content_scripts.find((entry) => entry.js.includes('content/triggers.js'));
    assert.ok(main, 'the script with the double-click and selection triggers');
    assert.equal(main.all_frames, true);
    for (const url of X_PAGES) assert.ok(main.matches.some((pattern) => matches(pattern, url)), url);
    assert.ok(main.js.indexOf('shared/voices.js') < main.js.indexOf('shared/speech.js'), 'voices.js before speech.js');
    const scan = manifest.content_scripts.find((entry) => entry.js.some((file) => file.includes('screen-ocr')));
    for (const url of X_PAGES) assert.ok(scan.matches.some((pattern) => matches(pattern, url)), `screen scan on ${url}`);
  });
}
