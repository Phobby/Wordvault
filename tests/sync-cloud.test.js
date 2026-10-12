// OneDrive and Dropbox: signing in with a code and PKCE (no secret), keeping the document in the
// application's own folder, conditional writes, and staying connected. Microsoft and Dropbox are
// played by the helpers in tests/helpers; no real account and no real key is involved.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { addEntry, listEntries } from '../src/lib/vault.js';
import { decodeDocument, encodeDocument } from '../src/sync/codec.js';
import { OAUTH_CLIENT_IDS } from '../src/sync/config.js';
import { syncNow } from '../src/sync/engine.js';
import { readLocalDocument } from '../src/sync/local.js';
import { serializeDocument } from '../src/sync/merge.js';
import { dropbox } from '../src/sync/providers/dropbox.js';
import { getSyncProvider } from '../src/sync/providers/index.js';
import { onedrive } from '../src/sync/providers/onedrive.js';
import { getSyncConfig, setSyncConfig } from '../src/sync/state.js';
import { createDevice, use } from './helpers/chrome.js';
import { createFakeDropbox } from './helpers/fake-dropbox.js';
import { createFakeOneDrive } from './helpers/fake-onedrive.js';

const T0 = 1_790_000_000_000;
const HOUR = 3_600_000;
const realFetch = globalThis.fetch;
const placeholders = { ...OAUTH_CLIENT_IDS };
const sleep = async () => {};
const word = (text) => ({ text, translation: `${text}-tr`, sourceLang: 'en', targetLang: 'tr' });

/** The two providers, and what differs between them from the tests' point of view. */
const CASES = [
  {
    id: 'onedrive',
    provider: onedrive,
    clientId: '11112222-3333-4444-5555-666677778888',
    create: createFakeOneDrive,
    stored: (cloud) => cloud.file?.data || null,
    put: (cloud, data) => cloud.put(data),
    uploadPath: 'PUT',
    quota: (cloud) => { cloud.failNext = { 'PUT ': [507, 'quotaLimitReached'] }; },
    throttle: (cloud) => { cloud.failNext = { 'GET ': [429, 'activityLimitReached'] }; },
  },
  {
    id: 'dropbox',
    provider: dropbox,
    clientId: 'abcdefghijklmno',
    create: createFakeDropbox,
    stored: (cloud) => cloud.files.get('/wordvault-vault.json.gz')?.data || null,
    put: (cloud, data) => cloud.put('/wordvault-vault.json.gz', data),
    quota: (cloud) => { cloud.failNext = { '/2/files/upload': [409, 'path/insufficient_space/..'] }; },
    throttle: (cloud) => { cloud.failNext = { '/2/files/download': [429, 'too_many_requests/..'] }; },
  },
];

let cloud;
let a;
let current;
function device(name) {
  const created = use(createDevice(name));
  created.browser.signIn = (url, interactive) => cloud.signIn(url, interactive);
  return created;
}
function start(t, which) {
  current = which;
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  OAUTH_CLIENT_IDS[which.id] = which.clientId;
  cloud = which.create();
  globalThis.fetch = cloud.fetch;
  a = device('A');
}
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(OAUTH_CLIENT_IDS, placeholders);
});
beforeEach(() => {
  current = null;
});
async function connect(one) {
  use(one);
  const connection = await current.provider.connect();
  await setSyncConfig({ mode: 'cloud', providerId: current.id, connection, connectedAt: Date.now() });
  return connection;
}
const session = async () => ({ connection: (await getSyncConfig()).connection, update: async () => {} });
const stored = async () => decodeDocument(current.stored(cloud));

