// Options page. It edits the same stored settings every other part of the extension reads
// (lib/settings.js); nothing is kept here.

import { createFeedbackPanel } from './feedback.js';
import { createOcrSection } from './ocr.js';
import { createCacheSection, createProviderSection } from './provider.js';
import { catchUncaught } from '../features/feedback/error-log.js';
import { supportCard } from '../support/support.js';
import { downloadBackup, restoreBackup } from '../lib/backup.js';
import { getSettings, updateSettings } from '../lib/settings.js';
import { getPreferences, setTargetLanguage } from '../lib/translator.js';
import { INTERVAL_MINUTES, TIMEOUT_SECONDS, getDiagnostics } from '../quiz/scheduler.js';
import { createSyncControls } from './sync.js';

const { h, t, languages, speech } = globalThis.WV;

globalThis.WV.adoptStyles(globalThis.WV.styles.tokens + globalThis.WV.styles.controls);
document.documentElement.lang = languages.uiLanguage();
document.title = t('optionsTitle');
catchUncaught('options');

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
// Below exporting and importing by hand: keeping the vault in step by itself (options/sync.js).
const syncControls = createSyncControls({ onSaved: flashSaved });
backupSection.append(syncControls.element);

// --- Flash cards: settings -----------------------------------------------------------------------

/** The frequencies offered, in minutes; anything else is entered under "Custom".
 *  ASSUMPTION: 20 minutes is offered next to the frequencies the specification lists, because
 *  it is the default: without it a fresh installation would show its frequency as "Custom". */
const INTERVAL_PRESETS = [5, 10, 15, 20, 30, 60, 120, 240];
/** Offered only while the extension is loaded for development: short enough to watch the timer work. */
const INTERVAL_TESTING = 1;
const MIN_CARDS_MAX = 1000;
let developmentInstall = false;

function intervalLabel(minutes) {
  if (minutes === 1) return t('quizEveryMinute');
  if (minutes % 60 !== 0) return t('quizEveryMinutes', [String(minutes)]);
  return minutes === 60 ? t('quizEveryHour') : t('quizEveryHours', [String(minutes / 60)]);
}

/** Stores quiz settings. The background script rebuilds the timer when the settings change;
 *  it is also told directly, in case that change does not wake it up. */
async function saveQuiz(patch) {
  await updateSettings(patch);
  flashSaved();
  await globalThis.WV.send('wv:quiz:reschedule').catch(() => {});
  renderQuiz(); // the alarm has been set by now; setting it is not a change this page hears about
}

