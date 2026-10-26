// Pronunciation of single words with the browser's own speech synthesis
// (the system's voices: no server, no LLM quota, works offline).

import { speechTag } from "./languages.js";

// The language tags (speechTag, from config.py) have the same region as the
// eSpeak voices the IPA comes from, so e.g. English is read with an American
// voice, like its transcription.

// Single words for learning: a little slower than normal speech.
const RATE = 0.9;
// macOS novelty voices (singing, whispering, robots), never wanted here.
const NOVELTY_VOICES = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Kathy|Ralph)\b/;

const synth = window.speechSynthesis || null;
let voices = [];

// The list fills in asynchronously (empty at first in Chrome).
function refreshVoices() {
  voices = synth ? synth.getVoices() : [];
}
if (synth) {
  refreshVoices();
  synth.addEventListener("voiceschanged", refreshVoices);
}

const normalise = (tag) => tag.toLowerCase().replace("_", "-");

// Best voice for a language: a downloaded Premium/Enhanced one first, then
// the exact region, then one that runs locally (Chrome's Google voices need
// the internet).
function voiceFor(lang) {
  const tag = normalise(speechTag(lang));
  const base = tag.split("-")[0];
  const candidates = voices.filter((v) => normalise(v.lang).split("-")[0] === base && !NOVELTY_VOICES.test(v.name));
  if (!candidates.length) return null;
  const score = (v) =>
    (/premium|enhanced|natural|neural/i.test(v.name) ? 4 : 0) + (normalise(v.lang) === tag ? 2 : 0) + (v.localService ? 1 : 0);
  return candidates.reduce((best, v) => (score(v) > score(best) ? v : best));
}

// False when the browser has no speech synthesis, or its (loaded) voice list
// has nothing for this language. While the list is still loading, assume yes.
export function canSpeak(lang) {
  return !!synth && (!voices.length || voiceFor(lang) !== null);
}

const SPEAKER_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M2 6h2.5L8 3v10L4.5 10H2z"/>' +
  '<path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6.3 6.3 0 0 1 0 9"/></svg>';

// The small speaker button that reads `text` (used in the translation popup
// and in the Explain table).
export function speakButton(text, lang) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "speak-btn";
  button.title = "Listen";
  button.setAttribute("aria-label", `Listen to “${text}”`);
  button.innerHTML = SPEAKER_ICON; // a fixed icon, no user text
  button.addEventListener("click", () => speak(text, lang));
  return button;
}

function speak(text, lang) {
  if (!synth || !text) return;
  synth.cancel(); // a click while a word is still playing starts the new one
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = speechTag(lang);
  const voice = voiceFor(lang);
  if (voice) utterance.voice = voice;
  utterance.rate = RATE;
  synth.speak(utterance);
}
