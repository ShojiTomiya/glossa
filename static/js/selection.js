import { state } from "./state.js";
import { popup, popupTranslation, explainPanel, targetLangSelect, narrowScreen } from "./dom.js";
import { canSpeak, speakButton } from "./speech.js";

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

// The translation (or a status) in the popup, followed by a button that reads
// the selected phrase itself aloud, in the text's language.
function setPopupText(text, phrase, lang) {
  popupTranslation.textContent = text;
  if (canSpeak(lang)) popupTranslation.appendChild(speakButton(phrase, lang));
}

// A reading area this much shorter than the screen leaves room for the panel
// beside it (the subtitle window under a video).
const SHEET_MIN_ROOM = 0.25; // of the screen height
const SHEET_MARGIN = 8; // px, as in mobile.css

// Next to the selection; on a narrow screen a panel across the screen instead
// (mobile.css) that never covers the selection, nor the system's own
// copy/look-up menu, which iOS shows right by it: in the free space under the
// reading area (or above it, if only there) when it leaves some, sized to
// fit it; otherwise in the half of the screen the selection isn't in.
function placePopup(rect, areaRect) {
  const sheet = narrowScreen.matches;
  popup.classList.toggle("sheet", sheet);
  popup.style.maxHeight = "";
  if (sheet) {
    const height = window.innerHeight;
    const above = areaRect.top;
    const below = height - areaRect.bottom;
    const room = height * SHEET_MIN_ROOM;
    let onTop;
    if (below >= room || above >= room) {
      // Below the area whenever it fits there: above it would cover what
      // comes first on the screen (under a video's subtitles, the video).
      onTop = below < room;
      popup.style.maxHeight = `${(onTop ? above : below) - 2 * SHEET_MARGIN}px`;
    } else {
      onTop = rect.top + rect.height / 2 > height / 2;
    }
    popup.classList.toggle("sheet-top", onTop);
    popup.style.left = popup.style.top = "";
  } else {
    popup.style.left = `${window.scrollX + rect.left}px`;
    popup.style.top = `${window.scrollY + rect.bottom + 6}px`;
  }
}

// Shows the popup at the current selection (in `area`, the reading area's
// element) and fetches its translation.
async function handleTextSelection(phrase, context, rect, area) {
  const token = ++selectionToken;
  state.currentSelection = { phrase, context };
  const lang = state.currentText.source_lang;
  const show = (text) => setPopupText(text, phrase, lang);

  placePopup(rect, area.getBoundingClientRect());
  popup.classList.remove("hidden");
  explainPanel.classList.add("hidden");
  explainPanel.innerHTML = "";
  show("…");

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
      show(errorText(data, "Translation error"));
      return;
    }
    show(data.translation);
  } catch (e) {
    if (token === selectionToken) show("Translation error");
  }
}

/* ---------- Reading areas: selecting text there translates it ---------- */

// Each reader registers its element and how to read a selection made in it:
// read(range) -> {phrase, context}, or null when there's nothing to translate.
const areas = [];

export function addReadingArea(element, read) {
  areas.push({ element, read });
}

function areaOf(node) {
  return node ? areas.find((area) => area.element.contains(node)) : undefined;
}

function translateSelection(area) {
  const selection = window.getSelection();
  if (!area || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const picked = area.read(range);
  if (!picked || !picked.phrase) return;
  handleTextSelection(picked.phrase, picked.context, range.getBoundingClientRect(), area.element);
}

// With a mouse, a selection is made between pressing the button in an area
// and letting go — anywhere, as the drag may end outside it. Requiring the
// press in an area also keeps clicks on the popup's own buttons from
// translating the still-selected text again.
//
// With a finger there's no such moment (iOS sends nothing when the selection
// handles are dragged), so a selection is translated once it has stayed the
// same for TOUCH_SETTLE_MS: adjusting the handles doesn't send a request for
// every step on the way.
const TOUCH_SETTLE_MS = 600;
let pointerType = "mouse";
let pressedArea = null;
let settleTimer = null;
let lastTouchSelection = "";

document.addEventListener(
  "pointerdown",
  (e) => {
    pointerType = e.pointerType || "mouse";
    pressedArea = e.button === 0 ? areaOf(e.target) : null;
    // A press anywhere but in the popup closes it; a new selection opens it again.
    if (!popup.contains(e.target)) hidePopup();
  },
  true
);

document.addEventListener("pointerup", () => {
  if (pointerType !== "mouse" || !pressedArea) return;
  const area = pressedArea;
  pressedArea = null;
  translateSelection(area);
});

document.addEventListener("selectionchange", () => {
  if (pointerType === "mouse") return;
  clearTimeout(settleTimer);
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    lastTouchSelection = "";
    return;
  }
  settleTimer = setTimeout(() => {
    const now = window.getSelection();
    if (!now || now.isCollapsed || now.rangeCount === 0) return;
    const range = now.getRangeAt(0);
    // The same selection again (iOS reports changes that change nothing):
    // already translated.
    const key = `${now.toString()}|${range.startOffset}|${range.endOffset}`;
    if (key === lastTouchSelection) return;
    lastTouchSelection = key;
    translateSelection(areaOf(range.startContainer));
  }, TOUCH_SETTLE_MS);
});
