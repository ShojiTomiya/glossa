import { state } from "./state.js";
import { pagePrevBtn, pageNextBtn, pageIndicator, bookReader, bookViewport, bookContent } from "./dom.js";
import { hidePopup, addReadingArea } from "./selection.js";
import { appendRuns } from "./reader.js";
import { getBlockContext } from "./context.js";

/* ---------- Paged reader: EPUBs, and PDFs in reading mode ----------
 *
 * The server renders the text one part at a time: an EPUB chapter
 * (epub_render.py) or a few pages of a PDF run together into one text
 * (pdf_render.render_reading_part), both as the same kind of blocks. A part
 * is laid out in CSS columns exactly one page wide and one page tall, so the
 * browser itself breaks it into pages; turning a page shifts the columns by
 * one page width. The arrows (shared with the original-layout PDF reader) go
 * page by page and on into the next or previous part.
 *
 * Page numbers depend on the window and font size, so the position kept is
 * the part and its first block on the page; after a resize, a font change
 * or reopening, the reader goes back to the page holding that block.
 *
 * Blocks use the PDF block classes (pblock, muted, bold, pimage) for their
 * styles, and data-role like PDF blocks for the selection context
 * (getBlockContext in context.js).
 */

const PAGE_GAP = 48; // px between two pages in the column strip
const HEADING_SIZES = { 1: 1.6, 2: 1.4, 3: 1.2, 4: 1.1, 5: 1, 6: 1 };
// A PDF picture keeps its share of the text width, but not below this (%):
// standing on its own between paragraphs, a small one would be a speck.
const MIN_PDF_PICTURE_PCT = 33;

// Where the parts come from, per kind of text.
const SOURCES = {
  epub: {
    partUrl: (id, n) => `/api/texts/${id}/epub-chapter/${n}`,
    imageUrl: (id, block) => `/api/texts/${id}/epub-image/${block.src.split("/").map(encodeURIComponent).join("/")}`,
    positionKey: (id) => `lexplain-epub-pos-${id}`,
  },
  pdf: {
    partUrl: (id, n) => `/api/texts/${id}/pdf-part/${n}`,
    imageUrl: (id, block) => `/api/texts/${id}/pdf-page/${block.page}/images/${block.index}`,
    positionKey: (id) => `lexplain-pdf-reading-pos-${id}`,
  },
};

let book = null; // {textId, source, part, total, progress, blocks, page, pages, step, blockPages}
let loadToken = 0; // only the latest part request may fill the page
const partCache = new Map(); // part number -> Promise of its JSON (or null)

function loadPosition(source, textId) {
  try {
    const pos = JSON.parse(localStorage.getItem(source.positionKey(textId)));
    const part = pos && (pos.part ?? pos.chapter); // "chapter": kept before PDFs used this reader
    if (part >= 1 && pos.block >= 0) return { part, block: pos.block };
  } catch (e) {
    /* nothing stored, or not JSON */
  }
  return { part: 1, block: 0 };
}

/* ---------- rendering ---------- */

// A note reference ("12", "*") is drawn by CSS from data-note, so it's not
// part of the text: selecting "word¹²" gives "word", and the context sent
// for translation doesn't get the number glued to it.
function appendBookRuns(el, runs) {
  for (const run of runs) {
    if (run.note) {
      const sup = document.createElement("sup");
      sup.className = "enote";
      sup.dataset.note = run.text;
      el.appendChild(sup);
    } else {
      appendRuns(el, [run], false);
    }
  }
}

