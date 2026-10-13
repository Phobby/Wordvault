'use strict';

// Checking a typed answer, and what goes with it: the hint ("b _ _ _") and the comparison
// that shows which letters were wrong. No DOM, so it can be tested as it is.

(function (WV) {
  if (!WV || WV.quizAnswers) return;

  /** Languages whose capital I is not the capital of i. */
  const DOTTED_I = ['tr', 'az'];

  /**
   * The form in which a typed answer and the expected one are compared: Unicode form, case
   * and spaces around and between the words do not matter. Accents do, unless told otherwise.
   * @param {string} text
   * @param {{ lang?: string, accentTolerant?: boolean }} [options]
   *        accentTolerant: "cafe" is "café", "uber" is "über" (and a dotless ı is an i).
   */
  function normalize(text, { lang = '', accentTolerant = false } = {}) {
    let value = String(text == null ? '' : text).normalize('NFC').replace(/\s+/g, ' ').trim();
    const primary = String(lang || '').toLowerCase().split('-')[0];
    if (DOTTED_I.includes(primary)) value = value.replace(/İ/g, 'i').replace(/I/g, 'ı');
    value = value.toLowerCase().normalize('NFC');
    // typographic apostrophes and dashes are what a keyboard cannot easily type
    value = value.replace(/[‘’ʼ]/g, "'").replace(/[‐-―]/g, '-');
    if (accentTolerant) value = value.normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ø/g, 'o').replace(/ł/g, 'l').replace(/đ/g, 'd');
    return value;
  }

  /**
   * @param {string} typed
   * @param {string[]} accepted  The expected answer first; then other saved words that mean the same.
   * @returns {boolean}
   */
  function isCorrect(typed, accepted, options) {
    const given = normalize(typed, options);
    return given !== '' && accepted.some((answer) => normalize(answer, options) === given);
  }

  /**
   * The answer with the first `revealed` letters shown and the rest as blanks: "b _ _ _".
   * Spaces and hyphens between words are shown from the start: they are not letters to guess.
   */
  function hintMask(answer, revealed) {
    let left = Math.max(0, revealed);
    return [...String(answer)]
      .map((char) => {
        if (/[\s\-'’]/.test(char)) return char === ' ' ? '  ' : char;
        if (left > 0) {
          left -= 1;
          return char;
        }
        return '_';
      })
      .join(' ');
  }

  /** How many letters of an answer a hint can give away. */
  const letterCount = (answer) => [...String(answer)].filter((char) => !/[\s\-'’]/.test(char)).length;

  /**
   * Which letters of the expected answer the typed one got right: the longest run of letters
   * the two have in common, in order. Letters of the expected answer outside it are the ones
   * that were wrong or missing.
   * @returns {{ char: string, ok: boolean }[]}  The expected answer, letter by letter.
   */
  function diff(typed, expected, options) {
    const want = [...String(expected)];
    const got = [...normalize(typed, options)];
    const wantKeys = want.map((char) => normalize(char, options) || char);
    // longest common subsequence, by the classic table
    const rows = wantKeys.length + 1;
    const cols = got.length + 1;
    const table = Array.from({ length: rows }, () => new Uint16Array(cols));
    for (let i = wantKeys.length - 1; i >= 0; i--) {
      for (let j = got.length - 1; j >= 0; j--) {
        table[i][j] = wantKeys[i] === got[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    const result = [];
    let i = 0;
    let j = 0;
    while (i < wantKeys.length) {
      if (j < got.length && wantKeys[i] === got[j]) {
        result.push({ char: want[i], ok: true });
        i += 1;
        j += 1;
      } else if (j < got.length && table[i][j + 1] >= table[i + 1][j]) {
        j += 1; // a letter that was typed and is not in the answer
      } else {
        result.push({ char: want[i], ok: false });
        i += 1;
      }
    }
    return result;
  }

  WV.quizAnswers = { normalize, isCorrect, hintMask, letterCount, diff };
})(globalThis.WV);
