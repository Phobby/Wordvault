// Translation provider registry.
//
// To add a provider, create a module in this folder that exports an object implementing
// TranslationProvider and register it below. Nothing else in the extension knows about concrete
// providers: lib/translator.js only talks to this interface.

import { deepl } from './deepl.js';
import { mymemory } from './mymemory.js';

/**
 * @typedef {Object} ProviderConfigField
 * A user-editable setting (API key, server URL) rendered by the options page.
 * @property {string} key                Property name inside the provider's config object.
 * @property {'text' | 'password' | 'url'} type
 * @property {string} labelKey           _locales message key for the field label.
 * @property {boolean} [required]
 *
 * @typedef {Object} TranslationRequest
 * @property {string} text               Text to translate (already trimmed and length-checked).
 * @property {string | null} source      Source language code, or null to let the provider detect it.
 * @property {string} target             Target language code, one of getLanguages().
 *
 * @typedef {Object} TranslationResult
 * @property {string} translation
 * @property {string | null} [detectedSource]  Source language as understood by the provider.
 * @property {string[]} [alternatives]         Other target-language equivalents, best first.
 *
 * @typedef {Object} TranslationProvider
 * @property {string} id
 * @property {string} name
 * @property {string} homepage
 * @property {boolean} supportsAutoDetect      Whether translate() accepts `source: null`.
 * @property {number} [maxBytes]               Largest query in UTF-8 bytes, if the API has a limit.
 * @property {ProviderConfigField[]} configFields
 * @property {(config: Record<string, string>) => Promise<string[]>} getLanguages
 *   Language codes the provider can translate from and to.
 * @property {(request: TranslationRequest, config: Record<string, string>) => Promise<TranslationResult>} translate
 *   Rejects with a WordvaultError (lib/errors.js) describing what went wrong.
 * @property {(config: Record<string, string>) => Promise<Object>} [check]
 *   Tries the configuration (the key) without translating anything; rejects like translate().
 */

export const DEFAULT_PROVIDER_ID = mymemory.id;

/** @type {Map<string, TranslationProvider>} */
const providers = new Map([
  [mymemory.id, mymemory],
  [deepl.id, deepl],
]);

/** @returns {TranslationProvider} The requested provider, or the default one for an unknown id. */
export function getProvider(id) {
  return providers.get(id) || providers.get(DEFAULT_PROVIDER_ID);
}

/** @returns {TranslationProvider[]} */
export function listProviders() {
  return [...providers.values()];
}
