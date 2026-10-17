// Options page. It edits the same stored settings every other part of the extension reads
// (lib/settings.js); nothing is kept here.

import { createAiSection } from './ai.js';
import { createFeedbackPanel } from './feedback.js';
import { createOcrSection } from './ocr.js';
import { createPassageSection } from './passage.js';
import { createCacheSection, createProviderSection } from './provider.js';
import { catchUncaught } from '../features/feedback/error-log.js';
import { supportCard } from '../support/support.js';
import { downloadBackup, restoreBackup } from '../lib/backup.js';
import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../lib/settings.js';
import { getPreferences, setTargetLanguage } from '../lib/translator.js';
import { DIFFICULTIES } from '../quiz/difficulty.js';
import { INTERVAL_MINUTES, LEARNED_STREAK, QUESTIONS_PER_QUIZ, TIMEOUT_SECONDS, getDiagnostics } from '../quiz/scheduler.js';
import { DAILY_GOAL } from '../quiz/streak.js';
import { createProgressPanel } from '../quiz/progress-panel.js';
import { createShortcutsSection } from './shortcuts.js';
import { createSyncControls } from './sync.js';

const { h, t, languages, speech } = globalThis.WV;

await globalThis.WV.i18n.startPage();
globalThis.WV.adoptStyles(globalThis.WV.styles.tokens + globalThis.WV.styles.controls + globalThis.WV.styles.progress);
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

// --- Interface language --------------------------------------------------------------------------
// The language of Wordvault's own text, independent of the language translations are made into.
// Each language is listed by its own name. Choosing one switches every open part of Wordvault
// (this page reloads itself: shared/i18n.js, startPage).

const uiLanguage = h('select', {
  id: 'ui-language',
  'aria-label': t('optUiLang'),
  onchange: async () => {
    await globalThis.WV.i18n.setLanguage(uiLanguage.value);
    flashSaved();
  },
});

async function renderUiLanguage() {
  const { i18n } = globalThis.WV;
  const browser = i18n.resolve('', i18n.browserLanguage());
  const nameOf = (code) => i18n.LANGUAGES.find((language) => language.code === code)?.name || code;
  uiLanguage.replaceChildren(
    h('option', { value: '', text: t('optUiLangAuto', { language: nameOf(browser) }) }),
    ...i18n.LANGUAGES.map(({ code, name }) => h('option', { value: code, lang: code, dir: i18n.dir(code), text: name })),
  );
  uiLanguage.value = await i18n.getChoice();
}

// --- Target language -----------------------------------------------------------------------------
// A drop-down of the languages the active translation service offers, by name.

const targetSelect = h('select', {
  id: 'target-language',
  'aria-label': t('optTargetLang'),
  onchange: async () => {
    if (!targetSelect.value) return; // "Browser language" is what is in force until one is chosen
    await setTargetLanguage(targetSelect.value);
    flashSaved();
  },
});

