// Checks the interface translations (src/locales/*.json) against the English source.
//
//   npm run i18n:check       report; exits with 1 when there is an error
//
// What counts as what:
//   error    the file is not valid JSON or not a flat object of strings; a value is empty; a
//            key exists that English does not have; a message's placeholders differ from the
//            English one ({name}, the variable of a plural, "#" outside a plural); braces do
//            not match; a plural has no "other" form or a form CLDR does not know; a language
//            file is not in the list in src/shared/i18n.js, or the list names one without a file;
//            the code asks for a key that English does not have.
//   warning  a key English has is missing (the interface shows the English text there).
//   note     a key no code mentions (it may be unused, or built from parts).
//
// build.js runs the same check: warnings are printed, errors stop the build.

import fs from 'node:fs';
import path from 'node:path';

const PLURAL_FORMS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

/** The matching "}" for the "{" at `start`, or -1. */
function closing(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * What a message's placeholders are.
 * @returns {{ names: string[], plurals: string[], problems: string[] }}  names: every {name}
 *          and plural variable, sorted and unique; plurals: the variables used for plurals.
 */
export function placeholdersOf(message, inPlural = false) {
  const names = new Set();
  const plurals = new Set();
  const problems = [];
  let i = 0;
  let outside = '';
  while (i < message.length) {
    const open = message.indexOf('{', i);
    const stray = message.indexOf('}', i);
    if (stray !== -1 && (open === -1 || stray < open)) {
      problems.push('a "}" without "{"');
      break;
    }
    if (open === -1) {
      outside += message.slice(i);
      break;
    }
    outside += message.slice(i, open);
    const end = closing(message, open);
    if (end === -1) {
      problems.push('a "{" without "}"');
      break;
    }
    const inner = message.slice(open + 1, end);
    const plural = /^\s*(\w+)\s*,\s*plural\s*,([\s\S]*)$/.exec(inner);
    const simple = /^\s*(\w+)\s*$/.exec(inner);
    if (plural) {
      names.add(plural[1]);
      plurals.add(plural[1]);
      let rest = plural[2];
      const seen = [];
      while (rest.trim()) {
        const label = /^\s*(=\d+|\w+)\s*\{/.exec(rest);
        if (!label) {
          problems.push(`plural "${plural[1]}" is not "form {text} ..."`);
          break;
        }
        const from = label[0].length - 1;
        const to = closing(rest, from);
        if (to === -1) {
          problems.push(`plural "${plural[1]}": a form is not closed`);
          break;
        }
        if (!label[1].startsWith('=') && !PLURAL_FORMS.has(label[1])) problems.push(`plural "${plural[1]}": unknown form "${label[1]}"`);
        seen.push(label[1]);
        const nested = placeholdersOf(rest.slice(from + 1, to), true);
        nested.names.forEach((name) => names.add(name));
        nested.plurals.forEach((name) => plurals.add(name));
        problems.push(...nested.problems);
        rest = rest.slice(to + 1);
      }
      if (!seen.includes('other')) problems.push(`plural "${plural[1]}" has no "other" form`);
    } else if (simple) {
      names.add(simple[1]);
    } else {
      problems.push(`"{${inner}}" is neither {name} nor a plural`);
    }
    i = end + 1;
  }
  if (!inPlural && outside.includes('#')) problems.push('"#" outside a plural');
  return { names: [...names].sort(), plurals: [...plurals].sort(), problems };
}

/**
 * @param {{ languages: string[], files: Record<string, string>, codeKeys?: Set<string>, codeText?: string, source?: string }} input
 *   files: language code -> raw file text; codeKeys: keys the code asks for with t('...');
 *   codeText: all the code, to tell which keys no code mentions.
 * @returns {{ errors: string[], warnings: string[], notes: string[], counts: Record<string, number> }}
 */
export function checkLocales({ languages, files, codeKeys = new Set(), codeText = '', source = 'en' }) {
  const errors = [];
  const warnings = [];
  const notes = [];
  const parsed = {};
  for (const [lang, text] of Object.entries(files)) {
    try {
      const value = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
      for (const [key, message] of Object.entries(value)) {
        if (typeof message !== 'string') errors.push(`${lang}: "${key}" is not a string`);
        else if (!message.trim()) errors.push(`${lang}: "${key}" is empty`);
      }
      parsed[lang] = value;
    } catch (error) {
      errors.push(`${lang}.json is not valid: ${error.message}`);
    }
  }
  for (const lang of languages) if (!(lang in files)) errors.push(`${lang} is listed in src/shared/i18n.js but src/locales/${lang}.json does not exist`);
  for (const lang of Object.keys(files)) if (!languages.includes(lang)) errors.push(`src/locales/${lang}.json is not listed in src/shared/i18n.js (LANGUAGES)`);
  const english = parsed[source];
  if (!english) return { errors, warnings, notes, counts: {} };

  const shape = {};
  for (const [key, message] of Object.entries(english)) {
    if (typeof message !== 'string') continue;
    const found = placeholdersOf(message);
    shape[key] = found;
    for (const problem of found.problems) errors.push(`${source}: "${key}": ${problem}`);
  }
  const counts = {};
  for (const [lang, messages] of Object.entries(parsed)) {
    if (lang === source) continue;
    const missing = Object.keys(english).filter((key) => !(key in messages));
    counts[lang] = Object.keys(english).length - missing.length;
    if (missing.length) warnings.push(`${lang}: ${missing.length} key(s) missing (English is shown there): ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ', …' : ''}`);
    for (const [key, message] of Object.entries(messages)) {
      if (!(key in english)) {
        errors.push(`${lang}: "${key}" is not in ${source}.json`);
        continue;
      }
      if (typeof message !== 'string' || !shape[key]) continue;
      const found = placeholdersOf(message);
      for (const problem of found.problems) errors.push(`${lang}: "${key}": ${problem}`);
      const want = shape[key];
      if (found.names.join() !== want.names.join()) errors.push(`${lang}: "${key}" has placeholders {${found.names.join('}, {')}}, ${source} has {${want.names.join('}, {')}}`);
      // A language without plural forms may write a plural as plain {count}; one with them must not lose them.
      for (const name of found.plurals) if (!want.plurals.includes(name)) errors.push(`${lang}: "${key}": "${name}" is a plural here but not in ${source}`);
    }
  }
  counts[source] = Object.keys(english).length;
  for (const key of codeKeys) if (!(key in english)) errors.push(`the code asks for "${key}", which ${source}.json does not have`);
  if (codeText) {
    const unused = Object.keys(english).filter((key) => !codeText.includes(`'${key}'`) && !codeText.includes(`"${key}"`) && !codeText.includes(`\`${key}\``));
    if (unused.length) notes.push(`${unused.length} key(s) no code mentions as a whole (unused, or built from parts): ${unused.slice(0, 20).join(', ')}${unused.length > 20 ? ', …' : ''}`);
  }
  return { errors, warnings, notes, counts };
}

/** All .js files under a folder, except vendored code. */
function codeFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'vendor') out.push(...codeFiles(full));
    } else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Reads the repository and checks it. */
