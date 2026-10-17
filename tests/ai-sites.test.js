// The lists of sites where the AI features are off or on: what is typed into them is cleaned
// and checked, lists kept in older forms are read as arrays, and the lists still decide where
// the features work.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { aiHandlers } from '../src/ai/background.js';
import { AI_CONFIG_KEY, getAiConfig, updateAiConfig } from '../src/ai/config.js';
import { MAX_SITES, addHost, checkHost, siteStatus, toHostList } from '../src/ai/sites.js';
import { createDevice, use } from './helpers/chrome.js';

beforeEach(() => {
  use(createDevice('device', { uiLanguage: 'en-US' }));
});

// --- typing one host -----------------------------------------------------------------------

test('a typed host loses its scheme, path, query, port, "www.", spaces and capitals', () => {
  assert.deepEqual(checkHost('https://www.Example.com/path/to?x=1#top'), { host: 'example.com' });
  assert.deepEqual(checkHost('http://news.example.com:8080/'), { host: 'news.example.com' });
  assert.deepEqual(checkHost('  SHOP.Example.ORG  '), { host: 'shop.example.org' });
  assert.deepEqual(checkHost('example.com/a/b'), { host: 'example.com' });
  assert.deepEqual(checkHost('example.com?q=1'), { host: 'example.com' });
  assert.deepEqual(checkHost('*.example.com'), { host: 'example.com' });
  assert.deepEqual(checkHost('example.com.'), { host: 'example.com' });
  assert.deepEqual(checkHost('localhost'), { host: 'localhost' });
  assert.deepEqual(checkHost('192.168.1.10'), { host: '192.168.1.10' });
});

test('a host in another script is kept the way the browser writes it, so that it matches', () => {
  const { host } = checkHost('Bücher.de');
  assert.equal(host, new URL('https://bücher.de').hostname);
  assert.equal(siteStatus(new URL('https://shop.bücher.de/').hostname, { blocked: [host] }), 'blocked');
});

test('what is not a host is refused, and nothing typed is said to be nothing', () => {
  for (const value of ['', '   ', '\n']) assert.deepEqual(checkHost(value), { error: 'empty' }, JSON.stringify(value));
  for (const value of ['example', 'bad host!', 'exa mple.com', 'example..com', '-example.com', 'example-.com', 'example.123', 'user@example.com', `${'a'.repeat(64)}.com`, '300.1.1.1', '.', 'https://', 'mailto:x@y.z']) {
    assert.deepEqual(checkHost(value), { error: 'invalid' }, value);
  }
});

test('adding: a new host goes at the end; a duplicate, a bad host or a full list is refused', () => {
  assert.deepEqual(addHost([], 'https://Example.com/x'), { list: ['example.com'], host: 'example.com' });
  assert.deepEqual(addHost(['example.com'], 'bbc.com'), { list: ['example.com', 'bbc.com'], host: 'bbc.com' });
  // the same host however it is written
  assert.deepEqual(addHost(['example.com'], 'WWW.EXAMPLE.COM/'), { error: 'duplicate', host: 'example.com' });
  assert.deepEqual(addHost(['example.com'], 'nope'), { error: 'invalid' });
  assert.deepEqual(addHost(['example.com'], ' '), { error: 'empty' });
  const full = Array.from({ length: MAX_SITES }, (_, i) => `site${i}.com`);
  assert.deepEqual(addHost(full, 'one-more.com'), { error: 'full' });
  // a host already there is said to be there, full or not
  assert.equal(addHost(full, 'site0.com').error, 'duplicate');
});

// --- stored lists --------------------------------------------------------------------------

test('a list kept as text, one host per line, is read as an array without blank lines or duplicates', () => {
  assert.deepEqual(toHostList('example.com\n\n  https://www.Example.com/\nbbc.com\r\n\nbbc.com\n'), ['example.com', 'bbc.com']);
  assert.deepEqual(toHostList(['example.com', '', 'EXAMPLE.com', 'bbc.com', null, 42, 'bad host!']), ['example.com', 'bbc.com']);
  assert.deepEqual(toHostList(['example.com', 'bbc.com']), ['example.com', 'bbc.com']);
  for (const value of [undefined, null, 42, {}, true, '']) assert.deepEqual(toHostList(value), [], String(value));
});

test('settings stored with the lists as text open as arrays, and are written back as arrays', async () => {
  await chrome.storage.local.set({ [AI_CONFIG_KEY]: { provider: '', blocked: 'news.example.com\n\nnews.example.com\nhttps://bbc.com/x', allowed: 'mail.google.com\n' } });
  const config = await getAiConfig();
  assert.deepEqual(config.blocked, ['news.example.com', 'bbc.com']);
  assert.deepEqual(config.allowed, ['mail.google.com']);
  await updateAiConfig({ cache: false });
  const stored = (await chrome.storage.local.get(AI_CONFIG_KEY))[AI_CONFIG_KEY];
  assert.deepEqual(stored.blocked, ['news.example.com', 'bbc.com']);
  assert.deepEqual(stored.allowed, ['mail.google.com']);
});

test('lists of another type do not stop the settings from opening', async () => {
  await chrome.storage.local.set({ [AI_CONFIG_KEY]: { blocked: { a: 1 }, allowed: 7 } });
  const config = await getAiConfig();
  assert.deepEqual(config.blocked, []);
  assert.deepEqual(config.allowed, []);
});

// --- what the lists decide ------------------------------------------------------------------

test('the lists decide as before: subdomains are covered, a block wins over an allowance', () => {
  const lists = { blocked: toHostList('example.com'), allowed: toHostList('mail.google.com\nexample.com') };
  assert.equal(siteStatus('example.com', lists), 'blocked');
  assert.equal(siteStatus('news.example.com', lists), 'blocked');
  assert.equal(siteStatus('notexample.com', lists), 'ok');
  assert.equal(siteStatus('mail.google.com', lists), 'ok');
  assert.equal(siteStatus('mail.google.com', {}), 'sensitive');
});

test('a block list kept as text still keeps the AI features off on that site', async () => {
  await updateAiConfig({ provider: 'gemini', providers: { gemini: { apiKey: 'k' } }, consent: 'gemini' });
  const stored = (await chrome.storage.local.get(AI_CONFIG_KEY))[AI_CONFIG_KEY];
  await chrome.storage.local.set({ [AI_CONFIG_KEY]: { ...stored, blocked: 'news.example.com\n' } });
  await assert.rejects(
    aiHandlers['wv:ai:explain']({ kind: 'word', text: 'book' }, { url: 'https://www.news.example.com/a', id: 'wordvault' }),
    (error) => error.code === 'ai_site' && error.detail === 'blocked',
  );
});
