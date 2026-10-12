// What synchronisation is set to do, and how it is going. Both live in chrome.storage.local and
// nowhere else: the configuration holds sign-in tokens and server passwords, which must never
// travel to the cloud or to browser sync.

const CONFIG_KEY = 'syncConfig';
const STATUS_KEY = 'syncStatus';

/** The four choices of the settings page. */
export const MODES = Object.freeze(['off', 'browser', 'cloud', 'server']);

/**
 * @typedef {Object} SyncConfig
 * @property {'off' | 'browser' | 'cloud' | 'server'} mode
 *   off: only this device. browser: the browser's own sync storage. cloud: a cloud account.
 *   server: the user's own server.
 * @property {string} providerId          Which provider carries the data ('' while off).
 * @property {object | null} connection   What the provider needs to reach the account: tokens,
 *                                        a server address and password. Opaque to everyone else.
 * @property {number} connectedAt
 * @property {{ name?: string, email?: string } | null} [account]  Whose account it is, where the provider tells.
 * @property {{ enabled: boolean, remember: boolean }} [encryption]
 *   Whether the stored document is encrypted with the user's password (sync/crypto.js), and
 *   whether the key is kept on this device beyond the browser session.
 *
 * @typedef {Object} SyncStatus
 * @property {'idle' | 'syncing' | 'waiting' | 'error'} state
 *   idle: up to date as far as is known. waiting: could not reach the provider, will try again.
 *   error: something the user has to look at.
 * @property {number} lastSyncAt          The last successful synchronisation (0 = never).
 * @property {number} lastAttemptAt
 * @property {{ code: string, detail: string, at: number } | null} error
 * @property {string} syncedHash          Fingerprint of the vault as it was last synchronised.
 * @property {boolean} pending            There is something to send that has not been sent.
 * @property {number} failures            Attempts in a row that did not get through.
 * @property {{ added: number, updated: number, removed: number } | null} lastChanges
 *   What the last synchronisation changed on this device.
 * @property {{ used: number, total: number } | null} usage
 *   How full the provider's storage is, where that is known and matters (browser sync).
 */

/** @returns {SyncConfig} */
export const defaultConfig = () => ({ mode: 'off', providerId: '', connection: null, connectedAt: 0 });
/** @returns {SyncStatus} */
export const defaultStatus = () => ({ state: 'idle', lastSyncAt: 0, lastAttemptAt: 0, error: null, syncedHash: '', pending: false, failures: 0, lastChanges: null, usage: null });

/** @returns {Promise<SyncConfig>} */
export async function getSyncConfig() {
  const stored = (await chrome.storage.local.get(CONFIG_KEY))[CONFIG_KEY];
  const config = { ...defaultConfig(), ...(stored && typeof stored === 'object' ? stored : {}) };
  return MODES.includes(config.mode) ? config : defaultConfig();
}

export async function setSyncConfig(config) {
  await chrome.storage.local.set({ [CONFIG_KEY]: { ...defaultConfig(), ...config } });
}

/** Changes the stored connection (refreshed tokens), provided it is still the same provider. */
export async function updateConnection(providerId, patch) {
  const config = await getSyncConfig();
  if (config.providerId !== providerId || !config.connection) return;
  await setSyncConfig({ ...config, connection: { ...config.connection, ...patch } });
}

/** @returns {Promise<SyncStatus>} */
export async function getSyncStatus() {
  const stored = (await chrome.storage.local.get(STATUS_KEY))[STATUS_KEY];
  return { ...defaultStatus(), ...(stored && typeof stored === 'object' ? stored : {}) };
}

export async function saveSyncStatus(patch) {
  const status = { ...(await getSyncStatus()), ...patch };
  await chrome.storage.local.set({ [STATUS_KEY]: status });
  return status;
}

export async function resetSyncStatus() {
  await chrome.storage.local.set({ [STATUS_KEY]: defaultStatus() });
}
