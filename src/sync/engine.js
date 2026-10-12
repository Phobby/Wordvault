// The synchronisation engine: read the remote copy, merge it with this device's vault, write the
// result back if it differs, and bring the vault in line with it.
//
// It runs in the background script, which the browser may stop at any moment. Nothing it needs
// is kept in memory: configuration and status live in chrome.storage.local, wake-up calls are
// chrome.alarms, and a run that is cut short simply happens again. Merging is commutative,
// associative and idempotent (merge.js), so repeating or interleaving runs can never lose a word.
//
// No error touches the vault: the vault is only written at the very end, from a document that
// already contains everything the vault holds.

import { WordvaultError, serializeError } from '../lib/errors.js';
import { decodeDocument, encodeDocument, fingerprint } from './codec.js';
import { applyDocument, readLocalDocument } from './local.js';
import { mergeDocuments, purgeTombstones, serializeDocument } from './merge.js';
import { getSyncProvider } from './providers/index.js';
import { getSyncConfig, getSyncStatus, saveSyncStatus, updateConnection } from './state.js';

export const SYNC = Object.freeze({
  /** How often a write that lost a race is tried again within one run. */
  MAX_ATTEMPTS: 5,
  /** The wait before the second attempt; it doubles with each further one. */
  BACKOFF_MS: 500,
  /** The vault is synchronised this often even if nothing changed here (to fetch what changed elsewhere). */
  PERIOD_MINUTES: 15,
  /** After a change to the vault, this much quiet is waited for before synchronising. */
  DEBOUNCE_MS: 10_000,
  /** A run that could not reach the provider is repeated after this long, doubling up to the period. */
  RETRY_MINUTES: 1,
});

/** The periodic wake-up, and the one-off one after a change or a failed run. */
export const SYNC_ALARM = 'wv:sync';
export const SYNC_SOON_ALARM = 'wv:sync:soon';

/** Errors that mean "not now": the run is repeated quietly. */
const TRANSIENT = new Set(['network', 'timeout', 'sync_conflict', 'sync_incomplete', 'offline']);
/** Errors after which trying again by itself is pointless; only the user can change something. */
const STANDING = new Set(['sync_auth', 'sync_quota', 'sync_config', 'sync_bad_document', 'sync_newer_schema', 'sync_password', 'sync_unknown_provider']);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

function sessionFor(config) {
  return { connection: config.connection || {}, update: (patch) => updateConnection(config.providerId, patch) };
}

/**
 * One exchange with the provider: read, merge, write if needed, apply.
 * Rejects with 'sync_conflict' if the remote copy changed between reading and writing.
 */
async function exchange(provider, session) {
  const remote = await provider.read(session);
  // Whatever cannot be read as a Wordvault document stops the run here, before anything is
  // written: a damaged or foreign file is never overwritten with this device's vault.
  const main = remote ? await decodeDocument(remote.data) : null;
  const others = [];
  for (const other of remote?.others || []) others.push(await decodeDocument(other.data));

  const local = await readLocalDocument();
  let merged = local;
  for (const document of [main, ...others]) {
    if (document) merged = mergeDocuments(merged, document);
  }
  // Removals that have been known everywhere for long enough are dropped for good.
  merged = purgeTombstones(merged);

  const text = serializeDocument(merged);
  const mustWrite = !main || others.length > 0 || serializeDocument(main) !== text;
  if (mustWrite) await provider.write(session, await encodeDocument(merged), remote ? remote.version : null);
  // Extra files (two devices created one each) go only now that the merged one is stored.
  if (others.length > 0 && provider.removeOthers) await provider.removeOthers(session, remote.others.map((other) => other.id));

  const changes = await applyDocument(merged);
  return { changes, uploaded: mustWrite, hash: await fingerprint(text) };
}

