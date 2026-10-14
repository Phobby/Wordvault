// The interface language (shared/i18n.js): filling messages in, plural forms, which language
// is used, falling back to English, keeping the choice, every part switching when it changes,
// the right-click menu following it, and the check of the translation files.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';
import vm from 'node:vm';

import { checkLocales, checkRepository, placeholdersOf } from '../tools/i18n/check.js';
import { createDevice, use } from './helpers/chrome.js';
import { i18n, readLocale, useLanguage } from './helpers/i18n.js';

const LOADER = readFileSync(new URL('../src/shared/i18n.js', import.meta.url), 'utf8');
const EN = readLocale('en');
const TR = readLocale('tr');

let device;
let warnings;
const realWarn = console.warn;
beforeEach(() => {
  device = use(createDevice('device', { uiLanguage: 'en-US' }));
  warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
});
afterEach(() => {
  console.warn = realWarn;
});

/**
 * Another part of the extension with its own copy of the loader, as every page and content
 * script has: `origin` is where it runs (the extension's own pages can read its files, a
 * content script runs on the web page's origin and cannot). `reads` records which language
 * files it read.
 */
function context({ origin = 'test-extension:', browserLanguage = 'en-US', background = null, files = { en: EN, tr: TR } } = {}) {
  const reads = [];
  const chrome = {
    ...device.chrome,
    i18n: { ...device.chrome.i18n, getUILanguage: () => browserLanguage },
    runtime: {
      ...device.chrome.runtime,
      getURL: (path) => `test-extension://id/${path}`,
      // A content script's message reaches the background script's handler.
      sendMessage: async (message) => (message.type === 'wv:i18n:load' && background ? { result: await background.publish() } : undefined),
    },
  };
  const sandbox = { chrome, console, Intl, location: { href: origin === 'test-extension:' ? 'test-extension://id/options/options.html' : `${origin}/page` } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(LOADER, sandbox, { filename: 'i18n.js' });
  sandbox.WV.i18n.setReader(async (lang) => {
    reads.push(lang);
    if (!files[lang]) throw new Error(`no ${lang}`);
    return structuredClone(files[lang]);
  });
  return { i18n: sandbox.WV.i18n, reads };
}

// --- Messages ---------------------------------------------------------------------------------

test('placeholders are filled in by name, and numbers are written the way the language writes them', () => {
  const { format } = i18n;
  assert.equal(format('Use {provider}', { provider: 'DeepL' }), 'Use DeepL');
  assert.equal(format('{count} of {total}', { total: 5, count: 2 }), '2 of 5', 'the order in the text is the message\'s');
  assert.equal(format('about {count} characters', { count: 12345 }, 'en'), 'about 12,345 characters');
  assert.equal(format('yaklaşık {count} karakter', { count: 12345 }, 'tr'), 'yaklaşık 12.345 karakter');
  assert.equal(format('{name} and {unknown}', { name: 'a' }), 'a and {unknown}', 'a value nobody gave stays visible');
  assert.equal(format('text: {value}', { value: '{not} #a #placeholder' }), 'text: {not} #a #placeholder', 'a value is never read as a message');
});

test('plural forms follow the language\'s rules (Intl.PluralRules)', () => {
  const { format } = i18n;
  const words = '{count, plural, one {# word} other {# words}}';
  assert.equal(format(words, { count: 1 }, 'en'), '1 word');
  assert.equal(format(words, { count: 2 }, 'en'), '2 words');
  assert.equal(format(words, { count: 0 }, 'en'), '0 words');
  assert.equal(format(words, { count: 1500 }, 'en'), '1,500 words');
  assert.equal(format('{count, plural, =0 {nothing} one {# item} other {# items}}', { count: 0 }, 'en'), 'nothing', 'an exact number wins');
  assert.equal(format('{count, plural, one {# more word to {rank}} other {# more words to {rank}}}', { count: 3, rank: 'Explorer' }, 'en'), '3 more words to Explorer');
  // Arabic has six forms; the rules are the browser's, not ours.
  const arabic = '{n, plural, zero {z} one {o} two {t} few {f} many {m} other {x}}';
  assert.deepEqual([0, 1, 2, 3, 11, 100].map((n) => format(arabic, { n }, 'ar')), ['z', 'o', 't', 'f', 'm', 'x']);
  assert.equal(format(EN.tbCount, { count: 1 }, 'en'), '1 word');
  assert.equal(format(TR.tbCount, { count: 1 }, 'tr'), '1 kelime');
});

test('the language: the user\'s choice, else the browser\'s if it is offered, else English', () => {
  const { resolve } = i18n;
  assert.equal(resolve('tr', 'en-US'), 'tr');
  assert.equal(resolve('', 'tr-TR'), 'tr', 'the browser\'s language by its main part');
  assert.equal(resolve('', 'TR'), 'tr');
  assert.equal(resolve('', 'fi-FI'), 'en', 'a language that is not offered: English');
  assert.equal(resolve('xx', 'tr'), 'tr', 'a stored choice that is no longer offered counts as none');
  assert.equal(i18n.dir('ar'), 'rtl');
  assert.equal(i18n.dir('he-IL'), 'rtl');
  assert.equal(i18n.dir('tr'), 'ltr');
});

// --- Loading ------------------------------------------------------------------------------------

test('on first use the browser\'s language is used, and only it (with English for gaps) is read', async () => {
  const page = context({ browserLanguage: 'tr-TR' });
  assert.equal(await page.i18n.load(), 'tr');
  assert.equal(page.i18n.t('optUiLang'), 'Arayüz dili');
  assert.deepEqual(page.reads.sort(), ['en', 'tr'], 'no other language file is read');
  const stored = device.dump().i18nCache;
  assert.equal(stored.lang, 'tr');
  assert.equal(stored.messages.optUiLang, 'Arayüz dili');
  assert.equal(device.dump().uiLanguage, undefined, 'nothing is chosen for the user');

  const english = context({ browserLanguage: 'fi-FI' });
  await device.chrome.storage.local.remove('i18nCache');
  assert.equal(await english.i18n.load(), 'en', 'a browser language that is not offered: English');
  assert.deepEqual(english.reads, ['en']);
});

test('a key a language lacks is shown in English; one no file has is shown as itself and reported', async () => {
  const partial = { ...TR };
  delete partial.optUiLangHelp;
  const page = context({ browserLanguage: 'tr', files: { en: EN, tr: partial } });
  await page.i18n.load();
  assert.equal(page.i18n.t('optUiLang'), 'Arayüz dili');
  assert.equal(page.i18n.t('optUiLangHelp'), EN.optUiLangHelp);
  assert.equal(page.i18n.t('noSuchKey'), 'noSuchKey');
  page.i18n.t('noSuchKey');
  assert.equal(warnings.filter((line) => line.includes('noSuchKey')).length, 1, 'reported once, in a development build');
});

test('the choice is kept: a part that starts later (or a background script that woke up) uses it', async () => {
  const options = context();
  await options.i18n.load();
  assert.equal(options.i18n.lang(), 'en');
  await options.i18n.setLanguage('tr');
  assert.equal(device.dump().uiLanguage, 'tr');
  assert.equal(options.i18n.t('optUiLang'), 'Arayüz dili');

  const later = context({ browserLanguage: 'en-US' });
  assert.equal(await later.i18n.load(), 'tr');
  assert.deepEqual(later.reads, [], 'it found the strings in storage');
  assert.equal(later.i18n.t('quizTitle'), TR.quizTitle);

  await options.i18n.setLanguage('');
  assert.equal(device.dump().uiLanguage, '', '"automatic" is a choice too');
  const again = context({ browserLanguage: 'tr-TR' });
  assert.equal(await again.i18n.load(), 'tr', 'automatic follows the browser');
});

test('a content script gets the strings from the background script, and switches at once when the language changes', async () => {
  const background = context();
  const content = context({ origin: 'https://example.com', background: background.i18n });
  assert.equal(await content.i18n.load(), 'en');
  assert.deepEqual(content.reads, [], 'a content script reads no file of the extension');
  assert.deepEqual(background.reads, ['en']);
  const heard = [];
  content.i18n.onChange((lang) => heard.push(lang));
  assert.equal(content.i18n.t('quizTitle'), EN.quizTitle);

  const options = context();
  await options.i18n.load();
  await options.i18n.setLanguage('tr');
  assert.deepEqual(heard, ['tr'], 'told once');
  assert.equal(content.i18n.t('quizTitle'), TR.quizTitle, 'no reload needed');
  assert.equal(content.i18n.lang(), 'tr');

  // The background script storing the same language again (it does when it starts) is no change.
  await background.i18n.publish({ force: true });
  assert.deepEqual(heard, ['tr']);
});

test('the right-click menu gets its titles in the new language (contextMenus.update)', async () => {
  await useLanguage('en');
  const { addMenuItem, rebuildMenus } = await import('../src/background/menus.js');
  const { t } = await import('../src/background/i18n.js');
  addMenuItem(() => ({ id: 'wv-test', title: t('menuTranslate'), contexts: ['selection'] }));
  await rebuildMenus();
  assert.equal(device.menu.get('wv-test').title, EN.menuTranslate);
  await i18n.setLanguage('tr');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const { relabelMenus } = await import('../src/background/menus.js');
  await relabelMenus(); // (waits for the turn the change started)
  assert.equal(device.menu.get('wv-test').title, TR.menuTranslate);
});

// --- The check of the files ---------------------------------------------------------------------

test('the repository\'s translation files pass the check', () => {
  const result = checkRepository(new URL('..', import.meta.url).pathname);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.counts.en, Object.keys(EN).length);
  assert.equal(result.counts.tr, Object.keys(EN).length);
});

