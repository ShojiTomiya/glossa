import re

import ebooklib
import trafilatura
from ebooklib import epub
from bs4 import BeautifulSoup, NavigableString

# PDFs are handled by pdf_render.py, which keeps each page's layout 

BLOCK_TAGS = ["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "td"]
HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
ITALIC_TAGS = {"i", "em"}
BOLD_TAGS = {"b", "strong"}


def _collect_runs(el, italic: bool = False, bold: bool = False) -> list[dict]:

    runs = []
    for child in el.children:
        if isinstance(child, NavigableString):
            text = re.sub(r"\s+", " ", str(child))
            if text:
                runs.append({"text": text, "italic": italic, "bold": bold})
        elif child.name == "br":
            runs.append({"text": "\n", "italic": italic, "bold": bold})
        else:
            runs.extend(_collect_runs(
                child,
                italic or child.name in ITALIC_TAGS,
                bold or child.name in BOLD_TAGS,
            ))
    return runs


def _block_data(el) -> dict:
    runs = _collect_runs(el)
    if el.name in HEADING_TAGS:
        return {"kind": "heading", "level": int(el.name[1]), "runs": runs}
    return {"kind": "paragraph", "runs": runs}


def extract_epub_blocks(path: str) -> list[dict]:
    book = epub.read_epub(path, options={"ignore_ncx": True})
    blocks = []
    for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        soup = BeautifulSoup(item.get_content(), "html.parser")
        for el in soup.find_all(BLOCK_TAGS):
            if el.find(BLOCK_TAGS):
                continue
            block = _block_data(el)
            if any(r["text"].strip() for r in block["runs"]):
                blocks.append(block)

    if not blocks:
        raise ValueError("EPUB has no extractable text content.")
    return blocks


def _table_row_data(tr) -> dict:
    # Cells joined with an em dash on one line (e.g. "Born — 24 August
    # 1899") instead of keeping them as a grid — good enough for the
    # key/value infobox style tables this is mostly going to encounter.
    cells = tr.find_all(["td", "th"], recursive=False)
    runs = []
    for cell in cells:
        cell_runs = _collect_runs(cell)
        if not any(r["text"].strip() for r in cell_runs):
            continue
        if runs:
            runs.append({"text": " — ", "italic": False, "bold": False})
        runs.extend(cell_runs)
    return {"kind": "table-row", "runs": runs}


def extract_url_blocks(url: str) -> tuple[list[dict], str | None]:
    downloaded = trafilatura.fetch_url(url)
    if not downloaded:
        raise ValueError("Could not fetch that URL. Check the address or try again.")

    html = trafilatura.extract(downloaded, favor_precision=True, output_format="html", include_formatting=True)
    if not html or not html.strip():
        raise ValueError("Could not find readable article content at that URL.")

    soup = BeautifulSoup(html, "html.parser")
    blocks = []
    for el in soup.find_all(list(HEADING_TAGS) + ["p", "li", "tr"]):
        # <p>/<li> nested inside a <table> row or another <li> are already
        # covered when we handle their ancestor — skip to avoid duplicates.
        if el.name != "tr" and el.find_parent(["li", "tr"]) is not None:
            continue

        if el.name == "tr":
            block = _table_row_data(el)
        elif el.name == "li":
            block = {"kind": "list-item", "runs": _collect_runs(el)}
        elif el.name in HEADING_TAGS:
            block = {"kind": "heading", "level": int(el.name[1]), "runs": _collect_runs(el)}
        else:
            block = {"kind": "paragraph", "runs": _collect_runs(el)}

        if any(r["text"].strip() for r in block["runs"]):
            blocks.append(block)

    if not blocks:
        raise ValueError("Could not find readable article content at that URL.")

    metadata = trafilatura.extract_metadata(downloaded)
    title = metadata.title if metadata else None
    return blocks, title