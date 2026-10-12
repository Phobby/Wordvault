// Synchronisation provider registry.
//
// A provider is a place the synchronised document can be kept: the browser's sync storage, a
// cloud account, the user's own server. To add one, create a module in this folder that exports
// an object implementing SyncProvider and register it below. Nothing else knows about concrete
// providers: sync/engine.js only talks to this interface (as lib/translator.js does with the
// translation providers in providers/).

/**
 * @typedef {Object} SyncSession
 * What a provider gets on every call.
 * @property {object} connection   What connect() returned, as stored on this device.
 * @property {(patch: object) => Promise<void>} update
 *   Stores changes to the connection (a refreshed token) so that they survive.
 *
 * @typedef {Object} RemoteCopy
 * @property {Uint8Array} data     The stored bytes (sync/codec.js knows what they mean).
 * @property {string} version      Whatever tells this state of the remote copy from the next one:
 *                                 an ETag, a revision, a counter. Passed back to write().
 * @property {{ id: string, data: Uint8Array }[]} [others]
 *   Further Wordvault files found next to the main one (two devices created one each at the
 *   same moment). The engine merges them in and has them removed once the merge is stored.
 *
 * @typedef {Object} SyncProvider
 * @property {string} id
 * @property {'browser' | 'cloud' | 'server'} kind   Which of the settings page's choices it belongs to.
 * @property {string} nameKey                        _locales message key of its name.
 * @property {(input?: object) => Promise<object>} connect
 *   Asks the user for access where needed and returns the connection to store. Rejects with a
 *   WordvaultError; nothing is stored then.
 * @property {(session: SyncSession, options: { deleteRemote: boolean }) => Promise<void>} disconnect
 *   Gives access back; with `deleteRemote` the stored document is removed first.
 * @property {(session: SyncSession) => Promise<RemoteCopy | null>} read
 *   The remote copy, or null if there is none yet.
 * @property {(session: SyncSession, data: Uint8Array, expectedVersion: string | null) => Promise<{ version: string }>} write
 *   Stores the document, but only if the remote copy is still at `expectedVersion` (null: only
 *   if there is none). Otherwise rejects with WordvaultError('sync_conflict') and stores nothing.
 * @property {(session: SyncSession, ids: string[]) => Promise<void>} [removeOthers]
 *   Removes the extra files read() reported.
 * @property {(session: SyncSession) => Promise<{ name?: string, email?: string } | null>} accountInfo
 *   Who the connected account belongs to, where that can be told without further permissions.
 *
 * Error codes providers use (lib/errors.js): network, timeout (try again later); sync_auth (access
 * was withdrawn or expired for good: the user has to connect again); sync_quota (no room left);
 * sync_conflict (see write); sync_config (the provider is not set up); sync_provider (anything else).
 */

/** @type {Map<string, SyncProvider>} */
const providers = new Map();

/** Adds a provider (the built-in ones below, and the in-memory one the tests use). */
export function registerSyncProvider(provider) {
  providers.set(provider.id, provider);
  return provider;
}

/** @returns {SyncProvider | null} */
export function getSyncProvider(id) {
  return providers.get(id) || null;
}

/** @returns {SyncProvider[]} */
export function listSyncProviders() {
  return [...providers.values()];
}