/** A whole number from a field, or null if what is typed there is not one within the limits. */
function numberIn(input, min, max) {
  const value = Number(input.value);
  return input.value.trim() !== '' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

const quizEnabled = h('input', { type: 'checkbox', onchange: () => saveQuiz({ quizEnabled: quizEnabled.checked }) });
const quizAllowNotDue = h('input', { type: 'checkbox', onchange: () => saveQuiz({ quizAllowNotDue: quizAllowNotDue.checked }) });

// The ways a word is asked: each on its own switch, and whether they are mixed.
const quizSwitch = (key) => h('input', { type: 'checkbox', 'data-setting': key, onchange: (event) => saveQuiz({ [key]: event.target.checked }) });
const quizModeClassic = quizSwitch('quizModeClassic');
const quizModeWriting = quizSwitch('quizModeWriting');
const quizModeListening = quizSwitch('quizModeListening');
const quizModeMixed = quizSwitch('quizModeMixed');
const quizAccentTolerant = quizSwitch('quizAccentTolerant');
const quizListenAutoplay = quizSwitch('quizListenAutoplay');
const quizListenChoices = h(
  'select',
  { 'aria-label': t('optQuizListenChoices'), 'data-setting': 'quizListenChoices', onchange: () => saveQuiz({ quizListenChoices: quizListenChoices.value }) },
  h('option', { value: 'meaning', text: t('optQuizListenMeaning') }),
  h('option', { value: 'spelling', text: t('optQuizListenSpelling') }),
);

const quizIntervalCustom = h('input', {
  type: 'number',
  inputmode: 'numeric',
  min: String(INTERVAL_MINUTES.MIN),
  max: String(INTERVAL_MINUTES.MAX),
  step: '1',
  'aria-label': t('optQuizIntervalCustom'),
  onchange: () => {
    const minutes = numberIn(quizIntervalCustom, INTERVAL_MINUTES.MIN, INTERVAL_MINUTES.MAX);
    if (minutes !== null) saveQuiz({ quizIntervalMinutes: minutes });
    else renderQuizSettings(quizIntervalCustom); // back to the value that is in force
  },
});
const quizIntervalCustomRow = h('span', { class: 'inline', hidden: true }, quizIntervalCustom, h('span', { class: 'unit', text: t('optMinutes') }));
const quizInterval = h('select', {
  'aria-label': t('optQuizInterval'),
  onchange: () => {
    if (quizInterval.value === 'custom') {
      // Nothing is saved until a number is entered; the frequency in force stays in the field.
      quizIntervalCustomRow.hidden = false;
      quizIntervalCustom.focus();
      quizIntervalCustom.select();
    } else {
      saveQuiz({ quizIntervalMinutes: Number(quizInterval.value) });
    }
  },
});

const quizMinCards = h('input', {
  type: 'number',
  inputmode: 'numeric',
  min: '1',
  max: String(MIN_CARDS_MAX),
  step: '1',
  'aria-label': t('optQuizMinCards'),
  onchange: () => {
    const count = numberIn(quizMinCards, 1, MIN_CARDS_MAX);
    if (count !== null) saveQuiz({ quizMinCards: count });
    else renderQuizSettings(quizMinCards);
  },
});
const quizTimeout = h('input', {
  type: 'number',
  inputmode: 'numeric',
  min: String(TIMEOUT_SECONDS.MIN),
  max: String(TIMEOUT_SECONDS.MAX),
  step: '1',
  'aria-label': t('optQuizTimeout'),
  onchange: () => {
    const seconds = numberIn(quizTimeout, TIMEOUT_SECONDS.MIN, TIMEOUT_SECONDS.MAX);
    if (seconds !== null) saveQuiz({ quizTimeoutSeconds: seconds });
    else renderQuizSettings(quizTimeout);
  },
});

/** @param {HTMLInputElement} [rejected]  A field whose content was not accepted and is put back. */
/** How many questions a quiz can be set to ask. */
const QUESTION_COUNTS = [1, 3, 5, 10];
const quizQuestions = h('select', {
  'aria-label': t('optQuizQuestions'),
  onchange: () => saveQuiz({ quizQuestionsPerQuiz: Number(quizQuestions.value) }),
});

/** The ways a quiz can be shown (quiz/display.js) and their names. */
const DISPLAY_NAMES = { auto: 'quizDisplayAuto', popup: 'quizDisplayPopup', window: 'quizDisplayWindow', card: 'quizDisplayCard', notification: 'quizDisplayNotification' };
const quizDisplay = h(
  'select',
  { 'aria-label': t('optQuizDisplay'), onchange: () => saveQuiz({ quizDisplay: quizDisplay.value }) },
  ['auto', 'popup', 'window', 'card'].map((value) => h('option', { value, text: t(DISPLAY_NAMES[value]) })),
);

// The system notification is the last resort, and the only thing here that needs a permission
// of its own; it is asked for when the user wants it and not before.
const NOTIFICATIONS = { permissions: ['notifications'] };
const quizNotifyStatus = h('span', { class: 'unit', role: 'status' });
const quizNotifyButton = h('button', {
  class: 'wv-btn',
  type: 'button',
  onclick: async () => {
    // Straight from the click: the browser only shows its permission prompt for a user action.
    const allowed = quizNotifyButton.dataset.allowed === 'yes';
    const done = await (allowed ? chrome.permissions.remove(NOTIFICATIONS) : chrome.permissions.request(NOTIFICATIONS)).catch(() => false);
    quizNotifyStatus.textContent = !allowed && !done ? t('optQuizNotifyDenied') : '';
    await renderQuizSettings();
    renderQuiz();
  },
});

/** Sends the notification right now, so that it can be seen (and clicked) without waiting for
 *  the rare moment when nothing else can show a quiz. Only there while notifications are allowed. */
const quizNotifyTry = h('button', {
  class: 'wv-btn',
  type: 'button',
  hidden: true,
  text: t('optQuizNotifyTry'),
  onclick: async () => {
    const result = await globalThis.WV.send('wv:quiz:test', { methods: ['notification'] }).catch(() => null);
    const diagnostics = quizDiagnostics || (await getDiagnostics());
    quizNotifyStatus.textContent = !result ? t('quizTestFailed') : result.ok ? t('optQuizNotifySent') : skipText(result, diagnostics);
  },
});

async function renderQuizSettings(rejected) {
  const [settings, d] = await Promise.all([getSettings(), getDiagnostics()]);
  // A field that is being typed in is left alone.
  const free = (field) => field === rejected || document.activeElement !== field;
  quizEnabled.checked = settings.quizEnabled;
  quizAllowNotDue.checked = settings.quizAllowNotDue;
  quizModeClassic.checked = settings.quizModeClassic === true;
  quizModeWriting.checked = settings.quizModeWriting === true;
  quizModeListening.checked = settings.quizModeListening === true;
  quizModeMixed.checked = settings.quizModeMixed !== false;
  quizAccentTolerant.checked = settings.quizAccentTolerant === true;
  quizListenAutoplay.checked = settings.quizListenAutoplay !== false;
  quizListenChoices.value = settings.quizListenChoices === 'spelling' ? 'spelling' : 'meaning';

  const minutes = d.intervalMinutes;
  const offered = [...(developmentInstall ? [INTERVAL_TESTING] : []), ...INTERVAL_PRESETS];
  const custom = !offered.includes(minutes);
  quizInterval.replaceChildren(
    ...offered.map((value) => h('option', { value: String(value), text: value === INTERVAL_TESTING ? t('quizEveryTesting') : intervalLabel(value) })),
    h('option', { value: 'custom', text: t('quizEveryCustom') }),
  );
  quizInterval.value = custom ? 'custom' : String(minutes);
  quizIntervalCustomRow.hidden = !custom;
  const counts = QUESTION_COUNTS.includes(d.questionsPerQuiz) ? QUESTION_COUNTS : [...QUESTION_COUNTS, d.questionsPerQuiz].sort((a, b) => a - b);
  quizQuestions.replaceChildren(...counts.map((count) => h('option', { value: String(count), text: count === 1 ? t('quizQuestionsOne') : t('quizQuestionsMany', [String(count)]) })));
  quizQuestions.value = String(d.questionsPerQuiz);
  quizDisplay.value = d.display;
  quizNotifyButton.dataset.allowed = d.notifications ? 'yes' : 'no';
  quizNotifyButton.textContent = t(d.notifications ? 'optQuizNotifyRemove' : 'optQuizNotifyAllow');
  quizNotifyTry.hidden = !d.notifications;
  if (!d.notifications && quizNotifyStatus.textContent !== t('optQuizNotifyDenied')) quizNotifyStatus.textContent = '';
  else if (d.notifications && quizNotifyStatus.textContent === '') quizNotifyStatus.textContent = t('optQuizNotifyAllowed');
  if (free(quizIntervalCustom)) quizIntervalCustom.value = String(minutes);
  if (free(quizMinCards)) quizMinCards.value = String(d.minCards);
  if (free(quizTimeout)) quizTimeout.value = String(d.timeoutSeconds);
}

/** A labelled setting: name and explanation on the left, the control on the right. */
function fieldRow(titleKey, helpKey, ...controls) {
  return h(
    'div',
    { class: 'field' },
    h('div', { class: 'field-text' }, h('strong', { text: t(titleKey) }), helpKey && h('span', { class: 'help', text: t(helpKey) })),
    h('div', { class: 'field-control' }, controls),
  );
}

// --- Flash cards: "Why is there no quiz?" --------------------------------------------------------

/** Reason codes (quiz/scheduler.js, content/quiz.js) and the messages that explain them. */
const QUIZ_REASONS = {
  shown: 'quizWhyShown',
  disabled: 'quizWhyDisabled',
  below_min_cards: 'quizWhyBelowMinCards',
  not_enough_choices: 'quizWhyNotEnoughChoices',
  no_cards: 'quizWhyNotEnoughChoices',
  nothing_due: 'quizWhyNothingDue',
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
  muted: 'quizWhyMuted',
  no_display: 'quizWhyNoDisplay',
  // why one particular way of showing the quiz was not possible (quiz/display.js)
  popup_unsupported: 'quizWhyPopupUnsupported',
  popup_refused: 'quizWhyPopupRefused',
  popup_not_opened: 'quizWhyPopupNotOpened',
  window_unsupported: 'quizWhyWindowUnsupported',
  window_refused: 'quizWhyWindowRefused',
  window_not_opened: 'quizWhyWindowNotOpened',
  notification_not_allowed: 'quizWhyNotificationNotAllowed',
  notification_refused: 'quizWhyNotificationRefused',
};

function reasonText(reason, diagnostics) {
  const key = QUIZ_REASONS[reason];
  if (!key) return reason; // an unexpected error: show it as it is
  return t(key, [String(diagnostics.total), String(diagnostics.minCards), languages.name(diagnostics.targetLang), String(diagnostics.meanings), String(diagnostics.neededMeanings)]);
}

/** "toolbar popup: the browser refused to open it (…); separate window: …" */
function triedText(tried, diagnostics) {
  return (tried || [])
    .map(({ method, reason, detail }) => `${t(DISPLAY_NAMES[method] || method)}: ${reasonText(reason, diagnostics)}${detail ? ` (${detail})` : ''}`)
    .join('; ');
}

/** How a quiz was shown, and which ways were tried in vain before that one. */
function shownText(shown, diagnostics) {
  const how = t(DISPLAY_NAMES[shown.method] || 'quizWhyShown');
  return shown.tried?.length > 0 ? t('quizShownAfter', [how, triedText(shown.tried, diagnostics)]) : how;
}

/** Why no quiz was shown; with the ways that were tried, if it got that far. */
function skipText(skip, diagnostics) {
  const why = reasonText(skip.reason, diagnostics);
  return skip.tried?.length > 0 ? `${why}: ${triedText(skip.tried, diagnostics)}` : why;
}

/** What became of a question (quiz-card.js), in words. */
const QUIZ_OUTCOMES = { unknown: 'quizOutcomeUnknown', later: 'quizOutcomeLater', timeout: 'quizOutcomeTimeout', closed: 'quizOutcomeClosed' };

/** "14:35 (2 minutes ago): book: answered right" */
function lastAnswerText(lastAnswer) {
  if (!lastAnswer) return t('quizDiagNever');
  // The word is the last part of the entry's id (lib/vault.js: entryId) and may contain the separator.
  const word = String(lastAnswer.id).split('|').slice(2).join('|');
  const outcome = t(QUIZ_OUTCOMES[lastAnswer.outcome] || (lastAnswer.correct ? 'quizOutcomeRight' : 'quizOutcomeWrong'));
  return `${timeText(lastAnswer.at)}: ${word}: ${outcome}`;
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
/** Takes "Not today" back; only there while it is in force. */
const quizUnmute = h('button', {
  class: 'wv-btn',
  type: 'button',
  hidden: true,
  text: t('quizUnmute'),
  onclick: async () => {
    await globalThis.WV.send('wv:quiz:unmute').catch(() => {});
    renderQuiz();
  },
});
const quizFacts = h('dl', { class: 'facts' });
const quizTestResult = h('p', { class: 'help', role: 'status' });
let quizDiagnostics = null;

async function renderQuiz() {
  const d = await getDiagnostics();
  quizDiagnostics = d;
  quizVerdict.textContent = d.standingReason ? t('quizVerdictNo', [reasonText(d.standingReason, d)]) : t('quizVerdictYes', [d.nextAt ? timeText(d.nextAt) : t('quizDiagNotScheduled')]);
  quizVerdict.className = d.standingReason ? 'verdict no' : 'verdict yes';
  quizUnmute.hidden = !d.mutedUntil;

  // What the timer itself is doing; "Test now" leaves none of this behind.
  // The alarm is what wakes the extension up: a plan without one would never be carried out.
  const alarm = d.alarmAt ? t('quizDiagAlarmSet', [timeText(d.alarmAt)]) : t(d.enabled ? 'quizDiagAlarmMissing' : 'quizDiagAlarmOff');
  const facts = [
    ['quizDiagEnabled', t(d.enabled ? 'quizOn' : 'quizOff')],
    ['quizDiagCards', t('quizDiagCardsValue', [String(d.total), String(d.minCards)])],
    ['quizDiagAskable', t('quizDiagAskableValue', [String(d.askable), languages.name(d.targetLang), String(d.meanings), String(d.neededMeanings)])],
    ['quizDiagDue', String(d.due)],
    ['quizDiagInterval', intervalLabel(d.intervalMinutes)],
    ['quizDiagDisplay', d.displayOrder.map((method) => t(DISPLAY_NAMES[method])).join(' → ')],
    ['quizDiagNext', d.nextAt ? timeText(d.nextAt) : t('quizDiagNotScheduled')],
    ['quizDiagAlarm', alarm],
    ['quizDiagLastShown', d.lastShown ? `${timeText(d.lastShown.at)}: ${shownText(d.lastShown, d)}` : t('quizDiagNever')],
    ['quizDiagLastSkip', d.lastSkip ? `${timeText(d.lastSkip.at)}: ${skipText(d.lastSkip, d)}` : t('quizDiagNever')],
    ['quizDiagLastAnswer', lastAnswerText(d.lastAnswer)],
  ];
  quizFacts.replaceChildren(...facts.flatMap(([labelKey, value]) => [h('dt', { text: t(labelKey) }), h('dd', { text: value })]));
}

/**
 * "Test now": asks the background script to show a quiz the way the timer does, with the timer
 * and the conditions left out. Nothing is drawn from here: the quiz appears in the toolbar
 * popup, in its window, or as a card on this page, which can show one like any other page
 * (content/quiz.js is loaded here too). The line under the button says which way it went and why.
 */
async function testQuiz() {
  quizTestResult.textContent = '';
  let result;
  try {
    result = await globalThis.WV.send('wv:quiz:test');
  } catch {
    quizTestResult.textContent = t('quizTestFailed');
    return;
  }
  const diagnostics = quizDiagnostics || (await getDiagnostics());
  quizTestResult.textContent = result.ok ? t('quizTestShown', [shownText(result, diagnostics)]) : skipText(result, diagnostics);
}

const quizSection = h(
  'section',
  { class: 'card', id: 'quiz' },
  h('h2', { text: t('optQuizTitle') }),
  h('p', { class: 'help', text: t('optQuizHelp') }),
  h(
    'div',
    { class: 'fields' },
    switchRow(quizEnabled, 'optQuizEnabled', 'optQuizEnabledHelp'),
    fieldRow('optQuizInterval', 'optQuizIntervalHelp', quizInterval, quizIntervalCustomRow),
    fieldRow('optQuizQuestions', 'optQuizQuestionsHelp', quizQuestions),
    fieldRow('optQuizDisplay', 'optQuizDisplayHelp', quizDisplay),
    fieldRow('optQuizNotify', 'optQuizNotifyHelp', quizNotifyStatus, quizNotifyTry, quizNotifyButton),
    switchRow(quizAllowNotDue, 'optQuizAllowNotDue', 'optQuizAllowNotDueHelp'),
    fieldRow('optQuizMinCards', 'optQuizMinCardsHelp', quizMinCards),
    fieldRow('optQuizTimeout', 'optQuizTimeoutHelp', h('span', { class: 'inline' }, quizTimeout, h('span', { class: 'unit', text: t('optSeconds') }))),
  ),
  h('h3', { text: t('optQuizModes') }),
  h('p', { class: 'help', text: t('optQuizModesHelp') }),
  h(
    'div',
    { class: 'fields', id: 'quiz-modes' },
    switchRow(quizModeClassic, 'optQuizModeClassic', 'optQuizModeClassicHelp'),
    switchRow(quizModeWriting, 'optQuizModeWriting', 'optQuizModeWritingHelp'),
    switchRow(quizModeListening, 'optQuizModeListening', 'optQuizModeListeningHelp'),
    switchRow(quizModeMixed, 'optQuizModeMixed', 'optQuizModeMixedHelp'),
    switchRow(quizAccentTolerant, 'optQuizAccentTolerant', 'optQuizAccentTolerantHelp'),
    switchRow(quizListenAutoplay, 'optQuizListenAutoplay', 'optQuizListenAutoplayHelp'),
    fieldRow('optQuizListenChoices', 'optQuizListenChoicesHelp', quizListenChoices),
  ),
  h('h3', { text: t('quizDiagTitle') }),
  quizVerdict,
  quizFacts,
  h('div', { class: 'buttons' }, h('button', { class: 'wv-btn', type: 'button', 'data-action': 'test', text: t('quizTest'), onclick: testQuiz }), quizUnmute),
  h('p', { class: 'help', text: t('quizTestHelp') }),
  quizTestResult,
);

// --- Page ----------------------------------------------------------------------------------------

const ocrSection = createOcrSection({ flashSaved, switchRow, fieldRow });
const providerSection = createProviderSection({ flashSaved });
const cacheSection = createCacheSection();
const feedbackPanel = createFeedbackPanel();

// Two tabs: the settings, and "Contact and feedback". The address says which one is open
// (#feedback), so that it can be linked to and survives a reload.
const TABS = ['settings', 'feedback'];
const tabButtons = Object.fromEntries(
  TABS.map((name) => [name, h('button', { class: 'tab', type: 'button', role: 'tab', id: `tab-${name}`, 'aria-controls': `panel-${name}`, text: t(name === 'settings' ? 'tabSettings' : 'fbTitle'), onclick: () => selectTab(name, true) })]),
);
const panels = {
  settings: h(
    'div',
    { id: 'panel-settings', role: 'tabpanel', 'aria-labelledby': 'tab-settings' },
    // Only there when a support page is configured (config.js). (append() would write a null out as text.)
    supportCard() || '',
    h(
      'section',
      { class: 'card' },
      h('h2', { text: t('optTargetLang') }),
      h('p', { class: 'help', text: t('optTargetLangHelp') }),
      currentTarget,
      targetList.element,
    ),
    providerSection.element,
    h('section', { class: 'card' }, switchRow(doubleClick, 'optDoubleClick', 'optDoubleClickHelp')),
    // Only meaningful in the browsers where recordings replace the browser's voice. (append()
    // would write a `false` out as text, hence the empty string.)
    speech.usesRecordings ? h('section', { class: 'card' }, switchRow(ttsFallback, 'optTtsFallback', 'optTtsFallbackHelp')) : '',
    quizSection,
    ocrSection.element,
    backupSection,
    cacheSection.element,
  ),
  feedback: h('div', { id: 'panel-feedback', role: 'tabpanel', 'aria-labelledby': 'tab-feedback' }, feedbackPanel.element),
};

function selectTab(name, fromUser = false) {
  for (const tab of TABS) {
    tabButtons[tab].setAttribute('aria-selected', String(tab === name));
    tabButtons[tab].tabIndex = tab === name ? 0 : -1;
    panels[tab].hidden = tab !== name;
  }
  if (fromUser) history.replaceState(null, '', name === 'settings' ? location.pathname : `#${name}`);
}

const tabList = h('div', {
  class: 'tabs',
  role: 'tablist',
  onkeydown: (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const next = TABS[(TABS.findIndex((tab) => tabButtons[tab].getAttribute('aria-selected') === 'true') + 1) % TABS.length];
    selectTab(next, true);
    tabButtons[next].focus();
  },
}, Object.values(tabButtons));

document.getElementById('app').append(
  h(
    'header',
    { class: 'page-head' },
    h('img', { src: '../icons/icon-48.png', alt: '', width: '32', height: '32' }),
    h('h1', { text: t('optionsTitle') }),
    saved,
  ),
  tabList,
  panels.settings,
  panels.feedback,
);
selectTab(location.hash === '#feedback' ? 'feedback' : 'settings');

// The toolbar popup links here for importing.
if (location.hash === '#backup') {
  backupSection.classList.add('highlight');
  backupSection.scrollIntoView({ block: 'center' });
}

function render() {
  renderTarget();
  renderSwitches();
  renderQuizSettings();
  ocrSection.render();
  providerSection.render();
}
cacheSection.render();
feedbackPanel.render();
syncControls.render();

let settleTimer = 0;
render();
renderQuiz();
// The one-minute frequency is for watching the timer work, not for learning: it is only
// offered where the extension is loaded from its source (about:debugging, "Load unpacked").
chrome.management
  ?.getSelf()
  .then((self) => {
    developmentInstall = self.installType === 'development';
    if (developmentInstall) renderQuizSettings();
  })
  .catch(() => {});
// Settings can also change from the translation popup while this page is open; words are
// added and quizzes come due in the background.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) render();
  // What synchronisation is set to do, or how it is going, changed (the engine writes its status).
  if (changes.syncConfig || changes.syncStatus) syncControls.refresh();
  renderQuiz();
  // The timer writes its plan first and sets the alarm right after; look again once it has.
  clearTimeout(settleTimer);
  settleTimer = setTimeout(renderQuiz, 600);
});
// The panel shows times relative to now.
setInterval(renderQuiz, 20_000);
