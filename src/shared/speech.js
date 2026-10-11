'use strict';

// Pronunciation with the browser's built-in speech synthesis (window.speechSynthesis). No audio
// is downloaded and only on-device voices are used, so the word never leaves the browser.

(function (WV) {
  if (WV.speech) return;

  /**
   * Below full volume on purpose. System voices are loud at 1.0, and whatever the platform does
   * when a clip ends (some engines close the audio stream abruptly) is as loud as the speech.
   */
  const VOLUME = 0.8;
  /** How often to check whether the engine has finished what it was reading. */
  const POLL_MS = 60;
  /**
   * A request waits this long for the engine to become free. A single word takes a second or
   * two; if the engine is still busy after this it is reading something long or is stuck.
   */
  const MAX_WAIT_MS = 8000;

  // --- Choosing a voice ------------------------------------------------------------------------
  //
  // macOS reports its novelty voices as ordinary en-US voices and Chrome lists them first: the
  // first English voice it returns is "Albert", followed by "Bahh", "Bells", "Boing" ... Taking
  // the first voice that matches a language therefore picks a joke voice. Their names are also
  // translated on non-English systems ("Good News" is "İyi Haber" in Turkish), so they cannot
  // all be recognised by name. Hence both lists: known novelty voices are avoided, and known
  // natural voices (personal names, which are not translated) are preferred over unknown ones.
  const NOVELTY_VOICES = new Set([
    'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'deranged', 'good news',
    'hysterical', 'jester', 'organ', 'pipe organ', 'superstar', 'trinoids', 'whisper', 'wobble', 'zarvox',
  ]);
  // Old formant synthesisers: intelligible, but a natural voice of any region is better.
  const ROBOTIC_VOICES = new Set([
    'eddy', 'flo', 'fred', 'grandma', 'grandpa', 'junior', 'kathy', 'princess', 'ralph', 'reed', 'rocko', 'sandy', 'shelley',
  ]);
  const NATURAL_ENGLISH_VOICES = new Set([
    'samantha', 'alex', 'allison', 'ava', 'susan', 'tom', 'evan', 'joelle', 'nathan', 'noelle', 'zoe', 'aaron', 'nicky',
    'daniel', 'kate', 'oliver', 'serena', 'stephanie', 'jamie', 'karen', 'lee', 'matilda', 'moira', 'fiona', 'rishi',
    'veena', 'isha', 'sangeeta', 'tessa',
  ]);
  // Languages whose voices are filed under a different code than translation services use.
  const VOICE_CODES = { no: ['no', 'nb', 'nn'], he: ['he', 'iw'], tl: ['tl', 'fil'], id: ['id', 'in'] };

  const engine = () => window.speechSynthesis || null;
  const tagOf = (voice) => voice.lang.replace(/_/g, '-').toLowerCase();
  /** "Eddy (English (US))" -> "eddy" */
  const baseName = (voice) => voice.name.replace(/\s*\(.*$/, '').trim().toLowerCase();

  /** Regions the user reads this language in, from the browser's language list ("en-GB" -> "gb"). */
  function userRegions(primary) {
    return (navigator.languages || [])
      .map((entry) => entry.toLowerCase().split('-'))
      .filter(([language, region]) => language === primary && region)
      .map(([, region]) => region);
  }

  function score(voice, wanted, regions) {
    const tag = tagOf(voice);
    const [primary, region = ''] = tag.split('-');
    const name = baseName(voice);
    const hints = `${voice.voiceURI} ${voice.name}`.toLowerCase();
    let points = 0;
    if (tag === wanted) points += 100; // "pt-BR" asked for, "pt-BR" offered
    if (voice.default) points += 8;
    if (regions.includes(region)) points += 6;
    // The conventional variety: de-DE, fr-FR, tr-TR ...; for English, US and then GB.
    if (region === primary || (primary === 'en' && region === 'us')) points += 4;
    else if (primary === 'en' && region === 'gb') points += 2;
    if (hints.includes('premium')) points += 5;
    else if (hints.includes('enhanced')) points += 4;
    if (NOVELTY_VOICES.has(name)) points -= 1000;
    else if (ROBOTIC_VOICES.has(name) || hints.includes('eloquence')) points -= 50;
    else if (primary === 'en' && NATURAL_ENGLISH_VOICES.has(name)) points += 20;
    return points;
  }

  /**
   * Best on-device voice for a language.
   * @param {string} lang Language code such as "en" or "pt-BR".
   * @returns {{ listed: boolean, voice: SpeechSynthesisVoice | null }} `listed` is false while
   *   the browser has not loaded its voice list yet.
   */
  function pickVoice(lang) {
    const synth = engine();
    const voices = synth ? synth.getVoices() : [];
    const wanted = lang.replace(/_/g, '-').toLowerCase();
    const primary = wanted.split('-')[0];
    const codes = VOICE_CODES[primary] || [primary];
    const regions = userRegions(primary);
    let best = null;
    let bestScore = -Infinity;
    for (const voice of voices) {
      // Remote voices would send the text to the voice's vendor.
      if (voice.localService === false || !codes.includes(tagOf(voice).split('-')[0])) continue;
      const points = score(voice, wanted, regions);
      if (points > bestScore) {
        best = voice;
        bestScore = points;
      }
    }
    return { listed: voices.length > 0, voice: best };
  }

  /** Whether a pronunciation button makes sense for this language. */
  function canSpeak(lang) {
    if (!engine() || !lang) return false;
    const { listed, voice } = pickVoice(lang);
    return !listed || Boolean(voice); // an empty list means "not loaded yet"
  }

  // --- Speaking --------------------------------------------------------------------------------
  //
  // The engine is only ever handed one utterance, and only while it is silent, so readings can
  // neither overlap nor pile up in its queue. cancel() is deliberately not part of the normal
  // flow, neither before speaking nor when a reading ends: interrupting playback cuts the audio
  // off mid-word, and in Firefox on macOS it leaves the synthesiser stuck ("speaking" stays
  // true, no end event, nothing spoken afterwards until the page is reloaded).

  let current = null; // request handed to the engine; holding it also keeps the utterance alive
  let waiting = null; // newest request made while the engine was busy (it replaces older ones)
  let timer = 0;

  const isBusy = (synth) => synth.speaking || synth.pending;
  const sameRequest = (a, b) => Boolean(a) && Boolean(b) && a.text === b.text && a.lang === b.lang;

  function begin(synth, request) {
    const utterance = new SpeechSynthesisUtterance(request.text);
    const { voice } = pickVoice(request.lang);
    // With a suitable voice, use it; otherwise at least tell the engine the language.
    if (voice) utterance.voice = voice;
    utterance.lang = voice ? voice.lang : request.lang;
    utterance.volume = VOLUME;
    const finished = () => {
      if (current === request) current = null;
      schedule(); // whatever is waiting may start now
    };
    utterance.addEventListener('end', finished);
    utterance.addEventListener('error', finished);
    request.utterance = utterance;
    current = request;
    if (synth.paused) synth.resume();
    synth.speak(utterance);
  }

  function schedule() {
    if (waiting && !timer) timer = setTimeout(tick, POLL_MS);
  }

  function tick() {
    timer = 0;
    const synth = engine();
    if (!waiting || !synth) return;
    const request = waiting;
    if (!isBusy(synth)) {
      waiting = null;
      begin(synth, request);
    } else if (Date.now() - request.since > MAX_WAIT_MS) {
      // Last resort, once: the engine has been busy far longer than a word takes. Clearing its
      // queue recovers Chrome when it gets stuck; the request then starts as soon as it is silent.
      waiting = null;
      if (!request.retried) {
        synth.cancel();
        waiting = { ...request, retried: true, since: Date.now() };
      }
    }
    schedule();
  }

  /**
   * Reads `text` aloud in `lang`.
   *   - Engine silent: starts right away.
   *   - Same text is being read (the button was pressed again): nothing happens.
   *   - Something else is being read: the request waits until that has finished. Only the
   *     newest request is kept, so pressing several buttons in a row reads the last one.
   */
  function speak(text, lang) {
    const synth = engine();
    if (!synth || !text) return;
    const request = { text, lang, since: Date.now(), retried: false, utterance: null };
    if (!isBusy(synth) && !waiting) {
      begin(synth, request);
      return;
    }
    if (sameRequest(current, request) && !waiting) return;
    if (sameRequest(waiting, request)) return;
    waiting = request;
    schedule();
  }

  /** Voices load asynchronously in some browsers; `callback` runs when the list changes. */
  function onVoicesChanged(callback) {
    engine()?.addEventListener?.('voiceschanged', callback);
  }

  WV.speech = { canSpeak, pickVoice, speak, onVoicesChanged };
})(globalThis.WV);
