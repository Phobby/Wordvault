// The streak and the rank as a panel, for the extension's own pages (the toolbar popup and the
// settings page): the flame with the days, today's goal, the offer to use the freeze, the rank
// with the way to the next one, and, once, the celebration of a new rank.

const { h, t, progressUi } = globalThis.WV;

/**
 * @param {Object} [options]
 * @param {HTMLElement} [options.celebrateIn]  Where the celebration is laid over (it needs
 *        `position: relative`). Without it a new rank is shown without ceremony.
 * @returns {{ element: HTMLElement, render: () => Promise<void> }}
 */
export function createProgressPanel({ celebrateIn = null } = {}) {
  const element = h('section', { class: 'progress-panel', 'aria-label': t('progressTitle'), hidden: true });
  let celebrated = false;

  async function freeze() {
    await globalThis.WV.send('wv:streak:freeze').catch(() => {});
    await render();
  }

  async function render() {
    const progress = await globalThis.WV.send('wv:progress').catch(() => null);
    if (!progress) return;
    const { streak, rank } = progress;
    const days = streak.count === 1 ? t('streakDaysOne') : t('streakDays', [String(streak.count)]);
    const today = streak.todayDone ? t('streakTodayDone') : t('streakToday', [String(Math.min(streak.answered, streak.goal)), String(streak.goal)]);
    element.replaceChildren(
      h(
        'div',
        { class: 'progress-streak' },
        progressUi.flame(streak),
        h('div', { class: 'progress-streak-text' }, h('strong', { text: streak.count > 0 ? days : t('streakStart') }), h('span', { class: 'help', text: today })),
      ),
      // Yesterday was missed and there was a streak: the freeze of this week can cover it.
      streak.freezeDay &&
        h(
          'div',
          { class: 'progress-freeze', role: 'status' },
          h('span', { text: t(streak.freezeSaves === 1 ? 'freezeOfferOne' : 'freezeOffer', [String(streak.freezeSaves)]) }),
          h('button', { class: 'wv-btn wv-btn-sm', type: 'button', 'data-action': 'freeze', text: t('freezeUse'), onclick: freeze }),
        ),
      progressUi.rankPanel(rank),
    );
    element.hidden = false;

    // Only a page somebody is looking at celebrates: one left open in a background tab must
    // not use the celebration up unseen.
    if (progress.rankUp && !celebrated && document.visibilityState === 'visible') {
      celebrated = true;
      // Noted as seen the moment it is on screen: a popup that is closed before the confetti
      // has landed must not celebrate the same rank again next time.
      // A page that does not celebrate does not note it either: the next one that can, will.
      if (celebrateIn) {
        progressUi.celebrate(celebrateIn, rank);
        globalThis.WV.send('wv:progress:ack-rank').catch(() => {});
      }
    }
  }

  return { element, render };
}