for (const which of CASES) {
  test(`${which.id}: registered, and without a client ID it says the setup is missing`, async (t) => {
    start(t, which);
    assert.equal(getSyncProvider(which.id), which.provider);
    assert.ok(which.provider.origins().every((origin) => /^https:\/\/[a-z.]+\/\*$/.test(origin)));
    OAUTH_CLIENT_IDS[which.id] = placeholders[which.id];
    await assert.rejects(which.provider.connect(), { code: 'sync_config' });
    assert.equal(a.browser.signIns.length, 0);
    assert.equal(cloud.requests.length, 0);
  });

  test(`${which.id}: signing in uses a code with PKCE and no secret, and gets a refresh token`, async (t) => {
    start(t, which);
    const connection = await connect(a);
    const asked = cloud.auth.lastAuthorize;
    assert.deepEqual([asked.response_type, asked.client_id, asked.redirect_uri, asked.code_challenge_method], ['code', which.clientId, 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/', 'S256']);
    assert.match(asked.code_challenge, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(asked.state.length >= 16);
    // The stand-in only redeems the code if the verifier fits the challenge; it refuses a secret.
    const exchange = cloud.auth.tokenRequests[0];
    assert.deepEqual([exchange.grant_type, exchange.client_id, exchange.redirect_uri, 'client_secret' in exchange], ['authorization_code', which.clientId, asked.redirect_uri, false]);
    assert.ok(exchange.code_verifier.length >= 43);
    assert.deepEqual([typeof connection.accessToken, typeof connection.refreshToken, connection.expiresAt], ['string', 'string', T0 + 3599_000]);
    assert.equal(a.browser.signIns[0].interactive, true);
  });

  test(`${which.id}: first synchronisation creates the file; the next device merges with it`, async (t) => {
    start(t, which);
    await connect(a);
    for (const text of ['book', 'door']) await addEntry(word(text));
    assert.equal((await syncNow({ sleep })).state, 'idle');
    assert.deepEqual([...current.stored(cloud).subarray(0, 2)], [0x1f, 0x8b], 'stored as gzip bytes');
    assert.deepEqual(Object.keys((await stored()).e).sort(), ['en|tr|book', 'en|tr|door']);

    const b = device('B');
    await connect(b);
    await addEntry(word('tree'));
    assert.deepEqual((await syncNow({ sleep })).lastChanges, { added: 2, updated: 0, removed: 0 });
    use(a);
    await syncNow({ sleep });
    assert.deepEqual((await listEntries()).map((entry) => entry.text).sort(), ['book', 'door', 'tree']);
    const mine = serializeDocument(await readLocalDocument());
    use(b);
    assert.equal(serializeDocument(await readLocalDocument()), mine);
  });

  test(`${which.id}: a copy another device changed in the meantime is not overwritten`, async (t) => {
    start(t, which);
    await connect(a);
    await addEntry(word('book'));
    await syncNow({ sleep });
    await addEntry(word('door'));
    const theirs = await encodeDocument({ v: 1, e: { ...(await readLocalDocument()).e, 'en|tr|sea': { w: 'sea', t: 'deniz', sl: 'en', tl: 'tr', u: T0, r: 1 } } });
    cloud.beforeUpload = () => which.put(cloud, theirs);
    const sleeps = [];
    const status = await syncNow({ sleep: async (ms) => sleeps.push(ms) });
    assert.equal(status.state, 'idle');
    assert.deepEqual(sleeps, [500], 'the conditional write failed once and was repeated after merging');
    assert.deepEqual(Object.keys((await stored()).e).sort(), ['en|tr|book', 'en|tr|door', 'en|tr|sea']);
    assert.deepEqual((await listEntries()).map((entry) => entry.text).sort(), ['book', 'door', 'sea']);
  });

  test(`${which.id}: two devices creating the file at the same moment end up with one`, async (t) => {
    start(t, which);
    await connect(a);
    await addEntry(word('book'));
    // The other device's file appears after A found none and before A creates its own.
    cloud.beforeUpload = async () => which.put(cloud, await encodeDocument({ v: 1, e: { 'en|tr|tree': { w: 'tree', t: 'ağaç', sl: 'en', tl: 'tr', u: T0, r: 1 } } }));
    assert.equal((await syncNow({ sleep })).state, 'idle');
    assert.deepEqual(Object.keys((await stored()).e).sort(), ['en|tr|book', 'en|tr|tree']);
  });

  test(`${which.id}: an access token that ran out is renewed with the refresh token, without a window`, async (t) => {
    start(t, which);
    const first = await connect(a);
    await addEntry(word('book'));
    await syncNow({ sleep });
    t.mock.timers.setTime(T0 + HOUR + 1000);
    cloud.auth.validTokens.clear(); // the old access token is no longer accepted
    await addEntry(word('door'));
    assert.equal((await syncNow({ sleep })).state, 'idle');
    assert.equal(a.browser.signIns.length, 1, 'no second sign-in');
    const renewal = cloud.auth.tokenRequests.at(-1);
    assert.deepEqual([renewal.grant_type, renewal.refresh_token, renewal.client_id, 'client_secret' in renewal], ['refresh_token', first.refreshToken, which.clientId, false]);
    const kept = (await getSyncConfig()).connection;
    assert.notEqual(kept.accessToken, first.accessToken);
    assert.equal(kept.expiresAt, T0 + HOUR + 1000 + 3599_000);
    assert.equal(Object.keys((await stored()).e).length, 2);
  });

  test(`${which.id}: no room, or "slow down": told apart, and the vault stays whole`, async (t) => {
    start(t, which);
    await connect(a);
    await addEntry(word('book'));
    which.quota(cloud);
    let status = await syncNow({ sleep });
    assert.deepEqual([status.state, status.error.code], ['error', 'sync_quota']);
    assert.deepEqual((await listEntries()).map((entry) => entry.text), ['book']);
    assert.equal((await syncNow({ sleep })).state, 'idle', '"Sync now" tries again');

    which.throttle(cloud);
    await addEntry(word('door'));
    status = await syncNow({ sleep });
    assert.deepEqual([status.state, status.error.code], ['waiting', 'network']);
    assert.equal((await syncNow({ sleep })).state, 'idle');
  });

  test(`${which.id}: disconnecting leaves the file unless asked to delete it`, async (t) => {
    start(t, which);
    await connect(a);
    await addEntry(word('book'));
    await syncNow({ sleep });
    await which.provider.disconnect(await session(), { deleteRemote: false });
    assert.ok(current.stored(cloud));
    await connect(a);
    await which.provider.disconnect(await session(), { deleteRemote: true });
    assert.equal(current.stored(cloud), null);
    // deleting what is not there is not an error
    await connect(a);
    await which.provider.disconnect(await session(), { deleteRemote: true });
  });
}

test('onedrive: asks for the application folder only, and offline access to stay connected', async (t) => {
  start(t, CASES[0]);
  await connect(a);
  const asked = cloud.auth.lastAuthorize;
  assert.deepEqual([asked.scope, asked.response_mode, asked.prompt], ['Files.ReadWrite.AppFolder offline_access', 'query', 'select_account']);
  assert.equal(new URL(a.browser.signIns[0].url).origin + new URL(a.browser.signIns[0].url).pathname, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  await addEntry(word('book'));
  await syncNow({ sleep });
  assert.ok(cloud.requests.every((request) => !request.includes('graph.microsoft.com') || request.includes('/me/drive/special/approot')), 'every Graph request stays inside the application folder');
  assert.deepEqual(await onedrive.accountInfo(await session()), { name: 'Test User', email: '' });
});

test('onedrive: the content is fetched from the download address without sending the token there', async (t) => {
  start(t, CASES[0]);
  await connect(a);
  await addEntry(word('book'));
  await syncNow({ sleep });
  await syncNow({ sleep });
  assert.ok(cloud.requests.some((request) => request.startsWith('GET download.onedrive.test/item1')));
  assert.equal(cloud.tokenSentToDownloadHost, false);
});

test('onedrive: every refresh replaces the refresh token; a day later the sign-in is repeated silently', async (t) => {
  start(t, CASES[0]);
  const first = await connect(a);
  await addEntry(word('book'));
  await syncNow({ sleep });
  t.mock.timers.setTime(T0 + HOUR + 1000);
  await syncNow({ sleep });
  const second = (await getSyncConfig()).connection;
  assert.notEqual(second.refreshToken, first.refreshToken, 'the new refresh token is the one kept');

  // 24 hours on, Microsoft no longer takes the refresh token (single-page application rule).
  t.mock.timers.setTime(T0 + 25 * HOUR);
  cloud.auth.refreshTokens.clear();
  cloud.auth.validTokens.clear();
  await addEntry(word('door'));
  assert.equal((await syncNow({ sleep })).state, 'idle');
  assert.equal(a.browser.signIns.length, 2);
  assert.deepEqual([a.browser.signIns[1].interactive, new URL(a.browser.signIns[1].url).searchParams.get('prompt')], [false, 'none']);
  assert.equal(Object.keys((await stored()).e).length, 2);

  // And when the user is no longer signed in to Microsoft either: connect again.
  t.mock.timers.setTime(T0 + 50 * HOUR);
  cloud.auth.refreshTokens.clear();
  cloud.auth.validTokens.clear();
  cloud.auth.signedIn = false;
  await addEntry(word('tree'));
  const status = await syncNow({ sleep });
  assert.deepEqual([status.state, status.error.code], ['error', 'sync_auth']);
  assert.equal((await listEntries()).length, 3, 'the vault is untouched');
});

test('dropbox: asks for content access in its application folder and a refresh token that lasts', async (t) => {
  start(t, CASES[1]);
  await connect(a);
  const asked = cloud.auth.lastAuthorize;
  assert.deepEqual([asked.scope, asked.token_access_type], ['files.content.read files.content.write', 'offline']);
  assert.equal(new URL(a.browser.signIns[0].url).origin + new URL(a.browser.signIns[0].url).pathname, 'https://www.dropbox.com/oauth2/authorize');
  await addEntry(word('book'));
  await syncNow({ sleep });
  await addEntry(word('door'));
  await syncNow({ sleep });
  const uploads = cloud.args.filter((arg) => arg?.mode);
  assert.deepEqual(uploads.map((arg) => [arg.path, typeof arg.mode === 'string' ? arg.mode : arg.mode['.tag'], arg.autorename, arg.strict_conflict]), [
    ['/wordvault-vault.json.gz', 'add', false, true],
    ['/wordvault-vault.json.gz', 'update', false, true],
  ]);
  assert.equal(await dropbox.accountInfo(await session()), null, 'whose account it is is not asked: that would need one more permission');
});

test('dropbox: access withdrawn in Dropbox: the user is asked to connect again', async (t) => {
  start(t, CASES[1]);
  await connect(a);
  await addEntry(word('book'));
  await syncNow({ sleep });
  cloud.auth.validTokens.clear();
  cloud.auth.refreshTokens.clear(); // the user removed the app in their Dropbox settings
  await addEntry(word('door'));
  const status = await syncNow({ sleep });
  assert.deepEqual([status.state, status.error.code], ['error', 'sync_auth']);
  assert.equal(a.browser.signIns.length, 1, 'no window is opened behind the user\'s back');
  assert.equal((await listEntries()).length, 2);
});

test('dropbox: disconnecting gives the access back', async (t) => {
  start(t, CASES[1]);
  await connect(a);
  await dropbox.disconnect(await session(), { deleteRemote: false });
  assert.equal(cloud.revoked, 1);
});
