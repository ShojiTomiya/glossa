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

const settingsDialog = document.getElementById("settings-dialog");
const settingsBtn = document.getElementById("settings-btn");
const settingsCloseBtn = document.getElementById("settings-close-btn");
const fontFamilySelect = document.getElementById("font-family-select");
const fontSizeSelect = document.getElementById("font-size-select");
const fontSettingsFieldset = document.getElementById("font-settings-fieldset");

let currentText = null; // {id, title, source_lang, content}
let currentSelection = null; // {phrase, context}
let allTexts = [];

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
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      await fetch(`/api/texts/${t.id}`, { method: "DELETE" });
      loadLibrary();
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

/* ---------- Upload dialog ---------- */

uploadOpenBtn.addEventListener("click", () => uploadDialog.showModal());
uploadCancelBtn.addEventListener("click", () => uploadDialog.close());

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = document.getElementById("file-input").files[0];
  const title = document.getElementById("title-input").value;
  const sourceLang = document.getElementById("source-lang-input").value;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("title", title);
  formData.append("source_lang", sourceLang);

  const res = await fetch("/api/upload", { method: "POST", body: formData });
  if (!res.ok) {
    const err = await res.json();
    alert(err.detail || "Upload failed");
    return;
  }
  uploadForm.reset();
  uploadDialog.close();
  loadLibrary();
});

/* ---------- View switching ---------- */

async function openText(id) {
  const res = await fetch(`/api/texts/${id}`);
  currentText = await res.json();
  readerTitle.textContent = currentText.title;
  readerContent.textContent = currentText.content;

  // default target lang: first language != source_lang, preferring English
  const options = [...targetLangSelect.options].map((o) => o.value);
  const preferred = options.includes("en") && currentText.source_lang !== "en" ? "en" : options.find((o) => o !== currentText.source_lang);
  targetLangSelect.value = preferred;

  libraryView.style.display = "none";
  readerView.style.display = "block";
  brand.style.display = "none";
  topbarReaderActions.style.display = "flex";
  hidePopup();
}

backBtn.addEventListener("click", () => {
  readerView.style.display = "none";
  libraryView.style.display = "block";
  topbarReaderActions.style.display = "none";
  brand.style.display = "block";
  loadLibrary();
});

/* ---------- Selection popup ---------- */

function hidePopup() {
  popup.classList.add("hidden");
  explainPanel.classList.add("hidden");
  explainPanel.innerHTML = "";
}

const SENTENCE_BOUNDARY = /[.!?\n]/;
const MAX_CONTEXT_CHARS = 500;

function getSentenceContext(range) {
  const fullText = readerContent.textContent;
  const startNode = range.startContainer;
  const endNode = range.endContainer;

  if (startNode.nodeType !== Node.TEXT_NODE || endNode.nodeType !== Node.TEXT_NODE) {
    return range.toString();
  }

  let start = range.startOffset;
  let end = range.endOffset;

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

  return context || range.toString();
}

readerContent.addEventListener("mouseup", async () => {
  const selection = window.getSelection();
  const phrase = selection.toString().trim();
  if (!phrase || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const context = getSentenceContext(range);

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
        source_lang: currentText.source_lang,
        target_lang: targetLangSelect.value,
      }),
    });
    const data = await res.json();
    popupTranslation.textContent = data.translation;
  } catch (e) {
    popupTranslation.textContent = "Translation error";
  }
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

  if (data.translation) {
    const translation = document.createElement("div");
    translation.className = "explain-translation";
    translation.textContent = data.translation;
    explainPanel.appendChild(translation);
  }

  if (Array.isArray(data.words) && data.words.length) {
    const table = document.createElement("table");
    table.className = "words-table";
    for (const w of data.words) {
      const row = document.createElement("tr");
      const text = document.createElement("td");
      text.className = "word-text";
      text.textContent = w.text || "";
      const details = document.createElement("td");
      details.className = "word-details";
      details.textContent = [w.base_form, w.part_of_speech, w.grammatical_details]
        .filter(Boolean)
        .join(" · ");
      row.appendChild(text);
      row.appendChild(details);
      table.appendChild(row);
    }
    explainPanel.appendChild(table);
  }

  if (data.explanation) {
    const explanation = document.createElement("p");
    explanation.className = "explain-text";
    explanation.textContent = data.explanation;
    explainPanel.appendChild(explanation);
  }

  if (data.example) {
    const example = document.createElement("div");
    example.className = "explain-example";
    example.textContent = data.example;
    explainPanel.appendChild(example);
  }
}

document.addEventListener("mousedown", (e) => {
  if (!popup.contains(e.target) && e.target !== readerContent && !readerContent.contains(e.target)) {
    hidePopup();
  }
});

loadLibrary();
