// A small WebDAV server for tests: one folder tree in memory, HTTP Basic authentication, ETags
// and conditional PUT, the way Nextcloud and Apache mod_dav behave for the requests Wordvault
// makes. It is a real HTTP server, so the provider is tested with real requests.

import { createHash } from 'node:crypto';
import http from 'node:http';

/**
 * @param {Object} options
 * @param {string} options.user
 * @param {string} options.password
 * @param {boolean} [options.etagOnPut]  Whether the answer to PUT names the new ETag (not all servers do).
 * @returns {Promise<{ origin: string, files: Map<string, Buffer>, folders: Set<string>, requests: string[], full: boolean, close(): Promise<void> }>}
 */
export async function startWebdavServer({ user, password, etagOnPut = true }) {
  const state = { files: new Map(), folders: new Set(['/', '/dav/']), requests: [], full: false };
  const etagOf = (data) => `"${createHash('sha1').update(data).digest('hex')}"`;
  const expected = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

  const server = http.createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    state.requests.push(`${request.method} ${path}`);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const answer = (status, body = '', headers = {}) => response.writeHead(status, headers).end(body);

    if (request.headers.authorization !== expected) return answer(401, 'Unauthorized', { 'WWW-Authenticate': 'Basic realm="dav"' });
    const parent = path.slice(0, path.lastIndexOf('/', path.length - 2) + 1);

    if (request.method === 'PROPFIND') {
      if (!state.folders.has(path) && !state.files.has(path)) return answer(404, 'Not Found');
      return answer(207, `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${path}</d:href></d:response></d:multistatus>`, { 'Content-Type': 'application/xml' });
    }
    if (request.method === 'MKCOL') {
      if (state.folders.has(path)) return answer(405, 'Method Not Allowed');
      if (!state.folders.has(parent)) return answer(409, 'Conflict');
      state.folders.add(path);
      return answer(201);
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      const data = state.files.get(path);
      if (!data) return answer(404, 'Not Found');
      return answer(200, request.method === 'HEAD' ? '' : data, { ETag: etagOf(data), 'Content-Type': 'application/gzip' });
    }
    if (request.method === 'DELETE') {
      if (!state.files.has(path)) return answer(404, 'Not Found');
      state.files.delete(path);
      return answer(204);
    }
    if (request.method === 'PUT') {
      if (!state.folders.has(parent)) return answer(409, 'Conflict');
      if (state.full) return answer(507, 'Insufficient Storage');
      const stored = state.files.get(path);
      if (request.headers['if-none-match'] === '*' && stored) return answer(412, 'Precondition Failed');
      if (request.headers['if-match'] && (!stored || etagOf(stored) !== request.headers['if-match'])) return answer(412, 'Precondition Failed');
      const data = Buffer.concat(chunks);
      state.files.set(path, data);
      return answer(stored ? 204 : 201, '', etagOnPut ? { ETag: etagOf(data) } : {});
    }
    return answer(405, 'Method Not Allowed');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return Object.assign(state, {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  });
}
