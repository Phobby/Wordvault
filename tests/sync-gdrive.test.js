// Google Drive: signing in without a secret, keeping the document in the application data
// folder, and finding or creating it. Google is played by tests/helpers/fake-drive.js; no real
// account and no real key is involved.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { addEntry, listEntries } from '../src/lib/vault.js';
import { decodeDocument, encodeDocument } from '../src/sync/codec.js';
import { OAUTH_CLIENT_IDS, clientIdFor } from '../src/sync/config.js';
import { syncNow } from '../src/sync/engine.js';
import { readLocalDocument } from '../src/sync/local.js';
import { serializeDocument } from '../src/sync/merge.js';
import { challengeFor, redirectUrl } from '../src/sync/oauth.js';
import { gdrive } from '../src/sync/providers/gdrive.js';
import { getSyncProvider } from '../src/sync/providers/index.js';
import { getSyncConfig, setSyncConfig } from '../src/sync/state.js';
import { createDevice, use } from './helpers/chrome.js';
import { createFakeDrive } from './helpers/fake-drive.js';

const T0 = 1_790_000_000_000;
const HOUR = 3_600_000;
const realFetch = globalThis.fetch;
const placeholder = OAUTH_CLIENT_IDS.gdrive;

let drive;
let a;
beforeEach((t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  OAUTH_CLIENT_IDS.gdrive = 'test-client.apps.googleusercontent.com';
  drive = createFakeDrive();
  globalThis.fetch = drive.fetch;
  a = device('A');
});
afterEach(() => {
  globalThis.fetch = realFetch;
  OAUTH_CLIENT_IDS.gdrive = placeholder;
});
function device(name) {
  const created = use(createDevice(name));
  created.browser.signIn = (url, interactive) => drive.signIn(url, interactive);
  return created;
}
const at = (t, time) => t.mock.timers.setTime(time);
const word = (text) => ({ text, translation: `${text}-tr`, sourceLang: 'en', targetLang: 'tr' });
/** Connects the device the way the settings page does. */
async function connect(one) {
  use(one);
  const connection = await gdrive.connect();
  await setSyncConfig({ mode: 'cloud', providerId: 'gdrive', connection, connectedAt: Date.now() });
  return connection;
}
const session = async () => ({ connection: (await getSyncConfig()).connection, update: async () => {} });
const sleep = async () => {};

test('the registry knows Google Drive, and says which addresses it needs', () => {
  assert.equal(getSyncProvider('gdrive'), gdrive);
  assert.deepEqual(gdrive.origins(), ['https://www.googleapis.com/*', 'https://oauth2.googleapis.com/*']);
});

test('without a client ID connecting says that the setup is missing, and asks Google nothing', async () => {
  OAUTH_CLIENT_IDS.gdrive = placeholder;
  assert.equal(clientIdFor('gdrive'), '');
  await assert.rejects(gdrive.connect(), { code: 'sync_config' });
  assert.equal(a.browser.signIns.length, 0);
  assert.equal(drive.requests.length, 0);
  for (const empty of ['', '   ', 'YOUR_SOMETHING']) {
    OAUTH_CLIENT_IDS.gdrive = empty;
    assert.equal(clientIdFor('gdrive'), '');
  }
});

