import { state } from "./state.js";
import { explainBtn, explainPanel, targetLangSelect } from "./dom.js";
import { selectionToken, errorText } from "./selection.js";
import { canSpeak, speakButton } from "./speech.js";

explainBtn.addEventListener("click", async () => {
  if (!state.currentSelection) return;
  const token = selectionToken;
  const { phrase, context } = state.currentSelection;
  explainPanel.classList.remove("hidden");
  explainPanel.textContent = "Loading…";

  try {
    const res = await fetch("/api/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phrase,
        context,
        source_lang: state.currentText.source_lang,
        target_lang: targetLangSelect.value,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (token !== selectionToken) return;
      // textContent, not innerHTML: on a 502 the detail contains raw model output.
      explainPanel.textContent = `Error: ${errorText(err, res.statusText)}`;
      return;
    }
    const data = await res.json();
    if (token !== selectionToken) return;
    renderExplain(data);
  } catch (e) {
    if (token === selectionToken) explainPanel.textContent = "Explain error";
  }
});

function renderExplain(data) {
  explainPanel.innerHTML = "";
  const lang = state.currentText.source_lang;

  if (data.explanation) {
    const explanation = document.createElement("p");
    explanation.className = "explain-text";
    explanation.textContent = data.explanation;
    explainPanel.appendChild(explanation);
  }

  if (Array.isArray(data.words) && data.words.length) {
    const table = document.createElement("table");
    table.className = "words-table";
    for (const w of data.words) {
      const row = document.createElement("tr");

      const text = document.createElement("td");
      text.className = "word-text";
      text.textContent = w.text || "";
      if (w.base_form && w.base_form !== w.text) {
        const base = document.createElement("span");
        base.className = "word-base-form";
        base.textContent = ` (${w.base_form})`;
        text.appendChild(base);
      }
      row.appendChild(text);

      const phonetic = document.createElement("td");
      phonetic.className = "word-phonetic";
      phonetic.textContent = w.phonetic || "";
      // Reads the same form the IPA was made from (w.text, see phonetics.py).
      if (w.text && canSpeak(lang)) phonetic.appendChild(speakButton(w.text, lang));
      row.appendChild(phonetic);

      const translation = document.createElement("td");
      translation.className = "word-translation";
      translation.textContent = w.translation || "";
      row.appendChild(translation);

      const details = document.createElement("td");
      details.className = "word-details";
      details.textContent = [w.part_of_speech, w.grammatical_details].filter(Boolean).join(" · ");
      row.appendChild(details);

      table.appendChild(row);
    }
    explainPanel.appendChild(table);
  }
}
