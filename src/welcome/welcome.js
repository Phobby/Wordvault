// The welcome page: what the extension does, in a few lines, shown once after it is installed.
// It also carries the support card, which can be sent away for good from here.

import { supportCard } from '../support/support.js';

const { h, t } = globalThis.WV;
globalThis.WV.adoptStyles(globalThis.WV.styles.tokens + globalThis.WV.styles.controls);
document.title = t('welcomeTitle');

/** Set when the user chose "don't show again" on the support card of this page. */
const DISMISSED_KEY = 'supportDismissed';

const FEATURES = ['Translate', 'Vault', 'Quiz', 'Captions', 'Scan', 'Sync'];

const app = document.getElementById('app');
app.append(
  h(
    'header',
    { class: 'page-head' },
    h('img', { src: '../icons/icon-48.png', alt: '', width: '32', height: '32' }),
    h('h1', { text: t('welcomeTitle') }),
  ),
  h('p', { class: 'welcome-lead', text: t('welcomeLead') }),
  h(
    'section',
    { class: 'card' },
    h('ul', { class: 'features' }, FEATURES.map((name) => h('li', null, h('strong', { text: t(`welcome${name}Title`) }), h('span', { class: 'help', text: t(`welcome${name}Text`) })))),
  ),
  h(
    'div',
    { class: 'welcome-actions' },
    h('button', { class: 'wv-btn wv-btn-primary', type: 'button', text: t('welcomeOpenSettings'), onclick: () => chrome.runtime.openOptionsPage() }),
  ),
);

const { [DISMISSED_KEY]: dismissed } = await chrome.storage.local.get(DISMISSED_KEY).catch(() => ({}));
if (!dismissed) {
  const card = supportCard({ onDismiss: () => chrome.storage.local.set({ [DISMISSED_KEY]: true }).catch(() => {}) });
  if (card) app.append(card);
}
