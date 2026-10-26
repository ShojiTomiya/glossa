// The supported languages, from config.py through /api/languages:
// [{code, name, espeak, speech}]. Loaded once at startup (main.js), before
// anything renders; the language lists in the page are filled from it.

let languages = [];

function fill(select) {
  for (const { code, name } of languages) select.appendChild(new Option(name, code));
}

export async function loadLanguages() {
  const res = await fetch("/api/languages");
  languages = await res.json();
  // The filter keeps its own "All languages" option in front.
  for (const id of ["filter-lang-select", "source-lang-input", "edit-source-lang-input", "target-lang-select"]) {
    fill(document.getElementById(id));
  }
}

function find(code) {
  return languages.find((lang) => lang.code === code);
}

export function languageName(code) {
  return find(code)?.name || code.toUpperCase();
}

// Language tag for the browser's speech synthesis (e.g. "de-DE").
export function speechTag(code) {
  return find(code)?.speech || code;
}
