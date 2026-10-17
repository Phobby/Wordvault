// "Create a test with AI", in the background script. The test page asks which languages a
// test can be in, then asks for one; the words are chosen here, from the vault, so that the
// page never decides what is sent. Before anything goes out: a provider is set up, the user
// has agreed to vault words going to it (apart from page text: aiConfig.examConsent), and the
// browser may reach it. What is sent: the chosen words, their translations from the vault, the
// language and the level. Nothing else of the vault, and nothing of any page.

import { EXAM, LEVELS, QUESTION_TYPES } from './config.js';
import { generateExam } from './generate.js';
import { getExam, listExams, removeExam, saveExam } from './history.js';
import { SCHEMA_NAME, EXAM_SCHEMA } from './schema.js';
import { buildPlan, groupByLanguage, selectWords, usableGroups, wordData } from './words.js';
import { allowedToReach, keepAwake } from '../ai/background.js';
import { activeAi, updateAiConfig } from '../ai/config.js';
import { DEFAULT_TIMEOUT_MS } from '../ai/http.js';
import { WordvaultError } from '../lib/errors.js';
import { normalizeLang } from '../lib/languages.js';
import { resolveTargetLanguage } from '../lib/translator.js';
import { listEntries } from '../lib/vault.js';

/** requestId -> { controller, step } of a test being made. */
const underWay = new Map();

/** The browser's own (offline) detector; '' unless it is sure enough. */
async function detect(text) {
  try {
    const result = await chrome.i18n.detectLanguage(text.slice(0, 1000));
    const best = [...(result?.languages || [])].sort((a, b) => b.percentage - a.percentage)[0];
    return best && (result.isReliable || best.percentage >= 80) ? best.language : '';
  } catch {
    return '';
  }
}

/**
 * The ways of asking for JSON, best first. A provider that turns one down as a bad request
 * (ai_request: the model does not know the schema form, or rejects the temperature) gets the
 * next; every answer is checked anyway (schema.js).
 */
const ATTEMPTS = Object.freeze([
  { json: { mode: 'schema', name: SCHEMA_NAME, schema: EXAM_SCHEMA }, temperature: EXAM.TEMPERATURE },
  { json: { mode: 'schema', name: SCHEMA_NAME, schema: EXAM_SCHEMA } },
  { json: { mode: 'object', name: SCHEMA_NAME, schema: EXAM_SCHEMA } },
  {},
]);

/** The page this comes from must be one of the extension's own (the test page). */
function fromOwnPage(handler) {
  return (payload, sender) => {
    if (!String(sender?.url || '').startsWith(chrome.runtime.getURL(''))) throw new WordvaultError('internal', 'not allowed from here');
    return handler(payload, sender);
  };
}

/** What the wizard needs first: the languages with enough words, and whether a provider is ready. */
async function languages() {
  const { groups, unknown } = await groupByLanguage(await listEntries(), detect);
  const state = await activeAi();
  return {
    groups,
    usable: usableGroups(groups).map(({ language }) => language),
    unknown,
    min: EXAM.MIN_WORDS,
    maxQuestions: EXAM.MAX_QUESTIONS,
    defaultQuestions: EXAM.DEFAULT_QUESTIONS,
    provider: state.provider && state.ready ? { id: state.provider.id, name: state.provider.name } : null,
    consent: Boolean(state.provider) && state.config.examConsent === state.provider.id,
  };
}

/** The test asked for, as far as it can be taken from the page: anything else is refused. */
function request(payload) {
  const language = normalizeLang(payload?.language || '');
  const level = LEVELS.includes(payload?.level) ? payload.level : '';
  const types = QUESTION_TYPES.filter((type) => (Array.isArray(payload?.types) ? payload.types : []).includes(type));
  const count = Math.round(Number(payload?.count));
  if (!language || !level || types.length === 0 || !Number.isFinite(count)) throw new WordvaultError('internal', 'incomplete request');
  return { language, level, types, count: Math.min(EXAM.MAX_QUESTIONS, Math.max(1, count)) };
}

/** The words and the plan of one test. */
async function prepare({ language, types, count }) {
  const { byLanguage } = await groupByLanguage(await listEntries(), detect);
  const pool = byLanguage.get(language) || [];
  if (pool.length < EXAM.MIN_WORDS) throw new WordvaultError('exam_not_enough', String(EXAM.MIN_WORDS));
  const selected = selectWords(pool, count);
  return { plan: buildPlan(selected, types, count), words: wordData(selected) };
}

/**
 * Makes a test with the provider in use.
 * @param {{ language: string, level: string, types: string[], count: number, requestId?: string, agree?: boolean }} payload
 *        agree: the user has just said yes to the notice about vault words being sent.
 */
async function generate(payload) {
  const asked = request(payload);
  let state = await activeAi();
  if (!state.provider || !state.ready) throw new WordvaultError('ai_not_configured', '');
  if (state.config.examConsent !== state.provider.id) {
    if (payload?.agree !== true) throw new WordvaultError('ai_exam_consent', state.provider.name);
    state = { ...state, config: await updateAiConfig({ examConsent: state.provider.id }) };
  }
  const { provider, settings } = state;
  if (!(await allowedToReach(provider, settings))) throw new WordvaultError('ai_permission', '');
  const { plan, words } = await prepare(asked);
  const explanationLang = await resolveTargetLanguage();

  const requestId = typeof payload?.requestId === 'string' ? payload.requestId : '';
  const job = { controller: new AbortController(), step: 'asking' };
  if (requestId) underWay.set(requestId, job);
  const done = keepAwake();
  let attempt = 0;
  const ask = async ({ system, prompt }) => {
    for (;;) {
      const { json, temperature } = ATTEMPTS[attempt];
      try {
        return await provider.generate({ system, prompt, maxTokens: EXAM.ANSWER_TOKENS, json, ...(temperature === undefined ? {} : { temperature }) }, settings, { signal: job.controller.signal, timeoutMs: provider.timeoutMs || DEFAULT_TIMEOUT_MS });
      } catch (error) {
        // Turned down as a request this provider cannot take: the next, plainer way, kept for the rest of this test.
        if (error?.code !== 'ai_request' || attempt >= ATTEMPTS.length - 1) throw error;
        attempt += 1;
      }
    }
  };
  try {
    const made = await generateExam({ words, plan, language: asked.language, level: asked.level, explanationLang, ask, onStep: (step) => (job.step = step) });
    const stored = await saveExam({ language: asked.language, level: asked.level, types: asked.types, requested: made.requested, source: 'ai', explanationLang, questions: made.questions });
    return { exam: stored, requested: made.requested, provider: provider.name };
  } finally {
    done();
    if (requestId) underWay.delete(requestId);
  }
}

/** Message handlers of the test, for the background script's table. Only the test page may use them. */
export const examHandlers = {
  'wv:exam:languages': fromOwnPage(() => languages()),
  'wv:exam:generate': fromOwnPage(generate),
  'wv:exam:progress': fromOwnPage((payload) => underWay.get(payload?.requestId)?.step || ''),
  'wv:exam:cancel': fromOwnPage((payload) => {
    const job = underWay.get(payload?.requestId);
    job?.controller.abort();
    return Boolean(job);
  }),
  'wv:exam:history': fromOwnPage(() => listExams()),
  'wv:exam:get': fromOwnPage((payload) => getExam(String(payload?.id || ''))),
  'wv:exam:remove': fromOwnPage((payload) => removeExam(String(payload?.id || ''))),
};
