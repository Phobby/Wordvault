'use strict';

// "Translate this page with AI" (experimental), on the page: a small card at the side of the
// window. It is put into a tab only when its user asks for it.
//
// Opening the card sends nothing. It counts the page's visible text (collect.js), shows how
// much that is, in how many requests it would go and to which provider, and waits for
// "Translate". The text then goes chunk by chunk, and each answer is put in place as it
// comes. "Show original" puts everything back; so does closing the card.
//
// Text that appears on the page later (a page that loads more as it is scrolled) is never sent
// by itself: the card says that there is new text and how much, and the user decides.

(function (WV) {
  if (!WV.supported || WV.pageTranslateCard) return;
  const { h, t, icon } = WV;
  const { collect, chunksOf, itemsOf, sizeOf, createLedger } = WV.pageTranslate;

  const ICON_CLOSE = 'M6 6l12 12M18 6L6 18';
  const ICON_TRANSLATE = 'M4 6h9M8.5 4v2M11 6c-.6 3.4-2.9 6.2-6.5 8M6.5 9.5c1 1.9 2.6 3.4 4.8 4.5M12.5 20l4-9 4 9M14 17h5';
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
  const DETAILED = new Set(['ai_request', 'ai_overloaded']);
  const TO_SETTINGS = new Set(['ai_auth', 'ai_model', 'ai_origin', 'ai_permission', 'ai_address']);
  /** Less visible text than this is not worth a request. */
  const MIN_CHARS = 20;
  /** New text is looked for this long after the page last changed, and is only mentioned from this much on. */
  const SETTLE_MS = 1500;
  const NEW_TEXT_CHARS = 80;

  const CSS = `
    .wv-pt {
      position: fixed;
      /* (the summary card is at the top of the same side) */
      bottom: 16px;
      right: 16px;
      display: flex;
      flex-direction: column;
      width: min(340px, calc(100vw - 32px));
      max-height: calc(100vh - 32px);
      border: 1px solid var(--wv-border);
      border-radius: 12px;
      background: var(--wv-bg);
      color: var(--wv-fg);
      box-shadow: var(--wv-shadow);
      font-size: 13px;
      animation: wv-pt-in 0.14s ease-out;
    }
    @keyframes wv-pt-in { from { opacity: 0; transform: translateY(4px); } }
    @media (prefers-reduced-motion: reduce) { .wv-pt { animation: none; } }
    .wv-pt-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 8px 6px 12px; border-bottom: 1px solid var(--wv-border); }
    .wv-pt-head .wv-icon { color: var(--wv-accent); }
    .wv-pt-title { flex: 1; min-width: 0; margin: 0; font-size: 13.5px; font-weight: 650; }
    .wv-pt-tag { flex: none; padding: 1px 6px; border-radius: 999px; background: var(--wv-tint); color: var(--wv-muted); font-size: 11px; font-weight: 600; }
    .wv-pt-body { flex: 1; min-height: 0; overflow: hidden auto; overscroll-behavior: contain; padding: 10px 12px 12px; }
    .wv-pt-facts { margin: 0 0 8px; padding: 8px 10px; border-radius: 8px; background: var(--wv-tint); }
    .wv-pt-facts div + div { margin-top: 3px; }
    .wv-pt-note { margin: 8px 0 0; color: var(--wv-muted); font-size: 12.5px; overflow-wrap: anywhere; }
    .wv-pt-note:first-child { margin-top: 0; }
    .wv-pt-note.wv-pt-strong { color: var(--wv-fg); }
    .wv-pt-error { color: var(--wv-danger); }
    .wv-pt-detail { margin-top: 4px; color: var(--wv-muted); font-size: 12px; overflow-wrap: anywhere; }
    .wv-pt-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
    .wv-pt-loading { display: flex; align-items: center; gap: 8px; color: var(--wv-muted); }
    .wv-pt-bar { height: 4px; margin-top: 8px; border-radius: 2px; background: var(--wv-hover); overflow: hidden; }
    .wv-pt-bar span { display: block; height: 100%; background: var(--wv-accent); transition: width 0.2s ease-out; }
  `;

  let ui = null; // { surface, card, body }
  /** What the card shows: { step, ... }; null while it is closed. */
  let state = null;
  /** The translation under way or done: { chunks, next, ledger, plan, skipped, shown, left }. Lives as long as the card. */
  let job = null;
  let observer = null;
  let settle = 0;
  /** True while we change text ourselves: the observer must not take that for the page's doing. */
  let writing = false;

  const number = (value) => Number(value || 0).toLocaleString(WV.languages?.uiLanguage?.() || undefined);
  const button = (labelKey, onclick, extra = {}) => h('button', { class: 'wv-btn wv-btn-sm', type: 'button', text: t(labelKey), onclick, ...extra });
  const openSettings = () => WV.send('wv:ai:open-settings').catch(() => {});
  /** (the width is set as a property: a page's content security policy can forbid style attributes) */
  const bar = (share) => {
    const fill = h('span');
    fill.style.width = `${Math.round(share * 100)}%`;
    return h('div', { class: 'wv-pt-bar' }, fill);
  };

  function build() {
    const surface = WV.createSurface(CSS);
    const body = h('div', { class: 'wv-pt-body' });
    const card = h(
      'section',
      { class: 'wv-pt', role: 'dialog', 'aria-label': t('ptTitle') },
      h(
        'header',
        { class: 'wv-pt-head' },
        icon(ICON_TRANSLATE),
        h('h2', { class: 'wv-pt-title', text: t('ptTitle') }),
        h('span', { class: 'wv-pt-tag', text: t('ptExperimental') }),
        h('button', { class: 'wv-btn-icon', type: 'button', title: t('ptCloseHint'), 'aria-label': t('popupClose'), 'data-action': 'pt-close', onclick: close }, icon(ICON_CLOSE)),
      ),
      body,
    );
    surface.root.append(card);
    return { surface, card, body };
  }

  function render() {
    if (!ui || !state) return;
    const note = (text, extra = '') => h('p', { class: `wv-pt-note ${extra}`.trim(), text });
    const row = (...children) => h('div', { class: 'wv-pt-row' }, ...children.filter(Boolean));
    let children = [];
    if (state.step === 'reading') {
      children = [h('div', { class: 'wv-pt-loading' }, h('span', { class: 'wv-spinner' }), t('sumReading'))];
    } else if (state.step === 'empty') {
      children = [note(t('ptNoText'), 'wv-pt-strong'), row(button('popupClose', close))];
    } else if (state.step === 'site') {
      children = [note(t(state.detail === 'blocked' ? 'aiSiteBlocked' : 'aiSiteSensitive'), 'wv-pt-strong'), row(button('aiOpenSettings', openSettings), button('popupClose', close))];
    } else if (state.step === 'setup') {
      children = [note(t('aiNeedsKey'), 'wv-pt-strong'), row(button('aiOpenSettings', openSettings), button('popupClose', close))];
    } else if (state.step === 'confirm') {
      const { plan } = job;
      children = [
        h(
          'div',
          { class: 'wv-pt-facts', 'data-role': 'pt-facts' },
          h('div', { text: t('ptSize', [number(job.chars)]) }),
          h('div', { text: job.chunks.length === 1 ? t('sumOnePart') : t('ptRequests', [number(job.chunks.length)]) }),
          h('div', { text: t('ptInto', [WV.languages?.name?.(plan.targetLang) || plan.targetLang]) }),
        ),
        job.left > 0 && note(t('ptTruncated', [number(job.chars), number(job.total)]), 'wv-pt-strong'),
        note(t(plan.consent ? 'ptSendsTo' : 'ptConsent', [plan.provider.name, plan.provider.model])),
        note(t('ptCost')),
        row(button(plan.consent ? 'ptGo' : 'ptAgreeGo', () => run(true), { class: 'wv-btn wv-btn-primary', 'data-action': 'pt-go' }), button('aiCancel', close)),
      ];
    } else if (state.step === 'working') {
      const total = job.chunks.length;
      children = [
        h('div', { class: 'wv-pt-loading', role: 'status' }, h('span', { class: 'wv-spinner' }), t('ptWorking', [number(Math.min(job.next + 1, total)), number(total)])),
        bar(job.next / total),
        row(button('aiCancel', cancel, { 'data-action': 'pt-cancel' })),
      ];
    } else if (state.step === 'error') {
      const code = state.error?.code || 'internal';
      children = [
        h('div', { class: 'wv-pt-error', role: 'alert', text: t(ERRORS[code] || 'aiErrUnknown', [job?.plan?.provider?.name || '']) }),
        (!ERRORS[code] || DETAILED.has(code)) && state.error?.detail ? h('div', { class: 'wv-pt-detail', text: String(state.error.detail).slice(0, 300) }) : null,
        job && job.next > 0 && note(t('ptPartDone', [number(job.next), number(job.chunks.length)])),
        row(
          job && job.next < job.chunks.length && button('ptContinue', () => run(false), { 'data-action': 'pt-continue' }),
          TO_SETTINGS.has(code) && button('aiOpenSettings', openSettings),
          job && job.ledger.count() > 0 && button('ptShowOriginal', showOriginal, { 'data-action': 'pt-original' }),
          button('popupClose', close),
        ),
      ];
    } else if (state.step === 'paused') {
      // "Cancel" half way: what is translated stays until the user says otherwise.
      children = [
        note(t('ptPartDone', [number(job.next), number(job.chunks.length)]), 'wv-pt-strong'),
        row(button('ptContinue', () => run(false), { 'data-action': 'pt-continue' }), button(job.shown ? 'ptShowOriginal' : 'ptShowTranslation', job.shown ? showOriginal : showTranslation, { 'data-action': 'pt-toggle' })),
      ];
    } else if (state.step === 'done') {
      children = [
        note(t(job.shown ? 'ptDone' : 'ptOriginalShown'), 'wv-pt-strong'),
        job.skipped > 0 && note(t('ptSkipped', [number(job.skipped)])),
        job.left > 0 && note(t('ptLeftOut')),
        state.fresh > 0 && job.shown && note(t('ptNewText', [number(state.fresh)]), 'wv-pt-strong'),
        row(
          button(job.shown ? 'ptShowOriginal' : 'ptShowTranslation', job.shown ? showOriginal : showTranslation, { class: 'wv-btn wv-btn-sm wv-btn-primary', 'data-action': 'pt-toggle' }),
          state.fresh > 0 && job.shown && button('ptTranslateNew', translateNew, { 'data-action': 'pt-new' }),
        ),
        note(t('aiBy', [job.plan.provider.name, job.plan.provider.model])),
        note(t('ptCloseHint')),
      ];
    }
    ui.body.replaceChildren(...children.filter(Boolean));
  }

  /** Our own changes of text, which the observer must not count. */
  function write(change) {
    writing = true;
    try {
      change();
    } finally {
      // (the observer is told of them after this turn: the flag stays up until then)
      observer?.takeRecords();
      writing = false;
    }
  }

  /** Counts the page's text and asks how it is to be cut. Sends nothing. */
  async function prepare() {
    const mine = (state = { step: 'reading' });
    render();
    await new Promise((resolve) => setTimeout(resolve, 30)); // the card is drawn before a large page is read
    if (state !== mine) return;
    try {
      const plan = await WV.send('wv:ai:page:plan');
      if (state !== mine) return;
      if (plan.site !== 'ok') state = { step: 'site', detail: plan.site };
      else if (!plan.ready || !plan.provider) state = { step: 'setup' };
      else {
        const groups = collect();
        const cut = chunksOf(groups, plan);
        if (cut.chars < MIN_CHARS) state = { step: 'empty' };
        else {
          job = { plan, chunks: cut.chunks, chars: cut.chars, total: cut.total, left: cut.left, next: 0, ledger: createLedger(), skipped: 0, shown: true };
          state = { step: 'confirm' };
        }
      }
    } catch (error) {
      if (state !== mine) return;
      state = { step: 'error', error };
    }
    render();
  }

  /**
   * Sends the chunks that are left, one after the other, and puts each answer in place.
   * @param {boolean} agree  The user pressed the button under the notice.
   */
  async function run(agree) {
    if (!job) return;
    if (!job.shown) showTranslation(); // continuing shows what there is
    const mine = (state = { step: 'working', requestId: '' });
    render();
    while (job.next < job.chunks.length) {
      const chunk = job.chunks[job.next];
      const requestId = `pt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      mine.requestId = requestId;
      let answer;
      try {
        answer = await WV.send('wv:ai:page:chunk', { items: itemsOf(chunk), title: document.title, requestId, agree });
      } catch (error) {
        if (state !== mine) return;
        if (error?.code === 'aborted') state = job.next > 0 ? { step: 'paused' } : { step: 'confirm' };
        else if (error?.code === 'ai_consent') {
          job.plan = { ...job.plan, consent: false };
          state = { step: 'confirm' };
        } else if (error?.code === 'ai_site') state = { step: 'site', detail: error.detail };
        else if (error?.code === 'ai_not_configured') state = { step: 'setup' };
        else state = { step: 'error', error };
        render();
        return;
      }
      if (state !== mine) return; // closed or cancelled meanwhile: the answer is not used
      job.plan = { ...job.plan, consent: true };
      write(() => (job.skipped += job.ledger.apply(chunk, answer.items)));
      job.next += 1;
      render();
    }
    state = { step: 'done', fresh: 0 };
    render();
    watch();
  }

  function cancel() {
    if (state?.requestId) WV.send('wv:ai:cancel', { requestId: state.requestId }).catch(() => {});
  }

  function showOriginal() {
    write(() => job.ledger.restore());
    job.shown = false;
    render();
  }

  function showTranslation() {
    write(() => job.ledger.showAgain());
    job.shown = true;
    render();
  }

  // --- Text that comes later -------------------------------------------------------------------

  /** Text on the page that shows no translation of ours. */
  const freshGroups = () => collect((node) => job.ledger.has(node));

  function watch() {
    if (observer || !document.body) return;
    observer = new MutationObserver(() => {
      if (writing || state?.step !== 'done' || !job?.shown) return;
      clearTimeout(settle);
      settle = setTimeout(() => {
        if (state?.step !== 'done' || !job?.shown) return;
        const chars = freshGroups().reduce((sum, group) => sum + sizeOf(group), 0);
        const fresh = chars >= NEW_TEXT_CHARS ? chars : 0;
        if (fresh !== state.fresh) {
          state.fresh = fresh;
          render();
        }
      }, SETTLE_MS);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function unwatch() {
    clearTimeout(settle);
    observer?.disconnect();
    observer = null;
  }

  /** "Translate it too": the new text, counted again now, goes the same way. The button is the user's go-ahead. */
  function translateNew() {
    const cut = chunksOf(freshGroups(), { ...job.plan, maxChars: job.plan.maxChars });
    if (cut.chunks.length === 0) {
      state.fresh = 0;
      return render();
    }
    job.chunks = [...job.chunks.slice(0, job.next), ...cut.chunks];
    job.left = cut.left;
    return run(false);
  }

  // --- Opening and closing ---------------------------------------------------------------------

  function close() {
    cancel();
    unwatch();
    if (job) write(() => job.ledger.restore()); // the page is as it was
    job?.ledger.clear();
    job = null;
    state = null;
    ui?.surface.unmount();
  }

  function open() {
    if (state) return true; // already open: it stays as it is
    ui ||= build();
    ui.surface.mount(document.body);
    prepare();
    return true;
  }

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && state && ui?.surface.containsEvent(event)) close();
    },
    true,
  );

  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id || message?.type !== 'wv:page-translate:open') return undefined;
      sendResponse(open());
      return undefined;
    });
  } catch {
    // the extension was reloaded underneath this page
  }

  WV.pageTranslateCard = { open, close, isOpen: () => Boolean(state) };
})(globalThis.WV);
