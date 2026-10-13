const SENTENCE_BOUNDARY = /[.!?]/;
const MAX_CONTEXT_CHARS = 500;

// Given the full text of whatever's being read and a start/end character
// range within it, grow outward to the sentence boundaries around it (or
// fall back to a fixed window if that sentence is too long). Shared between
// the continuous text reader and the PDF reader, which each build `fullText`
// and the start/end offsets differently but hand off to this the same way.
export function extractSentenceContext(fullText, start, end) {
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
export function sentenceRunsOffEnd(fullText, end) {
  let i = end;
  while (i < fullText.length && !SENTENCE_BOUNDARY.test(fullText[i])) i++;
  return i >= fullText.length;
}

// range.startOffset/endOffset are local to their text node, not global to
// `root` (which contains many text nodes) — walk the tree to translate a
// node-local offset into an offset global to `root`.
export function globalTextOffset(root, node, localOffset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let current;
  while ((current = walker.nextNode())) {
    if (current === node) return total + localOffset;
    total += current.textContent.length;
  }
  return total + localOffset;
}
