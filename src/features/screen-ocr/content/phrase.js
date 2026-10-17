'use strict';

// Several words of a scanned area as one phrase: which words a drag from one word to another
// covers, and how they read as text.
//
// The words of a scan are numbered in reading order (pipeline.js: lines top to bottom, within a
// line in the order the engine read them, which for right-to-left scripts is right to left).
// A range is therefore every word between the two ids, whichever way the pointer moved.
//
// DECISION: a range stays within the block it was started in. Two blocks are often two columns,
// or a caption and some text elsewhere in the frame; "the words in between" in reading order
// would then be words the user never pointed at. A drag that goes beyond the block ends at its
// edge, and the caller tells the user so (`clamped`).

(function (WV) {
  if (WV.ocrPhrase) return;

  /** Scripts written without spaces between words. */
  const NO_SPACE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}　-〿＀-￯]/u;
  /** A hyphen at the end of a line, of the kinds that split a word: "-", soft hyphen, "‐". */
  const LINE_END_HYPHEN = /[-­‐]$/u;

  /**
   * The words from one to the other, in reading order, within the first one's block.
   * @param {{ id: number, blockId: number }[]} words  All words of the scan.
   * @param {number} startId  Where the drag began (its block is kept).
   * @param {number} endId    Where it is now.
   * @returns {{ ids: number[], clamped: boolean }}
   */
  function range(words, startId, endId) {
    const start = words.find((word) => word.id === startId);
    const end = words.find((word) => word.id === endId);
    if (!start) return { ids: [], clamped: false };
    if (!end) return { ids: [start.id], clamped: false };
    const block = words.filter((word) => word.blockId === start.blockId).map((word) => word.id).sort((a, b) => a - b);
    const low = Math.min(start.id, end.id);
    const high = Math.max(start.id, end.id);
    const ids = block.filter((id) => id >= low && id <= high);
    return { ids, clamped: end.blockId !== start.blockId };
  }

  /**
   * Words joined as they read: with spaces, or without where the script has none. A word broken
   * by a hyphen at the end of a line is put back together when the next line goes on with a small
   * letter ("exam-" + "ple"); otherwise the hyphen stays and nothing is guessed.
   *
   * @param {{ id: number, text: string, lineId: number }[]} words  All words of the scan.
   * @param {number[]} ids  The words of the phrase.
   * @returns {string}
   */
  function join(words, ids) {
    const chosen = ids.map((id) => words.find((word) => word.id === id)).filter(Boolean).sort((a, b) => a.id - b.id);
    let text = '';
    let previous = null;
    for (const word of chosen) {
      const piece = String(word.text || '');
      if (!piece) continue;
      if (previous) {
        const newLine = word.lineId !== previous.lineId;
        const last = text.slice(-1);
        if (newLine && LINE_END_HYPHEN.test(text) && /^\p{Ll}/u.test(piece) && /\p{L}{2}[-­‐]$/u.test(text)) {
          text = text.slice(0, -1); // the word goes on in the next line
        } else if (!(NO_SPACE.test(last) && NO_SPACE.test(piece[0]))) {
          text += ' ';
        }
      }
      text += piece;
      previous = word;
    }
    return text;
  }

  WV.ocrPhrase = { range, join };
})(globalThis.WV);
