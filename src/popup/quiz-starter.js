// The "Quiz" part of the toolbar popup: a button that starts a quiz right now, and next to it
// the difficulty it is asked at. The difficulty button goes round the four levels, one step
// per click, with a short drawing for the level it lands on. All of it is drawn here (inline
// SVG, CSS animation): no image file, nothing from the network.

import { DIFFICULTIES, difficultyOf, getDifficulty, nextDifficulty, setDifficulty } from '../quiz/difficulty.js';

const { h, t } = globalThis.WV;
const SVG = 'http://www.w3.org/2000/svg';

/** The drawings, one per level. Shapes of our own; each part has a class the animation moves. */
const ART = {
  // a sprout: a stem and two leaves that unfold
  leaf: [
    ['path', { class: 'd-stem', d: 'M12 21v-9' }],
    ['path', { class: 'd-leaf d-leaf-a', d: 'M12 13c-4.500.300-6.500-2.200-6.500-6 3.800-.300 6.500 1.700 6.500 6z' }],
    ['path', { class: 'd-leaf d-leaf-b', d: 'M12 11c.200-3.600 2.300-5.700 6-6 .400 3.700-1.800 6-6 6z' }],
  ],
  // a spark: a four-pointed star that rises, with two small ones after it
  spark: [
    ['path', { class: 'd-star', d: 'M12 4l1.800 5.200L19 11l-5.200 1.800L12 18l-1.800-5.200L5 11l5.200-1.800z' }],
    ['circle', { class: 'd-ember d-ember-a', cx: '6', cy: '18', r: '1.300' }],
    ['circle', { class: 'd-ember d-ember-b', cx: '18.500', cy: '17', r: '1' }],
  ],
  // a bolt of lightning that strikes
  bolt: [['path', { class: 'd-bolt', d: 'M13.500 2.500L5.500 13.500h5l-1.500 8 8.500-11.500h-5.200z' }]],
  // a crystal that lights up, facet by facet
  crystal: [
    ['path', { class: 'd-gem', d: 'M12 2.500l6 6.500-6 12.500-6-12.500z' }],
    ['path', { class: 'd-facet', d: 'M6 9h12M12 2.500L9.500 9l2.500 12.500L14.500 9z' }],
    ['path', { class: 'd-glint', d: 'M19 3v3M17.500 4.500h3' }],
  ],
};

function drawing(theme) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `diff-art diff-art-${theme}`);
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attributes] of ART[theme]) {
    const part = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) part.setAttribute(name, value);
    svg.append(part);
  }
  return svg;
}

/** Why a quiz could not be started, in words. */
function failureText(result, level) {
  const mode = t(level.modeKey);
  switch (result?.reason) {
    case 'no_cards':
      return t('quizStartNoWords');
    case 'not_enough_choices':
    case 'nothing_due':
      // four choices need four different meanings; the typing levels only need a word that fits
      return level.mode === 'classic' || level.mode === 'listening' ? t('quizStartFewWords', [String(result.needed ?? 4), String(result.have ?? 0)]) : t('quizStartNoFit', [mode]);
    case 'no_voice':
      return t('quizStartNoVoice');
    default:
      return t('quizStartFailed');
  }
}

/** @returns {{ element: HTMLElement, render: (words: number) => Promise<void> }} */
export function createQuizStarter() {
  let level = DIFFICULTIES[0];
  let starting = false;

  const art = h('span', { class: 'diff-icon' });
  const name = h('strong', { class: 'diff-name' });
  const mode = h('span', { class: 'diff-mode' });
  const selector = h(
    'button',
    {
      class: 'diff-button',
      type: 'button',
      'data-action': 'difficulty',
      onclick: () => {
        show(nextDifficulty(level.id), true);
        // remembered for the next time the popup is opened
        setDifficulty(level.id).catch(() => {});
      },
    },
    art,
    h('span', { class: 'diff-text' }, name, mode),
  );
  const start = h('button', { class: 'wv-btn wv-btn-primary quiz-start', type: 'button', 'data-action': 'start-quiz', text: t('quizStart'), onclick: () => begin() });
  const message = h('p', { class: 'quiz-start-message', role: 'status', hidden: true });
  const element = h('section', { class: 'quiz-starter', 'aria-label': t('quizTitle'), hidden: true }, h('div', { class: 'quiz-starter-row' }, start, selector), message);

  /**
   * Shows a level on the button: its colours, its name, what it starts, and its drawing.
   * @param {boolean} animate  Play the drawing's little animation (a click; not the first paint).
   */
  function show(next, animate = false) {
    level = next;
    selector.dataset.level = level.id;
    name.textContent = t(level.nameKey);
    mode.textContent = t(level.modeKey);
    const label = t('diffLabel', [t(level.nameKey), t(level.modeKey)]);
    selector.title = label;
    selector.setAttribute('aria-label', label);
    // A fresh drawing for every click: the one before it, and whatever of its animation was
    // still running, is gone, so quick clicks can neither pile animations up nor leave one
    // half-played. The animation itself is CSS and only runs with the "play" class.
    const picture = drawing(level.theme);
    if (animate) picture.classList.add('diff-play');
    art.replaceChildren(picture);
    message.hidden = true;
  }

  async function begin() {
    if (starting) return;
    starting = true;
    start.disabled = true;
    message.hidden = true;
    const result = await globalThis.WV.send('wv:quiz:start', { mode: level.mode }).catch(() => null);
    starting = false;
    start.disabled = false;
    if (!result?.ok) {
      message.textContent = failureText(result, level);
      message.hidden = false;
      return;
    }
    // Shown here: this popup turns into the quiz. Shown elsewhere (a window, a card on the
    // page): the popup is done and gets out of the way.
    if (result.here) location.replace(chrome.runtime.getURL('quiz/quiz.html?surface=popup'));
    else window.close();
  }

  return {
    element,
    async render(words) {
      // With an empty vault there is nothing to ask; the list below says how to fill it.
      element.hidden = !(words > 0);
      if (selector.dataset.level) return; // the level on the button is the user's latest click
      show(difficultyOf((await getDifficulty().catch(() => null))?.id));
    },
  };
}
