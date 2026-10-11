import re
from urllib.parse import urljoin

import ebooklib
import trafilatura
from ebooklib import epub
from bs4 import BeautifulSoup, NavigableString

# PDFs are handled by pdf_render.py, which keeps each page's layout.

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


def _join(base: str, value: str) -> str:

    try:
        return urljoin(base, value)
    except ValueError:
        return ""


IMAGE_SRC_ATTRS = ("src", "data-src", "data-lazy-src", "data-original", "data-srcset", "srcset")


def _image_urls(img, base_url: str) -> list[str]:

    urls = []
    for attr in IMAGE_SRC_ATTRS:
        value = img.get(attr)
        if value and "srcset" in attr:
            value = value.split(",")[0].strip().split(" ")[0]
        if value and not value.startswith("data:"):
            joined = _join(base_url, value)
            if joined:
                urls.append(joined)
    return urls


def _clean_caption(text: str) -> str:

    text = " ".join(text.split())
    text = re.sub(r"\s+([.,;:!?)\]»”’])", r"\1", text)
    return re.sub(r"([(\[«„‘])\s+", r"\1", text)


def _figure_captions(page_html: str, base_url: str) -> dict[str, str]:
   
    captions: dict[str, str] = {}
    for figure in BeautifulSoup(page_html, "html.parser").find_all("figure"):
        caption = figure.find("figcaption")
        text = _clean_caption(caption.get_text(" ")) if caption else ""
        if not text:
            continue
        for img in figure.find_all("img"):
            for src in _image_urls(img, base_url):
                captions.setdefault(src, text)
                captions.setdefault(src.split("?")[0], text)
    return captions


def _is_caption_leftover(text: str, caption: str) -> bool:
    return bool(text) and text in caption and len(text) >= len(caption) / 2


def _drop_caption_leftovers(blocks: list[dict]) -> list[dict]:
    keep = []
    for i, block in enumerate(blocks):
        if block["kind"] == "paragraph":
            text = _clean_caption("".join(r["text"] for r in block["runs"]))
            neighbours = [blocks[j] for j in (i - 1, i + 1) if 0 <= j < len(blocks)]
            if any(n["kind"] == "image" and _is_caption_leftover(text, n.get("caption", "")) for n in neighbours):
                continue
        keep.append(block)
    return keep


def extract_url_blocks(url: str) -> tuple[list[dict], str | None]:
    downloaded = trafilatura.fetch_url(url)
    if not downloaded:
        raise ValueError("Could not fetch that URL. Check the address or try again.")

    # url= makes the extractor resolve relative and protocol-relative image
    # addresses against the page (without it "//cdn.x/a.png" would become http://).
    html = trafilatura.extract(downloaded, url=url, favor_precision=True, output_format="html",
                               include_formatting=True, include_images=True)
    if not html or not html.strip():
        raise ValueError("Could not find readable article content at that URL.")

    soup = BeautifulSoup(html, "html.parser")
    captions = _figure_captions(downloaded, url)
    blocks = []
    for el in soup.find_all(list(HEADING_TAGS) + ["p", "li", "tr", "img"]):
        # <p>/<li> nested inside a <table> row or another <li> are already
        # covered when we handle their ancestor — skip to avoid duplicates.
        if el.name != "tr" and el.find_parent(["li", "tr"]) is not None:
            continue

        if el.name == "img":
            raw_src = (el.get("src") or "").strip()
            src = _join(url, raw_src) if raw_src else ""
            if src and not raw_src.startswith("data:"):
                # kind "image": "src" is the remote address; images.localize() replaces it
                # with the stored "file" name (and drops the block if the download fails).
                blocks.append({"kind": "image", "src": src, "alt": (el.get("alt") or "").strip(),
                               "caption": captions.get(src) or captions.get(src.split("?")[0], "")})
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

    blocks = _drop_caption_leftovers(blocks)
    if not any(b["kind"] != "image" for b in blocks):
        raise ValueError("Could not find readable article content at that URL.")

    metadata = trafilatura.extract_metadata(downloaded)
    title = metadata.title if metadata else None
    return blocks, title