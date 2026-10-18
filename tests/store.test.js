// The store preparation files stay true to the extension: descriptions within the limit, a
// justification for every permission, a privacy policy that names where feedback really goes
// and loads nothing from elsewhere.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { feedbackEndpoint } from '../src/config.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const json = (path) => JSON.parse(read(path));

test('short descriptions fit the 132 characters the stores allow', () => {
  const listing = read('docs/store/en/listing.md') + read('docs/store/tr/listing.md');
  for (const lang of ['en', 'tr']) {
    const inManifest = json(`src/_locales/${lang}/messages.json`).extDescription.message;
    assert.ok([...inManifest].length <= 132, `${lang}: ${[...inManifest].length}`);
    assert.ok(listing.includes(`- **${lang}:** ${inManifest}`), `${lang}: the listing quotes the manifest's description`);
  }
});

test('every permission of both manifests has a justification', () => {
  const justifications = read('docs/store/en/permissions.md');
  for (const target of ['chrome', 'firefox']) {
    const manifest = json(`manifest.${target}.json`);
    const asked = [...manifest.permissions, ...(manifest.optional_permissions || []), ...manifest.host_permissions, ...(manifest.optional_host_permissions || [])];
    for (const permission of asked) assert.ok(justifications.includes(`\`${permission}\``), `${target}: ${permission}`);
    for (const script of manifest.content_scripts) for (const match of script.matches) assert.ok(justifications.includes(match.replace(/^\*:\/\/\*\.|\/\*$/g, '')), `${target}: ${match}`);
    for (const category of Object.values(manifest.browser_specific_settings?.gecko?.data_collection_permissions || {}).flat()) assert.ok(justifications.includes(`\`${category}\``), category);
  }
  assert.match(justifications, /wasm-unsafe-eval/);
});

test('the privacy documents name the place feedback goes to, and what is never sent', () => {
  const host = feedbackEndpoint() ? new URL(feedbackEndpoint()).hostname : '';
  for (const path of ['PRIVACY.md', 'docs/privacy.html']) {
    const text = read(path);
    if (host) assert.ok(text.includes(host), `${path} names ${host}`);
    for (const word of ['Telegram', 'Cloudflare', 'IP', 'Origin', 'MyMemory', 'Wiktionary']) assert.ok(text.includes(word), `${path}: ${word}`);
  }
  const web = read('docs/privacy.html');
  assert.ok(!/<script|<link|<img|<iframe|@import|url\(|src=["']https?:/i.test(web), 'the page loads nothing');
});

test('the declaration says there is no remote code, and the package has none', () => {
  assert.match(read('docs/store/en/privacy-practices.md'), /No, I am not using remote code/);
  for (const target of ['chrome', 'firefox']) {
    assert.equal(json(`manifest.${target}.json`).content_security_policy.extension_pages, "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'");
  }
  for (const page of ['src/options/options.html', 'src/popup/popup.html', 'src/welcome/welcome.html']) {
    assert.ok(!/(?:src|href)=["']https?:/i.test(read(page)), page);
  }
});

test('the store icon is 128 by 128', () => {
  const png = readFileSync(new URL('../src/icons/icon-128.png', import.meta.url));
  assert.equal(png.toString('latin1', 1, 4), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [128, 128]);
});
