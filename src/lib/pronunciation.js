// Recorded pronunciations: audio files on Wikimedia Commons, found through the word's page on
// English Wiktionary (which lists recordings for words of every language).
//
// Used where the browser's own speech synthesis cannot be: see shared/speech.js.

import { fetchJson } from './http.js';
import { primarySubtag } from './languages.js';

const API = 'https://en.wiktionary.org/w/api.php';
const MEDIA_HOST = 'upload.wikimedia.org';
const AUDIO_FILE = /\.(ogg|oga|opus|wav|mp3|flac)$/i;
/** Recordings of single words are a few dozen kilobytes; anything much larger is not one. */
const MAX_BYTES = 1024 * 1024;
const MAX_TERM_CHARS = 60;
const FETCH_TIMEOUT_MS = 10_000;

// Two naming schemes are in use on Commons:
//   "En-us-book.ogg", "De-Schmetterling.ogg"            language code, optional region, word
//   "LL-Q1860 (eng)-Back ache-gift.wav" (Lingua Libre)  ISO 639-3 code, speaker, word
// The second needs the three-letter codes of the languages the extension knows by two letters.
const ISO_639_3 = Object.fromEntries(
  (
    'af:afr sq:sqi am:amh ar:ara,arb hy:hye az:aze,azj eu:eus be:bel bn:ben bs:bos bg:bul ca:cat zh:cmn,zho co:cos ' +
    'hr:hrv cs:ces da:dan nl:nld en:eng eo:epo et:est,ekk fi:fin fr:fra fy:fry gl:glg ka:kat de:deu el:ell gu:guj ' +
    'ht:hat ha:hau haw:haw he:heb hi:hin hmn:hmn hu:hun is:isl ig:ibo id:ind ga:gle it:ita ja:jpn kn:kan kk:kaz ' +
    'km:khm rw:kin ko:kor ku:kur,kmr ky:kir lo:lao la:lat lv:lav,lvs lt:lit lb:ltz mk:mkd mg:mlg ms:msa,zsm ml:mal ' +
    'mt:mlt mi:mri mr:mar mn:mon,khk my:mya ne:nep,npi no:nor,nob,nno ny:nya or:ori,ory ps:pus,pbt fa:fas,pes pl:pol ' +
    'pt:por ro:ron ru:rus sm:smo gd:gla sr:srp st:sot sn:sna sd:snd si:sin sk:slk sl:slv so:som es:spa su:sun ' +
    'sw:swa,swh sv:swe tl:tgl tg:tgk ta:tam tt:tat te:tel th:tha tr:tur tk:tuk uk:ukr ur:urd ug:uig uz:uzb,uzn ' +
    'vi:vie cy:cym xh:xho yi:yid,ydd yo:yor zu:zul'
  )
    .split(' ')
    .map((pair) => pair.split(':'))
    .map(([code, long]) => [code, long.split(',')]),
);
/** Region whose recording is preferred when a language has several ("en-us" before "en-uk"). */
const PREFERRED_REGION = { en: 'us' };

const fold = (value) => value.replace(/[_\s]+/g, ' ').trim().toLowerCase();

/**
 * Chooses the recording of `text` in language `lang` among the files of a Wiktionary page.
 * A page lists recordings for every language that has the word ("gift": English, Swedish,
 * Dutch ...), so the language has to match, and so does the word the file name ends with.
 *
 * @param {{ title: string, url: string, mime: string, size: number }[]} files
 * @returns {{ title: string, url: string, mime: string, size: number } | null}
 */
export function pickRecording(files, text, lang) {
  const word = fold(text);
  const code = primarySubtag(lang);
  if (!word || !code) return null;
  const longCodes = ISO_639_3[code] || [];
  const region = (lang.split('-')[1] || PREFERRED_REGION[code] || '').toLowerCase();

  let best = null;
  let bestRank = 0;
  for (const file of files) {
    if (!AUDIO_FILE.test(file.title) || !(file.size > 0) || file.size > MAX_BYTES) continue;
    const name = fold(file.title.replace(/^File:/i, '').replace(/\.[a-z0-9]+$/i, ''));
    if (!name.endsWith(`-${word}`)) continue;
    const prefix = name.slice(0, -(word.length + 1));

    let rank = 0;
    const linguaLibre = /^ll-q\d+ \(([a-z]{3})\)-.+$/.exec(prefix);
    const plain = /^([a-z]{2,3})(?:-([a-z0-9]{2,8}))?$/.exec(prefix);
    if (linguaLibre) {
      if (longCodes.includes(linguaLibre[1])) rank = 10;
    } else if (plain && (plain[1] === code || longCodes.includes(plain[1]))) {
      rank = 20 + (plain[2] === region ? 5 : plain[2] ? 0 : 2);
    }
    if (rank > bestRank) {
      best = file;
      bestRank = rank;
    }
  }
  return best;
}

async function listFiles(term) {
  const url = new URL(API);
  const params = {
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    redirects: '1',
    generator: 'images',
    titles: term,
    gimlimit: '500',
    prop: 'imageinfo',
    iiprop: 'url|mime|size',
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const { status, data } = await fetchJson(url, {
    headers: { 'Api-User-Agent': `Wordvault/${chrome.runtime.getManifest().version} (browser extension)` },
  });
  if (status !== 200 || !Array.isArray(data?.query?.pages)) return [];
  return data.query.pages
    .map((page) => ({ title: String(page.title || ''), ...(page.imageinfo?.[0] || {}) }))
    .filter((file) => typeof file.url === 'string');
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/**
 * Finds and downloads a recording of a word.
 * @returns {Promise<{ audio: string, mime: string, title: string, page: string } | null>}
 *   `audio` is base64 (messages between extension contexts cannot carry binary data in Chrome);
 *   `page` is the file's description page on Commons, which names its author and licence.
 *   null when there is no recording, or it could not be fetched.
 */
export async function fetchRecording(text, lang) {
  const term = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (!term || term.length > MAX_TERM_CHARS || !lang) return null;
  try {
    // Page titles are case-sensitive: "Book" at the start of a sentence lives at "book".
    let file = pickRecording(await listFiles(term), term, lang);
    if (!file && term !== term.toLowerCase()) file = pickRecording(await listFiles(term.toLowerCase()), term, lang);
    if (!file) return null;

    const url = new URL(file.url);
    if (url.protocol !== 'https:' || url.hostname !== MEDIA_HOST) return null;
    const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;
    return {
      audio: toBase64(bytes),
      mime: String(file.mime || ''),
      title: file.title.replace(/^File:/i, ''),
      page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(file.title.replace(/ /g, '_'))}`,
    };
  } catch {
    return null; // offline, timeout: there is simply no recording to play right now
  }
}
