// "Translate this page with AI": what a request looks like and how its answer is read.
//
// The page sends its visible text in chunks (features/page-translate/content). A chunk is a
// list of items; an item is the text of one text node, or, where a sentence is split by the
// page's formatting (a link or bold words in the middle of it), the texts of those nodes in
// order. The model is asked to answer item by item, and for a split sentence piece by piece.
// Whatever it answers only ever becomes the text of the very nodes that were sent: an answer
// cannot add, remove or move anything on the page, and what does not fit the pattern is dropped
// (that text then simply stays as it was).

import { WordvaultError } from '../lib/errors.js';

/**
 * ASSUMPTION: characters of page text per request where the provider does not say
 * (providers/*.js: `pageChunkChars`). The answer is about as long as the question, and it has
 * to fit into one answer of the model together with the numbering.
 */
export const PAGE_CHUNK_CHARS = 5000;
/** ASSUMPTION: the most that is translated of one page. The rest stays as it is, and the user is told before they agree. */
export const PAGE_MAX_CHARS = 100_000;
/** Items per request: models lose count in long lists. */
export const PAGE_CHUNK_ITEMS = 60;
/** Room for the answer (it also has to cover a model's thinking). */
export const PAGE_ANSWER_TOKENS = 8192;
/** A request that is larger than a chunk can be is not one of ours. */
const HARD_ITEMS = 200;
const HARD_PIECES = 40;

/** Nothing in the text may look like the numbering it is wrapped in. */
const plain = (value) =>
  String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\[\[/g, '[ [')
    .replace(/\]\]/g, '] ]')
    .replace(/<(\/?\d+)>/g, '‹$1›')
    .trim();

/**
 * Checks what a page sent and makes it safe to number.
 * @param {unknown} value
 * @param {number} [maxChars]
 * @returns {(string | string[])[]}
 */
export function tidyItems(value, maxChars = PAGE_CHUNK_CHARS * 3) {
  if (!Array.isArray(value) || value.length === 0) throw new WordvaultError('empty');
  if (value.length > HARD_ITEMS) throw new WordvaultError('ai_request', 'too many items');
  let chars = 0;
  const items = value.map((item) => {
    const pieces = Array.isArray(item) ? item : [item];
    if (pieces.length === 0 || pieces.length > HARD_PIECES || pieces.some((piece) => typeof piece !== 'string')) throw new WordvaultError('ai_request', 'bad item');
    const clean = pieces.map(plain);
    chars += clean.reduce((sum, piece) => sum + piece.length, 0);
    return Array.isArray(item) ? clean : clean[0];
  });
  if (chars > maxChars) throw new WordvaultError('ai_request', 'too much text');
  return items;
}

/** The items as they stand in the prompt: `[[3]] text`, or `[[3]] <1>piece</1><2>piece</2>`. */
export function itemLines(items) {
  return items.map((item, index) => `[[${index + 1}]] ${Array.isArray(item) ? item.map((piece, position) => `<${position + 1}>${piece}</${position + 1}>`).join('') : item}`).join('\n');
}

/**
 * Reads the model's answer.
 * @param {string} answer
 * @param {(string | string[])[]} items  What was sent.
 * @returns {(string | string[] | null)[]}  For each item its translation in the same shape, or
 *          null where the answer has none that can be used.
 */
export function parsePageTranslation(answer, items) {
  const found = new Map();
  const marks = [...String(answer || '').matchAll(/\[\[(\d+)\]\]/g)];
  marks.forEach((mark, position) => {
    const id = Number(mark[1]);
    const end = position + 1 < marks.length ? marks[position + 1].index : answer.length;
    // (the first answer for a number counts: a second one is not what was asked for)
    if (id >= 1 && id <= items.length && !found.has(id)) found.set(id, answer.slice(mark.index + mark[0].length, end).trim());
  });
  return items.map((item, index) => {
    const text = found.get(index + 1);
    if (!text) return null;
    if (!Array.isArray(item)) return text.replace(/<\/?\d+>/g, '').trim() || null;
    const pieces = new Map();
    for (const match of text.matchAll(/<(\d+)>([\s\S]*?)<\/\1>/g)) if (!pieces.has(Number(match[1]))) pieces.set(Number(match[1]), match[2].replace(/<\/?\d+>/g, '').trim());
    const ordered = item.map((_, position) => pieces.get(position + 1));
    // Every piece, or none: half a sentence in one language and half in another is worse than the original.
    return ordered.every((piece) => typeof piece === 'string') && ordered.some((piece) => piece) ? ordered : null;
  });
}
