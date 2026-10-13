// Toolbar popup: the vault. Lists the saved words, shows the details of one, and links to
// export, import and the settings.

import { supportLink } from '../support/support.js';
import { looksDamaged } from '../lib/text-damage.js';
import { downloadBackup } from '../lib/backup.js';
import { getPreferences, setTargetLanguage } from '../lib/translator.js';
import { listEntries, removeEntry } from '../lib/vault.js';

const WV = globalThis.WV;
const { h, t, icon, languages } = WV;

WV.adoptStyles(WV.styles.tokens + WV.styles.controls);
document.documentElement.lang = languages.uiLanguage();

const ICON_BACK = 'M15 6l-6 6 6 6';
const ICON_SETTINGS = 'M4 7h9M17 7h3M15 5v4M4 17h3M11 17h9M9 15v4';
const ICON_SCAN = 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 10h8M8 14h5';
const ICON_TRASH = 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6';

/** Example sentences shown per word: Wiktionary's, topped up with the saved sentence below this. */
const MAX_EXAMPLES = 5;
const MIN_EXAMPLES = 3;
/** How long a "Delete?" confirmation stays armed. */
const CONFIRM_MS = 3000;

// Wiktionary names word types in English; the common ones are shown in the UI language.
const PART_OF_SPEECH_KEYS = {
  noun: 'posNoun',
  'proper noun': 'posProperNoun',
  verb: 'posVerb',
  adjective: 'posAdjective',
  adverb: 'posAdverb',
  pronoun: 'posPronoun',
  preposition: 'posPreposition',
  conjunction: 'posConjunction',
  interjection: 'posInterjection',
  determiner: 'posDeterminer',
  article: 'posArticle',
  numeral: 'posNumeral',
  phrase: 'posPhrase',
};

const state = {
  entries: [],
  prefs: null, // { languages, targetLang, targetChosen }
  view: 'list', // 'list', 'detail' or 'languages'
  openId: null, // entry shown in the detail view
  query: '',
  language: '', // source-language filter ('' = all)
  confirmId: null, // entry whose delete button is armed
  enriching: new Set(), // ids whose dictionary data is being fetched
  tab: 'all', // 'all' (the vault) or 'learned' ("My vocabulary": the words that are learned)
  onlyDamaged: false, // list only the words whose translation seems to have lost letters
  failed: new Set(), // ids whose dictionary data could not be fetched
};
let confirmTimer = 0;

const fold = (value) => String(value || '').toLocaleLowerCase(languages.uiLanguage()).normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i');

function iconButton(path, labelKey, onclick) {
  return h('button', { class: 'wv-btn-icon', type: 'button', title: t(labelKey), 'aria-label': t(labelKey), onclick }, icon(path));
}

// --- Static frame ------------------------------------------------------------------------------

const count = h('span', { class: 'count' });
const targetLabel = h('span', { class: 'wv-chip-label' });
const targetChip = h('button', { class: 'wv-chip', type: 'button', title: t('popupTargetLang'), onclick: () => show('languages') }, targetLabel);

const setupText = h('div');
const setup = h(
  'div',
  { class: 'setup', hidden: true },
  setupText,
  h(
    'div',
    { class: 'setup-actions' },
    h('button', { class: 'wv-btn wv-btn-sm wv-btn-primary', type: 'button', text: t('firstRunConfirm'), onclick: () => chooseTarget(state.prefs.targetLang) }),
    h('button', { class: 'wv-btn wv-btn-sm', type: 'button', text: t('firstRunChange'), onclick: () => show('languages') }),
  ),
);

const search = h('input', {
  type: 'search',
  placeholder: t('tbSearch'),
  'aria-label': t('tbSearch'),
  oninput: () => {
    state.query = search.value;
    renderList();
  },
});
const languageFilter = h('select', {
  'aria-label': t('tbAllLanguages'),
  onchange: () => {
    state.language = languageFilter.value;
    renderList();
  },
});
const filters = h('div', { class: 'filters' }, search, languageFilter);

