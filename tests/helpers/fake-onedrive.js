// Microsoft's side, in memory: sign-in, the token endpoint, and the part of Microsoft Graph the
// OneDrive provider uses (the application folder "approot").

import { createFakeOAuth, json } from './fake-oauth.js';

const graphError = (status, code, message = code) => json(status, { error: { code, message } });

export function createFakeOneDrive({ downloadBase = 'https://download.onedrive.test' } = {}) {
  const auth = createFakeOAuth({ rotates: true, offlineParam: false });
  let etag = 0;
  const drive = {
    auth,
    /** The one file in the application folder: { data, eTag } or null. */
    file: null,
    folderExists: false,
    requests: [],
    /** One-off answers by request prefix, e.g. { 'PUT': [507, 'quotaLimitReached'] }. */
    failNext: {},
    beforeUpload: null,
    /** Set if a request to the download host carried the access token (it must not). */
    tokenSentToDownloadHost: false,
    signIn: (url, interactive) => auth.signIn(url, interactive),
    put(data) {
      drive.file = { id: 'item1', data, eTag: `"{E${++etag}},1"` };
      drive.folderExists = true;
      return drive.file;
    },
    async fetch(input, init = {}) {
      const url = new URL(typeof input === 'string' ? input : input.url);
      const method = (init.method || 'GET').toUpperCase();
      drive.requests.push(`${method} ${url.host}${decodeURIComponent(url.pathname)}${url.search}`);
      if (url.host === 'login.microsoftonline.com' && url.pathname === '/common/oauth2/v2.0/token') return auth.token(init);
      if (url.origin === new URL(downloadBase).origin && url.pathname.startsWith(`${new URL(downloadBase).pathname.replace(/\/$/, '')}/item`)) {
        if (new Headers(init.headers).get('Authorization')) drive.tokenSentToDownloadHost = true;
        return drive.file ? new Response(drive.file.data, { status: 200 }) : new Response('', { status: 404 });
      }
      if (url.host !== 'graph.microsoft.com') throw new TypeError(`fake onedrive: unexpected host ${url.host}`);
      if (!auth.validTokens.has(auth.bearer(init))) return graphError(401, 'InvalidAuthenticationToken', 'Access token has expired or is not yet valid.');
      for (const [prefix, [status, code]] of Object.entries(drive.failNext)) {
        if (`${method} ${url.pathname}`.startsWith(prefix)) {
          delete drive.failNext[prefix];
          return graphError(status, code);
        }
      }
      const path = decodeURIComponent(url.pathname);
      const root = '/v1.0/me/drive/special/approot';
      const item = `${root}:/wordvault-vault.json.gz`;
      if (method === 'GET' && path === root) return drive.folderExists ? json(200, { id: 'folder1', createdBy: { user: { displayName: 'Test User' } } }) : graphError(404, 'itemNotFound');
      if (method === 'GET' && path === item) {
        if (!drive.file) return graphError(404, 'itemNotFound');
        return json(200, { id: drive.file.id, eTag: drive.file.eTag, '@microsoft.graph.downloadUrl': `${downloadBase}/item1?tempauth=abc` });
      }
      if (method === 'DELETE' && path === item) {
        if (!drive.file) return graphError(404, 'itemNotFound');
        drive.file = null;
        return new Response(null, { status: 204 });
      }
      if (method === 'PUT' && path === `${item}:/content`) {
        if (drive.beforeUpload) { const slipIn = drive.beforeUpload; drive.beforeUpload = null; await slipIn(); }
        const ifMatch = new Headers(init.headers).get('If-Match');
        if (url.searchParams.get('@microsoft.graph.conflictBehavior') === 'fail' && drive.file) return graphError(409, 'nameAlreadyExists');
        if (ifMatch && (!drive.file || drive.file.eTag !== ifMatch)) return graphError(412, 'resourceModified', 'ETag does not match current item\'s value');
        const created = !drive.file;
        const stored = drive.put(new Uint8Array(await new Response(init.body).arrayBuffer()));
        return json(created ? 201 : 200, { id: stored.id, eTag: stored.eTag });
      }
      return graphError(400, 'invalidRequest', `fake graph does not know ${method} ${path}`);
    },
  };
  return drive;
}
