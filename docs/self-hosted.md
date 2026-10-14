# Syncing with your own server

Instead of a cloud account, Wordvault can also sync the vault with a server you run (or trust):
Settings → **Sync and backup** → **My own server**. Two kinds are supported:

- **WebDAV** (Nextcloud, ownCloud, Apache `mod_dav` …): if you already have such a server.
- **Simple HTTP endpoint**: any server that answers the three requests described below. The repository
  has a one-file example (`tools/self-hosted-server.js`).

With both kinds:

- What goes is a single file: the compressed vault (the `wordvault-vault.json.gz` format; "The sync
  data model" in the README). Page addresses, settings and API keys do not go.
- The address must be **https**. `http://` is accepted only for your own machine (`localhost`,
  `127.0.0.1`).
- The browser asks for permission for the address you enter **when connecting**; the extension asks
  for no other address.
- The user name, password and key stay only in this browser (`chrome.storage.local`).
- If you like, the encryption option in the settings sends the file to the server encrypted.

## WebDAV

To enter: the **folder address**, the **user name**, an **app password**.

For Nextcloud the folder address looks like `https://SERVER/remote.php/dav/files/USER/Wordvault/`.
Create the app password in Nextcloud under **Settings → Security → Devices & sessions**; do not enter
your real password. If the folder does not exist, Wordvault creates it; the file lives in that folder as
`wordvault-vault.json.gz`.

The requests Wordvault makes:

| Request | What for |
| --- | --- |
| `PROPFIND <folder>` (`Depth: 0`) | When connecting: does the folder exist, is the password right |
| `MKCOL <folder>` | To create the folder if it does not exist |
| `GET <folder>/wordvault-vault.json.gz` | To read the file and its `ETag` |
| `PUT <folder>/wordvault-vault.json.gz` | To write: with `If-Match: <etag>`, or with `If-None-Match: *` while there is no file yet |
| `DELETE <folder>/wordvault-vault.json.gz` | If "Delete the file in the cloud too" is chosen |

Authentication is HTTP Basic. If the server does not give the new `ETag` in its answer to `PUT`,
Wordvault asks with a `HEAD`. On a server that gives no `ETag` at all, conditional writes are not
possible: the last writer wins, and the overwritten change is merged again at that device's next sync
(no word is lost).

## Simple HTTP endpoint

To enter: the **server address** and a **key**. Wordvault adds `/vault` to the end of the address.

Every request carries the `Authorization: Bearer <key>` header.

### `GET /vault`

- `200`: the body is the stored document (binary), the `ETag` header is the document's version.
- `404`: no document stored yet.
- `401`: the key is missing or wrong.

### `PUT /vault`

The body is the new document (binary, `Content-Type: application/octet-stream`). The request carries one
of these two conditions:

- `If-Match: <etag>`: write only if the stored document is still at that version.
- `If-None-Match: *`: write only if no document is stored.

Answers:

- `200` or `201`: written; the `ETag` header is the new version.
- `412`: the condition does not hold (another device got in between). Wordvault reads again, merges and
  writes again; it tries at most five times.
- `413` or `507`: no space. Wordvault tells the user; the vault stays local.
- `401`: the key is missing or wrong.

Checking the condition and writing must happen **in one step**; otherwise two devices writing at the
same moment can both succeed.

### `DELETE /vault`

Deletes the stored document (`204`; `404` is accepted too if there is none).

### Other

- The `ETag` can be any value that changes with the document's content (a digest of the content in the
  example server). Wordvault sends it back as it is.
- `429` and `5xx` answers count as "try later"; Wordvault quietly tries again after 1, 2, 4 … minutes.
- No CORS headers are needed, because the extension gets the browser's permission for that address when
  connecting.

## Example server

`tools/self-hosted-server.js` is a one-file Node program that implements this protocol; it has no
dependencies (Node 22 or later).

```sh
WORDVAULT_KEY=$(openssl rand -hex 24) node tools/self-hosted-server.js
```

Choose the key yourself and note it down; you will enter it in Wordvault's **Key** field.

| Environment variable | Meaning | Default |
| --- | --- | --- |
| `WORDVAULT_KEY` | The key the extension has to send (required, at least 16 characters) | |
| `PORT` | The port to listen on | `8787` |
| `HOST` | The address to listen on | `127.0.0.1` (this machine only) |
| `WORDVAULT_DATA` | The folder the document is kept in | `./wordvault-data` |

To try it on the same machine: in Wordvault **My own server → Simple HTTP endpoint**, address
`http://localhost:8787`, the key above.

To test it by hand:

```sh
curl -i -H "Authorization: Bearer $WORDVAULT_KEY" http://localhost:8787/vault            # 404: nothing yet
printf 'test' | curl -i -X PUT --data-binary @- -H "Authorization: Bearer $WORDVAULT_KEY" -H 'If-None-Match: *' http://localhost:8787/vault     # 201 + ETag
printf 'second' | curl -i -X PUT --data-binary @- -H "Authorization: Bearer $WORDVAULT_KEY" -H 'If-None-Match: *' http://localhost:8787/vault   # 412
```

**To reach it from other devices**, do not expose the server to the internet directly: it speaks plain
HTTP. Put something that terminates TLS in front of it (Caddy, nginx, a tunnel) and give Wordvault that
`https://` address. For example with Caddy:

```
vault.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

The server keeps a single document; if several people will use it, run a separate copy for each, with
its own key and its own data folder.
