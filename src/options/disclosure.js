// A "Details" button that shows and hides explanations kept out of the way: closed at first,
// a real button (keyboard and screen readers), aria-expanded saying whether it is open.

const { h, t } = globalThis.WV;

let count = 0;

/**
 * @param {Array<Node | string>} content  What it shows when open.
 * @param {{ labelKey?: string, describedBy?: string }} [options]  labelKey: the button's text;
 *        describedBy: the id of what the explanations are about, for the button's accessible name.
 * @returns {{ button: HTMLButtonElement, panel: HTMLElement }}  Placed apart: the button next to
 *          a heading or a control, the panel where the text belongs.
 */
export function disclosure(content, { labelKey = 'optDetails', describedBy } = {}) {
  count += 1;
  const id = `details-${count}`;
  const panel = h('div', { class: 'details-panel', id, hidden: true }, ...content);
  const button = h(
    'button',
    {
      class: 'details-toggle',
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': id,
      ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      onclick: () => {
        const open = panel.hidden;
        panel.hidden = !open;
        button.setAttribute('aria-expanded', String(open));
      },
    },
    h('span', { class: 'details-icon', 'aria-hidden': 'true', text: 'i' }),
    h('span', { text: t(labelKey) }),
  );
  return { button, panel };
}
