// The version of what this device stores, and bringing older data up to it.
//
//   1  the vault as it was: words with their quiz summary
//   2  learned state and a count per way of asking (inside each word's quiz summary), the days
//      a quiz was done, the translation cache
//
// Going from 1 to 2 rewrites nothing: every field version 2 added is optional and reads as
// "nothing yet" when it is missing (quiz/learning.js: normalizeStats), so a word saved a year
// ago is a word without a run of right answers, and no revision or date of it changes. What
// the step does is note the version, so that a later one that does have to rewrite something
// knows where it starts.

export const LOCAL_SCHEMA = 2;
const SCHEMA_KEY = 'schemaVersion';

/**
 * Brings what is stored up to this version. Safe to call at every start.
 * @returns {Promise<{ from: number, to: number }>}
 */
export async function ensureSchema() {
  const stored = Number((await chrome.storage.local.get(SCHEMA_KEY))[SCHEMA_KEY]) || 1;
  // Data written by a newer version is left alone, version included.
  if (stored >= LOCAL_SCHEMA) return { from: stored, to: stored };
  await chrome.storage.local.set({ [SCHEMA_KEY]: LOCAL_SCHEMA });
  return { from: stored, to: LOCAL_SCHEMA };
}
