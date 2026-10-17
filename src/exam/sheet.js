// The printable test: an A4 sheet with a header (name, score), the fill-in-the-blank questions
// with the word box, the true/false questions, and the answer key on a page of its own. It can
// be filled in on screen and checked, or printed (the browser's "Save as PDF" makes the file).
// What a model wrote goes onto the page as text only (WV.h 'text', textContent), never as markup.

import { BLANK, FILL_BLANK, TRUE_FALSE } from './config.js';
import { gradeQuestion, score, wordBox } from './grade.js';
import { getSettings } from '../lib/settings.js';

const { h, t, languages } = globalThis.WV;
const { i18n } = globalThis.WV;

await i18n.startPage();
globalThis.WV.adoptStyles(globalThis.WV.styles.tokens + globalThis.WV.styles.controls);

const app = document.getElementById('app');
const id = new URLSearchParams(location.search).get('id') || '';
const exam = id ? await globalThis.WV.send('wv:exam:get', { id }).catch(() => null) : null;
const close = () => h('button', { class: 'wv-btn', type: 'button', text: t('sheetClose'), onclick: () => window.close() });

if (!exam) {
  document.title = t('sheetTitle');
  app.append(h('div', { class: 'toolbar' }, h('strong', { class: 'grow', text: t('sheetMissing') }), close()));
} else {
  const settings = await getSettings();
  const options = { lang: exam.language, accentTolerant: settings.quizAccentTolerant !== false };
  const languageName = languages.name(exam.language) || exam.language;
  const contentDir = i18n.dir(exam.language);
  const explanationDir = i18n.dir(exam.explanationLang || '');
  document.title = `${t('sheetTitle')} – ${languageName} ${exam.level}`;

  const fills = exam.questions.filter((question) => question.type === FILL_BLANK);
  const statements = exam.questions.filter((question) => question.type === TRUE_FALSE);
  // Numbered in the order they are printed: the blanks first, then the statements.
  const ordered = [...fills, ...statements];
  const numberOf = new Map(ordered.map((question, index) => [question.id, index + 1]));
  /** question id -> what was written or chosen */
  const answers = {};
  const rows = new Map();

  const scoreLine = h('span', { class: 'fill' });
  const result = h('p', { class: 'result', role: 'status' });

  // --- The questions ---------------------------------------------------------------------------

  function fillRow(question) {
    const number = numberOf.get(question.id);
    const [before, ...rest] = question.text.split(BLANK);
    const input = h('input', {
      class: 'blank',
      type: 'text',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      'aria-label': t('sheetBlankLabel', { number }),
      oninput: () => {
        answers[question.id] = input.value;
      },
    });
    const mark = h('span', { class: 'mark', dir: 'auto', hidden: true });
    const row = h('li', { class: 'question' }, h('span', { class: 'num', text: `${number}.` }), h('span', { class: 'text', lang: exam.language, dir: contentDir }, before, input, rest.join(BLANK)), h('span'), mark);
    rows.set(question.id, { row, mark });
    return row;
  }

  function statementRow(question) {
    const number = numberOf.get(question.id);
    const choice = (value, labelKey, nameKey) =>
      h(
        'label',
        { title: t(nameKey) },
        h('input', {
          type: 'radio',
          name: `tf-${question.id}`,
          'aria-label': t(nameKey),
          onchange: () => {
            answers[question.id] = value;
          },
        }),
        h('span', { 'aria-hidden': 'true', text: t(labelKey) }),
      );
    const mark = h('span', { class: 'mark', dir: 'auto', hidden: true });
    const row = h(
      'li',
      { class: 'question' },
      h('span', { class: 'num', text: `${number}.` }),
      h('span', { class: 'text', lang: exam.language, dir: contentDir, text: question.text }),
      h('span', { class: 'tf', role: 'radiogroup', 'aria-label': t('sheetTrueFalseLabel', { number }) }, choice(true, 'sheetTrueShort', 'examTrue'), choice(false, 'sheetFalseShort', 'examFalse')),
      mark,
    );
    rows.set(question.id, { row, mark });
    return row;
  }

  const correctText = (question) => (question.type === FILL_BLANK ? [question.answer, ...(question.acceptable || [])].join(' / ') : t(question.isTrue ? 'examTrue' : 'examFalse'));

  // --- The sheet --------------------------------------------------------------------------------

  let section = 0;
  const sections = [];
  if (fills.length > 0) {
    section += 1;
    sections.push(
      h('h2', { text: `${section}. ${t('examKindFill')}` }),
      h('p', { class: 'instructions', text: t('sheetFillInstructions') }),
      h('div', { class: 'word-box', lang: exam.language, dir: contentDir, 'aria-label': t('sheetWordBox') }, wordBox(fills, exam.id).map((word) => h('span', { text: word }))),
      h('ol', { class: 'questions' }, fills.map(fillRow)),
    );
  }
  if (statements.length > 0) {
    section += 1;
    sections.push(h('h2', { text: `${section}. ${t('examKindTrueFalse')}` }), h('p', { class: 'instructions', text: t('sheetTrueFalseInstructions') }), h('ol', { class: 'questions' }, statements.map(statementRow)));
  }

  const date = new Intl.DateTimeFormat(languages.uiLanguage(), { dateStyle: 'long' }).format(exam.createdAt || Date.now());
  const paper = h(
    'article',
    { class: 'paper', 'aria-labelledby': 'sheet-title' },
    h('h1', { id: 'sheet-title', text: t('sheetTitle') }),
    h('p', { class: 'meta', text: `${languageName} · ${t('sheetLevel', { level: exam.level })} · ${date}` }),
    h('div', { class: 'lines' }, h('span', { class: 'line' }, h('span', { text: t('sheetName') }), h('span', { class: 'fill' })), h('span', { class: 'line score' }, h('span', { text: t('sheetScore') }), scoreLine, h('span', { text: `/ ${exam.questions.length}` }))),
    sections,
  );

  const key = h(
    'article',
    { class: 'paper key', 'aria-labelledby': 'key-title' },
    h('h1', { id: 'key-title', text: t('sheetKeyTitle') }),
    h('p', { class: 'meta', text: `${languageName} · ${t('sheetLevel', { level: exam.level })}` }),
    h(
      'ol',
      null,
      ordered.map((question) =>
        h(
          'li',
          null,
          h('span', { class: 'answer', lang: question.type === FILL_BLANK ? exam.language : null, dir: question.type === FILL_BLANK ? contentDir : null, text: correctText(question) }),
          h('span', { class: 'explanation', lang: exam.explanationLang || null, dir: explanationDir, text: question.explanation }),
        ),
      ),
    ),
  );

  // --- Toolbar ----------------------------------------------------------------------------------

  let showing = false;
  const showButton = h('button', {
    class: 'wv-btn',
    type: 'button',
    'aria-pressed': 'false',
    text: t('sheetShowAnswers'),
    onclick: () => {
      showing = !showing;
      showButton.setAttribute('aria-pressed', String(showing));
      showButton.textContent = t(showing ? 'sheetHideAnswers' : 'sheetShowAnswers');
      for (const question of exam.questions) {
        const { mark, row } = rows.get(question.id);
        if (row.classList.contains('right') || row.classList.contains('wrong')) continue;
        mark.hidden = !showing;
        mark.className = 'mark';
        mark.textContent = showing ? `${t('sheetCorrectAnswer')}: ${correctText(question)}` : '';
      }
    },
  });

  function check() {
    const { right, total, graded } = score(exam.questions, answers, options);
    exam.questions.forEach((question, index) => {
      const { row, mark } = rows.get(question.id);
      const { answered, correct } = graded[index];
      row.classList.toggle('right', correct);
      row.classList.toggle('wrong', !correct);
      mark.hidden = false;
      mark.className = `mark ${correct ? 'right' : 'wrong'}`;
      mark.textContent = correct ? t('sheetRight') : `${t(answered ? 'sheetWrong' : 'sheetEmpty')} ${t('sheetCorrectAnswer')}: ${correctText(question)}`;
    });
    scoreLine.textContent = String(right);
    result.textContent = t('sheetScoreResult', { right, total });
  }

  function reset() {
    for (const key of Object.keys(answers)) delete answers[key];
    for (const input of paper.querySelectorAll('input')) {
      if (input.type === 'radio') input.checked = false;
      else input.value = '';
    }
    for (const { row, mark } of rows.values()) {
      row.classList.remove('right', 'wrong');
      mark.hidden = !showing;
    }
    scoreLine.textContent = '';
    result.textContent = '';
    if (showing) {
      showing = false;
      showButton.click();
    }
  }

  const includeKey = h('input', { type: 'checkbox', checked: true, onchange: () => key.classList.toggle('excluded', !includeKey.checked) });
  const toolbar = h(
    'div',
    { class: 'toolbar', role: 'toolbar', 'aria-label': t('sheetToolbar') },
    h('button', { class: 'wv-btn wv-btn-primary', type: 'button', 'data-action': 'print', text: t('sheetPrint'), onclick: () => window.print() }),
    h('button', { class: 'wv-btn', type: 'button', 'data-action': 'check', text: t('sheetCheck'), onclick: check }),
    showButton,
    h('button', { class: 'wv-btn', type: 'button', text: t('sheetReset'), onclick: reset }),
    h('label', null, includeKey, h('span', { text: t('sheetIncludeKey') })),
    h('span', { class: 'grow' }),
    h('button', { class: 'wv-btn', type: 'button', 'data-action': 'regenerate', text: t('sheetRegenerate'), onclick: () => location.assign(`exam.html?regen=${encodeURIComponent(exam.id)}`) }),
    close(),
  );

  app.append(toolbar, h('p', { class: 'tip', text: t('sheetPrintTip') }), result, paper, key);
}
