// The support link: one constant, hidden while it is empty or a placeholder, and never
// anything but an https address.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

import { SUPPORT_URL, supportUrl } from '../src/config.js';

test('out of the box there is no support page, so the support UI is hidden', () => {
  assert.match(SUPPORT_URL, /YOUR_/);
  assert.equal(supportUrl(), '');
});

test('an https address is used as it is; anything else is no address', () => {
  assert.equal(supportUrl('https://buymeacoffee.com/someone'), 'https://buymeacoffee.com/someone');
  assert.equal(supportUrl('  https://ko-fi.com/someone  '), 'https://ko-fi.com/someone', 'another service is one line');
  for (const value of ['', '   ', null, undefined, 'https://buymeacoffee.com/YOUR_PAGE', 'http://buymeacoffee.com/someone', 'javascript:alert(1)', 'buymeacoffee.com/someone', 'data:text/html,x']) {
    assert.equal(supportUrl(value), '', String(value));
  }
});

test('nothing of the support UI is loaded from the network', () => {
  const dir = new URL('../src/support/', import.meta.url);
  const files = readdirSync(dir).map((name) => readFileSync(new URL(name, dir), 'utf8')).join('\n');
  const welcome = readFileSync(new URL('../src/welcome/welcome.html', import.meta.url), 'utf8');
  for (const source of [files, welcome]) {
    assert.ok(!/<script[^>]+src=["']https?:/i.test(source), 'no remote script');
    assert.ok(!/@import|url\(\s*["']?https?:/i.test(source), 'no remote stylesheet, font or image');
    assert.ok(!/\bfetch\(|XMLHttpRequest|<iframe|<img[^>]+src=["']https?:/i.test(source), 'no request, frame or remote image');
  }
  assert.match(files, /target: '_blank', rel: 'noopener noreferrer'/);
});
