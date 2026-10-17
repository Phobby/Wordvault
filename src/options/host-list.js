// A list of sites on the options page: each host a chip with a remove button, and a "+" that
// opens a one-line field for adding one more. What is typed is cleaned and checked
// (ai/sites.js: addHost) before it is kept.

import { MAX_SITES, addHost } from '../ai/sites.js';

const { h, t } = globalThis.WV;

const ERRORS = { empty: 'optSiteEmpty', invalid: 'optSiteInvalid', duplicate: 'optSiteDuplicate', full: 'optSiteFull' };

/**
 * @param {{ name: string, titleKey: string, hintKey: string, onChange: (hosts: string[]) => Promise<void> }} options
 *        name: what the list is called in data attributes and ids; onChange: stores the new list.
 * @returns {{ element: HTMLElement, render: (hosts: string[]) => void }}
 */
export function createHostList({ name, titleKey, hintKey, onChange }) {
  let hosts = [];
  const titleId = `sites-${name}-title`;
  const errorId = `sites-${name}-error`;

  const chips = h('ul', { class: 'chips', 'aria-labelledby': titleId });
  const empty = h('p', { class: 'help chips-empty', text: t('optSitesEmpty') });
  const status = h('p', { class: 'help chips-status', role: 'status' });
  const error = h('p', { class: 'chips-error', id: errorId, hidden: true });

  const input = h('input', {
    type: 'text',
    inputmode: 'url',
    dir: 'ltr', // a host name reads left to right in every interface language
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: 'example.com',
    'aria-label': t('optSiteInput'),
    'aria-describedby': errorId,
    oninput: () => showError(''),
    onkeydown: (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    },
  });
  const form = h(
    'form',
    {
      class: 'chips-form',
      hidden: true,
      onsubmit: (event) => {
        event.preventDefault();
        add();
      },
    },
    input,
    h('button', { class: 'wv-btn wv-btn-sm', type: 'submit', text: t('optSiteConfirm') }),
    h('button', { class: 'wv-btn wv-btn-sm', type: 'button', text: t('aiCancel'), onclick: () => close() }),
  );
  const plus = h(
    'button',
    { class: 'wv-btn wv-btn-sm chips-add', type: 'button', 'data-action': `add-${name}`, 'aria-describedby': titleId, onclick: () => open() },
    h('span', { 'aria-hidden': 'true', text: '+' }),
    h('span', { text: t('optSiteAdd') }),
  );

  const element = h(
    'div',
    { class: 'host-list', 'data-ai': name },
    h('div', { class: 'fb-label' }, h('strong', { id: titleId, text: t(titleKey) }), h('span', { class: 'help', text: t(hintKey) })),
    chips,
    empty,
    plus,
    form,
    error,
    status,
  );

  function showError(text) {
    error.textContent = text;
    error.hidden = !text;
    input.toggleAttribute('aria-invalid', Boolean(text));
  }

  function open() {
    if (hosts.length >= MAX_SITES) {
      status.textContent = t('optSiteFull', { max: MAX_SITES });
      return;
    }
    plus.hidden = true;
    form.hidden = false;
    status.textContent = '';
    input.focus();
  }

  function close() {
    input.value = '';
    showError('');
    form.hidden = true;
    plus.hidden = false;
    plus.focus();
  }

  async function add() {
    const result = addHost(hosts, input.value);
    if (result.error) {
      showError(t(ERRORS[result.error], { host: result.host || '', max: MAX_SITES }));
      input.focus();
      return;
    }
    draw(result.list);
    close();
    status.textContent = t('optSiteAdded', { host: result.host });
    await onChange(result.list);
  }

  async function remove(host) {
    const index = hosts.indexOf(host);
    const next = hosts.filter((entry) => entry !== host);
    draw(next);
    // The focus goes to the chip that took this one's place, or the one before it, or "+".
    const buttons = chips.querySelectorAll('button');
    (buttons[Math.min(index, buttons.length - 1)] || plus).focus();
    status.textContent = t('optSiteRemoved', { host });
    await onChange(next);
  }

  function draw(list) {
    hosts = list;
    chips.replaceChildren(
      ...list.map((host) =>
        h(
          'li',
          { class: 'chip' },
          h('span', { class: 'chip-text', dir: 'ltr', text: host }),
          h('button', { class: 'chip-remove', type: 'button', 'aria-label': t('optSiteRemove', { host }), title: t('optSiteRemove', { host }), onclick: () => remove(host), text: '×' }),
        ),
      ),
    );
    chips.hidden = list.length === 0;
    empty.hidden = list.length > 0;
    const full = list.length >= MAX_SITES;
    plus.setAttribute('aria-disabled', String(full));
    if (full) status.textContent = t('optSiteFull', { max: MAX_SITES });
  }

  /** The stored list; drawn again only when it differs, so that the focus stays where it is. */
  function render(list) {
    if (list.length === hosts.length && list.every((host, i) => host === hosts[i])) return;
    draw(list);
  }

  draw([]);
  return { element, render };
}
