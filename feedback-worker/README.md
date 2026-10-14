# Wordvault feedback receiver

Takes the message from the extension's "Contact and feedback" tab, checks it, passes it on to Telegram
(or Discord) and forgets it. A Cloudflare Worker, free plan, no dependencies.

```
extension  --POST /feedback-->  Worker  --sendMessage-->  Telegram bot  -->  you
```

The extension only knows the Worker's address. The bot token and the chat ID live only in the Worker's
secrets; they are **not** in the repository, in `wrangler.toml` or in the extension package.

## What it does

- One address: `POST /feedback`, JSON body. Every other path and method is `404`.
- The body is at most 8 KB (`413 too_large`). The fields must match the schema the extension builds
  (`src/validate.js`): allowed type and feature lists, a text of 10-1500 characters, not a single field
  that is not on the list. Control characters are removed. A request that does not match comes back as
  `400` with a code saying why: `bad_json`, `bad_shape`, `bad_type`, `bad_feature`,
  `message_too_short`, `message_too_long`, `bad_email`, `bad_tech`, `bad_errors`.
- If the hidden field (`website`) is filled in, it answers `200 {"ok":true}` but the message is **not**
  passed on (the extension never sends this field; whoever fills it is a bot).
- The message goes to Telegram in HTML mode; everything the user wrote is escaped (`<`, `>`, `&`).
- The time is the receiver's own clock (the client's clock is not trusted), `Europe/Istanbul`,
  formatted `tr-TR` (day.month.year).
- If error records were added they go as a second, shortened message (the newest ones, the first two
  lines of the stack per record).
- There are no CORS headers: the request comes from the extension's background script, not from a web
  page.

Message format:

```
🐞 Bug · Flash card / quiz
🕒 13.10.2026 14:35 (Istanbul)

The card is cut off at the left edge, the choices look empty.

✉️ someone@example.com
🧩 Zen 1.16 (Gecko 143.0) · macOS · Wordvault 0.1.0 · language: tr / en-US
On: doubleClick, quiz
Off: ttsFallback, ocrRememberArea, ocrShowBoxes, sync, syncEncryption
Sync: off
📎 2 error record(s) in the next message
```

> The example format from the specification never reached me, so this format is an assumption; it is a
> single function in `src/format.js` and easy to change.

## What it keeps, what it logs

**It keeps no message and logs nothing.**

- There is not a single `console` call in the code; Cloudflare's log collection is switched off in
  `wrangler.toml` too (`[observability] enabled = false`).
- The IP address is read in one place, for the rate limit, and handed to Cloudflare's limiter as the
  key; the Worker does not keep, pass on or write it. Cloudflare's infrastructure sees the IP on every
  request anyway; the Worker cannot prevent that.
- The request's `Origin` header (in Firefox it carries an installation-specific ID), the referrer and
  the user agent are never read.
- With the daily cap on, the only thing kept is one **number** per day (`count:2026-10-13` → `"37"`),
  deleted by itself after two days. It contains nothing about the message or the sender.
- On an error the answer is only a code; details (which could contain the token or the message) are not
  given out.

This is tested: `test/worker.test.js` also checks that the source has no `console` call, reads no other
header and writes no more than once.

## Rate limit: what I chose and why

There are two layers.

**1. Per sender: the Workers Rate Limiting binding** (`[[ratelimits]]`, 3 requests in 60 seconds).

Of the two options in the specification I chose this one. The other (a salted IP digest in KV, 1 day
TTL) was dropped because:

- It **keeps** a digest of the IP for a day; salted or not, that is a record derived from the sender,
  against the rule "keep nothing permanently". With the binding the counters sit temporarily on
  Cloudflare's machines at that location and are not written to a store the Worker can reach.
- KV's free plan allows 1000 writes a day; every request would be a write, and an attacker could use up
  that allowance within minutes and make the limiter useless.
- KV writes propagate late (one write per second to the same key, delayed reads); requests coming
  quickly one after another would slip through.

The binding's known limits (from Cloudflare's documentation): the counter is **per location** (a request
landing in another data centre counts separately), it is "approximate" rather than exact, and the
period can only be 10 or 60 seconds. Cloudflare does not recommend the IP as the key, because many people
can share one IP (mobile networks); an endpoint without identities has no other key, so the IP is used
anyway. As a result, honest users sending more than 3 messages a minute from the same network get `429`
and the extension says "try again later"; the draft is not lost.

**2. A daily cap for everyone: a single counter in KV** (`DAILY_LIMIT`, 200 by default; optional).

The first layer slows a single attacker down but does not stop an attack from many IPs. The cap limits
the number of messages that reach Telegram even on the worst day; above it the answer is
`429 daily_limit`. Only messages that were **passed on** are counted, so there are at most 200 writes a
day (the free allowance is 1000). The counter is approximate too (KV propagates late); a few messages
may get through above it. If the `DAILY` binding is not defined, no cap applies.

