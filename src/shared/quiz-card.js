'use strict';

// The quiz card: a saved word and four possible meanings, in the top right corner. Used on web
// pages (content/quiz.js) and on the options page ("Test now").

(function (WV) {
  if (WV.quizCard) return;
  const { h, t, icon, languages } = WV;

  const ICON_CLOSE = 'M6 6l12 12M18 6L6 18';
  /** How long the result stays on screen before the card closes itself. */
  const RIGHT_MS = 2000;
  const WRONG_MS = 3500;

  let surface = null;
  let current = null; // the card on screen
  let timer = 0;

  function close() {
    clearTimeout(timer);
    if (!current) return;
    const { answered, onClose } = current;
    current = null;
    surface.unmount();
    onClose?.({ answered });
  }

  function answer(index) {
    if (!current || current.answered) return;
    const { question, buttons, feedback, onAnswer } = current;
    const correct = index === question.answer;
    current.answered = true;
    for (const button of buttons) button.disabled = true;
    buttons[question.answer].classList.add('wv-right');
    if (!correct) buttons[index].classList.add('wv-wrong');
    feedback.textContent = t(correct ? 'quizCorrect' : 'quizWrong');
    feedback.classList.add(correct ? 'wv-right' : 'wv-wrong');
    onAnswer?.({ id: question.id, correct, choice: index });
    timer = setTimeout(close, correct ? RIGHT_MS : WRONG_MS);
  }

  /**
   * Shows a question (replacing the one on screen, if any).
   * @param {import('../quiz/question.js').Question} question
   * @param {{ onAnswer?: (answer: { id: string, correct: boolean, choice: number }) => void, onClose?: (info: { answered: boolean }) => void }} [handlers]
   */
  function show(question, { onAnswer, onClose } = {}) {
    surface ||= WV.createSurface(WV.styles.quiz);
    close();
    const buttons = question.choices.map((choice, index) =>
      h('button', { class: 'wv-quiz-choice', type: 'button', dir: 'auto', lang: question.targetLang || null, text: choice, onclick: () => answer(index) }),
    );
    const feedback = h('div', { class: 'wv-quiz-feedback', role: 'status' });
    surface.root.replaceChildren(
      h(
        'div',
        { class: 'wv-quiz', role: 'dialog', 'aria-label': t('quizTitle') },
        h(
          'div',
          { class: 'wv-quiz-head' },
          h('span', { class: 'wv-quiz-title', text: t('quizTitle') }),
          h('button', { class: 'wv-btn-icon', type: 'button', title: t('popupClose'), 'aria-label': t('popupClose'), onclick: close }, icon(ICON_CLOSE)),
        ),
        h('div', { class: 'wv-quiz-word', dir: 'auto', lang: question.sourceLang || null, text: question.word }),
        h('div', { class: 'wv-quiz-prompt', text: t('quizPrompt', [languages.name(question.targetLang)]) }),
        h('div', { class: 'wv-quiz-choices' }, buttons),
        feedback,
      ),
    );
    surface.mount(null);
    current = { question, buttons, feedback, answered: false, onAnswer, onClose };
  }

  WV.quizCard = { show, close, isOpen: () => Boolean(current) };
})(globalThis.WV);