async function renderTarget() {
  const prefs = await getPreferences();
  if (document.activeElement !== targetSelect) {
    const locale = languages.uiLanguage();
    const named = prefs.languages.map((code) => ({ code, label: languages.name(code) })).sort((a, b) => a.label.localeCompare(b.label, locale));
    // Not chosen yet: the browser's language is used until it is, and the list says so first.
    const auto = prefs.targetChosen ? [] : [h('option', { value: '', text: t('optTargetLangAuto', { language: languages.name(prefs.targetLang) }) })];
    targetSelect.replaceChildren(...auto, ...named.map(({ code, label }) => h('option', { value: code, text: label })));
    targetSelect.value = prefs.targetChosen ? prefs.targetLang : '';
  }
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
    h('span', { class: 'switch-text' }, h('strong', { text: t(titleKey) }), helpKey && h('span', { class: 'help', text: t(helpKey) })),
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
      backupStatus.textContent = t('bkImported', { added: added, duplicates: skipped, failed: invalid });
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
        backupStatus.textContent = t('bkExported', { count: await downloadBackup() });
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
let developmentInstall = false;

function intervalLabel(minutes) {
  if (minutes === 1) return t('quizEveryMinute');
  if (minutes % 60 !== 0) return t('quizEveryMinutes', { count: minutes });
  return minutes === 60 ? t('quizEveryHour') : t('quizEveryHours', { count: minutes / 60 });
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

const quizSwitch = (key) => h('input', { type: 'checkbox', 'data-setting': key, onchange: (event) => saveQuiz({ [key]: event.target.checked }) });
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

const quizQuestions = h('input', {
  type: 'number',
  inputmode: 'numeric',
  min: String(QUESTIONS_PER_QUIZ.MIN),
  max: String(QUESTIONS_PER_QUIZ.MAX),
  step: '1',
  'data-setting': 'quizQuestionsPerQuiz',
  'aria-label': t('optQuizQuestions'),
  onchange: () => {
    const count = numberIn(quizQuestions, QUESTIONS_PER_QUIZ.MIN, QUESTIONS_PER_QUIZ.MAX);
    if (count !== null) saveQuiz({ quizQuestionsPerQuiz: count });
    else renderQuizSettings(quizQuestions);
  },
});
/** The way the quiz asks comes from the level chosen in the toolbar popup; said here, not chosen. */
const quizLevel = h('p', { class: 'help quiz-level' });

/** The ways a quiz can be shown (quiz/display.js) and their names. */
const DISPLAY_NAMES = { auto: 'quizDisplayAuto', popup: 'quizDisplayPopup', window: 'quizDisplayWindow', card: 'quizDisplayCard', notification: 'quizDisplayNotification' };
const quizDisplay = h(
  'select',
  { 'aria-label': t('optQuizDisplay'), onchange: () => saveQuiz({ quizDisplay: quizDisplay.value }) },
  ['auto', 'popup', 'window', 'card'].map((value) => h('option', { value, text: t(DISPLAY_NAMES[value]) })),
);

// Learned, the daily goal, the freeze, the evening reminder and the quiet hours.
const quizNumber = (key, limits, labelKey) => {
  const input = h('input', {
    type: 'number',
    inputmode: 'numeric',
    min: String(limits.MIN),
    max: String(limits.MAX),
    step: '1',
    'data-setting': key,
    'aria-label': t(labelKey),
    onchange: () => {
      const value = numberIn(input, limits.MIN, limits.MAX);
      if (value !== null) saveQuiz({ [key]: value });
      else renderQuizSettings(input);
    },
  });
  return input;
};
/** A time of day; emptied, it means "none" (the quiet hours) or the default (the reminder). */
const quizTime = (key, labelKey) => h('input', { type: 'time', 'data-setting': key, 'aria-label': t(labelKey), onchange: (event) => saveQuiz({ [key]: event.target.value }) });
const quizLearnedStreak = quizNumber('quizLearnedStreak', LEARNED_STREAK, 'optQuizLearnedStreak');
const quizLearnedNeedsOtherMode = quizSwitch('quizLearnedNeedsOtherMode');
const quizDailyGoal = quizNumber('quizDailyGoal', DAILY_GOAL, 'optQuizDailyGoal');
const quizFreezeEnabled = quizSwitch('quizFreezeEnabled');
const quizReminderEnabled = quizSwitch('quizReminderEnabled');
const quizReminderTime = quizTime('quizReminderTime', 'optQuizReminderTime');
const quizQuietStart = quizTime('quizQuietStart', 'optQuizQuietStart');
const quizQuietEnd = quizTime('quizQuietEnd', 'optQuizQuietEnd');
const quizReminderNote = h('span', { class: 'unit', role: 'status' });

// "Back to defaults": every quiz setting as it was when the extension was installed. Words,
// their history, the streak and the rank are not settings and stay as they are.
const quizResetStatus = h('span', { class: 'unit', role: 'status' });
const quizReset = h('button', {
  class: 'wv-btn',
  type: 'button',
  'data-action': 'reset-quiz',
  text: t('optQuizReset'),
  onclick: async () => {
    const defaults = Object.fromEntries(Object.entries(DEFAULT_SETTINGS).filter(([key]) => key.startsWith('quiz')));
    await saveQuiz(defaults);
    await renderQuizSettings();
    quizResetStatus.textContent = t('optQuizResetDone');
  },
});

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

/** @param {HTMLInputElement} [rejected]  A field whose content was not accepted and is put back. */
async function renderQuizSettings(rejected) {
  const [settings, d] = await Promise.all([getSettings(), getDiagnostics()]);
  // A field that is being typed in is left alone.
  const free = (field) => field === rejected || document.activeElement !== field;
  quizEnabled.checked = settings.quizEnabled;
  // Switched off, everything below the switch is greyed out and cannot be changed.
  quizBody.disabled = !settings.quizEnabled;
  quizAllowNotDue.checked = settings.quizAllowNotDue;
  quizAccentTolerant.checked = settings.quizAccentTolerant !== false;
  quizListenAutoplay.checked = settings.quizListenAutoplay !== false;
  quizListenChoices.value = settings.quizListenChoices === 'spelling' ? 'spelling' : 'meaning';
  quizLearnedNeedsOtherMode.checked = settings.quizLearnedNeedsOtherMode !== false;
  quizFreezeEnabled.checked = settings.quizFreezeEnabled !== false;
  quizReminderEnabled.checked = settings.quizReminderEnabled !== false;
  quizReminderTime.disabled = !quizReminderEnabled.checked;
  if (free(quizLearnedStreak)) quizLearnedStreak.value = String(Math.min(LEARNED_STREAK.MAX, Math.max(LEARNED_STREAK.MIN, Math.round(Number(settings.quizLearnedStreak)) || LEARNED_STREAK.DEFAULT)));
  if (free(quizDailyGoal)) quizDailyGoal.value = String(Math.min(DAILY_GOAL.MAX, Math.max(DAILY_GOAL.MIN, Math.round(Number(settings.quizDailyGoal)) || DAILY_GOAL.DEFAULT)));
  if (free(quizReminderTime)) quizReminderTime.value = /^\d{1,2}:\d{2}$/.test(settings.quizReminderTime || '') ? settings.quizReminderTime.padStart(5, '0') : '20:00';
  if (free(quizQuietStart)) quizQuietStart.value = settings.quizQuietStart || '';
  if (free(quizQuietEnd)) quizQuietEnd.value = settings.quizQuietEnd || '';
  // The reminder is a notification: without the permission it stays silent, and says so here.
  quizReminderNote.textContent = settings.quizReminderEnabled !== false && !d.notifications ? t('optQuizReminderNeedsPermission') : '';

  const minutes = d.intervalMinutes;
  const offered = [...(developmentInstall ? [INTERVAL_TESTING] : []), ...INTERVAL_PRESETS];
  const custom = !offered.includes(minutes);
  quizInterval.replaceChildren(
    ...offered.map((value) => h('option', { value: String(value), text: value === INTERVAL_TESTING ? t('quizEveryTesting') : intervalLabel(value) })),
    h('option', { value: 'custom', text: t('quizEveryCustom') }),
  );
  quizInterval.value = custom ? 'custom' : String(minutes);
  quizIntervalCustomRow.hidden = !custom;
  if (free(quizQuestions)) quizQuestions.value = String(d.questionsPerQuiz);
  quizLevel.textContent = t('optQuizLevel', { level: levelText(d.mode) });
  quizDisplay.value = d.display;
  quizNotifyButton.dataset.allowed = d.notifications ? 'yes' : 'no';
  quizNotifyButton.textContent = t(d.notifications ? 'optQuizNotifyRemove' : 'optQuizNotifyAllow');
  quizNotifyTry.hidden = !d.notifications;
  if (!d.notifications && quizNotifyStatus.textContent !== t('optQuizNotifyDenied')) quizNotifyStatus.textContent = '';
  else if (d.notifications && quizNotifyStatus.textContent === '') quizNotifyStatus.textContent = t('optQuizNotifyAllowed');
  if (free(quizIntervalCustom)) quizIntervalCustom.value = String(minutes);
  if (free(quizTimeout)) quizTimeout.value = String(d.timeoutSeconds);
}

/** "Hard (listening)": the level of the toolbar popup that asks in this way. */
function levelText(mode) {
  const level = DIFFICULTIES.find((candidate) => candidate.mode === mode) || DIFFICULTIES[0];
  return `${t(level.nameKey)} (${t(level.modeKey)})`;
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
  // stored by versions that waited for a number of words before the first quiz
  below_min_cards: 'quizWhyNoCards',
  not_enough_choices: 'quizWhyNotEnoughChoices',
  no_cards: 'quizWhyNoCards',
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
  quiet_hours: 'quizWhyQuietHours',
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
  return t(key, { language: languages.name(diagnostics.targetLang), meanings: diagnostics.meanings, needed: diagnostics.neededMeanings });
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
  return shown.tried?.length > 0 ? t('quizShownAfter', { method: how, failed: triedText(shown.tried, diagnostics) }) : how;
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
  quizProgress.render();
  const d = await getDiagnostics();
  quizDiagnostics = d;
  quizVerdict.textContent = d.standingReason ? t('quizVerdictNo', { reason: reasonText(d.standingReason, d) }) : t('quizVerdictYes', { time: d.nextAt ? timeText(d.nextAt) : t('quizDiagNotScheduled') });
  quizVerdict.className = d.standingReason ? 'verdict no' : 'verdict yes';
  quizUnmute.hidden = !d.mutedUntil;

  // What the timer itself is doing; "Test now" leaves none of this behind.
  // The alarm is what wakes the extension up: a plan without one would never be carried out.
  const alarm = d.alarmAt ? t('quizDiagAlarmSet', { time: timeText(d.alarmAt) }) : t(d.enabled ? 'quizDiagAlarmMissing' : 'quizDiagAlarmOff');
  const facts = [
    ['quizDiagEnabled', t(d.enabled ? 'quizOn' : 'quizOff')],
    ['quizDiagCards', String(d.total)],
    ['quizDiagMode', levelText(d.mode)],
    ['quizDiagAskable', t('quizDiagAskableValue', { words: d.askable, language: languages.name(d.targetLang), meanings: d.meanings, needed: d.neededMeanings })],
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
  quizTestResult.textContent = result.ok ? t('quizTestShown', { method: shownText(result, diagnostics) }) : skipText(result, diagnostics);
}

const quizProgress = createProgressPanel({ celebrateIn: null });
// Everything the switch in the heading turns off. A disabled fieldset greys out and locks all
// the controls inside it; "Why is there no quiz?" stays outside, since it says why.
// In view: how often, the daily goal and the evening reminder; the rest is under "Advanced".
const quizBody = h(
  'fieldset',
  { class: 'quiz-body' },
  h(
    'div',
    { class: 'fields' },
    fieldRow('optQuizInterval', null, quizInterval, quizIntervalCustomRow),
    fieldRow('optQuizDailyGoal', 'optQuizDailyGoalHelp', h('span', { class: 'inline' }, quizDailyGoal, h('span', { class: 'unit', text: t('optQuizQuestionsUnit') }))),
    // The reminder and its time in one row: the time only counts while the reminder is on.
    h('div', { class: 'field' }, switchRow(quizReminderEnabled, 'optQuizReminder', 'optQuizReminderHelp'), h('div', { class: 'field-control' }, quizReminderNote, quizReminderTime)),
  ),
  h(
    'details',
    { class: 'more' },
    h('summary', { text: t('optAdvanced') }),
    h('h4', { text: t('optQuizQuestionsTitle') }),
    h(
      'div',
      { class: 'fields', id: 'quiz-advanced' },
      fieldRow('optQuizQuestions', 'optQuizQuestionsHelp', quizQuestions),
      quizLevel,
      fieldRow('optQuizDisplay', 'optQuizDisplayHelp', quizDisplay),
      fieldRow('optQuizTimeout', null, h('span', { class: 'inline' }, quizTimeout, h('span', { class: 'unit', text: t('optSeconds') }))),
      switchRow(quizAllowNotDue, 'optQuizAllowNotDue', 'optQuizAllowNotDueHelp'),
      switchRow(quizAccentTolerant, 'optQuizAccentTolerant', 'optQuizAccentTolerantHelp'),
      switchRow(quizListenAutoplay, 'optQuizListenAutoplay', 'optQuizListenAutoplayHelp'),
      fieldRow('optQuizListenChoices', null, quizListenChoices),
      fieldRow('optQuizLearnedStreak', 'optQuizLearnedStreakHelp', quizLearnedStreak),
      switchRow(quizLearnedNeedsOtherMode, 'optQuizLearnedOther', 'optQuizLearnedOtherHelp'),
    ),
    h('h4', { text: t('optQuizStreakTitle') }),
    h(
      'div',
      { class: 'fields', id: 'quiz-goal-settings' },
      fieldRow('optQuizQuiet', 'optQuizQuietHelp', h('span', { class: 'inline' }, quizQuietStart, h('span', { class: 'unit', text: '–' }), quizQuietEnd)),
      switchRow(quizFreezeEnabled, 'optQuizFreeze', 'optQuizFreezeHelp'),
      fieldRow('optQuizNotify', 'optQuizNotifyHelp', quizNotifyStatus, quizNotifyTry, quizNotifyButton),
    ),
  ),
  h('div', { class: 'buttons' }, quizReset, quizResetStatus),
);
quizEnabled.setAttribute('role', 'switch');
quizEnabled.setAttribute('aria-labelledby', 'quiz-title');
const quizSection = h(
  'section',
  { class: 'card', id: 'quiz' },
  h('div', { class: 'card-head' }, h('h2', { id: 'quiz-title', text: t('optQuizTitle') }), h('label', { class: 'head-switch' }, quizEnabled)),
  quizProgress.element,
  quizBody,
  h(
    'details',
    { class: 'more', id: 'quiz-diagnostics' },
    h('summary', { text: t('quizDiagTitle') }),
    quizVerdict,
    quizFacts,
    h('div', { class: 'buttons' }, h('button', { class: 'wv-btn', type: 'button', 'data-action': 'test', text: t('quizTest'), onclick: testQuiz }), quizUnmute),
    h('p', { class: 'help', text: t('quizTestHelp') }),
    quizTestResult,
  ),
);

// --- Page ----------------------------------------------------------------------------------------

const ocrSection = createOcrSection({ flashSaved, switchRow });
// The rows about where and when translations are made open the "Translation settings" group.
const passageSection = createPassageSection({
  flashSaved,
  switchRow,
  leadRows: [
    fieldRow('optTargetLang', null, targetSelect),
    switchRow(doubleClick, 'optDoubleClick'),
    // Only meaningful in the browsers where recordings replace the browser's voice. (append()
    // would write a `false` out as text, hence the empty string.)
    speech.usesRecordings ? switchRow(ttsFallback, 'optTtsFallback', 'optTtsFallbackHelp') : '',
  ],
});
const shortcutsSection = createShortcutsSection();
const aiSection = createAiSection({ flashSaved, switchRow, fieldRow });
const providerSection = createProviderSection({ flashSaved });
const cacheSection = createCacheSection();
const feedbackPanel = createFeedbackPanel();
// The cache is kept data, like the vault's backup: it goes with it.
backupSection.append(cacheSection.element);

// One tab per subject. The address says which one is open (#quiz, #ai, ...), so that it can be
// linked to and survives a reload; the first tab has no address of its own.
const TABS = [
  { name: 'translation', labelKey: 'tabTranslation' },
  { name: 'quiz', labelKey: 'tabQuiz' },
  { name: 'ai', labelKey: 'tabAi' },
  { name: 'data', labelKey: 'tabData' },
  { name: 'feedback', labelKey: 'tabContact' },
];
const tabButtons = Object.fromEntries(
  TABS.map(({ name, labelKey }) => [name, h('button', { class: 'tab', type: 'button', role: 'tab', id: `tab-${name}`, 'aria-controls': `panel-${name}`, text: t(labelKey), onclick: () => selectTab(name, true) })]),
);
const panel = (name, ...content) => h('div', { id: `panel-${name}`, role: 'tabpanel', 'aria-labelledby': `tab-${name}` }, ...content);
const panels = {
  // The interface language on its own, then how and into what a translation is made, screen
  // translation, the shortcuts, and who translates.
  translation: panel(
    'translation',
    h(
      'section',
      { class: 'card', id: 'translation' },
      h('h2', { text: t('optTranslationTitle') }),
      h('div', { class: 'fields' }, fieldRow('optUiLang', null, uiLanguage)),
      passageSection.element,
      ocrSection.element,
      shortcutsSection.element,
      providerSection.element,
    ),
  ),
  quiz: panel('quiz', quizSection),
  ai: panel('ai', h('section', { class: 'card card-group' }, aiSection.element)),
  data: panel('data', backupSection),
  // Support is only there when a support page is configured (config.js); append() would write a null out as text.
  feedback: panel('feedback', feedbackPanel.element, supportCard() || ''),
};

function selectTab(name, fromUser = false) {
  for (const { name: tab } of TABS) {
    tabButtons[tab].setAttribute('aria-selected', String(tab === name));
    tabButtons[tab].tabIndex = tab === name ? 0 : -1;
    panels[tab].hidden = tab !== name;
  }
  if (fromUser) history.replaceState(null, '', name === TABS[0].name ? location.pathname : `#${name}`);
}

const tabList = h('div', {
  class: 'tabs',
  role: 'tablist',
  onkeydown: (event) => {
    const now = TABS.findIndex(({ name }) => tabButtons[name].getAttribute('aria-selected') === 'true');
    // The arrows follow the direction the page is written in.
    const forward = document.documentElement.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const back = forward === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';
    const moves = { [forward]: now + 1, [back]: now - 1 + TABS.length, Home: 0, End: TABS.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const { name } = TABS[moves[event.key] % TABS.length];
    selectTab(name, true);
    tabButtons[name].focus();
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
  ...Object.values(panels),
);
// Addresses other parts link to: "#ai" (the AI part of the translation popup), "#backup" (the toolbar popup, for importing).
const opened = location.hash.slice(1);
selectTab(opened === 'backup' ? 'data' : TABS.some(({ name }) => name === opened) ? opened : TABS[0].name);
if (opened === 'backup') {
  backupSection.classList.add('highlight');
  backupSection.scrollIntoView({ block: 'center' });
}

function render() {
  renderUiLanguage();
  renderTarget();
  renderSwitches();
  renderQuizSettings();
  ocrSection.render();
  passageSection.render();
  shortcutsSection.render();
  aiSection.render();
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
