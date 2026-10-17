// The test wizard: the language (only when there is more than one to choose from), the level,
// the kind and number of questions; then the request, with the notice the first time, a
// progress line and a way to cancel; then the result, and the past tests. Opened from the
// toolbar popup in a tab of its own, so that a long request is not lost when the popup closes.
// Everything a model wrote is put on the page with textContent only (WV.h 'text').

import { EXAM, FILL_BLANK, LEVELS, TRUE_FALSE } from './config.js';
import { getAiConfig, settingsFor } from '../ai/config.js';
import { getAiProvider } from '../ai/providers/index.js';

const { h, t, languages } = globalThis.WV;

await globalThis.WV.i18n.startPage();
globalThis.WV.adoptStyles(globalThis.WV.styles.tokens + globalThis.WV.styles.controls);
document.title = t('examTitle');

/** Error codes and what is said about them (the provider's name fills {provider}). */
const ERRORS = {
  ai_auth: 'aiErrAuth',
  ai_quota: 'aiErrQuota',
  ai_model: 'aiErrModel',
  ai_overloaded: 'aiErrOverloaded',
  ai_origin: 'aiErrOrigin',
  ai_permission: 'optAiDenied',
  ai_request: 'aiErrRequest',
  ai_refused: 'aiErrRefused',
  ai_empty: 'aiErrEmpty',
  ai_bad_answer: 'aiErrEmpty',
  ai_address: 'aiErrAddress',
  network: 'aiErrNetwork',
  timeout: 'aiErrTimeout',
  exam_parse: 'examErrParse',
  exam_empty: 'examErrEmpty',
  exam_not_enough: 'examNotEnough',
  ai_not_configured: 'examNoProvider',
};
const STEP_TEXT = { asking: 'examStepAsking', checking: 'examStepChecking', retrying: 'examStepRetrying', 'topping-up': 'examStepTopUp' };
const KINDS = { both: [FILL_BLANK, TRUE_FALSE], [FILL_BLANK]: [FILL_BLANK], [TRUE_FALSE]: [TRUE_FALSE] };
const STEP_NAMES = { language: 'examStepNameLanguage', level: 'examStepNameLevel', kind: 'examStepNameKind' };
/** What each CEFR level means, in a few words. */
const LEVEL_TEXT = { A1: 'examLevelA1', A2: 'examLevelA2', B1: 'examLevelB1', B2: 'examLevelB2', C1: 'examLevelC1', C2: 'examLevelC2' };

let info = await globalThis.WV.send('wv:exam:languages');
/** The provider's addresses, known before a click: the browser asks about them only during one. */
let origins = [];
async function loadOrigins() {
  const config = await getAiConfig();
  const provider = getAiProvider(config.provider);
  origins = provider ? provider.origins(settingsFor(provider, config.providers[provider.id])) : [];
}
await loadOrigins();

const choice = { language: info.usable[0] || '', level: 'B1', kind: 'both', count: Math.min(info.defaultQuestions, info.maxQuestions) };
const languageName = (code) => languages.name(code) || code;
const groupOf = (code) => info.groups.find((group) => group.language === code);

// --- Building blocks --------------------------------------------------------------------------

function radio(name, value, checked, title, help, onChange) {
  const input = h('input', { type: 'radio', name, value, checked: checked || null, onchange: () => onChange(value) });
  return h('label', { class: 'choice' }, input, h('span', { class: 'choice-text' }, h('strong', { text: title }), help && h('span', { class: 'help', text: help })));
}

const button = (labelKey, onclick, primary = false) => h('button', { class: primary ? 'wv-btn wv-btn-primary' : 'wv-btn', type: 'button', text: t(labelKey), onclick });

// --- Steps --------------------------------------------------------------------------------------

function languageStep() {
  return h(
    'fieldset',
    null,
    h('legend', { text: t('examStepLanguage') }),
    h(
      'div',
      { class: 'choices' },
      info.usable.map((code) => radio('language', code, code === choice.language, languageName(code), t('examWordCount', { count: groupOf(code).count }), (value) => (choice.language = value))),
    ),
  );
}

function levelStep() {
  return h(
    'fieldset',
    null,
    h('legend', { text: t('examStepLevel') }),
    h('div', { class: 'choices levels' }, LEVELS.map((level) => radio('level', level, level === choice.level, level, t(LEVEL_TEXT[level]), (value) => (choice.level = value)))),
  );
}

