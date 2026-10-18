// "Summarise this page": how much of a page is sent, and in how many parts.
//
// A page that fits into one request is summarised in one. A longer one is cut into parts
// that end where paragraphs (or, within a very long one, sentences) end; each part is
// summarised by itself and the summaries are then made into one ("map-reduce"). Before
// anything is sent the user is shown these numbers and has to say yes
// (features/summary/content/card.js).

import { splitPassage, tidyPassage } from '../lib/passage.js';

/**
 * ASSUMPTION: the most that is summarised of one page. More than this is not sent: a longer
 * page is cut off here, and the user is told so before they agree. (About 20,000 words.)
 */
export const SUMMARY_MAX_CHARS = 120_000;
/** However small a provider's parts are, a page is never more requests than this plus one. */
export const SUMMARY_MAX_PARTS = 12;
/**
 * ASSUMPTION: characters per part where the provider does not say (providers/*.js:
 * `partChars`). Roughly 6,000 tokens: every current hosted model reads that at once, and a
 * failure half way costs little.
 */
export const DEFAULT_PART_CHARS = 24_000;
/** A part's summary is cut to this before the summaries are joined, whatever the model wrote. */
export const PART_SUMMARY_CHARS = 1500;

export const LENGTHS = Object.freeze(['short', 'medium', 'detailed']);
export const DEFAULT_LENGTH = 'medium';

/** @returns {'short' | 'medium' | 'detailed'} */
export const lengthOf = (value) => (LENGTHS.includes(value) ? value : DEFAULT_LENGTH);

/** A page's text as it is sent: tidied like a selected passage (paragraphs stay). */
export const tidyArticle = (value) => tidyPassage(value);

/**
 * Fills parts with whole paragraphs, in order, none longer than `max`. A paragraph that is
 * longer than that by itself is cut where its sentences end (lib/passage.js).
 * @returns {string[]}
 */
function pack(text, max) {
  const parts = [];
  let current = '';
  let glue = ''; // what stood between `current` and the unit that comes next
  const add = (unit, after) => {
    if (current && current.length + glue.length + unit.length <= max) current += glue + unit;
    else {
      if (current) parts.push(current);
      current = unit;
    }
    glue = after;
  };
  const chunks = text.split(/(\n+)/); // [paragraph, breaks, paragraph, ...]
  for (let index = 0; index < chunks.length; index += 2) {
    const paragraph = chunks[index];
    const breaks = chunks[index + 1] || '';
    if (!paragraph) continue;
    if (paragraph.length <= max) add(paragraph, breaks);
    else {
      const pieces = splitPassage(paragraph, { maxChars: max });
      pieces.forEach((piece, position) => add(piece.text, position === pieces.length - 1 ? breaks : piece.glue || ' '));
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Cuts a text into parts of about the same size, none longer than `partChars`.
 * @param {string} text  As tidyArticle() leaves it.
 * @returns {string[]}
 */
export function splitArticle(text, partChars = DEFAULT_PART_CHARS) {
  if (text.length <= partChars) return text ? [text] : [];
  // Even parts rather than full ones and a small rest: a short last part would be summarised
  // as weightily as a long one. Paragraphs rarely end where the even cut would fall, so the
  // size aimed at grows a little until the parts are as few as they can be.
  const fewest = Math.ceil(text.length / partChars);
  let parts = [];
  for (const share of [1.03, 1.1, 1.2, Infinity]) {
    parts = pack(text, Math.min(partChars, Math.ceil((text.length / fewest) * share)));
    if (parts.length <= fewest) break;
  }
  return parts;
}

/**
 * What would be sent for a page, without sending anything.
 * @param {unknown} value  The page's main text.
 * @param {{ partChars?: number } | null} [provider]
 * @returns {{ parts: string[], chars: number, total: number, limit: number, truncated: boolean, requests: number }}
 *          chars: what is sent; total: what the page has; requests: one per part, and one more
 *          to join them if there is more than one part.
 */
export function planSummary(value, provider = null) {
  const text = tidyArticle(value);
  const partChars = Math.max(1000, Number(provider?.partChars) || DEFAULT_PART_CHARS);
  const limit = Math.min(SUMMARY_MAX_CHARS, partChars * SUMMARY_MAX_PARTS);
  let sent = text;
  // cut off after the last paragraph (or sentence) that still fits, not in the middle of a word
  if (text.length > limit) sent = pack(text.slice(0, limit + 1), limit)[0] || text.slice(0, limit);
  const parts = splitArticle(sent, partChars);
  return { parts, chars: sent.length, total: text.length, limit, truncated: sent.length < text.length, requests: parts.length > 1 ? parts.length + 1 : parts.length };
}
