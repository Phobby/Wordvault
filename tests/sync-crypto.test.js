// Optional encryption of the synchronised document: what is stored remotely cannot be read
// without the password, a second device needs only the password, and nothing is ever written
// over a file that could not be read.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { addEntry, listEntries } from '../src/lib/vault.js';
import { decodeDocument, encodeDocument } from '../src/sync/codec.js';
import { KDF_ROUNDS, clearSecret, decrypt, deriveSecret, encrypt, getSecret, headerOf, isEncrypted, setSecret } from '../src/sync/crypto.js';
import { syncNow, turnOffEncryption, unlockEncryption } from '../src/sync/engine.js';
import { readLocalDocument } from '../src/sync/local.js';
import { serializeDocument } from '../src/sync/merge.js';
import { registerSyncProvider } from '../src/sync/providers/index.js';
import { getSyncConfig, getSyncStatus, setSyncConfig } from '../src/sync/state.js';
import { createDevice, use } from './helpers/chrome.js';
import { createCloud } from './helpers/memory-provider.js';

const T0 = 1_790_000_000_000;
const PASSWORD = 'correct horse battery staple';
const text = (bytes) => new TextDecoder('latin1').decode(bytes);
const word = (value) => ({ text: value, translation: `${value}-tr`, sourceLang: 'en', targetLang: 'tr' });

let cloud;
let a;
let b;
async function connect(device) {
  use(device);
  await setSyncConfig({ mode: 'cloud', providerId: 'memory', connection: {}, connectedAt: T0 });
  return device;
}
beforeEach(async () => {
  let provider;
  ({ cloud, provider } = createCloud());
  registerSyncProvider(provider);
  a = await connect(createDevice('A'));
  b = await connect(createDevice('B'));
});
const wordsOf = async (device) => {
  use(device);
  return (await listEntries()).map((entry) => entry.text).sort();
};

// --- The envelope -----------------------------------------------------------------------------

test('what is encrypted can be read back with the same password, and with nothing else', async () => {
  const secret = await deriveSecret(PASSWORD);
  assert.equal(secret.rounds, KDF_ROUNDS);
  assert.ok(KDF_ROUNDS >= 600_000);
  const content = new TextEncoder().encode('the vault, compressed');
  const envelope = await encrypt(content, secret);
  assert.equal(text(envelope.subarray(0, 4)), 'WVE1');
  assert.ok(isEncrypted(envelope));
  assert.ok(!text(envelope).includes('the vault'), 'the content is not readable in it');
  assert.deepEqual([...(await decrypt(envelope, secret))], [...content]);

  // the same password on another device: the salt comes from the stored file
  const { salt, rounds } = headerOf(envelope);
  const again = await deriveSecret(PASSWORD, salt, rounds);
  assert.equal(again.key, secret.key);
  assert.deepEqual([...(await decrypt(envelope, again))], [...content]);

  const wrong = await deriveSecret('correct horse battery stapler', salt, rounds);
  await assert.rejects(decrypt(envelope, wrong), { code: 'sync_password' });
  await assert.rejects(decrypt(envelope, null), { code: 'sync_password' });
});

test('every write uses a new nonce; a changed byte anywhere is noticed', async () => {
  const secret = await deriveSecret(PASSWORD);
  const content = new Uint8Array(200).fill(7);
  const first = await encrypt(content, secret);
  const second = await encrypt(content, secret);
  assert.notDeepEqual([...first.subarray(24, 36)], [...second.subarray(24, 36)], 'different nonces');
  assert.notDeepEqual([...first.subarray(36)], [...second.subarray(36)], 'so different ciphertext for the same content');
  assert.deepEqual([...first.subarray(0, 24)], [...second.subarray(0, 24)], 'the header (rounds and salt) stays');

  for (const position of [5, 10, 30, 40, first.length - 1]) {
    const tampered = first.slice();
    tampered[position] ^= 1;
    await assert.rejects(isEncrypted(tampered) ? decrypt(tampered, secret) : Promise.reject({ code: 'sync_password' }), { code: 'sync_password' }, `byte ${position}`);
  }
});

test('a header that asks for an implausible key derivation is refused', async () => {
  const secret = await deriveSecret(PASSWORD);
  const envelope = await encrypt(new Uint8Array(50), secret);
  for (const rounds of [1, 1000, 2_000_000_000]) {
    const forged = envelope.slice();
    new DataView(forged.buffer).setUint32(4, rounds);
    assert.throws(() => headerOf(forged), { code: 'sync_bad_document' }, String(rounds));
  }
  await assert.rejects(deriveSecret(''), { code: 'sync_password' });
  assert.equal(isEncrypted(new Uint8Array([0x1f, 0x8b, 0, 0])), false, 'a plain gzip file is not taken for an encrypted one');
});

test('the codec encrypts after compressing and reads both forms', async () => {
  use(a);
  await addEntry(word('book'));
  const document = await readLocalDocument();
  const secret = await deriveSecret(PASSWORD);
  const sealed = await encodeDocument(document, secret);
  assert.ok(isEncrypted(sealed));
  assert.deepEqual(await decodeDocument(sealed, secret), document);
  await assert.rejects(decodeDocument(sealed), { code: 'sync_password' });
  assert.deepEqual(await decodeDocument(await encodeDocument(document), secret), document, 'an unencrypted file is read with or without a key');
});

// --- Keeping the key ----------------------------------------------------------------------------