function kindStep() {
  const count = h('input', {
    id: 'exam-count',
    type: 'number',
    inputmode: 'numeric',
    min: '1',
    max: String(info.maxQuestions),
    step: '1',
    value: String(choice.count),
    onchange: () => {
      const value = Math.round(Number(count.value));
      choice.count = Number.isFinite(value) ? Math.min(info.maxQuestions, Math.max(1, value)) : EXAM.DEFAULT_QUESTIONS;
      count.value = String(choice.count);
    },
  });
  return h(
    'div',
    null,
    h(
      'fieldset',
      null,
      h('legend', { text: t('examStepKind') }),
      h(
        'div',
        { class: 'choices' },
        radio('kind', 'both', choice.kind === 'both', t('examKindBoth'), t('examKindBothHelp'), (value) => (choice.kind = value)),
        radio('kind', FILL_BLANK, choice.kind === FILL_BLANK, t('examKindFill'), t('examKindFillHelp'), (value) => (choice.kind = value)),
        radio('kind', TRUE_FALSE, choice.kind === TRUE_FALSE, t('examKindTrueFalse'), t('examKindTrueFalseHelp'), (value) => (choice.kind = value)),
      ),
    ),
    h('div', { class: 'count-row' }, h('label', { for: 'exam-count', text: t('examCount') }), count, h('span', { class: 'help', text: t('examCountHelp', { max: info.maxQuestions }) })),
  );
}

// --- The wizard -------------------------------------------------------------------------------

const wizard = h('section', { class: 'card', id: 'wizard', 'aria-labelledby': 'wizard-title' });
const status = h('div', { role: 'status', 'aria-live': 'polite' });
const result = h('section', { class: 'card', id: 'result', hidden: true, 'aria-labelledby': 'result-title' });
const historyList = h('ul', { class: 'history' });
const historyEmpty = h('p', { class: 'help', text: t('examHistoryEmpty') });
const history = h('section', { class: 'card', id: 'history' }, h('h2', { text: t('examHistoryTitle') }), h('p', { class: 'help', text: t('examHistoryHelp', { max: EXAM.HISTORY_ITEMS }) }), historyEmpty, historyList);

/** The steps there are: the language only when there is a choice. */
const steps = () => [...(info.usable.length > 1 ? [['language', languageStep]] : []), ['level', levelStep], ['kind', kindStep]];
let stepIndex = 0;
let busy = false;

function renderWizard() {
  const head = h('h2', { id: 'wizard-title', text: t('examNewTitle') });
  if (info.usable.length === 0) {
    wizard.replaceChildren(head, h('p', { class: 'notice', text: t('examNotEnough', { min: info.min }) }), unknownNote());
    return;
  }
  const all = steps();
  stepIndex = Math.min(stepIndex, all.length - 1);
  const [, build] = all[stepIndex];
  const last = stepIndex === all.length - 1;
  wizard.replaceChildren(
    head,
    // One language only: said, not asked.
    info.usable.length === 1 ? h('p', { class: 'help', text: t('examLanguageOnly', { language: languageName(choice.language), count: groupOf(choice.language).count }) }) : '',
    unknownNote(),
    h(
      'ol',
      { class: 'steps', 'aria-label': t('examStepsLabel') },
      all.map(([name], index) => h('li', { class: index < stepIndex ? 'done' : null, 'aria-current': index === stepIndex ? 'step' : null, text: t(STEP_NAMES[name]) })),
    ),
    // While a test is being made the choices are locked; the progress line and its "Cancel" are not.
    h('div', { class: 'wizard-form' }, build(), h('div', { class: 'buttons' }, stepIndex > 0 ? button('examBack', () => go(-1)) : '', last ? button('examCreate', () => create(), true) : button('examNext', () => go(1), true))),
    status,
  );
  lock(busy);
}

function lock(locked) {
  for (const control of wizard.querySelectorAll('.wizard-form input, .wizard-form button')) control.disabled = locked;
}

function unknownNote() {
  return info.unknown > 0 ? h('p', { class: 'help', text: t('examUnknownLanguage', { count: info.unknown }) }) : '';
}

function go(delta) {
  stepIndex += delta;
  renderWizard();
  wizard.querySelector('legend, input')?.focus();
}

function say(...children) {
  status.replaceChildren(...children);
}

// --- Making the test ------------------------------------------------------------------------

