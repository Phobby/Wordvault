// Telling text that lost characters on its way from text that merely looks unusual. Translation
// services sometimes hand back a word whose non-ASCII letters were replaced upstream ("eşitle"
// arrives as "e?itle" or "e? itle"); nothing on our side can bring the letter back, but it can
// be noticed: to ask the service another way, and to tell the user instead of showing it as is.

/** U+FFFD: what a decoder writes for bytes it could not read. */
const REPLACEMENT = /\uFFFD/;
/** UTF-8 read as Latin-1 or Windows-1252: "ÅŸ" for "ş", "Ã¼" for "ü", "Ä±" for "ı". */
const MOJIBAKE = /[\u00C2-\u00C5\u00D0\u00D1][\u0080-\u00BF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013-\u203A\u20AC\u2122]/;
/** A question mark inside a word: a letter, "?", perhaps a space, and the word goes on in lower case. */
const MARK_IN_WORD = /\p{L}\?\s?\p{Ll}/u;

/**
 * @param {string} text      The text to judge (a translation).
 * @param {string} [source]  What it is a translation of. A question in the source explains
 *                           question marks in the translation.
 * @returns {boolean} Whether characters were probably lost.
 */
export function looksDamaged(text, source = '') {
  const value = String(text || '');
  if (REPLACEMENT.test(value) || MOJIBAKE.test(value)) return true;
  return MARK_IN_WORD.test(value) && !/[?？¿؟;]/.test(String(source || ''));
}
