// Past tests on several devices: the lists are joined, a test deleted anywhere stays deleted,
// and the newest HISTORY_ITEMS are kept. Tests never change once made, so there is nothing to
// decide between two versions of one; the order of joining does not matter. Pure.
//
//   { t: [<test>, ...], d: { "<id>": <deleted at (ms)>, ... } }   (the `x` section of the
//   synchronised document; sync/model.js)

import { EXAM } from './config.js';

/** Deletions older than this are forgotten (as removed words are: sync/model.js TOMBSTONE_TTL_MS). */
export const EXAM_TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Newest first; equal times by id, so that every device keeps the same ones. */
const newestFirst = (a, b) => (b.createdAt || 0) - (a.createdAt || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A section as it is used: tests with an id, deletion times that are times. */
export function normalizeExams(raw) {
  if (!isObject(raw)) return null;
  const tests = (Array.isArray(raw.t) ? raw.t : []).filter((test) => isObject(test) && typeof test.id === 'string' && test.id && Array.isArray(test.questions));
  const deleted = Object.fromEntries(Object.entries(isObject(raw.d) ? raw.d : {}).filter(([id, time]) => id && Number.isFinite(time) && time > 0));
  return { t: tests, d: deleted };
}

/** Two sections as one. */
export function mergeExams(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const deleted = { ...a.d };
  for (const [id, time] of Object.entries(b.d)) deleted[id] = Math.max(deleted[id] || 0, time);
  const byId = new Map();
  for (const test of [...a.t, ...b.t]) if (!(test.id in deleted) && !byId.has(test.id)) byId.set(test.id, test);
  return { t: [...byId.values()].sort(newestFirst).slice(0, EXAM.HISTORY_ITEMS), d: Object.fromEntries(Object.entries(deleted).sort(([x], [y]) => (x < y ? -1 : 1))) };
}

/** Forgets deletions that have done their job. */
export function purgeExams(section, now = Date.now()) {
  if (!section) return section;
  return { t: section.t, d: Object.fromEntries(Object.entries(section.d).filter(([, time]) => time > now - EXAM_TOMBSTONE_TTL_MS)) };
}

/** Whether a section carries anything (an empty one is left out of the document). */
export const hasExams = (section) => Boolean(section) && (section.t.length > 0 || Object.keys(section.d).length > 0);
