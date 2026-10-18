// The published privacy page (docs/privacy.html) is generated from PRIVACY.md and must match it;
// and the policy names no provider or feature that is gone.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { SOURCE, TARGET, page, toHtml } from '../tools/privacy-page.js';

test('docs/privacy.html is up to date with PRIVACY.md (npm run privacy)', () => {
  assert.equal(readFileSync(TARGET, 'utf8'), page(readFileSync(SOURCE, 'utf8')));
});

test('the converter escapes text and keeps only https links', () => {
  assert.equal(toHtml('a <b> & [x](https://e.example/p) [y](javascript:alert(1)) **z** `c`'), '<p>a &lt;b&gt; &amp; <a href="https://e.example/p">x</a> [y](javascript:alert(1)) <strong>z</strong> <code>c</code></p>');
  assert.match(toHtml('| A | B |\n| --- | --- |\n| 1 | 2 |'), /<th>A<\/th><th>B<\/th>[\s\S]*<td>1<\/td><td>2<\/td>/);
  assert.match(toHtml('- one\n  more\n- two'), /<li>one more<\/li>\n  <li>two<\/li>/);
});

test('the policy mentions no removed provider or feature', () => {
  const text = readFileSync(SOURCE, 'utf8');
  for (const gone of ['OneDrive', 'Dropbox', 'Microsoft API']) assert.ok(!text.includes(gone), gone);
});