test('signing in asks for the application data folder and nothing else, with no secret', async () => {
  const connection = await connect(a);
  assert.equal(a.browser.signIns.length, 1);
  const { url, interactive } = a.browser.signIns[0];
  const asked = Object.fromEntries(new URL(url).searchParams);
  assert.equal(interactive, true);
  assert.equal(new URL(url).origin + new URL(url).pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.deepEqual(
    { client_id: asked.client_id, response_type: asked.response_type, redirect_uri: asked.redirect_uri, scope: asked.scope },
    { client_id: 'test-client.apps.googleusercontent.com', response_type: 'token', redirect_uri: 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/', scope: 'https://www.googleapis.com/auth/drive.appdata' },
  );
  assert.ok(asked.state.length >= 16, 'with a state to recognise the answer by');
  assert.ok(!('client_secret' in asked));
  assert.deepEqual([typeof connection.accessToken, connection.expiresAt, connection.hint, 'refreshToken' in connection], ['string', T0 + 3599_000, 'tester@example.com', false]);
  assert.deepEqual(await gdrive.accountInfo(await session()), { name: 'Test User', email: 'tester@example.com' });
});

test('in Firefox the redirect goes to the loopback address Google accepts', async () => {
  a.browser.redirect = 'https://4e1e83b4f82a40a825858d9d7610ba8b8558e84e.extensions.allizom.org/';
  assert.equal(redirectUrl(), 'https://4e1e83b4f82a40a825858d9d7610ba8b8558e84e.extensions.allizom.org/');
  assert.equal(redirectUrl({ loopback: true }), 'http://127.0.0.1/mozoauth2/4e1e83b4f82a40a825858d9d7610ba8b8558e84e');
  await connect(a);
  assert.equal(new URL(a.browser.signIns[0].url).searchParams.get('redirect_uri'), 'http://127.0.0.1/mozoauth2/4e1e83b4f82a40a825858d9d7610ba8b8558e84e');
  // Chrome's address has no loopback form
  a.browser.redirect = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/';
  assert.equal(redirectUrl({ loopback: true }), 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/');
});

test('the sign-in window closed, access refused, or an answer that is not ours: nothing is connected', async () => {
  a.browser.signIn = () => { throw new Error('The user did not approve access.'); };
  await assert.rejects(gdrive.connect(), { code: 'sync_cancelled' });
  a.browser.signIn = (url) => `${url.searchParams.get('redirect_uri')}#error=access_denied&state=${url.searchParams.get('state')}`;
  await assert.rejects(gdrive.connect(), { code: 'sync_cancelled' });
  a.browser.signIn = (url) => `${url.searchParams.get('redirect_uri')}#access_token=stolen&expires_in=3600&state=someone-elses`;
  await assert.rejects(gdrive.connect(), { code: 'sync_provider' });
  a.browser.signIn = (url) => `${url.searchParams.get('redirect_uri')}#error=invalid_client&error_description=no+such+client&state=${url.searchParams.get('state')}`;
  await assert.rejects(gdrive.connect(), (error) => error.code === 'sync_provider' && /invalid_client: no such client/.test(error.detail));
});

test('first synchronisation creates the file in the application data folder; the next device finds it', async () => {
  await connect(a);
  for (const text of ['book', 'door']) await addEntry(word(text));
  assert.equal((await syncNow({ sleep })).state, 'idle');
  assert.equal(drive.files.length, 1);
  assert.deepEqual([drive.files[0].name, drive.files[0].parents], ['wordvault-vault.json.gz', ['appDataFolder']]);
  assert.deepEqual([...drive.files[0].data.subarray(0, 2)], [0x1f, 0x8b], 'stored gzip-compressed, as bytes');
  assert.deepEqual(Object.keys((await decodeDocument(drive.files[0].data)).e).sort(), ['en|tr|book', 'en|tr|door']);
  assert.ok(drive.requests.some((request) => request.startsWith('GET /drive/v3/files?spaces=appDataFolder')), 'it looks only in the application data folder');

  const b = device('B');
  await connect(b);
  await addEntry(word('tree'));
  const status = await syncNow({ sleep });
  assert.deepEqual(status.lastChanges, { added: 2, updated: 0, removed: 0 });
  assert.equal(drive.files.length, 1, 'the same file, not a second one');
  assert.equal(drive.files[0].version, 2);

  use(a);
  await syncNow({ sleep });
  assert.deepEqual((await listEntries()).map((entry) => entry.text).sort(), ['book', 'door', 'tree']);
  const mine = serializeDocument(await readLocalDocument());
  use(b);
  assert.equal(serializeDocument(await readLocalDocument()), mine);
});

test('nothing new: nothing is uploaded', async () => {
  await connect(a);
  await addEntry(word('book'));
  await syncNow({ sleep });
  const uploads = () => drive.requests.filter((request) => request.includes('/upload/')).length;
  const before = uploads();
  await syncNow({ sleep });
  await syncNow({ sleep });
  assert.equal(uploads(), before);
});

test('two files from two devices that connected at the same moment become one', async () => {
  await connect(a);
  await addEntry(word('book'));
  const b = device('B');
  await connect(b);
  await addEntry(word('tree'));
  // Each created a file without seeing the other's.
  drive.put(await encodeDocument(await readLocalDocument()), { createdTime: new Date(T0 + 5000).toISOString() });
  use(a);
  drive.put(await encodeDocument(await readLocalDocument()), { createdTime: new Date(T0 + 1000).toISOString() });
  const [newer, oldest] = drive.files.map((file) => file.id);

  assert.equal((await syncNow({ sleep })).state, 'idle');
  assert.deepEqual(drive.files.map((file) => file.id), [oldest], 'the older file is kept');
  assert.ok(!drive.files.some((file) => file.id === newer));
  assert.deepEqual(Object.keys((await decodeDocument(drive.files[0].data)).e).sort(), ['en|tr|book', 'en|tr|tree']);
  assert.deepEqual((await listEntries()).map((entry) => entry.text).sort(), ['book', 'tree']);
});

test('the file changed between reading and writing: merge again and write again', async () => {
  await connect(a);
  await addEntry(word('book'));
  await syncNow({ sleep });
  await addEntry(word('door'));
  // Another device uploads in the middle of A's run. (The check just before writing notices it.)
  const other = await encodeDocument({ v: 1, e: { ...(await readLocalDocument()).e, 'en|tr|sea': { w: 'sea', t: 'deniz', sl: 'en', tl: 'tr', u: T0, r: 1 } } });
  let slipped = false;
  const original = drive.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!slipped && /\/drive\/v3\/files\/file1\?fields=id,version/.test(url)) {
      slipped = true;
      drive.files[0].data = other;
      drive.files[0].version += 1;
    }
    return original(input, init);
  };
  const sleeps = [];
  const status = await syncNow({ sleep: async (ms) => sleeps.push(ms) });
  assert.equal(status.state, 'idle');
  assert.deepEqual(sleeps, [500]);
  assert.deepEqual(Object.keys((await decodeDocument(drive.files[0].data)).e).sort(), ['en|tr|book', 'en|tr|door', 'en|tr|sea']);
  assert.deepEqual((await listEntries()).map((entry) => entry.text).sort(), ['book', 'door', 'sea']);
});

test('the access token runs out after an hour: it is renewed without a window, for the same account', async (t) => {
  await connect(a);
  await addEntry(word('book'));
  await syncNow({ sleep });
  assert.equal(a.browser.signIns.length, 1);

  at(t, T0 + HOUR + 1000);
  await addEntry(word('door'));
  assert.equal((await syncNow({ sleep })).state, 'idle');
  assert.equal(a.browser.signIns.length, 2);
  const renewal = a.browser.signIns[1];
  const asked = new URL(renewal.url).searchParams;
  assert.deepEqual([renewal.interactive, asked.get('prompt'), asked.get('login_hint'), asked.get('response_type')], [false, 'none', 'tester@example.com', 'token']);
  const stored = (await getSyncConfig()).connection;
  assert.equal(stored.expiresAt, T0 + HOUR + 1000 + 3599_000, 'and the new token is kept');
  assert.equal(drive.files[0].version, 2);
});

test('a token Google rejects early is renewed once and the request repeated', async () => {
  await connect(a);
  await addEntry(word('book'));
  drive.validTokens.clear(); // revoked on Google's side, although it has not run out here
  assert.equal((await syncNow({ sleep })).state, 'idle');
  assert.equal(a.browser.signIns.length, 2);
  assert.equal(drive.files.length, 1);
});

test('no longer signed in to Google: the user is asked to connect again; the vault is untouched', async (t) => {
  await connect(a);
  await addEntry(word('book'));
  await syncNow({ sleep });
  at(t, T0 + 2 * HOUR);
  drive.signedIn = false;
  await addEntry(word('door'));
  const status = await syncNow({ sleep });
  assert.deepEqual([status.state, status.error.code], ['error', 'sync_auth']);
  assert.deepEqual((await listEntries()).map((entry) => entry.text).sort(), ['book', 'door']);
  // connecting again picks up where it left off
  drive.signedIn = true;
  await connect(a);
  assert.equal((await syncNow({ sleep })).state, 'idle');
  assert.equal(Object.keys((await decodeDocument(drive.files[0].data)).e).length, 2);
});

test('Drive is full, or asks to slow down: told apart', async () => {
  await connect(a);
  await addEntry(word('book'));
  drive.failNext = { 'POST /upload': [403, 'storageQuotaExceeded'] };
  let status = await syncNow({ sleep });
  assert.deepEqual([status.state, status.error.code], ['error', 'sync_quota']);
  drive.failNext = { 'POST /upload': [403, 'userRateLimitExceeded'] };
  status = await syncNow({ sleep });
  assert.deepEqual([status.state, status.error.code], ['waiting', 'network']);
  drive.failNext = { 'GET /drive/v3/files': [503, 'backendError'] };
  status = await syncNow({ sleep });
  assert.deepEqual([status.state, status.error.code], ['waiting', 'network']);
  assert.equal((await syncNow({ sleep })).state, 'idle');
});

test('the network is down: a transport failure, not an answer', async () => {
  await connect(a);
  await addEntry(word('book'));
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const status = await syncNow({ sleep });
  assert.deepEqual([status.state, status.error.code], ['waiting', 'network']);
});

test('disconnecting gives the access back; the file goes only if that was asked for', async () => {
  const connection = await connect(a);
  await addEntry(word('book'));
  await syncNow({ sleep });
  await gdrive.disconnect(await session(), { deleteRemote: false });
  assert.deepEqual(drive.revoked, [connection.accessToken]);
  assert.equal(drive.files.length, 1);

  await connect(a);
  await gdrive.disconnect(await session(), { deleteRemote: true });
  assert.equal(drive.files.length, 0);
});

test('PKCE: the challenge is the base64url SHA-256 of the verifier', async () => {
  // the example from RFC 7636, appendix B
  assert.equal(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
