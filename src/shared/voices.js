'use strict';

// Choosing a voice for a language: the one place that ranks the voices a browser offers.
// Loaded before shared/speech.js in content scripts and pages; pure, so tests run it as it is.
//
// What a browser reports differs by platform (readium.org/speech/docs/WebSpeech.html):
//   macOS     novelty "effects" voices and the old Eloquence/formant voices sit next to good
//             ones; names are translated on non-English systems, so only some are known by name.
//   Windows   Chrome and Firefox list the standard Microsoft voices (local); Edge adds "Online
//             (Natural)" voices, which are remote.
//   Chrome    adds "Google ..." voices, which are remote.
//   Linux     Firefox lists speech-dispatcher's voices (eSpeak NG and its variants, "English
//             (America)+klatt" ...) with localService false although they are made on this
//             computer (measured with Firefox 131 and speech-dispatcher + espeak-ng); their
//             voiceURI says so ("urn:moz-tts:speechd:...").
// Remote voices send the text to their vendor: they are only used when the user allows it.
//
// The rule:
//   1. Novelty voices are never chosen.
//   2. Remote voices only when allowed.
//   3. Robotic voices (eSpeak, Eloquence, the formant synthesisers) come after every other voice,
//      whatever the region: a natural voice of any region is more intelligible. eSpeak variants
//      made to sound odd on purpose (klatt, robot ...) come after those.
//   4. Then the region: the one asked for, one the user reads the language in, the language's
//      usual one, any other.
//   5. Then the quality: local enhanced/premium/natural, remote natural, local standard, other remote.
//   6. `default` and the name only break ties (`default` is unreliable: Safari marks every voice).

globalThis.WV = globalThis.WV || {};

