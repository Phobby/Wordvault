// The interface language in tests: shared/i18n.js reading src/locales from disk, as the
// extension reads it from its package. Call after use(device): the choice and the stored
// strings live in that device's storage.

import { readFileSync } from 'node:fs';
import '../../src/shared/i18n.js';

export const i18n = globalThis.WV.i18n;

export const readLocale = (lang) => JSON.parse(readFileSync(new URL(`../../src/locales/${lang}.json`, import.meta.url), 'utf8'));

/** Starts the device's interface in a language ('' = follow its browser language). */
export async function useLanguage(choice = '') {
  i18n.reset();
  i18n.setReader(async (lang) => readLocale(lang));
  await chrome.storage.local.set({ [i18n.CHOICE_KEY]: choice });
  await i18n.publish({ force: true });
  await i18n.load();
}