// Two views of the same vault: every saved word, and "My vocabulary": the ones that are
// learned (quiz/learning.js). A learned word stays in the first list too; nothing is moved.
const isLearned = (entry) => Number(entry.quiz?.g) > 0;
const tabButton = (name, labelKey) =>
  h('button', { class: 'vault-tab', type: 'button', role: 'tab', 'data-tab': name, onclick: () => selectTab(name) }, h('span', { text: t(labelKey) }), ' ', h('span', { class: 'vault-tab-count' }));
const vaultTabs = { all: tabButton('all', 'tbTabAll'), learned: tabButton('learned', 'tbTabLearned') };
const tabBar = h('div', { class: 'vault-tabs', role: 'tablist' }, vaultTabs.all, vaultTabs.learned);
const learnedSummary = h('div', { class: 'learned-summary', role: 'status', hidden: true });

function selectTab(name) {
  state.tab = name;
  state.confirmId = null;
  renderTabs();
  renderList();
}

function renderTabs() {
  const learned = state.entries.filter(isLearned).length;
  for (const [name, button] of Object.entries(vaultTabs)) {
    button.setAttribute('aria-selected', String(state.tab === name));
    button.querySelector('.vault-tab-count').textContent = String(name === 'learned' ? learned : state.entries.length);
  }
  tabBar.hidden = state.entries.length === 0;
  learnedSummary.hidden = state.tab !== 'learned' || state.entries.length === 0;
  learnedSummary.textContent = learned === 1 ? t('tbLearnedOne') : t('tbLearnedTotal', [String(learned)]);
}

const learnedDate = (time) => new Date(time).toLocaleDateString(languages.uiLanguage(), { day: 'numeric', month: 'short', year: 'numeric' });
// Words whose saved translation seems to have lost letters on the way from the translation
// service ("e?itle"). They are pointed out, never changed: the vault is the user's.
const damagedText = h('span');
const damagedToggle = h('button', {
  class: 'wv-link',
  type: 'button',
  onclick: () => {
    state.onlyDamaged = !state.onlyDamaged;
    renderDamaged();
    renderList();
  },
});
const damagedNotice = h('div', { class: 'notice', role: 'status', hidden: true }, damagedText, ' ', damagedToggle);
const isDamaged = (entry) => [entry.translation, ...(entry.alternatives || [])].some((value) => looksDamaged(value, entry.text));

function renderDamaged() {
  const total = state.entries.filter(isDamaged).length;
  if (total === 0) state.onlyDamaged = false;
  damagedNotice.hidden = total === 0;
  damagedText.textContent = t('tbDamaged', [String(total)]);
  damagedToggle.textContent = t(state.onlyDamaged ? 'tbDamagedAll' : 'tbDamagedShow');
}
const list = h('div', { class: 'list' });
const status = h('span', { class: 'status', role: 'status' });
const listView = h(
  'section',
  { class: 'view' },
  setup,
  tabBar,
  filters,
  learnedSummary,
  damagedNotice,
  list,
  h(
    'footer',
    { class: 'foot' },
    h('button', { class: 'wv-btn wv-btn-sm', type: 'button', text: t('tbExport'), onclick: exportVault }),
    h('button', { class: 'wv-btn wv-btn-sm', type: 'button', text: t('tbImport'), onclick: openImport }),
    status,
    // Only there when a support page is configured (config.js).
    supportLink() || '',
  ),
);
const detailView = h('section', { class: 'view', hidden: true });
const languageList = languages.createList({ onSelect: (code) => chooseTarget(code) });
const languagesView = h(
  'section',
  { class: 'view', hidden: true },
  h('div', { class: 'view-head' }, iconButton(ICON_BACK, 'popupBack', () => show('list')), h('h2', { text: t('popupTargetLang') })),
  h('div', { class: 'languages' }, languageList.element),
);

