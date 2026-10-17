// The settings travel with the vault: the newest edit wins as a whole, the API keys only in an
// encrypted document (or a backup file made with them), a key one device lacks is never taken
// from the others, and what this device agreed to (sending text to a provider) stays its own.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { AI_CONFIG_KEY, getAiConfig, updateAiConfig } from '../src/ai/config.js';
import { createBackup, restoreBackup } from '../src/lib/backup.js';
import { getSettings, updateSettings } from '../src/lib/settings.js';
import { decodeDocument } from '../src/sync/codec.js';
import { syncNow, unlockEncryption } from '../src/sync/engine.js';
import { mergePrefs, notePrefsChange, PREFS_STAMP_KEY, readPrefs } from '../src/sync/prefs.js';
import { registerSyncProvider } from '../src/sync/providers/index.js';
import { setSyncConfig } from '../src/sync/state.js';
import { createDevice, use } from './helpers/chrome.js';
import { createCloud } from './helpers/memory-provider.js';

const T0 = 1_790_000_000_000;
const KEY = 'AIzaSyTEST-prefs-key-0123456789';
const DEEPL = 'deepl-secret-key:fx';
const PASSWORD = 'correct horse battery staple';

let cloud;
let a;
let b;

async function connect(device) {
  use(device);
  await setSyncConfig({ mode: 'cloud', providerId: 'memory', connection: { account: `${device.name}@example.com` }, connectedAt: Date.now() });
  return device;
}
beforeEach(async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  let provider;
  ({ cloud, provider } = createCloud());
  registerSyncProvider(provider);
  a = await connect(createDevice('A'));
  b = await connect(createDevice('B'));
});
const sync = (device) => {
  use(device);
  return syncNow({ reason: 'manual', sleep: async () => {} });
};
/** An edit on a device, as the background script notes it (background.js: storage.onChanged). */
async function edit(device, t, time, change) {
  use(device);
  t.mock.timers.setTime(time);
  await change();
  return notePrefsChange(time);
}
async function setUpA(t) {
  await edit(a, t, T0 + 1000, async () => {
    await updateSettings({ targetLang: 'de', quizDailyGoal: 12, providerConfig: { deepl: { apiKey: DEEPL } }, provider: 'deepl' });
    await updateAiConfig({ provider: 'gemini', providers: { gemini: { apiKey: KEY, model: 'gemini-x' } }, promptSite: 'claude', blocked: ['bank.example'], consent: 'gemini' });
    await chrome.storage.local.set({ uiLanguage: 'tr' });
  });
}

test('without encryption: every setting reaches the other device, the keys do not, and the cloud never holds one', async (t) => {
  await setUpA(t);
  await sync(a);
  const stored = JSON.stringify(await decodeDocument(cloud.data()));
  assert.ok(!stored.includes(KEY) && !stored.includes(DEEPL), 'no key in an unencrypted file');
  assert.ok(stored.includes('gemini-x'));

  await sync(b);
  use(b);
  const settings = await getSettings();
  const config = await getAiConfig();
  assert.equal(settings.targetLang, 'de');
  assert.equal(settings.quizDailyGoal, 12);
  assert.equal(settings.provider, 'deepl');
  assert.equal(settings.providerConfig.deepl?.apiKey, undefined);
  assert.equal(config.provider, 'gemini');
  assert.equal(config.providers.gemini.model, 'gemini-x');
  assert.equal(config.providers.gemini.apiKey, undefined);
  assert.deepEqual(config.blocked, ['bank.example']);
  assert.equal(config.promptSite, 'claude');
  assert.equal(config.consent, '', 'agreeing is asked again on this device');
  assert.equal((await chrome.storage.local.get('uiLanguage')).uiLanguage, 'tr');
});

test('with encryption: the keys travel too, inside the encrypted file only', async (t) => {
  await setUpA(t);
  use(a);
  await unlockEncryption({ password: PASSWORD });
  assert.ok(!Buffer.from(cloud.data()).toString('latin1').includes(KEY), 'the stored bytes do not show the key');

  use(b);
  await unlockEncryption({ password: PASSWORD });
  const config = await getAiConfig();
  assert.equal(config.providers.gemini.apiKey, KEY);
  assert.equal((await getSettings()).providerConfig.deepl.apiKey, DEEPL);
});

