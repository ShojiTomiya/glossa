import { state } from "./state.js";
import { readerView, readerContent, bookmarkJumpBtn } from "./dom.js";
import { extractSentenceContext, globalTextOffset } from "./context.js";
import { handleTextSelection } from "./selection.js";

// Continuous reader for TXT, EPUB and URL imports.

let currentBookmarkLine = null;

/* ---------- Bookmarks ---------- */

function bookmarkKey(textId) {
  return `lexplain-bookmark-${textId}`;
}

export function loadBookmark(textId) {
  const v = localStorage.getItem(bookmarkKey(textId));
  return v === null ? null : parseInt(v, 10);
}

export function setBookmark(lineIndex) {
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

function toggleBookmark(lineIndex) {
  setBookmark(currentBookmarkLine === lineIndex ? null : lineIndex);
}

// Shows an up/down arrow pointing toward the bookmarked line when it's
// scrolled out of view, and hides the button entirely once it's on screen.
function updateBookmarkButton() {
  if (readerView.style.display !== "block" || currentBookmarkLine === null) {
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
    });
  },
  { passive: true }
);

bookmarkJumpBtn.addEventListener("click", () => {
  if (currentBookmarkLine === null) return;
  const lineDiv = readerContent.querySelector(`.reader-line[data-line-index="${currentBookmarkLine}"]`);
  if (lineDiv) lineDiv.scrollIntoView({ behavior: "smooth", block: "center" });
});

// The video branch of openText(): no line bookmark while a video is open.
export function forgetBookmark() {
  currentBookmarkLine = null;
}

/* ---------- Rendering ---------- */

export function renderReaderContent(content) {
  readerContent.innerHTML = "";
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    const lineDiv = document.createElement("div");
    lineDiv.className = "reader-line";
    lineDiv.dataset.lineIndex = i;

    const dot = document.createElement("span");
    dot.className = "bookmark-dot";
    dot.title = "Bookmark this line";
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleBookmark(i);
    });
    lineDiv.appendChild(dot);

    const textSpan = document.createElement("span");
    textSpan.className = "reader-line-text";
    textSpan.textContent = line;
    lineDiv.appendChild(textSpan);

    readerContent.appendChild(lineDiv);

    if (i < lines.length - 1) {
      const sep = document.createElement("span");
      sep.className = "line-sep";
      sep.textContent = "\n";
      readerContent.appendChild(sep);
    }
  });
}

// Same DOM shape as renderReaderContent (so bookmarks/selection/context work
// identically) but built from EPUB blocks — {kind, level?, runs} — instead
// of splitting a flat string, so headings and inline italic/bold survive.
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

    const dot = document.createElement("span");
    dot.className = "bookmark-dot";
    dot.title = "Bookmark this line";
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleBookmark(i);
    });
    lineDiv.appendChild(dot);

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
// "\n" within a run's text (from an EPUB <br>) becomes a real <br> element,
// not just a character — used by both the PDF and EPUB renderers.
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
