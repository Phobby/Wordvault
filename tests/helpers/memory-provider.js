// A provider that keeps the synchronised document in memory: the cloud the tests' devices share.
// It behaves like the real ones in the ways that matter to the engine: a write only succeeds
// against the version that was read, files can be missing, and things can fail.

import { WordvaultError } from '../../src/lib/errors.js';

/**
 * @param {Object} [options]
 * @param {boolean} [options.manyFiles]  Like Google Drive: files are known by id, and two with
 *   the same name can exist side by side. Otherwise there is one file at one path.
 */
export function createCloud({ manyFiles = false } = {}) {
  let nextId = 1;
  let revision = 0;
  const cloud = {
    /** @type {{ id: string, data: Uint8Array, version: string, createdAt: number }[]} */
    files: [],
    reads: 0,
    writes: 0,
    removed: [],
    /** Thrown by the next calls of that kind while set: `{ read?: Error, write?: Error }`. */
    failing: {},
    /** Called after a device has read and before it writes: the moment another device slips in. */
    beforeWrite: null,
    /** While true, read() finds nothing although files exist (the listing has not caught up). */
    hidden: false,
    /** The main file's bytes, or null. */
    data: () => (cloud.files[0] ? cloud.files[0].data : null),
    put(data) {
      const file = { id: `file-${nextId++}`, data, version: `v${++revision}`, createdAt: Date.now() + cloud.files.length };
      cloud.files.push(file);
      cloud.files.sort((a, b) => a.createdAt - b.createdAt);
      return file;
    },
  };

  const provider = {
    id: 'memory',
    kind: 'cloud',
    nameKey: 'memory',
    connect: async () => ({ account: 'tester@example.com' }),
    async disconnect(session, { deleteRemote }) {
      if (deleteRemote) cloud.files = [];
    },
    async read() {
      cloud.reads += 1;
      if (cloud.failing.read) throw cloud.failing.read;
      if (cloud.hidden || cloud.files.length === 0) return null;
      // The oldest file is the one to keep.
      const [main, ...others] = cloud.files;
      return { data: main.data, version: main.version, others: others.map((file) => ({ id: file.id, data: file.data })) };
    },
    async write(session, data, expectedVersion) {
      if (cloud.beforeWrite) {
        const slipIn = cloud.beforeWrite;
        cloud.beforeWrite = null;
        await slipIn();
      }
      if (cloud.failing.write) throw cloud.failing.write;
      const main = cloud.files[0];
      if (expectedVersion === null) {
        // "Only if there is none": a path can hold one file; a Drive-like store takes another.
        if (main && !manyFiles) throw new WordvaultError('sync_conflict', 'the file exists');
        cloud.writes += 1;
        return { version: cloud.put(data).version };
      }
      if (!main || main.version !== expectedVersion) throw new WordvaultError('sync_conflict', `expected ${expectedVersion}, found ${main ? main.version : 'nothing'}`);
      cloud.writes += 1;
      main.data = data;
      main.version = `v${++revision}`;
      return { version: main.version };
    },
    async removeOthers(session, ids) {
      cloud.removed.push(...ids);
      cloud.files = cloud.files.filter((file) => !ids.includes(file.id));
    },
    accountInfo: async (session) => ({ email: session.connection.account }),
  };
  return { cloud, provider };
}
