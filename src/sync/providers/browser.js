// Browser sync: the document lives in chrome.storage.sync, which the browser itself carries
// between the user's devices (Firefox Sync, Chrome sync). No account is connected by Wordvault.
//
// That storage is small: about 100 KB in all and 8 KB per item. The document is therefore stored
// compressed, as base64 text cut into pieces.
//
// Every device writes only a copy of its own, under keys nobody else writes:
//
//   wv:<device>:m              { v, n, rev, at, h }   n pieces follow; rev counts the writes,
//                                                     h is a fingerprint of the joined pieces
//   wv:<device>:0 ... :<n-1>   the pieces, in order
//
// and reads the copies of all the others, which the engine merges in. The browsers merge their
// sync storage key by key (Firefox Sync, Chrome sync alike): had all devices written to the same
// keys, two of them writing at about the same time would leave a mixture of the pieces of both
// versions behind, which is no document at all. With a copy per device that cannot happen, and
// since every copy holds everything its device knew, merging all of them loses nothing.
//
// The fingerprint tells a copy whose pieces have only partly arrived from a complete one. A
// copy that has not been rewritten for STALE_DAYS belongs to a device that is gone (the extension
// was removed there); its content has been merged in long since, and it is removed to free room.
//
// Before version 2 there was one shared copy (wv_meta, wv_0 ...). It is read once, merged in
// like another device's copy, and removed when this device writes its own.

import { WordvaultError } from '../../lib/errors.js';
import { fromBase64, toBase64 } from '../codec.js';

const PREFIX = 'wv:';
const LEGACY_META = 'wv_meta';
const LEGACY_PIECE = /^wv_\d+$/;
const DEVICE_KEY = 'syncDeviceId';
/** Text per piece. With its key and quotes a piece stays well below the 8 KB an item may have. */
const PIECE_CHARS = 7000;
/** What the browsers allow, where they do not say so themselves. */
const QUOTA_BYTES = 102_400;
/** A copy not rewritten for this long belongs to a device that no longer synchronises. */
const STALE_DAYS = 60;
/** From this share of the room on, the settings page warns. */
export const USAGE_WARNING = 0.8;

const area = () => {
  if (!chrome.storage?.sync) throw new WordvaultError('sync_provider', 'this browser has no sync storage');
  return chrome.storage.sync;
};
const metaKey = (device) => `${PREFIX}${device}:m`;
const pieceKey = (device, index) => `${PREFIX}${device}:${index}`;
/** The device a key of ours belongs to, or null. */
const deviceOf = (key) => (key.startsWith(PREFIX) ? key.slice(PREFIX.length, key.lastIndexOf(':')) || null : null);
const isOurs = (key) => key.startsWith(PREFIX) || key === LEGACY_META || LEGACY_PIECE.test(key);
/** The size the browser counts for an item: its key plus its value as JSON. */
const sizeOf = (key, value) => key.length + JSON.stringify(value).length;
const totalRoom = () => area().QUOTA_BYTES || QUOTA_BYTES;

/**
 * This device's name in the browser's sync storage: random, made once, kept in local storage
 * only (it must differ between devices, so it must not travel with the sync storage itself).
 */
export async function deviceId() {
  const stored = (await chrome.storage.local.get(DEVICE_KEY))[DEVICE_KEY];
  if (typeof stored === 'string' && /^[0-9a-f]{12}$/.test(stored)) return stored;
  const id = Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  await chrome.storage.local.set({ [DEVICE_KEY]: id });
  return id;
}

/** Whether a change to the browser's sync storage came from another device's Wordvault. */
export async function isForeignChange(keys) {
  const own = await deviceId();
  return keys.some((key) => isOurs(key) && deviceOf(key) !== own);
}

