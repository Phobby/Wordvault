// What a piece of feedback is made of. The object built here is exactly what the preview shows
// and exactly what is sent; nothing is added on the way.

export const TYPES = Object.freeze(['bug', 'idea', 'other']);
export const FEATURES = Object.freeze(['bubble', 'captions', 'quiz', 'sync', 'settings', 'other']);
export const LIMITS = Object.freeze({ messageMin: 10, messageMax: 1500, emailMax: 254, bytes: 8000 });
export const SCHEMA_VERSION = 1;

/** Deliberately loose: it catches typing mistakes; whether the address exists nobody can tell. */
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;

/** Control characters out (line breaks and tabs stay), ends trimmed. */
export function cleanText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
    .trim();
}

/**
 * @param {{ type?: string, feature?: string, message?: string, email?: string }} draft
 * @returns {string[]} What is wrong: 'type', 'feature', 'message_short', 'message_long', 'email'. Empty: nothing.
 */
export function validateDraft(draft) {
  const problems = [];
  if (!TYPES.includes(draft?.type)) problems.push('type');
  if (!FEATURES.includes(draft?.feature)) problems.push('feature');
  const length = [...cleanText(draft?.message)].length;
  if (length < LIMITS.messageMin) problems.push('message_short');
  if (length > LIMITS.messageMax) problems.push('message_long');
  const email = cleanText(draft?.email);
  if (email !== '' && (email.length > LIMITS.emailMax || !EMAIL.test(email))) problems.push('email');
  return problems;
}

const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * @param {Object} parts
 * @param {{ type: string, feature: string, message: string, email?: string }} parts.draft
 * @param {Object | null} [parts.tech]    Technical information (tech-info.js), or null: not included.
 * @param {Object[] | null} [parts.errors]  The local error log, or null: not included.
 * @returns {Object} The body of the request.
 */
export function buildPayload({ draft, tech = null, errors = null }) {
  const payload = { v: SCHEMA_VERSION, type: draft.type, feature: draft.feature, message: cleanText(draft.message) };
  const email = cleanText(draft.email);
  if (email) payload.email = email;
  if (tech) payload.tech = tech;
  if (errors && errors.length > 0) {
    // The receiver takes a limited size: the oldest records give way first.
    payload.errors = errors.map(({ at, feature, message, stack }) => ({ at, feature, message, stack }));
    while (payload.errors.length > 0 && bytes(payload) > LIMITS.bytes) payload.errors.shift();
    if (payload.errors.length === 0) delete payload.errors;
  }
  return payload;
}

const TECH_KEYS = ['browser', 'browserVersion', 'engine', 'os', 'extensionVersion', 'uiLanguage', 'features', 'syncMode'];
const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (object, allowed) => Object.keys(object).every((key) => allowed.includes(key));

/**
 * The last check before anything leaves: the body has the shape buildPayload() gives it and
 * nothing else. What the options page hands over is not trusted more than that.
 * @returns {string} '' when it may be sent, otherwise what is wrong.
 */
export function checkPayload(payload) {
  if (!isPlain(payload) || !onlyKeys(payload, ['v', 'type', 'feature', 'message', 'email', 'tech', 'errors'])) return 'shape';
  if (payload.v !== SCHEMA_VERSION) return 'shape';
  const problems = validateDraft(payload);
  if (problems.length > 0) return problems[0];
  if ('email' in payload && typeof payload.email !== 'string') return 'email';
  if ('tech' in payload) {
    const { tech } = payload;
    if (!isPlain(tech) || !onlyKeys(tech, TECH_KEYS)) return 'tech';
    if (!isPlain(tech.features) || !Object.values(tech.features).every((value) => typeof value === 'boolean')) return 'tech';
    if (!TECH_KEYS.filter((key) => key !== 'features').every((key) => !(key in tech) || (typeof tech[key] === 'string' && tech[key].length <= 60))) return 'tech';
  }
  if ('errors' in payload) {
    const fine = (record) => isPlain(record) && onlyKeys(record, ['at', 'feature', 'message', 'stack']) && Number.isFinite(record.at) && ['feature', 'message', 'stack'].every((key) => typeof record[key] === 'string');
    if (!Array.isArray(payload.errors) || payload.errors.length > 20 || !payload.errors.every(fine)) return 'errors';
  }
  return bytes(payload) > LIMITS.bytes ? 'size' : '';
}
