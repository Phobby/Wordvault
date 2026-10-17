// The synchronisation part of the options page: choosing where the vault is kept in step with
// the user's other devices, connecting, and seeing how it is going.
//
// Connecting happens here, in the page, because it starts with things only a click may start:
// the browser's permission prompt and the provider's sign-in window. Synchronising itself is
// the background script's job (sync/engine.js); this page asks for it and shows the status the
// engine leaves in storage.
//
// Nothing is requested from anywhere before the user has read what goes where and confirmed.

import { clientIdFor } from '../sync/config.js';
import { clearSecret } from '../sync/crypto.js';
import { USAGE_WARNING } from '../sync/providers/browser.js';
import { getSyncProvider, listSyncProviders } from '../sync/providers/index.js';
import { getSyncConfig, getSyncStatus, resetSyncStatus, setSyncConfig, updateConnection } from '../sync/state.js';

const { h, t, languages } = globalThis.WV;

/** A password shorter than this is not accepted for encryption. */
const MIN_PASSWORD_CHARS = 8;

/** The four choices, in the order they are offered. */
const MODES = [
  { id: 'off', titleKey: 'syncModeOff', helpKey: 'syncModeOffHelp' },
  { id: 'browser', titleKey: 'syncModeBrowser', helpKey: 'syncModeBrowserHelp' },
  { id: 'cloud', titleKey: 'syncModeCloud', helpKey: 'syncModeCloudHelp' },
  { id: 'server', titleKey: 'syncModeServer', helpKey: 'syncModeServerHelp' },
];

/**
 * The cloud accounts that can be connected. They are listed here, and not taken from what is
 * registered, so that each is always shown: one whose developer setup is missing says so
 * instead of being absent.
 */
const CLOUD_PROVIDERS = [
  { id: 'gdrive', nameKey: 'syncGdriveName', whereKey: 'syncGdriveWhere' },
];

/** What an error code means, in words (lib/errors.js and sync/providers/index.js). */
const ERRORS = {
  network: 'syncErrNetwork',
  timeout: 'syncErrNetwork',
  offline: 'syncErrOffline',
  sync_auth: 'syncErrAuth',
  sync_quota: 'syncErrQuota',
  sync_conflict: 'syncErrConflict',
  sync_incomplete: 'syncErrIncomplete',
  sync_bad_document: 'syncErrBadDocument',
  sync_newer_schema: 'syncErrNewerSchema',
  sync_config: 'syncSetupMissingText',
  sync_unknown_provider: 'syncNotAvailable',
  sync_cancelled: 'syncErrCancelled',
  sync_permission: 'syncErrPermission',
  sync_insecure: 'syncErrInsecure',
  sync_url: 'syncErrUrl',
  sync_not_found: 'syncErrNotFound',
  sync_password: 'syncErrPassword',
};

/**
 * "what went wrong (the provider's own words)"
 * @param {{ code?: string, detail?: string }} error
 * @param {string} [kind]  The kind of provider it happened with; a server that says no is not
 *   an account whose access "ran out".
 */
function errorText(error, kind) {
  const code = error?.code || 'internal';
  const key = code === 'sync_auth' && kind === 'server' ? 'syncErrServerAuth' : ERRORS[code];
  const known = key ? t(key) : t('syncErrProvider');
  // The detail is the provider's or the browser's own message: shown as it is, it is what
  // someone looking for the cause will search for.
  return error?.detail && !['sync_config', 'offline'].includes(code) ? `${known} (${String(error.detail).slice(0, 200)})` : known;
}

