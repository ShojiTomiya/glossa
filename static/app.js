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

let uploadMode = "file";

function setUploadMode(mode) {
  uploadMode = mode;
  const isFile = mode === "file";

  fileField.classList.toggle("hidden", !isFile);
  urlField.classList.toggle("hidden", isFile);
  uploadModeFileBtn.classList.toggle("btn-primary", isFile);
  uploadModeUrlBtn.classList.toggle("btn-primary", !isFile);
  uploadModeFileBtn.setAttribute("aria-pressed", String(isFile));
  uploadModeUrlBtn.setAttribute("aria-pressed", String(!isFile));

  fileInput.required = isFile;
  urlInput.required = !isFile;
  // Title is auto-filled from the page when importing a link, so don't force it.
  titleInput.required = isFile;
}

uploadModeFileBtn.addEventListener("click", () => setUploadMode("file"));
uploadModeUrlBtn.addEventListener("click", () => setUploadMode("url"));

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = titleInput.value;
  const sourceLang = document.getElementById("source-lang-input").value;

  let res;
  if (uploadMode === "file") {
    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title);
    formData.append("source_lang", sourceLang);
    res = await fetch("/api/upload", { method: "POST", body: formData });
  } else {
    res = await fetch("/api/import-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: urlInput.value, title: title || null, source_lang: sourceLang }),
    });
  }

  if (!res.ok) {
    const err = await res.json();
    alert(err.detail || "Import failed");
    return;
  }
  uploadForm.reset();
  setUploadMode("file");
  uploadDialog.close();
  loadLibrary();
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
    renderReaderContent(currentText.content);
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

// Shared by the text reader and the PDF reader: shows the popup at the
// current selection and fetches its translation.
async function handleTextSelection(phrase, context, rect) {
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
    if (!res.ok) {
      popupTranslation.textContent = data.detail || "Translation error";
      return;
    }
    popupTranslation.textContent = data.translation;
  } catch (e) {
    popupTranslation.textContent = "Translation error";
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

function appendRuns(container, runs, joinWithSpace) {
  runs.forEach((run, i) => {
    if (joinWithSpace && i > 0) container.appendChild(document.createTextNode(" "));
    if (run.italic) {
      const em = document.createElement("i");
      em.textContent = run.text;
      container.appendChild(em);
    } else {
      container.appendChild(document.createTextNode(run.text));
    }
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

// Mirrors getSentenceContext, but scoped to the single block the selection
// started in (a real PDF paragraph/heading/footnote) instead of the whole
// page — context never bleeds across blocks, and there's no huge document
// tree to walk.
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

  return extractSentenceContext(block.textContent, start, end) || range.toString();
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
  explainPanel.classList.remove("hidden");
  explainPanel.innerHTML = "Loading…";

  try {
    const res = await fetch("/api/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phrase: currentSelection.phrase,
        context: currentSelection.context,
        source_lang: currentText.source_lang,
        target_lang: targetLangSelect.value,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      explainPanel.innerHTML = `Error: ${err.detail || res.statusText}`;
      return;
    }
    const data = await res.json();
    renderExplain(data);
  } catch (e) {
    explainPanel.innerHTML = "Explain error";
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

loadLibrary();