export function checkRepository(root) {
  const src = path.join(root, 'src');
  const dir = path.join(src, 'locales');
  const files = Object.fromEntries(
    fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => [name.slice(0, -5), fs.readFileSync(path.join(dir, name), 'utf8')]),
  );
  const loader = fs.readFileSync(path.join(src, 'shared/i18n.js'), 'utf8');
  const list = /const LANGUAGES = Object\.freeze\(\[([\s\S]*?)\]\)/.exec(loader)?.[1] || '';
  const languages = [...list.matchAll(/code:\s*'([^']+)'/g)].map((match) => match[1]);
  const codeText = codeFiles(src).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const codeKeys = new Set([...codeText.matchAll(/(?<![\w.$])(?:WV\.)?t\(\s*'([A-Za-z0-9_]+)'/g)].map((match) => match[1]));
  return checkLocales({ languages, files, codeKeys, codeText });
}

/** Prints a result; returns whether it is free of errors. */
export function report({ errors, warnings, notes, counts }, log = console) {
  for (const line of errors) log.error(`error: ${line}`);
  for (const line of warnings) log.warn(`warning: ${line}`);
  for (const line of notes) log.log(`note: ${line}`);
  log.log(`locales: ${Object.entries(counts).map(([lang, count]) => `${lang} ${count}`).join(', ')}; ${errors.length} error(s), ${warnings.length} warning(s)`);
  return errors.length === 0;
}
