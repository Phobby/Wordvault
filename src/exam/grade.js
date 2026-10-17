// Checking what the user wrote into a test: the answer the sentence needs, or one of the
// spellings the test accepts. A wrong letter is wrong; case, spacing and, when the quiz setting
// "accent tolerant" is on, accents are not. Pure, so that it can be tested.

import { FILL_BLANK, TRUE_FALSE } from './config.js';

/** An answer as it is compared. */
export function normalizeAnswer(text, { lang = '', accentTolerant = false } = {}) {
  let value = String(text ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  try {
    value = value.toLocaleLowerCase(lang || undefined);
  } catch {
    value = value.toLowerCase();
  }
  // Typographic apostrophes count as the plain one.
  value = value.replace(/[’‘`´]/g, "'");
  return accentTolerant ? value.normalize('NFKD').replace(/\p{M}/gu, '').normalize('NFC') : value;
}

/**
 * @param {object} question  A checked question (schema.js).
 * @param {string | boolean | null} given  What was written (fill in the blank) or chosen (true/false; null: nothing).
 * @returns {{ answered: boolean, correct: boolean }}
 */
export function gradeQuestion(question, given, options = {}) {
  if (question.type === TRUE_FALSE) {
    const answered = typeof given === 'boolean';
    return { answered, correct: answered && given === question.isTrue };
  }
  if (question.type !== FILL_BLANK) return { answered: false, correct: false };
  const written = normalizeAnswer(given, options);
  if (!written) return { answered: false, correct: false };
  const accepted = [question.answer, ...(question.acceptable || [])].map((item) => normalizeAnswer(item, options));
  return { answered: true, correct: accepted.includes(written) };
}

/** Score of a whole test: how many are right, out of how many. */
export function score(questions, answers, options = {}) {
  const graded = questions.map((question) => gradeQuestion(question, answers[question.id] ?? null, options));
  return { right: graded.filter(({ correct }) => correct).length, total: questions.length, graded };
}

/**
 * The words of the word box, mixed. The same test always gives the same order (seeded by its id),
 * so that a printed copy and the page agree.
 */
export function wordBox(questions, seed = '') {
  const words = [...new Set(questions.filter((question) => question.type === FILL_BLANK).map((question) => question.lemma || question.word))];
  let state = [...String(seed)].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 2166136261) || 1;
  const random = () => {
    state = (Math.imul(state ^ (state >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return state / 2 ** 32;
  };
  for (let i = words.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]];
  }
  return words;
}

/**
 * How many questions the choices allow: each word once per kind, at most MAX_WORDS words.
 * @param {number} words  Words available in the language.
 */
export function questionLimit(words, kinds, { maxWords, maxQuestions }) {
  return Math.max(0, Math.min(maxQuestions, Math.min(words, maxWords) * kinds));
}
