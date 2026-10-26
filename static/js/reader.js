import { state } from "./state.js";
import { readerView, readerContent, bookmarkJumpBtn } from "./dom.js";
import { extractSentenceContext, globalTextOffset } from "./context.js";
import { handleTextSelection } from "./selection.js";

// Continuous reader for articles (URL imports).

// The clickable line bookmark (a dot beside each line). Switched off: the
// reading position is now remembered by itself (see "Reading position"
// below), which made it redundant. true brings it back.
const BOOKMARKS_ENABLED = false;

let currentBookmarkLine = null;

/* ---------- Bookmarks ---------- */

function bookmarkKey(textId) {
  return `lexplain-bookmark-${textId}`;
}

function loadBookmark(textId) {
  const v = localStorage.getItem(bookmarkKey(textId));
  return v === null ? null : parseInt(v, 10);
}

function setBookmark(lineIndex) {
  const prevDot = readerContent.querySelector(".bookmark-dot.active");
  if (prevDot) prevDot.classList.remove("active");

  currentBookmarkLine = lineIndex;
  if (lineIndex === null) {
    localStorage.removeItem(bookmarkKey(state.currentText.id));
  } else {
    localStorage.setItem(bookmarkKey(state.currentText.id), String(lineIndex));
    const lineDiv = readerContent.querySelector(`.reader-line[data-line-index="${lineIndex}"]`);
    if (lineDiv) lineDiv.querySelector(".bookmark-dot").classList.add("active");
  }

  updateBookmarkButton();
}

function bookmarkDot(lineIndex) {
  const dot = document.createElement("span");
  dot.className = "bookmark-dot";
  dot.title = "Bookmark this line";
  dot.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleBookmark(lineIndex);
  });
  return dot;
}

function toggleBookmark(lineIndex) {
  setBookmark(currentBookmarkLine === lineIndex ? null : lineIndex);
}

// Shows an up/down arrow pointing toward the bookmarked line when it's
// scrolled out of view, and hides the button entirely once it's on screen.
function updateBookmarkButton() {
  if (!BOOKMARKS_ENABLED || readerView.style.display !== "block" || currentBookmarkLine === null) {
    bookmarkJumpBtn.classList.add("hidden");
    return;
  }
  const lineDiv = readerContent.querySelector(`.reader-line[data-line-index="${currentBookmarkLine}"]`);
  if (!lineDiv) {
    bookmarkJumpBtn.classList.add("hidden");
    return;
  }
  const rect = lineDiv.getBoundingClientRect();
  if (rect.bottom < 0) {
    bookmarkJumpBtn.textContent = "↑";
    bookmarkJumpBtn.classList.remove("hidden");
  } else if (rect.top > window.innerHeight) {
    bookmarkJumpBtn.textContent = "↓";
    bookmarkJumpBtn.classList.remove("hidden");
  } else {
    bookmarkJumpBtn.classList.add("hidden");
  }
}

let bookmarkScrollScheduled = false;
window.addEventListener(
  "scroll",
  () => {
    if (bookmarkScrollScheduled) return;
    bookmarkScrollScheduled = true;
    requestAnimationFrame(() => {
      bookmarkScrollScheduled = false;
      updateBookmarkButton();
      scheduleSavePosition();
    });
  },
  { passive: true }
);

bookmarkJumpBtn.addEventListener("click", () => {
  if (currentBookmarkLine === null) return;
  const lineDiv = readerContent.querySelector(`.reader-line[data-line-index="${currentBookmarkLine}"]`);
  if (lineDiv) lineDiv.scrollIntoView({ behavior: "smooth", block: "center" });
});

/* ---------- Reading position ---------- */

// Kept as the index of the first line at the top of the screen, not a scroll
// offset, so it still points at the same text after a font size change.

let readerLines = []; // the .reader-line elements, in order
let savePositionTimer = null;

function positionKey(textId) {
  return `lexplain-position-${textId}`;
}

function topbarHeight() {
  return document.getElementById("topbar").offsetHeight;
}

