import { state } from "./state.js";
import { pdfPage, pdfPrevBtn, pdfNextBtn, pdfPageIndicator } from "./dom.js";
import { extractSentenceContext, sentenceRunsOffEnd, globalTextOffset } from "./context.js";
import { hidePopup, handleTextSelection } from "./selection.js";
import { appendRuns } from "./reader.js";

/* ---------- PDF reader ---------- */

// PDF reader state
let pdfPageNum = 1;
let pdfTotalPages = 1;

function pdfPageKey(textId) {
  return `lexplain-pdf-page-${textId}`;
}

export function loadPdfPageNum(textId) {
  const v = localStorage.getItem(pdfPageKey(textId));
  return v === null ? 1 : parseInt(v, 10);
}

function renderPdfBlock(block) {
  const isRows = block.kind === "rows";
  const el = document.createElement(isRows ? "div" : "p");
  el.className = "pblock" + (block.muted ? " muted" : "") + (block.bold ? " bold" : "");
  el.dataset.blockId = block.id;
  el.style.fontSize = `${block.rel_size}em`;

  if (isRows) {
    el.classList.add("prow");
    for (const row of block.rows) {
      const rowEl = document.createElement("div");
      rowEl.className = row.cells.length > 1 ? "prow-row prow-row-multi" : "prow-row";
      for (const cell of row.cells) {
        const cellEl = document.createElement("span");
        cellEl.className = "prow-cell";
        appendRuns(cellEl, cell, true);
        rowEl.appendChild(cellEl);
      }
      el.appendChild(rowEl);
    }
  } else {
    el.style.textAlign = block.align;
    // Join every run across every row/cell into one flowing paragraph,
    // ignoring the PDF's own line breaks — those were computed for its
    // original width/font, not ours.
    const runs = block.rows.flatMap((row) => row.cells.flatMap((cell) => cell));
    appendRuns(el, runs, true);
  }

  return el;
}

// A picture from the page (see pdf_render.py). Its width is the share of the
// text width it had in the PDF, so it scales with the reader column; a float
// sits beside the next paragraph the way the page wraps text around it.
function renderPdfImage(block, textId, pageNum) {
  const img = document.createElement("img");
  img.className = "pimage" + (block.float ? ` pimage-${block.float}` : "");
  if (block.clear) img.style.clear = block.float;
  img.src = `/api/texts/${encodeURIComponent(textId)}/pdf-page/${pageNum}/images/${block.index}`;
  img.alt = "";
  img.style.width = `${block.width}%`;
  // Reserves the height before the file arrives, so the text doesn't jump.
  img.style.aspectRatio = String(block.aspect);
  img.addEventListener("error", () => img.remove());
  return img;
}

// The first page of a PDF can take a moment (the server measures the whole
// document once), so say so instead of showing an empty page.
export function showPdfLoading() {
  const p = document.createElement("p");
  p.className = "pdf-loading";
  p.textContent = "Loading…";
  pdfPage.replaceChildren(p);
  pdfPageIndicator.textContent = "";
}

// Bumped on every page request: only the latest one may fill the page (fast
// clicks on "next", or going back to the library while a page loads).
let pdfLoadToken = 0;

export async function loadPdfPage(textId, num) {
  const token = ++pdfLoadToken;
  const res = await fetch(`/api/texts/${textId}/pdf-page/${num}`);
  if (token !== pdfLoadToken || !state.currentText || state.currentText.id !== textId) return;
  if (!res.ok) {
    pdfPage.innerHTML = "";
    pdfPageIndicator.textContent = "";
    return;
  }
  const data = await res.json();
  if (token !== pdfLoadToken) return;

  pdfPageNum = data.page;
  pdfTotalPages = data.total_pages;
  pdfPage.innerHTML = "";
  for (const block of data.blocks) {
    pdfPage.appendChild(block.kind === "image" ? renderPdfImage(block, textId, data.page) : renderPdfBlock(block));
  }

  pdfPageIndicator.textContent = `${pdfPageNum} / ${pdfTotalPages}`;
  pdfPrevBtn.disabled = pdfPageNum <= 1;
  pdfNextBtn.disabled = pdfPageNum >= pdfTotalPages;
  localStorage.setItem(pdfPageKey(textId), String(pdfPageNum));
  hidePopup();
  window.scrollTo(0, 0);
}

pdfPrevBtn.addEventListener("click", () => {
  if (pdfPageNum > 1) loadPdfPage(state.currentText.id, pdfPageNum - 1);
});
pdfNextBtn.addEventListener("click", () => {
  if (pdfPageNum < pdfTotalPages) loadPdfPage(state.currentText.id, pdfPageNum + 1);
});

// Whether `el` is a normal flowing paragraph that a sentence could safely
// continue into — excludes headings (bold/centered), footers/footnotes
// (muted or noticeably smaller than body text), and row blocks (e.g. a
// title/author line), using only the same layout signals already computed
// server-side, never the text content itself.
function looksLikeBodyParagraph(el) {
  if (!el || !el.classList || !el.classList.contains("pblock")) return false;
  if (el.classList.contains("muted") || el.classList.contains("bold") || el.classList.contains("prow")) {
    return false;
  }
  if (el.style.textAlign && el.style.textAlign !== "left") return false;
  const relSize = parseFloat(el.style.fontSize);
  return relSize >= 0.9 && relSize <= 1.15;
}

// Mirrors getSentenceContext, but scoped to the single block the selection
// started in (a real PDF paragraph/heading/footnote) instead of the whole
// page — context never bleeds across blocks, and there's no huge document
// tree to walk. If the sentence runs off the end of the block (looks cut
// off, not finished) and the next block on the page is an ordinary
// paragraph, its text is folded in too, capped at one block so this can't
// chain indefinitely.
function getPdfContext(range) {
  const startNode = range.startContainer;
  const endNode = range.endContainer;
  if (startNode.nodeType !== Node.TEXT_NODE || endNode.nodeType !== Node.TEXT_NODE) {
    return range.toString();
  }

  const block = startNode.parentElement.closest(".pblock");
  if (!block) return range.toString();

  const start = globalTextOffset(block, startNode, range.startOffset);
  const end = globalTextOffset(block, endNode, range.endOffset);

  // A picture between the two paragraphs doesn't end the sentence.
  let next = block.nextElementSibling;
  while (next && next.classList.contains("pimage")) next = next.nextElementSibling;

  let fullText = block.textContent;
  if (sentenceRunsOffEnd(fullText, end) && looksLikeBodyParagraph(next)) {
    fullText += " " + next.textContent;
  }

  return extractSentenceContext(fullText, start, end) || range.toString();
}

pdfPage.addEventListener("mouseup", () => {
  const selection = window.getSelection();
  const phrase = selection.toString().trim();
  if (!phrase || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  handleTextSelection(phrase, getPdfContext(range), range.getBoundingClientRect());
});
