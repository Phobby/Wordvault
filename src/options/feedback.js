// "Contact and feedback": a form, a preview of exactly what would be sent, and only then the
// sending itself (done by the background script). No e-mail program is opened. Nothing leaves
// before the user has seen the data and pressed "Send".

import { feedbackEndpoint } from '../config.js';
import { clearErrorLog, getErrorLog } from '../features/feedback/error-log.js';
import { FEATURES, LIMITS, TYPES, buildPayload, cleanText, validateDraft } from '../features/feedback/payload.js';
import { endpointOrigin, getCooldown } from '../features/feedback/send.js';
import { collectTechInfo } from '../features/feedback/tech-info.js';

const { h, t } = globalThis.WV;

const DRAFT_KEY = 'feedbackDraft';
const EMPTY_DRAFT = Object.freeze({ type: 'bug', feature: 'bubble', message: '', email: '', tech: true, errors: false });

const TYPE_NAMES = { bug: 'fbTypeBug', idea: 'fbTypeIdea', other: 'fbTypeOther' };
const FEATURE_NAMES = { bubble: 'fbFeatureBubble', captions: 'fbFeatureCaptions', quiz: 'fbFeatureQuiz', sync: 'fbFeatureSync', settings: 'fbFeatureSettings', other: 'fbFeatureOther' };
const PROBLEMS = { message_short: 'fbProblemShort', message_long: 'fbProblemLong', email: 'fbProblemEmail' };
const ERRORS = {
  network: 'fbErrNetwork',
  timeout: 'fbErrNetwork',
  feedback_server: 'fbErrServer',
  feedback_rejected: 'fbErrRejected',
  feedback_rate: 'fbErrRate',
  feedback_cooldown: 'fbErrCooldown',
  feedback_permission: 'fbErrPermission',
  feedback_unconfigured: 'fbNotConfigured',
  feedback_invalid: 'fbErrRejected',
};

/**
 * What Firefox's own consent asks about (data_collection_permissions): the text the user
 * wrote always; technical data and an e-mail address only when this message carries them.
 */
export function dataCategories(payload) {
  const categories = ['personalCommunications'];
  if (payload.tech || payload.errors) categories.push('technicalAndInteraction');
  if (payload.email) categories.push('personallyIdentifyingInfo');
  return categories;
}