test('the key is kept for the browser session only, unless the user asks for it to be remembered', async () => {
  use(a);
  const secret = await deriveSecret(PASSWORD);
  await setSecret(secret, { remember: false });
  assert.deepEqual(await getSecret(), secret);
  assert.equal(a.dump().syncSecret, undefined, 'nothing about it is written to the device\'s storage');
  assert.ok(!JSON.stringify(a.dump()).includes(PASSWORD));
  a.restartBrowser();
  assert.equal(await getSecret(), null, 'after closing the browser it is gone');

  await setSecret(secret, { remember: true });
  a.restartBrowser();
  assert.deepEqual(await getSecret(), secret);
  assert.ok(!JSON.stringify(a.dump()).includes(PASSWORD), 'the password itself is never kept, only the key derived from it');
  await clearSecret();
  assert.equal(await getSecret(), null);
});

// --- Through the engine --------------------------------------------------------------------------

test('with encryption on, the stored file cannot be read without the password', async () => {
  use(a);
  for (const value of ['book', 'door']) await addEntry(word(value));
  const status = await unlockEncryption({ password: PASSWORD });
  assert.equal(status.state, 'idle');
  assert.deepEqual((await getSyncConfig()).encryption, { enabled: true, remember: false });
  const stored = cloud.data();
  assert.ok(isEncrypted(stored));
  assert.ok(!/book|door|kitap|en\|tr/.test(text(stored)), 'no word, no translation, not even the keys are visible');
  // and it stays encrypted on later writes
  await addEntry(word('tree'));
  await syncNow();
  assert.ok(isEncrypted(cloud.data()));
});

test('a second device is asked for the password; a wrong one is refused, the right one merges the vaults', async () => {
  use(a);
  await addEntry(word('book'));
  await unlockEncryption({ password: PASSWORD });
  const stored = cloud.data();

  use(b);
  await addEntry(word('tree'));
  let status = await syncNow();
  assert.deepEqual([status.state, status.error.code], ['error', 'sync_password']);
  assert.equal(cloud.data(), stored, 'the file it could not read was left exactly as it was');
  assert.deepEqual(await wordsOf(b), ['tree']);
  assert.equal((await syncNow({ reason: 'periodic' })).error.code, 'sync_password', 'and it waits for the user instead of trying again');

  await assert.rejects(unlockEncryption({ password: 'not the password' }), { code: 'sync_password' });
  assert.equal(await getSecret(), null, 'a wrong password leaves nothing behind');
  assert.equal(cloud.data(), stored);

  status = await unlockEncryption({ password: PASSWORD });
  assert.equal(status.state, 'idle');
  assert.deepEqual(await wordsOf(b), ['book', 'tree']);
  assert.ok(isEncrypted(cloud.data()));
  use(a);
  await syncNow();
  assert.deepEqual(await wordsOf(a), ['book', 'tree']);
  const mine = serializeDocument(await readLocalDocument());
  use(b);
  assert.equal(serializeDocument(await readLocalDocument()), mine);
});

test('turning encryption on over a file that is already there encrypts it in place', async () => {
  use(a);
  await addEntry(word('book'));
  await syncNow();
  assert.equal(isEncrypted(cloud.data()), false);
  use(b);
  await syncNow();

  use(a);
  await unlockEncryption({ password: PASSWORD });
  assert.ok(isEncrypted(cloud.data()), 'rewritten although no word changed');
  use(b);
  assert.equal((await syncNow()).error.code, 'sync_password', 'the other device now needs the password too');
  await unlockEncryption({ password: PASSWORD });
  assert.deepEqual(await wordsOf(b), ['book']);
});

test('after the browser was closed the password is needed again, unless it was remembered', async () => {
  use(a);
  await addEntry(word('book'));
  await unlockEncryption({ password: PASSWORD });
  a.restartBrowser();
  await addEntry(word('door'));
  let status = await syncNow();
  assert.deepEqual([status.state, status.error.code], ['error', 'sync_password']);
  assert.deepEqual(await wordsOf(a), ['book', 'door'], 'the vault on the device is not encrypted and not affected');
  status = await unlockEncryption({ password: PASSWORD, remember: true });
  assert.equal(status.state, 'idle');

  a.restartBrowser();
  await addEntry(word('tree'));
  assert.equal((await syncNow()).state, 'idle', 'remembered: no question after the next restart');
  assert.equal(Object.keys((await decodeDocument(cloud.data(), await getSecret())).e).length, 3);
});

test('turning encryption off writes the file readable again and forgets the key', async () => {
  use(a);
  await addEntry(word('book'));
  await unlockEncryption({ password: PASSWORD, remember: true });
  const status = await turnOffEncryption();
  assert.equal(status.state, 'idle');
  assert.equal(isEncrypted(cloud.data()), false);
  assert.deepEqual(Object.keys((await decodeDocument(cloud.data())).e), ['en|tr|book']);
  assert.equal(await getSecret(), null);
  assert.equal(a.dump().syncSecret, undefined);
  assert.deepEqual((await getSyncConfig()).encryption, { enabled: false, remember: false });
});

test('an encrypted file is never overwritten by a device that cannot read it', async () => {
  use(a);
  for (const value of ['book', 'door']) await addEntry(word(value));
  await unlockEncryption({ password: PASSWORD });
  const stored = cloud.data();
  const writes = cloud.writes;

  use(b);
  for (let n = 0; n < 5; n++) await addEntry(word(`mine${n}`));
  for (const reason of ['manual', 'change', 'periodic', 'startup', 'manual']) await syncNow({ reason });
  assert.equal(cloud.writes, writes);
  assert.equal(cloud.data(), stored);
  assert.equal((await getSyncStatus()).pending, true, 'its own changes wait');
});
