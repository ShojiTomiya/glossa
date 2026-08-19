import ebooklib
import trafilatura
from ebooklib import epub
from bs4 import BeautifulSoup

# PDFs are handled by pdf_render.py, which keeps each page's layout instead
# of flattening it to plain text - see that module instead of here.

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