// Developer configuration: the addresses the extension points at that belong to whoever
// publishes it. Nothing here is a secret; every installed copy contains it.

/**
 * Where "Support the project" leads (a Buy Me a Coffee page, or any other service: this line
 * is the only thing to change). While it is empty or still the placeholder, every part of the
 * support UI stays hidden: the card on the settings page, the link in the toolbar popup and
 * the card on the welcome page.
 */
export const SUPPORT_URL = 'https://buymeacoffee.com/YOUR_PAGE';

/** @returns {string} The address to link to, or '' when there is none to show. */
export function supportUrl(value = SUPPORT_URL) {
  const text = String(value || '').trim();
  if (text === '' || /YOUR_/i.test(text)) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'https:' ? url.href : ''; // never http:, never javascript:
  } catch {
    return '';
  }
}