(function (WV) {
  if (WV.voices) return;

  /** Speaking rates: what is used unless the user changed it, the "slow" replay, and the range offered. */
  const RATE = Object.freeze({ DEFAULT: 0.9, SLOW: 0.7, MIN: 0.5, MAX: 1.2, STEP: 0.05 });

  const NOVELTY_VOICES = new Set([
    'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'deranged', 'good news',
    'hysterical', 'jester', 'organ', 'pipe organ', 'superstar', 'trinoids', 'whisper', 'wobble', 'zarvox',
  ]);
  /** macOS formant voices and the Eloquence set: intelligible, but robotic. */
  const ROBOTIC_VOICES = new Set([
    'eddy', 'flo', 'fred', 'grandma', 'grandpa', 'junior', 'kathy', 'princess', 'ralph', 'reed', 'rocko', 'sandy', 'shelley',
  ]);
  /** Natural macOS/iOS English voices, known by their (untranslated) personal names. */
  const NATURAL_ENGLISH_VOICES = new Set([
    'samantha', 'alex', 'allison', 'ava', 'susan', 'tom', 'evan', 'joelle', 'nathan', 'noelle', 'zoe', 'aaron', 'nicky',
    'daniel', 'kate', 'oliver', 'serena', 'stephanie', 'jamie', 'karen', 'lee', 'matilda', 'moira', 'fiona', 'rishi',
    'veena', 'isha', 'sangeeta', 'tessa',
  ]);
  /** eSpeak NG variants made to sound odd on purpose. */
  const ESPEAK_ODD = /klatt|robo|demonic|croak|whisper|half-?life|tweaky|anxious|serious|zombie|storm|\bfast\b/i;
  /** Languages whose voices are filed under another code than translation services use. */
  const VOICE_CODES = { no: ['no', 'nb', 'nn'], he: ['he', 'iw'], tl: ['tl', 'fil'], id: ['id', 'in'] };

  /** Quality classes, best first (the number orders them). */
  const QUALITY = Object.freeze({ ENHANCED: 5, ONLINE_NATURAL: 4, STANDARD: 3, ONLINE: 2, ROBOTIC: 1, NOVELTY: 0 });

  const tagOf = (voice) => String(voice.lang || '').replace(/_/g, '-').toLowerCase();
  /** "Eddy (English (US))" -> "eddy"; "English (America)+Andy" -> "english" */
  const baseName = (voice) => String(voice.name || '').replace(/\s*[(+].*$/, '').trim().toLowerCase();

  /** Whether the voice is made on this device. Firefox's speech-dispatcher voices are, whatever localService says. */
  function isLocal(voice) {
    if (voice.localService === true) return true;
    return /^urn:moz-tts:(speechd|osx|sapi|android):/i.test(String(voice.voiceURI || ''));
  }

  /** @returns {{ local: boolean, quality: number, kind: string }} */
  function classify(voice) {
    const local = isLocal(voice);
    const name = baseName(voice);
    const hints = `${voice.voiceURI || ''} ${voice.name || ''}`.toLowerCase();
    if (NOVELTY_VOICES.has(name)) return { local, quality: QUALITY.NOVELTY, kind: 'novelty' };
    if (!local) return /\bnatural\b|neural/.test(hints) ? { local, quality: QUALITY.ONLINE_NATURAL, kind: 'online-natural' } : { local, quality: QUALITY.ONLINE, kind: 'online' };
    if (ROBOTIC_VOICES.has(name) || hints.includes('eloquence')) return { local, quality: QUALITY.ROBOTIC, kind: 'robotic' };
    if (hints.includes('speechd') || hints.includes('espeak')) {
      // speech-dispatcher with eSpeak NG: robotic in any case; the plain voice is the clearest of them.
      const variant = String(voice.name || '').includes('+');
      return { local, quality: QUALITY.ROBOTIC + (variant ? (ESPEAK_ODD.test(voice.name) ? -0.5 : 0) : 0.4), kind: 'robotic' };
    }
    if (/premium|enhanced|\(natural\)|\bnatural\b|neural/.test(hints)) return { local, quality: QUALITY.ENHANCED, kind: 'enhanced' };
    if (tagOf(voice).startsWith('en') && NATURAL_ENGLISH_VOICES.has(name)) return { local, quality: QUALITY.STANDARD + 0.5, kind: 'standard' };
    return { local, quality: QUALITY.STANDARD, kind: 'standard' };
  }

  /**
   * How well a voice's region suits: 3 the one asked for, 2 one the user reads the language in,
   * 1 the language's usual one (de-DE, en-US then en-GB), 0 any other.
   */
  function regionFit(tag, wanted, regions) {
    const [primary, region = '', ...variant] = tag.split('-');
    if (wanted.includes('-') && tag === wanted) return 3;
    // A dialect of the region ("en-US-NYC", speech-dispatcher's "America, New York City") after its standard voice.
    const dialect = variant.length > 0 ? 0.25 : 0;
    if (region && regions.includes(region)) return 2 - dialect;
    if (region === primary || (primary === 'en' && region === 'us')) return 1 - dialect;
    if (primary === 'en' && region === 'gb') return 0.5 - dialect;
    return 0;
  }

  /**
   * The voices for a language, best first.
   * @param {SpeechSynthesisVoice[]} voices
   * @param {string} lang  Language of the word ("en", "pt-BR").
   * @param {{ regions?: string[], allowOnline?: boolean }} [options]
   *        regions: the regions the user reads this language in (from navigator.languages).
   * @returns {{ voice: SpeechSynthesisVoice, local: boolean, quality: number, kind: string }[]}
   */
  function rankVoices(voices, lang, { regions = [], allowOnline = false } = {}) {
    const wanted = String(lang || '').replace(/_/g, '-').toLowerCase();
    const primary = wanted.split('-')[0];
    if (!primary) return [];
    const codes = VOICE_CODES[primary] || [primary];
    const ranked = [];
    for (const voice of voices || []) {
      if (!voice || !voice.lang || !voice.name) continue; // incomplete entries (seen in Edge)
      const tag = tagOf(voice);
      if (!codes.includes(tag.split('-')[0])) continue;
      const kind = classify(voice);
      if (kind.quality === QUALITY.NOVELTY || (!kind.local && !allowOnline)) continue;
      ranked.push({ voice, ...kind, fit: regionFit(tag, wanted, regions) });
    }
    return ranked
      .sort(
        (a, b) =>
          tierOf(b.quality) - tierOf(a.quality) ||
          b.fit - a.fit ||
          b.quality - a.quality ||
          Number(Boolean(b.voice.default)) - Number(Boolean(a.voice.default)) ||
          String(a.voice.name).localeCompare(String(b.voice.name)),
      )
      .map(({ fit, ...rest }) => rest);
  }

  /** 2 natural voices of any kind, 1 robotic ones, 0 eSpeak variants made to sound odd: a lower tier never comes first. */
  const tierOf = (quality) => (quality >= QUALITY.ONLINE ? 2 : quality >= QUALITY.ROBOTIC ? 1 : 0);

  /** How a voice is remembered: its URI where there is one, else its name. */
  const voiceId = (voice) => voice.voiceURI || voice.name;

  /**
   * The voice to use: the one the user chose for this language if it is still there (and allowed),
   * else the best one.
   * @param {{ regions?: string[], allowOnline?: boolean, chosen?: string }} [options]  chosen: voiceId() of the user's pick.
   * @returns {{ voice: SpeechSynthesisVoice, local: boolean, quality: number, kind: string, rank: number, of: number } | null}
   */
  function pick(voices, lang, options = {}) {
    const ranked = rankVoices(voices, lang, options);
    if (ranked.length === 0) return null;
    const index = options.chosen ? ranked.findIndex((entry) => voiceId(entry.voice) === options.chosen) : -1;
    const at = index >= 0 ? index : 0;
    return { ...ranked[at], rank: at + 1, of: ranked.length };
  }

  /** Regions the user reads a language in, from the browser's language list ("en-GB" -> "gb"). */
  function userRegions(primary, languages = globalThis.navigator?.languages || []) {
    return languages
      .map((entry) => String(entry).toLowerCase().split('-'))
      .filter(([language, region]) => language === primary && region)
      .map(([, region]) => region);
  }

  /** A rate within the range offered. */
  const clampRate = (value) => (Number.isFinite(Number(value)) ? Math.min(RATE.MAX, Math.max(RATE.MIN, Number(value))) : RATE.DEFAULT);

  WV.voices = { RATE, QUALITY, classify, rankVoices, pick, voiceId, userRegions, clampRate, isLocal };
})(globalThis.WV);
