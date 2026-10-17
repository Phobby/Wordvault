'use strict';

// The quiz: a saved word and four possible meanings, one question after the other, and a short
// summary at the end if there was more than one. This is the only place the quiz is drawn; it
// is used as a card on web pages (content/quiz.js), in the toolbar popup and in the quiz window
// (quiz/page.js).
//
// A word is asked in one of four ways (quiz/question.js), from easy to expert: shown with
// four meanings to pick from, as a meaning for which the word is typed, said aloud with four
// choices, or said aloud to be typed.
//
// A question ends in exactly one of these ways, reported once through `report`:
//   answer    a choice was picked or a word typed (right or wrong, with the time it took)
//   unknown   "I don't know": counts as wrong, the right answer is shown
//   later     "Ask later"                    \
//   timeout   nobody answered in time         } nothing is held against the word
//   closed    the quiz was closed            /
//   no_voice  the word could not be said aloud here: another word takes its place
// What comes next is not decided here: the reply to the report is the next question, the
// summary, or nothing (the quiz is over).

(function (WV) {
  if (WV.quizCard) return;
  const { h, t, languages } = WV;

  /** How long the result of a question stays on screen before the quiz moves on. */
  const RIGHT_MS = 2000;
  const WRONG_MS = 3500;
  /** A typed answer that was wrong: there is a correction to read. */
  const WRITE_WRONG_MS = 5000;
  /** "This word cannot be said here" stays this long before the next word comes. */
  const NO_VOICE_MS = 2600;
  /** How long the browser's list of voices is waited for before a language counts as having none. */
  const VOICES_WAIT_MS = 1200;
  const ICON_SPEAKER = 'M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13';
  /** How long the summary stays before the quiz closes by itself. */
  const SUMMARY_MS = 6000;
  /** How long closing waits for the last report to be on its way before the place goes away. */
  const LEAVE_WAIT_MS = 1500;

  /** The bar that shrinks while the question waits for an answer. */
  function startCountdown(bar, ms) {
    try {
      return bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: ms, easing: 'linear', fill: 'forwards' });
    } catch {
      return null; // no Web Animations here; the timeout itself does not depend on the bar
    }
  }

  /**
   * Draws a quiz into `root` and runs it to its end.
   *
   * @param {Element} root  Emptied and filled; emptied again when the quiz closes.
   * @param {Object} quiz
   * @param {string} quiz.sessionId
   * @param {import('../quiz/question.js').Question} quiz.question  The first question.
   * @param {number} [quiz.index]            Its number within the quiz (1 = first).
   * @param {number} [quiz.total]            How many questions the quiz is meant to ask.
   * @param {number} [quiz.timeoutSeconds]   An unanswered question ends the quiz after this long
   *   (outcome 'timeout'). 0 or missing: it stays until it is answered or closed.
   * @param {Object} [hooks]
   * @param {(result: { sessionId: string, id: string, outcome: 'answer' | 'unknown' | 'later' | 'timeout' | 'closed',
   *   chars: number, correct?: boolean, choice?: number, ms?: number }) => Promise<{ next?: { question: object,
   *   index: number } | null, summary?: { right: number, answered: number, skipped: number } | null } | null | void>} [hooks.report]
   *   Called once per question. `correct`, `choice` and `ms` come with 'answer' only.
   * @param {() => unknown} [hooks.mute]     "Not today" was pressed.
   * @param {() => Promise<{ streak: object }>} [hooks.progress]  How the streak stands (for the flame).
   * @param {() => void} [hooks.onClose]     The quiz has left the screen.
   * @param {boolean} [hooks.floating]       Drawn as a card over a page instead of filling `root`.
   * @returns {{ close(): void, isOpen(): boolean }}
   */
  function mount(root, quiz, { report, mute, onClose, progress: getProgress, floating = false } = {}) {
    const total = Math.max(1, Number(quiz.total) || 1);
    const timeoutMs = Number(quiz.timeoutSeconds) > 0 ? Number(quiz.timeoutSeconds) * 1000 : 0;
    let current = null; // the question on screen
    let advanceTimer = 0; // moves on from a result, or closes the summary
    let closed = false;

    const progress = h('span', { class: 'wv-quiz-progress' });
    // The streak, as a flame with the number of days: bright once today's quiz is done.
    const streakSlot = h('span', { class: 'wv-quiz-streak' });
    const warning = h('div', { class: 'wv-quiz-warning', role: 'alert', hidden: true });
    let streak = null; // what the background script last said about it
    let warned = false;

    /** Asks how the streak stands and draws it. Never in the way: without an answer there is no flame. */
    function refreshStreak() {
      if (!getProgress || !WV.progressUi) return;
      Promise.resolve()
        .then(() => getProgress())
        .then((state) => {
          if (closed || !state?.streak) return;
          streak = state.streak;
          streakSlot.replaceChildren(WV.progressUi.flame(streak));
        })
        .catch(() => {});
    }
    const body = h('div', { class: 'wv-quiz-body' });
    const bar = h('div', { class: 'wv-quiz-timer-bar' });
    const timerBar = h('div', { class: 'wv-quiz-timer', hidden: true }, bar);
    const muteButton = h('button', { class: 'wv-quiz-action', type: 'button', 'data-action': 'mute', title: t('quizMuteHint'), text: t('quizMute'), onclick: () => muteToday() });
    const title = h('span', { class: 'wv-quiz-title', text: t('quizTitle') });
    const closeButton = h('button', { class: 'wv-quiz-action', type: 'button', 'data-action': 'close', text: t('quizClose'), onclick: close });
    const card = h(
      'div',
      { class: floating ? 'wv-quiz wv-quiz-floating' : 'wv-quiz', role: 'dialog', 'aria-label': t('quizTitle') },
      h('div', { class: 'wv-quiz-head' }, title, streakSlot, progress),
      body,
      // Always there, whatever the quiz is showing.
      h('div', { class: 'wv-quiz-bottom' }, muteButton, closeButton),
      warning,
      timerBar,
    );

    /** Ends the question: stops the clocks and reports the outcome. Only the first call counts.
     *  @returns {Promise<object | null> | null} What the report says comes next; null if the
     *  question had already ended. */
    function finish(outcome, details) {
      if (!current || current.outcome) return null;
      const { question, stopwatch } = current;
      current.outcome = outcome;
      clearTimeout(current.timeoutTimer);
      current.countdown?.cancel();
      timerBar.hidden = true;
      stopwatch.stop();
      const result = { sessionId: quiz.sessionId, id: question.id, outcome, mode: question.mode || 'classic', chars: question.chars, ...details };
      // Reported right here, not a moment later: when the place showing the quiz is going away
      // (a popup the user clicked away from), a moment later is too late.
      let reported;
      try {
        reported = Promise.resolve(report?.(result));
      } catch (error) {
        reported = Promise.reject(error);
      }
      // An extension that was reloaded underneath the page cannot be reached: the quiz just ends.
      // an answer may have completed the day: the flame is looked at again
      reported.then(() => refreshStreak(), () => {});
      return reported.then((following) => following || null, () => null);
    }

    /**
     * Takes the quiz off the screen.
     * @param {Promise<unknown>} [before]  Something that has to be on its way before the place
     *   showing the quiz may go away with it (a popup or a window closes itself in onClose).
     */
    function close(before) {
      if (closed) return;
      const reported = finish('closed'); // unless the question already ended some other way
      closed = true;
      stopRelabel();
      clearTimeout(advanceTimer);
      current = null;
      root.replaceChildren();
      const sent = Promise.all([reported, before]).catch(() => {});
      Promise.race([sent, new Promise((resolve) => setTimeout(resolve, LEAVE_WAIT_MS))]).then(() => onClose?.());
    }

    function muteToday() {
      if (closed) return;
      // A streak that today's quiz would keep alive: said once, before it is given up. The
      // second press does what the button says.
      if (!warned && streak && streak.alive && !streak.todayDone && streak.count > 0) {
        warned = true;
        warning.textContent = t('quizMuteWarning', { count: streak.count });
        warning.hidden = false;
        muteButton.textContent = t('quizMuteAnyway');
        return;
      }
      // The question on screen is closed first, so that it is not left hanging.
      const reported = finish('closed');
      close(Promise.resolve(reported).then(() => mute?.()));
    }

    /** Waits out the time the result is shown for, then does what the report said. */
    function moveOn(following, delay) {
      const shownAt = Date.now();
      following.then((then) => {
        if (closed) return;
        advanceTimer = setTimeout(() => {
          if (closed) return;
          if (then?.next?.question) showQuestion(then.next.question, then.next.index);
          else if (then?.summary) showSummary(then.summary);
          else close();
        }, Math.max(0, delay - (Date.now() - shownAt)));
      });
    }

    /** Shows which choice was right. */
    function reveal(messageKey, picked) {
      const { question, buttons, actions, feedback } = current;
      const correct = picked === question.answer;
      for (const button of buttons) button.disabled = true;
      buttons[question.answer].classList.add('wv-right');
      if (picked !== null && !correct) buttons[picked].classList.add('wv-wrong');
      actions.hidden = true;
      feedback.textContent = t(messageKey);
      feedback.classList.add(correct ? 'wv-right' : 'wv-wrong');
      feedback.hidden = false;
      // The word that was only heard is shown now.
      current.unveil?.();
    }

    function answer(index) {
      if (!current || current.outcome) return;
      const correct = index === current.question.answer;
      // Read before finish() stops the stopwatch: the time from the choices appearing to this click.
      const ms = current.stopwatch.elapsed();
      const following = finish('answer', { correct, choice: index, ms });
      reveal(correct ? 'quizCorrect' : 'quizWrong', index);
      moveOn(following, correct ? RIGHT_MS : WRONG_MS);
    }

    function unknown() {
      const following = finish('unknown');
      if (!following) return;
      reveal('quizUnknownFeedback', null);
      moveOn(following, WRONG_MS);
    }

    /** "Ask later": on to the next question at once. */
    function later() {
      const following = finish('later');
      if (following) moveOn(following, 0);
    }

    const laterButton = () => h('button', { class: 'wv-quiz-action', type: 'button', 'data-action': 'later', title: t('quizLaterHint'), text: t('quizLater'), onclick: later });

    /** The four choices and what is under them: the same for a word that is shown and one that is heard. */
    function choiceParts(question) {
      const lang = question.choiceKind === 'spelling' ? question.sourceLang : question.targetLang;
      const buttons = question.choices.map((choice, choiceIndex) =>
        h('button', { class: 'wv-quiz-choice', type: 'button', dir: 'auto', lang: lang || null, text: choice, onclick: () => answer(choiceIndex) }),
      );
      const actions = h(
        'div',
        { class: 'wv-quiz-actions' },
        h('button', { class: 'wv-quiz-action', type: 'button', 'data-action': 'unknown', title: t('quizUnknownHint'), text: t('quizUnknown'), onclick: unknown }),
        laterButton(),
      );
      const feedback = h('div', { class: 'wv-quiz-feedback', role: 'status', hidden: true });
      return { buttons, actions, feedback };
    }

    /** Classic: the word, and four meanings to pick from. */
    function classicBody(question) {
      const parts = choiceParts(question);
      body.replaceChildren(
        h('div', { class: 'wv-quiz-word', dir: 'auto', lang: question.sourceLang || null, text: question.word }),
        h('div', { class: 'wv-quiz-prompt', text: t('quizPrompt', { language: languages.name(question.targetLang) }) }),
        h('div', { class: 'wv-quiz-choices' }, parts.buttons),
        h('div', { class: 'wv-quiz-foot' }, parts.actions, parts.feedback),
      );
      return parts;
    }

    // --- Listening: the word is said, not shown ------------------------------------------------

    /**
     * Says the word with whatever this browser has (shared/speech.js: a voice of the system,
     * or a recording where the system's voice cannot be used). Nothing is ever cut off: the
     * speech module hands the engine one word at a time and never cancels one, which is what
     * keeps playback from ending in a click.
     * @returns {Promise<'said' | 'no_voice_lang' | 'no_voice_word'>}
     */
    async function say(question, { slow = false } = {}) {
      const speech = WV.speech;
      if (!speech || !question.sourceLang) return 'no_voice_lang';
      if (!speech.usesRecordings) {
        // The list of voices may still be loading; it is given a moment before "none" is believed.
        if (!speech.pickVoice(question.sourceLang).listed) {
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, VOICES_WAIT_MS);
            speech.onVoicesChanged(() => {
              clearTimeout(timer);
              resolve();
            });
          });
        }
        if (!speech.pickVoice(question.sourceLang).voice) return 'no_voice_lang';
      }
      const played = await speech.pronounce(question.word, question.sourceLang, slow ? { rate: WV.voices.RATE.SLOW } : {}).catch(() => ({ via: null }));
      // Where recordings are used there is one per word or none: that says nothing about the language.
      return played.via ? 'said' : speech.usesRecordings ? 'no_voice_word' : 'no_voice_lang';
    }

    /**
     * The blank where the word would be and the button that says it: for both ways of asking
     * by ear. If the word cannot be said here, that is said, the question ends without anything
     * being held against the word, and the quiz goes on with another one.
     * @param {() => void} lock  Takes the question's controls away when there is no voice.
     */
    function voiceRow(question, lock) {
      const blank = h('div', { class: 'wv-quiz-blank', 'aria-hidden': 'true', text: '?' });
      const notice = h('div', { class: 'wv-quiz-notice', role: 'status', hidden: true });
      const asked = () => current && current.question === question && !current.outcome;
      const play = async ({ slow = false } = {}) => {
        if (!asked()) return;
        const button = slow ? slower : speaker;
        button.classList.add('wv-busy');
        const result = await say(question, { slow });
        button.classList.remove('wv-busy');
        if (result === 'said' || !asked()) return;
        lock();
        notice.textContent = t('quizNoVoice', { language: languages.name(question.sourceLang) });
        notice.hidden = false;
        const following = finish('no_voice', { scope: result === 'no_voice_word' ? 'word' : 'lang' });
        if (following) moveOn(following, NO_VOICE_MS);
      };
      const speaker = h('button', { class: 'wv-quiz-speaker', type: 'button', 'data-action': 'speak', title: t('quizListenAgain'), 'aria-label': t('quizListenAgain'), onclick: () => play() }, WV.icon(ICON_SPEAKER));
      // The same word, slower (shared/voices.js: RATE.SLOW). A recording is played as it is.
      const slower = h('button', { class: 'wv-quiz-slow', type: 'button', 'data-action': 'speak-slow', title: t('quizListenSlowHelp'), text: t('quizListenSlow'), onclick: () => play({ slow: true }) });
      return {
        row: h('div', { class: 'wv-quiz-listen' }, blank, speaker, slower),
        notice,
        play,
        /** The word that was only heard is shown. */
        unveil: () => {
          blank.textContent = question.word;
          blank.classList.add('wv-shown');
          blank.removeAttribute('aria-hidden');
          if (question.sourceLang) blank.lang = question.sourceLang;
        },
        // Said once when the question appears, if that is wanted. A browser may refuse sound
        // nobody clicked for; the button is there either way.
        autoplay: () => question.autoplay !== false && play(),
      };
    }

    function listeningBody(question) {
      const parts = choiceParts(question);
      const voice = voiceRow(question, () => {
        for (const button of parts.buttons) button.disabled = true;
        parts.actions.hidden = true;
      });
      body.replaceChildren(
        voice.row,
        h('div', { class: 'wv-quiz-prompt', text: t(question.choiceKind === 'spelling' ? 'quizListenPromptSpelling' : 'quizListenPrompt', { language: languages.name(question.targetLang) }) }),
        voice.notice,
        h('div', { class: 'wv-quiz-choices' }, parts.buttons),
        h('div', { class: 'wv-quiz-foot' }, parts.actions, parts.feedback),
      );
      return { ...parts, unveil: voice.unveil, onShown: voice.autoplay };
    }

    // --- Writing: the meaning is shown, the word is typed. Expert: the word is said, and typed. ---

    function writingBody(question) {
      // Expert: nothing is shown, neither the word nor what it means; it is heard.
      const heard = question.mode === 'expert';
      const check = { lang: question.sourceLang, accentTolerant: question.accentTolerant === true };
      const accepted = Array.isArray(question.accept) && question.accept.length > 0 ? question.accept : [question.answer];
      const letters = WV.quizAnswers.letterCount(question.answer);
      let hints = 0;

      const hintLine = h('div', { class: 'wv-quiz-hint', dir: 'auto', lang: question.sourceLang || null, hidden: true });
      const input = h('input', {
        class: 'wv-quiz-input',
        type: 'text',
        autocomplete: 'off',
        autocapitalize: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        dir: 'auto',
        lang: question.sourceLang || null,
        'aria-label': t(heard ? 'quizExpertPrompt' : 'quizWritePrompt', { language: languages.name(question.sourceLang) }),
      });
      const voice = heard
        ? voiceRow(question, () => {
            input.disabled = true;
            submit.disabled = true;
            actions.hidden = true;
            hintLine.hidden = true;
          })
        : null;
      // What is typed here is for the quiz only: a page's own keyboard shortcuts must not see
      // it (a video player would pause on "k"). And typing keeps the question from timing out.
      for (const type of ['keydown', 'keyup', 'keypress']) input.addEventListener(type, (event) => event.stopPropagation());
      input.addEventListener('input', () => restartTimeout());
      const submit = h('button', { class: 'wv-quiz-submit', type: 'submit', 'data-action': 'check', text: t('quizWriteCheck') });
      const result = h('div', { class: 'wv-quiz-result', role: 'status', hidden: true });
      const feedback = h('div', { class: 'wv-quiz-feedback', role: 'status', hidden: true });
      const hintButton = h('button', { class: 'wv-quiz-action', type: 'button', 'data-action': 'hint', title: t('quizHintHint'), text: t('quizHint'), onclick: () => hint() });
      const actions = h(
        'div',
        { class: 'wv-quiz-actions' },
        hintButton,
        h('button', { class: 'wv-quiz-action', type: 'button', 'data-action': 'skip', title: t('quizSkipHint'), text: t('quizSkip'), onclick: () => skip() }),
        laterButton(),
      );
      const asked = () => current && current.question === question && !current.outcome;

      /** One more letter of the answer. The last one is never given away: that would be the answer. */
      function hint() {
        if (!asked() || hints >= letters - 1) return;
        hints += 1;
        hintLine.textContent = WV.quizAnswers.hintMask(question.answer, hints);
        hintLine.hidden = false;
        hintButton.disabled = hints >= letters - 1;
        restartTimeout();
        input.focus();
      }

      /** The right answer, with the letters the typed one missed marked. */
      function showAnswer(typed) {
        const parts = typed === null ? [...question.answer].map((char) => ({ char, ok: true })) : WV.quizAnswers.diff(typed, question.answer, check);
        const word = h('div', { class: 'wv-quiz-answer', dir: 'auto', lang: question.sourceLang || null }, parts.map((part) => h('span', { class: part.ok ? null : 'wv-miss', text: part.char })));
        result.replaceChildren(
          word,
          typed !== null && h('div', { class: 'wv-quiz-typed' }, t('quizWriteTyped'), ' ', h('span', { dir: 'auto', text: typed })),
        );
        result.hidden = false;
        showMeaning();
      }

      /** Expert: now that the question is over, what the word means may be seen. */
      function showMeaning() {
        if (!heard) return;
        voice.unveil();
        if (question.meaning && !result.querySelector('.wv-quiz-meaning')) result.append(h('div', { class: 'wv-quiz-meaning', dir: 'auto', lang: question.targetLang || null, text: question.meaning }));
        result.hidden = false;
      }

      function done(messageKey, correct) {
        input.disabled = true;
        submit.disabled = true;
        actions.hidden = true;
        hintLine.hidden = true;
        feedback.textContent = t(messageKey);
        feedback.classList.add(correct ? 'wv-right' : 'wv-wrong');
        feedback.hidden = false;
      }

      function send() {
        if (!asked()) return;
        const typed = input.value;
        if (typed.trim() === '') {
          input.focus();
          return;
        }
        const correct = WV.quizAnswers.isCorrect(typed, accepted, check);
        const following = finish('answer', { correct, hints, letters, ms: current.stopwatch.elapsed() });
        if (correct) {
          input.classList.add('wv-right');
          showMeaning();
          done(hints > 0 ? 'quizWriteCorrectHint' : 'quizCorrect', true);
        } else {
          input.classList.add('wv-wrong');
          showAnswer(typed);
          done('quizWriteWrong', false);
        }
        moveOn(following, correct ? RIGHT_MS : WRITE_WRONG_MS);
      }

      /** "Skip": the answer is shown, the question counts as not known. */
      function skip() {
        const following = finish('unknown', { hints, letters });
        if (!following) return;
        showAnswer(null);
        done('quizSkipFeedback', false);
        moveOn(following, WRONG_MS);
      }

      body.replaceChildren(
        heard ? voice.row : h('div', { class: 'wv-quiz-word', dir: 'auto', lang: question.targetLang || null, text: question.word }),
        h('div', { class: 'wv-quiz-prompt', text: t(heard ? 'quizExpertPrompt' : 'quizWritePrompt', { language: languages.name(question.sourceLang) }) }),
        heard && voice.notice,
        hintLine,
        h(
          'form',
          {
            class: 'wv-quiz-write',
            onsubmit: (event) => {
              event.preventDefault();
              send();
            },
          },
          input,
          submit,
        ),
        result,
        h('div', { class: 'wv-quiz-foot' }, actions, feedback),
      );
      return {
        buttons: [],
        actions,
        feedback,
        onShown: () => {
          input.focus({ preventScroll: true });
          voice?.autoplay();
        },
      };
    }

    /** Starts the time an unanswered question may stay (again, when the user is typing). */
    function restartTimeout() {
      const asked = current;
      if (!timeoutMs || !asked || asked.outcome) return;
      clearTimeout(asked.timeoutTimer);
      asked.countdown?.cancel();
      timerBar.hidden = false;
      asked.countdown = startCountdown(bar, timeoutMs);
      asked.timeoutTimer = setTimeout(() => {
        // Nobody is there: the rest of the quiz is not asked either.
        if (current === asked && !asked.outcome) close(finish('timeout'));
      }, timeoutMs);
    }

    const BODIES = { classic: classicBody, writing: writingBody, listening: listeningBody, expert: writingBody };

    function showQuestion(question, index) {
      progress.textContent = total > 1 ? t('quizProgress', { current: index || 1, total: total }) : '';
      const asked = { index, question, buttons: [], actions: null, feedback: null, stopwatch: WV.createStopwatch(), outcome: '', countdown: null, timeoutTimer: 0 };
      current = asked;
      Object.assign(asked, (BODIES[question.mode] || classicBody)(question));

      // The answer time starts when the question is on screen: after the first frame with it
      // in it has been painted. In a tab that is not visible no frame is painted, and the
      // stopwatch waits with it.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (current !== asked || asked.outcome) return;
          asked.stopwatch.start();
          asked.onShown?.();
        }),
      );

      // ASSUMPTION: the timeout runs in real time, also while the tab is hidden; only the answer
      // time is paused there. A quiz nobody is looking at then goes away by itself instead of
      // waiting in a background tab while the next one appears somewhere else.
      restartTimeout();
    }

    /**
     * "3/5 correct", for a quiz that asked more than one question.
     * ASSUMPTION: the second number is the questions that were answered; ones put off with
     * "Ask later" are mentioned separately. The summary goes away by itself after a few seconds.
     */
    function showSummary(summary) {
      current = null;
      progress.textContent = '';
      shownSummary = summary;
      drawSummary(summary);
      advanceTimer = setTimeout(close, SUMMARY_MS);
    }

    function drawSummary(summary) {
      body.replaceChildren(
        h(
          'div',
          { class: 'wv-quiz-summary', role: 'status' },
          h('div', { class: 'wv-quiz-score', text: t('quizSummary', { correct: summary.right, total: summary.answered }) }),
          summary.skipped > 0 && h('div', { class: 'wv-quiz-prompt', text: t('quizSummarySkipped', { count: summary.skipped }) }),
        ),
      );
    }

    /**
     * The interface language changed while the quiz is on screen: its frame follows at once. The
     * question follows too if nothing has been done in it yet (no letter typed, no hint taken);
     * otherwise it stays as it is, and the next one comes in the new language. The clocks run on.
     */
    let shownSummary = null;
    function relabel() {
      if (closed) return;
      card.setAttribute('aria-label', t('quizTitle'));
      title.textContent = t('quizTitle');
      closeButton.textContent = t('quizClose');
      muteButton.title = t('quizMuteHint');
      muteButton.textContent = t(warned ? 'quizMuteAnyway' : 'quizMute');
      if (warned && streak) warning.textContent = t('quizMuteWarning', { count: streak.count });
      if (streak) streakSlot.replaceChildren(WV.progressUi.flame(streak));
      if (!current) {
        if (shownSummary) drawSummary(shownSummary);
        return;
      }
      progress.textContent = total > 1 ? t('quizProgress', { current: current.index || 1, total }) : '';
      const untouched = !current.outcome && !body.querySelector('.wv-quiz-input')?.value && body.querySelector('.wv-quiz-hint')?.hidden !== false;
      if (!untouched) return;
      const focused = body.contains(body.getRootNode().activeElement);
      Object.assign(current, (BODIES[current.question.mode] || classicBody)(current.question), { onShown: null });
      if (focused) body.querySelector('.wv-quiz-input, button')?.focus({ preventScroll: true });
    }
    const stopRelabel = WV.i18n.onChange(relabel);

    root.replaceChildren(card);
    refreshStreak();
    showQuestion(quiz.question, quiz.index);
    return { close, isOpen: () => !closed };
  }

  // --- As a card over the page -------------------------------------------------------------------

  let surface = null;
  let floating = null; // the card on this page

  /** Shows the quiz as a card in the top right corner (replacing the one on screen, if any). */
  function show(quiz, hooks = {}) {
    surface ||= WV.createSurface(WV.styles.quiz);
    floating?.close();
    const card = mount(surface.root, quiz, {
      ...hooks,
      floating: true,
      onClose: () => {
        hooks.onClose?.();
        if (floating !== card) return; // a newer card has taken its place in the meantime
        floating = null;
        surface.unmount();
      },
    });
    floating = card;
    surface.mount(null);
    return card;
  }

  WV.quizCard = { mount, show, close: () => floating?.close(), isOpen: () => Boolean(floating?.isOpen()) };
})(globalThis.WV);