/** @returns {{ element: HTMLElement, render: () => Promise<void> }} */
export function createFeedbackPanel() {
  const endpoint = feedbackEndpoint();
  let draft = { ...EMPTY_DRAFT };
  let payload = null; // what the preview shows, while it shows
  let dataConsent = false; // this browser asks about data itself (Firefox 140+)
  let cooldownTimer = 0;

  // --- form ---
  const type = h('select', { id: 'fb-type', onchange: () => edit({ type: type.value }) }, TYPES.map((value) => h('option', { value, text: t(TYPE_NAMES[value]) })));
  const feature = h('select', { id: 'fb-feature', onchange: () => edit({ feature: feature.value }) }, FEATURES.map((value) => h('option', { value, text: t(FEATURE_NAMES[value]) })));
  const counter = h('span', { class: 'unit fb-counter' });
  const message = h('textarea', { id: 'fb-message', rows: '7', maxlength: String(LIMITS.messageMax), placeholder: t('fbMessagePlaceholder'), oninput: () => edit({ message: message.value }) });
  const email = h('input', { id: 'fb-email', type: 'email', autocomplete: 'email', maxlength: String(LIMITS.emailMax), placeholder: t('fbEmailPlaceholder'), oninput: () => edit({ email: email.value }) });
  const tech = h('input', { type: 'checkbox', onchange: () => edit({ tech: tech.checked }) });
  const errors = h('input', { type: 'checkbox', onchange: () => edit({ errors: errors.checked }) });
  const errorsHelp = h('span', { class: 'help' });
  const clearLog = h('button', {
    class: 'wv-link',
    type: 'button',
    text: t('fbClearLog'),
    hidden: true,
    onclick: async () => {
      await clearErrorLog();
      renderLog();
    },
  });
  const problem = h('p', { class: 'fb-problem', role: 'alert', hidden: true });
  const showPreview = h('button', { class: 'wv-btn wv-btn-primary', type: 'button', 'data-action': 'preview', text: t('fbShowData'), onclick: () => openPreview() });

  const field = (labelKey, helpKey, control) =>
    h('label', { class: 'fb-field' }, h('span', { class: 'fb-label' }, h('strong', { text: t(labelKey) }), helpKey && h('span', { class: 'help', text: t(helpKey) })), control);
  const check = (input, titleKey, help) => h('label', { class: 'switch' }, input, h('span', { class: 'switch-text' }, h('strong', { text: t(titleKey) }), help));

  const form = h(
    'div',
    { class: 'fb-form' },
    h('div', { class: 'fb-row' }, field('fbType', null, type), field('fbFeature', null, feature)),
    h('label', { class: 'fb-field' }, h('span', { class: 'fb-label fb-label-row' }, h('strong', { text: t('fbMessage') }), counter), message),
    field('fbEmail', 'fbEmailHelp', email),
    check(tech, 'fbTech', h('span', { class: 'help', text: t('fbTechHelp') })),
    check(errors, 'fbErrors', h('span', { class: 'fb-errors-help' }, errorsHelp, ' ', clearLog)),
    problem,
    h('div', { class: 'buttons' }, showPreview),
    h('p', { class: 'help', text: t('fbNothingSentYet') }),
  );

  // --- preview ---
  const json = h('pre', { class: 'fb-json', tabindex: '0', 'aria-label': t('fbPreviewTitle') });
  const destination = h('p', { class: 'help' });
  const status = h('p', { class: 'fb-status', role: 'status', hidden: true });
  const send = h('button', { class: 'wv-btn wv-btn-primary', type: 'button', 'data-action': 'send', text: t('fbSend'), onclick: () => submit() });
  const back = h('button', { class: 'wv-btn', type: 'button', 'data-action': 'back', text: t('fbBack'), onclick: () => show('form') });
  const preview = h('div', { class: 'fb-preview', hidden: true }, h('h3', { text: t('fbPreviewTitle') }), h('p', { class: 'help', text: t('fbPreviewHelp') }), json, destination, status, h('div', { class: 'buttons' }, send, back));

  // --- done ---
  const done = h(
    'div',
    { class: 'fb-done', hidden: true, role: 'status' },
    h('p', { class: 'verdict yes', text: t('fbSent') }),
    h('div', { class: 'buttons' }, h('button', { class: 'wv-btn', type: 'button', 'data-action': 'again', text: t('fbAnother'), onclick: () => show('form') })),
  );

  const element = h('section', { class: 'card', id: 'feedback' }, h('h2', { text: t('fbTitle') }), h('p', { class: 'help', text: t('fbHelp') }), form, preview, done);

  function show(view) {
    form.hidden = view !== 'form';
    preview.hidden = view !== 'preview';
    done.hidden = view !== 'done';
    if (view !== 'preview') payload = null;
    clearInterval(cooldownTimer);
    if (view === 'form') renderLog();
  }

  /** A change of the form: kept at once, so that a draft survives a closed tab or a failed sending. */
  function edit(patch) {
    draft = { ...draft, ...patch };
    problem.hidden = true;
    renderCounter();
    chrome.storage.local.set({ [DRAFT_KEY]: draft }).catch(() => {});
  }

  function renderCounter() {
    const length = [...cleanText(draft.message)].length;
    counter.textContent = `${length} / ${LIMITS.messageMax}`;
    counter.classList.toggle('bad', length > 0 && length < LIMITS.messageMin);
  }

  async function renderLog() {
    const count = (await getErrorLog()).length;
    errorsHelp.textContent = t(count > 0 ? 'fbErrorsHelpCount' : 'fbErrorsHelpNone', { count });
    clearLog.hidden = count === 0;
  }

  async function openPreview() {
    const problems = validateDraft(draft).filter((code) => PROBLEMS[code]);
    if (problems.length > 0) {
      problem.textContent = t(PROBLEMS[problems[0]], { min: LIMITS.messageMin, max: LIMITS.messageMax });
      problem.hidden = false;
      (problems[0] === 'email' ? email : message).focus();
      return;
    }
    const [techInfo, log, all] = await Promise.all([draft.tech ? collectTechInfo() : null, draft.errors ? getErrorLog() : null, chrome.permissions.getAll().catch(() => ({}))]);
    payload = buildPayload({ draft, tech: techInfo, errors: log });
    dataConsent = Array.isArray(all.data_collection);
    json.textContent = JSON.stringify(payload, null, 2);
    destination.textContent = endpoint ? t('fbDestination', { host: new URL(endpoint).hostname }) : t('fbNotConfigured');
    status.hidden = true;
    show('preview');
    renderSend();
    cooldownTimer = setInterval(renderSend, 1000);
    json.focus();
  }

  async function renderSend(busy = false) {
    const left = endpoint ? await getCooldown() : 0;
    send.disabled = busy || !endpoint || left > 0;
    back.disabled = busy;
    send.textContent = left > 0 ? t('fbSendIn', { seconds: Math.ceil(left / 1000) }) : t('fbSend');
  }

  function fail(code, detail) {
    status.className = 'fb-status bad';
    status.textContent = t(ERRORS[code] || 'fbErrServer', { reason: String(detail || ''), seconds: String(detail || '') });
    status.hidden = false;
  }

  async function submit() {
    if (!payload || !endpoint) return;
    const sending = payload;
    // Straight from the click, with nothing awaited before it: the browser only shows its
    // prompt for a user action. Asked for: the receiver's host and no other; in Firefox also
    // the kinds of data this message carries.
    const request = { origins: [endpointOrigin(endpoint)] };
    if (dataConsent) request.data_collection = dataCategories(sending);
    const allowed = chrome.permissions.request(request).catch(() => false);
    send.disabled = true;
    back.disabled = true;
    if (!(await allowed)) {
      fail('feedback_permission');
      renderSend();
      return;
    }
    status.className = 'fb-status';
    status.replaceChildren(h('span', { class: 'wv-spinner' }), ' ', t('fbSending'));
    status.hidden = false;
    try {
      await globalThis.WV.send('wv:feedback:send', sending);
    } catch (error) {
      // The draft is still in storage and in the form; "Send" tries again.
      fail(error?.code, error?.detail);
      renderSend();
      return;
    }
    draft = { ...EMPTY_DRAFT, type: draft.type, feature: draft.feature, email: draft.email, tech: draft.tech };
    await chrome.storage.local.remove(DRAFT_KEY).catch(() => {});
    fill();
    show('done');
  }

  function fill() {
    type.value = draft.type;
    feature.value = draft.feature;
    message.value = draft.message;
    email.value = draft.email;
    tech.checked = draft.tech;
    errors.checked = draft.errors;
    renderCounter();
  }

  return {
    element,
    async render() {
      const stored = (await chrome.storage.local.get(DRAFT_KEY))[DRAFT_KEY];
      if (stored && typeof stored === 'object') {
        draft = {
          type: TYPES.includes(stored.type) ? stored.type : EMPTY_DRAFT.type,
          feature: FEATURES.includes(stored.feature) ? stored.feature : EMPTY_DRAFT.feature,
          message: String(stored.message || '').slice(0, LIMITS.messageMax),
          email: String(stored.email || '').slice(0, LIMITS.emailMax),
          tech: stored.tech !== false,
          errors: stored.errors === true,
        };
      }
      fill();
      renderLog();
    },
  };
}
