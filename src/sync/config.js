// Developer configuration of synchronisation.
//
// Google Drive only talks to applications that are registered with Google. Registering is done
// once by whoever builds and publishes the extension; SETUP-OAUTH.md in the repository says how.
// The client ID that comes out of it goes here. They are not secrets
// (every installed copy of the extension contains them); there is no client secret anywhere.
//
// The IDs can be written here, or, to keep them out of the repository, into `oauth.local.json`
// next to build.js (ignored by git; see oauth.local.example.json): the build then puts them into
// the built copy of this file and leaves this one alone.
//
// While an ID is still the placeholder, the settings page shows that provider as "setup missing"
// and says so when it is chosen. Everything else works without any of this.

export const OAUTH_CLIENT_IDS = {
  gdrive: 'YOUR_GOOGLE_CLIENT_ID',
};

/** The name of the synchronised file with every provider that stores it as a file. */
export const SYNC_FILE_NAME = 'wordvault-vault.json.gz';

/** @returns {string} The client ID for a provider, or '' while it has not been filled in. */
export function clientIdFor(providerId) {
  const id = String(OAUTH_CLIENT_IDS[providerId] || '').trim();
  return id === '' || id.startsWith('YOUR_') ? '' : id;
}
