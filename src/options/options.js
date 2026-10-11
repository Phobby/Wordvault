// Options page. It edits the same stored settings every other part of the extension reads
// (lib/settings.js); nothing is kept here.

import { downloadBackup, restoreBackup } from '../lib/backup.js';
import { getSettings, updateSettings } from '../lib/settings.js';
import { getPreferences, setTargetLanguage } from '../lib/translator.js';
import { getDiagnostics } from '../quiz/scheduler.js';

const { h, t, languages, speech, quizCard } = globalThis.WV;

globalThis.WV.adoptStyles(globalThis.WV.styles.tokens + globalThis.WV.styles.controls);
document.documentElement.lang = languages.uiLanguage();
document.title = t('optionsTitle');

// --- "Saved" indicator ---------------------------------------------------------------------------

const saved = h('span', { class: 'saved', role: 'status', text: t('optSaved') });
let savedTimer = 0;

function flashSaved() {
  saved.classList.add('visible');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => saved.classList.remove('visible'), 1500);
}

// --- Target language -----------------------------------------------------------------------------

const currentTarget = h('p', { class: 'current' });
const targetList = languages.createList({
  onSelect: async (code) => {
    await setTargetLanguage(code);
    flashSaved();
  },
});

async function renderTarget() {
  const prefs = await getPreferences();
  const name = languages.name(prefs.targetLang);
  currentTarget.textContent = t(prefs.targetChosen ? 'optTargetLangCurrent' : 'optTargetLangUnset', [name]);
  targetList.setOptions({ codes: prefs.languages, value: prefs.targetLang });
}

// --- Double-click trigger ------------------------------------------------------------------------

const doubleClick = h('input', {
  type: 'checkbox',
  onchange: async () => {
    await updateSettings({ doubleClick: doubleClick.checked });
    flashSaved();
  },
});

const ttsFallback = h('input', {
  type: 'checkbox',
  onchange: async () => {
    await updateSettings({ ttsFallback: ttsFallback.checked });
    flashSaved();
  },
});

async function renderSwitches() {
  const settings = await getSettings();
  doubleClick.checked = settings.doubleClick;
  ttsFallback.checked = settings.ttsFallback;
}

function switchRow(input, titleKey, helpKey) {
  return h(
    'label',
    { class: 'switch' },
    input,
    h('span', { class: 'switch-text' }, h('strong', { text: t(titleKey) }), h('span', { class: 'help', text: t(helpKey) })),
  );
}

// --- Backup --------------------------------------------------------------------------------------

/** Larger than any real vault; keeps a wrong file from being read into memory. */
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

const backupStatus = h('p', { class: 'help', role: 'status' });
const filePicker = h('input', {
  type: 'file',
  accept: 'application/json,.json',
  hidden: true,
  onchange: async () => {
    const [file] = filePicker.files;
    filePicker.value = ''; // so picking the same file again fires "change"
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('too large');
      const { added, skipped, invalid } = await restoreBackup(await file.text());
      backupStatus.textContent = t('bkImported', [String(added), String(skipped), String(invalid)]);
    } catch {
      backupStatus.textContent = t('bkBadFile');
    }
  },
});
const backupSection = h(
  'section',
  { class: 'card', id: 'backup' },
  h('h2', { text: t('bkTitle') }),
  h('p', { class: 'help', text: t('bkHelp') }),
  h(
    'div',
    { class: 'buttons' },
    h('button', {
      class: 'wv-btn',
      type: 'button',
      text: t('tbExport'),
      onclick: async () => {
        backupStatus.textContent = t('bkExported', [String(await downloadBackup())]);
      },
    }),
    h('button', { class: 'wv-btn', type: 'button', text: t('tbImport'), onclick: () => filePicker.click() }),
    filePicker,
  ),
  backupStatus,
);

// --- Flash cards: "Why is there no quiz?" --------------------------------------------------------

/** Reason codes (quiz/scheduler.js, content/quiz.js) and the messages that explain them. */
const QUIZ_REASONS = {
  shown: 'quizWhyShown',
  disabled: 'quizWhyDisabled',
  below_min_cards: 'quizWhyBelowMinCards',
  not_enough_choices: 'quizWhyNotEnoughChoices',
  no_cards: 'quizWhyNotEnoughChoices',
  no_active_tab: 'quizWhyNoActiveTab',
  window_not_focused: 'quizWhyWindowNotFocused',
  tab_hidden: 'quizWhyTabHidden',
  media_playing: 'quizWhyMediaPlaying',
  video_playing: 'quizWhyVideoPlaying',
  fullscreen: 'quizWhyFullscreen',
  typing: 'quizWhyTyping',
  popup_open: 'quizWhyPopupOpen',
  already_showing: 'quizWhyAlreadyShowing',
  page_not_supported: 'quizWhyPageNotSupported',
};

function reasonText(reason, diagnostics) {
  const key = QUIZ_REASONS[reason];
  if (!key) return reason; // an unexpected error: show it as it is
  return t(key, [String(diagnostics.total), String(diagnostics.minCards), languages.name(diagnostics.targetLang), String(diagnostics.meanings), String(diagnostics.neededMeanings)]);
}

