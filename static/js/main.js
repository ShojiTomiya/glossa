import { state } from "./state.js";
import {
  brand, topbarReaderActions, libraryView, readerView, readerTitle, readerContent, targetLangSelect, backBtn,
  bookmarkJumpBtn, pdfReader, pdfPage, pdfPrevBtn, pdfNextBtn, pdfPageIndicator,
} from "./dom.js";
import "./settings.js";
import { initLibrary, loadLibrary } from "./library.js";
import { renderReaderContent, renderReaderBlocks, setBookmark, loadBookmark, forgetBookmark } from "./reader.js";
import { hidePopup } from "./selection.js";
import "./explain.js";
import { loadPdfPage, loadPdfPageNum, showPdfLoading } from "./pdf.js";
import { openVideo } from "./video.js";

/* ---------- Opening an item / back to the library ---------- */

// Bumped on every open/back. A slow response for an item opened earlier must
// not replace the one opened since (two clicks in the library in a row).
let openToken = 0;

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
    readerContent.classList.add("hidden");
    pdfReader.classList.add("hidden");
    pdfPrevBtn.classList.add("hidden");
    pdfNextBtn.classList.add("hidden");
    pdfPageIndicator.classList.add("hidden");
    bookmarkJumpBtn.classList.add("hidden");
    forgetBookmark();
    window.scrollTo(0, 0);
    openVideo(state.currentText);
    return;
  }

  if (state.currentText.kind === "pdf") {
    readerContent.classList.add("hidden");
    pdfReader.classList.remove("hidden");
    bookmarkJumpBtn.classList.add("hidden");
    pdfPrevBtn.classList.remove("hidden");
    pdfNextBtn.classList.remove("hidden");
    pdfPageIndicator.classList.remove("hidden");
    showPdfLoading();
    await loadPdfPage(state.currentText.id, loadPdfPageNum(state.currentText.id));
  } else {
    pdfReader.classList.add("hidden");
    pdfPrevBtn.classList.add("hidden");
    pdfNextBtn.classList.add("hidden");
    pdfPageIndicator.classList.add("hidden");
    readerContent.classList.remove("hidden");
    if (state.currentText.kind === "epub" || state.currentText.kind === "url") {
      renderReaderBlocks(state.currentText.blocks);
    } else {
      renderReaderContent(state.currentText.content);
    }
    setBookmark(loadBookmark(state.currentText.id));
  }
}

backBtn.addEventListener("click", () => {
  openToken++;
  state.currentText = null;
  // Emptied now, so the next item never opens showing this one for a moment.
  readerTitle.textContent = "";
  readerContent.replaceChildren();
  pdfPage.replaceChildren();
  pdfPageIndicator.textContent = "";
  hidePopup();
  readerView.style.display = "none";
  libraryView.style.display = "block";
  topbarReaderActions.style.display = "none";
  brand.style.display = "block";
  bookmarkJumpBtn.classList.add("hidden");
  pdfPrevBtn.classList.add("hidden");
  pdfNextBtn.classList.add("hidden");
  pdfPageIndicator.classList.add("hidden");
  loadLibrary();
});

initLibrary(openText);
loadLibrary();