test('the check finds missing and extra keys, broken placeholders, empty and invalid files', () => {
  const en = { a: 'Use {provider}', b: '{count, plural, one {# word} other {# words}}', c: 'Plain', d: 'Two: {x} {y}' };
  const run = (de, languages = ['en', 'de']) => checkLocales({ languages, files: { en: JSON.stringify(en), de: typeof de === 'string' ? de : JSON.stringify(de) } });

  const fine = run({ a: 'Nutze {provider}', b: '{count, plural, one {# Wort} other {# Wörter}}', c: 'Schlicht', d: 'Zwei: {y} {x}' });
  assert.deepEqual([fine.errors, fine.warnings], [[], []], 'another order of the same placeholders is fine');

  const missing = run({ a: 'Nutze {provider}', b: '{count} Wörter', d: '{x} {y}' });
  assert.deepEqual(missing.errors, [], 'a plain {count} where English has a plural is allowed (a language without plural forms)');
  assert.equal(missing.warnings.length, 1);
  assert.match(missing.warnings[0], /de: 1 key\(s\) missing.*\bc\b/);

  const broken = run({ a: 'Nutze {anbieter}', b: '{count, plural, one {# Wort}}', c: '', d: 'Zwei: {x} {y', e: 'extra' });
  assert.ok(broken.errors.some((line) => /"a" has placeholders \{anbieter\}, en has \{provider\}/.test(line)));
  assert.ok(broken.errors.some((line) => /"b": plural "count" has no "other" form/.test(line)));
  assert.ok(broken.errors.some((line) => /"c" is empty/.test(line)));
  assert.ok(broken.errors.some((line) => /"d": a "\{" without "\}"/.test(line)));
  assert.ok(broken.errors.some((line) => /"e" is not in en\.json/.test(line)));

  assert.ok(run('{ "a": ').errors.some((line) => /de\.json is not valid/.test(line)));
  assert.ok(run({}, ['en']).errors.some((line) => /de\.json is not listed/.test(line)));
  assert.ok(run({}, ['en', 'de', 'fr']).errors.some((line) => /fr is listed .* does not exist/.test(line)));
  const unknownKey = checkLocales({ languages: ['en'], files: { en: JSON.stringify(en) }, codeKeys: new Set(['a', 'zz']) });
  assert.deepEqual(unknownKey.errors, ['the code asks for "zz", which en.json does not have']);
});

test('placeholders are read the same way the loader fills them in', () => {
  assert.deepEqual(placeholdersOf('{count, plural, one {# more word to {rank}} other {# more words to {rank}}}').names, ['count', 'rank']);
  assert.deepEqual(placeholdersOf('# of {x}').problems, ['"#" outside a plural']);
  assert.deepEqual(placeholdersOf('{a b}').problems, ['"{a b}" is neither {name} nor a plural']);
  assert.deepEqual(placeholdersOf('{n, plural, lots {x} other {y}}').problems, ['plural "n": unknown form "lots"']);
});

test('a quiz plan stored by an older version under its Turkish field name is still read', async () => {
  const { getQuizState } = await import('../src/quiz/scheduler.js');
  await chrome.storage.local.set({ quizState: { sonrakiQuizZamani: 1_800_000_000_000, planInterval: 20 } });
  const state = await getQuizState();
  assert.equal(state.nextQuizAt, 1_800_000_000_000);
  assert.equal('sonrakiQuizZamani' in state, false);
});
