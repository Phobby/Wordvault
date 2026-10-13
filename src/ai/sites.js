// Where the AI features stay off: banking, e-mail and health sites by default, plus the hosts
// the user adds; minus the hosts the user explicitly allows.
//
// ASSUMPTION: there is no list of "sensitive sites" to rely on, so this is a rule of thumb: a
// handful of well-known services by name, and host names that say what they are ("mail.",
// "bank", "health"). It errs on the side of switching the features off; a site that is caught
// by mistake can be allowed in the settings, and one that is missed can be blocked there.

/** Whole labels of a host name that mark it as sensitive ("mail.example.com", "webmail.uni.edu"). */
const LABELS = new Set(['mail', 'webmail', 'email', 'outlook', 'owa', 'bank', 'banking', 'onlinebanking', 'ebanking', 'netbanking', 'internetbankaciligi', 'sube', 'isube', 'health', 'patient', 'patients', 'mychart', 'ehr', 'hasta', 'enabiz', 'mhrs', 'pay', 'payments', 'wallet', 'accounts', 'login', 'signin', 'auth', 'sso', 'id']);
/** Parts of a label that do the same ("garantibank", "healthcare"). */
const FRAGMENTS = ['bank', 'banka', 'health', 'saglik', 'sağlık', 'hospital', 'hastane', 'klinik', 'clinic', 'pharma', 'eczane', 'sigorta', 'insurance', 'kredi', 'credit'];
/** Services known by a name that says nothing. Matched as the host itself or the end of it. */
const HOSTS = [
  'mail.google.com', 'mail.yahoo.com', 'proton.me', 'protonmail.com', 'tutanota.com', 'tuta.com', 'fastmail.com', 'yandex.com.tr', 'icloud.com',
  'paypal.com', 'wise.com', 'revolut.com', 'n26.com', 'stripe.com', 'chase.com', 'wellsfargo.com', 'hsbc.com', 'barclays.co.uk', 'santander.com', 'ing.com',
  'isbank.com.tr', 'garantibbva.com.tr', 'akbank.com', 'yapikredi.com.tr', 'qnb.com.tr', 'enpara.com', 'teb.com.tr', 'ing.com.tr', 'kuveytturk.com.tr', 'papara.com',
  'turkiye.gov.tr', 'enabiz.gov.tr', 'mhrs.gov.tr', 'gib.gov.tr', 'ivd.gib.gov.tr',
];

/** A host name as it is compared: lower case, without "www." and without a port. */
export function normalizeHost(value) {
  let text = String(value ?? '').trim().toLowerCase();
  if (!text) return '';
  // typed with a scheme or a path: only the host counts
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(text)) text = new URL(text).hostname;
  } catch {
    return '';
  }
  text = text.replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^\*\./, '').replace(/^www\./, '').replace(/\.$/, '');
  return /^[a-z0-9\u00a1-\uffff.-]+$/.test(text) && text.length <= 255 ? text : '';
}

/** What the user typed into a list: one host per line (or comma), cleaned, without duplicates. */
export function parseHostList(text) {
  // (a host has a dot in it, or is this computer: a stray word is not one)
  const hosts = String(text ?? '').split(/[\s,;]+/).map(normalizeHost).filter((host) => host.includes('.') || host === 'localhost');
  return [...new Set(hosts)].slice(0, 500);
}

/** Whether a host is `entry` or a subdomain of it. */
const covers = (entry, host) => host === entry || host.endsWith(`.${entry}`);

/** Whether the built-in rules take a host for a banking, e-mail or health site. */
export function looksSensitive(host) {
  const name = normalizeHost(host);
  if (!name) return false;
  if (HOSTS.some((entry) => covers(entry, name))) return true;
  const labels = name.split('.');
  // the last label is the country or kind of domain ("bank" as a top-level domain counts too)
  return labels.some((label) => LABELS.has(label) || FRAGMENTS.some((fragment) => label.includes(fragment)));
}

/**
 * @param {string} host  Host name of the page ('' for the extension's own pages).
 * @param {{ blocked?: string[], allowed?: string[] }} lists  The user's lists.
 * @returns {'ok' | 'blocked' | 'sensitive'}  'blocked': on the user's list; 'sensitive': caught
 *          by the built-in rules and not allowed by the user.
 */
export function siteStatus(host, { blocked = [], allowed = [] } = {}) {
  const name = normalizeHost(host);
  if (!name) return 'ok';
  // The user's own block list is the last word; then their allow list; then the rules.
  if (blocked.map(normalizeHost).some((entry) => entry && covers(entry, name))) return 'blocked';
  if (allowed.map(normalizeHost).some((entry) => entry && covers(entry, name))) return 'ok';
  return looksSensitive(name) ? 'sensitive' : 'ok';
}
