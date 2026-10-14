# OAuth setup for the cloud providers

Wordvault's "Connect a cloud account" option (Google Drive, OneDrive, Dropbox) only works if the
extension has been **registered as an application** with that provider. Whoever builds and distributes
the extension does the registration once; users do not have to do anything. The **client ID** that
comes out of the registration goes into `src/sync/config.js`.

What works without this setup: **This device only**, **Browser sync** and **My own server**. A provider
that has not been set up shows on the settings page with a "Not configured" badge on its card.

- There is **no client secret** in the package, and there must not be one. If a step below shows a
  secret, do not write it anywhere.
- A client ID is not secret; it is in every copy of the extension.
- The scopes asked for are the narrowest there are: with every provider, only the app's own folder.

## Where to put the client ID

There are two ways:

- **Without it entering the repository (recommended):** copy `oauth.local.example.json` at the
  repository's root to `oauth.local.json` and write the IDs there. That file is in `.gitignore` and is
  not committed. `node build.js` writes the IDs only into the built copy under `dist/`; the file in
  `src/` keeps its placeholders.
- **Directly in the source:** replace the placeholder in `src/sync/config.js`. The ID then enters the
  repository.

Wherever "write it into `src/sync/config.js`" is said below, either of the two is meant. A client ID is
not a secret (it can be read in every distributed copy of the extension); this is not about protecting
it but about keeping personal identifiers out of the repository. The real protection is that the
provider's registration allows only the extension's redirect addresses and that the package contains no
client secret.

## 1. The extension's ID and redirect addresses

After sign-in, the provider sends the user back to the extension. That address derives from the
extension's ID, so the ID is fixed (Chrome: the manifest's `key`; Firefox: `gecko.id`):

| Browser | Extension ID | Redirect address |
| --- | --- | --- |
| Chrome, Edge and other Chromium-based browsers | `caggefgbpnebadhdlcaijbfcgdocednk` | `https://caggefgbpnebadhdlcaijbfcgdocednk.chromiumapp.org/` |
| Firefox, Zen | `wordvault@phobby` | `https://4e1e83b4f82a40a825858d9d7610ba8b8558e84e.extensions.allizom.org/` |
| Firefox, Zen (Google only) | the same | `http://127.0.0.1/mozoauth2/4e1e83b4f82a40a825858d9d7610ba8b8558e84e` |

You can see the addresses yourself: open the settings page and type `chrome.identity.getRedirectURL()`
into the developer console. The trailing `/` is part of the address; providers compare the address
character by character.

**About the Chrome ID:** the `key` in `manifest.chrome.json` is only a public key and fixes the ID of
the unpacked extension (loaded in developer mode). Its private key was not kept; it is not needed. If
you publish the extension on the Chrome Web Store, the store assigns its own key and ID: then put the
public key from the store's developer dashboard into the `key` field (for the same ID locally), leave
the `key` field out of the uploaded package, and add the new ID's redirect address to the registrations
below.

**About the Firefox address:** for providers like Google that say "I only redirect to a domain you
own", Firefox also accepts the `127.0.0.1` form (Firefox 86+). Wordvault uses that form for Google only.

## 2. Google Drive