document.getElementById('app').append(
  h(
    'header',
    { class: 'bar' },
    h('img', { src: '../icons/icon-48.png', alt: '', width: '24', height: '24' }),
    h('h1', { text: 'Wordvault' }),
    count,
    targetChip,
    iconButton(ICON_SCAN, 'ocrMenuScan', scanScreen),
    iconButton(ICON_SETTINGS, 'tbSettings', openSettings),
  ),
  listView,
  detailView,
  languagesView,
);

// --- Views -------------------------------------------------------------------------------------

function show(view, openId = null) {
  state.view = view;
  state.openId = openId;
  listView.hidden = view !== 'list';
  detailView.hidden = view !== 'detail';
  languagesView.hidden = view !== 'languages';
  if (view === 'detail') renderDetail();
  if (view === 'languages' && state.prefs) {
    languageList.setOptions({ codes: state.prefs.languages, value: state.prefs.targetLang });
    languageList.focus();
  }
}

function renderHeader() {
  const total = state.entries.length;
  count.textContent = total === 1 ? t('tbCountOne') : t('tbCount', [String(total)]);
  const { prefs } = state;
  targetLabel.textContent = prefs ? t('tbTarget', [languages.name(prefs.targetLang)]) : '';
  targetChip.hidden = !prefs;
  const needsSetup = Boolean(prefs) && !prefs.targetChosen;
  setup.hidden = !needsSetup;
  if (needsSetup) setupText.textContent = t('firstRunText', [languages.name(prefs.targetLang)]);
}

function renderFilters() {
  const present = [...new Set(state.entries.map((entry) => entry.sourceLang).filter(Boolean))];
  if (!present.includes(state.language)) state.language = '';
  const collator = new Intl.Collator(languages.uiLanguage());
  const options = present.map((code) => ({ code, name: languages.name(code) })).sort((a, b) => collator.compare(a.name, b.name));
  languageFilter.replaceChildren(
    h('option', { value: '', text: t('tbAllLanguages') }),
    ...options.map(({ code, name }) => h('option', { value: code, text: name })),
  );
  languageFilter.value = state.language;
  // With nothing saved there is nothing to search or filter.
  filters.hidden = state.entries.length === 0;
}

function matches(entry) {
  if (state.tab === 'learned' && !isLearned(entry)) return false;
  if (state.onlyDamaged && !isDamaged(entry)) return false;
  if (state.language && entry.sourceLang !== state.language) return false;
  const query = fold(state.query.trim());
  if (!query) return true;
  return [entry.text, entry.translation, ...entry.alternatives].some((value) => fold(value).includes(query));
}

function emptyState(titleKey, hintKey) {
  return h('div', { class: 'empty' }, h('strong', { text: t(titleKey) }), hintKey && t(hintKey));
}

function renderList() {
  if (state.entries.length === 0) {
    list.replaceChildren(emptyState('tbEmptyTitle', 'tbEmptyHint'));
    return;
  }
  const learnedView = state.tab === 'learned';
  if (learnedView && !state.entries.some(isLearned)) {
    list.replaceChildren(emptyState('tbLearnedEmptyTitle', 'tbLearnedEmptyHint'));
    return;
  }
  const visible = state.entries.filter(matches);
  // "My vocabulary" lists the most recently learned first.
  if (learnedView) visible.sort((a, b) => b.quiz.g - a.quiz.g);
  if (visible.length === 0) {
    list.replaceChildren(emptyState('tbNoMatch'));
    return;
  }
  list.replaceChildren(
    ...visible.map((entry) => {
      const confirming = state.confirmId === entry.id;
      return h(
        'div',
        { class: 'row' },
        h(
          'button',
          { class: 'row-main', type: 'button', onclick: () => show('detail', entry.id) },
          h('span', { class: 'row-word', dir: 'auto', lang: entry.sourceLang || null, text: entry.text }),
          h('span', { class: 'row-pair', text: [entry.sourceLang || '?', entry.targetLang || '?'].join(' → ').toUpperCase() }),
          h('span', { class: 'row-translation', dir: 'auto', lang: entry.targetLang || null, text: entry.translation || t('dtNoTranslation') }),
          // when it was learned, in "My vocabulary"; a small mark in the list of everything
          learnedView ? h('span', { class: 'row-learned', text: t('tbLearnedOn', [learnedDate(entry.quiz.g)]) }) : isLearned(entry) && h('span', { class: 'row-badge', title: t('tbLearnedOn', [learnedDate(entry.quiz.g)]), text: t('tbLearnedBadge') }),
        ),
        confirming
          ? h('button', { class: 'wv-btn wv-btn-sm confirm', type: 'button', text: t('tbDeleteConfirm'), onclick: () => remove(entry.id) })
          : iconButton(ICON_TRASH, 'tbDelete', () => armDelete(entry.id)),
      );
    }),
  );
}