async function hashOf(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest.subarray(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Puts a copy back together.
 * @returns {Promise<Uint8Array | null>} null while pieces are missing or from another version.
 */
async function assemble(meta, pieceAt) {
  if (!meta || !Number.isInteger(meta.n) || meta.n < 0) return null;
  const pieces = [];
  for (let index = 0; index < meta.n; index++) {
    const piece = pieceAt(index);
    if (typeof piece !== 'string') return null;
    pieces.push(piece);
  }
  const text = pieces.join('');
  // Copies of version 1 carry no fingerprint; their pieces are taken as they are.
  if (meta.h !== undefined && meta.h !== (await hashOf(text))) return null;
  return fromBase64(text);
}

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

  /** Lets the engine tell another device's copy arriving from this device's own writes. */
  isForeignChange,

  /** With `deleteRemote`, Wordvault's data goes from the browser's sync storage: every device's copy. */
  async disconnect(session, { deleteRemote }) {
    if (!deleteRemote) return;
    const ours = Object.keys(await area().get(null)).filter(isOurs);
    if (ours.length > 0) await area().remove(ours);
  },

  /**
   * This device's copy is the main one; the other devices' copies come as `others`, without a
   * way to remove them (they are not extra files but the other devices' own). A copy that has
   * only partly arrived is left out this time: the next change to the storage brings the rest.
   */
  async read() {
    const all = await area().get(null);
    const own = await deviceId();
    const ownMeta = all[metaKey(own)];
    // Only this device writes its copy, so it cannot be half there unless the browser lost a
    // write; it then counts as none and is written anew.
    const main = ownMeta ? await assemble(ownMeta, (index) => all[pieceKey(own, index)]) : null;

    const others = [];
    for (const key of Object.keys(all)) {
      const device = deviceOf(key);
      if (!device || device === own || key !== metaKey(device)) continue;
      const data = await assemble(all[key], (index) => all[pieceKey(device, index)]);
      if (data) others.push({ id: device, data });
    }
    const legacy = await assemble(all[LEGACY_META], (index) => all[`wv_${index}`]);
    if (legacy) others.push({ id: 'legacy', data: legacy });

    if (!main && others.length === 0) return null;
    return { data: main, version: main ? String(ownMeta.rev) : null, others };
  },

  async write(session, data, expectedVersion) {
    const own = await deviceId();
    const all = await area().get(null);
    const current = all[metaKey(own)] || null;
    // read() reported an unreadable copy of this device's as none: it is then simply replaced.
    const readable = current && (await assemble(current, (index) => all[pieceKey(own, index)])) !== null;
    // Only this device writes here; the check guards against two runs of its own overlapping.
    if ((readable ? String(current.rev) : null) !== expectedVersion) throw new WordvaultError('sync_conflict', 'the stored version changed');

    const text = toBase64(data);
    const items = {};
    for (let offset = 0, index = 0; offset < text.length; offset += PIECE_CHARS, index++) items[pieceKey(own, index)] = text.slice(offset, offset + PIECE_CHARS);
    const count = Object.keys(items).length;
    items[metaKey(own)] = { v: 2, n: count, rev: (current?.rev || 0) + 1, at: Date.now(), h: await hashOf(text) };

    // What goes away with this write: the rest of this device's longer earlier copy, the shared
    // copy of version 1 (merged in by now), and the copies of devices gone for good.
    const leftover = [];
    for (let index = count; index < (current?.n || 0); index++) leftover.push(pieceKey(own, index));
    const staleBefore = Date.now() - STALE_DAYS * 86_400_000;
    for (const key of Object.keys(all)) {
      if (key === LEGACY_META || LEGACY_PIECE.test(key)) leftover.push(key);
      const device = deviceOf(key);
      if (device && device !== own && !(all[metaKey(device)]?.at >= staleBefore)) leftover.push(key);
    }

    // Checked before writing: a version that does not fit must not replace half of the old one.
    // The room is shared with what stays: the other devices' copies and anything else stored.
    const total = (entries) => entries.reduce((sum, [key, value]) => sum + sizeOf(key, value), 0);
    const kept = Object.entries(all).filter(([key]) => !(key in items));
    const needed = total(Object.entries(items)) + total(kept.filter(([key]) => !leftover.includes(key)));
    if (needed > totalRoom()) throw new WordvaultError('sync_quota', `${needed} of ${totalRoom()} bytes`);
    // The leftovers go after the new copy is stored, unless the room is only there without them.
    const removeFirst = total(Object.entries(items)) + total(kept) > totalRoom();
    try {
      if (removeFirst && leftover.length > 0) await area().remove(leftover);
      await area().set(items);
      if (!removeFirst && leftover.length > 0) await area().remove(leftover);
    } catch (error) {
      throw storageError(error);
    }
    return { version: String(items[metaKey(own)].rev) };
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
