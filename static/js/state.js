// What's open and selected right now, shared between the modules.
export const state = {
  currentText: null, // {id, title, source_lang, kind, ...} as /api/texts/{id} returns it
  currentSelection: null, // {phrase, context}
};