function renderBookImage(block, textId, source) {
  const figure = document.createElement("div");
  figure.className = "efigure";
  figure.dataset.role = "skip";

  const img = document.createElement("img");
  img.className = "pimage";
  img.src = source.imageUrl(encodeURIComponent(textId), block);
  img.alt = block.alt || "";
  if (block.width_pct && block.aspect) {
    // A PDF picture: its share of the text width, its proportions known in advance.
    img.style.width = `${Math.min(100, Math.max(block.width_pct, MIN_PDF_PICTURE_PCT))}%`;
    img.style.aspectRatio = String(block.aspect);
  } else if (block.width && block.height) {
    // The size is known before the file arrives, so the page layout doesn't
    // move when it does. CSS keeps it within the page width and height
    // (object-fit keeps the picture's proportions when the height is capped).
    img.style.width = `${block.width}px`;
    img.style.aspectRatio = `${block.width} / ${block.height}`;
  } else {
    img.addEventListener("load", scheduleRelayout);
  }
  img.addEventListener("error", () => {
    img.remove();
    scheduleRelayout();
  });
  figure.appendChild(img);

  if (block.caption && block.caption.length) {
    figure.classList.add("efigure-captioned");
    const caption = document.createElement("p");
    caption.className = "pblock ecaption";
    caption.style.fontSize = "0.9em";
    appendBookRuns(caption, block.caption);
    figure.appendChild(caption);
  }
  return figure;
}

// See getBlockContext (context.js): text continues across ordinary
// paragraphs and list items, skips footnotes, stops at anything else.
function bookBlockRole(block) {
  if (block.small) return "skip";
  const body = (block.kind === "paragraph" || block.kind === "list-item") && !block.align && !block.pre;
  return body ? "body" : "stop";
}

function renderBookBlock(block, textId, source) {
  if (block.kind === "image") return renderBookImage(block, textId, source);
  if (block.kind === "separator") {
    const hr = document.createElement("hr");
    hr.className = "esep"; // no data-role: a scene break ends the sentence's context
    return hr;
  }

  const el = document.createElement(block.kind === "heading" ? "div" : "p");
  el.className = "pblock";
  el.dataset.role = bookBlockRole(block);
  let size = 1;
  if (block.kind === "heading") {
    el.classList.add("bold", "eheading");
    size = block.size || HEADING_SIZES[block.level] || 1; // PDFs give the size, EPUBs the level
  } else if (block.small) {
    el.classList.add("muted");
    size = 0.85;
  }
  el.style.fontSize = `${size}em`;
  if (block.align) el.style.textAlign = block.align;
  if (block.kind === "list-item") el.classList.add("eli");
  if (block.quote) el.classList.add("equote");
  if (block.pre) el.style.whiteSpace = "pre-wrap";

  appendBookRuns(el, block.runs || []);
  return el;
}

/* ---------- pages ---------- */

// Sizes the column strip to the space under the topbar, then lays the part
// out in pages.
function layout() {
  const topbar = document.getElementById("topbar");
  const styles = getComputedStyle(bookReader);
  const padding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
  const height = Math.max(200, Math.floor(window.innerHeight - topbar.offsetHeight - padding));
  const width = bookViewport.clientWidth;

  bookViewport.style.height = `${height}px`;
  bookContent.style.height = `${height}px`;
  bookContent.style.width = `${width}px`;
  bookContent.style.columnWidth = `${width}px`;
  bookContent.style.columnGap = `${PAGE_GAP}px`;
  bookContent.style.setProperty("--page-h", `${height}px`);
  book.step = width + PAGE_GAP;

  // Breaks forced by a previous layout no longer apply at this size.
  for (const el of bookContent.querySelectorAll("[data-forced-break]")) {
    el.style.removeProperty("break-before");
    el.style.removeProperty("-webkit-column-break-before");
    delete el.dataset.forcedBreak;
  }
  measure();
  keepHeadingsWithText();
}

// Works out how many pages the part takes and on which page each block starts.
function measure() {
  const origin = bookContent.getBoundingClientRect().left;
  const pageOf = (x) => Math.max(0, Math.floor((x - origin + 1) / book.step));
  const blocks = [...bookContent.children];
  book.blockPages = blocks.map((el) => pageOf(el.getBoundingClientRect().left));

  // The last block may run on over several pages: its last fragment ends the part.
  let lastRight = origin;
  const last = blocks[blocks.length - 1];
  if (last) for (const rect of last.getClientRects()) lastRight = Math.max(lastRight, rect.right);
  book.pages = Math.max(1, pageOf(lastRight - 2) + 1, Math.round((bookContent.scrollWidth + PAGE_GAP) / book.step));
}