async function create(agree = false) {
  if (busy) return;
  if (!info.provider) {
    say(h('div', { class: 'notice' }, h('p', { text: t('examNoProvider') }), h('div', { class: 'buttons' }, button('examOpenSettings', () => globalThis.WV.send('wv:ai:open-settings').catch(() => {})))));
    return;
  }
  // Straight from the click: the browser shows its question about the provider's address only now.
  const allowed = origins.length > 0 ? chrome.permissions.request({ origins }).catch(() => false) : Promise.resolve(false);
  if (!(await allowed)) {
    say(h('p', { class: 'notice bad', text: t('optAiDenied') }));
    return;
  }
  busy = true;
  lock(true);
  const requestId = `exam-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const started = Date.now();
  const line = h('span');
  const cancel = button('aiCancel', () => globalThis.WV.send('wv:exam:cancel', { requestId }).catch(() => {}));
  say(h('div', { class: 'notice' }, h('p', { class: 'progress' }, h('span', { class: 'wv-spinner', 'aria-hidden': 'true' }), line), h('div', { class: 'buttons' }, cancel)));
  const tick = async () => {
    const step = await globalThis.WV.send('wv:exam:progress', { requestId }).catch(() => '');
    line.textContent = `${t(STEP_TEXT[step] || 'examStepAsking', { provider: info.provider.name })} (${Math.round((Date.now() - started) / 1000)} s)`;
  };
  tick();
  const timer = setInterval(tick, 1000);
  try {
    const made = await globalThis.WV.send('wv:exam:generate', { language: choice.language, level: choice.level, types: KINDS[choice.kind], count: choice.count, requestId, agree });
    say(h('p', { class: 'notice', text: made.exam.questions.length < made.requested ? t('examMadePartial', { made: made.exam.questions.length, requested: made.requested }) : t('examMade', { count: made.exam.questions.length }) }));
    showExam(made.exam);
    renderHistory();
  } catch (error) {
    if (error?.code === 'ai_exam_consent') askConsent();
    else if (error?.code === 'aborted') say(h('p', { class: 'notice', text: t('examCancelled') }));
    else say(h('p', { class: 'notice bad', text: errorText(error) }));
  } finally {
    clearInterval(timer);
    busy = false;
    lock(false);
  }
}

function errorText(error) {
  const key = ERRORS[error?.code];
  const text = t(key || 'aiErrUnknown', { provider: info.provider?.name || '', min: info.min });
  return (!key || error?.code === 'ai_request') && error?.detail ? `${text} (${error.detail})` : text;
}

/** The first time with this provider: what will be sent, and a yes or a no. */
function askConsent() {
  const words = Math.min(choice.count, EXAM.MAX_WORDS, groupOf(choice.language)?.count || 0);
  const agree = button('examConsentAgree', () => create(true), true);
  say(
    h(
      'div',
      { class: 'notice', role: 'group', 'aria-label': t('examConsentTitle') },
      h('p', { text: t('examConsent', { provider: info.provider.name, count: words }) }),
      h('p', { text: t('examConsentNot') }),
      h('div', { class: 'buttons' }, agree, button('aiCancel', () => say())),
    ),
  );
  agree.focus();
}

// --- The result (stage 1: a plain preview; the printable page comes next) ------------------------

function showExam(exam) {
  result.hidden = false;
  result.replaceChildren(
    h('h2', { id: 'result-title', text: t('examResultTitle', { language: languageName(exam.language), level: exam.level }) }),
    h(
      'ol',
      { class: 'preview', lang: exam.language },
      exam.questions.map((question) =>
        h(
          'li',
          null,
          h('span', { class: 'q-text', dir: 'auto' }, h('span', { class: 'badge', lang: '', text: t(question.type === FILL_BLANK ? 'examKindFill' : 'examKindTrueFalse') }), question.text),
          h('span', { class: 'q-meta', dir: 'auto', lang: exam.explanationLang || null, text: `${question.type === FILL_BLANK ? question.answer : t(question.isTrue ? 'examTrue' : 'examFalse')} · ${question.explanation}` }),
        ),
      ),
    ),
  );
  result.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// --- Past tests -----------------------------------------------------------------------------------

async function renderHistory() {
  const items = await globalThis.WV.send('wv:exam:history').catch(() => []);
  historyEmpty.hidden = items.length > 0;
  const date = new Intl.DateTimeFormat(languages.uiLanguage(), { dateStyle: 'medium', timeStyle: 'short' });
  historyList.replaceChildren(
    ...items.map((item) =>
      h(
        'li',
        null,
        h('span', { class: 'meta' }, h('strong', { text: `${languageName(item.language)} · ${item.level}` }), h('span', { class: 'help', text: `${date.format(item.createdAt)} · ${t('examQuestionCount', { count: item.count })}` })),
        h(
          'span',
          { class: 'actions' },
          h('button', {
            class: 'wv-btn wv-btn-sm',
            type: 'button',
            text: t('examOpen'),
            'aria-label': t('examOpenLabel', { language: languageName(item.language), level: item.level, date: date.format(item.createdAt) }),
            onclick: async () => {
              const exam = await globalThis.WV.send('wv:exam:get', { id: item.id }).catch(() => null);
              if (exam) showExam(exam);
            },
          }),
          h('button', {
            class: 'wv-btn wv-btn-sm',
            type: 'button',
            text: t('examDelete'),
            'aria-label': t('examDeleteLabel', { language: languageName(item.language), level: item.level, date: date.format(item.createdAt) }),
            onclick: async () => {
              await globalThis.WV.send('wv:exam:remove', { id: item.id }).catch(() => {});
              await renderHistory();
              (historyList.querySelector('button') || history.querySelector('h2')).focus?.();
            },
          }),
        ),
      ),
    ),
  );
}

document.getElementById('app').append(
  h('header', { class: 'page-head' }, h('img', { src: '../icons/icon-48.png', alt: '', width: '32', height: '32' }), h('h1', { text: t('examTitle') })),
  wizard,
  result,
  history,
);
renderWizard();
renderHistory();

// The provider or the words changed elsewhere (the settings, the popup): look again.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || busy) return;
  if (changes.aiConfig || Object.keys(changes).some((key) => key.startsWith('vault:'))) {
    info = await globalThis.WV.send('wv:exam:languages').catch(() => info);
    if (!info.usable.includes(choice.language)) choice.language = info.usable[0] || '';
    await loadOrigins();
    renderWizard();
  }
});