// --- Detail ------------------------------------------------------------------------------------

function partOfSpeechLabel(name) {
  const key = PART_OF_SPEECH_KEYS[name.toLowerCase()];
  return key ? t(key) : name;
}

/** Wiktionary's examples; if those are too few, the sentence the word was saved from joins them. */
function collectExamples(entry) {
  const seen = new Set();
  const examples = [];
  for (const group of entry.dictionary?.groups || []) {
    for (const definition of group.definitions) {
      for (const example of definition.examples) {
        if (seen.has(fold(example.text))) continue;
        seen.add(fold(example.text));
        examples.push(example);
      }
    }
  }
  const picked = examples.slice(0, MAX_EXAMPLES);
  if (picked.length < MIN_EXAMPLES && entry.sentence && !seen.has(fold(entry.sentence))) {
    picked.push({ text: entry.sentence, translation: '', own: true });
  }
  return picked;
}

function dictionarySection(entry) {
  const heading = h('h3', {}, t('dtMeanings'), ' ', h('small', { text: t('dtMeaningsSource') }));
  if (!entry.dictionary) {
    const body = state.failed.has(entry.id)
      ? h('div', { class: 'muted', text: t('dtDictionaryError') })
      : h('div', { class: 'loading' }, h('span', { class: 'wv-spinner' }), t('dtLoadingDictionary'));
    return [heading, body];
  }
  if (entry.dictionary.groups.length === 0) return [heading, h('div', { class: 'muted', text: t('dtNoDictionary') })];
  return [
    heading,
    ...entry.dictionary.groups.flatMap((group) => [
      group.partOfSpeech && h('span', { class: 'pos', text: partOfSpeechLabel(group.partOfSpeech) }),
      h('ol', { class: 'definitions' }, ...group.definitions.map((definition) => h('li', { text: definition.text }))),
    ]),
  ];
}

function originSection(entry) {
  if (!entry.sentence && !entry.url) return [];
  let link = null;
  if (/^https?:/.test(entry.url)) {
    // Only web addresses become links; the entry may come from an imported file.
    link = h('a', { href: entry.url, target: '_blank', rel: 'noopener noreferrer', text: entry.title || new URL(entry.url).hostname });
  }
  const date = new Date(entry.createdAt).toLocaleDateString(languages.uiLanguage(), { year: 'numeric', month: 'long', day: 'numeric' });
  return [
    h('h3', { text: t('dtSavedFrom') }),
    h(
      'div',
      { class: 'origin' },
      entry.sentence && h('blockquote', { dir: 'auto', lang: entry.sourceLang || null, text: entry.sentence }),
      link,
      h('span', { class: 'date', text: t('dtSavedOn', [date]) }),
    ),
  ];
}

