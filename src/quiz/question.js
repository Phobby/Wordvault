// Builds a multiple-choice question from the vault: one saved word, its translation, and three
// translations of other saved words as wrong choices.

import { sameLanguage } from '../lib/languages.js';

export const CHOICE_COUNT = 4;

/** Form in which two answers count as the same choice. */
const fold = (value) => value.trim().toLocaleLowerCase();

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

/**
 * @typedef {Object} Question
 * @property {string} id          Vault id of the word being asked.
 * @property {string} word
 * @property {string} sourceLang
 * @property {string} targetLang
 * @property {string[]} choices   CHOICE_COUNT different answers, in random order.
 * @property {number} answer      Index of the right one.
 */

/**
 * The wrong choices for a card: translations of other words, none of which could also pass as
 * a right answer (the card's own translation or its other meanings) and no two alike.
 * @returns {string[] | null} null if the vault does not hold enough different meanings.
 */
function pickDistractors(card, cards, random) {
  const taken = new Set([card.translation, ...(card.alternatives || [])].map(fold));
  const distractors = [];
  for (const other of shuffle(cards, random)) {
    // The same word saved in another language pair would give the answer away.
    if (other.id === card.id || fold(other.text) === fold(card.text)) continue;
    const key = fold(other.translation);
    if (taken.has(key)) continue;
    taken.add(key);
    distractors.push(other.translation);
    if (distractors.length === CHOICE_COUNT - 1) return distractors;
  }
  return null;
}

/**
 * @param {import('../lib/vault.js').VaultEntry[]} entries  The whole vault.
 * @param {string} targetLang   Language the answers are in.
 * @param {() => number} [random]
 * @returns {{ ok: true, question: Question } | { ok: false, reason: 'no_cards' | 'not_enough_choices' }}
 */
export function buildQuestion(entries, targetLang, random = Math.random) {
  const cards = askableCards(entries, targetLang);
  if (cards.length === 0) return { ok: false, reason: 'no_cards' };
  // Any card may be asked for now; which one is due is decided by the scheduler (stage 2).
  for (const card of shuffle(cards, random)) {
    const distractors = pickDistractors(card, cards, random);
    if (!distractors) continue;
    const choices = shuffle([card.translation, ...distractors], random);
    return {
      ok: true,
      question: { id: card.id, word: card.text, sourceLang: card.sourceLang, targetLang: card.targetLang, choices, answer: choices.indexOf(card.translation) },
    };
  }
  return { ok: false, reason: 'not_enough_choices' };
}
