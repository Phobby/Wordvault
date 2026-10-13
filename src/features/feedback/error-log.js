// The local error log: the last few errors caught inside the extension, kept on this device so
// that a bug report can carry them if (and only if) the user asks for that.
//
// A record is: what went wrong (the error's name and message), in which part of the extension,
// when, and the top of the stack. It never holds the address or the content of a page: what is
// written here comes from the extension's own code, and anything that looks like an address
// is taken out before it is stored.

const LOG_KEY = 'errorLog';
export const MAX_RECORDS = 20;
const MAX_MESSAGE = 200;
const MAX_STACK = 320;
const MAX_FRAMES = 4;
/** A stack line that points into the extension's package. */
const OWN_FILE = /\b(?:moz|chrome|safari-web)-extension:\/\/[^/\s)]+\//;
/** Longer quoted text in a message is someone's data (a word, a server's answer), not a name. */
const MAX_QUOTED = 24;

/**
 * Takes out of a text everything that could say where the user was or what they read.
 * Addresses of the extension's own files become their path inside the package: the part
 * before it differs per installation in Firefox and would identify it.
 * @param {unknown} text
 * @returns {string}
 */
export function scrub(text) {
  return String(text ?? '')
    .replace(/\b(?:moz|chrome|safari-web)-extension:\/\/[^/\s)]+\//g, '')
    .replace(/\b(?:https?|wss?|ftp|file|blob|data|about|chrome|moz-extension):[^\s)'"]+/gi, '[address]')
    .replace(/\b[a-z][\w+.-]*%3A%2F%2F[^\s)'"]*/gi, '[address]')
    // nothing here should ever hold a key; if something did, it does not get written down
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?::fx)?\b/gi, '[key]')
    .replace(/\b(DeepL-Auth-Key|Bearer)\s+\S+/gi, '$1 [key]')
    .replace(/(["'`])([^"'`]*)\1/g, (all, quote, inner) => (inner.length > MAX_QUOTED ? `${quote}…${quote}` : all))
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ');
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * @param {string} feature  Which part of the extension ('background', 'sync', 'options', …).
 * @param {unknown} error
 * @param {number} [now]
 * @returns {{ at: number, feature: string, message: string, stack: string }}
 */
export function makeRecord(feature, error, now = Date.now()) {
  const name = error?.name && error.name !== 'Error' ? `${error.name}: ` : '';
  const message = clip(scrub(`${name}${error?.message ?? error}`).trim(), MAX_MESSAGE);
  const frames = String(error?.stack || '')
    .split('\n')
    // Only lines that point into the extension's own files: anything else (a page, a file on
    // disk, however it is written) says where the user was, not what went wrong here.
    .filter((line) => OWN_FILE.test(line))
    .map((line) => scrub(line).trim())
    .slice(0, MAX_FRAMES);
  return { at: now, feature: clip(String(feature || 'unknown').replace(/[^\w:.-]/g, ''), 40), message, stack: clip(frames.join('\n'), MAX_STACK) };
}

/** The log with one more record: a ring that holds the newest MAX_RECORDS. */
export function pushRecord(log, record) {
  return [...(Array.isArray(log) ? log : []), record].slice(-MAX_RECORDS);
}

/** @returns {Promise<ReturnType<typeof makeRecord>[]>} Oldest first. */
export async function getErrorLog() {
  const stored = (await chrome.storage.local.get(LOG_KEY))[LOG_KEY];
  return Array.isArray(stored) ? stored : [];
}

export async function clearErrorLog() {
  await chrome.storage.local.remove(LOG_KEY);
}

let writing = Promise.resolve();

/** Writes an error down. Never throws: a log that fails must not add to the trouble. */
export function recordError(feature, error) {
  const record = makeRecord(feature, error);
  writing = writing
    .then(async () => chrome.storage.local.set({ [LOG_KEY]: pushRecord(await getErrorLog(), record) }))
    .catch(() => {});
  return writing;
}

/**
 * Catches what nothing else caught in this context (a page of the extension or its background
 * script). Web pages are not listened to: their errors are theirs and would carry their content.
 * @param {string} feature
 */
export function catchUncaught(feature) {
  globalThis.addEventListener?.('error', (event) => {
    // An error with a file name outside the extension is not ours.
    if (event.filename && !String(event.filename).startsWith(chrome.runtime.getURL(''))) return;
    recordError(feature, event.error || event.message);
  });
  globalThis.addEventListener?.('unhandledrejection', (event) => {
    recordError(feature, event.reason);
  });
}