function renderDetail() {
  const entry = state.entries.find((candidate) => candidate.id === state.openId);
  if (!entry) {
    show('list'); // removed while it was open
    return;
  }
  if (!entry.dictionary) loadDictionary(entry.id);

  const examples = collectExamples(entry);
  const confirming = state.confirmId === entry.id;
  detailView.replaceChildren(
    h(
      'div',
      { class: 'view-head' },
      iconButton(ICON_BACK, 'popupBack', () => show('list')),
      h('h2', { dir: 'auto', lang: entry.sourceLang || null, text: entry.text }),
      confirming
        ? h('button', { class: 'wv-btn wv-btn-sm confirm', type: 'button', text: t('tbDeleteConfirm'), onclick: () => remove(entry.id) })
        : iconButton(ICON_TRASH, 'tbDelete', () => armDelete(entry.id)),
    ),
    h(
      'div',
      { class: 'detail' },
      h('div', { class: 'pair', text: `${languages.name(entry.sourceLang) || '?'} → ${languages.name(entry.targetLang) || '?'}` }),
      entry.translation
        ? h('div', { class: 'translation', dir: 'auto', lang: entry.targetLang || null, text: entry.translation })
        : h('div', { class: 'translation none', text: t('dtNoTranslation') }),
      entry.alternatives.length > 0 &&
        h('div', { class: 'alternatives' }, h('b', { text: t('popupAlternatives') }), ' ', h('span', { dir: 'auto', lang: entry.targetLang || null, text: entry.alternatives.join(', ') })),
      ...dictionarySection(entry),
      examples.length > 0 && h('h3', { text: t('dtExamples') }),
      examples.length > 0 &&
        h(
          'ul',
          { class: 'examples' },
          ...examples.map((example) =>
            h(
              'li',
              {},
              h('span', { dir: 'auto', lang: entry.sourceLang || null, text: example.text }),
              example.own && h('span', { class: 'tag', text: t('dtYourSentence') }),
              example.translation && h('span', { class: 'gloss', text: example.translation }),
            ),
          ),
        ),
      ...originSection(entry),
    ),
  );
}

/** Asks the background script for the Wiktionary data of an entry that has none yet. */
async function loadDictionary(id) {
  if (state.enriching.has(id) || state.failed.has(id)) return;
  state.enriching.add(id);
  let entry = null;
  try {
    entry = await WV.send('wv:vault:enrich', { id });
  } catch {
    // Reported below as "could not load".
  }
  state.enriching.delete(id);
  // On success the storage change event re-renders the view with the new data.
  if (!entry?.dictionary) {
    state.failed.add(id);
    if (state.view === 'detail' && state.openId === id) renderDetail();
  }
}

// --- Actions -----------------------------------------------------------------------------------

function rerender() {
  renderHeader();
  renderFilters();
  renderTabs();
  renderDamaged();
  renderList();
  if (state.view === 'detail') renderDetail();
}

/** First click on a trash button arms it ("Delete?"); the second one deletes. */
function armDelete(id) {
  state.confirmId = id;
  clearTimeout(confirmTimer);
  confirmTimer = setTimeout(() => {
    state.confirmId = null;
    rerender();
  }, CONFIRM_MS);
  rerender();
}

async function remove(id) {
  clearTimeout(confirmTimer);
  state.confirmId = null;
  await removeEntry(id); // the storage change event refreshes the list
}

async function chooseTarget(code) {
  await setTargetLanguage(code);
  state.prefs = await getPreferences();
  show('list');
  renderHeader();
}

async function exportVault() {
  const exported = await downloadBackup();
  status.textContent = t('bkExported', [String(exported)]);
}

function openImport() {
  // The file picker is opened from the options page: a toolbar popup closes as soon as another
  // window (the picker) takes focus, and the chosen file would never arrive.
  chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#backup') });
  window.close();
}

/** Starts a screen text scan on the tab this popup was opened over, and gets out of its way. */
async function scanScreen() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  await WV.send('wv:ocr:begin', { tabId: tab?.id }).catch(() => {});
  window.close();
}

function openSettings() {
  chrome.runtime.openOptionsPage();
  window.close();
}

async function load() {
  [state.entries, state.prefs] = await Promise.all([listEntries(), getPreferences()]);
  rerender();
}

load();
// Words can be added from a page, or settings changed, while the popup is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') load();
});
