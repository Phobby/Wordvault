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
 * @property {string} whereKey                       _locales message key of a sentence saying where the document ends up.
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
 * @property {(session: SyncSession) => Promise<{ used: number, total: number }>} [usage]
 *   How much of the room there is has been used, for providers where room is scarce.
 * @property {(input?: object) => string[]} [origins]
 *   The addresses (match patterns) the extension has to be allowed to talk to for this
 *   provider. The settings page asks the browser for them when the user connects, and only
 *   then. Throws a WordvaultError if the address the user entered cannot be used.
 * @property {{ key: string, type: 'url' | 'text' | 'password', labelKey: string, placeholder?: string }[]} [fields]
 *   What the user has to enter to connect (servers), rendered by the settings page.
 * @property {string} [helpKey]   _locales message key of a line explaining those fields.
 * @property {(connection: object) => string} [location]
 *   The address the document is kept at, for the status line (servers).
 *
 * Error codes providers use (lib/errors.js): network, timeout (try again later); sync_auth (access
 * was withdrawn or expired for good: the user has to connect again); sync_quota (no room left);
 * sync_conflict (see write); sync_config (the provider is not set up); sync_provider (anything else).
 */

import { browser } from './browser.js';
import { dropbox } from './dropbox.js';
import { gdrive } from './gdrive.js';
import { http } from './http.js';
import { onedrive } from './onedrive.js';
import { webdav } from './webdav.js';

/** @type {Map<string, SyncProvider>} */
const providers = new Map([browser, gdrive, onedrive, dropbox, webdav, http].map((provider) => [provider.id, provider]));

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
