'use strict';

// Pronunciation. Two sources:
//   - the browser's built-in speech synthesis (window.speechSynthesis) with an on-device voice:
//     nothing is downloaded and the word never leaves the browser;
//   - where that cannot be used (see "usesRecordings" below), a recording of the word from
//     Wikimedia Commons, played through Web Audio.

(function (WV) {
  if (WV.speech) return;

  /** Set from the stored settings by whoever loads this file (content/triggers.js). */
  const options = { ttsFallback: false };

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

  // --- Recordings ------------------------------------------------------------------------------
  //
  // Gecko (Firefox, Zen ...) on macOS ends every utterance with a click at full scale, about
  // 200 ms after the last audible sample. Measured on Gecko 157 / macOS 27 by recording the
  // system's audio output: it happens on a plain page without any extension, with every voice,
  // at every volume (even 0), pitch and rate, once per utterance. Chromium, a native program
  // using the same system synthesiser, and `say` do not do it. Nothing in the Web Speech API
  // changes it and the Web cannot touch that audio stream, so in those browsers a word is
  // pronounced from a recording instead (lib/pronunciation.js), played through Web Audio, where
  // the sound ends with a fade we control.
  // ASSUMPTION: every Gecko on macOS is treated as affected; only the combination above could
  // be measured. Revisit when Gecko's macOS speech backend changes.
  const usesRecordings = /\bGecko\/\d/.test(navigator.userAgent) && /Mac/.test(navigator.platform || navigator.userAgent);

  const FADE_IN_S = 0.015;
  const FADE_OUT_S = 0.05;
  /** Recordings come at very different levels; each is scaled so its peak lands here. */
  const TARGET_PEAK = 0.6;
  const MAX_GAIN = 4;
  /** The audio device is released this long after the last sound has faded out. */
  const IDLE_MS = 400;
  const MAX_CACHED = 30;

  let audioContext = null;
  let idleTimer = 0;
  let playing = null; // { key, source, gain }
  const recordings = new Map(); // "lang|text" -> Promise<{ buffer, credit } | null>

  function context() {
    audioContext ||= new AudioContext();
    clearTimeout(idleTimer);
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    return audioContext;
  }

  function decode(base64) {
    const binary = atob(base64);
    // Allocated through the page's constructor: Firefox does not let a page API read a buffer
    // that lives in the content script's own compartment.
    const bytes = new window.Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return context().decodeAudioData(bytes.buffer);
  }

  function loadRecording(text, lang) {
    const key = `${lang}|${text}`;
    if (!recordings.has(key)) {
      if (recordings.size >= MAX_CACHED) recordings.delete(recordings.keys().next().value);
      const loading = WV.send('wv:pronunciation', { text, lang })
        .then(async (result) => (result ? { key, buffer: await decode(result.audio), credit: { title: result.title, page: result.page } } : null))
        .catch(() => null);
      recordings.set(key, loading);
      // "Nothing found" is not remembered: it may only have been a network hiccup.
      loading.then((recording) => {
        if (!recording && recordings.get(key) === loading) recordings.delete(key);
      });
    }
    return recordings.get(key);
  }

  function peakOf(buffer) {
    let peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) {
        const value = Math.abs(samples[i]);
        if (value > peak) peak = value;
      }
    }
    return peak;
  }

  /** Fades out whatever is playing instead of cutting it. */
  function stopPlaying() {
    if (!playing) return;
    const { source, gain } = playing;
    const now = audioContext.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.03);
    source.stop(now + 0.04);
    playing = null;
  }

  function play({ key, buffer }) {
    const ctx = context();
    if (playing?.key === key) return; // same word, still playing
    stopPlaying();
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(ctx.destination);

    const level = Math.min(MAX_GAIN, TARGET_PEAK / (peakOf(buffer) || 1)) * VOLUME;
    const start = ctx.currentTime + 0.03;
    const end = start + buffer.duration;
    const fadeIn = Math.min(FADE_IN_S, buffer.duration / 4);
    const fadeOut = Math.min(FADE_OUT_S, buffer.duration / 2);
    // The gain is zero before the first and after the last sample, so neither a recording that
    // starts or stops abruptly nor the end of playback itself can produce a click.
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(level, start + fadeIn);
    gain.gain.setValueAtTime(level, end - fadeOut);
    gain.gain.linearRampToValueAtTime(0, end);
    source.start(start);

    const entry = { key, source, gain };
    playing = entry;
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      if (playing !== entry) return;
      playing = null;
      idleTimer = setTimeout(() => audioContext.suspend().catch(() => {}), IDLE_MS);
    };
  }

  /** Whether a pronunciation button makes sense for this language. */
  function available(lang) {
    if (!lang) return false;
    return usesRecordings ? true : canSpeak(lang);
  }

  /**
   * Pronounces `text` with whatever works in this browser.
   * @returns {Promise<{ via: 'voice' | 'recording' | null, credit?: { title: string, page: string } }>}
   *   `via` is null when there was nothing to play; `credit` names the recording that was used.
   */
  async function pronounce(text, lang) {
    if (!usesRecordings) {
      speak(text, lang);
      return { via: 'voice' };
    }
    context(); // created while the click that asked for it is still being handled
    const recording = await loadRecording(text, lang);
    if (recording) {
      play(recording);
      return { via: 'recording', credit: recording.credit };
    }
    if (options.ttsFallback && canSpeak(lang)) {
      speak(text, lang);
      return { via: 'voice' };
    }
    return { via: null };
  }

  WV.speech = { options, usesRecordings, available, pronounce, canSpeak, pickVoice, speak, onVoicesChanged };
})(globalThis.WV);
