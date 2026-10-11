/**
 * Error with a machine-readable code. The code travels over the message channel to the UI, which
 * maps it to a localized message (see the `err*` keys in _locales).
 *
 * Codes: network, timeout, rate_limit, auth, unsupported_language, same_language, too_long,
 * no_result, empty, provider_error.
 */
export class WordvaultError extends Error {
  /**
   * @param {string} code
   * @param {string} [detail] Raw, non-localized detail (for example the provider's own message).
   */
  constructor(code, detail) {
    super(detail || code);
    this.name = 'WordvaultError';
    this.code = code;
    this.detail = detail || '';
  }
}

/** Plain object form that survives chrome.runtime messaging. */
export function serializeError(error) {
  if (error instanceof WordvaultError) return { code: error.code, detail: error.detail };
  return { code: 'internal', detail: String(error?.message || error) };
}
