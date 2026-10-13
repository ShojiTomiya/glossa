import { readerView } from "./dom.js";

const FONT_STACKS = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'Georgia, "Iowan Old Style", Charter, "Times New Roman", serif',
};

const settingsDialog = document.getElementById("settings-dialog");
const settingsBtn = document.getElementById("settings-btn");
const settingsCloseBtn = document.getElementById("settings-close-btn");
const fontFamilySelect = document.getElementById("font-family-select");
const fontSizeSelect = document.getElementById("font-size-select");
const fontSettingsFieldset = document.getElementById("font-settings-fieldset");

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
