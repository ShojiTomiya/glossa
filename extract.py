import fitz
import ebooklib
import trafilatura
from ebooklib import epub
from bs4 import BeautifulSoup


def _page_text(page: fitz.Page) -> str:

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


def extract_url_text(url: str) -> tuple[str, str | None]:
 
    downloaded = trafilatura.fetch_url(url)
    if not downloaded:
        raise ValueError("Could not fetch that URL. Check the address or try again.")

    content = trafilatura.extract(downloaded, favor_precision=True)
    if not content or not content.strip():
        raise ValueError("Could not find readable article content at that URL.")

    metadata = trafilatura.extract_metadata(downloaded)
    title = metadata.title if metadata else None
    return content.strip(), title