// The authorization-code side of a provider, in memory: the sign-in window hands out a code
// bound to the PKCE challenge it was asked with, and the token endpoint only redeems the code
// for the verifier that fits. A client secret is refused: the extension must not have one.

const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256 = async (text) => base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
export const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/**
 * @param {Object} options
 * @param {boolean} options.rotates   Each use of a refresh token replaces it (Microsoft).
 * @param {boolean} options.offlineParam  A refresh token is only given if the authorize request
 *   said token_access_type=offline (Dropbox); otherwise if the scope has offline_access.
 */
export function createFakeOAuth({ rotates, offlineParam }) {
  let counter = 1;
  const codes = new Map();
  const auth = {
    validTokens: new Set(),
    refreshTokens: new Set(),
    /** Whether the provider still has a session for the user (silent sign-in works). */
    signedIn: true,
    lastAuthorize: null,
    /** The form of every token request, as an object. */
    tokenRequests: [],
    signIn(url, interactive) {
      const asked = Object.fromEntries(url.searchParams);
      auth.lastAuthorize = asked;
      const back = new URL(asked.redirect_uri);
      back.searchParams.set('state', asked.state);
      if (asked.prompt === 'none' && !auth.signedIn) {
        back.searchParams.set('error', 'interaction_required');
        return back.href;
      }
      if (!interactive && asked.prompt !== 'none') throw new Error('User interaction required.');
      const code = `code-${counter++}`;
      codes.set(code, { challenge: asked.code_challenge, method: asked.code_challenge_method, redirect: asked.redirect_uri, client: asked.client_id, offline: offlineParam ? asked.token_access_type === 'offline' : String(asked.scope).split(' ').includes('offline_access') });
      back.searchParams.set('code', code);
      return back.href;
    },
    grant(offline) {
      const access = `access-${counter++}`;
      auth.validTokens.add(access);
      const body = { access_token: access, token_type: 'bearer', expires_in: 3599 };
      if (offline) {
        body.refresh_token = `refresh-${counter++}`;
        auth.refreshTokens.add(body.refresh_token);
      }
      return body;
    },
    /** The token endpoint. */
    async token(init) {
      const form = Object.fromEntries(new URLSearchParams(String(init.body)));
      auth.tokenRequests.push(form);
      if ('client_secret' in form) return json(401, { error: 'invalid_client', error_description: 'public clients must not send a secret' });
      if (form.grant_type === 'authorization_code') {
        const code = codes.get(form.code);
        codes.delete(form.code);
        if (!code || code.redirect !== form.redirect_uri || code.client !== form.client_id) return json(400, { error: 'invalid_grant', error_description: 'unknown code' });
        if (code.method !== 'S256' || (await sha256(form.code_verifier || '')) !== code.challenge) return json(400, { error: 'invalid_grant', error_description: 'the code verifier does not fit the challenge' });
        return json(200, auth.grant(code.offline));
      }
      if (form.grant_type === 'refresh_token') {
        if (!auth.refreshTokens.has(form.refresh_token)) return json(400, { error: 'invalid_grant', error_description: 'the refresh token is expired or revoked' });
        if (!rotates) return json(200, auth.grant(false));
        auth.refreshTokens.delete(form.refresh_token);
        return json(200, auth.grant(true));
      }
      return json(400, { error: 'unsupported_grant_type' });
    },
    bearer: (init) => String(new Headers(init.headers).get('Authorization') || '').replace(/^Bearer /, ''),
  };
  return auth;
}
