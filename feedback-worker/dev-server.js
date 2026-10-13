#!/usr/bin/env node

// Runs the receiver on this computer, for trying the extension's feedback form without
// deploying anything. Nothing is sent to Telegram: what would be sent is printed here.
//
//   node feedback-worker/dev-server.js [port]        (default 8787)
//
// Then set FEEDBACK_ENDPOINT in src/config.js to http://localhost:8787/feedback and build.

import http from 'node:http';

import { handle } from './src/index.js';

const port = Number(process.argv[2]) || 8787;
const env = { FEEDBACK_CHANNEL: 'telegram', TELEGRAM_BOT_TOKEN: 'local', TELEGRAM_CHAT_ID: 'local' };
const fetchImpl = async (url, init) => {
  console.log(`\n--- would be sent to Telegram ---\n${JSON.parse(init.body).text}\n---`);
  return new Response('{"ok":true}', { status: 200 });
};

http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const response = await handle(request, env, { fetchImpl }).catch(() => new Response('{"error":"internal"}', { status: 500 }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
    console.log(`${req.method} ${req.url} -> ${response.status}`);
  })
  .listen(port, '127.0.0.1', () => console.log(`feedback receiver (local, nothing leaves this computer): http://localhost:${port}/feedback`));
