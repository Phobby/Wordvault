// What the user sees of their progress, put together for the pages that show it: the streak,
// the rank, and whether a new rank is still to be celebrated.

import { getSettings } from '../lib/settings.js';
import { listEntries } from '../lib/vault.js';
import { addDays, localDay, rankOf, streakOf } from './progress.js';
import { getDays, streakStatus, useFreeze } from './streak.js';

const SEEN_KEY = 'progressSeen';

/**
 * @returns {Promise<{ streak: Object, rank: Object, rankUp: boolean }>}
 *   streak: streak.js: streakStatus, plus `freezeSaves`: the streak a freeze would keep alive.
 *   rankUp: the rank is higher than the last one this device showed.
 */
export async function getProgress(now = Date.now()) {
  const [settings, entries, days] = await Promise.all([getSettings(), listEntries(), getDays()]);
  const streak = await streakStatus(now, settings);
  const rank = rankOf(entries.filter((entry) => Number(entry.quiz?.g) > 0).length);
  const stored = (await chrome.storage.local.get(SEEN_KEY))[SEEN_KEY];
  // The first time this is looked at, the rank that is there is simply the rank: someone who
  // installs the update with 300 learned words has not just been promoted five times.
  if (!stored || !Number.isInteger(stored.rank)) await chrome.storage.local.set({ [SEEN_KEY]: { rank: rank.index } });
  const seen = Number.isInteger(stored?.rank) ? stored.rank : rank.index;
  const freezeSaves = streak.freezeDay ? streakOf(days.days, [...days.frozen, streak.freezeDay], localDay(now)).count : 0;
  return { streak: { ...streak, freezeSaves, yesterday: addDays(localDay(now), -1) }, rank, rankUp: rank.index > seen, quizEnabled: settings.quizEnabled !== false };
}

/** The celebration was shown (or the rank went down again): this rank is the one that was seen. */
export async function ackRank() {
  const { rank } = await getProgress();
  await chrome.storage.local.set({ [SEEN_KEY]: { rank: rank.index } });
  return rank.index;
}

/** "Use the freeze": covers yesterday. */
export async function freezeYesterday(now = Date.now()) {
  return useFreeze(now, await getSettings());
}
