// Stored settings of earlier versions: the settings that are gone are dropped, accent tolerance
// becomes the default once, and nothing else the user chose changes.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { DEFAULT_SETTINGS, REMOVED_SETTINGS, getSettings, migrateSettings, updateSettings, upgradeStoredSettings } from '../src/lib/settings.js';
import { createDevice, use } from './helpers/chrome.js';

beforeEach(() => {
  use(createDevice('device', { uiLanguage: 'tr' }));
});

/** What version 1 stored: every setting, the old defaults included, and a few choices of the user's. */
const OLD = {
  targetLang: 'tr',
  provider: 'deepl',
  providerConfig: { deepl: { apiKey: 'secret:fx' } },
  doubleClick: false,
  quizEnabled: true,
  quizIntervalMinutes: 45,
  quizMinCards: 10,
  quizModeClassic: false,
  quizModeWriting: true,
  quizModeListening: true,
  quizModeExpert: false,
  quizAccentTolerant: false,
  quizIncludePhrases: true,
  quizQuestionsPerQuiz: 3,
  quizDailyGoal: 8,
  quizQuietStart: '22:00',
  quizQuietEnd: '07:00',
  ocrLanguages: 'tr',
  ocrMinConfidence: 80,
  ocrRememberArea: true,
};

test('the new defaults: no removed setting, accents tolerated, a version', () => {
  for (const key of REMOVED_SETTINGS) assert.equal(key in DEFAULT_SETTINGS, false, key);
  assert.equal(DEFAULT_SETTINGS.quizAccentTolerant, true);
  assert.equal(DEFAULT_SETTINGS.settingsVersion, 2);
  assert.equal(DEFAULT_SETTINGS.quizEnabled, true);
});

test('migrating version 1 drops what is gone, turns accent tolerance on once and keeps the rest', () => {
  const after = migrateSettings(OLD);
  for (const key of REMOVED_SETTINGS) assert.equal(key in after, false, key);
  assert.equal(after.quizAccentTolerant, true);
  assert.equal(after.settingsVersion, 2);
  for (const key of ['targetLang', 'provider', 'providerConfig', 'doubleClick', 'quizIntervalMinutes', 'quizQuestionsPerQuiz', 'quizDailyGoal', 'quizQuietStart', 'quizQuietEnd', 'ocrRememberArea']) {
    assert.deepEqual(after[key], OLD[key], key);
  }
  assert.equal('settingsVersion' in OLD, false, 'the stored object itself is not changed');
});

test('once migrated, the user may switch accent tolerance off and it stays off', () => {
  const off = { ...migrateSettings(OLD), quizAccentTolerant: false };
  assert.equal(migrateSettings(off).quizAccentTolerant, false);
});

test('odd stored values open cleanly', () => {
  for (const odd of [undefined, null, 'text', 42, []]) {
    const after = migrateSettings(odd);
    assert.equal(after.settingsVersion, 2);
    assert.equal(after.quizAccentTolerant, true);
  }
});

test('an old settings object opens through getSettings, and the first write stores the new shape', async () => {
  await chrome.storage.local.set({ settings: OLD });
  const read = await getSettings();
  for (const key of REMOVED_SETTINGS) assert.equal(key in read, false, key);
  assert.equal(read.quizIntervalMinutes, 45);
  assert.equal(read.quizAccentTolerant, true);
  await updateSettings({ quizDailyGoal: 9 });
  const { settings } = await chrome.storage.local.get('settings');
  for (const key of REMOVED_SETTINGS) assert.equal(key in settings, false, key);
  assert.deepEqual([settings.settingsVersion, settings.quizDailyGoal, settings.providerConfig.deepl.apiKey], [2, 9, 'secret:fx']);
});

test('the upgrade at start-up rewrites an old store once, and leaves a current one alone', async () => {
  await chrome.storage.local.set({ settings: OLD });
  assert.equal(await upgradeStoredSettings(), true);
  const { settings } = await chrome.storage.local.get('settings');
  for (const key of REMOVED_SETTINGS) assert.equal(key in settings, false, key);
  assert.equal(settings.quizAccentTolerant, true);
  await updateSettings({ quizAccentTolerant: false });
  assert.equal(await upgradeStoredSettings(), false, 'nothing to do');
  assert.equal((await getSettings()).quizAccentTolerant, false, 'the user\'s choice after the upgrade stays');
  await chrome.storage.local.clear();
  assert.equal(await upgradeStoredSettings(), false, 'nothing stored: nothing to upgrade');
});

test('the vault and other stored data are not touched by the upgrade', async () => {
  await chrome.storage.local.set({ settings: OLD, 'vault:en|tr|blue': { text: 'blue' }, quizDifficulty: 'hard', aiConfig: { provider: 'gemini' } });
  await upgradeStoredSettings();
  const all = await chrome.storage.local.get(null);
  assert.deepEqual(all['vault:en|tr|blue'], { text: 'blue' });
  assert.equal(all.quizDifficulty, 'hard');
  assert.deepEqual(all.aiConfig, { provider: 'gemini' });
});