// Binary search: the lines are in order, so this stays cheap for a whole book.
function firstVisibleLine() {
  const top = topbarHeight();
  let lo = 0;
  let hi = readerLines.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (readerLines[mid].getBoundingClientRect().bottom > top) {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return found;
}

function scheduleSavePosition() {
  if (!state.currentText || readerContent.classList.contains("hidden") || !readerLines.length) return;
  const textId = state.currentText.id;
  clearTimeout(savePositionTimer);
  savePositionTimer = setTimeout(() => {
    if (!state.currentText || state.currentText.id !== textId || readerContent.classList.contains("hidden")) return;
    const line = firstVisibleLine();
    if (line > 0) localStorage.setItem(positionKey(textId), String(line));
    else localStorage.removeItem(positionKey(textId));
  }, 400);
}

// After rendering a text: back to where reading stopped (or the bookmark,
// when bookmarks are on).
export function restoreReaderPosition(textId) {
  readerLines = [...readerContent.querySelectorAll(".reader-line")];
  if (BOOKMARKS_ENABLED) {
    setBookmark(loadBookmark(textId));
    return;
  }
  const line = parseInt(localStorage.getItem(positionKey(textId)), 10);
  const el = Number.isFinite(line) ? readerLines[line] : null;
  if (el) {
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - topbarHeight());
  } else {
    window.scrollTo(0, 0);
  }
}

// The video branch of openText(): no line bookmark while a video is open.
export function forgetBookmark() {
  currentBookmarkLine = null;
}

/* ---------- Rendering ---------- */

// One line per block — {kind, level?, runs} — so headings and inline
// italic/bold survive; the lines are what bookmarks and the reading position
// point at.
export function renderReaderBlocks(blocks) {
  readerContent.innerHTML = "";
  blocks.forEach((block, i) => {
    const lineDiv = document.createElement("div");
    lineDiv.className = "reader-line";
    lineDiv.dataset.lineIndex = i;
    if (block.kind === "heading") {
      lineDiv.classList.add(`heading-h${block.level}`);
    } else if (block.kind === "list-item") {
      lineDiv.classList.add("list-item");
    } else if (block.kind === "table-row") {
      lineDiv.classList.add("table-row");
    }

    if (BOOKMARKS_ENABLED) lineDiv.appendChild(bookmarkDot(i));

    if (block.kind === "image") {
      // A picture kept with the article (see images.py); the caption is real
      // text, so it can be selected and translated like the rest.
      lineDiv.classList.add("reader-image");
      const img = document.createElement("img");
      img.src = `/api/texts/${encodeURIComponent(state.currentText.id)}/images/${encodeURIComponent(block.file)}`;
      img.alt = block.alt || "";
      img.setAttribute("loading", "lazy");
      img.addEventListener("error", () => {
        // The file is missing (e.g. disk trouble while importing): hide the picture
        // instead of showing a broken-image icon; a caption, if any, stays.
        img.remove();
        if (!block.caption) lineDiv.classList.add("reader-image-missing");
      });
      lineDiv.appendChild(img);
      if (block.caption) {
        const caption = document.createElement("span");
        caption.className = "reader-line-text reader-block-text reader-caption";
        caption.textContent = block.caption;
        lineDiv.appendChild(caption);
      }
    } else {
      const textSpan = document.createElement("span");
      textSpan.className = "reader-line-text reader-block-text";
      appendRuns(textSpan, block.runs, false);
      lineDiv.appendChild(textSpan);
    }

    readerContent.appendChild(lineDiv);

    if (i < blocks.length - 1) {
      const sep = document.createElement("span");
      sep.className = "line-sep";
      sep.textContent = "\n";
      readerContent.appendChild(sep);
    }
  });
}

// Appends styled text runs ({text, italic, bold}) to `container`. A literal
// "\n" within a run's text (a <br>) becomes a real <br> element, not just a
// character — used by the article, PDF and EPUB renderers.
export function appendRuns(container, runs, joinWithSpace) {
  runs.forEach((run, i) => {
    if (joinWithSpace && i > 0) container.appendChild(document.createTextNode(" "));

    let target = container;
    if (run.bold) {
      const b = document.createElement("b");
      target.appendChild(b);
      target = b;
    }
    if (run.italic) {
      const em = document.createElement("i");
      target.appendChild(em);
      target = em;
    }

    run.text.split("\n").forEach((part, j) => {
      if (j > 0) target.appendChild(document.createElement("br"));
      if (part) target.appendChild(document.createTextNode(part));
    });
  });
}

function getSentenceContext(range) {
  const startNode = range.startContainer;
  const endNode = range.endContainer;

  if (startNode.nodeType !== Node.TEXT_NODE || endNode.nodeType !== Node.TEXT_NODE) {
    return range.toString();
  }

  const start = globalTextOffset(readerContent, startNode, range.startOffset);
  const end = globalTextOffset(readerContent, endNode, range.endOffset);

  return extractSentenceContext(readerContent.textContent, start, end) || range.toString();
}

readerContent.addEventListener("mouseup", () => {
  const selection = window.getSelection();
  const phrase = selection.toString().trim();
  if (!phrase || selection.rangeCount === 0) {
    return;
  }
  const range = selection.getRangeAt(0);
  handleTextSelection(phrase, getSentenceContext(range), range.getBoundingClientRect());
});
