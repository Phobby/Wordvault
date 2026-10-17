// Which words of the vault a test is made of: grouped by language (one language per test),
// only words that are not learned and not phrases, the hardest and the recently missed ones
// first, the rest drawn at random. And what of them may leave the device: the word and the
// user's translation, cleaned and cut short.

import { EXAM, FILL_BLANK, QUESTION_TYPES, TRUE_FALSE } from './config.js';
import { normalizeLang, primarySubtag } from '../lib/languages.js';
import { isPhrase } from '../lib/vault.js';

/** A detector the browser offers (chrome.i18n.detectLanguage) needs this much text to be of use. */
const MIN_DETECTION_SAMPLE = 20;

/** Characters that are not text: control characters, line breaks and the marks that turn writing direction. */
const NOT_TEXT = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/**
 * The language a test is grouped by: the primary subtag ("en-US" and "en-GB" are one test),
 * except Chinese, where the region tells the script (zh-CN simplified, zh-TW traditional).
 */
export function testLanguage(code) {
  const full = normalizeLang(code);
  return primarySubtag(full) === 'zh' ? full : primarySubtag(full);
}

/** A piece of user data as it may go into a prompt: one line, no control characters, at most `max` characters. */
export function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return [...value.normalize('NFC').replace(NOT_TEXT, ' ').replace(/\s+/g, ' ').trim()].slice(0, max).join('').trim();
}

/** Whether a word can be asked in a test: a word (not a phrase) that is not learned yet, with text. */
export function askable(entry) {
  return Boolean(entry?.text) && !isPhrase(entry) && !(entry.quiz?.g > 0);
}

/**
 * The language of an entry: the one it was saved with, or, where none was known, what the
 * browser's own detector makes of the sentence it was found in. That guess stays here: the
 * entry is not changed (its language is part of its identity, lib/vault.js: entryId).
 * @param {(text: string) => Promise<string>} detect  Language code, or '' when unsure.
 */
export async function languageOf(entry, detect) {
  const known = testLanguage(entry.sourceLang || '');
  if (known) return { language: known, guessed: false };
  const sample = [entry.sentence, entry.text].find((text) => typeof text === 'string' && text.length >= MIN_DETECTION_SAMPLE) || '';
  const guess = sample ? testLanguage(await Promise.resolve(detect(sample)).catch(() => '')) : '';
  return { language: guess, guessed: Boolean(guess) };
}

/**
 * The askable words by language.
 * @returns {Promise<{ groups: { language: string, count: number, guessed: number }[], unknown: number, byLanguage: Map<string, object[]> }>}
 *          groups: most words first; unknown: askable words whose language could not be told.
 */
export async function groupByLanguage(entries, detect) {
  const byLanguage = new Map();
  let unknown = 0;
  const guessedIn = new Map();
  for (const entry of entries.filter(askable)) {
    const { language, guessed } = await languageOf(entry, detect);
    if (!language) {
      unknown += 1;
      continue;
    }
    if (!byLanguage.has(language)) byLanguage.set(language, []);
    byLanguage.get(language).push(entry);
    if (guessed) guessedIn.set(language, (guessedIn.get(language) || 0) + 1);
  }
  const groups = [...byLanguage.entries()]
    .map(([language, list]) => ({ language, count: list.length, guessed: guessedIn.get(language) || 0 }))
    .sort((a, b) => b.count - a.count || a.language.localeCompare(b.language));
  return { groups, unknown, byLanguage };
}

/** The languages a test can be made in: those with enough words. When there is one, the wizard skips the question. */
export const usableGroups = (groups, min = EXAM.MIN_WORDS) => groups.filter((group) => group.count >= min);

/**
 * How much a word needs practice, from the scheduler's summary (quiz/learning.js): a recent
 * wrong answer weighs most, then difficulty, then the number of lapses. 0 for a word never asked.
 */
export function priorityOf(entry, now = Date.now()) {
  const stats = entry.quiz;
  if (!stats || !stats.a) return 0;
  // The run of right answers is broken and there are lapses: the last answer was wrong.
  const lastWrong = (stats.l || 0) > 0 && (stats.s || 0) === 0;
  const recent = lastWrong && stats.x > 0 && now - stats.x <= EXAM.RECENT_MS;
  return (lastWrong ? 2 : 0) + (recent ? 1 : 0) + (stats.d || 0) + Math.min(stats.l || 0, 5) * 0.1;
}

/**
 * The words of one test: up to `count` (and MAX_WORDS) words of `language`, the half that
 * needs practice most first, the rest at random.
 * @param {object[]} entries  Askable entries of one language.
 * @param {() => number} [random]
 */
export function selectWords(entries, count, { random = Math.random, now = Date.now() } = {}) {
  const limit = Math.max(0, Math.min(count, EXAM.MAX_WORDS, entries.length));
  const ranked = entries.map((entry) => ({ entry, score: priorityOf(entry, now) })).sort((a, b) => b.score - a.score);
  const first = ranked.filter(({ score }) => score > 0).slice(0, Math.ceil(limit * EXAM.PRIORITY_SHARE)).map(({ entry }) => entry);
  const rest = ranked.map(({ entry }) => entry).filter((entry) => !first.includes(entry));
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...first, ...rest].slice(0, limit);
}

/**
 * Which question each word gets: with both kinds, the kinds take turns; when there are fewer
 * words than questions, a word comes back in the other kind, never twice in the same one.
 * @param {object[]} words   Selected entries.
 * @param {string[]} types   Kinds asked for (QUESTION_TYPES).
 * @param {number} count     Questions asked for.
 * @returns {{ alias: string, entryId: string, type: string }[]}  alias: how the word is named in the prompt (w1, w2, ...).
 */
export function buildPlan(words, types, count) {
  const kinds = QUESTION_TYPES.filter((type) => types.includes(type));
  if (kinds.length === 0 || words.length === 0) return [];
  const total = Math.min(count, words.length * kinds.length);
  const plan = [];
  const taken = new Set();
  // First round: every word once, the kinds alternating. Second round: the other kind.
  for (let round = 0; round < kinds.length && plan.length < total; round += 1) {
    words.forEach((entry, index) => {
      if (plan.length >= total) return;
      const type = kinds[(index + round) % kinds.length];
      const key = `${index}|${type}`;
      if (taken.has(key)) return;
      taken.add(key);
      plan.push({ alias: `w${index + 1}`, entryId: entry.id, type });
    });
  }
  return plan;
}

/** What is said about each word to the provider: the alias, the word, the user's translation. */
export function wordData(words) {
  return words.map((entry, index) => ({ id: `w${index + 1}`, word: cleanText(entry.text, EXAM.WORD_CHARS), meaning: cleanText(entry.translation, EXAM.TRANSLATION_CHARS) }));
}

export { FILL_BLANK, TRUE_FALSE };
