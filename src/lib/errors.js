/**
 * Error with a machine-readable code. The code travels over the message channel to the UI, which
 * maps it to a localized message (see the `err*` keys in _locales).
 *
 * Codes: network, timeout, rate_limit, auth, unsupported_language, same_language, too_long,
 * no_result, empty, provider_error; for a provider that needs a key: no_key, quota,
 * provider_permission (its host was not allowed yet), provider_language (it does not translate
 * into the chosen language; the detail is that language's code).
 */
export class WordvaultError extends Error {
  /**
   * @param {string} code
   * @param {string} [detail] Raw, non-localized detail (for example the provider's own message).
   * @param {Record<string, unknown>} [context] What was already known when the error happened
   *   (languages, vault state), so the UI can still offer to save the word.
   */
  constructor(code, detail, context) {
    super(detail || code);
    this.name = 'WordvaultError';
    this.code = code;
    this.detail = detail || '';
    this.context = context || null;
  }
}

/** Plain object form that survives chrome.runtime messaging. */
export function serializeError(error) {
  if (error instanceof WordvaultError) return { code: error.code, detail: error.detail, context: error.context };
  return { code: 'internal', detail: String(error?.message || error), context: null };
}
