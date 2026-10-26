import { state } from "./state.js";
import { pdfPage, pagePrevBtn, pageNextBtn, pageIndicator } from "./dom.js";
import { getBlockContext } from "./context.js";
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
  el.dataset.role = blockRole(block);
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
  img.dataset.role = "skip";
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
  pageIndicator.textContent = "";
}

/* ---------- pages ---------- */

// The pages next to the open one are fetched in the background: turning to
// them is then instant, and a sentence running over the page edge can take
// its context from them (getBlockContext). Kept for the open PDF only, and
// only around the open page.
const KEEP_PAGES_AROUND = 2;
let cachedTextId = null;
const pageRequests = new Map(); // page number -> Promise of its JSON (or null)
const pageData = new Map(); // page number -> its JSON, once it has arrived

function fetchPage(textId, num) {
  if (cachedTextId !== textId) {
    cachedTextId = textId;
    pageRequests.clear();
    pageData.clear();
  }
  if (!pageRequests.has(num)) {
    const request = fetch(`/api/texts/${textId}/pdf-page/${num}`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    pageRequests.set(num, request);
    request.then((data) => {
      if (cachedTextId !== textId) return;
      if (data) pageData.set(num, data);
      else pageRequests.delete(num); // let a later attempt try again
    });
  }
  return pageRequests.get(num);
}

function keepPagesAround(textId, num, total) {
  for (const n of [...pageRequests.keys()]) {
    if (Math.abs(n - num) > KEEP_PAGES_AROUND) {
      pageRequests.delete(n);
      pageData.delete(n);
    }
  }
  if (num > 1) fetchPage(textId, num - 1);
  if (num < total) fetchPage(textId, num + 1);
}

// Bumped on every page request: only the latest one may fill the page (fast
// clicks on "next", or going back to the library while a page loads).
let pdfLoadToken = 0;

export async function loadPdfPage(textId, num) {
  const token = ++pdfLoadToken;
  const data = await fetchPage(textId, num);
  if (token !== pdfLoadToken || !state.currentText || state.currentText.id !== textId) return;
  if (!data) {
    pdfPage.innerHTML = "";
    pageIndicator.textContent = "";
    return;
  }

  pdfPageNum = data.page;
  pdfTotalPages = data.total_pages;
  pdfPage.innerHTML = "";
  for (const block of data.blocks) {
    pdfPage.appendChild(block.kind === "image" ? renderPdfImage(block, textId, data.page) : renderPdfBlock(block));
  }

  pageIndicator.textContent = `${pdfPageNum} / ${pdfTotalPages}`;
  pagePrevBtn.disabled = pdfPageNum <= 1;
  pageNextBtn.disabled = pdfPageNum >= pdfTotalPages;
  localStorage.setItem(pdfPageKey(textId), String(pdfPageNum));
  hidePopup();
  window.scrollTo(0, 0);
  keepPagesAround(textId, pdfPageNum, pdfTotalPages);
}

// The arrows are shared with the book reader (book.js), which handles them for EPUBs.
function isOpenPdf() {
  return state.currentText && state.currentText.kind === "pdf";
}

pagePrevBtn.addEventListener("click", () => {
  if (isOpenPdf() && pdfPageNum > 1) loadPdfPage(state.currentText.id, pdfPageNum - 1);
});
pageNextBtn.addEventListener("click", () => {
  if (isOpenPdf() && pdfPageNum < pdfTotalPages) loadPdfPage(state.currentText.id, pdfPageNum + 1);
});

// How a block takes part in a selection's context (see getBlockContext in
// context.js). Set on each rendered block, and used directly on the JSON of
// a neighbouring page that isn't shown.
function blockRole(block) {
  if (block.kind === "image" || block.edge || block.muted || block.rel_size < 0.9) return "skip";
  const body = block.kind === "paragraph" && !block.bold && (block.align || "left") === "left" && block.rel_size <= 1.15;
  return body ? "body" : "stop";
}

function blockText(block) {
  // As renderPdfBlock joins it: runs separated by a space.
  return block.rows.flatMap((row) => row.cells.flatMap((cell) => cell)).map((run) => run.text).join(" ");
}

// The first (forward) or last body block of a neighbouring page, from its JSON.
function bodyTextAtPageEdge(data, fromStart) {
  if (!data) return null; // not fetched (yet): no context from it
  const blocks = fromStart ? data.blocks : [...data.blocks].reverse();
  for (const block of blocks) {
    const role = blockRole(block);
    if (role === "skip") continue;
    return role === "body" ? blockText(block) : null;
  }
  return null;
}

const pdfNeighbourPages = {
  before: () => bodyTextAtPageEdge(pageData.get(pdfPageNum - 1), false),
  after: () => bodyTextAtPageEdge(pageData.get(pdfPageNum + 1), true),
};

pdfPage.addEventListener("mouseup", () => {
  const selection = window.getSelection();
  const phrase = selection.toString().trim();
  if (!phrase || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  handleTextSelection(phrase, getBlockContext(range, pdfNeighbourPages), range.getBoundingClientRect());
});
