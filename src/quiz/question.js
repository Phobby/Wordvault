// Builds a multiple-choice question from the vault: one saved word, its translation, and three
// translations of other saved words as wrong choices.
//
// The wrong choices are picked to be hard to rule out: the same kind of word and about as long
// as the right answer where the vault allows it, and never something that could also be right.

import { sameLanguage } from '../lib/languages.js';

export const CHOICE_COUNT = 4;
/** Wrong choices are drawn from this many best-matching candidates, so they vary between
 *  questions about the same word. */
const CANDIDATE_POOL = 7;

/** Form in which two answers are compared: case, accents, punctuation and spacing ignored. */
function fold(value) {
  return String(value || '')
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Edit distance, cut short once it exceeds `limit`. */
function editDistance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, next[j]);
    }
    if (best > limit) return limit + 1;
    row = next;
  }
  return row[b.length];
}

function commonPrefix(a, b) {
  let length = 0;
  while (length < a.length && a[length] === b[length]) length++;
  return length;
}

/**
 * Whether two answers are the same or so close that offering both would be unfair:
 *   - the same word in another form: "kitap" / "kitaplar", "ışık" / "ışığı" (they share all but
 *     at most the last letter of the shorter one, and differ by a short ending);
 *   - one inside the other: "rezervasyon" / "rezervasyon yapın", "run" / "to run";
 *   - a letter or two apart: "kitap" / "kitab".
 * It errs on the side of "similar": a wrongly excluded choice costs nothing, an unfair one does.
 */
export function tooSimilar(a, b) {
  const left = fold(a);
  const right = fold(b);
  if (!left || !right) return true;
  if (left === right) return true;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  if (long.length - short.length <= 3 && commonPrefix(short, long) >= Math.max(3, short.length - 1)) return true;
  if (short.length >= 2 && ` ${long} `.includes(` ${short} `)) return true;
  const limit = short.length >= 8 ? 2 : short.length >= 4 ? 1 : 0;
  return limit > 0 && editDistance(short, long, limit) <= limit;
}

/** Words that can be asked: saved with a translation into the language the user learns into. */
export function askableCards(entries, targetLang) {
  return entries.filter((entry) => entry.translation && sameLanguage(entry.targetLang, targetLang));
}

/** How many different answers the given cards offer. A question needs CHOICE_COUNT of them. */
export function countMeanings(cards) {
  return new Set(cards.map((card) => fold(card.translation))).size;
}

function shuffle(list, random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** The word type Wiktionary lists first for a card ('' if unknown). */
const kindOf = (card) => String(card.dictionary?.groups?.[0]?.partOfSpeech || '').toLowerCase();
const wordCount = (text) => fold(text).split(' ').length;

/** How well another card's translation would pass as an answer to `card`: higher is better. */
function likeness(card, other) {
  const a = fold(card.translation).length;
  const b = fold(other.translation).length;
  let score = 1 - Math.abs(a - b) / Math.max(a, b); // about the same length: 0..1
  if (wordCount(card.translation) === wordCount(other.translation)) score += 0.5; // a word vs a phrase
  if (kindOf(card) && kindOf(card) === kindOf(other)) score += 1.5; // noun for noun, verb for verb
  return score;
}

/**
 * The wrong choices for a card.
 * @returns {string[] | null} null if the vault does not hold enough different meanings.
 */
function pickDistractors(card, cards, random) {
  // Anything that could also be a right answer is out: the card's translation, its other
  // meanings, and anything too close to either.
  const offLimits = [card.translation, ...(card.alternatives || [])];
  const candidates = [];
  for (const other of shuffle(cards, random)) {
    // The same word saved in another language pair would give the answer away.
    if (other.id === card.id || fold(other.text) === fold(card.text)) continue;
    if (offLimits.some((answer) => tooSimilar(answer, other.translation))) continue;
    if (candidates.some((chosen) => tooSimilar(chosen.translation, other.translation))) continue;
    candidates.push(other);
  }
  if (candidates.length < CHOICE_COUNT - 1) return null;
  // The best matches first (ties stay in their shuffled order), then a random three of them.
  const pool = candidates
    .map((other) => ({ other, score: likeness(card, other) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATE_POOL);
  return shuffle(pool, random)
    .slice(0, CHOICE_COUNT - 1)
    .map(({ other }) => other.translation);
}

/**
 * @typedef {Object} Question
 * @property {string} id          Vault id of the word being asked.
 * @property {string} word
 * @property {string} sourceLang
 * @property {string} targetLang
 * @property {string[]} choices   CHOICE_COUNT different answers, in random order.
 * @property {number} answer      Index of the right one.
 * @property {number} chars       Total length of the choices: how much there is to read.
 */

/**
 * A question about one particular card.
 * @param {import('../lib/vault.js').VaultEntry} card
 * @param {import('../lib/vault.js').VaultEntry[]} cards  Every askable card (see askableCards).
 * @param {() => number} [random]
 * @returns {Question | null} null if there are not enough different meanings to choose from.
 */
export function questionFor(card, cards, random = Math.random) {
  const distractors = pickDistractors(card, cards, random);
  if (!distractors) return null;
  const choices = shuffle([card.translation, ...distractors], random);
  return {
    id: card.id,
    word: card.text,
    sourceLang: card.sourceLang,
    targetLang: card.targetLang,
    choices,
    answer: choices.indexOf(card.translation),
    chars: choices.reduce((sum, choice) => sum + choice.length, 0),
  };
}

/**
 * A question about any card: used where it does not matter which word is asked.
 * @param {import('../lib/vault.js').VaultEntry[]} entries  The whole vault.
 * @param {string} targetLang   Language the answers are in.
 * @param {() => number} [random]
 * @returns {{ ok: true, question: Question } | { ok: false, reason: 'no_cards' | 'not_enough_choices' }}
 */
export function buildQuestion(entries, targetLang, random = Math.random) {
  const cards = askableCards(entries, targetLang);
  if (cards.length === 0) return { ok: false, reason: 'no_cards' };
  for (const card of shuffle(cards, random)) {
    const question = questionFor(card, cards, random);
    if (question) return { ok: true, question };
  }
  return { ok: false, reason: 'not_enough_choices' };
}
