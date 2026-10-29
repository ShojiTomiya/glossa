// Elements used by more than one module. Ones that belong to a single
// module (dialogs, the video reader, ...) are looked up there.

export const brand = document.getElementById("brand");
export const topbarReaderActions = document.getElementById("topbar-reader-actions");
export const libraryView = document.getElementById("library-view");
export const readerView = document.getElementById("reader-view");
export const readerTitle = document.getElementById("reader-title");
export const readerContent = document.getElementById("reader-content");
export const targetLangSelect = document.getElementById("target-lang-select");
export const backBtn = document.getElementById("back-btn");
export const bookmarkJumpBtn = document.getElementById("bookmark-jump-btn");
export const pdfReader = document.getElementById("pdf-reader");
export const pdfPage = document.getElementById("pdf-page");
export const pagePrevBtn = document.getElementById("page-prev-btn");
export const pageNextBtn = document.getElementById("page-next-btn");
export const pageIndicator = document.getElementById("page-indicator");
export const popup = document.getElementById("popup");
export const popupTranslation = document.getElementById("popup-translation");
export const explainBtn = document.getElementById("explain-btn");
export const explainPanel = document.getElementById("explain-panel");
export const bookReader = document.getElementById("book-reader");
export const bookViewport = document.getElementById("book-viewport");
export const bookContent = document.getElementById("book-content");

// Phone-sized: the layout of mobile.css (same width as its media query in
// index.html), the translation panel, reading mode only for PDFs.
export const narrowScreen = window.matchMedia("(max-width: 700px)");
