import { state } from "./state.js";
import { readerContent, pdfPage, bookContent, popup, popupTranslation, explainPanel, targetLangSelect } from "./dom.js";

/* ---------- Selection popup ---------- */

export function hidePopup() {
  popup.classList.add("hidden");
  explainPanel.classList.add("hidden");
  explainPanel.innerHTML = "";
}

// Bumped on every selection. A slow response for an older selection must not
// overwrite the popup of a newer one; that happens easily when clicking
// through subtitles quickly.
export let selectionToken = 0;

export function errorText(payload, fallback) {
  return payload && typeof payload.detail === "string" ? payload.detail : fallback;
}

// Shared by the text reader, the PDF reader and the video reader: shows the
// popup at the current selection and fetches its translation.
export async function handleTextSelection(phrase, context, rect) {
  const token = ++selectionToken;
  state.currentSelection = { phrase, context };

  popup.style.left = `${window.scrollX + rect.left}px`;
  popup.style.top = `${window.scrollY + rect.bottom + 6}px`;
  popup.classList.remove("hidden");
  explainPanel.classList.add("hidden");
  explainPanel.innerHTML = "";
  popupTranslation.textContent = "…";

  try {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phrase,
        context,
        source_lang: state.currentText.source_lang,
        target_lang: targetLangSelect.value,
      }),
    });
    const data = await res.json();
    if (token !== selectionToken) return;
    if (!res.ok) {
      popupTranslation.textContent = errorText(data, "Translation error");
      return;
    }
    popupTranslation.textContent = data.translation;
  } catch (e) {
    if (token === selectionToken) popupTranslation.textContent = "Translation error";
  }
}

document.addEventListener("mousedown", (e) => {
  const inSelectableArea = [readerContent, pdfPage, bookContent].some((area) => area.contains(e.target));
  if (!popup.contains(e.target) && !inSelectableArea) {
    hidePopup();
  }
});
