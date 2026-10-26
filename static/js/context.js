const SENTENCE_BOUNDARY = /[.!?]/;

// What a selection is sent to the model with. The cost hardly matters (the
// Explain prompt alone is ~1500 tokens; a few sentences add ~100), so the
// context is shaped by meaning: the selected sentence plus its neighbours,
// which often settle what a pronoun or an ambiguous word refers to.
const SENTENCES_BEFORE = 1;
const SENTENCES_AFTER = 1;
// Only a safety net for extreme cases (a sentence running for pages): the
// text around the selection is then cut to this length. The video reader
// uses it for its subtitle lines too. llm.py caps requests a bit higher.
export const MAX_CONTEXT_CHARS = 1500;

// Start of the sentence holding `pos`, or of the one `extra` sentences
// before it.
function sentenceStart(text, pos, extra) {
  let i = pos;
  for (let n = 0; ; n++) {
    while (i > 0 && !SENTENCE_BOUNDARY.test(text[i - 1])) i--;
    if (n === extra || i === 0) return i;
    i--; // onto the previous sentence's own end ("...", "?!" as one)
    while (i > 0 && SENTENCE_BOUNDARY.test(text[i - 1])) i--;
  }
}

// End (past its terminator) of the sentence holding `pos`, or of the one
// `extra` sentences after it.
function sentenceEnd(text, pos, extra) {
  let i = pos;
  for (let n = 0; ; n++) {
    while (i < text.length && !SENTENCE_BOUNDARY.test(text[i])) i++;
    while (i < text.length && SENTENCE_BOUNDARY.test(text[i])) i++;
    if (n === extra || i >= text.length) return i;
  }
}

// MAX_CONTEXT_CHARS of text centred on the selection, cut at word boundaries.
function windowAround(text, start, end) {
  const centre = Math.floor((start + end) / 2);
  let from = Math.max(0, centre - Math.floor(MAX_CONTEXT_CHARS / 2));
  const to = Math.min(text.length, from + MAX_CONTEXT_CHARS);
  from = Math.max(0, to - MAX_CONTEXT_CHARS);
  let piece = text.slice(from, to);
  if (from > 0) piece = piece.replace(/^\S*\s/, "");
  if (to < text.length) piece = piece.replace(/\s\S*$/, "");
  return piece;
}

// Given the full text of whatever's being read and a start/end character
// range within it: the sentence around the range plus SENTENCES_BEFORE /
// SENTENCES_AFTER neighbours. If that's over MAX_CONTEXT_CHARS, just the
// sentence; if even that is, a window around the selection. Shared by the
// article, PDF and book readers, which each build `fullText` their own way.
export function extractSentenceContext(fullText, start, end) {
  for (const [before, after] of [[SENTENCES_BEFORE, SENTENCES_AFTER], [0, 0]]) {
    const context = fullText.slice(sentenceStart(fullText, start, before), sentenceEnd(fullText, end, after)).trim();
    if (context.length <= MAX_CONTEXT_CHARS) return context;
  }
  return windowAround(fullText, start, end).trim();
}

// Joins two pieces of text that a page or block break separated. A word
// hyphenated across the break ("acomo-" + "dada") is joined back together.
// Returns the joined text and the offset that maps a position in `b` to one
// in the joined text (whitespace at the seam is dropped, so it can be off by
// the trimmed amount for positions inside that whitespace only).
function joinText(a, b) {
  const left = a.replace(/\s+$/, "");
  const lead = b.length - b.replace(/^\s+/, "").length;
  const right = b.slice(lead);
  if (/\p{L}-$/u.test(left) && /^\p{Ll}/u.test(right)) return [left.slice(0, -1) + right, left.length - 1 - lead];
  return [`${left} ${right}`, left.length + 1 - lead];
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

/* ---------- context across blocks (PDF pages, EPUB chapters) ---------- */

// Each block of the PDF and EPUB readers carries data-role: "body" for text a
// sentence can continue into, "skip" for what may sit in between (pictures,
// running header/footer, footnotes), "stop" for anything that ends a
// paragraph (a heading, a title line). Elements without one count as "stop".
const PAGE_EDGE = Symbol("page edge");

// Text of the nearest body block before/after `el`; null when a "stop" block
// comes first; PAGE_EDGE when there are no more blocks.
function neighbourText(el, forward) {
  const step = (n) => (forward ? n.nextElementSibling : n.previousElementSibling);
  for (let n = step(el); n; n = step(n)) {
    const role = n.dataset.role || "stop";
    if (role === "skip") continue;
    return role === "body" ? n.textContent : null;
  }
  return PAGE_EDGE;
}

// Context for a selection (see extractSentenceContext), from the block (a
// paragraph, heading, footnote) the selection starts in plus the nearest
// body block on either side, so the sentence — and its neighbours — can
// carry on over a paragraph break, a picture or a footnote. At the edge of
// what's shown, `pages` (the PDF reader's {before(), after()}) supplies the
// neighbouring page's last/first body text; a book chapter is all in the
// page anyway.
export function getBlockContext(range, pages = null) {
  const startNode = range.startContainer;
  const endNode = range.endContainer;
  if (startNode.nodeType !== Node.TEXT_NODE || endNode.nodeType !== Node.TEXT_NODE) {
    return range.toString();
  }

  const block = startNode.parentElement.closest(".pblock");
  if (!block) return range.toString();

  const start = globalTextOffset(block, startNode, range.startOffset);
  const end = globalTextOffset(block, endNode, range.endOffset);
  let text = block.textContent;
  let offset = 0; // where the block's own text starts in `text`

  let after = neighbourText(block, true);
  if (after === PAGE_EDGE) after = pages ? pages.after() : null;
  if (after) text = joinText(text, after)[0];

  let before = neighbourText(block, false);
  if (before === PAGE_EDGE) before = pages ? pages.before() : null;
  if (before) [text, offset] = joinText(before, text);

  // PDF text often has doubled spaces where runs meet; they mean nothing here.
  const context = extractSentenceContext(text, offset + start, offset + end);
  return context ? context.replace(/\s+/g, " ") : range.toString();
}
