// Google's side of the conversation, in memory: the sign-in redirect and the part of the Drive
// API that the provider uses. Installed in place of fetch(); it answers the way the real API
// documents, so the tests check the requests the provider really makes.

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const error = (status, reason, message = reason) => json(status, { error: { code: status, message, errors: [{ reason, message }] } });

export function createFakeDrive() {
  let nextId = 1;
  let nextToken = 1;
  const drive = {
    /** @type {{ id: string, name: string, parents: string[], data: Uint8Array, version: number, createdTime: string }[]} */
    files: [],
    /** Access tokens Google would accept right now. */
    validTokens: new Set(),
    user: { displayName: 'Test User', emailAddress: 'tester@example.com' },
    /** Every request made: "METHOD path?query". */
    requests: [],
    revoked: [],
    /** One-off answers by request prefix, e.g. { 'PATCH /upload': [403, 'storageQuotaExceeded'] }. */
    failNext: {},
    /** Called just before an upload is applied: another device slipping in. */
    beforeUpload: null,
    /** Whether Google still has a session for the user (silent sign-in works). */
    signedIn: true,
    grantToken() {
      const token = `ya29.test-${nextToken++}`;
      drive.validTokens.add(token);
      return token;
    },
    /** The sign-in window: what Google does with the authorize request. */
    signIn(url, interactive) {
      drive.lastAuthorize = Object.fromEntries(url.searchParams);
      const back = new URL(url.searchParams.get('redirect_uri'));
      const state = url.searchParams.get('state');
      if (url.searchParams.get('prompt') === 'none' && !drive.signedIn) {
        back.hash = new URLSearchParams({ error: 'interaction_required', state }).toString();
        return back.href;
      }
      if (!interactive && url.searchParams.get('prompt') !== 'none') throw new Error('User interaction required.');
      back.hash = new URLSearchParams({ access_token: drive.grantToken(), token_type: 'Bearer', expires_in: '3599', scope: url.searchParams.get('scope'), state }).toString();
      return back.href;
    },
    put(data, { name = 'wordvault-vault.json.gz', createdTime } = {}) {
      const file = { id: `file${nextId++}`, name, parents: ['appDataFolder'], data, version: 1, createdTime: createdTime || new Date(Date.now() + drive.files.length).toISOString() };
      drive.files.push(file);
      return file;
    },
    async fetch(input, init = {}) {
      const url = new URL(typeof input === 'string' ? input : input.url);
      const method = (init.method || 'GET').toUpperCase();
      const path = `${method} ${url.pathname}`;
      drive.requests.push(`${path}${url.search}`);
      if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/revoke') {
        drive.revoked.push(url.searchParams.get('token'));
        drive.validTokens.delete(url.searchParams.get('token'));
        return new Response('{}', { status: 200 });
      }
      if (url.hostname !== 'www.googleapis.com') throw new TypeError(`fake drive: unexpected host ${url.hostname}`);
      const token = String(new Headers(init.headers).get('Authorization') || '').replace(/^Bearer /, '');
      if (!drive.validTokens.has(token)) return error(401, 'authError', 'Invalid Credentials');
      for (const [prefix, [status, reason]] of Object.entries(drive.failNext)) {
        if (path.startsWith(prefix)) {
          delete drive.failNext[prefix];
          return error(status, reason);
        }
      }

      const fileId = (url.pathname.match(/\/files\/([^/]+)$/) || [])[1];
      const file = fileId ? drive.files.find((candidate) => candidate.id === decodeURIComponent(fileId)) : null;
      const shown = (item) => ({ id: item.id, version: String(item.version), createdTime: item.createdTime });

      if (path === 'GET /drive/v3/about') return json(200, { user: drive.user });
      if (path === 'GET /drive/v3/files') {
        if (url.searchParams.get('spaces') !== 'appDataFolder') return error(400, 'invalid', 'this test only knows the application data folder');
        const name = (url.searchParams.get('q').match(/name = '([^']+)'/) || [])[1];
        const found = drive.files.filter((item) => item.name === name).sort((a, b) => a.createdTime.localeCompare(b.createdTime));
        return json(200, { files: found.map(shown) });
      }
      if (method === 'GET' && fileId) {
        if (!file) return error(404, 'notFound');
        return url.searchParams.get('alt') === 'media' ? new Response(file.data, { status: 200 }) : json(200, shown(file));
      }
      if (method === 'DELETE' && fileId) {
        if (!file) return error(404, 'notFound');
        drive.files = drive.files.filter((item) => item !== file);
        return new Response(null, { status: 204 });
      }
      if (path === 'POST /upload/drive/v3/files' && url.searchParams.get('uploadType') === 'multipart') {
        if (drive.beforeUpload) { const slipIn = drive.beforeUpload; drive.beforeUpload = null; await slipIn(); }
        // multipart/related: a JSON part and the content
        const type = new Headers(init.headers).get('Content-Type');
        const boundary = (type.match(/boundary=(.+)$/) || [])[1];
        const body = new Uint8Array(await new Response(init.body).arrayBuffer());
        const text = new TextDecoder('latin1').decode(body);
        const parts = text.split(`--${boundary}`).slice(1, -1);
        const metadata = JSON.parse(parts[0].slice(parts[0].indexOf('\r\n\r\n') + 4));
        const contentStart = text.indexOf('\r\n\r\n', text.indexOf(`--${boundary}`, text.indexOf(`--${boundary}`) + 1)) + 4;
        const contentEnd = text.lastIndexOf(`\r\n--${boundary}--`);
        if (metadata.parents?.[0] !== 'appDataFolder') return error(403, 'insufficientPermissions', 'only the application data folder may be written');
        return json(200, shown(drive.put(body.slice(contentStart, contentEnd), { name: metadata.name })));
      }
      if (method === 'PATCH' && url.pathname.startsWith('/upload/drive/v3/files/')) {
        if (drive.beforeUpload) { const slipIn = drive.beforeUpload; drive.beforeUpload = null; await slipIn(); }
        if (!file) return error(404, 'notFound');
        file.data = new Uint8Array(await new Response(init.body).arrayBuffer());
        file.version += 1;
        return json(200, shown(file));
      }
      return error(404, 'notFound', `fake drive does not know ${path}`);
    },
  };
  return drive;
}
