// A selected sentence or paragraph, for the services that translate it: tidied, cut into
// pieces a service takes in one request, and the answers put together again.
//
// Pieces end where sentences end (Intl.Segmenter), so that a service never gets half a
// sentence, unless one sentence alone is longer than the service allows: then it is cut
// between words.

/** More than this is not translated at once. Wordvault is a vocabulary tool, not a page translator. */
export const PASSAGE_MAX_CHARS = 5000;
/**
 * ASSUMPTION: a piece for a service that sets no limit of its own per text (DeepL: only the
 * whole request, 128 KiB). Small enough that a failure half way leaves most of the text done.
 */
export const DEFAULT_PIECE_CHARS = 1500;

/** Languages written without spaces between words: their sentences are joined without one. */
const SPACELESS = new Set(['ja', 'zh', 'th', 'lo', 'km', 'my']);

const encoder = new TextEncoder();
const bytes = (text) => encoder.encode(text).length;

/**
 * Line breaks stay (a paragraph is a paragraph); every other run of white space becomes one
 * space, and more than one empty line becomes one.
 * @param {unknown} value
 * @returns {string}
 */
export function tidyPassage(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?|[\u2028\u2029]/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function segments(text, granularity, locale) {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      return [...new Intl.Segmenter(locale || undefined, { granularity }).segment(text)].map((part) => part.segment);
    } catch {
      // a language tag the browser does not know: the plain rules below
    }
  }
  return granularity === 'sentence' ? text.split(/(?<=[.!?…。！？]\s+)/u) : text.split(/(?<=\s)/u);
}

/**
 * @param {string} text  A passage as tidyPassage() leaves it.
 * @param {Object} [limits]
 * @param {number} [limits.maxChars]  Longest piece in characters (0: no such limit).
 * @param {number} [limits.maxBytes]  Longest piece in UTF-8 bytes (0: no such limit).
 * @param {boolean} [limits.acrossParagraphs]  The service keeps line breaks, so a piece may hold several paragraphs.
 * @param {string} [limits.locale]  Language of the text, if known: sentences are found by its rules.
 * @returns {{ text: string, glue: string }[]}  The pieces in order; `glue` is what stood between
 *          a piece and the next one ('' after the last): ' ', '' or line breaks.
 */
export function splitPassage(text, { maxChars = 0, maxBytes = 0, acrossParagraphs = false, locale = '' } = {}) {
  const fits = (piece) => (!maxChars || piece.length <= maxChars) && (!maxBytes || bytes(piece) <= maxBytes);

  // Units: sentences, or parts of one that is too long by itself, each with what follows it.
  const units = [];
  const push = (body, glue) => {
    if (body) units.push({ text: body, glue });
    else if (units.length > 0 && glue.includes('\n')) units[units.length - 1].glue = glue;
  };
  /** A sentence longer than a piece may be: cut between words, a word longer than that between characters. */
  const cut = (sentence, glue) => {
    let current = '';
    const parts = [];
    for (const word of segments(sentence, 'word', locale)) {
      if (fits((current + word).trim())) {
        current += word;
        continue;
      }
      if (current.trim()) parts.push(current);
      current = '';
      if (fits(word.trim())) {
        current = word;
        continue;
      }
      for (const character of word) {
        if (!fits(current + character)) {
          parts.push(current);
          current = '';
        }
        current += character;
      }
    }
    if (current.trim()) parts.push(current);
    parts.forEach((part, index) => {
      const last = index === parts.length - 1;
      push(part.trim(), last ? glue : /\s$/.test(part) || /^\s/.test(parts[index + 1]) ? ' ' : '');
    });
  };

  const paragraphs = text.split(/(\n+)/); // [paragraph, breaks, paragraph, ...]
  for (let index = 0; index < paragraphs.length; index += 2) {
    const breaks = paragraphs[index + 1] || '';
    const sentences = segments(paragraphs[index], 'sentence', locale).filter((sentence) => sentence.trim());
    sentences.forEach((sentence, position) => {
      const last = position === sentences.length - 1;
      const glue = last ? breaks : /\s$/.test(sentence) ? ' ' : '';
      if (fits(sentence.trim())) push(sentence.trim(), glue);
      else cut(sentence, glue);
    });
  }

  // Pieces: as many units as fit, in order.
  const pieces = [];
  for (const unit of units) {
    const previous = pieces[pieces.length - 1];
    const sameParagraph = previous && !previous.glue.includes('\n');
    if (previous && (sameParagraph || acrossParagraphs) && fits(previous.text + previous.glue + unit.text)) {
      previous.text += previous.glue + unit.text;
      previous.glue = unit.glue;
    } else {
      pieces.push({ ...unit });
    }
  }
  if (pieces.length > 0) pieces[pieces.length - 1].glue = '';
  return pieces;
}

/**
 * @param {string[]} parts  The translations of the first pieces, in order (all of them, or as
 *        many as were made before one failed).
 * @param {{ glue: string }[]} pieces  What splitPassage() returned.
 * @param {string} [targetLang]  Sentences are joined the way this language is written.
 * @returns {string}
 */
export function joinPassage(parts, pieces, targetLang = '') {
  const spaceless = SPACELESS.has(String(targetLang).toLowerCase().split('-')[0]);
  return parts
    .map((part, index) => {
      if (index === parts.length - 1) return part;
      const glue = pieces[index]?.glue ?? ' ';
      return part + (glue.includes('\n') ? glue : spaceless ? '' : ' ');
    })
    .join('');
}