// A heading (or a run of them, say a chapter number over its title) left at
// the bottom of a page, with its text starting on the next one, moves to the
// next page too. CSS break-after: avoid asks for exactly this, but not every
// browser honours it inside columns (Safari doesn't), so it's done here: a
// forced break before the heading, one heading at a time from the top, since
// each one shifts everything after it.
function keepHeadingsWithText() {
  const blocks = [...bookContent.children];
  const isHeading = (el) => el.classList.contains("eheading");
  for (let moves = 0; moves < 100; moves++) {
    let moved = false;
    for (let i = 0; i < blocks.length && !moved; i++) {
      if (!isHeading(blocks[i]) || (i > 0 && isHeading(blocks[i - 1]))) continue;
      let next = i;
      while (next < blocks.length && isHeading(blocks[next])) next++;
      const page = book.blockPages[i];
      // Its text starts on a later page than the heading (run) does.
      const stranded = next < blocks.length && book.blockPages[next] > page;
      const topOfPage = i === 0 || book.blockPages[i - 1] < page; // moving it wouldn't help
      if (stranded && !topOfPage && !blocks[i].dataset.forcedBreak) {
        blocks[i].style.setProperty("break-before", "column");
        blocks[i].style.setProperty("-webkit-column-break-before", "always");
        blocks[i].dataset.forcedBreak = "1";
        moved = true;
      }
    }
    if (!moved) return;
    measure();
  }
}

// The block the page is "at": the first one starting on it, or the one
// running over it from an earlier page.
function blockOnPage() {
  if (!book || !book.blockPages.length) return 0;
  const first = book.blockPages.findIndex((p) => p === book.page);
  if (first !== -1) return first;
  let before = 0;
  book.blockPages.forEach((p, i) => {
    if (p < book.page) before = i;
  });
  return before;
}

// The original page the screen page starts in (PDFs in reading mode only).
export function currentOriginalPage() {
  if (!book || book.source !== SOURCES.pdf) return null;
  const block = book.blocks[blockOnPage()];
  return block ? block.page : null;
}

function updateIndicator() {
  // How far into the book, from the parts' lengths: no page numbers, which
  // change with the window and font size anyway.
  const { before, share } = book.progress || { before: 0, share: 0 };
  const percent = Math.min(100, Math.round((before + share * ((book.page + 1) / book.pages)) * 100));
  pageIndicator.textContent = `${percent}%`;
  pagePrevBtn.disabled = book.part <= 1 && book.page <= 0;
  pageNextBtn.disabled = book.part >= book.total && book.page >= book.pages - 1;
}

function setPage(page) {
  book.page = Math.min(Math.max(0, page), book.pages - 1);
  bookContent.style.transform = `translateX(${-book.page * book.step}px)`;
  updateIndicator();
  localStorage.setItem(book.source.positionKey(book.textId), JSON.stringify({ part: book.part, block: blockOnPage() }));
  hidePopup();
  window.getSelection().removeAllRanges();
}

let relayoutTimer = null;

function scheduleRelayout() {
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(() => {
    if (!book || bookReader.classList.contains("hidden")) return;
    const block = blockOnPage();
    layout();
    setPage(book.blockPages[block] ?? 0);
  }, 120);
}

/* ---------- parts ---------- */

function fetchPart(textId, num) {
  if (!partCache.has(num)) {
    const request = fetch(book.source.partUrl(textId, num))
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    partCache.set(num, request);
    request.then((data) => {
      if (!data) partCache.delete(num); // let a later attempt try again
    });
  }
  return partCache.get(num);
}

// target: {block: n} (a remembered position), {originalPage: n} (coming from
// the PDF's original layout), {page: 0} or {page: "last"}.
async function showPart(textId, num, target) {
  const token = ++loadToken;
  const data = await fetchPart(textId, num);
  if (token !== loadToken || !state.currentText || state.currentText.id !== textId) return;
  if (!data) {
    // e.g. a remembered part past the end: start from the beginning instead
    if (num > 1) return showPart(textId, 1, { page: 0 });
    bookContent.replaceChildren();
    pageIndicator.textContent = "";
    return;
  }

  Object.assign(book, {
    part: data.part, total: data.total_parts, progress: data.progress, blocks: data.blocks, page: 0, pages: 1,
  });
  bookContent.style.transform = "";
  bookContent.replaceChildren(...data.blocks.map((block) => renderBookBlock(block, textId, book.source)));
  layout();
  const pageOfBlock = (i) => book.blockPages[Math.min(i, book.blockPages.length - 1)] ?? 0;
  if (target.page === "last") setPage(book.pages - 1);
  else if (typeof target.block === "number") setPage(pageOfBlock(target.block));
  else if (typeof target.originalPage === "number") {
    const i = data.blocks.findIndex((block) => block.page >= target.originalPage);
    setPage(pageOfBlock(i === -1 ? data.blocks.length - 1 : i));
  } else setPage(target.page || 0);

  // The neighbours, so turning into them doesn't wait for the server.
  if (book.part < book.total) fetchPart(textId, book.part + 1);
  if (book.part > 1) fetchPart(textId, book.part - 1);
}

