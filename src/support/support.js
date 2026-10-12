// "Support the project": a card with a few friendly words and a button. The button is a plain
// link that opens the support page in a new tab. Nothing is loaded from that service (no
// widget, no script, no image): what is drawn here is all local.

import { supportUrl } from '../config.js';

const { h, t } = globalThis.WV;

const SVG_NS = 'http://www.w3.org/2000/svg';
/** A cup, drawn here. ASSUMPTION: not the service's own logo artwork, which is theirs to license. */
const CUP_PATHS = ['M5 9h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z', 'M16 10h1.5a2.5 2.5 0 0 1 0 5H16', 'M8 3c0 1.2 1 1.4 1 2.6M12 3c0 1.2 1 1.4 1 2.6'];

function cup() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'support-cup');
  for (const data of CUP_PATHS) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', data);
    svg.append(path);
  }
  return svg;
}

/** Whether there is a support page to link to at all. */
export const hasSupport = () => supportUrl() !== '';

/** The button: a link, nothing more. */
export function supportButton() {
  return h('a', { class: 'support-button', href: supportUrl(), target: '_blank', rel: 'noopener noreferrer' }, cup(), h('span', { text: t('supportButton') }));
}

/** A small text link, for the toolbar popup. Null when there is no support page. */
export function supportLink() {
  if (!hasSupport()) return null;
  return h('a', { class: 'support-link', href: supportUrl(), target: '_blank', rel: 'noopener noreferrer', text: t('supportLink') });
}

/**
 * The card. Null when there is no support page.
 * @param {{ onDismiss?: (() => void) | null }} [options]  With onDismiss the card gets a
 *        "don't show again" link, which removes the card and calls it.
 */
export function supportCard({ onDismiss = null } = {}) {
  if (!hasSupport()) return null;
  const card = h(
    'section',
    { class: 'card support-card', 'aria-label': t('supportTitle') },
    h('div', { class: 'support-text' }, h('h2', { text: t('supportTitle') }), h('p', { class: 'help', text: t('supportText') })),
    h(
      'div',
      { class: 'support-actions' },
      supportButton(),
      onDismiss &&
        h('button', {
          class: 'wv-link support-dismiss',
          type: 'button',
          text: t('supportDismiss'),
          onclick: () => {
            card.remove();
            onDismiss();
          },
        }),
    ),
  );
  return card;
}
