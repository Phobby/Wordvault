// Developer configuration of synchronisation.
//
// The cloud providers only talk to applications that are registered with them. Registering is
// done once by whoever builds and publishes the extension; SETUP-OAUTH.md in the repository says
// how, provider by provider. The client IDs that come out of it go here. They are not secrets
// (every installed copy of the extension contains them); there is no client secret anywhere.
//
// While an ID is still the placeholder, the settings page shows that provider as "setup missing"
// and says so when it is chosen. Everything else works without any of this.

export const OAUTH_CLIENT_IDS = {
  gdrive: 'YOUR_GOOGLE_CLIENT_ID',
  onedrive: 'YOUR_MICROSOFT_CLIENT_ID',
  dropbox: 'YOUR_DROPBOX_APP_KEY',
};

/** The name of the synchronised file with every provider that stores it as a file. */
export const SYNC_FILE_NAME = 'wordvault-vault.json.gz';

/** @returns {string} The client ID for a provider, or '' while it has not been filled in. */
export function clientIdFor(providerId) {
  const id = String(OAUTH_CLIENT_IDS[providerId] || '').trim();
  return id === '' || id.startsWith('YOUR_') ? '' : id;
}
