// The shape of a test, defined once: the JSON Schema the provider is held to (and that the
// prompt shows), and the checks every answer goes through before anything of it is shown.
// What a model writes is data: it is checked here and only ever put on a page as plain text.

import { BLANK, EXAM, FILL_BLANK, LEVELS, QUESTION_TYPES, TRUE_FALSE } from './config.js';

export const SCHEMA_VERSION = 1;
export const SCHEMA_NAME = 'wordvault_exam';

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });

/**
 * The answer, in the subset of JSON Schema every provider takes (structured outputs at
 * Anthropic and OpenAI, Gemini's responseFormat, Ollama's format): plain objects with
 * `additionalProperties: false`, every field required, null where a field does not apply.
 * Lengths and counts are not expressible there; validateExam() holds them.
 */
export const EXAM_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['version', 'language', 'level', 'questions'],
  properties: {
    version: { type: 'integer' },
    language: { type: 'string' },
    level: { type: 'string', enum: [...LEVELS] },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'type', 'wordId', 'text', 'answer', 'lemma', 'acceptable', 'isTrue', 'explanation'],
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: [...QUESTION_TYPES] },
          wordId: { type: 'string' },
          text: { type: 'string' },
          answer: nullable({ type: 'string' }),
          lemma: nullable({ type: 'string' }),
          acceptable: nullable({ type: 'array', items: { type: 'string' } }),
          isTrue: nullable({ type: 'boolean' }),
          explanation: { type: 'string' },
        },
      },
    },
  },
});

/**
 * The JSON object in what a model (or the user, pasting) handed back: as it is, inside a code
 * fence, or with words around it.
 * @returns {{ value: any } | { error: string }}  error: what is wrong, for the user (in English
 *          detail; the page shows its own message).
 */
export function extractJson(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { error: 'empty' };
  const candidates = [raw];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fenced) candidates.push(fenced[1].trim());
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(raw.slice(first, last + 1));
  let reason = 'no JSON object found';
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return { value };
      reason = 'the JSON is not an object';
    } catch (error) {
      reason = String(error?.message || error);
    }
  }
  return { error: reason };
}

