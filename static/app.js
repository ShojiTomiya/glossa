const LANG_NAMES = { de: "German", es: "Spanish", it: "Italian", fr: "French", en: "English", pl: "Polish" };
const FONT_STACKS = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'Georgia, "Iowan Old Style", Charter, "Times New Roman", serif',
};

const brand = document.getElementById("brand");
const topbarReaderActions = document.getElementById("topbar-reader-actions");
const libraryView = document.getElementById("library-view");
const readerView = document.getElementById("reader-view");
const textList = document.getElementById("text-list");
const filterLangSelect = document.getElementById("filter-lang-select");
const readerTitle = document.getElementById("reader-title");
const readerContent = document.getElementById("reader-content");
const targetLangSelect = document.getElementById("target-lang-select");
const backBtn = document.getElementById("back-btn");
const bookmarkJumpBtn = document.getElementById("bookmark-jump-btn");
const pdfReader = document.getElementById("pdf-reader");
const pdfPage = document.getElementById("pdf-page");
const pdfPrevBtn = document.getElementById("pdf-prev-btn");
const pdfNextBtn = document.getElementById("pdf-next-btn");
const pdfPageIndicator = document.getElementById("pdf-page-indicator");
const popup = document.getElementById("popup");
const popupTranslation = document.getElementById("popup-translation");
const explainBtn = document.getElementById("explain-btn");
const explainPanel = document.getElementById("explain-panel");

const uploadDialog = document.getElementById("upload-dialog");
const uploadOpenBtn = document.getElementById("upload-open-btn");
const uploadCancelBtn = document.getElementById("upload-cancel-btn");
const uploadForm = document.getElementById("upload-form");

const editDialog = document.getElementById("edit-dialog");
const editCancelBtn = document.getElementById("edit-cancel-btn");
const editForm = document.getElementById("edit-form");
const editTitleInput = document.getElementById("edit-title-input");
const editSourceLangInput = document.getElementById("edit-source-lang-input");
let editingTextId = null;

const deleteDialog = document.getElementById("delete-dialog");
const deleteDialogMessage = document.getElementById("delete-dialog-message");
const deleteCancelBtn = document.getElementById("delete-cancel-btn");
const deleteConfirmBtn = document.getElementById("delete-confirm-btn");
let deletingTextId = null;

const settingsDialog = document.getElementById("settings-dialog");
const settingsBtn = document.getElementById("settings-btn");
const settingsCloseBtn = document.getElementById("settings-close-btn");
const fontFamilySelect = document.getElementById("font-family-select");
const fontSizeSelect = document.getElementById("font-size-select");
const fontSettingsFieldset = document.getElementById("font-settings-fieldset");

let currentText = null; // {id, title, source_lang, content} or {..., kind: "pdf"}
let currentSelection = null; // {phrase, context}
let currentBookmarkLine = null;
let allTexts = [];

