import { state } from "./state.js";
import {
  brand, topbarReaderActions, libraryView, readerView, readerTitle, readerContent, targetLangSelect, backBtn,
  bookmarkJumpBtn, pdfReader, pdfPage, pagePrevBtn, pageNextBtn, pageIndicator, bookReader, narrowScreen,
} from "./dom.js";
import "./settings.js";
import { loadLanguages } from "./languages.js";
import { initLibrary, loadLibrary } from "./library.js";
import { renderReaderBlocks, restoreReaderPosition, forgetBookmark } from "./reader.js";
import { hidePopup } from "./selection.js";
import "./explain.js";
import { loadPdfPage, loadPdfPageNum, showPdfLoading, currentPdfPage } from "./pdf.js";
import { openBook, closeBook, showBookLoading, currentOriginalPage } from "./book.js";
import { openVideo } from "./video.js";

/* ---------- Opening an item / back to the library ---------- */

// Bumped on every open/back. A slow response for an item opened earlier must
// not replace the one opened since (two clicks in the library in a row).
let openToken = 0;

// Shows one of the readers (null: none, the video reader handles itself) and
// whether the page arrows / position indicator are used.
function showReader(reader, arrows) {
  for (const el of [readerContent, pdfReader, bookReader]) el.classList.toggle("hidden", el !== reader);
  for (const el of [pagePrevBtn, pageNextBtn, pageIndicator]) el.classList.toggle("hidden", !arrows);
  bookmarkJumpBtn.classList.add("hidden");
}

/* ---------- PDF: reading mode / original layout ---------- */

// A PDF opens in reading mode (the text laid out like a book, by book.js) or
// in its original layout (page by page, by pdf.js), chosen in the settings
// dialog and kept per PDF; a narrow screen (a phone) always gets reading
// mode, as the original layout's pictures beside the text don't fit there.
const pdfViewFieldset = document.getElementById("pdf-view-fieldset");

function pdfModeKey(textId) {
  return `lexplain-pdf-mode-${textId}`;
}

function pdfMode(textId) {
  if (narrowScreen.matches) return "reading";
  return localStorage.getItem(pdfModeKey(textId)) === "original" ? "original" : "reading";
}

// originalPage: open at that page of the original (when switching mode), not
// where reading stopped last time in that mode.
async function openPdf(textId, mode, originalPage = null) {
  if (mode === "reading") {
    showReader(bookReader, true);
    showBookLoading();
    await openBook(textId, "pdf", originalPage);
  } else {
    closeBook();
    showReader(pdfReader, true);
    showPdfLoading();
    await loadPdfPage(textId, originalPage || loadPdfPageNum(textId));
  }
}

function isPdfOpen() {
  return state.currentText && state.currentText.kind === "pdf";
}

// Switching keeps the place: the original page the reading-mode page starts
// in, or the reading-mode text where the original page begins.
function switchPdfMode(mode) {
  const textId = state.currentText.id;
  const fromReading = !bookReader.classList.contains("hidden");
  if ((mode === "reading") === fromReading) return;
  const page = fromReading ? currentOriginalPage() : currentPdfPage();
  openPdf(textId, mode, page);
}

// The choice shows in the settings dialog only while a PDF is open, and not
// on a narrow screen, where there's no choice.
document.getElementById("settings-btn").addEventListener("click", () => {
  pdfViewFieldset.hidden = !isPdfOpen() || narrowScreen.matches;
  if (pdfViewFieldset.hidden) return;
  const mode = pdfMode(state.currentText.id);
  for (const input of pdfViewFieldset.querySelectorAll("input")) input.checked = input.value === mode;
});

pdfViewFieldset.addEventListener("change", (e) => {
  if (!isPdfOpen()) return;
  localStorage.setItem(pdfModeKey(state.currentText.id), e.target.value);
  switchPdfMode(e.target.value);
});

// A window made narrow (or wide again) switches to the mode that fits it.
narrowScreen.addEventListener("change", () => {
  if (isPdfOpen()) switchPdfMode(pdfMode(state.currentText.id));
});

async function openText(id) {
  const token = ++openToken;
  const res = await fetch(`/api/texts/${id}`);
  const entry = await res.json();
  if (token !== openToken) return;
  state.currentText = entry;
  readerTitle.textContent = state.currentText.title;

  // default target lang: first language != source_lang, preferring English
  const options = [...targetLangSelect.options].map((o) => o.value);
  const preferred = options.includes("en") && state.currentText.source_lang !== "en" ? "en" : options.find((o) => o !== state.currentText.source_lang);
  targetLangSelect.value = preferred;

  libraryView.style.display = "none";
  readerView.style.display = "block";
  brand.style.display = "none";
  topbarReaderActions.style.display = "flex";
  hidePopup();

  if (state.currentText.kind === "video") {
    showReader(null, false);
    forgetBookmark();
    window.scrollTo(0, 0);
    openVideo(state.currentText);
    return;
  }

  if (state.currentText.kind === "epub") {
    showReader(bookReader, true);
    window.scrollTo(0, 0);
    showBookLoading();
    await openBook(state.currentText.id, "epub");
  } else if (state.currentText.kind === "pdf") {
    window.scrollTo(0, 0);
    await openPdf(state.currentText.id, pdfMode(state.currentText.id));
  } else {
    showReader(readerContent, false);
    renderReaderBlocks(state.currentText.blocks);
    restoreReaderPosition(state.currentText.id);
  }
}

backBtn.addEventListener("click", () => {
  openToken++;
  state.currentText = null;
  // Emptied now, so the next item never opens showing this one for a moment.
  readerTitle.textContent = "";
  readerContent.replaceChildren();
  pdfPage.replaceChildren();
  closeBook();
  pageIndicator.textContent = "";
  hidePopup();
  readerView.style.display = "none";
  libraryView.style.display = "block";
  topbarReaderActions.style.display = "none";
  brand.style.display = "block";
  bookmarkJumpBtn.classList.add("hidden");
  pagePrevBtn.classList.add("hidden");
  pageNextBtn.classList.add("hidden");
  pageIndicator.classList.add("hidden");
  loadLibrary();
});

// The language lists in the page, and the library's language badges, need these first.
await loadLanguages();
initLibrary(openText);
loadLibrary();
