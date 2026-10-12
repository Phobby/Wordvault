// Languages of the text recognition: which data files exist, how the extension's language
// codes (BCP-47) map onto the engine's, and what "automatic" means.

/** Language data shipped with the extension (vendor/tesseract/lang), by engine code. */
export const BUNDLED_LANGUAGES = Object.freeze(['eng', 'tur']);

/** BCP-47 primary subtag → Tesseract code, for the languages there is data for. */
const TO_ENGINE = Object.freeze({ en: 'eng', tr: 'tur' });
const TO_BCP47 = Object.freeze(Object.fromEntries(Object.entries(TO_ENGINE).map(([tag, code]) => [code, tag])));

/** 'en-US' → 'eng'; '' when there is no data for the language. */
export function engineCode(tag) {
  return TO_ENGINE[String(tag || '').toLowerCase().split('-')[0]] || '';
}

/** 'eng' → 'en'. */
export function languageTag(code) {
  return TO_BCP47[code] || '';
}

/**
 * The engine's language string for a setting.
 * @param {string | string[]} setting  'auto', or BCP-47 tags (one, several, or '+'-joined engine codes).
 * @returns {string} e.g. 'eng+tur'. Never empty.
 *
 * ASSUMPTION: "automatic" reads with every bundled language at once. The engine cannot tell the
 * language of a picture reliably, and with two bundled languages reading with both costs little.
 */
export function resolveLanguages(setting) {
  const wanted = (Array.isArray(setting) ? setting : String(setting || 'auto').split(/[+,\s]+/))
    .map((item) => (BUNDLED_LANGUAGES.includes(item) ? item : engineCode(item)))
    .filter(Boolean);
  const unique = [...new Set(wanted)];
  return (unique.length > 0 ? unique : BUNDLED_LANGUAGES).join('+');
}

/** The language to tell the translation popup, when the text was read with exactly one. */
export function singleLanguageTag(languages) {
  const codes = String(languages || '').split('+').filter(Boolean);
  return codes.length === 1 ? languageTag(codes[0]) : '';
}
