import tempfile
from pathlib import Path

from fastapi import FastAPI, UploadFile, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

import storage
import llm
import pdf_render
from extract import extract_epub_blocks, extract_url_blocks

app = FastAPI()


class TranslateRequest(BaseModel):
    phrase: str
    context: str
    source_lang: str
    target_lang: str


class ExplainRequest(BaseModel):
    phrase: str
    context: str
    source_lang: str
    target_lang: str


class UpdateTextRequest(BaseModel):
    title: str
    source_lang: str


class ImportUrlRequest(BaseModel):
    url: str
    source_lang: str
    title: str | None = None


@app.post("/api/upload")
async def upload(file: UploadFile, title: str = Form(...), source_lang: str = Form(...)):
    suffix = Path(file.filename).suffix.lower()
    raw = await file.read()

    if suffix == ".pdf":
        # Pages are kept as their own layout (see pdf_render.py) and
        # rendered on demand, so we just store the file — no upload-time
        # extraction — beyond a quick check that there's text to find at all.
        with tempfile.NamedTemporaryFile(suffix=".pdf") as tmp:
            tmp.write(raw)
            tmp.flush()
            if not pdf_render.has_extractable_text(tmp.name):
                raise HTTPException(400, "PDF appears to be a scan with no extractable text (OCR not supported).")
        entry = storage.save_pdf(title, source_lang, raw)
        return entry
    elif suffix == ".epub":
        with tempfile.NamedTemporaryFile(suffix=".epub") as tmp:
            tmp.write(raw)
            tmp.flush()
            try:
                blocks = extract_epub_blocks(tmp.name)
            except ValueError as e:
                raise HTTPException(400, str(e))
        entry = storage.save_blocks(title, source_lang, blocks)
        return entry
    elif suffix == ".txt":
        content = raw.decode("utf-8", errors="replace")
    else:
        raise HTTPException(400, f"Unsupported file type '{suffix}'. Use .pdf, .epub or .txt.")

    entry = storage.save_text(title, source_lang, content)
    return entry


@app.post("/api/import-url")
def import_url(req: ImportUrlRequest):
    try:
        blocks, extracted_title = extract_url_blocks(req.url)
    except ValueError as e:
        raise HTTPException(400, str(e))

    title = req.title or extracted_title or req.url
    if extracted_title:
        heading = {"kind": "heading", "level": 1, "runs": [{"text": extracted_title, "italic": False, "bold": False}]}
        blocks = [heading] + blocks
    entry = storage.save_blocks(title, req.source_lang, blocks, kind="url")
    return entry


@app.get("/api/texts")
def list_texts():
    return storage.list_texts()


@app.get("/api/texts/{text_id}")
def get_text(text_id: str):
    entry = storage.get_text(text_id)
    if entry is None:
        raise HTTPException(404, "Text not found")
    return entry


@app.get("/api/texts/{text_id}/pdf-page/{page_num}")
def get_pdf_page(text_id: str, page_num: int):
    path = storage.get_pdf_path(text_id)
    if path is None:
        raise HTTPException(404, "PDF not found")
    try:
        return pdf_render.render_page(str(path), page_num)
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.patch("/api/texts/{text_id}")
def update_text(text_id: str, req: UpdateTextRequest):
    entry = storage.update_text(text_id, req.title, req.source_lang)
    if entry is None:
        raise HTTPException(404, "Text not found")
    return entry


@app.delete("/api/texts/{text_id}")
def delete_text(text_id: str):
    if not storage.delete_text(text_id):
        raise HTTPException(404, "Text not found")
    return {"ok": True}


@app.post("/api/translate")
def translate(req: TranslateRequest):
    try:
        translation = llm.translate(req.phrase, req.context, req.source_lang, req.target_lang)
    except llm.RateLimitExceeded as e:
        raise HTTPException(429, str(e))
    return {"translation": translation}


@app.post("/api/explain")
def explain(req: ExplainRequest):
    try:
        result = llm.explain(req.phrase, req.context, req.source_lang, req.target_lang)
    except llm.RateLimitExceeded as e:
        raise HTTPException(429, str(e))
    except Exception as e:
        raise HTTPException(502, f"LLM explain failed: {e}")
    return result


BASE_DIR = Path(__file__).parent
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/")
def index():
    return FileResponse(BASE_DIR / "static" / "index.html")