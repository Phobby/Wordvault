# Sync setup: Google Drive and WebDAV

Wordvault can keep the vault in step across devices in four ways: **This device only** (nothing is
connected), **Browser sync** (`storage.sync`), **Google Drive**, and **My own server** (WebDAV or a
simple HTTP endpoint). Only Google Drive needs anything from whoever builds and publishes the
extension: an application registered with Google. Users do not have to do anything.

- There is **no client secret** in the package, and there must not be one. If a step below shows a
  secret, do not write it anywhere.
- A client ID is not secret; it is in every copy of the extension.
- The only scope asked for is `drive.appdata`: the app's own hidden folder, not the user's files.

## 1. Where the client ID goes

- **Without it entering the repository (recommended):** copy `oauth.local.example.json` at the
  repository's root to `oauth.local.json` and write the ID there (`"gdrive": "….apps.googleusercontent.com"`).
  That file is in `.gitignore`. `node build.js` writes the ID only into the built copy under `dist/`;
  `src/sync/config.js` keeps its placeholder.
- **Directly in the source:** replace the placeholder in `src/sync/config.js`.

While the ID is the placeholder, the Google Drive card on the settings page shows "Not configured"
and nothing else is affected.

## 2. The extension's IDs and redirect addresses

After sign-in Google sends the user back to an address derived from the extension's ID; the browser
intercepts it. Google compares it character by character (the trailing `/` included).

| Browser | Extension ID | Redirect address to register |
| --- | --- | --- |
| Chrome (published) | `mdkccpldchknchmdappapkhccbdpholk` (the Item ID in the Chrome Web Store developer dashboard) | `https://mdkccpldchknchmdappapkhccbdpholk.chromiumapp.org/` |
| Chrome (developer mode, unpacked) | `caggefgbpnebadhdlcaijbfcgdocednk` (from the `key` in `manifest.chrome.json`) | `https://caggefgbpnebadhdlcaijbfcgdocednk.chromiumapp.org/` |
| Firefox | `wordvault@phobby` (`gecko.id` in `manifest.firefox.json`) | `http://127.0.0.1/mozoauth2/4e1e83b4f82a40a825858d9d7610ba8b8558e84e` |

- **Chrome:** the store assigns its own ID on the first upload; the published extension has that ID,
  not the developer-mode one. `tools/package.js` leaves the `key` out of the store package. After the
  first upload, add the store ID's address to the registration below. (To give your unpacked copy the
  same ID, put the store's public key into `manifest.chrome.json`'s `key`.)
- **Firefox:** the address is derived from `gecko.id`, so it stays the same as long as the ID does.
  Google only redirects to domains the developer owns or to loopback addresses, so Wordvault uses
  Firefox's `127.0.0.1` form (Firefox 86+). Check the hash on your machine: open the settings page,
  then the developer console, and run `chrome.identity.getRedirectURL()`; the hash is the first label
  of the host it returns.

## 3. Registering with Google

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. **APIs & Services → Library:** enable the **Google Drive API**.
3. **Google Auth Platform** (formerly "OAuth consent screen"):
   - **Branding:** app name **Wordvault**, a user support e-mail, the app logo, the home page, the
     **privacy policy URL** (the published `PRIVACY.md`), and the authorized domain of those pages.
   - **Audience:** user type **External**.
   - **Data access:** add `https://www.googleapis.com/auth/drive.appdata`. Google lists it among the
     **non-sensitive** scopes, which "only require basic OAuth App Verification"
     ([Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)).
4. **Clients → Create client:**
   - **Application type: Web application.**
   - **Authorized redirect URIs:** every address from the table in section 2 that you use (the store
     ID's Chrome address, the developer-mode one if you test unpacked, and Firefox's `127.0.0.1` one).
   - "Authorized JavaScript origins" can stay empty.
5. Write the **Client ID** into `oauth.local.json` (section 1). The client secret shown on the same
   screen **is not used**; do not write it anywhere.
6. **Going to production:** while the publishing status is **Testing**, only the accounts listed under
   **Test users** can connect. Before the public release press **Publish app** to move it to **In
   production**, and complete the branding verification Google asks for. Check the console for its
   current requirements; they are Google's, not ours.
7. Rebuild (`node build.js`, or `npm run package` for the store zips) and reload the extension.

**Why "Web application", and why without a secret:** it is the only client type that can redirect to
an extension (a `chromiumapp.org` or `127.0.0.1` address). For this type Google asks for the client
secret in the code-for-token exchange even with PKCE, and a secret in a package is no secret. So
Wordvault uses the **implicit flow** (`response_type=token`): no secret is needed, and no refresh
token is given. The access token is valid for about an hour; Wordvault then repeats the request
silently (`prompt=none`), which works as long as the user stays signed in to Google in that browser.
Otherwise the settings page says "reconnect"; the vault stays complete locally.

**Where the file is:** in Drive's hidden "app data" folder, as `wordvault-vault.json.gz`. It does not
show among the user's files; it can be removed in Drive under **Settings → Manage apps → Wordvault**.

**Policy:** under the Limited Use terms of the Google API Services User Data Policy, the data is used
only for the feature the user turned on (syncing the vault), is not passed on, is not used for
advertising and is not read by humans. Wordvault has no server: the data goes from the browser
straight to the user's Drive.

## 4. WebDAV and the simple HTTP endpoint (no registration)

"My own server" needs no setup by the publisher. The user enters the folder address of their WebDAV
server (Nextcloud, ownCloud …) with a user name and an app password, or the address and key of a
server that implements the small HTTP protocol in `docs/self-hosted.md`
(`tools/self-hosted-server.js` is a one-file example). Only `https` addresses are accepted (and
`localhost` / `127.0.0.1` for testing); the browser asks for permission to reach that one address
when the user connects. The credentials stay in this browser's `storage.local`.

## 5. Testing the setup

1. Reload the extension and open the settings page.
2. **Data → Sync → Connect a cloud account:** the "Not configured" badge no longer shows on the Google
   Drive card.
3. **Connect → Continue:** the browser asks to reach Google's addresses, then Google's sign-in window
   opens. Afterwards the section shows the account, the last sync time and "up to date".
4. Connect the same account in a second browser or on a second device: the two vaults merge.

If Google says `redirect_uri_mismatch`, the registered redirect address and the one in section 2 are
not exactly the same.