> **Not verified:** I could not find it written clearly in Cloudflare's documentation that the Rate
> Limiting binding is available on the free plan; `wrangler deploy --dry-run` accepts the configuration,
> but I did not try it on a real account. If the binding is refused at deployment, delete the
> `[[ratelimits]]` section in `wrangler.toml`: the code works without the binding too (then only the
> daily cap protects it, so be sure to do step 5).

## Setup

What you need: a Cloudflare account (free), Node.js, Telegram.

### 1. Create the bot

1. Open **@BotFather** in Telegram and type `/newbot`.
2. Give it a name and a user name ending in `bot` (e.g. `wordvault_feedback_bot`).
3. BotFather gives you a **token** (`123456789:AA…`). Do not share it, do not write it into any file.

### 2. Get the chat ID

1. Open your new bot and press **Start** (or write any message). A bot cannot write to you before you
   write to it.
2. Open this in a browser (put your token in):
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. The number in `"chat":{"id":123456789,…}` in the answer is the chat ID.

If you want the messages to go to a group, add the bot to the group, write a message there and take the
group's ID from the same address (it starts with a minus sign).

### 3. Sign in to Cloudflare

```sh
cd feedback-worker
npx wrangler login
```

### 4. Put the secrets in

```sh
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

Each command asks for the value; paste it and press Enter. The values are stored encrypted at
Cloudflare and never enter the repository. (If the Worker does not exist yet, the first command offers
to create it; accept.)

### 5. Switch on the daily cap (recommended)

```sh
npx wrangler kv namespace create DAILY
```

Write the `id` value from the output into the `[[kv_namespaces]]` section of `wrangler.toml` and remove
the `#` at the start of those three lines. This ID is not a secret and may stay in the repository.

### 6. Deploy

```sh
npx wrangler deploy
```

The output shows the address: `https://wordvault-feedback.<your-account>.workers.dev`.

### 7. Try it with `curl`

```sh
curl -i -X POST https://wordvault-feedback.<your-account>.workers.dev/feedback \
  -H 'Content-Type: application/json' \
  -d '{"v":1,"type":"other","feature":"other","message":"a test message from curl"}'
```

It should answer `200` and `{"ok":true}`, and a message should arrive in Telegram. Then:

```sh
# should be 404
curl -i https://wordvault-feedback.<your-account>.workers.dev/feedback
# should be 400 message_too_short
curl -i -X POST https://wordvault-feedback.<your-account>.workers.dev/feedback -d '{"v":1,"type":"bug","feature":"quiz","message":"short"}'
```

If it answers `502 delivery_failed`, the token or the chat ID is wrong, or you never wrote to the bot.

### 8. Put the address into the extension

In `src/config.js`:

```js
export const FEEDBACK_ENDPOINT = 'https://wordvault-feedback.<your-account>.workers.dev/feedback';
```

Run `node build.js` and reload the extension. On the first send the browser asks for permission for
this domain only.

## Trying it without deploying

```sh
node feedback-worker/dev-server.js
```

Runs the receiver on this computer at `http://localhost:8787/feedback`. Nothing goes to Telegram; the
message that would go is printed in the terminal. If you put this address into `FEEDBACK_ENDPOINT` and
build, you can try the form end to end (change it back to the real address before publishing).

## Sending to Discord

Set `FEEDBACK_CHANNEL = "discord"` in `wrangler.toml`, store the channel's webhook address as a secret and
deploy again:

```sh
npx wrangler secret put DISCORD_WEBHOOK_URL
npx wrangler deploy
```

Nobody can be mentioned in the messages (`allowed_mentions` is empty), and link previews are off.

## If spam comes

In order, from light to heavy:

1. **Mute it.** Muting the bot's chat in Telegram takes effect at once.
2. **Lower the cap.** Set `DAILY_LIMIT = "20"` in `wrangler.toml`, then `npx wrangler deploy`.
3. **Close the endpoint.** Deleting the secret silences the receiver; requests get `502` and nothing
   reaches you:
   ```sh
   npx wrangler secret delete TELEGRAM_BOT_TOKEN
   ```
   To remove it completely: `npx wrangler delete`.
4. **Change the secret.** If you suspect the token leaked (it cannot leak from the Worker, but you may
   have written it somewhere else), get a new one with `/revoke` in BotFather and put it in with
   `npx wrangler secret put TELEGRAM_BOT_TOKEN`. The old token stops working at once.
5. **Change the address.** Change `name` in `wrangler.toml` and deploy, delete the old one with
   `npx wrangler delete --name wordvault-feedback`, update `FEEDBACK_ENDPOINT` and publish a new version
   of the extension. Users of the old version see "could not be sent"; their drafts are not lost.

Note: the address is public in the extension package; it cannot be kept secret. The protection is not
the address being secret but the limits above.

## Tests

```sh
npm test            # at the repository's root: extension + Worker tests
cd feedback-worker && npm test   # the Worker only
```

Schema validation, escaping, the size limit, the hidden field, the message format, the rate limit, the
daily cap, a Telegram error, Discord and the "nothing is logged" checks (`test/worker.test.js`).
