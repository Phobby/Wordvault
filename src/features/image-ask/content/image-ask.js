'use strict';

// "Ask about the image", the part in the page: choose an area (the same way as the screen scan),
// have the background script take a picture of it, and offer a panel next to it with a preview of
// exactly that picture, a question, and the answer.
//
// Unlike the screen scan, this sends a picture: the part of the screen the user chose goes to the
// AI provider they set up, and only when they press "Ask" (and, the first time, agree to pictures
// going there). An area over a password field or a field they type into is not sent at all. If the
// model in use reads no pictures (ai/vision.js), the panel says so instead of sending anything.

(function (WV) {
  if (!WV.supported || !WV.ocrSelector || WV.imageAsk || window.top !== window) return;
  const { h, t, icon } = WV;

  const ICON_CLOSE = 'M6 6l12 12M18 6L6 18';
  const PANEL_WIDTH = 360;
  const GAP = 8;

  const CSS = `
    .wv-img-frame {
      position: fixed; pointer-events: none;
      border: 1.5px solid var(--wv-accent); border-radius: 3px;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.7);
    }
    .wv-img-panel {
      position: fixed; width: ${PANEL_WIDTH}px; max-width: calc(100vw - 16px); box-sizing: border-box;
      display: flex; flex-direction: column; gap: 8px; padding: 10px 12px;
      background: var(--wv-bg); color: var(--wv-fg); border: 1px solid var(--wv-border);
      border-radius: 10px; box-shadow: var(--wv-shadow); font-size: 13px; line-height: 1.45;
      max-height: calc(100vh - 16px); overflow: auto;
    }
    .wv-img-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: 600; }
    .wv-img-preview { max-width: 100%; max-height: 140px; align-self: flex-start; border-radius: 4px; border: 1px solid var(--wv-border); }
    .wv-img-question {
      width: 100%; box-sizing: border-box; min-height: 52px; resize: vertical; font: inherit;
      padding: 6px 8px; border-radius: 6px; border: 1px solid var(--wv-border); background: var(--wv-bg); color: var(--wv-fg);
    }
    .wv-img-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .wv-img-note { color: var(--wv-muted, inherit); font-size: 12px; }
    .wv-img-error { color: var(--wv-danger); }
    .wv-img-answer { white-space: pre-wrap; overflow-wrap: anywhere; }
  `;

  /** What an error is called in the panel. */
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
    ocr_forbidden: 'ocrErrForbidden',
    ocr_rate: 'ocrErrRate',
    ocr_capture: 'ocrErrCapture',
    image_empty: 'imageErrEmpty',
    context_invalidated: 'errContextInvalidated',
  };
  const SETTINGS_ERRORS = new Set(['ai_auth', 'ai_model', 'ai_origin', 'ai_permission', 'ai_address']);

  let ui = null;
  let state = null; // { area, image, overFields, step, provider, answer, error, requestId }
  let busy = false;

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  function viewportNow() {
    const visual = window.visualViewport;
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      scale: visual?.scale || 1,
      offsetLeft: visual?.offsetLeft || 0,
      offsetTop: visual?.offsetTop || 0,
    };
  }

  /** Whether the area covers a field the user types into (a password, a message): then nothing of it is sent. */
  function coversFields(area) {
    const right = area.x + area.width;
    const bottom = area.y + area.height;
    const fields = document.querySelectorAll('input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=image]), textarea, [contenteditable=""], [contenteditable="true"]');
    for (const field of fields) {
      const box = field.getBoundingClientRect();
      if (box.width > 0 && box.height > 0 && box.left < right && box.right > area.x && box.top < bottom && box.bottom > area.y) return true;
    }
    return false;
  }

  function build() {
    const surface = WV.createSurface(CSS);
    const frame = h('div', { class: 'wv-img-frame' });
    const panel = h('div', { class: 'wv-img-panel', role: 'dialog', 'aria-label': t('imageTitle') });
    surface.root.append(frame, panel);
    return { surface, frame, panel };
  }

  function place() {
    const { area } = state;
    Object.assign(ui.frame.style, { left: `${area.x}px`, top: `${area.y}px`, width: `${area.width}px`, height: `${area.height}px` });
    const width = Math.min(PANEL_WIDTH, window.innerWidth - 16);
    const height = ui.panel.offsetHeight || 240;
    // Beside the area where there is room, else below or above it, else over it.
    let left = area.x + area.width + GAP;
    let top = area.y;
    if (left + width > window.innerWidth - GAP) {
      left = area.x - GAP - width;
      if (left < GAP) {
        left = Math.min(Math.max(GAP, area.x), window.innerWidth - width - GAP);
        top = area.y + area.height + GAP + height <= window.innerHeight ? area.y + area.height + GAP : Math.max(GAP, area.y - GAP - height);
      }
    }
    top = Math.max(GAP, Math.min(top, window.innerHeight - height - GAP));
    Object.assign(ui.panel.style, { left: `${left}px`, top: `${top}px` });
  }

  const button = (labelKey, onclick, extra = {}) => h('button', { class: 'wv-btn wv-btn-sm', type: 'button', text: t(labelKey), onclick, ...extra });
  const note = (text, error = false) => h('div', { class: error ? 'wv-img-note wv-img-error' : 'wv-img-note', role: error ? 'alert' : null, text });
  const openSettings = () => WV.send('wv:ai:open-settings').catch(() => {});

  function render() {
    if (!ui || !state) return;
    const question = state.questionField || h('textarea', { class: 'wv-img-question', dir: 'auto', placeholder: t('imageQuestionPlaceholder'), 'aria-label': t('imageQuestionLabel'), onkeydown: onQuestionKey });
    state.questionField = question;
    const preview = state.image
      ? h('img', { class: 'wv-img-preview', alt: t('imagePreviewAlt'), src: `data:${state.image.mime};base64,${state.image.data}`, onerror: (event) => event.target.remove() })
      : null;
    const parts = [
      h('div', { class: 'wv-img-head' }, h('span', { text: t('imageTitle') }), h('button', { class: 'wv-btn-icon', type: 'button', title: t('ocrClose'), 'aria-label': t('ocrClose'), onclick: close }, icon(ICON_CLOSE))),
    ];
    if (state.step === 'capturing') {
      parts.push(h('div', { class: 'wv-loading' }, h('span', { class: 'wv-spinner' }), t('imageCapturing')));
    } else if (state.step === 'fields') {
      parts.push(preview, note(t('imageOverFields'), true));
    } else {
      parts.push(preview, note(t('imageWhatIsSent')), question);
      if (state.step === 'ready') parts.push(h('div', { class: 'wv-img-row' }, button('imageAsk', ask, { class: 'wv-btn wv-btn-sm wv-btn-primary', 'data-action': 'image-ask' })));
      if (state.step === 'setup') parts.push(note(t('aiNeedsKey')), h('div', { class: 'wv-img-row' }, button('aiOpenSettings', openSettings)));
      if (state.step === 'site') parts.push(note(t(state.detail === 'blocked' ? 'aiSiteBlocked' : 'aiSiteSensitive'), true), h('div', { class: 'wv-img-row' }, button('aiOpenSettings', openSettings)));
      if (state.step === 'novision') parts.push(note(t('imageNoVision', { provider: state.provider || '' }), true), h('div', { class: 'wv-img-row' }, button('aiOpenSettings', openSettings)));
      if (state.step === 'consent') {
        parts.push(
          note(t('imageConsent', { provider: state.provider || '' })),
          h('div', { class: 'wv-img-row' }, button('aiConsentYes', () => run(true), { class: 'wv-btn wv-btn-sm wv-btn-primary', 'data-action': 'image-agree' }), button('aiCancel', () => setStep('ready'))),
        );
      }
      if (state.step === 'loading') parts.push(h('div', { class: 'wv-loading' }, h('span', { class: 'wv-spinner' }), t('aiThinking', { provider: state.provider || '' })), h('div', { class: 'wv-img-row' }, button('aiCancel', cancel)));
      if (state.step === 'error') {
        const code = state.error?.code || 'internal';
        parts.push(
          note(t(ERRORS[code] || 'aiErrUnknown', { provider: state.provider || '' }), true),
          (code === 'ai_request' || code === 'ai_overloaded' || !ERRORS[code]) && state.error?.detail ? h('div', { class: 'wv-img-note', text: state.error.detail }) : null,
          // without a picture (it could not be taken) trying again means choosing the area again
          h('div', { class: 'wv-img-row' }, button('popupRetry', () => (state.image ? run(false) : start())), SETTINGS_ERRORS.has(code) && button('aiOpenSettings', openSettings)),
        );
      }
      if (state.step === 'done') {
        parts.push(
          h('div', { class: 'wv-ai-label', text: t('aiTitle') }),
          // Shown as text: nothing in an answer is markup or a link.
          h('div', { class: 'wv-img-answer', dir: 'auto', tabindex: '0', text: state.answer.text }),
          h('div', { class: 'wv-img-row' }, button('imageAskAgain', ask), button('passageCopy', copyAnswer), state.flash && h('span', { class: 'wv-status', role: 'status', text: state.flash })),
          note(t('aiBy', { provider: state.answer.provider.name, model: state.answer.provider.model })),
        );
      }
    }
    ui.panel.replaceChildren(...parts.filter(Boolean));
    place();
  }

  function setStep(step, extra = {}) {
    if (!state) return;
    Object.assign(state, { step, flash: '' }, extra);
    render();
  }

  function onQuestionKey(event) {
    if (event.isComposing) return;
    // Enter asks, Shift+Enter is a new line.
    if (event.key === 'Enter' && !event.shiftKey && ['ready', 'done', 'error'].includes(state?.step)) {
      event.preventDefault();
      ask();
    }
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || event.isComposing || !state) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (state.step === 'loading') cancel();
    else close();
  }

  /** "Ask": what stands in the way, if anything, is found out before the picture goes anywhere. */
  async function ask() {
    const current = state;
    if (!current?.image || current.overFields) return;
    let status;
    try {
      status = await WV.send('wv:ai:status');
    } catch (error) {
      if (state === current) setStep('error', { error });
      return;
    }
    if (state !== current) return;
    const provider = status.provider?.name || '';
    if (status.site !== 'ok') setStep('site', { detail: status.site });
    else if (!status.ready) setStep('setup');
    else if (status.vision === false) setStep('novision', { provider });
    else if (!status.imageConsent) setStep('consent', { provider });
    else run(false, provider);
  }

  /** @param {boolean} agree  The user has just said yes to pictures going to this provider. */
  async function run(agree, provider = state?.provider) {
    const current = state;
    if (!current) return;
    const requestId = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setStep('loading', { provider, requestId });
    try {
      const answer = await WV.send('wv:ai:image', {
        image: current.image,
        question: current.questionField?.value || '',
        title: document.title,
        requestId,
        agree,
      });
      if (state !== current || current.requestId !== requestId) return;
      setStep('done', { answer });
    } catch (error) {
      if (state !== current || current.requestId !== requestId) return;
      if (error?.code === 'aborted') setStep('ready');
      else if (error?.code === 'ai_no_vision') setStep('novision', { provider: error.detail || provider });
      else if (error?.code === 'ai_image_consent') setStep('consent', { provider: error.detail || provider });
      else if (error?.code === 'ai_not_configured') setStep('setup');
      else if (error?.code === 'ai_site') setStep('site', { detail: error.detail });
      else setStep('error', { error });
    }
  }

  function cancel() {
    if (state?.requestId) WV.send('wv:ai:cancel', { requestId: state.requestId }).catch(() => {});
    setStep('ready');
  }

  async function copyAnswer() {
    const current = state;
    let copied = false;
    try {
      await navigator.clipboard.writeText(current.answer.text);
      copied = true;
    } catch {
      copied = false;
    }
    if (state !== current) return;
    current.flash = t(copied ? 'passageCopied' : 'passageCopyFailed');
    render();
  }

  function close() {
    if (!state) return;
    if (state.step === 'loading' && state.requestId) WV.send('wv:ai:cancel', { requestId: state.requestId }).catch(() => {});
    state = null; // the picture goes with it
    window.removeEventListener('keydown', onKeyDown, true);
    ui.panel.replaceChildren();
    ui.surface.unmount();
  }

  async function start() {
    if (busy || WV.ocrSelector.isOpen()) return;
    close();
    WV.popup?.close();
    WV.ocrLayer?.hide();
    const chosen = await WV.ocrSelector.choose({ initial: null });
    if (chosen === undefined) return; // cancelled
    const viewport = viewportNow();
    const area = chosen || { x: 0, y: 0, width: viewport.innerWidth, height: viewport.innerHeight };
    const overFields = coversFields(area);
    busy = true;
    try {
      // The selector is off the page now, but not yet off the screen.
      await nextFrame();
      await nextFrame();
      const image = await WV.send('wv:image:capture', { area: chosen, viewport });
      ui ||= build();
      state = { area, image, overFields, step: overFields ? 'fields' : 'ready', provider: '', questionField: null };
      window.addEventListener('keydown', onKeyDown, true);
      ui.surface.mount();
      render();
      state.questionField?.focus();
    } catch (error) {
      ui ||= build();
      state = { area, image: null, overFields, step: 'error', error, provider: '', questionField: null };
      window.addEventListener('keydown', onKeyDown, true);
      ui.surface.mount();
      render();
    } finally {
      busy = false;
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'wv:image:start') start();
    return false;
  });

  // The interface language changed: an open panel is drawn again in it.
  WV.i18n.onChange(() => {
    if (!ui) return;
    if (!state) {
      ui = null;
      return;
    }
    const keep = state;
    ui.surface.unmount();
    ui = build();
    state = { ...keep, questionField: null };
    const question = keep.questionField?.value || '';
    ui.surface.mount();
    render();
    if (state.questionField) state.questionField.value = question;
  });

  WV.imageAsk = { start, close, isOpen: () => Boolean(state) };
})(globalThis.WV);
