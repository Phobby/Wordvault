// The quiz that is on screen: one or more questions asked one after the other in the same place.
//
// It is kept in chrome.storage.local, not in memory: the background script may be stopped
// between two questions while the user is still reading the first.

const SESSION_KEY = 'quizSession';
/** A quiz nobody has touched for this long after its question timed out is taken to be gone
 *  (its page was closed without a word, the browser crashed ...). */
const GRACE_MS = 20_000;

/**
 * @typedef {Object} QuizSession
 * @property {string} id
 * @property {boolean} forced          Started by "Test now".
 * @property {number} total            How many questions this quiz is meant to ask.
 * @property {string[]} asked          Ids of the words asked so far, the current one last.
 * @property {import('./question.js').Question | null} question  The question on screen.
 * @property {number} answered         Questions answered (right, wrong or "I don't know").
 * @property {number} right
 * @property {number} skipped          Questions put off with "Ask later".
 * @property {number} timeoutSeconds
 * @property {string} offeredTo        The way of showing it that is being tried right now.
 * @property {string} method           The way it is shown ('' until one has worked).
 * @property {boolean} claimed         The place that shows it has picked it up.
 * @property {number} windowId         The quiz window, if it is shown in one (0 otherwise).
 * @property {number} startedAt
 * @property {number} touchedAt        When something last happened in it.
 */

/** @returns {QuizSession} */
export function newSession({ question, total, forced, timeoutSeconds, now }) {
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    forced: Boolean(forced),
    total,
    asked: [question.id],
    question,
    answered: 0,
    right: 0,
    skipped: 0,
    timeoutSeconds,
    offeredTo: '',
    method: '',
    claimed: false,
    windowId: 0,
    startedAt: now,
    touchedAt: now,
  };
}

/** @returns {Promise<QuizSession | null>} */
export async function readSession() {
  const stored = (await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY];
  return stored && typeof stored === 'object' && typeof stored.id === 'string' ? stored : null;
}

export async function writeSession(session) {
  await chrome.storage.local.set({ [SESSION_KEY]: session });
  return session;
}

/** Changes fields of the stored quiz, provided it is still the one meant. */
export async function updateSession(id, patch) {
  const session = await readSession();
  if (!session || session.id !== id) return null;
  return writeSession({ ...session, ...patch });
}

export async function clearSession() {
  await chrome.storage.local.remove(SESSION_KEY);
}

/**
 * Whether the quiz is (still) in front of the user. One that was never picked up by a page is
 * not, and neither is one whose question should have timed out a while ago.
 */
export function isOnScreen(session, now) {
  if (!session || !session.claimed) return false;
  return now - session.touchedAt < session.timeoutSeconds * 1000 + GRACE_MS;
}

/** What a page needs in order to show the quiz. */
export function viewOf(session) {
  return { sessionId: session.id, question: session.question, index: session.asked.length, total: session.total, timeoutSeconds: session.timeoutSeconds };
}

/** The numbers of the summary shown at the end of a quiz with several questions. */
export function summaryOf(session) {
  return { right: session.right, answered: session.answered, skipped: session.skipped, asked: session.asked.length, total: session.total };
}