test('the newest edit wins as a whole, on either device, and it settles', async (t) => {
  await setUpA(t);
  await sync(a);
  await sync(b);
  await edit(b, t, T0 + 5000, () => updateSettings({ quizDailyGoal: 3 }));
  await sync(b);
  await sync(a);
  use(a);
  assert.equal((await getSettings()).quizDailyGoal, 3);
  assert.equal((await getSettings()).targetLang, 'de');
  assert.equal((await getAiConfig()).providers.gemini.apiKey, KEY, 'A keeps the key B never had');
  // nothing left to do: a further round writes nothing
  const writes = cloud.writes;
  await sync(a);
  await sync(b);
  assert.equal(cloud.writes, writes);
});

test('what is not an edit is not one: consents and model probing do not make a device "newer"', async (t) => {
  await setUpA(t);
  await sync(a);
  use(b);
  await sync(b);
  const stamp = (await chrome.storage.local.get(PREFS_STAMP_KEY))[PREFS_STAMP_KEY];
  t.mock.timers.setTime(T0 + 9000);
  await updateAiConfig({ consent: 'gemini', examConsent: 'gemini', vision: { 'gemini|x|': true } });
  assert.equal(await notePrefsChange(T0 + 9000), false);
  assert.equal((await chrome.storage.local.get(PREFS_STAMP_KEY))[PREFS_STAMP_KEY], stamp);
  await updateSettings({ ttsFallback: true });
  assert.equal(await notePrefsChange(T0 + 9500), true);
});

test('a device that never set anything takes the others\' settings instead of overwriting them', async (t) => {
  await setUpA(t);
  await sync(a);
  use(b);
  assert.equal((await readPrefs()).u, 0);
  await sync(b);
  assert.equal((await getSettings()).targetLang, 'de');
});

test('merging: the later wins; keys the later lacks come from the other; an emptied key stays empty', () => {
  const old = { u: 1, settings: { a: 1 }, ui: '', ai: {}, sites: {}, keys: { deepl: 'd', ai: { gemini: 'g', anthropic: 'c' } } };
  const newer = { u: 2, settings: { a: 2 }, ui: '', ai: {}, sites: {}, keys: { ai: { gemini: '' } } };
  const merged = mergePrefs(old, newer);
  assert.deepEqual(merged.settings, { a: 2 });
  assert.deepEqual(merged.keys, { deepl: 'd', ai: { gemini: '', anthropic: 'c' } });
  assert.deepEqual(mergePrefs(newer, old), merged, 'the same either way round');
  assert.equal(mergePrefs(null, old), old);
});

test('the backup file: settings always, keys only when asked for; restoring keeps keys the file lacks', async (t) => {
  await setUpA(t);
  use(a);
  const plain = JSON.stringify(await createBackup());
  assert.ok(plain.includes('gemini-x') && !plain.includes(KEY) && !plain.includes(DEEPL));
  const withKeys = JSON.stringify(await createBackup({ includeKeys: true }));
  assert.ok(withKeys.includes(KEY) && withKeys.includes(DEEPL));

  use(b);
  await updateAiConfig({ providers: { gemini: { apiKey: 'B-OWN-KEY' } } });
  await restoreBackup(plain);
  assert.equal((await getAiConfig()).providers.gemini.apiKey, 'B-OWN-KEY', 'a file without keys leaves this device\'s key');
  assert.equal((await getAiConfig()).providers.gemini.model, 'gemini-x');
  await restoreBackup(withKeys);
  assert.equal((await getAiConfig()).providers.gemini.apiKey, KEY);
  assert.ok((await chrome.storage.local.get(PREFS_STAMP_KEY))[PREFS_STAMP_KEY] > 0, 'a restore is an edit that travels on');
  assert.ok((await chrome.storage.local.get(AI_CONFIG_KEY))[AI_CONFIG_KEY]);
});
