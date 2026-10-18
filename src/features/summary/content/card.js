'use strict';

// "Summarise this page", on the page: a card at the side of the window. It is put into a tab
// only when its user asks for a summary (features/summary/background.js).
//
// Opening the card sends nothing. It reads the page's main text (extract.js), shows how much
// that is, in how many parts it would go and to which provider, and waits for "Summarise".
// The answer is shown as text (textContent): nothing in it is markup, a link, or an
// instruction to this extension.

(function (WV) {
  if (!WV.supported || WV.summaryCard) return;
  const { h, t, icon } = WV;

  const ICON_CLOSE = 'M6 6l12 12M18 6L6 18';
  const ICON_SUMMARY = 'M5 6h14M5 10h14M5 14h9M5 18h6';
  const LENGTHS = ['short', 'medium', 'detailed'];
  const LENGTH_LABELS = { short: 'sumShort', medium: 'sumMedium', detailed: 'sumDetailed' };
  const ERRORS = {
    ai_auth: 'aiErrAuth',
    ai_quota: 'aiErrQuota',
    ai_model: 'aiErrModel',
    ai_overloaded: 'aiErrOverloaded',
    ai_origin: 'aiErrOrigin',
    ai_permission: 'aiErrPermission',
    ai_request: 'aiErrRequest',
    ai_refused: 'aiErrRefused',
    ai_empty: 'aiErrEmpty',
    ai_bad_answer: 'aiErrEmpty',
    ai_address: 'aiErrAddress',
    network: 'aiErrNetwork',
    timeout: 'aiErrTimeout',
    context_invalidated: 'errContextInvalidated',
  };
  /** With these the provider's own words are shown too. (They never hold the key: ai/http.js.) */
  const DETAILED = new Set(['ai_request', 'ai_overloaded']);
  const RETRYABLE = new Set(['network', 'timeout', 'ai_overloaded', 'ai_quota', 'ai_empty', 'ai_bad_answer']);
  const TO_SETTINGS = new Set(['ai_auth', 'ai_model', 'ai_origin', 'ai_permission', 'ai_address']);

  const CSS = `
    .wv-sum {
      position: fixed;
      top: 16px;
      right: 16px;
      display: flex;
      flex-direction: column;
      width: min(400px, calc(100vw - 32px));
      max-height: calc(100vh - 32px);
      border: 1px solid var(--wv-border);
      border-radius: 12px;
      background: var(--wv-bg);
      color: var(--wv-fg);
      box-shadow: var(--wv-shadow);
      font-size: 13px;
      animation: wv-sum-in 0.14s ease-out;
    }
    @keyframes wv-sum-in { from { opacity: 0; transform: translateY(-4px); } }
    @media (prefers-reduced-motion: reduce) { .wv-sum { animation: none; } }
    .wv-sum-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 10px 8px 8px 14px; border-bottom: 1px solid var(--wv-border); }
    .wv-sum-head .wv-icon { color: var(--wv-accent); }
    .wv-sum-title { flex: 1; min-width: 0; margin: 0; font-size: 14px; font-weight: 650; }
    .wv-sum-body { flex: 1; min-height: 0; overflow: hidden auto; overscroll-behavior: contain; padding: 12px 14px 14px; }
    .wv-sum-page { margin: 0 0 8px; font-weight: 600; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
    .wv-sum-facts { margin: 0 0 8px; padding: 8px 10px; border-radius: 8px; background: var(--wv-tint); }
    .wv-sum-facts div + div { margin-top: 3px; }
    .wv-sum-note { margin: 8px 0 0; color: var(--wv-muted); font-size: 12.5px; overflow-wrap: anywhere; }
    .wv-sum-note:first-child { margin-top: 0; }
    .wv-sum-note.wv-sum-warn { color: var(--wv-fg); }
    .wv-sum-error { color: var(--wv-danger); font-size: 13px; }
    .wv-sum-detail { margin-top: 4px; color: var(--wv-muted); font-size: 12px; overflow-wrap: anywhere; }
    .wv-sum-lengths { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
    .wv-sum-lengths-label { color: var(--wv-muted); font-size: 12.5px; }
    .wv-sum-seg { display: inline-flex; border: 1px solid var(--wv-border); border-radius: 8px; overflow: hidden; }
    .wv-sum-seg button { margin: 0; padding: 4px 10px; border: 0; border-inline-start: 1px solid var(--wv-border); background: transparent; color: var(--wv-fg); font: inherit; font-size: 12.5px; cursor: pointer; }
    .wv-sum-seg button:first-child { border-inline-start: 0; }
    .wv-sum-seg button:hover { background: var(--wv-hover); }
    .wv-sum-seg button[aria-pressed="true"] { background: var(--wv-accent); color: var(--wv-accent-fg); font-weight: 600; }
    .wv-sum-seg button:focus-visible { outline: 2px solid var(--wv-accent); outline-offset: -2px; }
    .wv-sum-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; }
    .wv-sum-loading { display: flex; align-items: center; gap: 8px; color: var(--wv-muted); }
    .wv-sum-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.55; }
    .wv-sum-offscreen { position: fixed; left: -9999px; top: 0; width: 1px; height: 1px; opacity: 0; }
  `;

  let ui = null; // { surface, card, body }, built on first use
  /** What the card shows: { step, ... }. null while it is closed. */
  let state = null;
  /** The page's text as it was read when the card was opened. Kept only while the card is open. */
  let page = null;

  const button = (labelKey, onclick, extra = {}) => h('button', { class: 'wv-btn wv-btn-sm', type: 'button', text: t(labelKey), onclick, ...extra });
  const openSettings = () => WV.send('wv:ai:open-settings').catch(() => {});

  function build() {
    const surface = WV.createSurface(CSS);
    const body = h('div', { class: 'wv-sum-body' });
    const card = h(
      'section',
      { class: 'wv-sum', role: 'dialog', 'aria-label': t('sumTitle') },
      h(
        'header',
        { class: 'wv-sum-head' },
        icon(ICON_SUMMARY),
        h('h2', { class: 'wv-sum-title', text: t('sumTitle') }),
        h('button', { class: 'wv-btn-icon', type: 'button', title: t('popupClose'), 'aria-label': t('popupClose'), 'data-action': 'sum-close', onclick: close }, icon(ICON_CLOSE)),
      ),
      body,
    );
    surface.root.append(card);
    return { surface, card, body };
  }

  function render() {
    if (!ui || !state) return;
    const note = (text, extra = '') => h('p', { class: `wv-sum-note ${extra}`.trim(), text });
    const row = (...children) => h('div', { class: 'wv-sum-row' }, ...children.filter(Boolean));
    let children = [];
    if (state.step === 'reading') {
      children = [h('div', { class: 'wv-sum-loading' }, h('span', { class: 'wv-spinner' }), t('sumReading'))];
    } else if (state.step === 'empty') {
      children = [note(t('sumNoText'), 'wv-sum-warn'), row(button('popupClose', close))];
    } else if (state.step === 'site') {
      children = [note(t(state.detail === 'blocked' ? 'aiSiteBlocked' : 'aiSiteSensitive'), 'wv-sum-warn'), row(button('aiOpenSettings', openSettings), button('popupClose', close))];
    } else if (state.step === 'setup') {
      children = [note(t('aiNeedsKey'), 'wv-sum-warn'), row(button('aiOpenSettings', openSettings), button('popupClose', close))];
    } else if (state.step === 'confirm') {
      const { plan } = state;
      children = [
        page.title && h('p', { class: 'wv-sum-page', dir: 'auto', text: page.title }),
        h(
          'div',
          { class: 'wv-sum-facts', 'data-role': 'sum-facts' },
          h('div', { text: t('sumSize', { count: plan.chars }) }),
          h('div', { text: plan.parts > 1 ? t('sumParts', { parts: plan.parts, requests: plan.requests }) : t('sumOnePart') }),
        ),
        plan.truncated && note(t('sumTruncated', { limit: plan.chars, total: plan.total }), 'wv-sum-warn'),
        // The first time for this provider: what agreeing means. Afterwards: where it goes.
        note(t(plan.consent ? 'sumSendsTo' : 'sumConsent', { provider: plan.provider.name, model: plan.provider.model })),
        h(
          'div',
          { class: 'wv-sum-lengths' },
          h('span', { class: 'wv-sum-lengths-label', text: t('sumLength') }),
          h(
            'div',
            { class: 'wv-sum-seg', role: 'group', 'aria-label': t('sumLength') },
            LENGTHS.map((length) =>
              h('button', {
                type: 'button',
                'aria-pressed': String(state.length === length),
                'data-length': length,
                text: t(LENGTH_LABELS[length]),
                onclick: () => {
                  state.length = length;
                  render();
                },
              }),
            ),
          ),
        ),
        row(button(plan.consent ? 'sumGo' : 'sumAgreeGo', () => run(true), { class: 'wv-btn wv-btn-primary', 'data-action': 'sum-go' }), button('aiCancel', close)),
      ];
    } else if (state.step === 'working') {
      const text = state.total > 1 ? t('sumWorkingParts', { provider: state.provider, current: Math.min(state.done + 1, state.total), total: state.total }) : t('sumWorking', { provider: state.provider });
      children = [h('div', { class: 'wv-sum-loading', role: 'status' }, h('span', { class: 'wv-spinner' }), text), row(button('aiCancel', cancel, { 'data-action': 'sum-cancel' }))];
    } else if (state.step === 'error') {
      const code = state.error?.code || 'internal';
      children = [
        h('div', { class: 'wv-sum-error', role: 'alert', text: t(ERRORS[code] || 'aiErrUnknown', { provider: state.provider || '' }) }),
        (!ERRORS[code] || DETAILED.has(code)) && state.error?.detail ? h('div', { class: 'wv-sum-detail', text: String(state.error.detail).slice(0, 300) }) : null,
        row(RETRYABLE.has(code) && button('popupRetry', () => run(false)), TO_SETTINGS.has(code) && button('aiOpenSettings', openSettings), button('popupClose', close)),
      ];
    } else if (state.step === 'done') {
      children = [
        h('div', { class: 'wv-sum-text', dir: 'auto', tabindex: '0', 'data-role': 'sum-text', text: state.text }),
        row(
          button('passageCopy', copy, { 'data-action': 'sum-copy' }),
          button('sumAgain', again, { 'data-action': 'sum-again', title: t('sumAgainHint') }),
          state.flash && h('span', { class: 'wv-status', role: 'status', text: state.flash }),
        ),
        note(t('aiBy', { provider: state.provider || '', model: state.model || '' })),
        state.truncated && note(t('sumWasTruncated', { limit: state.chars })),
      ];
    }
    ui.body.replaceChildren(...children.filter(Boolean));
  }

  /** Reads the page and asks what a summary of it would send. Sends nothing. */
  async function prepare() {
    const mine = (state = { step: 'reading' });
    render();
    // (a moment for the card to be drawn: reading a large page takes a while)
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (state !== mine) return;
    try {
      page = WV.pageText.extract();
    } catch {
      page = { text: '', title: '', from: 'none' };
    }
    if (!page.text) {
      state = { step: 'empty' };
      render();
      return;
    }
    try {
      const plan = await WV.send('wv:ai:summary:plan', { text: page.text });
      if (state !== mine) return;
      if (plan.site !== 'ok') state = { step: 'site', detail: plan.site };
      else if (!plan.ready || !plan.provider) state = { step: 'setup' };
      else state = { step: 'confirm', plan, length: plan.length };
    } catch (error) {
      if (state !== mine) return;
      state = { step: 'error', error, provider: '' };
    }
    render();
  }

  /** @param {boolean} agree  The user pressed the button under the notice. */
  async function run(agree) {
    if (!state || !page?.text) return;
    const provider = state.plan?.provider?.name || state.provider || '';
    const requestId = `sum-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const mine = (state = { step: 'working', provider, requestId, done: 0, total: state.plan?.requests || state.total || 1, length: state.length, plan: state.plan });
    render();
    try {
      const answer = await WV.send('wv:ai:summarize', { text: page.text, title: page.title, length: mine.length, requestId, agree });
      if (state !== mine) return;
      state = { step: 'done', text: answer.text, provider: answer.provider.name, model: answer.provider.model, truncated: answer.truncated, chars: answer.chars, length: answer.length, plan: mine.plan };
    } catch (error) {
      if (state !== mine) return;
      // "Cancel" brings the question back; so does an agreement that was withdrawn meanwhile.
      if (error?.code === 'aborted' || error?.code === 'ai_consent') return void prepare();
      if (error?.code === 'ai_site') state = { step: 'site', detail: error.detail };
      else if (error?.code === 'ai_not_configured') state = { step: 'setup' };
      else if (error?.code === 'empty') state = { step: 'empty' };
      else state = { step: 'error', error, provider, length: mine.length, plan: mine.plan, total: mine.total };
    }
    render();
  }

  function cancel() {
    if (state?.requestId) WV.send('wv:ai:cancel', { requestId: state.requestId }).catch(() => {});
  }

  /** Back to the question, to ask for another length. Nothing is sent by going back. */
  function again() {
    if (!state?.plan) return void prepare();
    state = { step: 'confirm', plan: { ...state.plan, consent: true }, length: state.length };
    render();
  }

  async function copy() {
    const mine = state;
    let copied = false;
    try {
      await navigator.clipboard.writeText(mine.text);
      copied = true;
    } catch {
      // Pages that are not served securely have no clipboard API: the old way, on a field of
      // our own that is gone at once.
      const field = h('textarea', { class: 'wv-sum-offscreen', 'aria-hidden': 'true', tabindex: '-1' });
      field.value = mine.text;
      ui.card.append(field);
      try {
        field.select();
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      }
      field.remove();
    }
    if (state !== mine) return;
    state.flash = t(copied ? 'passageCopied' : 'passageCopyFailed');
    render();
  }

  function close() {
    cancel();
    state = null;
    page = null; // the page's text is not kept beyond the card
    ui?.surface.unmount();
  }

  function open() {
    ui ||= build();
    ui.surface.mount(document.body);
    prepare();
    return true;
  }

  // The interface language changed: the card is built again in it, as it stands.
  WV.i18n.onChange(() => {
    if (!ui) return;
    ui.surface.unmount();
    ui = build();
    if (state) {
      ui.surface.mount(document.body);
      render();
    }
  });

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && state && ui?.surface.containsEvent(event)) close();
    },
    true,
  );

  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id) return undefined;
      if (message?.type === 'wv:summary:open') {
        sendResponse(open());
      } else if (message?.type === 'wv:summary:progress' && state?.step === 'working' && message.requestId === state.requestId) {
        state.done = Number(message.done) || 0;
        state.total = Number(message.total) || state.total;
        render();
      }
      return undefined;
    });
  } catch {
    // the extension was reloaded underneath this page
  }

  WV.summaryCard = { open, close, isOpen: () => Boolean(state) };
})(globalThis.WV);
