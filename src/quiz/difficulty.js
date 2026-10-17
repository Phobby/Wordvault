// The four levels of difficulty, and the one chosen in the toolbar popup. Each level is one way
// of asking (quiz/question.js). The choice is this device's and is remembered; both the quiz
// started by hand and the quiz that comes by itself ask at that level (quiz/scheduler.js).

const STORAGE_KEY = 'quizDifficulty';

/** In the order the selector goes through them. `theme` names the drawing and the colours. */
export const DIFFICULTIES = Object.freeze([
  Object.freeze({ id: 'easy', mode: 'classic', nameKey: 'diffEasy', modeKey: 'diffEasyMode', theme: 'leaf' }),
  Object.freeze({ id: 'medium', mode: 'writing', nameKey: 'diffMedium', modeKey: 'diffMediumMode', theme: 'spark' }),
  Object.freeze({ id: 'hard', mode: 'listening', nameKey: 'diffHard', modeKey: 'diffHardMode', theme: 'bolt' }),
  Object.freeze({ id: 'expert', mode: 'expert', nameKey: 'diffExpert', modeKey: 'diffExpertMode', theme: 'crystal' }),
]);

export const DEFAULT_DIFFICULTY = 'easy';

/** The level with this id; the first one for anything else. */
export function difficultyOf(id) {
  return DIFFICULTIES.find((level) => level.id === id) || DIFFICULTIES[0];
}

/** The level a click on the selector goes to: the next one, and from the last back to the first. */
export function nextDifficulty(id) {
  const index = DIFFICULTIES.findIndex((level) => level.id === id);
  return DIFFICULTIES[(Math.max(0, index) + 1) % DIFFICULTIES.length];
}

/** @returns {Promise<typeof DIFFICULTIES[number]>} The level that was chosen last on this device. */
export async function getDifficulty() {
  return difficultyOf((await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]);
}

/** Remembers the level. @returns the level that is now stored. */
export async function setDifficulty(id) {
  const level = difficultyOf(id);
  await chrome.storage.local.set({ [STORAGE_KEY]: level.id });
  return level;
}
