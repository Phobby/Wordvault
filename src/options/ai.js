// The "AI" part of the options page: the one provider the AI features use (or none: they are
// off by default), its key, model and address, a test of them, how to get a key, and the lists
// of sites the features stay off or on.
//
// The key is written to chrome.storage.local from here and read from there by the background
// script. It goes nowhere else (ai/config.js).

import { DEFAULT_AI_CONFIG, PROMPT_SITES, getAiConfig, missing, settingsFor, updateAiConfig } from '../ai/config.js';
import { getAiProvider, listAiProviders } from '../ai/providers/index.js';
import { parseHostList } from '../ai/sites.js';

const { h, t } = globalThis.WV;

const OFF = '';
const isFirefox = chrome.runtime.getURL('').startsWith('moz-extension:');
/** What Ollama has to be told to accept this extension (its FAQ's wording, for this browser). */
const OLLAMA_ORIGINS = isFirefox ? 'moz-extension://*' : 'chrome-extension://*';

const TEST_ERRORS = {
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
  ai_missing_key: 'optAiMissingKey',
  ai_missing_model: 'optAiMissingModel',
  ai_missing_address: 'aiErrAddress',
  network: 'aiErrNetwork',
  timeout: 'aiErrTimeout',
};
/** The guide of each provider: message keys of its steps, and of the honest small print. */
const GUIDES = {
  gemini: { steps: ['optAiGeminiStep1', 'optAiGeminiStep2', 'optAiGeminiStep3'], notes: ['optAiGeminiFree', 'optAiGeminiData'] },
  anthropic: { steps: ['optAiClaudeStep1', 'optAiClaudeStep2', 'optAiClaudeStep3'], notes: ['optAiClaudePaid'] },
  openai: { steps: ['optAiOpenaiStep1', 'optAiOpenaiStep2', 'optAiOpenaiStep3'], notes: ['optAiOpenaiNote'] },
  ollama: { steps: ['optAiOllamaStep1', 'optAiOllamaStep2', 'optAiOllamaStep3'], notes: ['optAiOllamaLocal'] },
};

/**
 * @param {{ flashSaved: () => void, switchRow: Function, fieldRow: Function }} page  Helpers of the options page.
 * @returns {{ element: HTMLElement, render: () => Promise<void> }}
 */
