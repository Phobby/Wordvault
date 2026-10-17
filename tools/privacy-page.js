#!/usr/bin/env node

// docs/privacy.html from PRIVACY.md, so that the published page and the file in the repository
// never say different things. `npm run privacy` writes it; tests/privacy-page.test.js fails while
// the page is not up to date.
//
// Only the Markdown that PRIVACY.md uses: headings, paragraphs, "- " lists (with indented
// continuation lines), tables, **bold**, `code` and [links](https://…). Text is escaped first.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
export const SOURCE = path.join(ROOT, 'PRIVACY.md');
export const TARGET = path.join(ROOT, 'docs', 'privacy.html');

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text) {
  return escape(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

const cells = (line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim());

/** @param {string} markdown @returns {string} the body's HTML */
export function toHtml(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  let list = null;
  const flush = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
    if (list) out.push(`<ul>\n${list.map((item) => `  <li>${inline(item)}</li>`).join('\n')}\n</ul>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) {
      flush();
      out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
    } else if (/^\s*\|/.test(line)) {
      flush();
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      i -= 1;
      const [head, , ...body] = rows;
      out.push(`<table>\n  <tr>${cells(head).map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr>\n${body.map((row) => `  <tr>${cells(row).map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('\n')}\n</table>`);
    } else if (/^\s*- /.test(line)) {
      if (paragraph.length) flush();
      const nested = /^\s{2,}- /.test(line);
      list ||= [];
      // A nested item is kept inside the one before it, as a line of its own.
      if (nested && list.length) list[list.length - 1] += `\n— ${line.replace(/^\s*- /, '')}`;
      else list.push(line.replace(/^\s*- /, ''));
    } else if (line.trim() === '') {
      flush();
    } else if (list && /^\s+\S/.test(line)) {
      list[list.length - 1] += ` ${line.trim()}`;
    } else {
      if (list) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return out.join('\n').replace(/\n— /g, '<br>— ');
}

export function page(markdown) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Wordvault Privacy Policy</title>
<!-- Generated from PRIVACY.md by tools/privacy-page.js: edit PRIVACY.md, then run npm run privacy. -->
<style>
  :root { color-scheme: light dark; --fg: #1c1c22; --muted: #5d5d6b; --bg: #ffffff; --line: #e3e3ea; --accent: #4f46e5; }
  @media (prefers-color-scheme: dark) { :root { --fg: #ececf1; --muted: #a2a2b0; --bg: #17171c; --line: #2e2e38; --accent: #a5a0ff; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { margin: 0 0 8px; font-size: 28px; }
  h2 { margin: 36px 0 8px; font-size: 21px; }
  h3 { margin: 24px 0 6px; font-size: 17px; }
  p, ul { margin: 0 0 12px; }
  li { margin-bottom: 4px; }
  a { color: var(--accent); }
  table { width: 100%; border-collapse: collapse; margin: 0 0 12px; font-size: 15px; }
  th, td { padding: 6px 8px; border: 1px solid var(--line); text-align: left; vertical-align: top; }
  code { font: 14px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
</style>
</head>
<body>
<main>
${toHtml(markdown)}
</main>
</body>
</html>
`;
}

if (process.argv[1] === import.meta.filename) {
  fs.writeFileSync(TARGET, page(fs.readFileSync(SOURCE, 'utf8')));
  console.log(`wrote ${path.relative(ROOT, TARGET)}`);
}