export function showBookLoading() {
  const p = document.createElement("p");
  p.className = "pdf-loading";
  p.textContent = "Loading…";
  bookContent.style.transform = "";
  bookContent.replaceChildren(p);
  pageIndicator.textContent = "";
}

// kind: "epub" or "pdf". originalPage (PDFs): open where that page of the
// original starts, instead of where reading stopped last time.
export async function openBook(textId, kind, originalPage = null) {
  partCache.clear();
  book = { textId, source: SOURCES[kind] };
  if (originalPage) {
    const part = Math.floor((originalPage - 1) / state.currentText.pages_per_part) + 1;
    await showPart(textId, part, { originalPage });
  } else {
    const pos = loadPosition(book.source, textId);
    await showPart(textId, pos.part, { block: pos.block });
  }
}

export function closeBook() {
  loadToken++;
  book = null;
  partCache.clear();
  bookContent.replaceChildren();
  bookContent.style.transform = "";
}

function isOpenBook() {
  return book && book.blocks && state.currentText && state.currentText.id === book.textId
    && !bookReader.classList.contains("hidden");
}

function nextPage() {
  if (!isOpenBook()) return;
  if (book.page < book.pages - 1) setPage(book.page + 1);
  else if (book.part < book.total) showPart(book.textId, book.part + 1, { page: 0 });
}

function previousPage() {
  if (!isOpenBook()) return;
  if (book.page > 0) setPage(book.page - 1);
  else if (book.part > 1) showPart(book.textId, book.part - 1, { page: "last" });
}

/* ---------- listeners ---------- */

pageNextBtn.addEventListener("click", nextPage);
pagePrevBtn.addEventListener("click", previousPage);

document.addEventListener("keydown", (e) => {
  if (!isOpenBook() || e.altKey || e.ctrlKey || e.metaKey) return;
  if (document.querySelector("dialog[open]") || e.target.closest("input, select, textarea")) return;
  if (e.key === "ArrowRight" || e.key === "PageDown") nextPage();
  else if (e.key === "ArrowLeft" || e.key === "PageUp") previousPage();
  else return;
  e.preventDefault();
});

// On a touch screen, a quick sideways swipe turns the page. A slow one, or
// one while text is selected, is left alone: that's the finger selecting.
const SWIPE_MIN_PX = 50;
const SWIPE_MAX_MS = 600;
let swipeStart = null;

bookViewport.addEventListener(
  "touchstart",
  (e) => {
    const touch = e.touches[0];
    swipeStart = e.touches.length === 1 ? { x: touch.clientX, y: touch.clientY, time: performance.now() } : null;
  },
  { passive: true }
);

bookViewport.addEventListener(
  "touchend",
  (e) => {
    const start = swipeStart;
    swipeStart = null;
    if (!start || performance.now() - start.time > SWIPE_MAX_MS) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    if (dx < 0) nextPage();
    else previousPage();
  },
  { passive: true }
);

window.addEventListener("resize", scheduleRelayout);
document.addEventListener("glossa:settings", scheduleRelayout);

// overflow: clip should already prevent it, but if a browser scrolls the
// page window anyway (dragging a selection past its edge), undo that: the
// position is only ever set through the transform.
bookViewport.addEventListener("scroll", () => {
  bookViewport.scrollLeft = 0;
  bookViewport.scrollTop = 0;
});

addReadingArea(bookContent, (range) => ({ phrase: range.toString().trim(), context: getBlockContext(range) }));
