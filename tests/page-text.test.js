// "Summarise this page": the main text of a page. What reads it (features/summary/content/
// extract.js) is run here the way a browser runs it, with Mozilla's Readability (the copy that
// is shipped) on documents made by the small HTML parser from the same package.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const sandbox = { WV: { supported: true }, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('./vendor/readability/JSDOMParser.js'), sandbox, { filename: 'JSDOMParser.js' });
vm.runInContext(read('../src/vendor/readability/Readability.js'), sandbox, { filename: 'Readability.js' });
vm.runInContext(read('../src/features/summary/content/extract.js'), sandbox, { filename: 'extract.js' });
const { pageText } = sandbox.WV;
// (the parser is a small one: it wants empty elements closed, `<br />`, and attributes with a value)
const parse = (html) => new sandbox.JSDOMParser().parse(html, 'https://news.example.com/story');

const paragraph = (index) => `<p>Paragraph ${index} of the story explains in a full sentence what happened on day ${index}, who was there, and why it mattered to the people of the town.</p>`;
const ARTICLE = Array.from({ length: 8 }, (_, index) => paragraph(index + 1)).join('\n');

const PAGE = `<!doctype html><html lang="en"><head><title>The long story</title>
<style>.x { color: red } /* STYLE-TEXT */</style><script>var secret = "SCRIPT-TEXT";</script></head>
<body>
<nav class="menu"><ul><li><a href="/">MENU-HOME</a></li><li><a href="/sport">MENU-SPORT</a></li><li><a href="/world">MENU-WORLD</a></li></ul></nav>
<header class="site-header"><a href="/">SITE-BANNER</a></header>
<aside class="sidebar ad"><div class="advert">ADVERT-BUY-NOW</div><ul><li><a href="/a">RELATED-ONE</a></li><li><a href="/b">RELATED-TWO</a></li></ul></aside>
<main><article>
<h1>The long story</h1>
${ARTICLE}
<form action="/search"><input type="text" name="q" value="TYPED-IN-FIELD" /><input type="password" value="PASSWORD-VALUE" /><input type="hidden" name="csrf" value="HIDDEN-TOKEN" />
<textarea name="comment">TEXTAREA-DRAFT</textarea><select><option>OPTION-TEXT</option></select><button>BUTTON-LABEL</button></form>
<div hidden=""><p>HIDDEN-ATTRIBUTE-TEXT is not shown to the reader of this page at all, though it is long enough to count.</p></div>
<div aria-hidden="true"><p>ARIA-HIDDEN-TEXT is not shown to the reader of this page at all, though it is long enough to count.</p></div>
<div contenteditable="true"><p>EDITABLE-DRAFT is what the user is writing into the page and it is long enough to count as a paragraph.</p></div>
<div role="textbox"><p>ROLE-TEXTBOX-DRAFT is what the user is writing into the page and it is long enough to count as a paragraph.</p></div>
<iframe src="https://ads.example.com/">IFRAME-TEXT</iframe><noscript>NOSCRIPT-TEXT</noscript><template><p>TEMPLATE-TEXT</p></template>
<wordvault-ui>WORDVAULT-OWN-UI</wordvault-ui>
</article></main>
<footer><p>FOOTER-COPYRIGHT</p><a href="/imprint">FOOTER-LINK</a></footer>
</body></html>`;

const NEVER = ['SCRIPT-TEXT', 'STYLE-TEXT', 'TYPED-IN-FIELD', 'PASSWORD-VALUE', 'HIDDEN-TOKEN', 'TEXTAREA-DRAFT', 'OPTION-TEXT', 'BUTTON-LABEL', 'HIDDEN-ATTRIBUTE-TEXT', 'ARIA-HIDDEN-TEXT', 'EDITABLE-DRAFT', 'ROLE-TEXTBOX-DRAFT', 'IFRAME-TEXT', 'NOSCRIPT-TEXT', 'TEMPLATE-TEXT', 'WORDVAULT-OWN-UI'];
const AROUND = ['MENU-HOME', 'MENU-SPORT', 'SITE-BANNER', 'ADVERT-BUY-NOW', 'RELATED-ONE', 'FOOTER-COPYRIGHT', 'FOOTER-LINK'];

