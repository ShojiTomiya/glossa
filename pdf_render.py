"""Turns a PDF page into a JSON-friendly list of text blocks for the reader.

Unlike extract.py (which flattens a document into plain text), this keeps
each page's blocks as PyMuPDF found them — paragraphs, headers, footers,
footnotes — and carries over just enough of their own formatting (relative
font size, bold/italic, muted color, left/center/right position) for the
frontend to render them distinguishably, without deciding what any of them
*mean*. Nothing is filtered out or reordered.
"""

import fitz

FLAG_ITALIC = 2
FLAG_BOLD = 16


def get_page_count(path: str) -> int:
    with fitz.open(path) as doc:
        return len(doc)


def has_extractable_text(path: str) -> bool:
    with fitz.open(path) as doc:
        return any(page.get_text().strip() for page in doc)


def _lines_same_row(a: dict, b: dict) -> bool:
    """True only if the lines' vertical centers are close together — not
    merely if their boxes touch. Two genuinely side-by-side lines (e.g. a
    title on the left, an author on the right) share almost the same
    baseline. Ordinary consecutive lines in a paragraph often have boxes
    that touch or slightly overlap too (descenders like g/y/p dipping into
    the next line's box at tight leading), but their *centers* are a full
    line-height apart — comparing centers instead of raw overlap avoids
    misreading normal stacked text as side-by-side columns."""
    ay0, ay1 = a["bbox"][1], a["bbox"][3]
    by0, by1 = b["bbox"][1], b["bbox"][3]
    a_center, b_center = (ay0 + ay1) / 2, (by0 + by1) / 2
    tolerance = min(ay1 - ay0, by1 - by0) * 0.5
    return abs(a_center - b_center) <= tolerance


def _group_rows(lines: list) -> list[list]:
    """Lines that physically sit side by side become one row; ordinary
    stacked paragraph lines each get their own row of size 1. Pure
    geometry, no guessing what the text means."""
    rows: list[list] = []
    for line in sorted(lines, key=lambda l: l["bbox"][1]):
        for row in rows:
            if any(_lines_same_row(line, other) for other in row):
                row.append(line)
                break
        else:
            rows.append([line])
    for row in rows:
        row.sort(key=lambda l: l["bbox"][0])
    return rows


def _runs(spans: list, block_italic: bool) -> list[dict]:
    return [
        {"text": s["text"], "italic": bool(s["flags"] & FLAG_ITALIC) and not block_italic}
        for s in spans
        if s["text"]
    ]


_body_size_cache: dict[str, float] = {}


def _document_body_size(path: str) -> float:
    """The font size used for ordinary paragraph text, voted for by
    character count across the *whole document* — not just the current
    page. A single page's vote can be misleading (e.g. a page holding one
    short sentence plus a very long footnote: the footnote has more total
    characters and would "win", making the actual body text look enlarged
    and the footnote look normal-sized). Cached per file since it requires
    scanning every page once.
    """
    if path in _body_size_cache:
        return _body_size_cache[path]

    votes: dict[float, int] = {}
    with fitz.open(path) as doc:
        for page in doc:
            for block in page.get_text("dict")["blocks"]:
                if block.get("type") != 0:
                    continue
                for line in block["lines"]:
                    for span in line["spans"]:
                        key = round(span["size"], 1)
                        votes[key] = votes.get(key, 0) + len(span["text"])

    body_size = max(votes, key=votes.get) if votes else 12.0
    _body_size_cache[path] = body_size
    return body_size


def render_page(path: str, page_num: int) -> dict:
    """page_num is 1-indexed."""
    with fitz.open(path) as doc:
        if not 1 <= page_num <= len(doc):
            raise ValueError(f"Page {page_num} out of range (document has {len(doc)} pages)")

        page = doc[page_num - 1]
        d = page.get_text("dict")
        page_w = page.rect.width
        body_size = _document_body_size(path)

        # PyMuPDF's block list isn't guaranteed to be in visual top-to-bottom
        # order — headers/footers in particular can show up out of sequence.
        # Sort by top position so the reader always sees them in reading order.
        ordered_blocks = sorted(d["blocks"], key=lambda b: b["bbox"][1])

        blocks_out = []
        for bi, block in enumerate(ordered_blocks):
            if block.get("type") != 0:
                continue
            all_spans = [s for line in block["lines"] for s in line["spans"]]
            if not all_spans or not "".join(s["text"] for s in all_spans).strip():
                continue

            rep = max(all_spans, key=lambda s: len(s["text"]))
            rel_size = round(rep["size"] / body_size, 2) if body_size else 1.0
            is_bold = bool(rep["flags"] & FLAG_BOLD)
            is_italic = bool(rep["flags"] & FLAG_ITALIC)
            r, g, b = (rep["color"] >> 16) & 255, (rep["color"] >> 8) & 255, rep["color"] & 255
            is_muted = (r, g, b) != (0, 0, 0) and max(r, g, b) - min(r, g, b) < 20 and r > 40

            bx0, by0, bx1, by1 = block["bbox"]
            block_w = bx1 - bx0
            left_margin, right_margin = bx0, page_w - bx1
            # Real typesetting rarely centers text pixel-perfectly (e.g. a
            # page number anchored at a fixed start point sits slightly
            # further right once it grows from 1 to 2 digits) — a generous
            # tolerance avoids such minor asymmetry reading as "left".
            if block_w < page_w * 0.6 and abs(left_margin - right_margin) < page_w * 0.15:
                align = "center"
            elif right_margin < left_margin * 0.5:
                align = "right"
            else:
                align = "left"

            rows = _group_rows(block["lines"])
            kind = "paragraph" if all(len(row) == 1 for row in rows) else "rows"

            blocks_out.append({
                "id": f"{page_num}-{bi}",
                "kind": kind,
                "align": align,
                "rel_size": rel_size,
                "bold": is_bold,
                "muted": is_muted,
                "rows": [
                    {"cells": [_runs(line["spans"], is_italic) for line in row]}
                    for row in rows
                ],
            })

        return {"page": page_num, "total_pages": len(doc), "blocks": blocks_out}