// PDF reader state
let pdfPageNum = 1;
let pdfTotalPages = 1;

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
    localStorage.removeItem(bookmarkKey(currentText.id));
  } else {
    localStorage.setItem(bookmarkKey(currentText.id), String(lineIndex));
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

/* ---------- Settings: theme + reading font ---------- */

function applySettings() {
  const theme = localStorage.getItem("lexplain-theme") || "default";
  const fontFamily = localStorage.getItem("lexplain-font-family") || "serif";
  const fontSize = localStorage.getItem("lexplain-font-size") || "18";

  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.setProperty("--reader-font-family", FONT_STACKS[fontFamily] || FONT_STACKS.serif);
  document.documentElement.style.setProperty("--reader-font-size", `${fontSize}px`);

  const themeInput = settingsDialog.querySelector(`input[name="theme"][value="${theme}"]`);
  if (themeInput) themeInput.checked = true;
  fontFamilySelect.value = fontFamily;
  fontSizeSelect.value = fontSize;
}

settingsBtn.addEventListener("click", () => {
  fontSettingsFieldset.style.display = readerView.style.display === "block" ? "block" : "none";
  settingsDialog.showModal();
});
settingsCloseBtn.addEventListener("click", () => settingsDialog.close());

settingsDialog.querySelectorAll('input[name="theme"]').forEach((input) => {
  input.addEventListener("change", () => {
    localStorage.setItem("lexplain-theme", input.value);
    applySettings();
  });
});

fontFamilySelect.addEventListener("change", () => {
  localStorage.setItem("lexplain-font-family", fontFamilySelect.value);
  applySettings();
});

fontSizeSelect.addEventListener("change", () => {
  localStorage.setItem("lexplain-font-size", fontSizeSelect.value);
  applySettings();
});

applySettings();

/* ---------- Library ---------- */

async function loadLibrary() {
  const res = await fetch("/api/texts");
  allTexts = await res.json();
  renderLibrary();
}

function renderLibrary() {
  const filter = filterLangSelect.value;
  const texts = filter ? allTexts.filter((t) => t.source_lang === filter) : allTexts;

  textList.innerHTML = "";
  for (const t of texts) {
    const li = document.createElement("li");

    const label = document.createElement("span");
    label.textContent = t.title;
    label.addEventListener("click", () => openText(t.id));

    const badge = document.createElement("span");
    badge.className = "text-lang-badge";
    badge.textContent = LANG_NAMES[t.source_lang] || t.source_lang.toUpperCase();
    label.appendChild(badge);
    if (t.kind === "video") {
      const kind = document.createElement("span");
      kind.className = "text-kind-badge";
      kind.textContent = t.subtitle_source === "auto" ? "Video · auto subs" : "Video";
      label.appendChild(kind);
    }

    const actions = document.createElement("span");
    actions.className = "text-actions";

    const edit = document.createElement("button");
    edit.textContent = "Edit";
    edit.className = "edit-btn";
    edit.addEventListener("click", (e) => {
      e.stopPropagation();
      editingTextId = t.id;
      editTitleInput.value = t.title;
      editSourceLangInput.value = t.source_lang;
      editSourceLangInput.disabled = t.kind === "video"; // subtitles are tied to their language
      editDialog.showModal();
    });

    const del = document.createElement("button");
    del.textContent = "Delete";
    del.className = "delete-btn";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      deletingTextId = t.id;
      deleteDialogMessage.textContent = `Delete "${t.title}"? This can't be undone.`;
      deleteDialog.showModal();
    });

    actions.appendChild(edit);
    actions.appendChild(del);
    li.appendChild(label);
    li.appendChild(actions);
    textList.appendChild(li);
  }
}

filterLangSelect.addEventListener("change", renderLibrary);

/* ---------- Edit dialog ---------- */

editCancelBtn.addEventListener("click", () => editDialog.close());

editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await fetch(`/api/texts/${editingTextId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: editTitleInput.value,
      source_lang: editSourceLangInput.value,
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    alert(err.detail || "Update failed");
    return;
  }
  editDialog.close();
  loadLibrary();
});

/* ---------- Delete dialog ---------- */

deleteCancelBtn.addEventListener("click", () => deleteDialog.close());

deleteConfirmBtn.addEventListener("click", async () => {
  await fetch(`/api/texts/${deletingTextId}`, { method: "DELETE" });
  deleteDialog.close();
  loadLibrary();
});

/* ---------- Upload dialog ---------- */

uploadOpenBtn.addEventListener("click", () => uploadDialog.showModal());
uploadCancelBtn.addEventListener("click", () => uploadDialog.close());

const uploadModeFileBtn = document.getElementById("upload-mode-file-btn");
const uploadModeUrlBtn = document.getElementById("upload-mode-url-btn");
const fileField = document.getElementById("file-field");
const urlField = document.getElementById("url-field");
const fileInput = document.getElementById("file-input");
const urlInput = document.getElementById("url-input");
const titleInput = document.getElementById("title-input");

const uploadModeVideoBtn = document.getElementById("upload-mode-video-btn");
const urlFieldLabel = document.getElementById("url-field-label");
const uploadSubmitBtn = uploadForm.querySelector('button[type="submit"]');

let uploadMode = "file";

const URL_FIELD_TEXT = {
  url: { label: "Article URL", placeholder: "https://example.com/article" },
  video: { label: "YouTube link", placeholder: "https://www.youtube.com/watch?v=..." },
};

function setUploadMode(mode) {
  uploadMode = mode;
  const isFile = mode === "file";

  fileField.classList.toggle("hidden", !isFile);
  urlField.classList.toggle("hidden", isFile);
  for (const [m, btn] of [
    ["file", uploadModeFileBtn],
    ["url", uploadModeUrlBtn],
    ["video", uploadModeVideoBtn],
  ]) {
    btn.classList.toggle("btn-primary", m === mode);
    btn.setAttribute("aria-pressed", String(m === mode));
  }
  if (!isFile) {
    urlFieldLabel.textContent = URL_FIELD_TEXT[mode].label;
    urlInput.placeholder = URL_FIELD_TEXT[mode].placeholder;
  }

  fileInput.required = isFile;
  urlInput.required = !isFile;
  // Title is auto-filled from the page or video when importing a link, so don't force it.
  titleInput.required = isFile;
}

uploadModeFileBtn.addEventListener("click", () => setUploadMode("file"));
uploadModeUrlBtn.addEventListener("click", () => setUploadMode("url"));
uploadModeVideoBtn.addEventListener("click", () => setUploadMode("video"));

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (uploadSubmitBtn.disabled) return;
  const title = titleInput.value;
  const sourceLang = document.getElementById("source-lang-input").value;

  // Importing a video can take several seconds (yt-dlp), so show progress
  // and block a second submit.
  const idleLabel = uploadSubmitBtn.textContent;
  uploadSubmitBtn.disabled = true;
  uploadSubmitBtn.textContent = uploadMode === "video" ? "Fetching subtitles…" : "Uploading…";
  try {
    let res;
    if (uploadMode === "file") {
      const formData = new FormData();
      formData.append("file", fileInput.files[0]);
      formData.append("title", title);
      formData.append("source_lang", sourceLang);
      res = await fetch("/api/upload", { method: "POST", body: formData });
    } else {
      const endpoint = uploadMode === "video" ? "/api/import-video" : "/api/import-url";
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput.value, title: title || null, source_lang: sourceLang }),
      });
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(typeof err.detail === "string" ? err.detail : "Import failed");
      return;
    }
    uploadForm.reset();
    setUploadMode("file");
    uploadDialog.close();
    loadLibrary();
  } catch (err) {
    alert("Import failed: could not reach the server.");
  } finally {
    uploadSubmitBtn.disabled = false;
    uploadSubmitBtn.textContent = idleLabel;
  }
});

/* ---------- View switching ---------- */

function renderReaderContent(content) {
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
function renderReaderBlocks(blocks) {
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
      img.src = `/api/texts/${encodeURIComponent(currentText.id)}/images/${encodeURIComponent(block.file)}`;
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

async function openText(id) {
  const res = await fetch(`/api/texts/${id}`);
  currentText = await res.json();
  readerTitle.textContent = currentText.title;

  // default target lang: first language != source_lang, preferring English
  const options = [...targetLangSelect.options].map((o) => o.value);
  const preferred = options.includes("en") && currentText.source_lang !== "en" ? "en" : options.find((o) => o !== currentText.source_lang);
  targetLangSelect.value = preferred;

  libraryView.style.display = "none";
  readerView.style.display = "block";
  brand.style.display = "none";
  topbarReaderActions.style.display = "flex";
  hidePopup();

  if (currentText.kind === "video") {
    readerContent.classList.add("hidden");
    pdfReader.classList.add("hidden");
    pdfPrevBtn.classList.add("hidden");
    pdfNextBtn.classList.add("hidden");
    pdfPageIndicator.classList.add("hidden");
    bookmarkJumpBtn.classList.add("hidden");
    currentBookmarkLine = null;
    window.scrollTo(0, 0);
    openVideo(currentText);
    return;
  }

  if (currentText.kind === "pdf") {
    readerContent.classList.add("hidden");
    pdfReader.classList.remove("hidden");
    bookmarkJumpBtn.classList.add("hidden");
    pdfPrevBtn.classList.remove("hidden");
    pdfNextBtn.classList.remove("hidden");
    pdfPageIndicator.classList.remove("hidden");
    await loadPdfPage(currentText.id, loadPdfPageNum(currentText.id));
  } else {
    pdfReader.classList.add("hidden");
    pdfPrevBtn.classList.add("hidden");
    pdfNextBtn.classList.add("hidden");
    pdfPageIndicator.classList.add("hidden");
    readerContent.classList.remove("hidden");
    if (currentText.kind === "epub" || currentText.kind === "url") {
      renderReaderBlocks(currentText.blocks);
    } else {
      renderReaderContent(currentText.content);
    }
    setBookmark(loadBookmark(currentText.id));
  }
}

backBtn.addEventListener("click", () => {
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

/* ---------- Selection popup ---------- */

function hidePopup() {
  popup.classList.add("hidden");
  explainPanel.classList.add("hidden");
  explainPanel.innerHTML = "";
}

const SENTENCE_BOUNDARY = /[.!?]/;
const MAX_CONTEXT_CHARS = 500;

// Given the full text of whatever's being read and a start/end character
// range within it, grow outward to the sentence boundaries around it (or
// fall back to a fixed window if that sentence is too long). Shared between
// the continuous text reader and the PDF reader, which each build `fullText`
// and the start/end offsets differently but hand off to this the same way.
function extractSentenceContext(fullText, start, end) {
  let ctxStart = start;
  while (ctxStart > 0 && !SENTENCE_BOUNDARY.test(fullText[ctxStart - 1])) ctxStart--;
  let ctxEnd = end;
  while (ctxEnd < fullText.length && !SENTENCE_BOUNDARY.test(fullText[ctxEnd])) ctxEnd++;
  if (ctxEnd < fullText.length) ctxEnd++; // include the boundary character

  let context = fullText.slice(ctxStart, ctxEnd).trim();

  if (context.length > MAX_CONTEXT_CHARS) {
    const mid = Math.floor((start + end) / 2);
    context = fullText.slice(Math.max(0, mid - 150), mid + 150).trim();
  }

  return context;
}

// True if the sentence starting at `end` never hits a `.`/`!`/`?` before
// running off the end of `fullText` — i.e. it looks cut off, not finished.
function sentenceRunsOffEnd(fullText, end) {
  let i = end;
  while (i < fullText.length && !SENTENCE_BOUNDARY.test(fullText[i])) i++;
  return i >= fullText.length;
}

// range.startOffset/endOffset are local to their text node, not global to
// `root` (which contains many text nodes) — walk the tree to translate a
// node-local offset into an offset global to `root`.
function globalTextOffset(root, node, localOffset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let current;
  while ((current = walker.nextNode())) {
    if (current === node) return total + localOffset;
    total += current.textContent.length;
  }
  return total + localOffset;
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

// Bumped on every selection. A slow response for an older selection must not
// overwrite the popup of a newer one; that happens easily when clicking
// through subtitles quickly.
let selectionToken = 0;

function errorText(payload, fallback) {
  return payload && typeof payload.detail === "string" ? payload.detail : fallback;
}

// Shared by the text reader, the PDF reader and the video reader: shows the
// popup at the current selection and fetches its translation.
async function handleTextSelection(phrase, context, rect) {
  const token = ++selectionToken;
  currentSelection = { phrase, context };

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
        source_lang: currentText.source_lang,
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

readerContent.addEventListener("mouseup", () => {
  const selection = window.getSelection();
  const phrase = selection.toString().trim();
  if (!phrase || selection.rangeCount === 0) {
    return;
  }
  const range = selection.getRangeAt(0);
  handleTextSelection(phrase, getSentenceContext(range), range.getBoundingClientRect());
});

/* ---------- PDF reader ---------- */

function pdfPageKey(textId) {
  return `lexplain-pdf-page-${textId}`;
}

function loadPdfPageNum(textId) {
  const v = localStorage.getItem(pdfPageKey(textId));
  return v === null ? 1 : parseInt(v, 10);
}

// Appends styled text runs ({text, italic, bold}) to `container`. A literal
// "\n" within a run's text (from an EPUB <br>) becomes a real <br> element,
// not just a character — used by both the PDF and EPUB renderers.
function appendRuns(container, runs, joinWithSpace) {
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

async function loadPdfPage(textId, num) {
  const res = await fetch(`/api/texts/${textId}/pdf-page/${num}`);
  if (!res.ok) {
    pdfPage.innerHTML = "";
    pdfPageIndicator.textContent = "";
    return;
  }
  const data = await res.json();

  pdfPageNum = data.page;
  pdfTotalPages = data.total_pages;
  pdfPage.innerHTML = "";
  for (const block of data.blocks) {
    pdfPage.appendChild(renderPdfBlock(block));
  }

  pdfPageIndicator.textContent = `${pdfPageNum} / ${pdfTotalPages}`;
  pdfPrevBtn.disabled = pdfPageNum <= 1;
  pdfNextBtn.disabled = pdfPageNum >= pdfTotalPages;
  localStorage.setItem(pdfPageKey(textId), String(pdfPageNum));
  hidePopup();
  window.scrollTo(0, 0);
}

pdfPrevBtn.addEventListener("click", () => {
  if (pdfPageNum > 1) loadPdfPage(currentText.id, pdfPageNum - 1);
});
pdfNextBtn.addEventListener("click", () => {
  if (pdfPageNum < pdfTotalPages) loadPdfPage(currentText.id, pdfPageNum + 1);
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

  let fullText = block.textContent;
  if (sentenceRunsOffEnd(fullText, end) && looksLikeBodyParagraph(block.nextElementSibling)) {
    fullText += " " + block.nextElementSibling.textContent;
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

explainBtn.addEventListener("click", async () => {
  if (!currentSelection) return;
  const token = selectionToken;
  const { phrase, context } = currentSelection;
  explainPanel.classList.remove("hidden");
  explainPanel.textContent = "Loading…";

  try {
    const res = await fetch("/api/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phrase,
        context,
        source_lang: currentText.source_lang,
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

document.addEventListener("mousedown", (e) => {
  const inSelectableArea = readerContent.contains(e.target) || pdfPage.contains(e.target);
  if (!popup.contains(e.target) && !inSelectableArea) {
    hidePopup();
  }
});


/* Video mode: YouTube IFrame player + subtitle cues synced to playback.
 *
 * Entry points used by openText / the Library button: openVideo(entry) and
 * closeVideo(). Cues are plain DOM rows built once; playback only toggles an
 * "active" class on one row, so a text selection inside the list survives
 * while the video keeps playing.
 *
 * The cues sit in a fixed-height window next to the player; the active one is
 * kept in its middle. Selecting cue text pauses the video and hands the phrase
 * plus a context of the selected cues and a few neighbours to
 * handleTextSelection(), which owns the translate popup and the Explain panel
 * for every reader.
 */

const videoReader = document.getElementById("video-reader");
const videoStage = document.getElementById("video-stage");
const videoPlayerBox = document.getElementById("video-player-box");
const videoError = document.getElementById("video-error");
const cueList = document.getElementById("cue-list");
const videoFollowBtn = document.getElementById("video-follow-btn");
const topbarEl = document.getElementById("topbar");

const VIDEO_POLL_MS = 250;
const CUE_GRACE_S = 1.0; // keep a cue highlighted this long after it ends
const SEEK_LOCK_MS = 600; // after a click-seek, don't let a stale poll flip the highlight back
const SAVE_POS_EVERY_MS = 5000;

const YT_ERROR_MESSAGES = {
  2: "YouTube rejected this video id.",
  5: "The YouTube player hit an error. Try again in a moment.",
  100: "This video was removed or is private.",
  101: "The owner of this video doesn't allow embedding it.",
  150: "The owner of this video doesn't allow embedding it.",
  153: "YouTube refused to embed the player: it needs the HTTP Referer header (a browser extension or privacy setting may be stripping it).",
};

let videoSession = 0; // bumped on every open/close; stale async work checks it
let vs = null; // state of the open video, null when closed

/* ---------- helpers ---------- */

function formatCueTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// Index of the cue to highlight at time t, or -1. Cues are sorted by start.
function findCueIndex(cues, t) {
  let lo = 0;
  let hi = cues.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx >= 0 && t > cues[idx].end + CUE_GRACE_S) return -1;
  return idx;
}

function videoPosKey(textId) {
  return `lexplain-video-pos-${textId}`;
}

function loadVideoPos(textId) {
  const v = parseInt(localStorage.getItem(videoPosKey(textId)), 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function saveVideoPos(t) {
  if (!vs) return;
  const lastEnd = vs.cues.length ? vs.cues[vs.cues.length - 1].end : 0;
  if (t < 3 || (lastEnd && t > lastEnd - 5)) {
    localStorage.removeItem(videoPosKey(vs.entry.id)); // not started, or finished
  } else {
    localStorage.setItem(videoPosKey(vs.entry.id), String(Math.floor(t)));
  }
}

/* ---------- YouTube IFrame API ---------- */

let ytApiPromise = null;

function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
    let timer = null;
    const fail = (err) => {
      clearTimeout(timer);
      ytApiPromise = null; // allow a retry on the next open
      reject(err);
    };
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      if (typeof previous === "function") previous();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      script.remove();
      fail(new Error("script failed to load"));
    };
    document.head.appendChild(script);
    timer = setTimeout(() => fail(new Error("timed out")), 15000);
  });
  return ytApiPromise;
}

/* ---------- rendering ---------- */

function renderCues(cues) {
  const fragment = document.createDocumentFragment();
  cues.forEach((cue, i) => {
    const row = document.createElement("div");
    row.className = "cue";
    row.dataset.index = i;

    const time = document.createElement("button");
    time.type = "button";
    time.className = "cue-time";
    time.tabIndex = -1; // a tab stop per cue would make the page unusable by keyboard
    time.textContent = formatCueTime(cue.start);
    time.setAttribute("aria-label", `Jump to ${formatCueTime(cue.start)}`);

    const text = document.createElement("span");
    text.className = "cue-text";
    text.textContent = cue.text; // never innerHTML: subtitles are untrusted input

    row.append(time, text);
    fragment.appendChild(row);
  });
  cueList.replaceChildren(fragment);
}

function showVideoError(message, videoId) {
  videoError.replaceChildren();
  const p = document.createElement("p");
  p.textContent = message;
  videoError.appendChild(p);
  if (videoId) {
    const a = document.createElement("a");
    a.href = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "Watch on YouTube";
    videoError.appendChild(a);
  }
  videoError.classList.remove("hidden");
}

function hideVideoError() {
  videoError.classList.add("hidden");
  videoError.replaceChildren();
}

/* ---------- active cue + scrolling ---------- */

// The player and the cue window are sized from the viewport height (see
// style.css), which needs the topbar's real height.
function syncTopbarHeight() {
  document.documentElement.style.setProperty("--topbar-h", `${topbarEl.offsetHeight}px`);
}

// The cue list is a fixed-height window; keep the cue in its middle, lyrics
// style, so the previous and next cues stay visible around it.
function centerCue(el, smooth) {
  const top = el.offsetTop - (cueList.clientHeight - el.offsetHeight) / 2;
  cueList.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
}

function setActiveCue(index) {
  if (!vs || index === vs.activeIndex) return;
  const prev = vs.activeIndex >= 0 ? cueList.children[vs.activeIndex] : null;
  if (prev) {
    prev.classList.remove("active");
    prev.removeAttribute("aria-current");
  }
  vs.activeIndex = index;
  const el = index >= 0 ? cueList.children[index] : null;
  if (el) {
    el.classList.add("active");
    el.setAttribute("aria-current", "true");
    if (vs.autoScroll && !vs.selecting) centerCue(el, true);
  }
}

// "Follow playback" appears when the user has scrolled the window so far that
// the active cue is out of sight.
function updateFollowButton() {
  let show = false;
  let arrow = "↓";
  if (vs && !vs.autoScroll && vs.activeIndex >= 0) {
    const el = cueList.children[vs.activeIndex];
    const top = el.offsetTop - cueList.scrollTop;
    const bottom = top + el.offsetHeight;
    if (bottom < 8) {
      show = true;
      arrow = "↑";
    } else if (top > cueList.clientHeight - 8) {
      show = true;
    }
  }
  videoFollowBtn.classList.toggle("hidden", !show);
  if (show) videoFollowBtn.textContent = `${arrow} Follow playback`;
}

function playerTime() {
  if (!vs || !vs.player || typeof vs.player.getCurrentTime !== "function") return null;
  const t = vs.player.getCurrentTime();
  return Number.isFinite(t) ? t : null;
}

function videoTick() {
  const t = playerTime();
  if (t === null) return;
  if (performance.now() >= vs.seekLockUntil) setActiveCue(findCueIndex(vs.cues, t));
  updateFollowButton();
  if (performance.now() - vs.lastSavedAt > SAVE_POS_EVERY_MS) {
    vs.lastSavedAt = performance.now();
    saveVideoPos(t);
  }
}

function seekToCue(index) {
  if (!vs || !vs.player || typeof vs.player.seekTo !== "function") return;
  const cue = vs.cues[index];
  if (!cue) return;
  vs.player.seekTo(cue.start, true);
  vs.player.playVideo();
  vs.autoScroll = true;
  vs.seekLockUntil = performance.now() + SEEK_LOCK_MS;
  setActiveCue(index);
}

/* ---------- player events ---------- */

function onPlayerReady(session) {
  if (session !== videoSession || !vs) return;
  if (vs.startAt > 0) {
    // Resuming: show the cue we resume at in the middle, without animation, and
    // don't let a poll that still reports 0:00 right after start undo it.
    vs.seekLockUntil = performance.now() + SEEK_LOCK_MS * 2;
    const el = cueList.children[findCueIndex(vs.cues, vs.startAt)];
    if (el) centerCue(el, false);
  }
  vs.pollTimer = setInterval(videoTick, VIDEO_POLL_MS);
  videoTick();
}

function onPlayerState(session, state) {
  if (session !== videoSession || !vs) return;
  // PLAYING after a pause/start/end resumes following; PLAYING after buffering
  // does not, so a stall doesn't undo the user scrolling ahead.
  const resumed = state === 1 && [-1, 0, 2, 5].includes(vs.lastState);
  if (resumed) vs.autoScroll = true;
  vs.lastState = state;
  if (state === 1 || state === 2) videoTick();
}

function onPlayerError(session, code) {
  if (session !== videoSession || !vs) return;
  showVideoError(YT_ERROR_MESSAGES[code] || `YouTube player error ${code}.`, vs.entry.video_id);
}

/* ---------- open / close ---------- */

function createPlayer(session) {
  const mount = document.createElement("div");
  videoPlayerBox.replaceChildren(mount);
  const playerVars = { playsinline: 1, rel: 0 };
  if (vs.startAt > 0) playerVars.start = vs.startAt;
  if (window.location.protocol.startsWith("http")) playerVars.origin = window.location.origin;

  vs.player = new YT.Player(mount, {
    videoId: vs.entry.video_id,
    width: "100%",
    height: "100%",
    playerVars,
    events: {
      onReady: () => onPlayerReady(session),
      onStateChange: (e) => onPlayerState(session, e.data),
      onError: (e) => onPlayerError(session, e.data),
    },
  });
}

function attachScrollIntent(signal) {
  // Wheel, touch and a press on the list's own scrollbar are the user moving
  // the window; our smooth scrolling triggers none of them, so scroll events
  // alone can't tell the two apart.
  const stop = () => {
    if (vs) vs.autoScroll = false;
  };
  window.addEventListener("resize", syncTopbarHeight, { signal });
  cueList.addEventListener("wheel", stop, { passive: true, signal });
  cueList.addEventListener("touchmove", stop, { passive: true, signal });
  cueList.addEventListener(
    "pointerdown",
    (e) => {
      if (e.target === cueList) stop(); // scrollbar or padding, not a cue
    },
    { signal }
  );
  // Selecting text inside the list also pauses following, until it's cleared.
  document.addEventListener(
    "selectionchange",
    () => {
      if (!vs) return;
      const sel = window.getSelection();
      vs.selecting = !!sel && !sel.isCollapsed && sel.rangeCount > 0 && cueList.contains(sel.anchorNode);
    },
    { signal }
  );
}

async function openVideo(entry) {
  closeVideo();
  const session = ++videoSession;
  const cues = Array.isArray(entry.segments) ? entry.segments : [];
  vs = {
    entry,
    cues,
    player: null,
    activeIndex: -1,
    autoScroll: true,
    selecting: false,
    lastState: -1,
    seekLockUntil: 0,
    lastSavedAt: performance.now(),
    startAt: loadVideoPos(entry.id),
    pollTimer: null,
    abort: new AbortController(),
  };

  hideVideoError();
  renderCues(cues);
  videoReader.classList.remove("hidden");
  syncTopbarHeight();
  attachScrollIntent(vs.abort.signal);
  if (vs.startAt > 0) setActiveCue(findCueIndex(cues, vs.startAt));

  try {
    await loadYouTubeApi();
  } catch (e) {
    if (session === videoSession) {
      showVideoError("Couldn't load the YouTube player (offline, or blocked by an extension). The subtitles below still work.", entry.video_id);
    }
    return;
  }
  if (session !== videoSession) return; // closed while the API was loading
  createPlayer(session);
}

function closeVideo() {
  videoSession++;
  const state = vs;
  vs = null;
  if (state) {
    clearInterval(state.pollTimer);
    state.abort.abort();
    if (state.player && typeof state.player.getCurrentTime === "function") {
      vs = state; // saveVideoPos reads vs
      try {
        saveVideoPos(state.player.getCurrentTime());
      } catch (e) {
        /* player already gone */
      }
      vs = null;
    }
    try {
      if (state.player && typeof state.player.destroy === "function") state.player.destroy();
    } catch (e) {
      /* ignore */
    }
  }
  videoPlayerBox.replaceChildren();
  cueList.replaceChildren();
  hideVideoError();
  videoFollowBtn.classList.add("hidden");
  videoReader.classList.add("hidden");
}

/* ---------- selection -> translate / explain ---------- */

// Subtitles are short (often a single word is selected), so give the model more
// to go on than a text reader does: this many cues around the selection, up to
// this many characters (llm.py cuts the context at 800).
const CONTEXT_CUES_EACH_SIDE = 4;
const VIDEO_MAX_CONTEXT_CHARS = 700;

// Context for the LLM: the selected cues plus CONTEXT_CUES_EACH_SIDE on each
// side, cut to maxChars. When too long, the outermost context cues go first
// (from the side with more of them), so the selected cues are kept whole.
// Only if the selected cues alone exceed the limit is their text cut, around
// its middle.
function buildVideoContext(cues, first, last, maxChars, radius = CONTEXT_CUES_EACH_SIDE) {
  let lo = Math.max(0, first - radius);
  let hi = Math.min(cues.length - 1, last + radius);
  const join = () => cues.slice(lo, hi + 1).map((c) => c.text).join(" ");
  let text = join();
  while (text.length > maxChars && (lo < first || hi > last)) {
    if (first - lo >= hi - last && lo < first) lo++;
    else hi--;
    text = join();
  }
  if (text.length > maxChars) {
    const start = Math.max(0, (text.length >> 1) - (maxChars >> 1));
    text = text.slice(start, start + maxChars);
  }
  return text.trim();
}

// Index of the cue a range boundary sits in. A boundary can also sit between
// rows (offset inside #cue-list itself) or outside the list (null).
function cueBoundaryIndex(node, offset, isEnd) {
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const row = el && el.closest ? el.closest(".cue") : null;
  if (row) return Number(row.dataset.index);
  if (el === cueList) {
    const i = isEnd ? offset - 1 : offset;
    return Math.min(Math.max(i, 0), cueList.children.length - 1);
  }
  return null;
}

// The part of `range` inside one cue's text (timestamps excluded), with
// whitespace normalised. Empty when the range only touches the row's edge,
// which is what a triple-click leaves at the start of the next row.
function selectedTextInCue(range, row) {
  const textEl = row.querySelector(".cue-text");
  if (!textEl) return "";
  const bounds = document.createRange();
  bounds.selectNodeContents(textEl);
  const clipped = range.cloneRange();
  if (clipped.compareBoundaryPoints(Range.START_TO_START, bounds) < 0) {
    clipped.setStart(bounds.startContainer, bounds.startOffset);
  }
  if (clipped.compareBoundaryPoints(Range.END_TO_END, bounds) > 0) {
    clipped.setEnd(bounds.endContainer, bounds.endOffset);
  }
  return clipped.toString().replace(/\s+/g, " ").trim();
}

// {phrase, first, last} for the cues a range covers, or null when it covers
// no cue text. The phrase is assembled from the cues' own text instead of
// selection.toString(), so it never contains timestamps or row line breaks.
function readVideoSelection(range) {
  const n = cueList.children.length;
  if (!n) return null;
  const a = cueBoundaryIndex(range.startContainer, range.startOffset, false);
  const b = cueBoundaryIndex(range.endContainer, range.endOffset, true);
  // A boundary outside the list (drag released elsewhere): scan every row.
  const from = a !== null && b !== null ? Math.min(a, b) : 0;
  const to = a !== null && b !== null ? Math.max(a, b) : n - 1;

  const parts = [];
  let first = -1;
  let last = -1;
  for (let i = from; i <= to; i++) {
    const text = selectedTextInCue(range, cueList.children[i]);
    if (!text) continue;
    if (first < 0) first = i;
    last = i;
    parts.push(text);
  }
  return parts.length ? { phrase: parts.join(" "), first, last } : null;
}

function handleVideoSelection() {
  if (!vs) return;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const picked = readVideoSelection(range);
  if (!picked) return;

  // Pause so the sentence stays put while it is being read.
  if (vs.player && typeof vs.player.pauseVideo === "function") vs.player.pauseVideo();

  const context = buildVideoContext(vs.cues, picked.first, picked.last, VIDEO_MAX_CONTEXT_CHARS);
  handleTextSelection(picked.phrase, context, range.getBoundingClientRect());
}

/* ---------- static listeners (registered once) ---------- */

cueList.addEventListener("click", (e) => {
  const button = e.target.closest(".cue-time");
  if (!button) return;
  seekToCue(Number(button.closest(".cue").dataset.index));
});

// Selecting is mousedown in the list ... mouseup anywhere (the drag may end
// outside it). Requiring the mousedown also keeps clicks on the popup's own
// buttons from re-running the translation for the still-selected text.
let videoPointerDown = false;
cueList.addEventListener("mousedown", (e) => {
  if (e.button === 0) videoPointerDown = true;
});
document.addEventListener(
  "mousedown",
  (e) => {
    if (!cueList.contains(e.target)) videoPointerDown = false;
  },
  true
);
document.addEventListener("mouseup", () => {
  if (!videoPointerDown) return;
  videoPointerDown = false;
  handleVideoSelection();
});

videoFollowBtn.addEventListener("click", () => {
  if (!vs || vs.activeIndex < 0) return;
  vs.autoScroll = true;
  centerCue(cueList.children[vs.activeIndex], true);
  videoFollowBtn.classList.add("hidden");
});

document.getElementById("back-btn").addEventListener("click", closeVideo);

loadLibrary();
