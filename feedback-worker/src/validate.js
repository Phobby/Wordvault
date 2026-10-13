// What the receiver accepts. The shape is the one the extension builds
// (src/features/feedback/payload.js); anything else is turned away with a code that says why.

export const MAX_BYTES = 8 * 1024;
export const TYPES = ['bug', 'idea', 'other'];
export const FEATURES = ['bubble', 'captions', 'quiz', 'sync', 'settings', 'other'];
export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 1500;
const EMAIL_MAX = 254;
const MAX_ERRORS = 20;
const TECH_TEXT = ['browser', 'browserVersion', 'engine', 'os', 'extensionVersion', 'uiLanguage', 'syncMode'];
const TOP_KEYS = ['v', 'type', 'feature', 'message', 'email', 'tech', 'errors', 'website'];

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;
const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (object, allowed) => Object.keys(object).every((key) => allowed.includes(key));

/** Control characters out. Line breaks and tabs stay only where `multiline` says so. */
export function clean(text, multiline = false) {
  const value = String(text).replace(/\r\n?/g, '\n');
  return (multiline ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '') : value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')).trim();
}

/**
 * A filled-in hidden field: a program that fills in whatever it finds, not a person. The
 * extension never sends this field.
 */
export const isTrap = (body) => isPlain(body) && typeof body.website === 'string' && body.website.trim() !== '';

/**
 * @param {unknown} body  The parsed JSON.
 * @returns {{ ok: true, value: Object } | { ok: false, error: string }}
 *          `value` is a cleaned copy; nothing else of the body is used afterwards.
 */
export function validate(body) {
  const fail = (error) => ({ ok: false, error });
  if (!isPlain(body) || !onlyKeys(body, TOP_KEYS) || body.v !== 1) return fail('bad_shape');
  if (!TYPES.includes(body.type)) return fail('bad_type');
  if (!FEATURES.includes(body.feature)) return fail('bad_feature');
  if (typeof body.message !== 'string') return fail('bad_shape');
  const message = clean(body.message, true);
  const length = [...message].length;
  if (length < MESSAGE_MIN) return fail('message_too_short');
  if (length > MESSAGE_MAX) return fail('message_too_long');
  const value = { type: body.type, feature: body.feature, message };

  if ('email' in body) {
    if (typeof body.email !== 'string') return fail('bad_email');
    const email = clean(body.email);
    if (email !== '') {
      if (email.length > EMAIL_MAX || !EMAIL.test(email)) return fail('bad_email');
      value.email = email;
    }
  }

  if ('tech' in body) {
    const { tech } = body;
    if (!isPlain(tech) || !onlyKeys(tech, [...TECH_TEXT, 'features'])) return fail('bad_tech');
    value.tech = {};
    for (const key of TECH_TEXT) {
      if (!(key in tech)) continue;
      if (typeof tech[key] !== 'string' || tech[key].length > 60) return fail('bad_tech');
      value.tech[key] = clean(tech[key]);
    }
    if ('features' in tech) {
      const entries = isPlain(tech.features) ? Object.entries(tech.features) : null;
      if (!entries || entries.length > 30 || !entries.every(([name, on]) => /^\w{1,40}$/.test(name) && typeof on === 'boolean')) return fail('bad_tech');
      value.tech.features = Object.fromEntries(entries);
    }
  }

  if ('errors' in body) {
    const fine = (record) => isPlain(record) && onlyKeys(record, ['at', 'feature', 'message', 'stack']) && Number.isFinite(record.at) && ['feature', 'message', 'stack'].every((key) => typeof record[key] === 'string');
    if (!Array.isArray(body.errors) || body.errors.length > MAX_ERRORS || !body.errors.every(fine)) return fail('bad_errors');
    value.errors = body.errors.map((record) => ({ at: record.at, feature: clean(record.feature).slice(0, 40), message: clean(record.message).slice(0, 200), stack: clean(record.stack, true).slice(0, 320) }));
  }
  return { ok: true, value };
}
