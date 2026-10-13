// One spelling of a text for the caches: "Book", "book " and "book," are the same lookup.
// Only the cache key is made from this. What is sent to the service, what is shown and what is
// saved in the vault keep the spelling the user picked.
//
// The same rules exist once more in shared/translate-client.js, which is a classic script and
// cannot import this module; tests/request-optimisation.test.js holds the two to each other.

/** Languages whose capital I is not the capital of i. */
const DOTTED_I = new Set(['tr', 'az']);

/**
 * ASSUMPTION (from the specification): capital and small letters are the same lookup. For a few
 * words they are not the same word ("Polish" / "polish", German "Essen" / "essen"), and those
 * then share an answer for as long as it is remembered. Set to false to keep them apart.
 */
export const FOLD_CASE = true;

/**
 * @param {string} text
 * @param {string | null} [lang]  The language the text is in, if known: capital letters are
 *        made small by its rules (Turkish "I" becomes "ı", not "i").
 * @returns {string}
 */
export function normalizeText(text, lang = '') {
  let value = String(text ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  // punctuation and quotation marks around the text, not inside it ("don't", "e-mail" stay)
  const bare = value.replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '');
  if (bare) value = bare;
  if (!FOLD_CASE) return value;
  const primary = String(lang || '').toLowerCase().split('-')[0];
  // The dotless and dotted i of Turkish, done by hand: it must not depend on what the
  // browser's locale data happens to contain.
  if (DOTTED_I.has(primary)) value = value.replace(/İ/g, 'i').replace(/I/g, 'ı');
  return value.toLowerCase().normalize('NFC');
}