function timeText(time) {
  const locale = languages.uiLanguage();
  const date = new Date(time);
  const sameDay = date.toDateString() === new Date().toDateString();
  return date.toLocaleString(locale, sameDay ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const nameOf = (providerId) => {
  const key = getSyncProvider(providerId)?.nameKey || CLOUD_PROVIDERS.find((provider) => provider.id === providerId)?.nameKey;
  return key ? t(key) : providerId;
};
/** Where the document ends up with a provider, in a sentence; with the address, where one is known. */
const whereOf = (providerId, connection) => {
  const provider = getSyncProvider(providerId);
  const key = provider?.whereKey || CLOUD_PROVIDERS.find((cloud) => cloud.id === providerId)?.whereKey;
  const sentence = key ? t(key) : '';
  let address = '';
  try {
    address = connection && provider?.location ? provider.location(connection) : '';
  } catch {
    // The sentence alone will do.
  }
  return address ? `${sentence} ${address}` : sentence;
};

/**
 * @param {{ onSaved: () => void }} hooks  onSaved: something was stored (the page's "Saved" mark).
 * @returns {{ element: HTMLElement, render: () => Promise<void>, refresh: () => Promise<void> }}
 */
export function createSyncControls({ onSaved }) {
  /** The choice the panel below the list is showing; null follows what is in force. */
  let chosen = null;
  /** A step that is waiting for the user: { kind: 'confirm', providerId, input } or { kind: 'disconnect' }. */
  let step = null;
  /** What to tell the user about the last thing they did: { text, bad }. */
  let notice = null;
  let busy = false;
  /** What is typed into the own-server form, kept across re-renders. */
  const typed = {};
  let serverType = '';
  /** Whether the form for turning encryption on is open. */
  let encrypting = false;

  const modes = h('div', { class: 'sync-modes', role: 'radiogroup', 'aria-label': t('syncTitle') });
  const panel = h('div', { class: 'sync-panel' });
  const element = h(
    'div',
    { class: 'sync', id: 'sync' },
    h('h3', { text: t('syncTitle') }),
    h('p', { class: 'help', text: t('syncIntro') }),
    // What travels besides the words (sync/prefs.js).
    h('p', { class: 'help', text: t('syncSettingsNote') }),
    modes,
    panel,
  );

  const say = (text, bad = false) => {
    notice = text ? { text, bad } : null;
  };
  const button = (labelKey, onclick, { primary = false, action } = {}) =>
    h('button', { class: primary ? 'wv-btn wv-btn-primary' : 'wv-btn', type: 'button', 'data-action': action || null, disabled: busy, text: t(labelKey), onclick });
  const noticeLine = () => notice && h('p', { class: notice.bad ? 'sync-notice bad' : 'sync-notice', role: notice.bad ? 'alert' : 'status', text: notice.text });

  /** Runs something the user started; whatever goes wrong is said on the page, never swallowed. */
  async function attempt(action, kind) {
    busy = true;
    say('');
    await render();
    try {
      await action();
    } catch (error) {
      say(errorText(error, kind), true);
    }
    busy = false;
    await render();
  }

  // --- Connecting --------------------------------------------------------------------------------

  /**
   * Called from the click on "Continue", and its first act is the permission request: browsers
   * only show that prompt in direct answer to a click.
   */
  function connect(providerId, input) {
    const provider = getSyncProvider(providerId);
    let origins = [];
    try {
      origins = provider?.origins ? provider.origins(input) : [];
    } catch (error) {
      return attempt(async () => {
        throw error;
      });
    }
    const allowed = origins.length > 0 ? chrome.permissions.request({ origins }) : Promise.resolve(true);
    return attempt(async () => {
      let connection;
      try {
        if (!provider) throw { code: 'sync_unknown_provider' };
        if (!(await allowed)) throw { code: 'sync_permission', detail: origins.join(', ') };
        connection = await provider.connect(input);
      } catch (error) {
        // Not connected: back to where the choice was made (the form keeps what was typed),
        // with the reason shown there.
        step = null;
        throw error;
      }
      // A connection that was there before is dropped; what it stored remotely is left alone.
      // An encryption key belonged to that connection's file and goes with it.
      await clearSecret();
      await setSyncConfig({ mode: provider.kind, providerId, connection, connectedAt: Date.now(), account: null });
      await resetSyncStatus();
      step = null;
      chosen = null;
      onSaved();
      // The first synchronisation: find the remote copy or create it, and merge.
      const status = await globalThis.WV.send('wv:sync:now');
      if (status?.state === 'error' || status?.state === 'waiting') say(errorText(status.error, provider.kind), true);
      // Whose account it is, where the provider tells (asked after the first write: with some
      // providers the application's folder only exists from then on).
      const current = await getSyncConfig();
      const account = await provider.accountInfo({ connection: current.connection || connection, update: (patch) => updateConnection(providerId, patch) }).catch(() => null);
      if (account && current.providerId === providerId) await setSyncConfig({ ...(await getSyncConfig()), account });
    }, provider?.kind);
  }

  function disconnect(deleteRemote) {
    return attempt(async () => {
      const config = await getSyncConfig();
      const provider = getSyncProvider(config.providerId);
      // If the stored file was to be deleted and could not be, the connection stays, so that
      // it can be tried again; without that wish nothing can stand in the way of leaving.
      if (provider) {
        const leaving = provider.disconnect({ connection: config.connection || {}, update: (patch) => updateConnection(config.providerId, patch) }, { deleteRemote });
        if (deleteRemote) await leaving;
        else await leaving.catch(() => {});
      }
      await setSyncConfig({ mode: 'off' });
      await resetSyncStatus();
      await clearSecret();
      step = null;
      chosen = null;
      encrypting = false;
      onSaved();
      say(t(deleteRemote ? 'syncDisconnectedDeleted' : 'syncDisconnected'));
    });
  }

  const syncNow = () =>
    attempt(async () => {
      const status = await globalThis.WV.send('wv:sync:now');
      if (status?.state === 'error' || status?.state === 'waiting') say(errorText(status.error, (await getSyncConfig()).mode), true);
    });

  // --- Panels ------------------------------------------------------------------------------------

  /** "Before you connect": what goes where. Nothing is sent before "Continue". */
  function confirmPanel(config) {
    const name = nameOf(step.providerId);
    return h(
      'div',
      { class: 'sync-box', 'data-panel': 'confirm' },
      h('strong', { text: t('syncConfirmTitle', { service: name }) }),
      h('p', { class: 'help', text: t('syncConfirmWhat', { service: name }) }),
      h('p', { class: 'help', text: t('syncConfirmWhere', { place: `${whereOf(step.providerId)}${step.input?.url ? ` ${step.input.url}` : ''}` }) }),
      h('p', { class: 'help', text: t('syncConfirmMerge') }),
      config.mode !== 'off' && h('p', { class: 'help', text: t('syncConfirmReplace', { service: nameOf(config.providerId) }) }),
      h(
        'div',
        { class: 'buttons' },
        button('syncContinue', () => connect(step.providerId, step.input), { primary: true, action: 'continue' }),
        button('syncCancel', () => { step = null; render(); }, { action: 'cancel' }),
      ),
    );
  }

  function disconnectPanel(config) {
    const remove = h('input', { type: 'checkbox' });
    return h(
      'div',
      { class: 'sync-box', 'data-panel': 'disconnect' },
      h('strong', { text: t('syncDisconnectTitle', { service: nameOf(config.providerId) }) }),
      h('p', { class: 'help', text: t('syncDisconnectNote') }),
      h('label', { class: 'switch' }, remove, h('span', { class: 'switch-text' }, h('strong', { text: t('syncDeleteRemote') }), h('span', { class: 'help', text: t('syncDeleteRemoteHelp') }))),
      h(
        'div',
        { class: 'buttons' },
        button('syncDisconnect', () => disconnect(remove.checked), { primary: true, action: 'confirm-disconnect' }),
        button('syncCancel', () => { step = null; chosen = null; render(); }, { action: 'cancel' }),
      ),
    );
  }

  /** How it is going, in one line. */
  function stateText(status, kind) {
    if (status.state === 'syncing') return t('syncStateSyncing');
    if (status.state === 'waiting') return t('syncStateWaiting', { reason: errorText(status.error, kind) });
    if (status.state === 'error') return t('syncStateError', { reason: errorText(status.error, kind) });
    if (status.pending) return t('syncStatePending');
    return status.lastSyncAt ? t('syncStateIdle') : t('syncStateNotYet');
  }

  function usageLines(status) {
    if (!status.usage || !(status.usage.total > 0)) return [];
    const share = status.usage.used / status.usage.total;
    const percent = Math.min(100, Math.round(share * 100));
    return [
      h('dt', { text: t('syncUsage') }),
      h(
        'dd',
        {},
        h('span', { class: 'sync-meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(percent) }, h('span', { class: share >= USAGE_WARNING ? 'sync-meter-bar full' : 'sync-meter-bar', style: `width: ${percent}%` })),
        h('span', { text: t('syncUsageValue', { percent: percent, used: Math.ceil(status.usage.used / 1024), total: Math.round(status.usage.total / 1024) }) }),
        share >= USAGE_WARNING && h('p', { class: 'sync-notice bad', role: 'alert', text: t('syncUsageWarning') }),
      ),
    ];
  }

  // --- Encryption --------------------------------------------------------------------------------

  /** Sends the password to the background script, which turns it into a key and synchronises. */
  const unlock = (password, remember) =>
    attempt(async () => {
      const status = await globalThis.WV.send('wv:sync:unlock', { password, remember });
      encrypting = false;
      onSaved();
      if (status?.state === 'error' || status?.state === 'waiting') say(errorText(status.error, (await getSyncConfig()).mode), true);
    });

  const passwordField = (labelKey, name, autocomplete) => {
    const input = h('input', { type: 'password', name, autocomplete, spellcheck: 'false' });
    return { input, row: h('label', { class: 'sync-field' }, h('span', { text: t(labelKey) }), input) };
  };
  const rememberRow = () => {
    const input = h('input', { type: 'checkbox', name: 'remember' });
    return { input, row: h('label', { class: 'switch' }, input, h('span', { class: 'switch-text' }, h('strong', { text: t('syncEncRemember') }), h('span', { class: 'help', text: t('syncEncRememberHelp') }))) };
  };

  /**
   * Optional encryption of the stored file, for every way of synchronising. Three states: the
   * stored file is encrypted and this device has no key for it (ask for the password); it is on;
   * it is off (offer to turn it on).
   */
  function encryptionBox(config, status) {
    const locked = status.error?.code === 'sync_password';
    if (locked) {
      const password = passwordField('syncEncPassword', 'password', 'current-password');
      const remember = rememberRow();
      return h(
        'form',
        { class: 'sync-box', 'data-panel': 'unlock', novalidate: true, onsubmit: (event) => { event.preventDefault(); unlock(password.input.value, remember.input.checked); } },
        h('strong', { text: t('syncEncTitle') }),
        h('p', { class: 'help', text: t('syncEncNeeded') }),
        password.row,
        remember.row,
        h('div', { class: 'buttons' }, h('button', { class: 'wv-btn wv-btn-primary', type: 'submit', 'data-action': 'unlock', disabled: busy, text: t('syncEncUnlock') })),
      );
    }
    if (config.encryption?.enabled) {
      return h(
        'div',
        { class: 'sync-box', 'data-panel': 'encryption', 'data-encrypted': 'yes' },
        h('strong', { text: t('syncEncTitle') }),
        h('p', { class: 'help', text: t('syncEncOn') }),
        h('p', { class: 'help', text: t('syncEncOffNote') }),
        h(
          'div',
          { class: 'buttons' },
          button(
            'syncEncDisable',
            () =>
              attempt(async () => {
                const after = await globalThis.WV.send('wv:sync:encryption-off');
                onSaved();
                if (after?.state === 'error' || after?.state === 'waiting') say(errorText(after.error, (await getSyncConfig()).mode), true);
              }),
            { action: 'encryption-off' },
          ),
        ),
      );
    }
    if (!encrypting) {
      return h(
        'div',
        { class: 'sync-box', 'data-panel': 'encryption', 'data-encrypted': 'no' },
        h('strong', { text: t('syncEncTitle') }),
        h('p', { class: 'help', text: t('syncEncOff') }),
        h('div', { class: 'buttons' }, button('syncEncStart', () => { encrypting = true; say(''); render(); }, { action: 'encryption-start' })),
      );
    }
    const password = passwordField('syncEncPassword', 'password', 'new-password');
    const repeat = passwordField('syncEncRepeat', 'repeat', 'new-password');
    const remember = rememberRow();
    return h(
      'form',
      {
        class: 'sync-box',
        'data-panel': 'encryption-form',
        novalidate: true,
        onsubmit: (event) => {
          event.preventDefault();
          // Said in words, before anything is sent anywhere.
          if (password.input.value.length < MIN_PASSWORD_CHARS) say(t('syncEncTooShort', { min: MIN_PASSWORD_CHARS }), true);
          else if (password.input.value !== repeat.input.value) say(t('syncEncMismatch'), true);
          else return unlock(password.input.value, remember.input.checked);
          return render();
        },
      },
      h('strong', { text: t('syncEncTitle') }),
      h('p', { class: 'sync-notice bad', text: t('syncEncWarning') }),
      password.row,
      repeat.row,
      remember.row,
      h(
        'div',
        { class: 'buttons' },
        h('button', { class: 'wv-btn wv-btn-primary', type: 'submit', 'data-action': 'encryption-on', disabled: busy, text: t('syncEncEnable') }),
        button('syncCancel', () => { encrypting = false; say(''); render(); }, { action: 'cancel' }),
      ),
    );
  }

  /** Connected: what to, how it is going, and the two things that can be done about it. */
  function statusPanel(config, status) {
    const account = config.account?.email || config.account?.name || '';
    const facts = [
      [t('syncConnectedTo'), nameOf(config.providerId)],
      account && [t('syncAccount'), account],
      [t('syncWhere'), whereOf(config.providerId, config.connection)],
      [t('syncLast'), status.lastSyncAt ? timeText(status.lastSyncAt) : t('syncNever')],
      [t('syncState'), stateText(status, config.mode)],
      [t('syncEncTitle'), t(config.encryption?.enabled ? 'syncEncStateOn' : 'syncEncStateOff')],
    ].filter(Boolean);
    return [
      h(
        'div',
        { class: 'sync-box', 'data-panel': 'status', 'data-state': status.state },
        h('dl', { class: 'facts' }, ...facts.flatMap(([label, value]) => [h('dt', { text: label }), h('dd', { text: value })]), ...usageLines(status)),
        h(
          'div',
          { class: 'buttons' },
          button('syncNow', syncNow, { primary: true, action: 'sync-now' }),
          button('syncDisconnect', () => { step = { kind: 'disconnect' }; render(); }, { action: 'disconnect' }),
        ),
      ),
      encryptionBox(config, status),
    ];
  }

  function browserPanel() {
    return h(
      'div',
      { class: 'sync-box', 'data-panel': 'browser' },
      h('p', { class: 'help', text: t('syncBrowserExplain') }),
      h('div', { class: 'buttons' }, button('syncTurnOn', () => { step = { kind: 'confirm', providerId: 'browser', input: {} }; render(); }, { primary: true, action: 'connect' })),
    );
  }

  /** One card per cloud account, each always there. */
  function cloudPanel() {
    return h(
      'div',
      { class: 'sync-cards', 'data-panel': 'cloud' },
      CLOUD_PROVIDERS.map((cloud) => {
        const ready = Boolean(getSyncProvider(cloud.id)) && clientIdFor(cloud.id) !== '';
        return h(
          'div',
          { class: 'sync-card', 'data-provider': cloud.id, 'data-ready': ready ? 'yes' : 'no' },
          h('div', { class: 'sync-card-head' }, h('strong', { text: t(cloud.nameKey) }), !ready && h('span', { class: 'sync-badge', text: t('syncSetupMissing') })),
          h('p', { class: 'help', text: t(cloud.whereKey) }),
          h(
            'div',
            { class: 'buttons' },
            button(
              'syncConnect',
              () => {
                // Never a button that does nothing: what is missing is said, and where to find the steps.
                if (!ready) say(t('syncSetupMissingText'), true);
                else step = { kind: 'confirm', providerId: cloud.id, input: {} };
                render();
              },
              { action: 'connect' },
            ),
          ),
        );
      }),
    );
  }

  /** The user's own server: which kind, where, and how to get in. */
  function serverPanel() {
    const servers = listSyncProviders().filter((provider) => provider.kind === 'server');
    if (servers.length === 0) return h('div', { class: 'sync-box', 'data-panel': 'server' }, h('p', { class: 'help', text: t('syncNotAvailable') }));
    const provider = servers.find((server) => server.id === serverType) || servers[0];
    serverType = provider.id;
    typed[provider.id] ||= {};
    const values = typed[provider.id];
    const type = h(
      'select',
      { 'aria-label': t('syncServerType'), onchange: () => { serverType = type.value; say(''); render(); } },
      servers.map((server) => h('option', { value: server.id, text: t(server.nameKey), selected: server.id === provider.id })),
    );
    const fields = provider.fields.map((field) => {
      const input = h('input', {
        type: field.type,
        name: field.key,
        value: values[field.key] || '',
        placeholder: field.placeholder || null,
        autocomplete: field.type === 'password' ? 'off' : null,
        spellcheck: 'false',
        oninput: () => { values[field.key] = input.value; },
      });
      return h('label', { class: 'sync-field' }, h('span', { text: t(field.labelKey) }), input);
    });
    return h(
      'form',
      {
        class: 'sync-box',
        'data-panel': 'server',
        // The address is checked here, with a reason given in words; the browser's own check
        // would only say "enter a URL".
        novalidate: true,
        onsubmit: (event) => {
          event.preventDefault();
          const input = Object.fromEntries(provider.fields.map((field) => [field.key, String(values[field.key] || '').trim()]));
          // The address is checked before the question "send it there?" is even asked.
          try {
            provider.origins(input);
          } catch (error) {
            say(errorText(error), true);
            render();
            return;
          }
          step = { kind: 'confirm', providerId: provider.id, input };
          render();
        },
      },
      h('label', { class: 'sync-field' }, h('span', { text: t('syncServerType') }), type),
      h('p', { class: 'help', text: t(provider.helpKey) }),
      fields,
      h('div', { class: 'buttons' }, h('button', { class: 'wv-btn wv-btn-primary', type: 'submit', 'data-action': 'connect', disabled: busy, text: t('syncConnect') })),
    );
  }

  async function render() {
    const [config, status] = await Promise.all([getSyncConfig(), getSyncStatus()]);
    const showing = chosen || config.mode;
    modes.replaceChildren(
      ...MODES.map((mode) => {
        const radio = h('input', {
          type: 'radio',
          name: 'sync-mode',
          value: mode.id,
          checked: mode.id === showing,
          disabled: busy,
          onchange: () => {
            chosen = mode.id === config.mode ? null : mode.id;
            // "Only this device" while something is connected means leaving it: that is asked first.
            step = mode.id === 'off' && config.mode !== 'off' ? { kind: 'disconnect' } : null;
            say('');
            render();
          },
        });
        return h(
          'label',
          { class: mode.id === config.mode ? 'sync-mode active' : 'sync-mode', 'data-mode': mode.id },
          radio,
          h('span', { class: 'switch-text' }, h('strong', { text: t(mode.titleKey) }), h('span', { class: 'help', text: t(mode.helpKey) })),
          mode.id === config.mode && config.mode !== 'off' && h('span', { class: 'sync-badge on', text: t('syncInUse') }),
        );
      }),
    );

    let body;
    if (step?.kind === 'confirm') body = confirmPanel(config);
    else if (step?.kind === 'disconnect' && config.mode !== 'off') body = disconnectPanel(config);
    else if (showing === config.mode && config.mode !== 'off') body = statusPanel(config, status);
    else if (showing === 'browser') body = browserPanel();
    else if (showing === 'cloud') body = cloudPanel();
    else if (showing === 'server') body = serverPanel();
    else body = h('div', { class: 'sync-box', 'data-panel': 'off' }, h('p', { class: 'help', text: t('syncOffExplain') }));
    panel.replaceChildren(...[body, noticeLine()].flat().filter(Boolean));
  }

  /**
   * Shows what changed in storage (the engine's status). Put off while the user is typing into
   * one of the forms here: redrawing would take the field away from under their fingers.
   */
  function refresh() {
    const active = document.activeElement;
    if (active && panel.contains(active) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName)) {
      active.addEventListener('blur', () => setTimeout(refresh, 0), { once: true });
      return Promise.resolve();
    }
    return render();
  }

  return { element, render, refresh };
}
