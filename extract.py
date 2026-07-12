import fitz
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup


def extract_pdf_text(path: str) -> str:
    doc = fitz.open(path)
    pages = [page.get_text() for page in doc]
    pages = [p for p in pages if p.strip()]
    if not pages:
        raise ValueError("PDF appears to be a scan with no extractable text (OCR not supported).")
    return "\n\n".join(pages)


def extract_epub_text(path: str) -> str:
    book = epub.read_epub(path, options={"ignore_ncx": True})
    chapters = []
    for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        soup = BeautifulSoup(item.get_content(), "html.parser")
        text = soup.get_text(separator="\n").strip()
        if text:
            chapters.append(text)

    if not chapters:
        raise ValueError("EPUB has no extractable text content.")
    return "\n\n".join(chapters)