Scope used: `https://www.googleapis.com/auth/drive.appdata` (only the app's hidden data folder; the
user's files are not seen).

1. Create a new project in the [Google Cloud Console](https://console.cloud.google.com/).
2. Under **APIs & Services → Library**, enable the **Google Drive API**.
3. In **Google Auth Platform** (formerly the OAuth consent screen):
   - **Branding:** the app name (Wordvault) and a support e-mail.
   - **Audience:** user type **External**. While the publishing status is "Testing", only accounts you
     added to **Test users** can connect; "Publish app" opens it to everyone.
   - **Data access:** add the `.../auth/drive.appdata` scope. It is in the "non-sensitive" class.
4. **Clients → Create client**:
   - **Application type: Web application.**
   - **Authorized redirect URIs:** add the Chrome address and Firefox's `127.0.0.1` address from the
     table above.
   - "Authorized JavaScript origins" can stay empty.
5. Write the **Client ID** (`….apps.googleusercontent.com`) into `src/sync/config.js` as the `gdrive`
   value. The **client secret** shown on the same screen **is not used**; do not write it anywhere.
6. Rebuild with `node build.js` and reload the extension.

**Why "Web application", and why without a secret:** it is the only client type that can redirect to an
extension (a `chromiumapp.org` or `127.0.0.1` address). For this type Google asks for the client secret
in the code-for-token exchange even with PKCE, and a secret put into a package is no secret. So
Wordvault uses the **implicit flow** with Google (`response_type=token`): no secret is needed, and in
return no refresh token is given.

**What follows from it:** the access token is valid for about an hour. When it expires, Wordvault
repeats the same request silently, without opening a window (`prompt=none`); this works as long as the
user stays signed in to Google in that browser. If they signed out, sync stops and the settings page
says "access was revoked or has expired; reconnect". The vault stays complete locally in the meantime.

**Where the file is:** in Drive's hidden "app data" folder, named `wordvault-vault.json.gz`. It does not
show among the user's files; it can be seen and deleted in Drive under **Settings → Manage apps →
Wordvault**.

**Policy:** under the "Limited Use" terms of the Google API Services User Data Policy, the data is used
only to provide the user-facing feature (syncing the vault), is not passed on, is not used for
advertising and is not read by humans. Wordvault has no server, so the data goes from the browser
straight to the user's Drive.

## 3. OneDrive (Microsoft)

Scopes used: `Files.ReadWrite.AppFolder` (only the app's own folder) and `offline_access` (to stay
connected).

1. [Microsoft Entra admin center](https://entra.microsoft.com/) → **Applications → App registrations →
   New registration**.
   - **Name:** Wordvault. (The folder in OneDrive takes this name: `Apps/Wordvault`.)
   - **Supported account types:** "Accounts in any organizational directory and personal Microsoft
     accounts". (Wordvault uses the `common` endpoint; a registration open to personal accounts only does
     not work with that endpoint.)
   - **Redirect URI:** choose **Single-page application (SPA)** as the platform and enter the Chrome
     address from section 1.
2. On the **Authentication** page, add the Firefox address (`…extensions.allizom.org/`) to the same
   **Single-page application** platform. Do not tick the "Implicit grant" boxes.
3. **API permissions → Add a permission → Microsoft Graph → Delegated permissions:**
   `Files.ReadWrite.AppFolder` and `offline_access`. The automatically added `User.Read` can be removed.
4. **Certificates & secrets** stays empty: do not create a client secret.
5. Write the **Application (client) ID** from the **Overview** page into `src/sync/config.js` as the
   `onedrive` value and rebuild.

**Why "Single-page application":** the token request is made from inside the browser and carries an
`Origin` header. Microsoft does the secret-less (PKCE) code-for-token exchange for cross-origin requests
only for redirect addresses of this type; with an address registered as "Web" or "Mobile and desktop"
the error is "AADSTS9002326/9002327".

**What follows from it:** for this type the refresh token is valid for 24 hours. When it expires,
Wordvault repeats the sign-in without opening a window (`prompt=none`); this works as long as the user
stays signed in to Microsoft in that browser. Otherwise the settings page says "reconnect".

**Where the file is:** in the user's OneDrive, in the `Apps → Wordvault` folder, named
`wordvault-vault.json.gz`. The folder is created by itself on the first write.

**Policy:** under the Microsoft API Terms of Use and the Microsoft Graph data use terms, the data is used
only for the function the user asked for; Wordvault does not take the data to its own side.

## 4. Dropbox

Scopes used: `files.content.read` and `files.content.write`, only in the app's own folder.

1. [Dropbox App Console](https://www.dropbox.com/developers/apps) → **Create app**.
   - **Choose an API:** Scoped access.
   - **Type of access:** **App folder**. (Do not choose Full Dropbox.)
   - **Name:** a unique name (for example `Wordvault-vault`). The folder in Dropbox takes this name:
     `Apps/<name>`.
2. **Settings** tab → **OAuth 2**:
   - **Redirect URIs:** add the Chrome and Firefox (`…extensions.allizom.org/`) addresses from section 1.
   - **Allow public clients (Implicit Grant & PKCE):** Allow.
3. **Permissions** tab: tick `files.content.write` and `files.content.read`, then **Submit**.
   (`account_info.read` is on by default; Wordvault does not use it, so the connected account's name
   does not show in the settings.)
4. Write the **App key** from the **Settings** tab into `src/sync/config.js` as the `dropbox` value and
   rebuild. **The app secret is not used.**
5. While the app is in "Development", a limited number of users can connect; to open it to everyone,
   **Apply for production** on the same page.

With PKCE, Dropbox asks for no secret and gives a refresh token that does not expire with
`token_access_type=offline`; the connection lasts until the user disconnects (or removes the app in
their Dropbox settings).

**Where the file is:** in the user's Dropbox, in the `Apps → <app name>` folder, named
`wordvault-vault.json.gz`.

**Policy:** under the Dropbox Developer Terms & Conditions and the Developer Branding Guide, the data is
used only for the user-facing function; the word "Dropbox" is not used at the start of the app's name
or in its logo.

## 5. Testing the setup

1. Reload the extension and open the settings page.
2. **Sync and backup → Connect a cloud account**: the "Not configured" badge should no longer show on
   the provider's card.
3. **Connect → Continue**: the browser asks for permission to reach that address, then the provider's
   sign-in window opens. After you confirm, the section shows the account, the last sync time and the
   "up to date" state.
4. Connect the same account in a second browser or on a second device: the two vaults should merge.

If the provider says "redirect_uri_mismatch" (or similar), the redirect address in the registration and
the address in section 1 are not exactly the same.