async function run({ reason, sleep }) {
  const config = await getSyncConfig();
  if (config.mode === 'off' || !config.providerId) return getSyncStatus();
  const before = await getSyncStatus();
  const now = Date.now();
  // A run started by a change to the vault has nothing to do if the vault is as it was last
  // synchronised (the change was this engine applying what it had just fetched).
  if (reason === 'change' && before.syncedHash && before.syncedHash === (await fingerprint(serializeDocument(await readLocalDocument())))) {
    return before.pending && before.state === 'idle' ? saveSyncStatus({ pending: false }) : before;
  }
  // What only the user can fix is not tried over and over behind their back.
  if (reason !== 'manual' && before.state === 'error' && STANDING.has(before.error?.code)) return before;

  await saveSyncStatus({ state: 'syncing', lastAttemptAt: now });
  try {
    const provider = getSyncProvider(config.providerId);
    if (!provider) throw new WordvaultError('sync_unknown_provider', config.providerId);
    // Offline: the change stays queued (pending) and goes out with the next run.
    if (offline()) throw new WordvaultError('offline');
    const session = sessionFor(config);
    let result;
    for (let attempt = 1; ; attempt++) {
      try {
        result = await exchange(provider, session);
        break;
      } catch (error) {
        // Someone else wrote in between: read again, merge again, write again.
        if (error?.code !== 'sync_conflict' || attempt >= SYNC.MAX_ATTEMPTS) throw error;
        await sleep(SYNC.BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
    const usage = provider.usage ? await provider.usage(session).catch(() => null) : null;
    return await saveSyncStatus({ state: 'idle', lastSyncAt: Date.now(), error: null, syncedHash: result.hash, pending: false, failures: 0, lastChanges: result.changes, usage });
  } catch (error) {
    const { code, detail } = serializeError(error);
    return saveSyncStatus({
      state: TRANSIENT.has(code) ? 'waiting' : 'error',
      error: { code, detail, at: Date.now() },
      pending: true,
      failures: before.failures + 1,
    });
  }
}

// One synchronisation at a time. A request that comes in while one is running is not lost: the
// running one is followed by another. (Only the order is kept in memory; a stopped background
// script has no run in progress and nothing to remember.)
let running = null;
let again = false;

/**
 * Synchronises now.
 * @param {Object} [options]
 * @param {'manual' | 'change' | 'startup' | 'periodic' | 'retry'} [options.reason]
 * @param {(ms: number) => Promise<void>} [options.sleep]  Tests pass their own.
 * @returns {Promise<import('./state.js').SyncStatus>} The status afterwards. Never rejects.
 */
export function syncNow({ reason = 'manual', sleep = wait } = {}) {
  if (running) {
    again = true;
    return running;
  }
  running = run({ reason, sleep })
    .catch(async (error) => saveSyncStatus({ state: 'error', error: { ...serializeError(error), at: Date.now() }, pending: true }))
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        syncNow({ reason: 'change', sleep }).then(planRetry, () => {});
      }
    });
  return running;
}

// --- When it runs --------------------------------------------------------------------------------

/**
 * Makes the alarms match the configuration: a periodic one while synchronisation is on, none
 * while it is off. Safe to call at every start of the background script.
 */
export async function ensureSyncScheduled() {
  const config = await getSyncConfig();
  if (config.mode === 'off') {
    await chrome.alarms.clear(SYNC_ALARM);
    await chrome.alarms.clear(SYNC_SOON_ALARM);
    return;
  }
  const existing = await chrome.alarms.get(SYNC_ALARM);
  if (!existing || existing.periodInMinutes !== SYNC.PERIOD_MINUTES) await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC.PERIOD_MINUTES });
}

/** After a run that did not get through: try again soon, and less eagerly each time. */
async function planRetry(status) {
  if (status?.state !== 'waiting') return;
  const minutes = Math.min(SYNC.PERIOD_MINUTES, SYNC.RETRY_MINUTES * 2 ** Math.max(0, status.failures - 1));
  await chrome.alarms.create(SYNC_SOON_ALARM, { delayInMinutes: minutes });
}

/** Runs a synchronisation the timer or a change asked for, and plans the retry if it failed. */
export async function syncInBackground(reason) {
  if ((await getSyncConfig()).mode === 'off') return null;
  const status = await syncNow({ reason });
  await planRetry(status);
  return status;
}

let debounce = 0;

/**
 * The vault changed: synchronise once it has been quiet for a moment, so that a burst of
 * changes goes out as one write. The timer does the waiting while the background script is
 * awake; the alarm is there for the case that the script is stopped before the timer fires
 * (browsers do not fire alarms sooner than about half a minute after they are set).
 */
export async function vaultChanged() {
  if ((await getSyncConfig()).mode === 'off') return;
  await saveSyncStatus({ pending: true });
  await chrome.alarms.create(SYNC_SOON_ALARM, { when: Date.now() + SYNC.DEBOUNCE_MS });
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    chrome.alarms.clear(SYNC_SOON_ALARM).catch(() => {});
    syncInBackground('change').catch(() => {});
  }, SYNC.DEBOUNCE_MS);
}

/** @returns {Promise<boolean>} Whether the alarm was one of the engine's. */
export async function onSyncAlarm(name) {
  if (name !== SYNC_ALARM && name !== SYNC_SOON_ALARM) return false;
  clearTimeout(debounce);
  const status = await getSyncStatus();
  await syncInBackground(name === SYNC_ALARM ? 'periodic' : status.state === 'waiting' ? 'retry' : 'change');
  return true;
}