test('the article is found among the menu, the advertisement, the side column and the footer', () => {
  const text = pageText.articleText(pageText.strip(parse(PAGE)));
  for (let index = 1; index <= 8; index += 1) assert.ok(text.includes(`Paragraph ${index} of the story`), `paragraph ${index}`);
  for (const word of AROUND) assert.ok(!text.includes(word), word);
  // paragraphs stay paragraphs
  assert.match(text, /mattered to the people of the town\.\n\nParagraph 2 of the story/);
});

test('fields, what the user typed, hidden parts and code never become part of the text', () => {
  // (they are in the page: without the clean-up its text has them)
  const raw = pageText.textOf(parse(PAGE).documentElement);
  for (const word of ['SCRIPT-TEXT', 'TEXTAREA-DRAFT', 'OPTION-TEXT', 'HIDDEN-ATTRIBUTE-TEXT', 'ARIA-HIDDEN-TEXT', 'EDITABLE-DRAFT', 'ROLE-TEXTBOX-DRAFT', 'WORDVAULT-OWN-UI']) assert.ok(raw.includes(word), word);
  const stripped = pageText.strip(parse(PAGE));
  for (const text of [pageText.textOf(stripped.documentElement), pageText.articleText(pageText.strip(parse(PAGE))), pageText.plainText(pageText.strip(parse(PAGE)).body)]) {
    assert.ok(text.includes('Paragraph 1 of the story'));
    for (const word of NEVER) assert.ok(!text.includes(word), word);
  }
});

test('what is hidden by the page\'s style sheet is taken out by asking the real page', () => {
  const html = `<html><body><main><p class="shown">SHOWN-TEXT stays.</p><div class="collapsed"><p>COLLAPSED-TEXT goes.</p></div><p>LAST-TEXT stays.</p></main></body></html>`;
  const real = parse(html);
  const copy = parse(html);
  pageText.strip(copy, real, (element) => element.getAttribute('class') === 'collapsed');
  const text = pageText.textOf(copy.body);
  assert.ok(text.includes('SHOWN-TEXT') && text.includes('LAST-TEXT'));
  assert.ok(!text.includes('COLLAPSED-TEXT'));
});

test('a page that is not an article: its main part, without navigation, header and footer', () => {
  const body = `<html><body><nav>MENU-HOME</nav><header>SITE-BANNER</header><div role="navigation">ROLE-NAV</div>
    <div role="main"><h2>Opening hours</h2><ul><li>Monday: nine to five, with a break at noon</li><li>Tuesday: nine to five, with a break at noon</li><li>Wednesday: closed for the weekly market</li></ul>
    <table><tr><td>Adults</td><td>12 euros</td></tr><tr><td>Children</td><td>6 euros</td></tr></table>
    <p>The museum is at the old harbour, ten minutes on foot from the station, and has a small café.</p><p>Dogs are welcome in the garden but not in the rooms with the paintings.</p></div>
    <aside>SIDE-COLUMN</aside><footer>FOOTER-COPYRIGHT</footer></body></html>`;
  const text = pageText.plainText(pageText.strip(parse(body)).body);
  for (const word of ['MENU-HOME', 'SITE-BANNER', 'ROLE-NAV', 'SIDE-COLUMN', 'FOOTER-COPYRIGHT']) assert.ok(!text.includes(word), word);
  assert.match(text, /Opening hours\n\nMonday: nine to five, with a break at noon\nTuesday: nine to five/);
  assert.match(text, /Adults 12 euros\nChildren 6 euros/);
  assert.ok(text.includes('Dogs are welcome'));
});

test('white space of the markup does not end up in the text', () => {
  const doc = parse('<html><body><div>\n   <p>One   two\n three.</p>\n\n\n   <p>Four<br />five.</p>   </div></body></html>');
  assert.equal(pageText.textOf(doc.body), 'One two three.\n\nFour\nfive.');
});

test('the shipped Readability is the unmodified file of the release named in its README', async () => {
  const { createHash } = await import('node:crypto');
  const digest = createHash('sha256').update(readFileSync(new URL('../src/vendor/readability/Readability.js', import.meta.url))).digest('hex');
  assert.ok(read('../src/vendor/readability/README.md').includes(digest));
});