export function createAiSection({ flashSaved, switchRow, fieldRow }) {
  let config = { ...DEFAULT_AI_CONFIG };

  const choices = Object.fromEntries(
    [OFF, ...listAiProviders().map((provider) => provider.id)].map((id) => [id, h('input', { type: 'radio', name: 'ai-provider', value: id, 'data-ai-provider': id || 'off', onchange: () => choose(id) })]),
  );
  const option = (id, titleText, helpKey) =>
    h('label', { class: 'sync-mode' }, choices[id], h('span', { class: 'switch-text' }, h('strong', { text: titleText }), h('span', { class: 'help', text: t(helpKey) })));

  const key = h('input', { type: 'password', id: 'ai-key', autocomplete: 'off', spellcheck: 'false', 'data-ai': 'key', onchange: () => saveFields() });
  const reveal = h('button', {
    class: 'wv-btn wv-btn-sm',
    type: 'button',
    'aria-controls': 'ai-key',
    'aria-pressed': 'false',
    text: t('optKeyShow'),
    onclick: () => {
      const shown = key.type === 'text';
      key.type = shown ? 'password' : 'text';
      reveal.textContent = t(shown ? 'optKeyShow' : 'optKeyHide');
      reveal.setAttribute('aria-pressed', String(!shown));
    },
  });
  const base = h('input', { type: 'url', id: 'ai-base', autocomplete: 'off', spellcheck: 'false', 'data-ai': 'base', onchange: () => saveFields() });
  const model = h('input', { type: 'text', id: 'ai-model', autocomplete: 'off', spellcheck: 'false', 'data-ai': 'model', onchange: () => saveFields() });
  const keyRow = h('label', { class: 'fb-field' }, h('span', { class: 'fb-label' }, h('strong', { text: t('optAiKey') }), h('span', { class: 'help', 'data-ai': 'key-help' })), h('span', { class: 'provider-key' }, key, reveal));
  const baseRow = h('label', { class: 'fb-field' }, h('span', { class: 'fb-label' }, h('strong', { text: t('optAiBase') }), h('span', { class: 'help', text: t('optAiBaseHelp') })), base);
  const modelRow = h('label', { class: 'fb-field' }, h('span', { class: 'fb-label' }, h('strong', { text: t('optAiModel') }), h('span', { class: 'help', 'data-ai': 'model-help' })), model);
  const status = h('p', { class: 'provider-status', role: 'status', 'data-ai': 'status', hidden: true });
  const test = h('button', { class: 'wv-btn', type: 'button', 'data-action': 'ai-test', text: t('optAiTest'), onclick: () => runTest() });
  const guide = h('details', { class: 'provider-guide' });
  const ollamaNote = h('div', { class: 'ai-ollama', hidden: true }, h('p', { class: 'help', text: t('optAiOllamaOrigins') }), h('code', { class: 'ai-code', text: `OLLAMA_ORIGINS=${OLLAMA_ORIGINS} ollama serve` }), h('p', { class: 'help', text: t('optAiOllamaMac', [`launchctl setenv OLLAMA_ORIGINS "${OLLAMA_ORIGINS}"`]) }));
  const panel = h('div', { class: 'provider-panel', 'data-ai': 'panel', hidden: true }, keyRow, baseRow, modelRow, h('div', { class: 'buttons' }, test), status, ollamaNote, guide);

  // What applies whichever provider is chosen.
  const consent = h('p', { class: 'help', 'data-ai': 'consent' });
  const withdraw = h('button', { class: 'wv-btn wv-btn-sm', type: 'button', text: t('optAiConsentWithdraw'), hidden: true, onclick: () => save({ consent: '' }) });
  const cache = h('input', {
    type: 'checkbox',
    'data-ai': 'cache',
    onchange: async () => {
      await save({ cache: cache.checked });
      if (!cache.checked) globalThis.WV.send('wv:ai:forget').catch(() => {});
    },
  });
  const promptSite = h('select', { 'data-ai': 'prompt-site', onchange: () => save({ promptSite: promptSite.value }) }, ...Object.entries(PROMPT_SITES).map(([id, site]) => h('option', { value: id, text: site.name })));
  const list = (name) => {
    const area = h('textarea', { rows: '3', spellcheck: 'false', autocomplete: 'off', 'data-ai': name, placeholder: 'example.com', onchange: () => save({ [name]: parseHostList(area.value) }) });
    return area;
  };
  const blocked = list('blocked');
  const allowed = list('allowed');
  const listRow = (titleKey, helpKey, area) => h('label', { class: 'fb-field' }, h('span', { class: 'fb-label' }, h('strong', { text: t(titleKey) }), h('span', { class: 'help', text: t(helpKey) })), area);

  const element = h(
    'section',
    { class: 'card', id: 'ai' },
    h('h2', { text: t('optAiTitle') }),
    h('p', { class: 'help', text: t('optAiHelp') }),
    h(
      'div',
      { class: 'sync-modes' },
      option(OFF, t('optAiOff'), 'optAiOffHelp'),
      option('gemini', getAiProvider('gemini').name, 'optAiGeminiHelp'),
      option('anthropic', getAiProvider('anthropic').name, 'optAiClaudeHelp'),
      option('openai', t('optAiOpenai'), 'optAiOpenaiHelp'),
      option('ollama', getAiProvider('ollama').name, 'optAiOllamaHelp'),
    ),
    panel,
    h('h3', { text: t('optAiPrivacyTitle') }),
    h('p', { class: 'help', text: t('optAiPrivacy') }),
    h('div', { class: 'buttons' }, consent, withdraw),
    switchRow(cache, 'optAiCache', 'optAiCacheHelp'),
    listRow('optAiBlocked', 'optAiBlockedHelp', blocked),
    listRow('optAiAllowed', 'optAiAllowedHelp', allowed),
    fieldRow('optAiPromptSite', 'optAiPromptSiteHelp', promptSite),
  );

  const say = (text, error = false) => {
    status.hidden = !text;
    status.textContent = text;
    status.classList.toggle('bad', error);
  };

  async function save(patch) {
    config = await updateAiConfig(patch);
    flashSaved();
    await render();
  }

  /** What is typed into the fields of the chosen provider. */
  const typed = () => ({ apiKey: key.value.trim(), baseUrl: base.value.trim(), model: model.value.trim() });

  async function saveFields() {
    const provider = getAiProvider(config.provider);
    if (!provider) return;
    await save({ providers: { ...config.providers, [provider.id]: typed() } });
  }

  /**
   * Asks the browser to let the extension reach the provider's address. Called first thing in
   * a click or change handler: Firefox only shows the question while it still knows that the
   * user did something.
   */
  function askPermission(provider, stored) {
    const origins = provider.origins(settingsFor(provider, stored));
    return origins.length > 0 ? chrome.permissions.request({ origins }).catch(() => false) : Promise.resolve(false);
  }

  async function choose(id) {
    const provider = getAiProvider(id);
    // The address of a provider that has one of its own is known now; one the user types is asked for at "Test".
    const allowed = provider && !provider.needsBase ? askPermission(provider, config.providers[id]) : null;
    say('');
    await save({ provider: provider ? provider.id : OFF });
    if (allowed && !(await allowed)) say(t('optAiDenied'), true);
  }

  async function runTest() {
    const provider = getAiProvider(config.provider);
    if (!provider) return;
    const settings = typed();
    const allowed = askPermission(provider, settings);
    const lacking = missing(provider, settingsFor(provider, settings));
    if (lacking) {
      say(t(TEST_ERRORS[`ai_missing_${lacking}`]), true);
      return;
    }
    await saveFields();
    if (!(await allowed)) {
      say(t('optAiDenied'), true);
      return;
    }
    test.disabled = true;
    status.hidden = false;
    status.classList.remove('bad');
    status.replaceChildren(h('span', { class: 'wv-spinner' }), ' ', t('optAiTesting'));
    try {
      const answer = await globalThis.WV.send('wv:ai:test', { provider: provider.id, settings });
      say(t('optAiOk', [provider.name, answer.model]));
    } catch (error) {
      const known = TEST_ERRORS[error?.code];
      // The provider's own words for what we have no name for; they never hold the key.
      say(`${t(known || 'aiErrUnknown', [provider.name])}${(!known || error?.code === 'ai_request' || error?.code === 'ai_overloaded') && error?.detail ? ` (${error.detail})` : ''}`, true);
    } finally {
      test.disabled = false;
    }
  }

  function renderGuide(provider) {
    const texts = GUIDES[provider.id];
    guide.replaceChildren(
      h('summary', { text: t(provider.needsKey ? 'optAiGuideKey' : 'optAiGuideSetup') }),
      h('ol', null, ...texts.steps.map((step) => h('li', { text: t(step) }))),
      ...texts.notes.map((note) => h('p', { class: 'help', text: t(note) })),
      provider.keyPage ? h('p', { class: 'help' }, h('a', { href: provider.keyPage, target: '_blank', rel: 'noopener noreferrer', text: provider.keyPage.replace(/^https:\/\//, '') })) : '',
    );
  }

  async function render() {
    config = await getAiConfig();
    const provider = getAiProvider(config.provider);
    for (const [id, input] of Object.entries(choices)) input.checked = id === (provider ? provider.id : OFF);
    panel.hidden = !provider;
    if (provider) {
      const stored = config.providers[provider.id] || {};
      if (document.activeElement !== key) key.value = stored.apiKey || '';
      if (document.activeElement !== base) base.value = stored.baseUrl || '';
      if (document.activeElement !== model) model.value = stored.model || '';
      // Ollama takes no key at all; an OpenAI-compatible server on this computer may not either.
      keyRow.hidden = provider.id === 'ollama';
      keyRow.querySelector('[data-ai="key-help"]').textContent = t(provider.needsKey ? 'optAiKeyHelp' : 'optAiKeyOptional');
      baseRow.hidden = !provider.needsBase;
      base.placeholder = provider.defaultBase;
      model.placeholder = provider.defaultModel || t(provider.id === 'ollama' ? 'optAiModelExampleOllama' : 'optAiModelExample');
      modelRow.querySelector('[data-ai="model-help"]').textContent = provider.defaultModel ? t('optAiModelHelpDefault', [provider.defaultModel]) : t('optAiModelHelp');
      ollamaNote.hidden = provider.id !== 'ollama';
      renderGuide(provider);
    }
    const agreed = getAiProvider(config.consent);
    consent.textContent = agreed ? t('optAiConsentGiven', [agreed.name]) : t('optAiConsentNone');
    withdraw.hidden = !agreed;
    cache.checked = config.cache !== false;
    promptSite.value = PROMPT_SITES[config.promptSite] ? config.promptSite : 'chatgpt';
    if (document.activeElement !== blocked) blocked.value = config.blocked.join('\n');
    if (document.activeElement !== allowed) allowed.value = config.allowed.join('\n');
  }

  return { element, render };
}