/** Text compared without case, accents or spacing differences. */
export function fold(text, lang = '') {
  let lower;
  try {
    lower = String(text ?? '').toLocaleLowerCase(lang || undefined);
  } catch {
    lower = String(text ?? '').toLowerCase();
  }
  return lower.normalize('NFKD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();
}

/** A string field: trimmed, one line, within `max`; '' when it is not a string. */
function textField(value, max) {
  if (typeof value !== 'string') return '';
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : '';
}

const count = (text, part) => text.split(part).length - 1;

/**
 * Whether `word` (or a form of it) is in `text`: the word itself, or a token that starts like it
 * (most of the stem: "go" in "goes", "study" in "studied"). Scripts without spaces are searched
 * as they are.
 */
export function mentions(text, word, lang = '') {
  const haystack = fold(text, lang);
  const needle = fold(word, lang);
  if (!needle) return false;
  if (haystack.includes(needle)) return true;
  const stem = (part) => [...part].slice(0, Math.max(3, Math.ceil([...part].length * 0.6))).join('');
  const tokens = haystack.split(/[^\p{L}\p{N}'’-]+/u).filter(Boolean);
  return needle.split(' ').every((part) => tokens.some((token) => token.startsWith(stem(part))) || haystack.includes(stem(part)));
}

/** Whether `phrase` stands in `text` as a whole word (or words); scripts without spaces: anywhere. */
export function containsWhole(text, phrase, lang = '') {
  const haystack = fold(text, lang);
  const needle = fold(phrase, lang);
  if (!needle) return false;
  if (!/[\p{L}\p{N}]/u.test(needle) || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(needle)) return haystack.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(haystack);
}

/**
 * Checks one question against the plan it was asked for.
 * @returns {{ question: object } | { problem: string }}
 */
export function checkQuestion(raw, { words, language }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { problem: 'not an object' };
  if (!QUESTION_TYPES.includes(raw.type)) return { problem: 'unknown type' };
  const word = words.get(raw.wordId);
  if (!word) return { problem: 'unknown word' };
  const text = textField(raw.text, EXAM.TEXT_CHARS);
  if (!text) return { problem: 'text missing or too long' };
  const explanation = textField(raw.explanation, EXAM.EXPLANATION_CHARS);
  if (!explanation) return { problem: 'explanation missing or too long' };
  const base = { type: raw.type, wordId: raw.wordId, word: word.word, text, explanation };

  if (raw.type === FILL_BLANK) {
    if (count(text, BLANK) !== 1) return { problem: 'the blank is not there exactly once' };
    const answer = textField(raw.answer, EXAM.ANSWER_CHARS);
    if (!answer) return { problem: 'answer missing' };
    const lemma = textField(raw.lemma, EXAM.ANSWER_CHARS) || answer;
    const acceptable = (Array.isArray(raw.acceptable) ? raw.acceptable : [])
      .map((item) => textField(item, EXAM.ANSWER_CHARS))
      .filter((item) => item && fold(item, language) !== fold(answer, language))
      .slice(0, EXAM.ACCEPTABLE_ITEMS);
    // The answer has to be the word asked about, or a form of it.
    const forms = [answer, lemma, ...acceptable];
    if (!forms.some((form) => fold(form, language) === fold(word.word, language) || mentions(form, word.word, language))) return { problem: 'the answer is not the word' };
    // ... and must not be given away by the sentence itself.
    if (containsWhole(text.replace(BLANK, ' '), answer, language)) return { problem: 'the sentence gives the answer away' };
    return { question: { ...base, answer, lemma, acceptable } };
  }

  if (typeof raw.isTrue !== 'boolean') return { problem: 'true or false missing' };
  if (text.includes(BLANK)) return { problem: 'a statement with a blank' };
  if (!mentions(text, word.word, language) && !(typeof raw.lemma === 'string' && raw.lemma && mentions(text, raw.lemma, language) && mentions(raw.lemma, word.word, language))) return { problem: 'the word is not in the statement' };
  return { question: { ...base, isTrue: raw.isTrue } };
}

/**
 * Checks a whole answer against the plan.
 * @param {any} value  What extractJson() found.
 * @param {{ plan: { alias: string, type: string }[], words: Map<string, { word: string }>, language: string }} context
 *        words: alias -> the word sent under it.
 * @returns {{ ok: false, error: string } | { ok: true, questions: object[], dropped: { index: number, problem: string }[] }}
 *          not ok: the answer is not a test at all (asked again); dropped: questions left out.
 */
export function validateExam(value, { plan, words, language }) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.questions)) return { ok: false, error: 'no list of questions' };
  const wanted = new Set(plan.map(({ alias, type }) => `${alias}|${type}`));
  const seen = new Set();
  const questions = [];
  const dropped = [];
  value.questions.forEach((raw, index) => {
    const checked = checkQuestion(raw, { words, language });
    if (checked.problem) {
      dropped.push({ index, problem: checked.problem });
      return;
    }
    const key = `${checked.question.wordId}|${checked.question.type}`;
    // Only what was asked for, each once (the same word never twice in the same kind).
    if (!wanted.has(key)) dropped.push({ index, problem: 'not asked for' });
    else if (seen.has(key)) dropped.push({ index, problem: 'a repeat' });
    else {
      seen.add(key);
      questions.push(checked.question);
    }
  });
  return { ok: true, questions, dropped };
}

/** The questions in the order of the plan, numbered again (q1, q2, ...). */
export function inPlanOrder(questions, plan) {
  const order = new Map(plan.map(({ alias, type }, index) => [`${alias}|${type}`, index]));
  return [...questions]
    .sort((a, b) => order.get(`${a.wordId}|${a.type}`) - order.get(`${b.wordId}|${b.type}`))
    .map((question, index) => ({ id: `q${index + 1}`, ...question }));
}

export { TRUE_FALSE };
