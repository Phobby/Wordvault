// Language-code helpers shared by the background script and the extension pages.

// Codes that browsers and the built-in language detector report differently from what
// translation providers expect (mostly retired ISO 639-1 codes).
const ALIASES = {
  iw: 'he',
  in: 'id',
  ji: 'yi',
  jw: 'jv',
  nb: 'no',
  nn: 'no',
  fil: 'tl',
  'zh-hans': 'zh-CN',
  'zh-hant': 'zh-TW',
  'zh-hk': 'zh-TW',
  'zh-mo': 'zh-TW',
  'zh-sg': 'zh-CN',
};

/**
 * Canonical form of a BCP 47-ish code: aliases applied, "en_us" -> "en-US".
 * @param {string | null | undefined} code
 * @returns {string} '' when the code is missing or undetermined
 */
export function normalizeLang(code) {
  if (!code || typeof code !== 'string') return '';
  const lower = code.trim().replace(/_/g, '-').toLowerCase();
  if (!lower || lower === 'und' || lower === 'auto') return '';
  if (ALIASES[lower]) return ALIASES[lower];
  const [primary, ...rest] = lower.split('-');
  const base = ALIASES[primary] || primary;
  if (!/^[a-z]{2,3}$/.test(base)) return '';
  const region = rest.find((part) => /^([a-z]{2}|\d{3})$/.test(part));
  return region ? `${base}-${region.toUpperCase()}` : base;
}

export function primarySubtag(code) {
  return normalizeLang(code).split('-')[0];
}

/** "en-US" and "en-GB" are the same language for our purposes. */
export function sameLanguage(a, b) {
  const left = primarySubtag(a);
  return Boolean(left) && left === primarySubtag(b);
}

/**
 * Maps an arbitrary code to the closest entry of a provider's language list.
 * "en-US" -> "en", "zh" -> "zh-CN", "pt-BR" -> "pt-BR" (if listed) or "pt".
 * @param {string} code
 * @param {string[]} supported
 * @returns {string | null}
 */
export function matchSupported(code, supported) {
  const wanted = normalizeLang(code);
  if (!wanted) return null;
  const byLower = new Map(supported.map((entry) => [entry.toLowerCase(), entry]));
  const exact = byLower.get(wanted.toLowerCase());
  if (exact) return exact;
  const primary = wanted.split('-')[0];
  return byLower.get(primary) || supported.find((entry) => entry.toLowerCase().startsWith(`${primary}-`)) || null;
}
