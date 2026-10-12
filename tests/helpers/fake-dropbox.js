// Dropbox's side, in memory: sign-in, the token endpoint, and the calls the Dropbox provider
// makes against the application folder.

import { createFakeOAuth, json } from './fake-oauth.js';

const refusal = (summary) => json(409, { error_summary: summary, error: { '.tag': summary.split('/')[0] } });

export function createFakeDropbox() {
  const auth = createFakeOAuth({ rotates: false, offlineParam: true });
  let revision = 0;
  const box = {
    auth,
    /** Files in the application folder by path: { data, rev }. */
    files: new Map(),
    requests: [],
    args: [],
    revoked: 0,
    /** One-off answers by endpoint, e.g. { '/2/files/upload': [409, 'path/insufficient_space/.'] }. */
    failNext: {},
    beforeUpload: null,
    signIn: (url, interactive) => auth.signIn(url, interactive),
    put(path, data) {
      const file = { data, rev: `0${(++revision).toString(16).padStart(8, '0')}abc` };
      box.files.set(path, file);
      return file;
    },
    async fetch(input, init = {}) {
      const url = new URL(typeof input === 'string' ? input : input.url);
      const method = (init.method || 'GET').toUpperCase();
      box.requests.push(`${method} ${url.host}${url.pathname}`);
      if (url.host === 'api.dropboxapi.com' && url.pathname === '/oauth2/token') return auth.token(init);
      if (!['api.dropboxapi.com', 'content.dropboxapi.com'].includes(url.host)) throw new TypeError(`fake dropbox: unexpected host ${url.host}`);
      if (!auth.validTokens.has(auth.bearer(init))) return json(401, { error_summary: 'expired_access_token/..', error: { '.tag': 'expired_access_token' } });
      if (box.failNext[url.pathname]) {
        const [status, summary] = box.failNext[url.pathname];
        delete box.failNext[url.pathname];
        return status === 409 ? refusal(summary) : json(status, { error_summary: summary });
      }
      const headerArg = new Headers(init.headers).get('Dropbox-API-Arg');
      const arg = headerArg ? JSON.parse(headerArg) : init.body ? JSON.parse(String(init.body)) : null;
      box.args.push(arg);

      if (url.host === 'content.dropboxapi.com' && url.pathname === '/2/files/download') {
        const file = box.files.get(arg.path);
        if (!file) return refusal('path/not_found/..');
        return new Response(file.data, { status: 200, headers: { 'Dropbox-API-Result': JSON.stringify({ name: arg.path.slice(1), rev: file.rev, size: file.data.length }) } });
      }
      if (url.host === 'content.dropboxapi.com' && url.pathname === '/2/files/upload') {
        if (box.beforeUpload) { const slipIn = box.beforeUpload; box.beforeUpload = null; await slipIn(); }
        const file = box.files.get(arg.path);
        if (arg.mode === 'add' && file) return refusal('path/conflict/file/..');
        if (arg.mode?.['.tag'] === 'update' && (!file || file.rev !== arg.mode.update)) return refusal('path/conflict/file/...');
        if (arg.autorename !== false) return json(400, { error_summary: 'this test expects autorename to be off' });
        const stored = box.put(arg.path, new Uint8Array(await new Response(init.body).arrayBuffer()));
        return json(200, { name: arg.path.slice(1), rev: stored.rev });
      }
      if (url.host === 'api.dropboxapi.com' && url.pathname === '/2/files/delete_v2') {
        if (!box.files.has(arg.path)) return refusal('path_lookup/not_found/..');
        box.files.delete(arg.path);
        return json(200, { metadata: {} });
      }
      if (url.host === 'api.dropboxapi.com' && url.pathname === '/2/auth/token/revoke') {
        box.revoked += 1;
        auth.validTokens.clear();
        auth.refreshTokens.clear();
        return new Response('null', { status: 200 });
      }
      return json(400, { error_summary: `fake dropbox does not know ${url.pathname}` });
    },
  };
  return box;
}
