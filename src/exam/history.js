// "Past tests": the last few tests (chrome.storage.local, under a key of their own). They travel
// in the backup file and with synchronisation (exam/merge.js), except browser sync, whose room
// is kept for the words. A deleted test leaves a deletion time behind, so that it does not come
// back from another device.

import { EXAM, LEVELS, QUESTION_TYPES } from './config.js';
import { mergeExams, normalizeExams, purgeExams } from './merge.js';

export const HISTORY_KEY = 'examHistory';
export const DELETED_KEY = 'examDeleted';

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

export async function removeExam(id, now = Date.now()) {
  const all = await readAll();
  const { [DELETED_KEY]: deleted } = await chrome.storage.local.get(DELETED_KEY);
  await chrome.storage.local.set({ [HISTORY_KEY]: all.filter((item) => item.id !== id), [DELETED_KEY]: { ...(deleted && typeof deleted === 'object' ? deleted : {}), [id]: now } });
  return all.length - 1;
}

/** The tests of this device and its deletions, as the section that travels (exam/merge.js). */
export async function readExamSection() {
  const { [DELETED_KEY]: deleted } = await chrome.storage.local.get(DELETED_KEY);
  return normalizeExams({ t: await readAll(), d: deleted });
}

/**
 * Brings this device's tests in line with a section that came from elsewhere (merged with what is
 * here first, so that nothing of this device's is lost).
 * @returns {Promise<boolean>} Whether anything changed.
 */
export async function applyExamSection(section, now = Date.now()) {
  const local = await readExamSection();
  const merged = purgeExams(mergeExams(local, normalizeExams(section)), now);
  const tests = merged.t.map(readExam).filter(Boolean);
  const sorted = (deleted) => JSON.stringify(Object.entries(deleted).sort(([a], [b]) => (a < b ? -1 : 1)));
  const same = JSON.stringify(tests.map((test) => test.id)) === JSON.stringify(local.t.map((test) => test.id)) && sorted(merged.d) === sorted(local.d);
  if (same) return false;
  await chrome.storage.local.set({ [HISTORY_KEY]: tests, [DELETED_KEY]: merged.d });
  return true;
}
