// The "Translation service" part of the options page: which service translates (MyMemory,
// which needs nothing, or DeepL with the user's own key), the key, a test of the key and a
// short guide to getting one.
//
// The key is stored with the other settings in chrome.storage.local and nowhere else: it is
// not part of the backup, of synchronisation or of feedback.

import { matchSupported } from '../lib/languages.js';
import { getSettings, updateSettings } from '../lib/settings.js';
import { deeplOrigin } from '../providers/deepl.js';
import { DEFAULT_PROVIDER_ID, getProvider, listProviders } from '../providers/index.js';

const { h, t, languages } = globalThis.WV;

const DEEPL = 'deepl';
/** What the test can say, by error code. */
const CHECK_ERRORS = { auth: 'optDeeplBadKey', quota: 'optDeeplQuota', rate_limit: 'optDeeplBusy', network: 'optDeeplNetwork', timeout: 'optDeeplNetwork', no_key: 'optDeeplNoKey', provider_permission: 'optDeeplDenied' };

/**
 * @param {{ flashSaved: () => void }} page  Helpers of the options page.
 * @returns {{ element: HTMLElement, render: () => Promise<void> }}
 */
export function createProviderSection({ flashSaved }) {
  const number = (value) => Number(value).toLocaleString(languages.uiLanguage());
  const choices = Object.fromEntries(
    listProviders().map((provider) => [
      provider.id,
      h('input', { type: 'radio', name: 'provider', value: provider.id, onchange: () => choose(provider.id) }),
    ]),
  );

  const key = h('input', {
    type: 'password',
    id: 'deepl-key',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: t('optDeeplKeyPlaceholder'),
    onchange: () => saveKey(),
  });
  const reveal = h('button', {
    class: 'wv-btn wv-btn-sm',
    type: 'button',
    'aria-controls': 'deepl-key',
    'aria-pressed': 'false',
    text: t('optKeyShow'),
    onclick: () => {
      const shown = key.type === 'text';
      key.type = shown ? 'password' : 'text';
      reveal.textContent = t(shown ? 'optKeyShow' : 'optKeyHide');
      reveal.setAttribute('aria-pressed', String(!shown));
    },
  });
  const status = h('p', { class: 'provider-status', role: 'status', hidden: true });
  const test = h('button', { class: 'wv-btn', type: 'button', 'data-action': 'test-key', text: t('optDeeplTest'), onclick: () => testKey() });
  const warning = h('p', { class: 'ocr-warning', role: 'status', hidden: true });
  const backToDefault = h('button', { class: 'wv-btn wv-btn-sm', type: 'button', text: t('optProviderUse', [getProvider(DEFAULT_PROVIDER_ID).name]), onclick: () => choose(DEFAULT_PROVIDER_ID) });

  const deeplPanel = h(
    'div',
    { class: 'provider-panel', hidden: true },
    h('label', { class: 'fb-field' }, h('span', { class: 'fb-label' }, h('strong', { text: t('optDeeplKey') }), h('span', { class: 'help', text: t('optDeeplKeyHelp') })), h('span', { class: 'provider-key' }, key, reveal)),
    h('div', { class: 'buttons' }, test),
    status,
    h(
      'details',
      { class: 'provider-guide' },
      h('summary', { text: t('optDeeplGuideTitle') }),
      h('ol', null, h('li', { text: t('optDeeplGuide1') }), h('li', { text: t('optDeeplGuide2') }), h('li', { text: t('optDeeplGuide3') })),
      h('p', { class: 'help', text: t('optDeeplGuideCard') }),
      h('p', { class: 'help' }, h('a', { href: 'https://www.deepl.com/pro-api', target: '_blank', rel: 'noopener noreferrer', text: t('optDeeplGuideLink') })),
    ),
  );

  const option = (id, helpKey) =>
    h('label', { class: 'sync-mode' }, choices[id], h('span', { class: 'switch-text' }, h('strong', { text: getProvider(id).name }), h('span', { class: 'help', text: t(helpKey) })));

  const element = h(
    'section',
    { class: 'card', id: 'provider' },
    h('h2', { text: t('optProviderTitle') }),
    h('p', { class: 'help', text: t('optProviderHelp') }),
    h('div', { class: 'sync-modes' }, option(DEFAULT_PROVIDER_ID, 'optProviderMymemoryHelp'), option(DEEPL, 'optProviderDeeplHelp')),
    warning,
    deeplPanel,
  );

  function say(text, bad = false) {
    status.className = bad ? 'provider-status bad' : 'provider-status';
    status.textContent = text;
    status.hidden = !text;
  }

  async function choose(id) {
    await updateSettings({ provider: id });
    flashSaved();
    await render();
  }

  async function saveKey() {
    const settings = await getSettings();
    const apiKey = key.value.trim();
    if ((settings.providerConfig?.[DEEPL]?.apiKey || '') === apiKey) return;
    await updateSettings({ providerConfig: { ...settings.providerConfig, [DEEPL]: { apiKey } } });
    say('');
    flashSaved();
  }

  async function testKey() {
    const apiKey = key.value.trim();
    if (!apiKey) {
      say(t('optDeeplNoKey'), true);
      key.focus();
      return;
    }
    // Straight from the click: the browser only asks about a host for a user action. Asked
    // for is the one host this key is used at.
    const allowed = chrome.permissions.request({ origins: [deeplOrigin(apiKey)] }).catch(() => false);
    test.disabled = true;
    await saveKey();
    if (!(await allowed)) {
      say(t('optDeeplDenied'), true);
      test.disabled = false;
      return;
    }
    status.className = 'provider-status';
    status.replaceChildren(h('span', { class: 'wv-spinner' }), ' ', t('optDeeplTesting'));
    status.hidden = false;
    try {
      const usage = await globalThis.WV.send('wv:provider:check', { provider: DEEPL, config: { apiKey } });
      const plan = t(usage.plan === 'free' ? 'optDeeplPlanFree' : 'optDeeplPlanPro');
      say(usage.limit > 0 ? t('optDeeplOkUsage', [plan, number(usage.used), number(usage.limit)]) : t('optDeeplOk', [plan]));
    } catch (error) {
      say(t(CHECK_ERRORS[error?.code] || 'optDeeplFailed', [String(error?.detail || '')]), true);
    }
    test.disabled = false;
  }

  async function render() {
    const settings = await getSettings();
    const active = getProvider(settings.provider);
    for (const [id, input] of Object.entries(choices)) input.checked = id === active.id;
    deeplPanel.hidden = active.id !== DEEPL;
    if (document.activeElement !== key) key.value = settings.providerConfig?.[DEEPL]?.apiKey || '';
    // The language translations are made into is not one this service knows: said here, with
    // the way back, and said again in the translation popup.
    const supported = await active.getLanguages(settings.providerConfig?.[active.id] || {});
    const unsupported = settings.targetLang && !matchSupported(settings.targetLang, supported);
    warning.hidden = !unsupported;
    if (unsupported) warning.replaceChildren(t('optProviderLanguage', [active.name, languages.name(settings.targetLang)]), ' ', backToDefault);
  }

  return { element, render };
}
