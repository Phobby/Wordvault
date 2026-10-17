// "Past tests": the last few tests, kept on this device only (chrome.storage.local, under a key of
// their own). They are not vault entries: neither the backup nor synchronisation reads them.

import { EXAM, LEVELS, QUESTION_TYPES } from './config.js';

export const HISTORY_KEY = 'examHistory';

/**
 * @typedef {Object} StoredExam
 * @property {string} id
 * @property {number} createdAt
 * @property {string} language         The language tested.
 * @property {string} level            CEFR level.
 * @property {string[]} types          Kinds of question asked for.
 * @property {number} requested        Questions planned.
 * @property {'ai' | 'paste'} source   Made by the provider, or pasted from a chat site.
 * @property {string} explanationLang
 * @property {object[]} questions      Checked questions (schema.js: checkQuestion).
 */

/** A stored test as the code uses it, or null if it is not one (a damaged or foreign value). */
function readExam(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !Array.isArray(raw.questions) || raw.questions.length === 0) return null;
  if (!LEVELS.includes(raw.level) || typeof raw.language !== 'string') return null;
  return {
    id: raw.id,
    createdAt: Number(raw.createdAt) || 0,
    language: raw.language,
    level: raw.level,
    types: (Array.isArray(raw.types) ? raw.types : []).filter((type) => QUESTION_TYPES.includes(type)),
    requested: Number(raw.requested) || raw.questions.length,
    source: raw.source === 'paste' ? 'paste' : 'ai',
    explanationLang: typeof raw.explanationLang === 'string' ? raw.explanationLang : '',
    questions: raw.questions.filter((question) => question && typeof question === 'object' && QUESTION_TYPES.includes(question.type) && typeof question.text === 'string'),
  };
}

async function readAll() {
  const stored = (await chrome.storage.local.get(HISTORY_KEY))[HISTORY_KEY];
  return (Array.isArray(stored) ? stored : []).map(readExam).filter(Boolean);
}

/** Keeps a test, newest first; the oldest beyond HISTORY_ITEMS go. @returns {Promise<StoredExam>} */
export async function saveExam(exam, now = Date.now()) {
  const stored = readExam({ ...exam, id: exam.id || `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, createdAt: exam.createdAt || now });
  if (!stored) throw new Error('not a test');
  const all = [stored, ...(await readAll()).filter((item) => item.id !== stored.id)].slice(0, EXAM.HISTORY_ITEMS);
  await chrome.storage.local.set({ [HISTORY_KEY]: all });
  return stored;
}

/** The kept tests, newest first, without their questions. */
export async function listExams() {
  return (await readAll()).map(({ questions, ...summary }) => ({ ...summary, count: questions.length }));
}

/** @returns {Promise<StoredExam | null>} */
export async function getExam(id) {
  return (await readAll()).find((item) => item.id === id) || null;
}

export async function removeExam(id) {
  const all = await readAll();
  await chrome.storage.local.set({ [HISTORY_KEY]: all.filter((item) => item.id !== id) });
  return all.length - 1;
}
