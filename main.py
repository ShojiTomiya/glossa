import tempfile
from pathlib import Path

from fastapi import FastAPI, UploadFile, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

import storage
import llm
from extract import extract_pdf_text, extract_epub_text

app = FastAPI()


class TranslateRequest(BaseModel):
    phrase: str
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


@app.post("/api/upload")
async def upload(file: UploadFile, title: str = Form(...), source_lang: str = Form(...)):
    suffix = Path(file.filename).suffix.lower()
    raw = await file.read()

    if suffix == ".pdf":
        with tempfile.NamedTemporaryFile(suffix=".pdf") as tmp:
            tmp.write(raw)
            tmp.flush()
            try:
                content = extract_pdf_text(tmp.name)
            except ValueError as e:
                raise HTTPException(400, str(e))
    elif suffix == ".epub":
        with tempfile.NamedTemporaryFile(suffix=".epub") as tmp:
            tmp.write(raw)
            tmp.flush()
            try:
                content = extract_epub_text(tmp.name)
            except ValueError as e:
                raise HTTPException(400, str(e))
    elif suffix == ".txt":
        content = raw.decode("utf-8", errors="replace")
    else:
        raise HTTPException(400, f"Unsupported file type '{suffix}'. Use .pdf, .epub or .txt.")

    entry = storage.save_text(title, source_lang, content)
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
        translation = llm.translate(req.phrase, req.source_lang, req.target_lang)
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
