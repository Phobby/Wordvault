// Builds a multiple-choice question from the vault: one saved word, its translation, and three
// translations of other saved words as wrong choices.
//
// The wrong choices are picked to be hard to rule out: the same kind of word and about as long
// as the right answer where the vault allows it, and never something that could also be right.

import { sameLanguage } from '../lib/languages.js';
import { isPhrase } from '../lib/vault.js';

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

/**
 * Words that can be asked: saved with a translation into the language the user learns into.
 * Phrases kept from translated selections are there to be read again and are never asked.
 */
export function askableCards(entries, targetLang) {
  return entries.filter((entry) => entry.translation && !isPhrase(entry) && sameLanguage(entry.targetLang, targetLang));
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

/** Words longer than this are not asked for in writing: a sentence is not something to type from memory. */
const MAX_WRITING_CHARS = 40;

/**
 * A question that has the word typed: the meaning is shown, the saved word is the answer.
 *
 * The vault's main translation is what is shown. Where several saved words have that same
 * translation ("big" and "large" for "büyük"), each of them is accepted: the meaning alone
 * cannot tell them apart.
 * @returns {Question | null} null for a word that is not fit for typing.
 */
export function writingQuestion(card, cards) {
  if (!card.translation || card.text.length > MAX_WRITING_CHARS) return null;
  const same = cards.filter((other) => other.id !== card.id && sameLanguage(other.sourceLang, card.sourceLang) && fold(other.translation) === fold(card.translation)).map((other) => other.text);
  return {
    mode: 'writing',
    id: card.id,
    word: card.translation,
    answer: card.text,
    accept: [card.text, ...same],
    sourceLang: card.sourceLang,
    targetLang: card.targetLang,
    letters: [...card.text].filter((char) => !/[\s\-'’]/.test(char)).length,
    chars: card.translation.length + card.text.length,
  };
}

/**
 * A question that has the word heard and typed: it is said aloud, and neither it nor its
 * meaning is shown. Only the word itself is right: what was said is what is asked for.
 * @returns {Question | null} null for a word without a language to say it in, or too long to type.
 */
export function expertQuestion(card) {
  if (!card.sourceLang || card.text.length > MAX_WRITING_CHARS) return null;
  return {
    mode: 'expert',
    id: card.id,
    word: card.text,
    answer: card.text,
    accept: [card.text],
    meaning: card.translation || '',
    sourceLang: card.sourceLang,
    targetLang: card.targetLang,
    letters: [...card.text].filter((char) => !/[\s\-'’]/.test(char)).length,
    chars: card.text.length * 2,
  };
}

/** Other saved words as wrong choices for "which word did you hear": never one that could be the answer. */
function pickSpellings(card, cards, random) {
  const candidates = [];
  for (const other of shuffle(cards, random)) {
    if (other.id === card.id || !sameLanguage(other.sourceLang, card.sourceLang)) continue;
    if (tooSimilar(other.text, card.text) || fold(other.translation) === fold(card.translation)) continue;
    if (candidates.some((chosen) => fold(chosen.text) === fold(other.text))) continue;
    candidates.push(other);
  }
  if (candidates.length < CHOICE_COUNT - 1) return null;
  const length = fold(card.text).length;
  // about as long as the word that is heard, so that length alone gives nothing away
  return candidates
    .map((other) => ({ other, score: -Math.abs(fold(other.text).length - length) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATE_POOL)
    .map(({ other }) => other.text)
    .slice(0, CHOICE_COUNT - 1);
}

/**
 * A question that has the word heard: it is said aloud and not shown; the choices are four
 * meanings (the default) or four spellings.
 * @param {'meaning' | 'spelling'} [kind]
 * @returns {Question | null} null if the word has no language to say it in, or the vault no choices.
 */
export function listeningQuestion(card, cards, random = Math.random, kind = 'meaning') {
  if (!card.sourceLang) return null;
  const spelling = kind === 'spelling';
  const wrong = spelling ? pickSpellings(card, cards, random) : pickDistractors(card, cards, random);
  if (!wrong) return null;
  const right = spelling ? card.text : card.translation;
  const choices = shuffle([right, ...wrong], random);
  return {
    mode: 'listening',
    id: card.id,
    word: card.text,
    sourceLang: card.sourceLang,
    targetLang: card.targetLang,
    choices,
    answer: choices.indexOf(right),
    choiceKind: spelling ? 'spelling' : 'meaning',
    chars: choices.reduce((sum, choice) => sum + choice.length, 0),
  };
}

/**
 * @typedef {Object} Question
 * @property {'classic' | 'writing' | 'listening' | 'expert'} [mode]  How the word is asked (missing: classic).
 *   classic    `word` is shown, `choices` are four meanings, `answer` the index of the right one;
 *   writing    `word` is the meaning; `answer` is the word to type, `accept` every saved word
 *              that is right, `letters` how many letters a hint can give away;
 *   listening  `word` is said aloud and not shown; `choices` are meanings or spellings (`choiceKind`).
 *   expert     `word` is said aloud and not shown; `answer` is the word to type; `meaning` is
 *              shown once the question is over.
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
    mode: 'classic',
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

/**
 * A question about a card in one of the three ways. When the way that was wanted does not
 * work for this word (too long to type, no language to say it in, too few choices), the
 * others that are switched on are tried, the classic way first.
 *
 * @param {'classic' | 'writing' | 'listening' | 'expert'} mode
 * @param {{ listenChoices?: 'meaning' | 'spelling', allowed?: string[], without?: string[] }} [options]
 *        allowed: the ways that are switched on (others are never fallen back to).
 *        without: ways that must not be used for this word (listening, where it has no voice).
 * @returns {Question | null}
 */
export function questionInMode(card, cards, mode, random = Math.random, { listenChoices = 'meaning', allowed = ['classic', 'writing', 'listening', 'expert'], without = [] } = {}) {
  const build = {
    classic: () => questionFor(card, cards, random),
    writing: () => writingQuestion(card, cards),
    listening: () => listeningQuestion(card, cards, random, listenChoices),
    expert: () => expertQuestion(card),
  };
  const order = [mode, 'classic', 'writing', 'listening', 'expert'].filter((way, index, all) => build[way] && all.indexOf(way) === index && allowed.includes(way) && !without.includes(way));
  for (const way of order) {
    const question = build[way]();
    if (question) return question;
  }
  return null;
}
