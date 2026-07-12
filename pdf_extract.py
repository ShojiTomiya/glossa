import fitz


def extract_text(path: str) -> str:
    doc = fitz.open(path)
    pages = [page.get_text() for page in doc]
    pages = [p for p in pages if p.strip()]
    if not pages:
        raise ValueError("PDF appears to be a scan with no extractable text (OCR not supported).")
    return "\n\n".join(pages)
