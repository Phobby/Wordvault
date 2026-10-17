// OneDrive and Dropbox were offered by test versions and are gone: a device that had chosen one
// lets go of that connection quietly, and keeps every word, setting and past test.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { getSettings, updateSettings } from '../src/lib/settings.js';
import { addEntry, listEntries } from '../src/lib/vault.js';
import { setSecret, getSecret, deriveSecret } from '../src/sync/crypto.js';
import { dropRemovedProviders, syncNow } from '../src/sync/engine.js';
import { getSyncConfig, getSyncStatus, saveSyncStatus, setSyncConfig } from '../src/sync/state.js';
import { createDevice, use } from './helpers/chrome.js';

beforeEach(() => {
  use(createDevice('device'));
});

for (const providerId of ['onedrive', 'dropbox']) {
  test(`${providerId}: the stored connection and its tokens go, synchronisation is "this device only", the vault stays`, async () => {
    await addEntry({ text: 'book', translation: 'kitap', sourceLang: 'en', targetLang: 'tr' });
    await updateSettings({ quizDailyGoal: 7 });
    await setSyncConfig({ mode: 'cloud', providerId, connection: { accessToken: 'AT-secret', refreshToken: 'RT-secret', expiresAt: 1 }, connectedAt: 1, encryption: { enabled: true, remember: true } });
    await saveSyncStatus({ state: 'error', error: { code: 'sync_unknown_provider', detail: providerId, at: 1 } });
    await setSecret(await deriveSecret('a password'), { remember: true });

    assert.equal(await dropRemovedProviders(), true);
    const config = await getSyncConfig();
    assert.equal(config.mode, 'off');
    assert.equal(config.providerId, '');
    assert.equal(config.connection, null);
    assert.ok(!JSON.stringify(await chrome.storage.local.get(null)).includes('RT-secret'), 'no token is left anywhere');
    assert.equal((await getSyncStatus()).state, 'idle');
    assert.equal(await getSecret(), null);
    assert.deepEqual((await listEntries()).map((entry) => entry.text), ['book'], 'the vault is untouched');
    assert.equal((await getSettings()).quizDailyGoal, 7, 'the settings too');
    // a run afterwards does nothing and reports nothing wrong
    assert.equal((await syncNow({ reason: 'startup', sleep: async () => {} })).state, 'idle');
  });
}

test('other connections are left alone', async () => {
  for (const config of [{ mode: 'cloud', providerId: 'gdrive', connection: { accessToken: 'x' } }, { mode: 'browser', providerId: 'browser', connection: {} }, { mode: 'off', providerId: '', connection: null }]) {
    await setSyncConfig(config);
    assert.equal(await dropRemovedProviders(), false);
    assert.equal((await getSyncConfig()).providerId, config.providerId);
  }
});
