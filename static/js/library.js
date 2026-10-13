const LANG_NAMES = { de: "German", es: "Spanish", it: "Italian", fr: "French", en: "English", pl: "Polish" };

// Same names as the type filter in index.html.
const KIND_NAMES = { pdf: "PDF", epub: "EPUB", url: "Article", video: "Video" };

const textList = document.getElementById("text-list");
const filterLangSelect = document.getElementById("filter-lang-select");
const filterKindSelect = document.getElementById("filter-kind-select");

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

let allTexts = [];
let openHandler = null; // main.js's openText, set through initLibrary()

export function initLibrary(onOpen) {
  openHandler = onOpen;
}

/* ---------- Library ---------- */

export async function loadLibrary() {
  const res = await fetch("/api/texts");
  allTexts = await res.json();
  renderLibrary();
}

function renderLibrary() {
  const lang = filterLangSelect.value;
  const kind = filterKindSelect.value;
  const texts = allTexts.filter((t) => (!lang || t.source_lang === lang) && (!kind || t.kind === kind));

  textList.innerHTML = "";
  for (const t of texts) {
    const li = document.createElement("li");

    const label = document.createElement("span");
    label.textContent = t.title;
    label.addEventListener("click", () => openHandler(t.id));

    const badge = document.createElement("span");
    badge.className = "text-lang-badge";
    badge.textContent = LANG_NAMES[t.source_lang] || t.source_lang.toUpperCase();
    label.appendChild(badge);
    const kindBadge = document.createElement("span");
    kindBadge.className = "text-kind-badge";
    kindBadge.textContent = KIND_NAMES[t.kind] || t.kind;
    if (t.kind === "video" && t.subtitle_source === "auto") kindBadge.textContent += " · auto subs";
    label.appendChild(kindBadge);

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
filterKindSelect.addEventListener("change", renderLibrary);

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
    // type="url" would reject "youtu.be/..." without a scheme or a bare video
    // id, both of which the server's parse_video_id accepts.
    urlInput.type = mode === "video" ? "text" : "url";
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