/** "14:35 (in 3 minutes)" */
function timeText(time) {
  const locale = languages.uiLanguage();
  const date = new Date(time);
  const sameDay = date.toDateString() === new Date().toDateString();
  const clock = date.toLocaleString(locale, sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const minutes = Math.round((time - Date.now()) / 60_000);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.abs(minutes) >= 90 ? Math.round(minutes / 60) : minutes, Math.abs(minutes) >= 90 ? 'hour' : 'minute');
  return `${clock} (${relative})`;
}

const quizVerdict = h('p', { class: 'verdict', role: 'status' });
const quizFacts = h('dl', { class: 'facts' });
const quizTestResult = h('p', { class: 'help', role: 'status' });
let quizDiagnostics = null;

async function renderQuiz() {
  const d = await getDiagnostics();
  quizDiagnostics = d;
  quizVerdict.textContent = d.standingReason ? t('quizVerdictNo', [reasonText(d.standingReason, d)]) : t('quizVerdictYes', [d.nextAt ? timeText(d.nextAt) : t('quizDiagNotScheduled')]);
  quizVerdict.className = d.standingReason ? 'verdict no' : 'verdict yes';

  let next = d.nextAt ? timeText(d.nextAt) : t('quizDiagNotScheduled');
  // The plan says a quiz is due but nothing is set to wake the extension up for it.
  if (d.enabled && !d.alarmAt) next += ` — ${t('quizDiagNoAlarm')}`;
  const facts = [
    ['quizDiagEnabled', t(d.enabled ? 'quizOn' : 'quizOff')],
    ['quizDiagCards', t('quizDiagCardsValue', [String(d.total), String(d.minCards)])],
    ['quizDiagAskable', t('quizDiagAskableValue', [String(d.askable), languages.name(d.targetLang), String(d.meanings), String(d.neededMeanings)])],
    ['quizDiagInterval', t('quizDiagIntervalValue', [String(d.intervalMinutes)])],
    ['quizDiagNext', next],
    ['quizDiagLast', d.lastAttempt ? `${timeText(d.lastAttempt.at)}: ${reasonText(d.lastAttempt.reason, d)}` : t('quizDiagNever')],
  ];
  quizFacts.replaceChildren(...facts.flatMap(([labelKey, value]) => [h('dt', { text: t(labelKey) }), h('dd', { text: value })]));
}

async function testQuiz() {
  quizTestResult.textContent = '';
  let built;
  try {
    // Through the background script on purpose: if that is not running, this is where it shows.
    built = await globalThis.WV.send('wv:quiz:test');
  } catch {
    quizTestResult.textContent = t('quizTestFailed');
    return;
  }
  if (!built.ok) {
    quizTestResult.textContent = reasonText(built.reason, quizDiagnostics || (await getDiagnostics()));
    return;
  }
  quizCard.show(built.question, { onAnswer: (answer) => globalThis.WV.send('wv:quiz:answer', answer).catch(() => {}) });
}

const quizSection = h(
  'section',
  { class: 'card', id: 'quiz' },
  h('h2', { text: t('optQuizTitle') }),
  h('p', { class: 'help', text: t('optQuizHelp') }),
  h('h3', { text: t('quizDiagTitle') }),
  quizVerdict,
  quizFacts,
  h('div', { class: 'buttons' }, h('button', { class: 'wv-btn', type: 'button', text: t('quizTest'), onclick: testQuiz })),
  h('p', { class: 'help', text: t('quizTestHelp') }),
  quizTestResult,
);

// --- Page ----------------------------------------------------------------------------------------

document.getElementById('app').append(
  h(
    'header',
    { class: 'page-head' },
    h('img', { src: '../icons/icon-48.png', alt: '', width: '32', height: '32' }),
    h('h1', { text: t('optionsTitle') }),
    saved,
  ),
  h(
    'section',
    { class: 'card' },
    h('h2', { text: t('optTargetLang') }),
    h('p', { class: 'help', text: t('optTargetLangHelp') }),
    currentTarget,
    targetList.element,
  ),
  h('section', { class: 'card' }, switchRow(doubleClick, 'optDoubleClick', 'optDoubleClickHelp')),
  // Only meaningful in the browsers where recordings replace the browser's voice.
  speech.usesRecordings && h('section', { class: 'card' }, switchRow(ttsFallback, 'optTtsFallback', 'optTtsFallbackHelp')),
  quizSection,
  backupSection,
);

// The toolbar popup links here for importing.
if (location.hash === '#backup') {
  backupSection.classList.add('highlight');
  backupSection.scrollIntoView({ block: 'center' });
}

function render() {
  renderTarget();
  renderSwitches();
}

render();
renderQuiz();
// Settings can also change from the translation popup while this page is open; words are
// added and quizzes come due in the background.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) render();
  // What "Test now" last said may no longer be true once the vault has changed.
  if (Object.keys(changes).some((key) => key.startsWith('vault:'))) quizTestResult.textContent = '';
  renderQuiz();
});
// The panel shows times relative to now.
setInterval(renderQuiz, 20_000);
