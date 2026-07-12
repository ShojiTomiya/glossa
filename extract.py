import fitz
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup


def _page_text(page: fitz.Page) -> str:
    # "blocks" groups text the way it's laid out on the page (paragraphs,
    # captions, etc.) with each block's own text still broken into raw print
    # lines — join those with spaces so a paragraph isn't split mid-sentence,
    # then join blocks (paragraphs) with newlines.
    paragraphs = [
        " ".join(text.split("\n")).strip()
        for *_, text, _, block_type in page.get_text("blocks")
        if block_type == 0
    ]
    paragraphs = [p for p in paragraphs if p]
    return "\n".join(paragraphs) if paragraphs else page.get_text().strip()


def extract_pdf_text(path: str) -> str:
    doc = fitz.open(path)
    pages = [_page_text(page) for page in doc]
    pages = [p for p in pages if p.strip()]
    if not pages:
        raise ValueError("PDF appears to be a scan with no extractable text (OCR not supported).")
    return "\n\n".join(pages)


BLOCK_TAGS = ["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "td"]


def _block_text(soup: BeautifulSoup) -> str:
    for br in soup.find_all("br"):
        br.replace_with("\n")

    # Only the innermost block elements, so a wrapping <div> around several
    # <p>s doesn't duplicate their text. Using no separator (rather than "\n")
    # keeps text around inline tags (<i>, <a>, footnote refs...) glued
    # together correctly instead of splitting mid-sentence.
    blocks = [el.get_text().strip() for el in soup.find_all(BLOCK_TAGS) if not el.find(BLOCK_TAGS)]
    blocks = [b for b in blocks if b]
    return "\n".join(blocks) if blocks else soup.get_text().strip()


def extract_epub_text(path: str) -> str:
    book = epub.read_epub(path, options={"ignore_ncx": True})
    chapters = []
    for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        soup = BeautifulSoup(item.get_content(), "html.parser")
        text = _block_text(soup)
        if text:
            chapters.append(text)

    if not chapters:
        raise ValueError("EPUB has no extractable text content.")
    return "\n\n".join(chapters)
