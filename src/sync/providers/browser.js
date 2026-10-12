// Browser sync: the document lives in chrome.storage.sync, which the browser itself carries
// between the user's devices (Firefox Sync, Chrome sync). No account is connected by Wordvault.
//
// That storage is small: about 100 KB in all and 8 KB per item. The document is therefore stored
// compressed, as base64 text cut into pieces:
//
//   wv_meta   { v, n, rev, at }   n pieces follow; rev counts the writes
//   wv_0 ... wv_<n-1>             the pieces, in order
//
// All pieces of one version are written in a single call. Pieces left over from a longer
// earlier version are removed afterwards.

import { WordvaultError } from '../../lib/errors.js';
import { fromBase64, toBase64 } from '../codec.js';

const META_KEY = 'wv_meta';
const PIECE_PREFIX = 'wv_';
/** Text per piece. With its key and quotes a piece stays well below the 8 KB an item may have. */
const PIECE_CHARS = 7000;
/** What the browsers allow, where they do not say so themselves. */
const QUOTA_BYTES = 102_400;
/** From this share of the room on, the settings page warns. */
export const USAGE_WARNING = 0.8;

const area = () => {
  if (!chrome.storage?.sync) throw new WordvaultError('sync_provider', 'this browser has no sync storage');
  return chrome.storage.sync;
};
const pieceKey = (index) => `${PIECE_PREFIX}${index}`;
/** The size the browser counts for an item: its key plus its value as JSON. */
const sizeOf = (key, value) => key.length + JSON.stringify(value).length;
const totalRoom = () => area().QUOTA_BYTES || QUOTA_BYTES;

/** Turns the browser's own complaints into the codes the engine understands. */
function storageError(error) {
  const detail = String(error?.message || error);
  if (/QUOTA_BYTES|quota.*exceeded|MAX_ITEMS/i.test(detail) && !/MAX_WRITE_OPERATIONS/i.test(detail)) return new WordvaultError('sync_quota', detail);
  // Too many writes in a short time: not a lack of room, just "later".
  if (/MAX_WRITE_OPERATIONS|rate/i.test(detail)) return new WordvaultError('sync_incomplete', detail);
  return new WordvaultError('sync_provider', detail);
}

export const browser = {
  id: 'browser',
  kind: 'browser',
  nameKey: 'syncBrowserName',
  whereKey: 'syncBrowserWhere',

  async connect() {
    area();
    return {};
  },

  async disconnect(session, { deleteRemote }) {
    if (!deleteRemote) return;
    const all = await area().get(null);
    const ours = Object.keys(all).filter((key) => key === META_KEY || key.startsWith(PIECE_PREFIX));
    if (ours.length > 0) await area().remove(ours);
  },

  async read() {
    const all = await area().get(null);
    const meta = all[META_KEY];
    if (!meta || !Number.isInteger(meta.n) || meta.n < 0) return null;
    const pieces = [];
    for (let index = 0; index < meta.n; index++) {
      const piece = all[pieceKey(index)];
      // The browser may deliver a version piece by piece; half of one is not a document yet.
      if (typeof piece !== 'string') throw new WordvaultError('sync_incomplete', `piece ${index + 1} of ${meta.n} has not arrived`);
      pieces.push(piece);
    }
    return { data: fromBase64(pieces.join('')), version: String(meta.rev) };
  },

  async write(session, data, expectedVersion) {
    const current = (await area().get(META_KEY))[META_KEY] || null;
    // The browser offers no "write only if unchanged"; this check narrows the gap as far as it
    // goes. A write that slips through anyway is repaired by the next merge.
    if ((current ? String(current.rev) : null) !== expectedVersion) throw new WordvaultError('sync_conflict', 'the stored version changed');

    const text = toBase64(data);
    const items = {};
    for (let offset = 0, index = 0; offset < text.length; offset += PIECE_CHARS, index++) items[pieceKey(index)] = text.slice(offset, offset + PIECE_CHARS);
    const count = Object.keys(items).length;
    items[META_KEY] = { v: 1, n: count, rev: (current?.rev || 0) + 1, at: Date.now() };

    // Checked before writing: a version that does not fit must not replace half of the old one.
    const needed = Object.entries(items).reduce((sum, [key, value]) => sum + sizeOf(key, value), 0);
    if (needed > totalRoom()) throw new WordvaultError('sync_quota', `${needed} of ${totalRoom()} bytes`);
    try {
      await area().set(items);
      const leftover = [];
      for (let index = count; index < (current?.n || 0); index++) leftover.push(pieceKey(index));
      if (leftover.length > 0) await area().remove(leftover);
    } catch (error) {
      throw storageError(error);
    }
    return { version: String(items[META_KEY].rev) };
  },

  /** The browser account is the browser's business; Wordvault cannot (and need not) see it. */
  async accountInfo() {
    return null;
  },

  /** How full the browser's sync storage is. */
  async usage() {
    const store = area();
    let used;
    try {
      used = await store.getBytesInUse(null);
    } catch {
      // Not offered everywhere: count it the way the browser does.
      used = Object.entries(await store.get(null)).reduce((sum, [key, value]) => sum + sizeOf(key, value), 0);
    }
    return { used, total: totalRoom() };
  },
};
