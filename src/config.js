// Developer configuration: the addresses the extension points at that belong to whoever
// publishes it. Nothing here is a secret; every installed copy contains it.

/**
 * Where "Support the project" leads (a Buy Me a Coffee page, or any other service: this line
 * is the only thing to change). While it is empty or still the placeholder, every part of the
 * support UI stays hidden: the card on the settings page, the link in the toolbar popup and
 * the card on the welcome page.
 */
export const SUPPORT_URL = 'https://buymeacoffee.com/phoby';

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

/**
 * Where "Contact and feedback" sends what the user wrote: the address of the feedback receiver
 * (feedback-worker/). While it is empty or still the placeholder the form can be filled in and
 * previewed, but nothing can be sent.
 */
export const FEEDBACK_ENDPOINT = 'https://wordvault-feedback.phoby.workers.dev/feedback';

/**
 * @returns {string} The address feedback is posted to, or '' when there is none. Only https;
 *          plain http is accepted for this computer alone (a receiver run locally for testing).
 */
export function feedbackEndpoint(value = FEEDBACK_ENDPOINT) {
  const text = String(value || '').trim();
  if (text === '' || /YOUR_/i.test(text)) return '';
  try {
    const url = new URL(text);
    const local = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    return url.protocol === 'https:' || local ? url.href : '';
  } catch {
    return '';
  }
}
